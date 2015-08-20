// Required Node Packages
var http = require('http'),
    https = require('https'),
    async = require('async'),
    tar = require('tar-stream'),
    minimongo = require("minimongo");

var IndexedDb = minimongo.IndexedDb;

var events = require('events');
var eventEmitter = new events.EventEmitter();

var executeModule = require("./execute");
var fetchJnlpModule = require("./fetchJnlp");
var updateRowsModule = require("./updateRows");
var storeSchemaModule = require("./storeSchema");
var restoreStateModule = require("./restoreState");
var createFolderHierarchyModule = require("./createFolderHierarchy");

eventEmitter.on('customErr', function(err) {
  console.log(err);
});

/*
 * Get URL contents viz., hostname, pathname, hash, etc
 */
var parseURL = function(href) {
  var match = href.match(/^(https?\:)\/\/(([^:\/?#]*)(?:\:([0-9]+))?)(\/[^?#]*)(\?[^#]*|)(#.*|)$/);
  return match && {
    protocol: match[1],
    host: match[2],
    hostname: match[3],
    port: match[4],
    pathname: match[5],
    search: match[6],
    hash: match[7]
  }
}

/*
 * Fetches and returns the seriesUID folder location from Chrome local storage
 */
var getSeriesUIDFolder = function(db, seriesUIDShort, cbGetSeriesUIDFolder) {
  db.tciaSchema.findOne({'seriesUIDShort': seriesUIDShort}, {}, function(doc) {
    if(doc && doc.fsPath){
      chrome.fileSystem.isRestorable(doc.fsPath, function(IsRestorable) {
        chrome.fileSystem.restoreEntry(doc.fsPath, function(seriesUIDEntry) {
          cbGetSeriesUIDFolder(seriesUIDEntry);
        });
      });
    }
    else cbGetSeriesUIDFolder(null);
  });
}

/*
 * Writes content of the blob to the writableEntry
 */
var writeFileEntry = function(writableFileEntry, blob, cbWriteFileEntry) {
  if (!writableFileEntry) {
    cbWriteFileEntry("Not a valid writableEntry");
  }

  writableFileEntry.createWriter(function(writer) {
    writer.onerror = errorHandler;
    writer.onwriteend = function(){
      writer.onwriteend = function(e){
        cbWriteFileEntry(null);
      }
    }

    writer.truncate(blob.size);
    waitForIO(writer, function() {
      writer.seek(0);
      writer.write(blob);
    });
  }, errorHandler);
}

/*
 * Helper Function for I/O to validate the write operation
 */
var waitForIO = function (writer, callbackIO) {
  // Set a watchdog to avoid eventual locking
  var start = Date.now();
  var reentrant = function() {
    if (writer.readyState === writer.WRITING && Date.now() - start < 4000) {
      setTimeout(reentrant, 100);
      return;
    }
    if (writer.readyState === writer.WRITING) {
      console.error("Write operation taking too long, aborting!" +
          " (current writer readyState is " + writer.readyState + ")");
      writer.abort();
    }
    else {
      callbackIO();
    }
  };
  setTimeout(reentrant, 100);
}

/*
 * Writes files to the seriesUID directory
 */
var downloadFile = function(seriesUIDEntry, headerName, blob, cbDownloadFile) {
  chrome.fileSystem.getWritableEntry(seriesUIDEntry, function(writableEntry) {
    writableEntry.getFile(headerName, {create:true}, function(writableFileEntry) {
      writeFileEntry(writableFileEntry, blob, function(errWriteFileEntry) {
        if(!errWriteFileEntry) {
          cbDownloadFile(null);
        }
        else cbDownloadFile(errWriteFileEntry);
      });
    });
  });
}

var updateSeriesDownloadStatus = function(db, seriesUIDShort, downloadStatus, cbUpdateSeriesDownloadFlag) {
  db.tciaSchema.findOne({'seriesUIDShort': seriesUIDShort}, {}, function(doc) {
    db.tciaSchema.upsert({
      '_id': doc._id,
      'type': doc.type,
      'seriesUID': doc.seriesUID,
      'seriesUIDShort': doc.seriesUIDShort,
      'hasAnnotation': doc.hasAnnotation,
      'numberDCM': doc.numberDCM,
      'size': doc.size,
      'fsPath': doc.fsPath,
      'downloadStatus': downloadStatus,
      'downloadedSize': doc.downloadedSize,
      'files': doc.files
    }, function() {
      cbUpdateSeriesDownloadFlag();
    });
  });
}

var updateFilesArray = function (files, headerName, cbUpdateFilesArray) {
  var fileItem = headerName;
  var files = files.concat([fileItem]);
  cbUpdateFilesArray(files);
}

/*
 * Upserts the files to the appropriate series document
 */
var updateFileDB = function(db, seriesUIDShort, headerName, bufferSize, cbUpdateFileDB) {
  db.tciaSchema.findOne({'seriesUIDShort': seriesUIDShort}, {}, function(doc) {
    updateFilesArray(doc.files, headerName, function(files) {
      db.tciaSchema.upsert({
        '_id': doc._id,
        'type': doc.type,
        'seriesUID': doc.seriesUID,
        'seriesUIDShort': doc.seriesUIDShort,
        'hasAnnotation': doc.hasAnnotation,
        'numberDCM': doc.numberDCM,
        'size': doc.size,
        'fsPath': doc.fsPath,
        'downloadStatus': doc.downloadStatus,
        'downloadedSize': doc.downloadedSize + bufferSize,
        'files': files
      }, function() {
        cbUpdateFileDB();
      });
    });
  });
}

/*
 * Fetch the tar from the 'href' passed and parse it on-the-fly
 */
var fetchAndParseTar = function(db, item, href, jnlpPassword, cbFetchAndParseTar){
  var url = parseURL(href);
  var chunkDownload = 0,
      updateLength = 0,
      prevDownloadedSize = item.downloadedSize;
  console.log(item.seriesUIDShort + " downloadedSize " + prevDownloadedSize);
  var options = {
    protocol: url.protocol,
    host: url.host,
    path: url.pathname + url.search,
    method: 'GET',
    responseType: 'arraybuffer',    // set 'responseType' to 'arraybuffer' for the XHR response
    headers: {'password': jnlpPassword}    // custom headers
  };

  var req = http.request(options, function(res){
    var tarParser = tar.extract();

    res.on('data', function (chunk) {
      // Transforming the 'arraybuffer' to 'Buffer' for compatibility with the Stream API
      chunkDownload += chunk.length;
      console.log("chunkDownload  " + chunkDownload);
      updateLength = Math.round(((chunkDownload*1.0/1024/1024) + prevDownloadedSize)/item.size*100);
      console.log("updateLength " + updateLength);
      if(updateLength > 100)
        updateLength = 100;
      dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data(updateLength+"%").draw();
      tarParser.write(new Buffer(chunk));
    });

    res.on('end', tarParser.end.bind(tarParser));

    res.on('error', function (error) {
      console.log(error);
      cbFetchAndParseTar(error);
    });

    // For each file entry, do the following
    tarParser.on('entry', function(header, stream, callback) {
      console.log("File found " + header.name + " of size ~" +
          Math.round((header.size*1.0)/1024/1024*100)/100 + " MB");

      var buffer = [];
      stream.on('data', function(data){
        buffer.push(data);
      });

      stream.on('end', function() {
        buffer = Buffer.concat(buffer);
        console.log("buffer size MB " + (buffer.length*1.0)/1024/1024);
        getSeriesUIDFolder(db, item.seriesUIDShort, function(seriesUIDEntry) {
          if(seriesUIDEntry) {
            var blob = new Blob([buffer], {type: 'application/octet-binary'});
            downloadFile(seriesUIDEntry, header.name, blob,
                function(errDownloadFile) {
                  if(!errDownloadFile) {
                    var bufferSize = Math.round((buffer.length*1.0)/1024/1024*100)/100;
                    updateFileDB(db, item.seriesUIDShort, header.name, bufferSize, function() {
                      buffer = [];
                      console.log("<< EOF >>");
                      callback();
                    });
                  }
                  else {
                    eventEmitter.emit('customErr', errDownloadFile);
                    callback();
                  }
                });
          }
          else {
            eventEmitter.emit('customErr',
                "Error: seriesUID fsPath not present in DB");
            callback();
          }
        });
      })

      .on('error', function(err) {
        console.log(err);
        cbFetchAndParseTar(err);
      });
      //stream.resume();
    })

    .on('error', function(err) {
      console.log(err);
      cbFetchAndParseTar(err);
    })

    .on('finish', function(){
      console.log("Tar files processed successfully");
      cbFetchAndParseTar(null);
    });
  });

  req.on('error', function (e){
    console.log('problem with request: ' + e);
    cbFetchAndParseTar(e);
  });

  req.end();
}

var downloadSeries = function(db, result, jnlpUserId, jnlpPassword, jnlpIncludeAnnotation, cbDownloadSeries){
  async.eachLimit(result, 3, function(item, callbackItem) {
    async.waterfall([
        function(cbSopUIDsList) {
          db.tciaSchema.findOne({'seriesUIDShort': item.seriesUIDShort}, {}, function(doc) {
            if(doc.files && doc.files.length < 1000) {
              var sopUIDsList = [];
              async.each(doc.files, function(sopUID, cbAppendSopUID){
                var pos = sopUID.indexOf(".dcm");
                sopUIDsList.push("'" + sopUID.substring(0, pos) + "'");
                cbAppendSopUID();
              }, function(err) {
                cbSopUIDsList(null, sopUIDsList.join(","));
              });
            }
            else {
              cbSopUIDsList(null, "");
            }
          });
        },
        function(sopUIDsList, cbProcessSeries) {
          var href = encodeURI('https://public.cancerimagingarchive.net/nbia-download/servlet/DownloadServlet?userId='
              + jnlpUserId + '&includeAnnotation=' + jnlpIncludeAnnotation +
              '&hasAnnotation=' + item.hasAnnotation + '&seriesUid=' +
              item.seriesUID + '&sopUids=' + sopUIDsList);
          console.log(href);
          dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Downloading').draw();

          updateSeriesDownloadStatus(db, item.seriesUIDShort, 1, function() {
            fetchAndParseTar(db, item, href, jnlpPassword, function(errFetchAndParseTar) {
              if(!errFetchAndParseTar) {
                  updateSeriesDownloadStatus(db, item.seriesUIDShort, 2, function() {
                    dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Complete').draw();
                    cbProcessSeries();
                  });
              }
              else {
                updateSeriesDownloadStatus(db, item.seriesUIDShort, 0, function() {
                  dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data("0%").draw();
                  dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Error').draw();
                  cbProcessSeries();
                });
              }
            });
          });
        }
    ], function (err, result) {
      callbackItem();
    });

  }, function(errSeriesProcess) {
    db.tciaSchema.find({
      'type': "seriesDetails",
      "downloadStatus": {$ne: 2}
      }).fetch(function(result) {
        if(result.length == 0) {
          cbDownloadSeries(null);
        }
        else {
          console.log("Series download count " + result.length);
          downloadSeries(db, result, jnlpUserId, jnlpPassword,
              jnlpIncludeAnnotation, function() {
                cbDownloadSeries(null);
              });
        }
      });
  });
}

var initDownloadMgr = function(jnlpUserId, jnlpPassword, jnlpIncludeAnnotation, cbInitDownloadMgr) {
  new IndexedDb({namespace: "mydb"}, function(db) {
    db.addCollection("tciaSchema", function() {
      async.series([
          function(cbStep1){
            db.tciaSchema.find({
              'type': "seriesDetails",
              "downloadStatus": {$ne: 0}
            }).fetch(function(result) {
              if(result.length) {
                output.innerHTML = "Updating rows ...";
              }
              console.log("Partial/Complete downloads");
              async.each(result, function(item, cbUpdateRow) {
                console.log(item.seriesUIDShort);
                if(item.downloadStatus == 1) {
                  dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data(Math.round(item.downloadedSize/item.size*100) + "%").draw();
                  dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Incomplete').draw();
                }
                else if(item.downloadStatus == 2) {
                  dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data("100%").draw();
                  dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Complete').draw();
                }
                cbUpdateRow();
              }, function(errUpdateRow) {
                cbStep1(null, 'Updated all rows');
              });
            });
          },
          function(cbStep2){
            output.innerHTML = "Download started ...";
            db.tciaSchema.find({
              'type': "seriesDetails",
              "downloadStatus": {$ne: 2}
            }).fetch(function(result) {
              if(!result.length) {
                db.removeCollection("tciaSchema", function(){
                  cbStep2(null, 'All series downloaded successfully');
                });
              }
              else {
                console.log("Series download count " + result.length);
                downloadSeries(db, result, jnlpUserId, jnlpPassword,
                    jnlpIncludeAnnotation, function() {
                      db.removeCollection("tciaSchema", function(){
                        cbStep2(null, 'All series downloaded successfully');
                      });
                    });
              }
            });
          }
      ],
      function(err, results){
        cbInitDownloadMgr();
      });
    });
  }, function(err) {
    console.log(err);
  });
}

var bundle = {
  execute: executeModule.execute,
  initDownloadMgr: initDownloadMgr,
  fetchJnlp: fetchJnlpModule.fetchJnlp,
  updateRows: updateRowsModule.updateRows,
  storeSchema: storeSchemaModule.storeSchema,
  restoreState: restoreStateModule.restoreState,
  createFolderHierarchy: createFolderHierarchyModule.createFolderHierarchy
};

module.exports = bundle;

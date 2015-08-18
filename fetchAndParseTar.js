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

var updateFilesArray = function (files, headerName, downloadFlag, cbUpdateFilesArray) {
    if(!downloadFlag) {
      var fileItem = {'name': headerName, 'downloaded': downloadFlag};
      var files = files.concat([fileItem]);
      cbUpdateFilesArray(files);
    }
    else {
      for (var i in files) {
        (function(index) {
          if (files[index].name == headerName) {
            files[index].downloaded = downloadFlag;
            cbUpdateFilesArray(files);
          }
        })(i);
      }
    }
}

var updateDownloadFlag = function(db, seriesUIDShort, downloadFlag, cbUpdateDownloadFlag) {
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
      'downloadFlag': downloadFlag,
      'files': doc.files
    }, function() {
      cbUpdateDownloadFlag();
    });
  });
}

/*
 * Upserts the files to the appropriate series document with downloadFlag status
 */
var updateFileDB = function(db, headerName, seriesUIDShort, downloadFlag, cbUpdateFileDB) {
  db.tciaSchema.findOne({'seriesUIDShort': seriesUIDShort}, {}, function(doc) {
    updateFilesArray(doc.files, headerName, downloadFlag, function(files){
      db.tciaSchema.upsert({
        '_id': doc._id,
        'type': doc.type,
        'seriesUID': doc.seriesUID,
        'seriesUIDShort': doc.seriesUIDShort,
        'hasAnnotation': doc.hasAnnotation,
        'numberDCM': doc.numberDCM,
        'size': doc.size,
        'fsPath': doc.fsPath,
        'downloadFlag': doc.downloadFlag,
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
var fetchAndParseTar = function(db, seriesUIDShort, href, jnlpPassword, cbFetchAndParseTar){
  var url = parseURL(href);
  var chunkDownload = 0,
  totalLength = dTable.cell(dTable.row("[id='row_" + seriesUIDShort + "']").node(), 4).data();
  console.log("totalLength " + totalLength);
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
      var updateLength = Math.round((chunkDownload*1.0)/1024/1024/totalLength*100);
      if(updateLength > 100)
        updateLength = 100;
      console.log("updateLength " + updateLength);
      dTable.cell(dTable.row("[id='row_" + seriesUIDShort + "']").node(), 6).data(updateLength+"%").draw();
      tarParser.write(new Buffer(chunk));
    });

    res.on('end', tarParser.end.bind(tarParser));

    res.on('error', function (error) {
      console.log(error);
      cbFetchAndParseTar(error);
    });

    // For each file entry, do the following
    tarParser.on('entry', function(header, stream, callback) {
      var downloadFlag = false;
      console.log("File found " + header.name + " of size ~" +
          Math.round(header.size/1024) + " KB");

      updateFileDB(db, header.name, seriesUIDShort, downloadFlag, function(){
        var buffer = [];
        stream.on('data', function(data){
          buffer.push(data);
        });

        stream.on('end', function() {
          buffer = Buffer.concat(buffer);
          getSeriesUIDFolder(db, seriesUIDShort, function(seriesUIDEntry) {
            if (seriesUIDEntry) {
              var blob = new Blob([buffer], {type: 'application/octet-binary'});
              downloadFile(seriesUIDEntry, header.name, blob,
                  function(errDownloadFile) {
                    if(!errDownloadFile) {
                      buffer = [];
                      downloadFlag = true;
                      updateFileDB(db, header.name, seriesUIDShort, downloadFlag, function() {
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
      });
      //stream.resume();
    })

    .on('error', function(err) {
      console.log(err);
      cbFetchAndParseTar(err);
    })

    .on('finish', function(){
      console.log("Tar files processed successfully");
      chunkDownload = 0;
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
    var href = encodeURI('https://public.cancerimagingarchive.net/nbia-download/servlet/DownloadServlet?userId='
        + jnlpUserId + '&includeAnnotation=' + jnlpIncludeAnnotation +
        '&hasAnnotation=' + item.hasAnnotation + '&seriesUid=' +
        item.seriesUID + '&sopUids=');
    console.log(href);
    dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Downloading').draw();

    fetchAndParseTar(db, item.seriesUIDShort, href, jnlpPassword, function(errFetchAndParseTar) {
      if(!errFetchAndParseTar) {
        updateDownloadFlag(db, item.seriesUIDShort, true, function() {
          dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Complete').draw();
          callbackItem();
        });
      }
      else {
        updateDownloadFlag(db, item.seriesUIDShort, false, function() {
          dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Error').draw();
          callbackItem();
        });
      }
    });
  }, function(errSeriesProcess) {
      db.tciaSchema.find({
        'type': "seriesDetails",
        "downloadFlag": false
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
          function(cbTask1){
            db.tciaSchema.find({
              'type': "seriesDetails",
              "downloadFlag": true
            }).fetch(function(result) {
              if(result.length) {
                output.innerHTML = "Updating rows ...";
              }
              async.each(result, function(item, cbUpdateRow) {
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Complete').draw();
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data("100%").draw();
                cbUpdateRow();
              }, function(errUpdateRow) {
                cbTask1(null, 'Updated all rows');
              });
            });
          },
          function(cbTask2){
            output.innerHTML = "Download started ...";
            db.tciaSchema.find({
              'type': "seriesDetails",
              "downloadFlag": false
            }).fetch(function(result) {
              if(!result.length) {
                db.removeCollection("tciaSchema", function(){
                  cbTask2(null, 'All series downloaded successfully');
                });
              }
              else {
                console.log("Series download count " + result.length);
                downloadSeries(db, result, jnlpUserId, jnlpPassword,
                    jnlpIncludeAnnotation, function() {
                      db.removeCollection("tciaSchema", function(){
                        cbTask2(null, 'All series downloaded successfully');
                      });
                    });
              }
            });
          }
      ],
      // optional callback
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
  storeSchema: storeSchemaModule.storeSchema,
  restoreState: restoreStateModule.restoreState,
  createFolderHierarchy: createFolderHierarchyModule.createFolderHierarchy
};

module.exports = bundle;

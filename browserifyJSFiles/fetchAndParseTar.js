// Required Node Packages
var http = require('http');
var async = require('async');
var tar = require('tar-stream');
var minimongo = require('minimongo');

var IndexedDb = minimongo.IndexedDb;

var executeModule = require('./execute');
var fetchJnlpModule = require('./fetchJnlp');
var updateRowsModule = require('./updateRows');
var storeSchemaModule = require('./storeSchema');
var restoreStateModule = require('./restoreState');
var createFolderHierarchyModule = require('./createFolderHierarchy');

/* global output */

var errorHandler = function (e) {
  console.error(e);
};

/*
 * Get URL contents viz., hostname, pathname, hash, etc
 */
var parseURL = function (href) {
  var match = href.match(/^(https?\:)\/\/(([^:\/?#]*)(?:\:([0-9]+))?)(\/[^?#]*)(\?[^#]*|)(#.*|)$/);
  return match && {
    protocol: match[1],
    host: match[2],
    hostname: match[3],
    port: match[4],
    pathname: match[5],
    search: match[6],
    hash: match[7]
  };
};

/*
 * Fetches and returns the seriesUID folder location from DB
 */
var getSeriesUIDFolder = function (db, seriesUIDShort, cbGetSeriesUIDFolder) {
  db.tciaSchema.findOne({'seriesUIDShort': seriesUIDShort}, {}, function (doc) {
    if (doc && doc.fsPath) {
      chrome.fileSystem.isRestorable(doc.fsPath, function (IsRestorable) {
        chrome.fileSystem.restoreEntry(doc.fsPath, function (seriesUIDEntry) {
          cbGetSeriesUIDFolder(seriesUIDEntry);
        });
      });
    }
    else cbGetSeriesUIDFolder(null);
  });
};

/*
 * Writes content of blob to the writableEntry
 */
var writeFileEntry = function (writableFileEntry, blob, cbWriteFileEntry) {
  if (!writableFileEntry) {
    cbWriteFileEntry('Not a valid writableEntry');
  }

  writableFileEntry.createWriter(function (writer) {
    writer.onerror = errorHandler;
    writer.onwriteend = function () {
      writer.onwriteend = function (e) {
        cbWriteFileEntry(null);
      };
    };

    writer.truncate(blob.size);
    waitForIO(writer, function () {
      writer.seek(0);
      writer.write(blob);
    });
  }, errorHandler);
};

/*
 * Helper Function for I/O to validate the write operation
 */
var waitForIO = function (writer, callbackIO) {
  // Set a watchdog to avoid eventual locking
  var start = Date.now();
  var reentrant = function () {
    if (writer.readyState === writer.WRITING && Date.now() - start < 4000) {
      setTimeout(reentrant, 100);
      return;
    }
    if (writer.readyState === writer.WRITING) {
      console.error('Write operation taking too long, aborting!' +
          ' (current writer readyState is ' + writer.readyState + ')');
      writer.abort();
    } else {
      callbackIO();
    }
  };
  setTimeout(reentrant, 100);
};

/*
 * Writes files to the seriesUID directory
 */
var downloadFile = function (seriesUIDEntry, headerName, blob, cbDownloadFile) {
  chrome.fileSystem.getWritableEntry(seriesUIDEntry, function (writableEntry) {
    writableEntry.getFile(headerName, {create: true}, function (writableFileEntry) {
      writeFileEntry(writableFileEntry, blob, function (errWriteFileEntry) {
        if (!errWriteFileEntry) {
          cbDownloadFile(null);
        }
        else cbDownloadFile(errWriteFileEntry);
      });
    });
  });
};

/*
 * Upserts series downloadStatus
 */
var updateSeriesDownloadStatus = function (db, seriesUIDShort, downloadStatus, cbUpdateSeriesDownloadFlag) {
  db.tciaSchema.findOne({'seriesUIDShort': seriesUIDShort}, {}, function (doc) {
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
    }, function () {
      cbUpdateSeriesDownloadFlag();
    });
  });
};

/*
 * Appends headerName to the files array
 */
var updateFilesArray = function (files, headerName, cbUpdateFilesArray) {
  var fileItem = headerName;
  files = files.concat([fileItem]);
  cbUpdateFilesArray(files);
};

/*
 * Upserts the files to the appropriate series document
 */
var updateFileDB = function (db, seriesUIDShort, headerName, bufferSize, cbUpdateFileDB) {
  db.tciaSchema.findOne({'seriesUIDShort': seriesUIDShort}, {}, function (doc) {
    updateFilesArray(doc.files, headerName, function (files) {
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
      }, function () {
        cbUpdateFileDB();
      });
    });
  });
};

/*
 * Fetch tar, parse it and download files on-the-fly to user's chosen directory
 * maintaining appropriate folder hierarchy
 */
var fetchAndParseTar = function (db, item, href, jnlpPassword, cbFetchAndParseTar) {
  var url = parseURL(href);
  var chunkDownload = 0;
  var updateLength = 0;
  var prevDownloadedSize = item.downloadedSize;
  console.log(item.seriesUIDShort + ' downloadedSize ' + prevDownloadedSize);
  var options = {
    protocol: url.protocol,
    host: url.host,
    path: url.pathname + url.search,
    method: 'GET',
    responseType: 'arraybuffer',    // set 'responseType' to 'arraybuffer' for the XHR response
    headers: {'password': jnlpPassword}    // custom headers
  };

  var req = http.request(options, function (res) {
    var tarParser = tar.extract();

    res.on('data', function (chunk) {
      chunkDownload += chunk.length;
      updateLength = Math.round(((chunkDownload * 1.0 / 1024 / 1024) + prevDownloadedSize) / item.size * 100);
      if (updateLength > 100) updateLength = 100;
      dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data(updateLength + '%').draw();
      // Transforming the 'arraybuffer' to 'Buffer' for compatibility with the Stream API
      tarParser.write(new Buffer(chunk));
    });

    res.on('end', tarParser.end.bind(tarParser));

    res.on('error', function (error) {
      console.log(error);
      cbFetchAndParseTar(error);
    });

    // For each file entry, do the following
    tarParser.on('entry', function (header, stream, callback) {
      console.log('File found ' + header.name + ' of size ~' +
          Math.round((header.size * 1.0) / 1024 / 1024 * 100) / 100 + ' MB');

      var buffer = [];
      stream.on('data', function (data) {
        buffer.push(data);
      });

      stream.on('end', function () {
        buffer = Buffer.concat(buffer);
        // console.log("buffer size MB " + (buffer.length*1.0)/1024/1024);
        // getSeriesUIDFolder to download the tar files to that directory
        getSeriesUIDFolder(db, item.seriesUIDShort, function (seriesUIDEntry) {
          if (seriesUIDEntry) {
            var blob = new Blob([buffer], {type: 'application/octet-binary'}); // eslint-disable-line no-undef
            downloadFile(seriesUIDEntry, header.name, blob,
                function (errDownloadFile) {
                  if (!errDownloadFile) {
                    var bufferSize = Math.round((buffer.length * 1.0) / 1024 / 1024 * 100) / 100;
                    // update file entry in DB
                    updateFileDB(db, item.seriesUIDShort, header.name, bufferSize, function () {
                      buffer = [];
                      console.log('<< EOF >>');
                      callback();
                    });
                  } else {
                    console.log(errDownloadFile);
                    callback();
                  }
                });
          } else {
            console.log('Error: seriesUID fsPath not present in DB');
            callback();
          }
        });
      })

      .on('error', function (err) {
        console.log(err);
        cbFetchAndParseTar(err);
      });
      // stream.resume();
    })

    .on('error', function (err) {
      console.log(err);
      cbFetchAndParseTar(err);
    })

    .on('finish', function () {
      console.log('Tar files processed successfully');
      cbFetchAndParseTar(null);
    });
  });

  req.on('error', function (e) {
    console.log('problem with request: ' + e);
    cbFetchAndParseTar(e);
  });

  req.end();
};

/*
 * Function to download series in parallel (max concurrency: 3)
 * First creates sopUIDsList and then calls fetchAndParseTar()
 */
var downloadSeries = function (db, result, jnlpUserId, jnlpPassword, jnlpIncludeAnnotation, cbDownloadSeries) {
  // async download series in parallel (concurrency level: 3)
  async.eachLimit(result, 3, function (item, callbackItem) {
    async.waterfall([
      // create sopUIDsList from DB for a particular series
      function (cbSopUIDsList) {
        db.tciaSchema.findOne({'seriesUIDShort': item.seriesUIDShort}, {}, function (doc) {
          // if .dcm files are downloaded (and are less than 1000 to avoid
          // SQL query failure at server)
          if (doc.files && doc.files.length < 1000) {
            var sopUIDsList = [];
            async.each(doc.files, function (sopUID, cbAppendSopUID) {
              var pos = sopUID.indexOf('.dcm');
              sopUIDsList.push("'" + sopUID.substring(0, pos) + "'");
              cbAppendSopUID();
            }, function (err) { // eslint-disable-line handle-callback-err
              cbSopUIDsList(null, sopUIDsList.join(','));
            });
          } else {
            cbSopUIDsList(null, '');
          }
        });
      },
      // Call fetchAndParseTar() with apt URL and update series row when done
      function (sopUIDsList, cbProcessSeries) {
        var href = encodeURI('https://public.cancerimagingarchive.net/nbia-download/servlet/DownloadServlet?userId=' +
            jnlpUserId + '&includeAnnotation=' + jnlpIncludeAnnotation +
            '&hasAnnotation=' + item.hasAnnotation + '&seriesUid=' +
            item.seriesUID + '&sopUids=' + sopUIDsList);
        console.log(href);
        dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Downloading').draw();

        // Set {downloadStatus: 1} i.e. mark as 'encountered'
        updateSeriesDownloadStatus(db, item.seriesUIDShort, 1, function () {
          fetchAndParseTar(db, item, href, jnlpPassword, function (errFetchAndParseTar) {
            if (!errFetchAndParseTar) {
              // On success, set {downloadStatus: 2} i.e. mark as 'complete'
              updateSeriesDownloadStatus(db, item.seriesUIDShort, 2, function () {
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Complete').draw();
                cbProcessSeries();
              });
            } else {
              // On error, set {downloadStatus: 0} i.e. mark the error for
              // series as 'not encountered' to try download again
              updateSeriesDownloadStatus(db, item.seriesUIDShort, 0, function () {
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data('0%').draw();
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Error').draw();
                cbProcessSeries();
              });
            }
          });
        });
      }
    ], function (err, result) { // eslint-disable-line handle-callback-err
      callbackItem();
    });
  }, function (errSeriesProcess) {
    db.tciaSchema.find({
      'type': 'seriesDetails',
      'downloadStatus': {$ne: 2}
    }).fetch(function (result) {
      // If downloadStatus for all the series is 0
      if (result.length === 0) {
        cbDownloadSeries(null);
      } else {
        // For all series with downloadStatus != 2, download them again
        console.log('Series download count ' + result.length);
        downloadSeries(db, result, jnlpUserId, jnlpPassword, jnlpIncludeAnnotation, function () {
          cbDownloadSeries(null);
        });
      }
    });
  });
};

/*
 * Takes jnlp arguments and initializes download of all the non-completed series
 * in DB. Sequentially runs two steps viz.,
 * Step1: updates rows in table on resuming application from a previous state
 * Step2: calls downloadSeries() to download the appropriate series
 * downloadStatus = 0/1/2, where
 * 0 => not encountered
 * 1 => encountered but not complete yet
 * 2 => completed
 */
var initDownloadMgr = function (jnlpUserId, jnlpPassword, jnlpIncludeAnnotation, cbInitDownloadMgr) {
  new IndexedDb({namespace: 'mydb'}, function (db) { // eslint-disable-line no-new
    db.addCollection('tciaSchema', function () {
      async.series([
        // Step1: Updating rows in DataTable
        function (cbStep1) {
          db.tciaSchema.find({
            'type': 'seriesDetails',
            'downloadStatus': {$ne: 0}
          }).fetch(function (result) {
            if (result.length) {
              output.innerHTML = 'Updating rows ...';
            }
            async.each(result, function (item, cbUpdateRow) {
              if (item.downloadStatus === 1) {
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data(Math.round(item.downloadedSize / item.size * 100) + '%').draw();
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Incomplete').draw();
              } else if (item.downloadStatus === 2) {
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 6).data('100%').draw();
                dTable.cell(dTable.row("[id='row_" + item.seriesUIDShort + "']").node(), 7).data('Complete').draw();
              }
              cbUpdateRow();
            }, function (errUpdateRow) {
              cbStep1(null, 'Updated all rows');
            });
          });
        },
        // Step2: download series with downloadStatus != 2
        function (cbStep2) {
          output.innerHTML = 'Download started ...';
          db.tciaSchema.find({
            'type': 'seriesDetails',
            'downloadStatus': {$ne: 2}
          }).fetch(function (result) {
            if (!result.length) {
              db.removeCollection('tciaSchema', function () {
                cbStep2(null, 'All series downloaded successfully');
              });
            } else {
              console.log('Series download count ' + result.length);
              downloadSeries(db, result, jnlpUserId, jnlpPassword, jnlpIncludeAnnotation, function () {
                db.removeCollection('tciaSchema', function () {
                  cbStep2(null, 'All series downloaded successfully');
                });
              });
            }
          });
        }
      ],
      function (err, results) { // eslint-disable-line handle-callback-err
        cbInitDownloadMgr();
      });
    });
  }, function (err) {
    console.log(err);
  });
};

// Standalone export variable to include all modules in 'app.js'
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

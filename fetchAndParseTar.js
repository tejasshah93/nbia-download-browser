// Required Node Packages
var http = require('http'),    
    https = require('https'),
    async = require('async'),
    tar = require('tar-stream'),
    minimongo = require("minimongo");
var IndexedDb = minimongo.IndexedDb;

var events = require('events');
var eventEmitter = new events.EventEmitter();

var saveManifest = require("./storeSchema");
var createFS = require("./createFolderHierarchy");

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
        'fsPath': doc.fsPath,
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
      cbFetchAndParseTar(null);
    });
  });

  req.on('error', function (e){
    console.log('problem with request: ' + e);
    cbFetchAndParseTar(e);
  });

  req.end();
}

/*
 * Creates the DB, Collection if not created and calls the main function
 */
var initDownloadMgr = function(jnlpUserId, jnlpPassword, jnlpIncludeAnnotation, cbInitFunction){
  new IndexedDb({namespace: "mydb"}, function(db) {
    db.addCollection("tciaSchema", function() {      
      db.tciaSchema.find({'type': "seriesDetails"}).fetch(function(result) {
        async.eachLimit(result, 3, function(item, callbackItem){
          var href = encodeURI('https://public.cancerimagingarchive.net/nbia-download/servlet/DownloadServlet?userId='
              + jnlpUserId + '&includeAnnotation=' + jnlpIncludeAnnotation +
              '&hasAnnotation=' + item.hasAnnotation + '&seriesUid=' +
              item.seriesUID + '&sopUids=');
          console.log(href);          
          fetchAndParseTar(db, item.seriesUIDShort, href, jnlpPassword, function(errFetchAndParseTar) {
            if(!errFetchAndParseTar) callbackItem();
            else callbackItem(errFetchAndParseTar);
          });
        }, function(errSeriesProcess){
          console.log("All series downloaded successfully");
          db.removeCollection("tciaSchema", function(){
            if(!errSeriesProcess) cbInitFunction(null);
            else cbInitFunction(err);
          });
        });
      });
    });
  }, function(err) {
    console.log(err);
    cbInitFunction(err);
  });
}

var bundle = {
  initDownloadMgr: initDownloadMgr,
  storeSchema: saveManifest.storeSchema,
  createFolderHierarchy: createFS.createFolderHierarchy
};

module.exports = bundle;

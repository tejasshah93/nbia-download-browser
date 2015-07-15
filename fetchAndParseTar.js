// Required Node Packages
var http = require('http'),
    https = require('https'),
    tar = require('tar-stream'),
    minimongo = require("minimongo");

var IndexedDb = minimongo.IndexedDb;

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
 * Fetch the tar from the 'href' passed and parse it on-the-fly
 */
var fetchAndParseTar = function(db, href, cbFetchAndParseTar){
  var url = parseURL(href);
  var options = {
    //host: 'proxy.iiit.ac.in',
    //port: 8080,
    protocol: url.protocol,
    host: url.host,
    path: url.pathname,
    method: 'GET',
    responseType: 'arraybuffer',  // set 'responseType' to 'arraybuffer' for the XHR response
    headers: {'password': ''}     // custom headers
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
      console.log("File found " + header.name + " of size ~" +
                  Math.round(header.size/1024) + " KB");
      var buffer = [];
      stream.on('data', function(data){
        buffer.push(data);
      });

      stream.on('end', function() {
        buffer = Buffer.concat(buffer);
        getSeriesUIDLocation(function(chosenEntry) {
          if (chosenEntry) {
            var blob = new Blob([buffer], {type: 'application/octet-binary'});
            downloadFile(chosenEntry, header.name, blob, 
                function(errDownloadFile) {
                  if(!errDownloadFile) {
                    buffer = [];
                    updateDB(db, header.name, function(errUpdateDB) {
                      if(!errUpdateDB) {
                        console.log("<< EOF >>");
                        callback();
                      }
                      //else cbFetchAndParseTar(errUpdateDB);
                    });
                  }
                  else cbFetchAndParseTar(errDownloadFile);                  
                });
          }
          else {
            cbFetchAndParseTar("Error: seriesUID not present in " +
                "chrome.storage.local");
          }
        });
      })
      //stream.resume();
    })

    .on('finish', function(){
      console.log("All files in the tar downloaded successfully! :)");
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
var initFunction = function(href, cbInitFunction){
  db = new IndexedDb({namespace: "mydb"}, function() {
    db.addCollection("tcia", function() {
      fetchAndParseTar(db, href, function(errFetchAndParseTar) {
        if(!errFetchAndParseTar) cbInitFunction(null);
        else cbInitFunction(errFetchAndParseTar);
      });
    });
  }, function(err) { console.log(err); });
}

module.exports = initFunction; // export the module for browserify

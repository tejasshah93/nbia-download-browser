// Required Node Packages
var http = require('http'),
    https = require('https'),
    tar = require('tar-stream');

/*
 * Get URL contents viz., hostname, pathname, hash, etc
 */
var getLocation = function(href) {
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
 * Fetch the tar from the 'href' passed and parse it on the fly
 */
var fetchAndParseTar = function(href, callbackGETRequest){
  var url = getLocation(href); 
  // Setting the GET request
  var options = {
    //host: 'proxy.iiit.ac.in',
    //port: 8080,
    host: url.host,
    path: url.pathname,
    method: 'GET',
    responseType: 'arraybuffer',  // set 'responseType' to 'arraybuffer' for the XHR response
    headers: {'password': ''}     // custom headers 
  };

  var reqComplete = false;
  // Toggle 'req' definition according to network requirements:
  // Without Proxy
  // var req = https.request(options.path, function (res){
  // Under Proxy
  var req = http.request(options, function(res){
    var tarParser = tar.extract();
    
    res.on('data', function (chunk) {
      tarParser.write(new Buffer(chunk));   // Transforming the 'arraybuffer' to 'Buffer' for compatibility with the Stream API
    });
    
    res.on('end', tarParser.end.bind(tarParser));
    
    res.on('error', function (error) {
      console.log(error);
    });

    // For each file entry, do the following
    tarParser.on('entry', function(header, stream, callback) {
      console.log("File found " + header.name + " of size ~" + Math.round(header.size/1024) + " KB");
      stream.on('end', function() {
        console.log("<< EOF >>");
        callback();
      })
      stream.resume();
    })

    .on('finish', function(){
      console.log("All files in the tar parsed successfully! :)");
    });
  });

  req.on('error', function (e){
    console.log('problem with request: ' + e);
  });

  req.end();
}

/*  For running the code directly with node

//href = encodeURI('https://public.cancerimagingarchive.net/nbia-download/servlet/DownloadServlet?userId=nbia_guest&includeAnnotation=true&hasAnnotation=true&seriesUid=1.3.6.1.4.1.14519.5.2.1.6279.6001.465203542815096670421396392391&sopUids=');
href = encodeURI('http://localhost/gsoc15/tarstream');
fetchAndParseTar(href, function (data){
  if(data){
    console.log("Fetched and parsed all the files");
  }
  else{
    console.log("Error in fetching");
  }
});

*/
module.exports = fetchAndParseTar; // export the module for browserify

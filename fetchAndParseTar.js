// Required Node Packages
var fs = require('fs'),
    http = require('http'),
    https = require('https'),
    tar = require('tar'),
    path = require('path'),
    stream = require('stream');

var get = function(setPath, callbackGETRequest){
  // Setting the GET request
  var options = {
    host: 'proxy.iiit.ac.in',
    port: 8080,
    path: setPath,
    method: 'GET',
    // Custom headers required
    headers: {'password': ''}
  };

  console.log(options.path);
  // Toggle 'req' definition according to network requirements:
  // Without Proxy
  // var req = https.request(options.path, function (res){
  // Under Proxy
  var req = http.request(options, function(res){
    var data = [], dataLen = 0;
    var chunkCtr = 0;
    var wstream = fs.createWriteStream('tarstream');
    res.setEncoding('utf8');
    res.on('data', function (chunk) {
      console.log(chunkCtr++);
      wstream.write(chunk);
      data.push(chunk);
      dataLen += chunk.length;
    });

    res.on('end',function(){
      if(chunkCtr){
        console.log("Chunks merged successfully");
        wstream.on('finish', function () {
          console.log('File has been written');
        });
        wstream.end();

        /* Copy data into a buffer for faster processing
           var buf = new Buffer(dataLen);
           for (var i=0,len=data.length,pos=0; i<len; i++) {
           data[i].copy(buf, pos);
           pos += data[i].length;
           }*/

        callbackGETRequest(data);
      }
      else
        callbackGETRequest(null);
    });
  });

  req.on('error', function (e){
    console.log('problem with request: ' + e);
  });

  req.end();
}

setPath = encodeURI('https://public.cancerimagingarchive.net/nbia-download/servlet/DownloadServlet?userId=nbia_guest&includeAnnotation=true&hasAnnotation=true&seriesUid=1.3.6.1.4.1.14519.5.2.1.6279.6001.465203542815096670421396392391&sopUids=');
get(setPath, function (data){
  if(data){
    console.log("Got data from cb");
    var rs = new stream.Readable({ objectMode: true });
    fs.readFile(__dirname + '/tarstream', function(err, tarball){
      var count = 0;
      rs.push(tarball);
      rs.push(null);
      rs
        .pipe(tar.Parse())
        .on('entry', function(entry) {
          console.log("Found a file");

          entry.on('end', function() {
            //entry.pause();
          }).pipe(fs.createWriteStream(entry.path));

          /* Without piping the content directly into respective files
             entry.on("data", function (c){
             console.log(c)
             })
             entry.on("end", function (){
             console.error("  <<<EOF");
             })*/
        })

      .on('end', function(){
        console.log("End");
        process.exit();
      })

      .on('error', function(error){
        this.emit("end");
      })
    });
  }
  else{
    console.log("Error in fetching");
  }
});

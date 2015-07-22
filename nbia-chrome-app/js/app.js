/*var manifest = "LIDC-IDRI|LIDC-IDRI-0018|1.3.6.1.4.1.14519.5.2.1.6279.6001.232707938322315602970938283659|1.3.6.1.4.1.14519.5.2.1.6279.6001.465203542815096670421396392391|Yes|2|14044920|8673|http://localhost:21080/wsrf/services/cagrid/NCIACoreService|TCIA production 1|true";
manifest = manifest.split("|");
var collection = manifest[0],
    patientID = manifest[1],
    studyUID = manifest[2].split(".").pop().slice(-8),
    seriesUID = manifest[3].split(".").pop().slice(-8);*/

var downloadManifestButton = document.querySelector('#downloadManifest');
var chooseDirButton = document.querySelector('#chooseDirectory');
var saveFileButton = document.querySelector('#save');
var output = document.querySelector('#output');
var jnlpURL;

var errorHandler = function(e) {
  console.error(e);
}

/*
 * Writes content of the blob to the writableEntry
 */
var writeFileEntry = function(writableEntry, blob, cbWriteFileEntry) {
  if (!writableEntry) {
    cbWriteFileEntry("Not a valid writableEntry");
  }

  writableEntry.createWriter(function(writer) {
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
 * Fetches and returns the seriesUID folder location from Chrome local storage
 */
var getSeriesUIDLocation = function(cbGetSeriesUIDLocation) {
  chrome.storage.local.get('seriesUID', function(items) {
    if (items.seriesUID) {
      chrome.fileSystem.isRestorable(items.seriesUID, function(IsRestorable) {
        chrome.fileSystem.restoreEntry(items.seriesUID, function(chosenEntry) {
          cbGetSeriesUIDLocation(chosenEntry);
        });
      });
    }
    else cbGetSeriesUIDLocation(null);
  });
}

/*
 * Writes files to the chosenEntry (seriesUID) directory
 */
var downloadFile = function(chosenEntry, headerName, blob, cbDownloadFile) {
  chrome.fileSystem.getWritableEntry(chosenEntry, function(writableEntry) {
    writableEntry.getFile(headerName, {create:true}, function(writableEntry) {
      writeFileEntry(writableEntry, blob, function(errWriteFileEntry) {
        if(!errWriteFileEntry) {
          console.log("File downloaded " + headerName);
          cbDownloadFile(null);
        }
        else cbDownloadFile(errWriteFileEntry);
      });
    });
  });
}

var updateDB = function(db, headerName, cbUpdateDB) {
  // Always use upsert for both inserts and modifies
  db.tcia.upsert({
    _id: headerName,
  }, function(err, res) {
    cbUpdateDB(null);
  });
}

var downloadManifestSchema = function(cbDownloadManifestSchema) {
  var x = new XMLHttpRequest();
  var manifestUrl = "http://researchweb.iiit.ac.in/~tejas.shah/gsoc15/manifest.txt";
  //var manifestUrl = jnlpDownloadServerUrl + "?serverjnlpfileloc=" + jnlpArgument;
  console.log(jnlpDownloadServerUrl + "?serverjnlpfileloc=" + jnlpArgument);
  //console.log(manifestUrl);
  x.open("GET", manifestUrl, true);
  x.onreadystatechange = function() {
    if (x.readyState == 4 && x.status == 200) {
      console.log(x.responseText);
      // ToDo Consider multiple entries in manifest. Currently for single entry.
      manifest = x.responseText.split("|");
      collection = manifest[0];
      patientID = manifest[1];
      studyUID = manifest[2].split(".").pop().slice(-8);
      seriesUID = manifest[3].split(".").pop().slice(-8);
      cbDownloadManifestSchema();
    }
  }
  x.send(null);
}

downloadManifestButton.addEventListener('click', function(e) {
  var x = new XMLHttpRequest();
  x.open("GET", jnlpURL, true);
  x.onreadystatechange = function() {
    if (x.readyState == 4 && x.status == 200) {
      var doc = x.responseText;
      if (window.DOMParser) {
        parser = new DOMParser();
        xmlDoc = parser.parseFromString(doc,"text/xml");        
      }
      else {
        alert("Error: window.DOMParser not supported");
      }     
      jnlpArgument = xmlDoc.getElementsByTagName("argument")[0].childNodes[0].nodeValue;
      var properties = xmlDoc.getElementsByTagName('property');
      for(var i = 0; i < properties.length; i++) {
        if (properties[i].getAttribute('name') == "jnlp.includeAnnotation")
          jnlpIncludeAnnotation = true;
        else if (properties[i].getAttribute('name') == "jnlp.userId")
          jnlpUserId = properties[i].getAttribute('value');
        else if (properties[i].getAttribute('name') == "jnlp.password")
          jnlpPassword = properties[i].getAttribute('value');
        else if (properties[i].getAttribute('name') == "jnlp.downloadServerUrl")
          jnlpDownloadServerUrl = properties[i].getAttribute('value');
      }
      downloadManifestSchema(function() {
        console.log(collection);
        console.log(patientID);
        console.log(studyUID);
        console.log(seriesUID);
        chooseDirButton.disabled = false;
      });
    }
  }
  x.send(null);
});

/*
 * OnClick "Choose Directory": stores the directory path, creates consequent
 * directories within the same folder for collection, patientID, etc. and sets
 * the appropriate entries in Chrome local storage as per the manifest.
 */
chooseDirButton.addEventListener('click', function(e) {
  chrome.fileSystem.chooseEntry({type: 'openDirectory'}, function(theEntry) {
    if (!theEntry) {
      document.querySelector('#file_path').value = null;
      output.textContent = 'No Directory selected.';
      saveFileButton.disabled = true;
      return;
    }
    document.querySelector('#file_path').value = theEntry.fullPath;
    output.textContent = '';
    saveFileButton.disabled = false;
    // use local storage to retain access to this file
    chrome.storage.local.set({'chosenDir': chrome.fileSystem.retainEntry(theEntry)});
    chrome.fileSystem.getWritableEntry(theEntry, function(entry) {
      entry.getDirectory(collection, {create:true}, function(entry) {
        chrome.storage.local.set({'collection': chrome.fileSystem.retainEntry(entry)});
        entry.getDirectory(patientID, {create:true}, function(entry) {
          chrome.storage.local.set({'patientID': chrome.fileSystem.retainEntry(entry)});
          entry.getDirectory(studyUID, {create:true}, function(entry) {
            chrome.storage.local.set({'studyUID': chrome.fileSystem.retainEntry(entry)});
            entry.getDirectory(seriesUID, {create:true}, function(entry) {
              chrome.storage.local.set({'seriesUID': chrome.fileSystem.retainEntry(entry)});
            });
          });
        });
      });
    });
  });
});

/*
 * OnClick: "Download files": Downloads the tar file(s) from the server, parses
 * it, gets the previously stored folder paths from Chrome local storage and
 * calls functions to save files to the client's file system
 */
saveFileButton.addEventListener('click', function(e) {
  output.innerHTML = "";
  var downloadURL = encodeURI('http://researchweb.iiit.ac.in/~tejas.shah/gsoc15/tarstream');
  initFunction(downloadURL, function(errInitFunction) {
    if (!errInitFunction) {
      output.innerHTML += "All files downloaded successfully to selected " +
        "location!<br/>";
    }
    else output.innerHTML += errInitFunction;
  });
});

/* launchData object attributes
console.log(launchData);
console.log(launchData.id);
console.log(launchData.url);
console.log(launchData.referrerUrl);
*/

$(document).ready(function() {
  console.log("Chrome Application loaded. Request JNLP URL");
  chrome.runtime.sendMessage({appLoad: "true"}, function(response) {});
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.jnlpURL){
    console.log("onMessage received JNLP URL in app.js");
    console.log("message.jnlpURL: " + message.jnlpURL);
    jnlpURL = message.jnlpURL;
    downloadManifestButton.disabled = false;
    sendResponse({ack: "true"});
  }
});

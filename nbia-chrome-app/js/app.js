var manifest = "LIDC-IDRI|LIDC-IDRI-0018|1.3.6.1.4.1.14519.5.2.1.6279.6001.232707938322315602970938283659|1.3.6.1.4.1.14519.5.2.1.6279.6001.465203542815096670421396392391|Yes|2|14044920|8673|http://localhost:21080/wsrf/services/cagrid/NCIACoreService|TCIA production 1|true";
manifest = manifest.split("|");
var collection = manifest[0],
    patientID = manifest[1],
    studyUID = manifest[2].split(".").pop().slice(-8),
    seriesUID = manifest[3].split(".").pop().slice(-8);

var chosenEntry = null;
var chooseDirButton = document.querySelector('#chooseDirectory');
var saveFileButton = document.querySelector('#save');
var output = document.querySelector('#output');

var errorHandler = function(e) {
  console.error(e);
}

/*
 * Writes the content of the blob to writableEntry
 */
var writeFileEntry = function(writableEntry, blob, callback) {
  if (!writableEntry) {
    output.textContent = 'Error';
    return;
  }

  writableEntry.createWriter(function(writer) {
    writer.onerror = errorHandler;
    writer.onwriteend = function(){
      writer.onwriteend = function(e){
        callback();
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
 * IO helper Function to validate write operation
 */
var waitForIO = function (writer, callback) {
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
      callback();
    }
  };
  setTimeout(reentrant, 100);
}

var asyncLoop = function(o){
  var i = -1,
  length = o.length;
  
  var loop = function(){
    i++;
    if(i == length){
      o.callback();
      return;
    }
    o.functionToLoop(loop, i);
  } 
  loop();
}

/*
 * Writes files to the chosenEntry directory and updates its status on the App
 */
var downloadFiles = function(chosenEntry) {
  chrome.fileSystem.getWritableEntry(chosenEntry, function(writableEntry) {
    output.innerHTML = "";
    loopCtr = 4;
    asyncLoop({
      length : loopCtr,
      functionToLoop : function(loop, i){
        setTimeout(function(){
          var fileName = "file" + (i+1) + ".txt"; 
          writableEntry.getFile(fileName, {create:true}, function(writableEntry) {
            var blob = new Blob(['Lorem ' + (i+1) + '\n'], {type: 'text/plain'});
            writeFileEntry(writableEntry, blob, function(e) {
              output.innerHTML = "Downloaded " + (i+1) + "/" + loopCtr  + "<br/>";
              loop();
            });
          });
        },1000);
      },
      callback : function(){
        console.log("All done");
        output.innerHTML += "All files downloaded successfully!<br/>";
      }    
    });
  });
}

/*
 * On Click "Choose Directory": stores the directory path, creates consequent
 * directories within for collection, patientID, etc. and sets the appropriate
 * entries in Chrome local storage as per the manifest.
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
 * On Click: "Download files":  Gets the previously stored folder paths from
 * Chrome local storage and calls functions to save files to the client's
 * file system
 */
saveFileButton.addEventListener('click', function(e) {
  chrome.storage.local.get('seriesUID', function(items) {
    if (items.seriesUID) {
      chrome.fileSystem.isRestorable(items.seriesUID, function(IsRestorable) {
        console.log("Restoring " + items.seriesUID);
        chrome.fileSystem.restoreEntry(items.seriesUID, function(chosenEntry) {
          if (chosenEntry) {
            downloadFiles(chosenEntry);
          }
        });
      });
    }
    else {
      output.innerHTML = "Error: seriesUID not present in chrome.storage.local";
    }
  });
});

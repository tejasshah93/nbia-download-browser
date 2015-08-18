var chooseDirButton = document.querySelector('#chooseDirectory');
var saveFileButton = document.querySelector('#save');
var output = document.querySelector('#output');
var saveChooseDirEntry, manifestSchema;
var restoreStateSchema, restoreStateFolder;

var errorHandler = function(e) {
  console.error(e);
}

var asyncLoop = function(o) {
  var i = -1, 
  length = o.length;

  var loop = function() {
    i++;
    if (i == length) {
      o.callback();
      return;
    }
    o.functionToLoop(loop, i);
  } 
  loop();
}

var displayManifestSchema = function(manifestSchema, cbDisplayManifestSchema) {
  var appendArray = [];
  asyncLoop({
    length : manifestSchema.length,
    functionToLoop : function(loop, i) {
      var manifest_i = manifestSchema[i].split("|");
      var localArray = [manifest_i[0], manifest_i[1], manifest_i[2],
      manifest_i[3], Math.round(
          ((parseInt(manifest_i[6]) + parseInt(manifest_i[7])*1.0)
           /1024/1024)*100)/100, manifest_i[5], "0%", "Not Started"];
      appendArray.push(localArray);
      loop();
    },
    callback : function() {
      $('#displaySchema').DataTable().rows.add(appendArray).draw();
      appendArray = [];
      cbDisplayManifestSchema(null);
    } 
  });
}

/*
 *  Downloads the manifest schema with using arguments from the JNLP file.
 */
var downloadManifestSchema = function(cbDownloadManifestSchema) {
  var x = new XMLHttpRequest();
  var manifestUrl = jnlpDownloadServerUrl + "?serverjnlpfileloc=" + jnlpArgument;
  console.log("manifest URL: " + manifestUrl);
  x.open("GET", manifestUrl, true);
  x.onreadystatechange = function() {
    if (x.readyState == 4 && x.status == 200) {
      console.log(x.responseText);
      manifestSchema = x.responseText.trim().split("\n");
      displayManifestSchema(manifestSchema, function() {
        cbDownloadManifestSchema();
      });
    }
  }
  x.send(null);
}

var getPreviousState = function() {
  bundle.restoreState(function(result) {
    if(!result.storeSchemaFlag && !result.createFolderHierarchyFlag) {
      output.innerHTML = "No previous download state found";
      restoreStateSchema = false;
      restoreStateFolder = false;
      chooseDirButton.disabled = false;
    }
    else if(result.storeSchemaFlag && !result.createFolderHierarchyFlag) {
      chooseDirButton.disabled = false;
      restoreStateSchema = true;
      restoreStateFolder = false;
    }
    else if(result.storeSchemaFlag && result.createFolderHierarchyFlag) {
      restoreStateSchema = true;
      restoreStateFolder = true;
      bundle.execute(restoreStateSchema, restoreStateFolder, null,
          function(errExecute) {
            console.log("All files downloaded successfully to selected folder");
            output.innerHTML = "Download completed successfully";
          });
    }
  });
}

var bootJnlp = function(messageJnlpURL) {
  bundle.fetchJnlp(messageJnlpURL, function(errFetchJnlp, fetchJnlpURL) {
    if(errFetchJnlp) {
      output.innerHTML = "<br/>Error: JNLP URL Not found <br/><br/>Retry triggering "
        + "the application from public.cancerimagingarchive.net";
    }
    else {
      jnlpURL = fetchJnlpURL;
      var x = new XMLHttpRequest();
      x.open("GET", jnlpURL, true);
      x.onreadystatechange = function() {
        if(x.readyState == 4 && x.status == 200) {
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
            getPreviousState();
          });
        }
        else if(x.status >= 500) {
          output.innerHTML = "<br/>Error downloading JNLP<br/><br/>Restart Application "
        }
      }
      x.send(null);
    }
  });
}

/*
 * OnClick "Choose Directory": stores the directory path, creates consequent
 * directories within the same folder for collection, patientID, etc. and sets
 * the appropriate entries in Chrome local storage as per the manifest.
 */
chooseDirButton.addEventListener('click', function(e) {
  chrome.fileSystem.chooseEntry({type: 'openDirectory'}, function(theEntry) {
    if (!theEntry) {
      document.querySelector('#file_path').value = null;
      output.innerText = 'No Directory selected';
      saveFileButton.disabled = true;
      saveChooseDirEntry = null;
      return;
    }
    saveChooseDirEntry = theEntry;
    document.querySelector('#file_path').value = theEntry.fullPath;
    output.innerHTML = '';
    saveFileButton.disabled = false;
  });
});

/*
 * OnClick: "Download Files": Downloads the tar file(s) from the server, parses
 * it, gets the previously stored folder paths from Chrome local storage and
 * calls functions to save files to the client's file system
 */
saveFileButton.addEventListener('click', function(e) {
  bundle.execute(restoreStateSchema, restoreStateFolder, saveChooseDirEntry,
      function(errExecute) {
        console.log("All files downloaded successfully to selected folder");
        output.innerHTML = "Download completed successfully";
      });
});

// launchData object attributes: id, url, referrerUrl

/*
 * OnLoad Chrome App, send a message to background.js requesting JNLP URL
 */
$(document).ready(function() {
  console.log("Chrome Application loaded. Request JNLP URL");
  chrome.runtime.sendMessage({appLoad: "true"}, function(response) {});
  dTable = $('#displaySchema').DataTable({
    "scrollY": "400px",
    "scrollCollapse": true,
    "lengthMenu": [[10, 25, 50, -1], [10, 25, 50, "All"]],
    "iDisplayLength": -1,
    "autoWidth": true,
    "processing": true,
    "columnDefs": [{
      "targets": [0, 1, 2, 3, 4, 5, 6, 7],
      "render": function ( data, type, full, meta ) {
        return type === 'display' && data.length > 17 ?
          '<span title="'+data+'">'+data.substr( 0, 15 )+'...</span>' :
          data;
      }
    }],
    "fnRowCallback": function (nRow, aData) {
      $(nRow).attr("id", "row_" + aData[3].slice(-8));
    }
  });
});

/*
 * Receving end for JNLP URL message from background.js
 */
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log("onMessage: jnlp URL " + message.jnlpURL);
  if(message.jnlpURL) {
    output.innerHTML = "Populating table ...";
  }
  else {
    output.innerHTML = "Attempting to restore previous state ...";
  }
  bootJnlp(message.jnlpURL);
  sendResponse({ack: "true"});
});

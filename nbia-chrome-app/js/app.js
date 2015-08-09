var downloadManifestButton = document.querySelector('#downloadManifest');
var chooseDirButton = document.querySelector('#chooseDirectory');
var saveFileButton = document.querySelector('#save');
var output = document.querySelector('#output');
var log = document.querySelector('#log');

(function () {
  var old = console.log;
  var logger = document.getElementById('log');
  console.log = function (message) {
    logger.innerText += message + '\n';
  }
})();

var errorHandler = function(e) {
  console.error(e);
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
      var schema = x.responseText.trim().split("\n");
      bundle.storeSchema(schema, function(errStoreSchema) {
        cbDownloadManifestSchema();
      });
    }
  }
  x.send(null);
}

/*
 * Fetches and parses the JNLP from the URL passed and calls
 * downloadManifestSchema for fetching and parsing the manifest
 */
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
      output.innerText = 'No Directory selected.';
      saveFileButton.disabled = true;
      return;
    }
    document.querySelector('#file_path').value = theEntry.fullPath;
    output.innerText = '';
    bundle.createFolderHierarchy(theEntry, function() {
      console.log("Folder hierarchy created successfully");
      saveFileButton.disabled = false;
    });
  });
});

/*
 * OnClick: "Download files": Downloads the tar file(s) from the server, parses
 * it, gets the previously stored folder paths from Chrome local storage and
 * calls functions to save files to the client's file system
 */
saveFileButton.addEventListener('click', function(e) {
  output.innerText = "";
  bundle.initDownloadMgr(jnlpUserId, jnlpPassword, jnlpIncludeAnnotation,
      function(errInitFunction) {
        if (!errInitFunction) {
          console.log("All files downloaded successfully to selected folder!");
        }
        else console.log(errInitFunction);
      });
});

// launchData object attributes: id, url, referrerUrl

/*
 * OnLoad Chrome App, send a message to background.js requesting JNLP URL
 */
$(document).ready(function() {
  console.log("Chrome Application loaded. Request JNLP URL");
  chrome.runtime.sendMessage({appLoad: "true"}, function(response) {});
});

/*
 * Receving end for JNLP URL message from background.js
 */
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.jnlpURL) {
    console.log("onMessage: jnlp URL " + message.jnlpURL);
    jnlpURL = message.jnlpURL;
    downloadManifestButton.disabled = false;
    sendResponse({ack: "true"});
  }
});

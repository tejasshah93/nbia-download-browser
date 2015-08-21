var output = document.querySelector('#output');
var saveFileButton = document.querySelector('#save');
var chooseDirButton = document.querySelector('#chooseDirectory');
var removeSeriesButton = document.querySelector('#rmSelectedSeries');
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
    if(i == length) {
      o.callback();
      return;
    }
    o.functionToLoop(loop, i);
  } 
  loop();
}

/*
 * Displays the downloaded manifest schema as DataTable
 */
var displayManifestSchema = function(manifestSchema, cbDisplayManifestSchema) {
  var appendArray = [];
  asyncLoop({
    length : manifestSchema.length,
    functionToLoop : function(loop, i) {
      // For each manifest entry, push it's required fields in appendArray
      var manifest_i = manifestSchema[i].split("|");
      var localArray = [manifest_i[0], manifest_i[1], manifest_i[2],
      manifest_i[3], Math.round(
          ((parseInt(manifest_i[6]) + parseInt(manifest_i[7])*1.0)
           /1024/1024)*100)/100, manifest_i[5], "0%", "Not Started"];
      appendArray.push(localArray);
      loop();
    },
    callback : function() {
      // Draw all the rows at once (minimize loading time)
      dTable.rows.add(appendArray).draw();
      appendArray = [];
      cbDisplayManifestSchema(null);
    } 
  });
}

/*
 *  Downloads the manifest schema using argument from the Jnlp file and calls 
 *  displayManifestSchema() to display the manifest entries in DataTable 
 */
var downloadManifestSchema = function(cbDownloadManifestSchema) {
  var x = new XMLHttpRequest();
  var manifestUrl = jnlpDownloadServerUrl +"?serverjnlpfileloc="+ jnlpArgument;
  console.log("manifest URL: " + manifestUrl);
  x.open("GET", manifestUrl, true);
  x.onreadystatechange = function() {
    if(x.readyState == 4 && x.status == 200) {
      console.log(x.responseText);
      manifestSchema = x.responseText.trim().split("\n");
      displayManifestSchema(manifestSchema, function() {
        cbDownloadManifestSchema();
      });
    }
    else if(x.status != 200) {
      output.innerHTML = "<br/>Error downloading manifest<br/><br/>" +
                         "Restart Application";
    }
  }
  x.send(null);
}

/*
 * Calls restoreState() to verify if schema is stored in DB and whether folder
 * hierarchy has been created within the user's filesystem
 */
var getPreviousState = function() {
  bundle.restoreState(function(result) {
    if(!result.storeSchemaFlag && !result.createFolderHierarchyFlag) {
      output.innerHTML = "No previous download state found";
      restoreStateSchema = false;
      restoreStateFolder = false;
      chooseDirButton.disabled = false;
      removeSeriesButton.disabled = false;
    }
    else if(result.storeSchemaFlag && !result.createFolderHierarchyFlag) {
      chooseDirButton.disabled = false;
      restoreStateSchema = true;
      restoreStateFolder = false;
    }
    // if both flags are set, resume execution
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

/*
 * Function to load and parse Jnlp file
 * fetchJnlp() checks whether Jnlp URL has been passed explicitly i.e. from web
 * page or if it exists within DB already and returns the Jnlp URL
 */
var bootJnlp = function(messageJnlpURL) {
  bundle.fetchJnlp(launchData, messageJnlpURL, function(errFetchJnlp, fetchJnlpURL) {
    if(errFetchJnlp) {
      output.innerHTML = "<br/>Error: JNLP URL Not found <br/><br/>" + 
                         "Retry triggering the application from " +
                         "public.cancerimagingarchive.net";
    }
    else {
      // Ajax request for fetching the Jnlp file
      jnlpURL = fetchJnlpURL;
      var x = new XMLHttpRequest();
      x.open("GET", jnlpURL, true);
      x.onreadystatechange = function() {
        if(x.readyState == 4 && x.status == 200) {
          // On retrieving Jnlp file, parse it
          var doc = x.responseText;          
          if(window.DOMParser) {
            parser = new DOMParser();
            xmlDoc = parser.parseFromString(doc,"text/xml");
          }
          else {
            alert("Error: window.DOMParser not supported");
          }
          jnlpArgument = xmlDoc.getElementsByTagName("argument")[0].childNodes[0].nodeValue;
          var properties = xmlDoc.getElementsByTagName('property');
          for(var i = 0; i < properties.length; i++) {
            if(properties[i].getAttribute('name') == "jnlp.includeAnnotation")
              jnlpIncludeAnnotation = true;
            else if(properties[i].getAttribute('name') == "jnlp.userId")
              jnlpUserId = properties[i].getAttribute('value');
            else if(properties[i].getAttribute('name') == "jnlp.password")
              jnlpPassword = properties[i].getAttribute('value');
            else if(properties[i].getAttribute('name') == "jnlp.downloadServerUrl")
              jnlpDownloadServerUrl = properties[i].getAttribute('value');
          }
          // Using these Jnlp arguments, download the manifest
          downloadManifestSchema(function() {
            getPreviousState();
          });
        }
        else if(x.status != 200) {
          output.innerHTML = "<br/>Error downloading JNLP<br/><br/>" + 
                             "Restart Application";
        }
      }
      x.send(null);
    }
  });
}

/*
 * OnClick "Choose Directory":
 * Stores the directory path in DB, creates respective directories within chosen
 * folder viz., collection, patientID, studyUID, seriesUID
 */
chooseDirButton.addEventListener('click', function(e) {
  chrome.fileSystem.chooseEntry({type: 'openDirectory'}, function(theEntry) {
    // If user cancels the choose directory prompt
    if(!theEntry) {
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
 * OnClick: "Download Files":
 * Initiates execution of downloading the manifest entries and saving the files
 * to appropriate directory
 */
saveFileButton.addEventListener('click', function(e) {
  removeSeriesButton.disabled = true;
  bundle.execute(restoreStateSchema, restoreStateFolder, saveChooseDirEntry,
      function(errExecute) {
        console.log("All files downloaded successfully to selected folder");
        output.innerHTML = "Download completed successfully";
      });
});

/*
 * onLoad Chrome Application:
 * Initialize DataTable with required parameters and send message to
 * 'background.js' requesting jnlpURL
 */
$(document).ready(function() {
  console.log("Chrome Application loaded. Request JNLP URL");
  dTable = $('#displaySchema').DataTable({
    "order": [[ 7, "asc" ]],
    "select": true,
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
  chrome.runtime.sendMessage({appLoad: "true"}, function(response) {});
});

// Toggle '.selected' class on clicking a row
$('#displaySchema tbody').on('click', 'tr', function() {
  $(this).toggleClass('selected');
});

/*
 * onClick "Remove Series":
 * Update list of removed series in DB and delete selected rows from DataTable
 */
removeSeriesButton.addEventListener('click', function(e) {
  bundle.updateRows(dTable.rows('.selected').nodes(), function() {
    dTable.rows('.selected').remove().draw();
  });
});

/*
 * onMessage listener:
 * On receiving message from 'background.js' with jnlpURL, initiate populating
 * the DataTable by calling bootJnlp()
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

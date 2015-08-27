// Required Node Packages
var async = require('async');

/*
 * Takes restoreStateSchema, restoreStateFolder as arguments for processing
 * states accordingly. Execution steps include storeSchema,
 * createFolderHierarchy, initDownloadMgr
 */
var execute = function(restoreStateSchema, restoreStateFolder, saveChooseDirEntry, cbExecute) {
  async.series({
    // Stores schema if not previously stored
    storeSchema: function(callback) {
      console.log("execute.storeSchema ..");
      if(!restoreStateSchema) {
        console.log("Saving Manifest Schema ..");
        output.innerHTML = "Initializing database ... (May take upto 5 minutes for huge downloads)";
        bundle.storeSchema(manifestSchema, function(errStoreSchema) {
          callback(errStoreSchema, null);
        });
      }
      else {
        callback(null, null);
      }
    },
    // Creates folder hierarchy if not previously created
    createFolderHierarchy: function(callback) {
      console.log("execute.createFolderHierarchy ..");
      if(!restoreStateFolder) {
        console.log("Creating Folder hierarchy ...");
        if(restoreStateSchema) {
          output.innerHTML = "Database initialized already. Creating folders ...";
        }
        else if(!restoreStateSchema) {
          output.innerHTML = "Creating folders ...";
        }
        bundle.createFolderHierarchy(saveChooseDirEntry, function() {
          console.log("Folder hierarchy created successfully");
          callback(null, null);
        });
      }    
      else {
        callback(null, null);
      }
    },
    // Summons initDownloadMgr() with required Jnlp arguments
    initDownloadMgr: function(callback) {
      console.log("execute.initDownloadMgr ..");
      if(!restoreStateSchema && !restoreStateFolder) {
        output.innerHTML = "Download started ...";
      }
      bundle.initDownloadMgr(jnlpUserId, jnlpPassword, jnlpIncludeAnnotation,
          function(errInitFunction) {
            if (!errInitFunction) {
              callback(errInitFunction, null);
            }
          });
    }
  },
  function(err, results) {
    cbExecute(err);
  });
}

module.exports.execute = execute;

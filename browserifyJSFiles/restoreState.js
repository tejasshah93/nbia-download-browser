// Required Node Packages
var async = require('async');
var minimongo = require('minimongo');

var IndexedDb = minimongo.IndexedDb;

/*
 * Executes deleteRemovedSeries, storeSchemaFlag, createFolderHierarchyFlag
 */
var restoreState = function(cbRestoreState) {
  new IndexedDb({namespace: "mydb"}, function(db) {
    db.addCollection("tciaSchema", function() {
      async.parallel( {
        // Adds 'toRemove' class to seriesArray elements and deletes them
        deleteRemovedSeries: function(callback) {
          db.tciaSchema.findOne({'_id': "removedSeries"}, {}, function(doc) {
            if(doc && doc.seriesArray.length) {
              async.each(doc.seriesArray, function(item, cbItem){
                $("[id='row_"+item + "']").addClass("toRemove");
                cbItem();
              }, function(err) {
                dTable.rows('.toRemove').remove().draw();
                callback(null, null);
              });
            }            
            else callback(null, null);
          });
        },
        // returns storeSchemaFlag if schemaExist
        storeSchemaFlag: function(callback) {
          db.tciaSchema.findOne({'_id': "storeSchemaInfo"}, {}, function(schemaExist) {
            if(!schemaExist) {
              callback(null, 0);
            }
            else {
              callback(null, 1);
            }
          });
        },
        // returns createFolderHierarchyFlag if folderHierarchyExist
        createFolderHierarchyFlag: function(callback) {
          db.tciaSchema.findOne({'_id': "createFolderHierarchyInfo"}, {}, function(folderHierarchyExist) {
            if(!folderHierarchyExist) {              
              callback(null, 0);
            }
            else {
              callback(null, 1);
            }
          });
        }
      },
      function(err, results) {
        // results: {storeSchemaFlag: 0/1, createFolderHierarchyFlag: 0/1}
        cbRestoreState(results);
      });
    }, function(err) {
      console.log(err);
    });
  });
}

module.exports.restoreState = restoreState;

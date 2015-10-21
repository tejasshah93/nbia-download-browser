// Required Node Packages
var minimongo = require('minimongo');

var IndexedDb = minimongo.IndexedDb;

/*
 * Checks if application has been invoked from web page or explicitly by user.
 * If its from the wep page i.e. launchData.referrerUrl is true, remove previous
 * collection from DB to initiate new download else just return Jnlp URL
 */
var fetchJnlp = function(launchData, jnlpURL, cbFetchJnlp) {
  new IndexedDb({namespace: "mydb"}, function(db) {
    if(launchData.source === "url_handler") {
      db.removeCollection("tciaSchema", function(){
        db.addCollection("tciaSchema", function() {
          db.tciaSchema.upsert({
            '_id': "jnlpInfo",
            'jnlpURL': jnlpURL
          }, function() {
            cbFetchJnlp(null, jnlpURL);
          });
        });
      });
    }
    else {
      db.addCollection("tciaSchema", function() {
        db.tciaSchema.findOne({'_id': "jnlpInfo"}, {}, function(jnlpExist) {
          if(jnlpExist) {
            cbFetchJnlp(null, jnlpExist.jnlpURL);
          }
          else {
            cbFetchJnlp("Error", null);
          }
        });
      });
    }
  }, function(err) {
    console.log(err);
  });
}

module.exports.fetchJnlp = fetchJnlp;

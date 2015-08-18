// Required Node Packages
var minimongo = require('minimongo');

var IndexedDb = minimongo.IndexedDb;

var fetchJnlp = function(jnlpURL, cbFetchJnlp) {
  new IndexedDb({namespace: "mydb"}, function(db) {
    db.addCollection("tciaSchema", function() {
      if(jnlpURL) {
        db.tciaSchema.upsert({
          '_id': "jnlpInfo",
          'jnlpURL': jnlpURL
        }, function() {
          cbFetchJnlp(null, jnlpURL);
        });
      }
      else {
        db.tciaSchema.findOne({'_id': "jnlpInfo"}, {}, function(jnlpExist) {
          if(jnlpExist) {
            cbFetchJnlp(null, jnlpExist.jnlpURL);
          }
          else {
            cbFetchJnlp("Error", null);
          }
        });
      }
    });
  }, function(err) {
    console.log(err);
  });
}

module.exports.fetchJnlp = fetchJnlp;

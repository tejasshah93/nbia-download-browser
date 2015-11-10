// Required Node Packages
var async = require('async');
var minimongo = require('minimongo');

var IndexedDb = minimongo.IndexedDb;

/*
 * Add row IDs to seriesArray maintaining stats of the series delete by user
 */
var updateRows = function (rownodes, cbUpdateRows) {
  new IndexedDb({namespace: 'mydb'}, function (db) { // eslint-disable-line no-new
    db.addCollection('tciaSchema', function () {
      if (rownodes) {
        var removedSeries = [];
        async.each(rownodes, function (row, cbRow) {
          console.log(row.id.split('_')[1]);
          removedSeries.push(row.id.split('_')[1]);
          cbRow();
        }, function (err) { // eslint-disable-line handle-callback-err
          db.tciaSchema.findOne({'_id': 'removedSeries'}, {}, function (doc) {
            console.log('removedSeries');
            if (doc && doc.seriesArray) {
              removedSeries = Array.prototype.concat.apply([], [removedSeries, doc.seriesArray]);
            }
            console.log(removedSeries);
            db.tciaSchema.upsert({
              '_id': 'removedSeries',
              'seriesArray': removedSeries
            }, function () {
              cbUpdateRows();
            });
          });
        });
      } else cbUpdateRows();
    });
  }, function (err) {
    console.log(err);
  });
};

module.exports.updateRows = updateRows;

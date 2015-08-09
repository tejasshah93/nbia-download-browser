// Required Node Packages
var async = require('async');
var minimongo = require('minimongo');
var IndexedDb = minimongo.IndexedDb;

var addPatientID = function(db, collection, patientID, cbAddPatientID) {
  db.tciaSchema.findOne({'collection': collection}, {}, function(doc) {
    var patients = doc.patients.concat([patientID]);
    db.tciaSchema.upsert({
      '_id': collection,
      'type': "collection",
      'collection': collection,
      'patients': patients
    }, function() {
      cbAddPatientID(null);
    });
  })
}

var insertCollectionTable = function(db, manifest, cbInsertCollectionTable) {
  var collection = manifest[0],
  patientID = manifest[1];

  db.tciaSchema.findOne({'collection': collection}, {}, function(colExist) {
    if(!colExist) {
      db.tciaSchema.upsert({
        '_id': collection,
        'type': "collection",
        'collection': collection,
        'patients': []
      }, function() {
        addPatientID(db, collection, patientID, function(db) {
          cbInsertCollectionTable(null);
        });
      });
    }
    else if (colExist.patients.indexOf(patientID) == -1) {
      addPatientID(db, collection, patientID, function(db) {
        cbInsertCollectionTable(null);
      });
    }
    else cbInsertCollectionTable(null);
  });
}

var addStudyUID = function(db, patientID, studyUID, cbAddStudyUID) {
  db.tciaSchema.findOne({'patientID': patientID}, {}, function(doc) {
    var studies = doc.studies.concat([studyUID]);
    db.tciaSchema.upsert({
      '_id': patientID,
      'patientID': patientID,
      'studies': studies
    }, function() {
      cbAddStudyUID(null);
    });
  })
}

var insertPatientTable = function(db, manifest, cbInsertPatientTable) {
  var patientID = manifest[1],
  studyUID = manifest[2].slice(-8);

  db.tciaSchema.findOne({'patientID': patientID}, {}, function(patientExist) {
    if(!patientExist) {
      db.tciaSchema.upsert({
        '_id': patientID,
        'patientID': patientID,
        'studies': []
      }, function() {
        addStudyUID(db, patientID, studyUID, function(db) {
          cbInsertPatientTable(null);
        });
      });
    }
    else if (patientExist.studies.indexOf(studyUID) == -1) {
      addStudyUID(db, patientID, studyUID, function(db) {
        cbInsertPatientTable(null);
      });
    }
    else cbInsertPatientTable(null);
  });
}

var insertSeriesTable = function(db, seriesUID, hasAnnotation, cbInsertSeriesTable) {
  db.tciaSchema.findOne({'seriesUID': seriesUID}, {}, function(seriesExist) {
    if(!seriesExist) {
      var seriesUIDShort = seriesUID.slice(-8);
      var hasAnnotationBool = (hasAnnotation == "Yes" ? "true" : "false");
      db.tciaSchema.upsert({
        '_id': seriesUID,
        'type': "seriesDetails",
        'seriesUID': seriesUID,
        'seriesUIDShort': seriesUIDShort,
        'hasAnnotation': hasAnnotationBool
      }, function() {
          cbInsertSeriesTable(null);
      });
    }
    else cbInsertSeriesTable(null);
  });
}

var addSeriesUID = function(db, studyUID, seriesUID, hasAnnotation, cbAddSeriesUID) {
  db.tciaSchema.findOne({'studyUID': studyUID}, {}, function(doc) {
    var series = doc.series.concat([seriesUID.slice(-8)]);
    db.tciaSchema.upsert({
      '_id': studyUID,
      'studyUID': studyUID,
      'series': series
    }, function() {
      insertSeriesTable(db, seriesUID, hasAnnotation, function(errInsertSeriesTable) {
        cbAddSeriesUID(null);
      });
    });
  })
}

var insertStudyTable = function(db, manifest, cbInsertStudyTable) {
  var studyUID = manifest[2].slice(-8),
  seriesUID = manifest[3],
  hasAnnotation = manifest[4];

  db.tciaSchema.findOne({'studyUID': studyUID}, {}, function(studyExist) {
    if(!studyExist) {
      db.tciaSchema.upsert({
        '_id': studyUID,
        'studyUID': studyUID,
        'series': []
      }, function() {
        addSeriesUID(db, studyUID, seriesUID, hasAnnotation, function(db) {
          cbInsertStudyTable(null);
        });
      });
    }
    else if (studyExist.series.indexOf(seriesUID) == -1) {
      addSeriesUID(db, studyUID, seriesUID, hasAnnotation, function(db) {
        cbInsertStudyTable(null);
      });
    }
    else cbInsertStudyTable(null);
  });
}

var storeSchema = function(schema, cbStoreSchema) {
  var manifestLen = schema.length;
  console.log("Total manifest splits " + manifestLen);
  new IndexedDb({namespace: "mydb"}, function(db) {
    db.addCollection("tciaSchema", function() {
      async.eachSeries(schema, function(manifest, cbManifest){
        manifest = manifest.split("|");
        insertCollectionTable(db, manifest, function(errInsertCollectionTable) {
          insertPatientTable(db, manifest, function(errInsertPatientTable) {
            insertStudyTable(db, manifest, function(errInsertStudyTable) {
              cbManifest();
            });
          });
        });
      }, function(errManifest) {
        if(!errManifest) {
          console.log('TCIA Manifest schema successfully stored');
          cbStoreSchema(null);
        }
        else {
          cbStoreSchema(errManifest);
        }
      });
    });
  }, function(err) {
    console.log(err);
    cbStoreSchema(err);
  });
}

module.exports.storeSchema = storeSchema;

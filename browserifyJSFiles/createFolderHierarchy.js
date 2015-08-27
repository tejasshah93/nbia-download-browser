// Required Node Packages
var async = require('async');
var minimongo = require("minimongo");

var IndexedDb = minimongo.IndexedDb;

/*
 * For each series of a particular study, create seriesUID's folder within that
 * study folder in parallel and upsert series document in DB maintaining
 * 'fsPath'(folder entry for a particular series)
 */
var createSeriesFolder = function(db, entry, series, cbCreateSeriesFolder) {
  async.each(series, function(seriesItem, cbSeries) {
    db.tciaSchema.findOne({'seriesUIDShort': seriesItem}, {}, function(doc) {
      var seriesDirname = (seriesItem[0] == "." ? seriesItem.slice(-7) : seriesItem);
      entry.getDirectory(seriesDirname, {create:true}, function(entry) {
        db.tciaSchema.upsert({
          '_id': doc._id,
          'type': doc.type,
          'seriesUID': doc.seriesUID,
          'seriesUIDShort': doc.seriesUIDShort,
          'hasAnnotation': doc.hasAnnotation,
          'numberDCM': doc.numberDCM,
          'size': doc.size,
          'fsPath': chrome.fileSystem.retainEntry(entry),
          'downloadStatus': 0,
          'downloadedSize': 0,
          'files': []
        }, function() {
          cbSeries();
        });
      });
    });
  }, function(errSeries) {
    if(!errSeries)  cbCreateSeriesFolder();
  });
}

/*
 * For each study of a particular patient, create studyUID's folder within that
 * patient's folder in parallel and call createSeriesFolder()
 */
var createStudiesFolder = function(db, entry, studies, cbCreateStudiesFolder) {
  async.each(studies, function(study, cbStudy) {
    var studyDirname = (study[0] == "." ? study.slice(-7) : study);
    entry.getDirectory(studyDirname, {create:true}, function(entry) {
      db.tciaSchema.findOne({'studyUID': study}, {}, function(doc) {
        createSeriesFolder(db, entry, doc.series, function(){
          cbStudy();
        });
      });
    });
  }, function(errStudy) {
    if(!errStudy)  cbCreateStudiesFolder();
  });
}

/*
 * For each patient in a particular collection, create patient's folder within
 * that collection's folder in parallel and call createStudiesFolder()
 */
var createPatientsFolder = function(db, entry, patients, cbCreatePatientsFolder) {
  async.each(patients, function(patient, cbPatient) {
    entry.getDirectory(patient, {create:true}, function(entry) {
        db.tciaSchema.findOne({'patientID': patient}, {}, function(doc) {
          createStudiesFolder(db, entry, doc.studies, function(){
            cbPatient();
          });
        });
    });
  }, function(errPatient) {
    if(!errPatient)  cbCreatePatientsFolder();
  });
}

/*
 * For each collection in DB, create collection's folder within the user's
 * chosen directory in parallel and call createPatientsFolder()
 */
var createCollectionsFolder = function(db, theEntry, collections, cbCreateCollectionFolder) {
  async.each(collections, function(collection, cbCollection) {
    chrome.fileSystem.getWritableEntry(theEntry, function(entry) {
      entry.getDirectory(collection._id, {create:true}, function(entry) {
        db.tciaSchema.findOne({'collection': collection._id}, {}, function(doc) {
          createPatientsFolder(db, entry, doc.patients, function(){
            cbCollection();
          });
        });
      });
    });
  }, function(errCollection) {
    if(!errCollection)  cbCreateCollectionFolder();
  });
}

/*
 * Upsert 'chosenDirFolder' in DB and create folders within user's chosen
 * directory with appropriate hirarchy viz.,
 * "collection > patientID > studyUID > seriesUID" for each of the entries
 */
var createFolderHierarchy = function(theEntry, cbCreateFolderHierarchy) {
  new IndexedDb({namespace: "mydb"}, function(db) {
    db.addCollection("tciaSchema", function() {
      db.tciaSchema.upsert({
        '_id': "chosenDir",
        'chosenDirFolder': chrome.fileSystem.retainEntry(theEntry),
      }, function() {
        db.tciaSchema.find({'type': "collection"}).fetch(function(collections) {
          createCollectionsFolder(db, theEntry, collections, function() {
            db.tciaSchema.upsert({
              '_id': "createFolderHierarchyInfo",
              'createFolderHierarchyFlag': true
            }, function() {
              cbCreateFolderHierarchy();
            });
          });
        });
      });
    });
  }, function(err) {
    console.log(err);
    cbCreateFolderHierarchy(err);
  });
}

module.exports.createFolderHierarchy = createFolderHierarchy;

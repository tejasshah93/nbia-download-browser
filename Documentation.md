# PROJECT: BULK DATA TRANSFER

## PRE-GSOC STATE OF ART

The existing system for downloading image archives is a Java based standalone
solution. However, it has some of the following shortcomings:

- Requires Java to be installed and involves dependency issues, updating Java
version on different OS platforms, etc
- Recognizing a JNLP file and launching with Java Webstart (JavaWS). Sometimes
 this causes issues for users behind proxy. Basically getting the JavaWS
application in a working mode involves some troubleshooting
- A standalone application doesn't serve the purpose to full extent when we're
dealing with cross platform solutions. It has to be more robust, flexible,
generic and scalable which is loosely coupled with any system

---

## SCOPE

The existing system is highly coupled with client side compatibilities. We need
to minimize this dependency and provide for a generic solution that would work
with all possible client platforms with minimal prerequisite/setup.  

To develop a browser based application to suffice the purpose effectively.

---

## DESIGN & ARCHITECTURE

**Aim**: To mimic the currently implemented solution using browser based stack
i.e.  using *JavaScript* for the download applet and *HTML*, *CSS* for interface

Following outlines the basic implementation design:

- Using various `npm modules` for the project since they provide a wide range of
functionalities (tar parsing, concurrent downloads, etc) and account for a vast
community support for maintenance, testing, etc.
- [`Browserify`](http://browserify.org/) which lets us `require('modules')` in
the browser by bundling up all of the node dependencies
- [`IndexedDB`](http://www.w3.org/TR/IndexedDB/) as a storage option -
is persistent and capable of storing large amounts of structured data. Thus data
can be stored locally on browser side, so that whenever a network failure or
other such interruptions occur we have our data consistent within the
application itself. (The term "data" here refers to structured hierarchy of the
manifest schema as well as status of partially/completely downloaded files)
- Using [`Minimongo`](https://github.com/mWater/minimongo) backed by IndexedDB:
  - Directly using IndexedDB without any wrapper doesn't simply follow the
  straighforward way of managing a database. Every operation that one performs
  when using IndexedDB must be carried out within a transaction. Whether that's
  reading information from an object store, manipulating data in it or changing
  its structure.
  - Minimongo is a client-side MongoDB implementation which has the option to
  be backed by IndexedDB. Thus, it provides a wrapper over IndexedDB providing
  more of a JavaScript based MongoDB API which makes interaction with the
  database easier
  - Designed to be used with browserify
- Product: `Chrome Application` instead of a website based application
  - Website based application requires user to modify certain options in the
  browser and also a script needs to be shipped along with the downloads that
  will basically re-arrange all the files into a specific folder hierarchy
  - Chrome Application reduces the cross-browser flexibility but still it
  enables the user to interactively select folder for the files to be
  downloaded and works similar to the current download manager. Thus, the only
  requirement to install this application is that the Chrome browser be
  installed in the user's operating system.

---

## IMPLEMENTATION - Developer Manual

Each module of the Chrome Application is written using Node.js and then
browserified using Browserify (with required `module.exports`) into a
`bundle.js` file. This bundle.js is then included in the index page of the
application.

### Invoking the Chrome App from webpage

Following the process of creating download basket on cancerimagingarchive.net,
instead of downloading the *.jnlp* file, we need to invoke our Chrome
Application from within the site itself (assuming Chrome Application is already
installed, else inline installation will be prompted after pushing the
application to Chrome Webstore) and pass the Jnlp file URL for further
processing.

[`url_handlers`](https://developer.chrome.com/apps/manifest/url_handlers) is
used to specify URL patterns the app wants to intercept and handle. The
application will be launched for all matching navigations inside the browser
tabs. It will receive a new kind of the `app.runtime.onLaunched` event, with
the `launchData` object containing the matched handler's identifier, the URL
being navigated to, and the referrer's URL. We can modify the URL as required
under "url_handlers" attribute in `manifest.json`  

File: [nbia-launch.html](nbia-launch.html)

### Messaging from webpage to Chrome App

Now, we need to pass the Jnlp file URL to the Chrome Application for further
processing. This is done using
[`messaging`](https://developer.chrome.com/extensions/messaging#external-webpage).
To use this feature, we specify which web sites we want to communicate with in
manifest.json. For e.g.:

```javascript
"externally_connectable": {
  "matches": ["*://*.example.com/*"]
}
```
In our case, we can have the matching URL as
"https://\*.cancerimagingarchive.net/\*" so as to communicate with
cancerimagingarchive domain pages. Thus, the `onClick` functionality of
"Download Basket" button can be modified to be:

```javascript
// Make a simple request:
chrome.runtime.sendMessage(extensionId, {jnlp: JnlpURL},
    function(response) {}
    );
```
where `extensionId` is the Chrome Application ID obtained after publishing to
Chrome WebStore and `JnlpURL` is URL of the Jnlp file (which is downloaded by
default in current implementation).

In the Chrome App, we have a `chrome.runtime.onMessageExternal` listener in
"background.js"" which listens to external messages by webpages. This listener
acknowledges the JnlpURL sent by the website and sends this JnlpURL to "app.js"
for fetching the Jnlp file and processing it further.  

Note: 'JnlpURL' is sent to app.js only when the Chrome Application is fully
loaded  

File: [background.js](nbia-chrome-app/background.js)

### Initialization

**- Storing manifest schema**

Now since the 'JnlpURL' in accessible in app.js, the Jnlp file is fetched from
server for parsing and extracting necessary properties viz., `userId`,
`password`, `includeAnnotations`, `downloadServerUrl` and `argument` (for the
`serverjnlpfileloc` attribute in manifest URL). Also, at the same time this
JnlpURL is stored in DB for the purpose of recovery from failures. (File:
`fetchJnlp.js`). Once these properties are fetched, manifest URL is constructed
and the manifest schema is fetched accordingly.

This manifest schema is stored in a structured format in IndexedDB to maintain
the hierarchy of collection, patients, studies and series as well as to monitor
status of download for each individual series (thus making the application
failure resistant). The schema for each manifest entry is stored sequentially
to maintain the document (tuple) consistency in database. Thus, this process
might require some time (approximately 5 minutes) for huge sized downloads
containing high number of series.

File: [storeSchema.js](browserifyJSFiles/storeSchema.js)

**- Creating Folder Hierarchy**

Now, since the manifest schema is stored in structured format in the DB, the
folders are created in the user's filesystem within chosen directory (user is
given a choice of choosing directory to specify the location for files to be
downloaded) using
[`chrome.filesystem`](https://developer.chrome.com/apps/fileSystem) API.

Each of the collections, its patients, their studies and respective series
folders are created in parallel using
[`async.each`](https://github.om/caolan/async/#each) to minimize the time
required for creating the required folder hierarchy. For each series, it's
filesystem path is stored in database to download files in respective folder.

File: [createFolderHierarchy.js](browserifyJSFiles/createFolderHierarchy.js)  


### Downloading Files

**- Asynchronous concurrency**

On clicking "Download Files", the download is initiated. To maintain a
concurrency level of "3" i.e. keep downloading atleast 3 series at a time,
`async.eachLimit` is used with concurrency limit set to 3. This can be increased
or decreased by modifying the parameter value in `downloadSeries` function.

The download URL for each series is created using properties fetched from Jnlp
file and `sopUIDs` parameter is populated from the database. For each series, a
`files` array is maintained which records the sopUID of each DICOM file
downloaded successfully. Thus using this 'files' array, the `sopUIDs` parameter
is set in appropriate format to indicate the list of already downloaded files
for that particular series.

File: [fetchAndParseTar.js](browserifyJSFiles/fetchAndParseTar.js)


### Parsing Tar Stream

The download URL for each series fetches a tar stream of that particular series
from the server. To parse this tar,
[tar-stream](https://github.com/mafintosh/tar-stream) module is used. It's
basically a streaming tar parser. (Without resorting to npm modules, browser
based tar parsers were accounted for, however they weren't much docmented or had
limited exposed API.)

File: [fetchAndParseTar.js](browserifyJSFiles/fetchAndParseTar.js)  


### Updating DB

For each successful fetched entry of the tar stream, the entry i.e. the file is
downloaded to user's chosen directory in respective folder and on writing the
file to disk, it's 'sopUID' is added to the `files` array of the series it is a
part of. This helps in resuming download of a partially downloaded series by
appending the already fetched DICOM files to 'sopUIDs' parameter in URL as
mentioned above.  


### Failure tolerance measures

Considering failures as network interruptions, system restart, application
crashes etc., the application must be able to recover from such failure
instances with minimal loss (i.e. re-downloading of files should be minimized).

For each series a `downloadStatusFlag` is maintained whose value is either
of [0, 1, 2], where  

0 => "not encountered/failed"  
1 => "encountered but not complete yet (partially completed)"  
2 => "completed"  

These status flags help in re-downloading only the the failed/incomplete series
i.e. series with value of 'downloadStatusFlag' either "0" or "1" are downloaded
after an interrupt occurs. Totally completed series remain untouched. Also,
since within a series, we maintain a list of successfully downloaded DICOM files
in an array, only those files are downloaded which are not yet fetched.

Files: [restoreState.js](browserifyJSFiles/restoreState.js),
  [execute.js](browserifyJSFiles/execute.js),
  [fetchAndParseTar.js](browserifyJSFiles/fetchAndParseTar.js)  
'restoreState' module sets appropriate flags for recovery for what has been done
and what isn't.  
'execute' module initiates recovery process, completes initialization part if
not done completely earlier and calls 'fetchAndParseTar' module.  
'fetchAndParseTar' module resumes download of files considering previous
download states  

The Chrome Application is tested for network interruptions, application crashes,
system restart and it is able to successfully recover from the previous state
with minimal or no loss as desired (as per the current Download manager
behavior).

### Chunked Transfer Encoding Behavior

While downloading a series, it is expected that the application would pipe the
stream on-the-fly to the tar parser on receiving each chunk of data from the
server. Instead it waits until all chunks are received and then passes the data
to the tar parser. This leads almost to a "binary" download of series i.e. the
whole series gets fetched, then it is passed on to the tar parser and thereafter
the files are downloaded to respective folder.

The code has been written to work as per on-the-fly approach, however as
discussed in [this StackOverflow
question](http://stackoverflow.com/q/13557900/2385420), this is indeed the
behavior of a web based application. Browsers (or Chrome Application in our
case) needs some payload to start rendering chunks as they received. The
discussion [here](http://stackoverflow.com/q/16909227/2385420) refers to size
of the content that needs to be padded (i.e. initial payload) so that the
application starts rendering partial response.  

To workaround this issue, either some arbitrary data can be padded initially
with the response or a custom header can be passed with required content size
(if the browser validates payload as size of response plus header). However,
this must be done on the server side.

### Developer Takeways

For further development, [browserify](http://browserify.org/) must be installed.
Installation instructions can be found [here](http://browserify.org/#install).

For creating 'bundle.js', execute the following command:

```bash
$ browserify -s bundle fetchAndParseTar.js -o <application-path>/js/bundle.js
```

Note: 'createFolderHierarchy.js', 'execute.js', 'fetchAndParseTar.js',
'fetchJnlp.js', 'restoreState.js', 'storeSchema.js', 'updateRows.js' must be in
the same folder (say "browserifyJSFiles" for instance) for running the above
command.  
The *-s* option creates a standalone bundle from
'fetchAndParseTar.js' file into an output file: 'bundle.js'.  

To add other module, `require("./newModule")` in fetchAndParseTar.js and
append its function to `bundle` variable. This will export the required function
from 'newModule' into `module.exports` object. E.g.:

```javascript
var newModule = require("./newModule");

var bundle = {
  foobar: newModule.foobar,
  ...
}
```
To call this exported function, use `bundle.foobar()` with required parameters.

---

## USER MANUAL

You must have version 31 or higher of Google Chrome installed to be able to open
the Download Manager. Also, you need to install the Chrome Application **NBIA
Download Manager** (that would be available on Chrome Webstore when published.
[`Inline installation`](https://developer.chrome.com/webstore/inline_installation)
can be added once the Application is published on Webstore. This would enable
to prompt for installing the application automatically, if not installed).

To download objects using the Chrome Application Download Manager, follow these
steps:

1. Click the "Download Manager" button on NBIA website. This opens the Chrome
   Application, shown in the following figure.  

   ![Chrome Application - Initialization](https://www.dropbox.com/s/xfal7plgbe8nb6m/ChromeApp-Init.png?dl=1 "Chrome Application - Initialization")

   The Download Manager lists series items you selected in the data basket. You
   can mouse over the Patient ID, Study Instance and Series Instance columns to
   reveal the complete corresponding IDs. If there are large number of entries
   in the basket, you can selectively choose to specify how many series items
   you would like to be displayed on a single page. Options available are [10,
   25, 50, All] and on selecting one of them, pagination will be created
   dynamically. (Default or Full Screen view of the application is recommended
   for optimal visualization)

2. The Download Manager initially lists everything in your Data Basket. After
   you open the application, however, you can remove the items you do not want
   to download. To remove the items, just click on the row(s) you don't want to
   download (multiple selection is possible) and click on the "Remove
   selection" button (as illustrated in the following figure)

   ![Chrome Application - Remove Rows](https://www.dropbox.com/s/tk2oobwuu10hhpv/ChromeApp-RemoveRows.png?dl=1 "Chrome Application - Remove Rows")   

3. Browse for the destination where you want the images/annotations to be
   downloaded using "Choose Directory" button. This is where the appropriate
   folder hierarchy will be created to download the images in a structured
   format.

4. Click "Download Files" to execute the download. You can monitor the download
   in the Progress column. The Status column indicates when the download for
   each item is complete. The following image shows download in progress:

   ![Chrome Application - Process](https://www.dropbox.com/s/2gkrz7w9r9bwjli/ChromeApp-Process.png?dl=1 "Chrome Application - Process")

5. At any point in the process, you can close the application and restart it at
   a later stage to resume the process. Your previous download state will be
   aptly restored.  

**Note:**  
Whenever the Chrome Application is invoked from the website (i.e. clicking
"Download Manager" button on cancerimagingarchive website), the previous
download state is flushed and a new instance is started.  

If network errors, application crash, system restart, etc. occur during
large downloads, all you've to do is open the Download Manager from Chrome
Application Launcher. The Download Manager retries downloading
failed/incomplete files until all of them are successfully downloaded.  

---

### Contact

For any queries or to get in touch:  

Tejas Shah  
Email ID : tejas.urwelcome@gmail.com  
Github  : [tejasshah93](https://github.com/tejasshah93)  
Website : http://researchweb.iiit.ac.in/~tejas.shah/

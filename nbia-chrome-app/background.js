/*
 * onLaunched listener:
 * Creates the application window and loads 'index.html'
 */
chrome.app.runtime.onLaunched.addListener(
  function (launchData) {
    /* eslint-disable indent */
    chrome.app.window.create('index.html', {id: 'NBIA-Download-Manager',
      innerBounds: {width: 1024, height: 768}}, function (win) {
        win.contentWindow.launchData = launchData;
        console.log(launchData);
      });
    /* eslint-enable indent */
  });

/*
 * onMessageExternal listener;
 * Facilitates messaging between the web page and Chrome Application
 * Web page sends 'message.jnlp' as the URL of the jnlp to be downloaded
 */
var saveJnlpURL;
chrome.runtime.onMessageExternal.addListener(
    function (message, sender, sendResponse) {
      if (message.jnlp) {
        console.log('onMessageExternal ' + message.jnlp);
        saveJnlpURL = message.jnlp;
        sendResponse('Chrome App ack: JNLP URL received: ' + message.jnlp);
      }
    });

/*
 * onMessage listener:
 * Facilitates messaging between 'background.js' and 'app.js'
 * 'app.js' sends 'message.appLoad' to notify the loading status of application
 * on receiving 'message.appLoad', it sends jnlp URL to 'app.js'
 */
chrome.runtime.onMessage.addListener(
    function (message, sender, sendResponse) {
      if (message.appLoad) {
        console.log('background.js ack: Chrome App loaded. Sending JNLP URL');
        chrome.runtime.sendMessage({jnlpURL: saveJnlpURL}, function (response) {
          console.log(response.ack);
        });
      }
    });

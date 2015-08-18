chrome.app.runtime.onLaunched.addListener(function(launchData) {
  chrome.app.window.create('index.html', {id:"NBIA-Download-Manager", innerBounds: {width: 1024, height: 768}}, function(win) {
    win.contentWindow.launchData = launchData;
  });
});

var saveJnlpURL;
chrome.runtime.onMessageExternal.addListener(function(message, sender, sendResponse) {
  if(message.jnlp) {
    console.log("onMessageExternal " + message.jnlp);
    saveJnlpURL = message.jnlp;
    sendResponse("Chrome App ack: JNLP URL received: " + message.jnlp); 
  }
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if(message.appLoad) {
    console.log("background.js ack: Chrome App loaded. Sending JNLP URL to app.js");
    chrome.runtime.sendMessage({jnlpURL: saveJnlpURL}, function(response) {
      console.log(response.ack)
    });
  }
});

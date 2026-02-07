// Antic Shield - Content script loader (MV2 isolated world)
// Injects config.js and antidetect.js into the MAIN world via <script> tags

(function() {
  "use strict";
  
  // Inject config.js first (sets window.__ANTIC_CONFIG__)
  try {
    const configScript = document.createElement('script');
    configScript.src = chrome.runtime.getURL('config.js');
    configScript.onload = function() { this.remove(); };
    (document.head || document.documentElement).prepend(configScript);
  } catch(e) {}
  
  // Then inject antidetect.js (reads the config and applies all overrides)
  try {
    const mainScript = document.createElement('script');
    mainScript.src = chrome.runtime.getURL('antidetect.js');
    mainScript.onload = function() { this.remove(); };
    (document.head || document.documentElement).prepend(mainScript);
  } catch(e) {}
})();

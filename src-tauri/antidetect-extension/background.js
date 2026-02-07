// Antic Shield - Background Service Worker
// Handles proxy authentication for all proxy types

let proxyAuth = null;

// Read proxy auth from proxy_auth.json (written by Rust launcher)
async function loadProxyAuth() {
  try {
    const url = chrome.runtime.getURL('proxy_auth.json');
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data && data.proxyAuth) {
        proxyAuth = data.proxyAuth;
        console.log('[Antic Shield] Proxy auth loaded for user:', proxyAuth.username);
      }
    }
  } catch(e) {
    // No proxy auth file - that's OK, means no proxy credentials needed
  }
}

// Load auth on startup
loadProxyAuth();

// Listen for auth challenges (proxy authentication)
chrome.webRequest.onAuthRequired.addListener(
  function(details, callbackFn) {
    if (proxyAuth && details.isProxy) {
      callbackFn({
        authCredentials: {
          username: proxyAuth.username,
          password: proxyAuth.password
        }
      });
    } else {
      callbackFn({});
    }
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

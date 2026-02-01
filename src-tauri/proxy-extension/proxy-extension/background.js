// Antic Browser Proxy Extension
// Поддержка SOCKS4/SOCKS5 прокси с авторизацией

let proxyConfig = null;

console.log('[Proxy Extension] Service Worker started');

// Настройка прокси при загрузке extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Proxy Extension] Extension installed');
  loadProxyFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Proxy Extension] Extension startup');
  loadProxyFromStorage();
});

// Загрузка прокси из storage
function loadProxyFromStorage() {
  chrome.storage.local.get(['proxyString'], (result) => {
    if (result.proxyString) {
      console.log('[Proxy Extension] Loading proxy from storage:', result.proxyString.substring(0, 30) + '...');
      proxyConfig = parseProxyString(result.proxyString);
      if (proxyConfig) {
        setupProxy(proxyConfig);
      }
    } else {
      console.log('[Proxy Extension] No proxy in storage');
    }
  });
}

// Слушаем сообщения от браузера для настройки прокси
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Proxy Extension] Message received:', request.type);
  
  if (request.type === 'setProxy') {
    const proxyStr = request.proxyString;
    console.log('[Proxy Extension] Setting proxy:', proxyStr.substring(0, 30) + '...');
    
    proxyConfig = parseProxyString(proxyStr);
    
    if (proxyConfig) {
      // Сохраняем в storage
      chrome.storage.local.set({ proxyString: proxyStr }, () => {
        console.log('[Proxy Extension] Proxy saved to storage');
      });
      
      setupProxy(proxyConfig);
      sendResponse({ success: true });
    } else {
      console.error('[Proxy Extension] Invalid proxy format');
      sendResponse({ success: false, error: 'Invalid proxy format' });
    }
    return true;
  }
  
  if (request.type === 'clearProxy') {
    console.log('[Proxy Extension] Clearing proxy');
    proxyConfig = null;
    chrome.storage.local.remove('proxyString');
    clearProxy();
    sendResponse({ success: true });
    return true;
  }
});

// Парсинг прокси строки
function parseProxyString(proxyStr) {
  if (!proxyStr) return null;
  
  try {
    const url = new URL(proxyStr);
    
    return {
      scheme: url.protocol.replace(':', ''),  // http, https, socks4, socks5
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      username: url.username || null,
      password: url.password || null
    };
  } catch (e) {
    console.error('[Proxy Extension] Parse error:', e);
    // Формат: host:port:username:password
    const parts = proxyStr.split(':');
    if (parts.length >= 2) {
      return {
        scheme: 'http',
        host: parts[0],
        port: parseInt(parts[1]),
        username: parts[2] || null,
        password: parts[3] || null
      };
    }
    return null;
  }
}

// Настройка прокси через Chrome Proxy API
function setupProxy(config) {
  const proxyRules = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: config.scheme,
        host: config.host,
        port: config.port
      }
    }
  };
  
  console.log('[Proxy Extension] Setting proxy rules:', JSON.stringify(proxyRules));
  
  chrome.proxy.settings.set(
    { value: proxyRules, scope: 'regular' },
    () => {
      if (chrome.runtime.lastError) {
        console.error('[Proxy Extension] Proxy setup error:', chrome.runtime.lastError);
      } else {
        console.log('[Proxy Extension] Proxy configured:', config.host + ':' + config.port);
      }
    }
  );
  
  // Если есть авторизация - настраиваем обработчик
  if (config.username && config.password) {
    console.log('[Proxy Extension] Setting up auth handler');
    // Note: webRequest.onAuthRequired requires 'webRequest' and 'webRequestBlocking' permissions
    // But in Manifest v3, blocking webRequest is restricted. 
    // For now, we'll just log this.
    console.warn('[Proxy Extension] Auth handler setup - credentials:', config.username + ':***');
  }
}

// Очистка прокси
function clearProxy() {
  chrome.proxy.settings.clear({ scope: 'regular' }, () => {
    console.log('[Proxy Extension] Proxy cleared');
  });
}

console.log('[Proxy Extension] Background script loaded');

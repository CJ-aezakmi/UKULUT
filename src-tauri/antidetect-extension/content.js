// Antic Shield - Anti-detect content script
// Injected at document_start in MAIN world before any page scripts

(function() {
  "use strict";
  
  const cfg = window.__ANTIC_CONFIG__ || {};

  // =========================================================================
  // 1. Remove webdriver flag (most critical detection vector)
  // =========================================================================
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
  });
  
  // Delete from prototype chain
  try {
    delete Navigator.prototype.webdriver;
  } catch(e) {}

  // =========================================================================
  // 2. Override User-Agent
  // =========================================================================
  if (cfg.userAgent) {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => cfg.userAgent,
      configurable: true
    });
    Object.defineProperty(navigator, 'appVersion', {
      get: () => cfg.userAgent.replace('Mozilla/', ''),
      configurable: true
    });
  }

  // =========================================================================
  // 3. Navigator properties masking
  // =========================================================================
  if (cfg.vendor) {
    Object.defineProperty(navigator, 'vendor', {
      get: () => cfg.vendor,
      configurable: true
    });
  }

  if (cfg.cpu) {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => cfg.cpu,
      configurable: true
    });
  }

  if (cfg.ram) {
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => cfg.ram,
      configurable: true
    });
  }

  // =========================================================================
  // 4. Language masking
  // =========================================================================
  if (cfg.lang) {
    const baseLang = cfg.lang.split('-')[0];
    Object.defineProperty(navigator, 'language', {
      get: () => cfg.lang,
      configurable: true
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => [cfg.lang, baseLang, 'en-US', 'en'],
      configurable: true
    });
  }

  // =========================================================================
  // 5. Platform masking
  // =========================================================================
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32',
    configurable: true
  });

  // =========================================================================
  // 6. Screen resolution masking
  // =========================================================================
  if (cfg.screenWidth && cfg.screenHeight) {
    Object.defineProperties(window.screen, {
      width:       { get: () => cfg.screenWidth,  configurable: true },
      height:      { get: () => cfg.screenHeight, configurable: true },
      availWidth:  { get: () => cfg.screenWidth,  configurable: true },
      availHeight: { get: () => cfg.screenHeight, configurable: true },
      colorDepth:  { get: () => 24, configurable: true },
      pixelDepth:  { get: () => 24, configurable: true }
    });
    
    Object.defineProperties(window, {
      outerWidth:  { get: () => cfg.screenWidth,  configurable: true },
      outerHeight: { get: () => cfg.screenHeight, configurable: true },
      innerWidth:  { get: () => cfg.screenWidth,  configurable: true },
      innerHeight: { get: () => cfg.screenHeight - 79, configurable: true }
    });
  }

  // =========================================================================
  // 7. Chrome object masking (critical for headless/automation detection)
  // =========================================================================
  if (!window.chrome) {
    window.chrome = {};
  }
  
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() {},
      sendMessage: function() {},
      onMessage: { addListener: function() {}, removeListener: function() {} },
      id: undefined
    };
  }
  
  window.chrome.loadTimes = function() {
    return {
      requestTime: Date.now() / 1000,
      startLoadTime: Date.now() / 1000,
      commitLoadTime: Date.now() / 1000,
      finishDocumentLoadTime: Date.now() / 1000,
      finishLoadTime: Date.now() / 1000,
      firstPaintTime: Date.now() / 1000,
      firstPaintAfterLoadTime: 0,
      navigationType: "Other",
      wasFetchedViaSpdy: false,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: "h2",
      wasAlternateProtocolAvailable: false,
      connectionInfo: "h2"
    };
  };
  
  window.chrome.csi = function() {
    return {
      startE: Date.now(),
      onloadT: Date.now(),
      pageT: Math.random() * 1000,
      tran: 15
    };
  };
  
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
    };
  }

  // =========================================================================
  // 8. WebRTC leak prevention
  // =========================================================================
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    const origEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = function() {
      return Promise.resolve([
        { deviceId: 'default', kind: 'audioinput',  label: 'Default - Microphone', groupId: 'default' },
        { deviceId: 'default', kind: 'audiooutput', label: 'Default - Speaker',    groupId: 'default' },
        { deviceId: 'default', kind: 'videoinput',  label: 'Default - Webcam',     groupId: 'default' }
      ]);
    };
  }

  // Override RTCPeerConnection to prevent IP leak
  const OrigRTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (OrigRTC) {
    const ProxiedRTC = function(...args) {
      // Force use of TURN/relay only to prevent local IP leak
      if (args[0] && args[0].iceServers) {
        // Keep iceServers but remove any that could leak local IP
      }
      const pc = new OrigRTC(...args);
      
      // Wrap createOffer to filter out local candidates
      const origCreateOffer = pc.createOffer.bind(pc);
      pc.createOffer = function(options) {
        return origCreateOffer(options).then(function(offer) {
          // Remove local IP candidates from SDP
          if (offer && offer.sdp) {
            offer.sdp = offer.sdp.replace(/a=candidate:.*typ host.*\r\n/g, '');
            offer.sdp = offer.sdp.replace(/a=candidate:.*typ srflx.*\r\n/g, '');
          }
          return offer;
        });
      };
      
      return pc;
    };
    ProxiedRTC.prototype = OrigRTC.prototype;
    window.RTCPeerConnection = ProxiedRTC;
    if (window.webkitRTCPeerConnection) {
      window.webkitRTCPeerConnection = ProxiedRTC;
    }
  }

  // =========================================================================
  // 9. Canvas fingerprint noise
  // =========================================================================
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    if (this.width > 0 && this.height > 0) {
      try {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          const data = imageData.data;
          // Subtle noise - changes 1-2 bits on ~5% of pixels
          const seed = cfg.userAgent ? cfg.userAgent.length : 42;
          for (let i = 0; i < data.length; i += 4) {
            if (((i * seed) % 20) === 0) {
              data[i] = data[i] ^ 1;     // Red
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
      } catch(e) {}
    }
    return origToDataURL.apply(this, arguments);
  };

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
    // Apply same noise as toDataURL
    if (this.width > 0 && this.height > 0) {
      try {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          const seed = cfg.userAgent ? cfg.userAgent.length : 42;
          for (let i = 0; i < imageData.data.length; i += 4) {
            if (((i * seed) % 20) === 0) {
              imageData.data[i] = imageData.data[i] ^ 1;
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
      } catch(e) {}
    }
    return origToBlob.apply(this, arguments);
  };

  // =========================================================================
  // 10. WebGL fingerprint masking
  // =========================================================================
  if (cfg.webgl !== false) {
    const wglVendor = cfg.webglVendor || 'Google Inc.';
    const wglRenderer = cfg.webglRenderer || 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
    
    const origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 37445) return wglVendor;
      // UNMASKED_RENDERER_WEBGL
      if (param === 37446) return wglRenderer;
      // VENDOR
      if (param === 7936) return 'WebKit';
      // RENDERER
      if (param === 7937) return 'WebKit WebGL';
      return origGetParam.call(this, param);
    };

    // WebGL2
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return wglVendor;
        if (param === 37446) return wglRenderer;
        if (param === 7936) return 'WebKit';
        if (param === 7937) return 'WebKit WebGL';
        return origGetParam2.call(this, param);
      };
    }
  }

  // =========================================================================
  // 11. Audio context fingerprint noise
  // =========================================================================
  const OrigAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OrigAudioContext) {
    const origCreateOscillator = OrigAudioContext.prototype.createOscillator;
    OrigAudioContext.prototype.createOscillator = function() {
      const osc = origCreateOscillator.call(this);
      return osc;
    };

    // Noise on AnalyserNode.getFloatFrequencyData
    const origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function(array) {
      origGetFloat.call(this, array);
      for (let i = 0; i < array.length; i++) {
        array[i] = array[i] + (Math.random() * 0.1 - 0.05);
      }
    };
  }

  // =========================================================================
  // 12. Battery API spoofing
  // =========================================================================
  if (navigator.getBattery) {
    navigator.getBattery = function() {
      return Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1,
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() { return true; }
      });
    };
  }

  // =========================================================================
  // 13. Connection API masking
  // =========================================================================
  if (navigator.connection) {
    try {
      Object.defineProperties(navigator.connection, {
        downlink:      { get: () => 10,    configurable: true },
        effectiveType: { get: () => '4g',  configurable: true },
        rtt:           { get: () => 50,    configurable: true },
        saveData:      { get: () => false, configurable: true }
      });
    } catch(e) {}
  }

  // =========================================================================
  // 14. Permissions API improvement
  // =========================================================================
  if (navigator.permissions && navigator.permissions.query) {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(descriptor) {
      if (descriptor.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission || 'default', onchange: null });
      }
      return origQuery(descriptor).catch(function() {
        return { state: 'prompt', onchange: null };
      });
    };
  }

  // =========================================================================
  // 15. Plugins and MIME types (match real Chrome)
  // =========================================================================
  Object.defineProperty(navigator, 'plugins', {
    get: function() {
      const plugins = [
        { name: 'Chrome PDF Plugin',  description: 'Portable Document Format', filename: 'internal-pdf-viewer',          length: 1 },
        { name: 'Chrome PDF Viewer',  description: '',                          filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', length: 1 },
        { name: 'Native Client',      description: '',                          filename: 'internal-nacl-plugin',         length: 2 }
      ];
      Object.setPrototypeOf(plugins, PluginArray.prototype);
      return plugins;
    },
    configurable: true
  });

  Object.defineProperty(navigator, 'mimeTypes', {
    get: function() {
      const mimeTypes = [
        { type: 'application/pdf',                 suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'application/x-nacl',              suffixes: '',    description: 'Native Client Executable' },
        { type: 'application/x-pnacl',             suffixes: '',    description: 'Portable Native Client Executable' }
      ];
      Object.setPrototypeOf(mimeTypes, MimeTypeArray.prototype);
      return mimeTypes;
    },
    configurable: true
  });

  // =========================================================================
  // 16. Touch support masking
  // =========================================================================
  if (!cfg.touch) {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 0,
      configurable: true
    });
  } else {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 5,
      configurable: true
    });
  }

  // =========================================================================
  // 17. Notification permission
  // =========================================================================
  if (window.Notification) {
    try {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true
      });
    } catch(e) {}
  }

  // =========================================================================
  // 18. Iframe contentWindow protection
  // =========================================================================
  try {
    const origContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (origContentWindow && origContentWindow.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          const win = origContentWindow.get.call(this);
          if (win) {
            try {
              Object.defineProperty(win.navigator, 'webdriver', {
                get: () => undefined,
                configurable: true
              });
            } catch(e) {}
          }
          return win;
        },
        configurable: true
      });
    }
  } catch(e) {}

  // =========================================================================
  // 19. Timezone masking via Date object
  // =========================================================================
  if (cfg.timezone) {
    const tz = cfg.timezone;
    
    // Override Intl.DateTimeFormat to return our timezone
    const OrigDateTimeFormat = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function(...args) {
      if (args.length === 0) {
        args = [undefined, { timeZone: tz }];
      } else if (args.length === 1) {
        args.push({ timeZone: tz });
      } else if (args[1] && !args[1].timeZone) {
        args[1].timeZone = tz;
      }
      return new OrigDateTimeFormat(...args);
    };
    Intl.DateTimeFormat.prototype = OrigDateTimeFormat.prototype;
    Intl.DateTimeFormat.supportedLocalesOf = OrigDateTimeFormat.supportedLocalesOf;
    
    // Override Date.prototype.getTimezoneOffset based on the target timezone
    // This is approximate but covers most detection scripts
    const origResolvedOptions = OrigDateTimeFormat.prototype.resolvedOptions;
    OrigDateTimeFormat.prototype.resolvedOptions = function() {
      const result = origResolvedOptions.call(this);
      if (!this._hasExplicitTz) {
        result.timeZone = tz;
      }
      return result;
    };
  }

  // =========================================================================
  // 20. Prevent detection of content script injection
  // =========================================================================
  // Clean up our config from the global scope after reading it
  try {
    delete window.__ANTIC_CONFIG__;
  } catch(e) {
    window.__ANTIC_CONFIG__ = undefined;
  }

})();

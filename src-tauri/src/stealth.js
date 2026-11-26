// Antic Browser — fingerprint layer.
// Injected by the Rust CDP controller (src/cdp.rs) before any page script runs:
//   * pages/frames: Page.addScriptToEvaluateOnNewDocument
//   * workers:      Runtime.evaluate while the worker is paused on start
// The controller prepends `const __CFG__ = {...};`. Must work in Window and Worker scopes.
// Timezone, locale, hardwareConcurrency, languages and WebRTC are handled natively
// (CDP Emulation / Chromium prefs & flags), so they are NOT touched here.
(function (cfg) {
  'use strict';
  const G = typeof globalThis !== 'undefined' ? globalThis : self;

  // ---------------------------------------------------------------------------
  // Native-looking functions: every patched function reports `[native code]`.
  // ---------------------------------------------------------------------------
  const nativeToString = Function.prototype.toString;
  const fakeSources = new WeakMap();
  const toString = {
    toString() {
      return fakeSources.has(this) ? fakeSources.get(this) : nativeToString.call(this);
    },
  }.toString;
  fakeSources.set(toString, 'function toString() { [native code] }');
  Object.defineProperty(Function.prototype, 'toString', {
    value: toString, writable: true, configurable: true, enumerable: false,
  });

  const nativeName = (fn, name) => {
    fakeSources.set(fn, `function ${name}() { [native code] }`);
    return fn;
  };

  // Replace a prototype getter with one returning `value` (keeps descriptor flags).
  const spoofGetter = (proto, prop, value) => {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.get) return;
    const getter = Object.getOwnPropertyDescriptor({ get [prop]() { return value; } }, prop).get;
    nativeName(getter, `get ${prop}`);
    Object.defineProperty(proto, prop, { ...desc, get: getter });
  };

  // Replace a prototype method with `make(original)`. The installed function is a
  // method-shorthand wrapper: like native methods it has no `prototype`, is not
  // constructible, and keeps the original name/length.
  const patchMethod = (proto, name, make) => {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value;
    const impl = make(original);
    const wrapper = { [name]() { return impl.apply(this, arguments); } }[name];
    Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true });
    nativeName(wrapper, original.name);
    Object.defineProperty(proto, name, { ...desc, value: wrapper });
  };

  // Deterministic per-profile PRNG (same profile → same fingerprint every run).
  const seed = (cfg.seed >>> 0) || 1;
  const noiseAt = (i) => {
    let x = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };

  // ---------------------------------------------------------------------------
  // navigator.deviceMemory (Window + Worker)
  // ---------------------------------------------------------------------------
  if (cfg.deviceMemory) {
    spoofGetter(G.Navigator && G.Navigator.prototype, 'deviceMemory', cfg.deviceMemory);
    spoofGetter(G.WorkerNavigator && G.WorkerNavigator.prototype, 'deviceMemory', cfg.deviceMemory);
  }

  // ---------------------------------------------------------------------------
  // Screen (Window only). Window inner/outer sizes stay real — the window itself
  // is opened with --window-size matching the profile.
  // ---------------------------------------------------------------------------
  if (G.Screen && cfg.screenWidth && cfg.screenHeight) {
    const sp = G.Screen.prototype;
    spoofGetter(sp, 'width', cfg.screenWidth);
    spoofGetter(sp, 'height', cfg.screenHeight);
    spoofGetter(sp, 'availWidth', cfg.screenWidth);
    spoofGetter(sp, 'availHeight', cfg.screenHeight - 40); // Windows taskbar
    spoofGetter(sp, 'availLeft', 0);
    spoofGetter(sp, 'availTop', 0);
  }

  // ---------------------------------------------------------------------------
  // Touch
  // ---------------------------------------------------------------------------
  if (cfg.touch && G.Navigator) {
    spoofGetter(G.Navigator.prototype, 'maxTouchPoints', 10);
  }

  // ---------------------------------------------------------------------------
  // WebGL vendor / renderer (WebGL1 + WebGL2, Window + Worker/OffscreenCanvas)
  // ---------------------------------------------------------------------------
  if (cfg.webglVendor && cfg.webglRenderer) {
    const UNMASKED_VENDOR = 0x9245, UNMASKED_RENDERER = 0x9246;
    const patchGl = (Ctx) => {
      if (!Ctx) return;
      patchMethod(Ctx.prototype, 'getParameter', (orig) => function getParameter(p) {
        if (p === UNMASKED_VENDOR) return cfg.webglVendor;
        if (p === UNMASKED_RENDERER) return cfg.webglRenderer;
        return orig.apply(this, arguments);
      });
    };
    patchGl(G.WebGLRenderingContext);
    patchGl(G.WebGL2RenderingContext);
  }

  // ---------------------------------------------------------------------------
  // Canvas: tiny deterministic noise on read-back. The visible canvas is never
  // modified — noise is applied to a copy / to the returned ImageData only.
  // ---------------------------------------------------------------------------
  const noisePixels = (data) => {
    // Flip the lowest bit of ~1 in 64 channels, positions/values derived from the seed.
    for (let i = 0; i < data.length; i += 4) {
      const n = noiseAt(i >> 2);
      if ((n & 63) === 0) {
        const ch = (n >>> 6) % 3;
        data[i + ch] ^= 1;
      }
    }
  };

  if (G.CanvasRenderingContext2D) {
    const ctxProto = G.CanvasRenderingContext2D.prototype;
    const rawGetImageData = ctxProto.getImageData; // untouched original

    patchMethod(ctxProto, 'getImageData', (orig) => function getImageData() {
      const img = orig.apply(this, arguments);
      try { noisePixels(img.data); } catch (_) {}
      return img;
    });

    // Export through a noised copy so the page's own canvas stays pixel-exact.
    const noisedCopy = (canvas) => {
      const w = canvas.width, h = canvas.height;
      if (!w || !h || w * h > 4096 * 4096 || !G.document) return null;
      const copy = G.document.createElement('canvas');
      copy.width = w; copy.height = h;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const img = rawGetImageData.call(ctx, 0, 0, w, h);
      noisePixels(img.data);
      ctx.putImageData(img, 0, 0);
      return copy;
    };

    if (G.HTMLCanvasElement) {
      for (const name of ['toDataURL', 'toBlob']) {
        patchMethod(G.HTMLCanvasElement.prototype, name, (orig) => function () {
          try {
            const copy = noisedCopy(this);
            if (copy) return orig.apply(copy, arguments);
          } catch (_) {}
          return orig.apply(this, arguments);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Audio: deterministic sub-audible noise on rendered buffers.
  // ---------------------------------------------------------------------------
  if (G.AudioBuffer) {
    const touched = new WeakSet();
    const addNoise = (buf, arr) => {
      if (touched.has(arr)) return;
      touched.add(arr);
      for (let i = 0; i < arr.length; i += 100) {
        arr[i] += ((noiseAt(i) % 1000) - 500) * 1e-9;
      }
    };
    patchMethod(G.AudioBuffer.prototype, 'getChannelData', (orig) => function getChannelData() {
      const arr = orig.apply(this, arguments);
      try { addNoise(this, arr); } catch (_) {}
      return arr;
    });
  }
  if (G.AnalyserNode) {
    patchMethod(G.AnalyserNode.prototype, 'getFloatFrequencyData', (orig) => function getFloatFrequencyData(array) {
      const r = orig.apply(this, arguments);
      try { for (let i = 0; i < array.length; i += 10) array[i] += ((noiseAt(i) % 100) - 50) * 1e-4; } catch (_) {}
      return r;
    });
  }
})(__CFG__);

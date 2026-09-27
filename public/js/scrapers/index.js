// MORI CORE SCRAPER ENGINE — SECURE RUNTIME LOADER (WITH OTA HOT-PATCHING)
// Protected under GNU General Public License v3.0.
// All rights reserved (C) 2026 coflyn.

import * as utils from "../utils/index.js";
import * as urlUtils from "../utils/urlUtils.js";
import * as core from "../modules/core.js";
import { inflateSync } from "../vendor/inflate.min.js";
import { scraperFetch } from "./httpHelper.js";

export * from "./httpHelper.js";

// Bundled baseline version
export const BUNDLED_SCRAPER_VERSION = 2;
window.__MORI_BUNDLED_SCRAPER_VERSION__ = BUNDLED_SCRAPER_VERSION;

// Expose dependencies to global bridge for the compiled core
window.__moriDeps = { utils, urlUtils, core };

let _corePromise = null;

async function obtainEngineSecret(challenge) {
  // 1. Android Native Bridge (Main or Share Bridge)
  const androidBridge = window.MoriMainBridge || window.MoriShareBridge;
  if (typeof androidBridge?.getEngineSecurityKey === "function") {
    try {
      const hex = androidBridge.getEngineSecurityKey(challenge);
      if (hex === "UNAUTHORIZED_CLONE") {
        throw new Error("Mori Engine: Unauthorized application distribution.");
      }
      if (hex && hex.length >= 32) return hex;
    } catch (e) {
      if (e.message?.includes("Unauthorized")) throw e;
    }
  }

  // 2. Desktop Tauri Native Bridge (Rust machine code / precompiled static binary)
  if (window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.invoke) {
    const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.invoke;
    try {
      const hex = await invoke("tauri_get_engine_key", { challenge });
      if (hex && hex.length >= 32) return hex;
    } catch (e) {
      console.error("[Mori Engine] Native desktop security verification failed:", e);
    }
  }

  // 3. iOS Capacitor Native Bridge (precompiled binary xcframework)
  const isIos = window.Capacitor?.getPlatform?.() === "ios";
  if (isIos) {
    try {
      const appInfo = await window.Capacitor?.Plugins?.App?.getInfo?.();
      if (appInfo && appInfo.id && appInfo.id !== "com.mori.downloader") {
        throw new Error("Mori Engine: Unauthorized application distribution.");
      }

      const secPlugin = window.Capacitor?.Plugins?.MoriSecurity || window.MoriSecurity;
      if (secPlugin?.getEngineSecurityKey) {
        const res = await secPlugin.getEngineSecurityKey({ challenge });
        if (res?.key && res.key.length >= 32) return res.key;
      }
    } catch (e) {
      if (e.message?.includes("Unauthorized")) throw e;
      console.error("[Mori Engine] Native iOS security verification failed:", e);
    }
  }

  throw new Error("Mori Engine: Native security verification failed.");
}

async function loadCoreScrapers() {
  if (_corePromise) return _corePromise;
  _corePromise = (async () => {
    let arrayBuf = null;
    let isFromOtaPatch = false;

    // A. Check for OTA Patched scrapers.bin in localStorage
    try {
      const patchedB64 = localStorage.getItem("mori_patched_scraper_bin");
      const activeVer = parseInt(localStorage.getItem("mori_active_scraper_version") || "0", 10);
      if (patchedB64 && activeVer >= BUNDLED_SCRAPER_VERSION) {
        const binStr = atob(patchedB64);
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
        arrayBuf = bytes.buffer;
        isFromOtaPatch = true;
        console.log(`[Mori Engine] Loaded OTA patched scraper core v${activeVer}`);
      }
    } catch (otaErr) {
      console.warn("[Mori Engine] OTA patch load warning:", otaErr);
    }

    try {
      // B. Fallback to bundled scrapers.bin if no valid patch was found
      if (!arrayBuf) {
        // 1. Android Native Bridge direct asset read
        const androidBridge = window.MoriMainBridge || window.MoriShareBridge;
        if (typeof androidBridge?.getScrapersBinaryBase64 === "function") {
          try {
            const b64 = androidBridge.getScrapersBinaryBase64();
            if (b64) {
              const binStr = atob(b64);
              const len = binStr.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
              arrayBuf = bytes.buffer;
            }
          } catch (_) {}
        }

        // 2. Desktop Tauri Native Bridge
        if (!arrayBuf && (window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.invoke)) {
          const invoke = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || window.__TAURI__?.invoke;
          try {
            const rawBytes = await invoke("tauri_read_file_bytes", { path: "public/js/scrapers.bin" });
            arrayBuf = new Uint8Array(rawBytes).buffer;
          } catch (_) {}
        }

        // 3. Capacitor Filesystem Plugin
        if (!arrayBuf && window.Capacitor?.Plugins?.Filesystem) {
          try {
            const fs = window.Capacitor.Plugins.Filesystem;
            const readRes = await fs.readFile({ path: "public/js/scrapers.bin" });
            if (readRes?.data) {
              const binStr = atob(readRes.data);
              const len = binStr.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
              arrayBuf = bytes.buffer;
            }
          } catch (_) {}
        }

        // 4. Relative Fetch API
        if (!arrayBuf) {
          const binUrls = ["js/scrapers.bin", "/js/scrapers.bin", "./js/scrapers.bin", "file:///android_asset/public/js/scrapers.bin"];
          for (const u of binUrls) {
            try {
              const res = await fetch(u);
              if (res.ok) {
                arrayBuf = await res.arrayBuffer();
                break;
              }
            } catch (_) {}
          }
        }

        // 5. XMLHttpRequest Fallback
        if (!arrayBuf && typeof XMLHttpRequest !== "undefined") {
          const tryXhr = (url) => new Promise((resolve) => {
            try {
              const xhr = new XMLHttpRequest();
              xhr.open("GET", url, true);
              xhr.responseType = "arraybuffer";
              xhr.onload = () => {
                if (xhr.status === 200 || (xhr.status === 0 && xhr.response && xhr.response.byteLength > 0)) {
                  resolve(xhr.response);
                } else {
                  resolve(null);
                }
              };
              xhr.onerror = () => resolve(null);
              xhr.send();
            } catch (_) {
              resolve(null);
            }
          });
          for (const u of ["js/scrapers.bin", "./js/scrapers.bin", "file:///android_asset/public/js/scrapers.bin"]) {
            arrayBuf = await tryXhr(u);
            if (arrayBuf) break;
          }
        }
      }

      if (!arrayBuf) throw new Error("Could not locate scrapers.bin binary payload");

      const bytes = new Uint8Array(arrayBuf);
      
      // Dynamic handshake with native security layer
      const challenge = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      const hexKey = await obtainEngineSecret(challenge);
      
      if (!hexKey || hexKey.length < 32) {
        throw new Error("Security verification handshake failed");
      }

      const key = new Uint8Array(hexKey.length / 2);
      for (let i = 0; i < key.length; i++) {
        const encByte = parseInt(hexKey.substring(i * 2, i * 2 + 2), 16);
        const ch = challenge.charCodeAt(i % challenge.length);
        key[i] = encByte ^ ch;
      }

      // Decrypt payload
      const deobf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        deobf[i] = bytes[i] ^ key[i % key.length] ^ ((i * 7) & 0xff);
      }

      // Decompress payload
      let scriptText = null;
      try {
        const decompressedBytes = inflateSync(deobf);
        scriptText = new TextDecoder().decode(decompressedBytes);
      } catch (infErr) {
        if (typeof DecompressionStream !== "undefined") {
          try {
            const ds = new DecompressionStream("deflate-raw");
            const writer = ds.writable.getWriter();
            writer.write(deobf);
            writer.close();
            const decompressedBuf = await new Response(ds.readable).arrayBuffer();
            scriptText = new TextDecoder().decode(decompressedBuf);
          } catch (dsErr) {
            console.error("[Mori Engine] Decompression failed:", dsErr);
          }
        }
      }

      if (!scriptText) throw new Error("Could not decompress Mori scraper bytecode");

      const fn = new Function(
        scriptText +
          "\nreturn typeof __MoriCoreScrapers !== 'undefined' ? __MoriCoreScrapers : (typeof window !== 'undefined' ? window.__MoriCoreScrapers : null);"
      );
      const mod = fn();

      if (!mod) {
        throw new Error("Mori Engine: Failed to instantiate core scraper modules.");
      }

      window.__MoriCoreScrapers = mod;

      console.log(`[Mori Engine] Core scrapers initialized successfully (${isFromOtaPatch ? "OTA Patch" : "Bundled"} v${window.__MORI_BUNDLED_SCRAPER_VERSION__}).`);
      return window.__MoriCoreScrapers;
    } catch (e) {
      // Safe Mode Auto-Recovery: If OTA patch was corrupt, discard it and reload once
      if (isFromOtaPatch) {
        console.warn("[Mori Engine] Corrupted OTA patch detected, clearing and resetting to bundled core...", e);
        localStorage.removeItem("mori_patched_scraper_bin");
        localStorage.removeItem("mori_active_scraper_version");
        _corePromise = null;
        return loadCoreScrapers();
      }
      console.error("[Mori Engine] Fatal initialization error:", e);
      if (typeof window.showFatalErrorModal === "function") {
        window.showFatalErrorModal(e.message || String(e));
      }
      throw e;
    }
  })();
  return _corePromise;
}

export async function scrapeTikTok(...args) { return (await loadCoreScrapers()).scrapeTikTok(...args); }
export function setTikTokSource(...args) { loadCoreScrapers().then(m => m.setTikTokSource(...args)); }

export async function scrapeYouTube(...args) { return (await loadCoreScrapers()).scrapeYouTube(...args); }
export function setYouTubeSource(...args) { loadCoreScrapers().then(m => m.setYouTubeSource(...args)); }

export async function scrapeInstagram(...args) { return (await loadCoreScrapers()).scrapeInstagram(...args); }
export function setInstagramSource(...args) { loadCoreScrapers().then(m => m.setInstagramSource(...args)); }

export async function scrapeTwitter(...args) { return (await loadCoreScrapers()).scrapeTwitter(...args); }
export function setTwitterSource(...args) { loadCoreScrapers().then(m => m.setTwitterSource(...args)); }

export async function scrapeSpotify(...args) { return (await loadCoreScrapers()).scrapeSpotify(...args); }
export function setSpotifySource(...args) { loadCoreScrapers().then(m => m.setSpotifySource(...args)); }

export async function scrapeBilibili(...args) { return (await loadCoreScrapers()).scrapeBilibili(...args); }
export async function scrapePixiv(...args) { return (await loadCoreScrapers()).scrapePixiv(...args); }
export async function scrapeRedNote(...args) { return (await loadCoreScrapers()).scrapeRedNote(...args); }
export async function scrapeDouyin(url, ...rest) {
  const originalUrl = url;
  let targetUrl = url;

  if (typeof url === "string" && (url.includes("v.douyin.com") || url.includes("/share/slides/"))) {
    try {
      let resolvedUrl = url;
      if (url.includes("v.douyin.com")) {
        const fetchRes = await scraperFetch({
          url,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          },
          rawResponse: true
        }, "Douyin Resolver");
        if (fetchRes?.url) resolvedUrl = fetchRes.url;
      }

      const slidesMatch = resolvedUrl.match(new RegExp("share/slides/([0-9]{15,22})", "i"));
      if (slidesMatch && slidesMatch[1]) {
        targetUrl = "https://www.iesdouyin.com/share/video/" + slidesMatch[1] + "/";
      } else if (resolvedUrl && resolvedUrl !== url) {
        targetUrl = resolvedUrl;
      }
    } catch (e) {
      console.warn("[Mori Engine] Douyin resolver warning:", e);
    }
  }

  const core = await loadCoreScrapers();
  let res;
  try {
    res = await core.scrapeDouyin(targetUrl, ...rest);
    if (!res || !res.status) {
      await new Promise(r => setTimeout(r, 400));
      res = await core.scrapeDouyin(targetUrl, ...rest);
    }
  } catch (err) {
    await new Promise(r => setTimeout(r, 400));
    res = await core.scrapeDouyin(targetUrl, ...rest);
  }

  if (res) {
    if (res.result) res.result.sourceUrl = originalUrl;
    if (res.data) res.data.sourceUrl = originalUrl;
    res.sourceUrl = originalUrl;
  }
  return res;
}
export async function scrapeThreads(...args) { return (await loadCoreScrapers()).scrapeThreads(...args); }
export async function scrapePinterest(...args) { return (await loadCoreScrapers()).scrapePinterest(...args); }
export async function scrapeAppleMusic(...args) { return (await loadCoreScrapers()).scrapeAppleMusic(...args); }
export async function scrapeFacebook(...args) { return (await loadCoreScrapers()).scrapeFacebook(...args); }
export async function scrapeBandcamp(...args) { return (await loadCoreScrapers()).scrapeBandcamp(...args); }

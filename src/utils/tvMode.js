// TV mode orchestration for the Android WebView build.
// Desktop/web builds never touch this (guarded by isAndroid()).
//
// Contract:
//  - localStorage["streambert_tv_mode"] is the source of truth so a WebView
//    reload keeps the mode intent.
//  - body.tv-mode CSS class drives the desktop-style landscape stylesheet.
//  - window.StreambertNative.setTvMode(enabled) asks native to lock
//    landscape / restore portrait (expo-screen-orientation on the RN side).
import { isAndroid } from "./platform.js";

const KEY = "streambert_tv_mode";

export function isTvModeOn() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function applyTvModeClass(on) {
  try {
    document.body?.classList.toggle("tv-mode", !!on);
  } catch {}
}

/**
 * Toggle tv mode. Persists intent first, applies the CSS class, then asks the
 * native bridge to lock/unlock orientation. Silently no-ops off-Android.
 * @param {boolean} on
 * @returns {Promise<{tvMode:boolean}>}
 */
export async function requestTvMode(on) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  applyTvModeClass(on);
  if (!isAndroid()) return { tvMode: on };
  if (window.StreambertNative?.setTvMode) {
    const res = await window.StreambertNative.setTvMode(!!on);
    return { tvMode: !!(res && res.tvMode !== undefined ? res.tvMode : on) };
  }
  return { tvMode: on };
}

/**
 * Called once at app boot: restores the css class and, if tv mode intent was
 * persisted, re-asserts the landscape lock (survives WebView reload, app
 * resume, and return-from-external-player).
 */
export async function syncTvModeOnBoot() {
  const on = isTvModeOn();
  applyTvModeClass(on);
  if (on && isAndroid() && window.StreambertNative?.setTvMode) {
    try {
      await window.StreambertNative.setTvMode(true);
    } catch {
      /* native may be unavailable; css class still applied */
    }
  }
  return on;
}

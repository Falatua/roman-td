// Mobile.ts — central mobile / touch / orientation utilities.
// Built 2026-05-22 (M1). Other modules import from here so the
// detection rule + behavioral flags live in one place. Desktop code
// paths are unchanged when isMobile() returns false (the default).
//
// Detection rule:
//   "Mobile" = (coarse-pointer device) AND (max viewport dimension < 1100)
//   This catches phones in any orientation AND small tablets that don't
//   have room for the 1100px desktop layout, while leaving desktop +
//   laptop + iPad-Pro-class tablets untouched.
//
// The result is computed ONCE at module load and cached. We don't
// re-evaluate on resize because: (a) a desktop tab being resized down
// shouldn't suddenly switch to touch UX, (b) phones rotating between
// portrait/landscape stay mobile either way, (c) the orientation hook
// below handles the layout reflow separately.

const COARSE_POINTER_QUERY = '(pointer: coarse)';
const TOUCH_CAPABLE = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

let _isMobileCache: boolean | null = null;

export function isMobile(): boolean {
  if (_isMobileCache !== null) return _isMobileCache;
  if (typeof window === 'undefined') { _isMobileCache = false; return false; }
  const coarse = window.matchMedia ? window.matchMedia(COARSE_POINTER_QUERY).matches : false;
  const smallScreen = Math.max(window.innerWidth, window.innerHeight) < 1100;
  _isMobileCache = (coarse || TOUCH_CAPABLE) && smallScreen;
  return _isMobileCache;
}

export function isTouchCapable(): boolean {
  return TOUCH_CAPABLE;
}

export function isPortraitMobile(): boolean {
  if (!isMobile()) return false;
  if (typeof window === 'undefined') return false;
  return window.matchMedia
    ? window.matchMedia('(orientation: portrait)').matches
    : window.innerHeight > window.innerWidth;
}

// Stash detection on globals so non-TS modules (Pixi callbacks, ad-hoc
// inline checks) can read `window.__isMobile` without an import.
// Also stamp `html.mobile-mode` so CSS media-queries that need to fire
// without depending on `pointer: coarse` (some headless / DevTools
// emulation reports `pointer: fine`) have a reliable hook.
if (typeof window !== 'undefined') {
  (window as any).__isMobile = isMobile();
  (window as any).__isTouch = TOUCH_CAPABLE;
  try {
    const html = document.documentElement;
    if (isMobile()) html.classList.add('mobile-mode');
    if (TOUCH_CAPABLE) html.classList.add('touch-capable');
    if (isPortraitMobile()) html.classList.add('portrait-mode');
    // ?forceMobile=1 query-string override for testing the mobile
    // layout from a desktop browser (Chrome MCP, devtools emulators
    // that don't fully simulate coarse-pointer, etc.). Adds the same
    // class the real detection adds; CSS treats them identically.
    if (new URLSearchParams(window.location.search).get('forceMobile') === '1') {
      html.classList.add('mobile-mode');
      html.classList.add('touch-capable');
    }
  } catch { /* ignore — DOM not ready edge case */ }
}

// Listen to orientationchange + resize and fire a custom event so any
// listener (canvas-fit, modal layout, etc.) can react without each
// duplicating the event wiring. Debounced via rAF so a single rotation
// fires once even though both events typically fire together.
let _rafQueued = false;
function scheduleOrientationDispatch() {
  if (_rafQueued || typeof window === 'undefined') return;
  _rafQueued = true;
  requestAnimationFrame(() => {
    _rafQueued = false;
    window.dispatchEvent(new CustomEvent('rtd:viewport-change', {
      detail: {
        isMobile: isMobile(),
        isPortrait: isPortraitMobile(),
        w: window.innerWidth,
        h: window.innerHeight
      }
    }));
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('orientationchange', scheduleOrientationDispatch);
  window.addEventListener('resize', scheduleOrientationDispatch);
  // visualViewport fires on iOS keyboard show/hide + URL-bar collapse,
  // which changes the usable area. Critical for canvas-fit accuracy.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleOrientationDispatch);
  }
}

// 2026-05-22 UX HM — Haptic feedback. Single helper everywhere so we
// can later add a Settings toggle to disable it without auditing every
// vibrate call site. iOS Safari does not support navigator.vibrate, so
// this no-ops there silently. Android Chrome + most other touch browsers
// honor it. Patterns are deliberately short (10–30ms) per Apple HIG
// guidance against haptic over-use.
export type HapticIntensity = 'light' | 'medium' | 'success' | 'warning';
const HAPTIC_PATTERNS: Record<HapticIntensity, number | number[]> = {
  light:   10,
  medium:  18,
  success: [12, 40, 22],
  warning: [22, 60, 22, 60, 22]
};
let _hapticEnabled = true;
export function setHapticEnabled(on: boolean): void { _hapticEnabled = !!on; }
export function isHapticEnabled(): boolean { return _hapticEnabled; }
export function vibrate(intensity: HapticIntensity = 'light'): void {
  if (!_hapticEnabled) return;
  if (typeof navigator === 'undefined') return;
  if (typeof (navigator as any).vibrate !== 'function') return;
  if (!isMobile()) return;     // never vibrate on desktop accidentally
  try { (navigator as any).vibrate(HAPTIC_PATTERNS[intensity]); } catch { /* ignore */ }
}

// 2026-05-22 UX HM — Reduced-motion preference. Reads BOTH the OS-level
// `prefers-reduced-motion` AND a user-opt-in toggle stored in
// localStorage so SettingsPanel can flip it without touching the OS.
const REDUCED_MOTION_KEY = 'roman_td_reduce_motion';
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    if (localStorage.getItem(REDUCED_MOTION_KEY) === '1') return true;
  } catch { /* ignore */ }
  return false;
}
export function setReduceMotionOptIn(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) localStorage.setItem(REDUCED_MOTION_KEY, '1');
    else    localStorage.removeItem(REDUCED_MOTION_KEY);
    document.documentElement.classList.toggle('reduce-motion-opt-in', on);
  } catch { /* ignore */ }
}
// Sync the class on page load so the CSS rule fires immediately.
if (typeof window !== 'undefined') {
  try {
    if (localStorage.getItem(REDUCED_MOTION_KEY) === '1') {
      document.documentElement.classList.add('reduce-motion-opt-in');
    }
    // Reduce-Decoration opt-in (separate key, no CSS effect — drives
    // window.__reduceDecor that the RenderEngine reads when rebuilding
    // the prop layer). Setting both the global flag and the class so
    // future CSS-driven decor rules can also key off it.
    if (localStorage.getItem('roman_td_reduce_decoration') === '1') {
      (window as any).__reduceDecor = true;
      document.documentElement.classList.add('reduce-decor');
    }
  } catch { /* ignore */ }
}

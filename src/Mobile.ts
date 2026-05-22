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
if (typeof window !== 'undefined') {
  (window as any).__isMobile = isMobile();
  (window as any).__isTouch = TOUCH_CAPABLE;
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

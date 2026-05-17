// ScrollCues — 2026-05 v11 QoL feature.
//
// Players couldn't tell when modal panels were scrollable, so they'd miss
// content below the fold. This module injects a prominent gold-tinted
// scrollbar style for any element tagged with `data-scrollable` PLUS a
// subtle bottom fade gradient + a "▼ MORE BELOW" hint that auto-toggles
// based on whether the element actually overflows.
//
// Usage:
//   ensureScrollCueStyle();       // call once at app boot (idempotent)
//   markScrollable(panel);        // tags + wires a ResizeObserver
//
// The hint anchors itself with `position: sticky` so it floats above the
// element's bottom edge regardless of scroll position.

const STYLE_ID = 'rtd-scroll-cue-style';

export function ensureScrollCueStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
    /* Tag any scrollable container with data-scrollable to get this
       prominent gold-tinted scrollbar treatment. */
    [data-scrollable] {
      scrollbar-width: thin;
      scrollbar-color: #d4af37 #1a1208;
      position: relative;
    }
    [data-scrollable]::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    [data-scrollable]::-webkit-scrollbar-track {
      background: #1a1208;
      border-left: 1px solid #3a3025;
    }
    [data-scrollable]::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, #d4af37, #5a4a30);
      border: 1px solid #3a2a14;
      border-radius: 2px;
    }
    [data-scrollable]::-webkit-scrollbar-thumb:hover {
      background: linear-gradient(180deg, #ffd34d, #d4af37);
    }
    [data-scrollable]::-webkit-scrollbar-corner {
      background: #1a1208;
    }
    /* Bottom fade gradient — appears only when the container overflows
       AND the user hasn't scrolled to the bottom. Implemented via a
       pseudo-class plus the data attribute toggled by JS. */
    [data-scrollable][data-overflows="true"] {
      box-shadow: inset 0 -28px 16px -18px rgba(212,175,55,0.20);
    }
    /* "▼ MORE BELOW" floating hint */
    .rtd-scroll-hint {
      position: sticky;
      bottom: 4px;
      margin: 0 auto;
      width: fit-content;
      pointer-events: none;
      font-family: 'Courier New', monospace;
      font-size: 10px;
      letter-spacing: 2px;
      color: #ffd34d;
      background: rgba(26,18,8,0.85);
      border: 1px solid #d4af37;
      padding: 3px 10px;
      box-shadow: 0 0 10px rgba(212,175,55,0.4);
      opacity: 0;
      transition: opacity 0.18s ease-out;
      z-index: 5;
      transform: translateY(-2px);
    }
    .rtd-scroll-hint.visible {
      opacity: 1;
      animation: rtd-scroll-hint-bob 1.4s ease-in-out infinite;
    }
    @keyframes rtd-scroll-hint-bob {
      0%, 100% { transform: translateY(-2px); }
      50%      { transform: translateY(2px); }
    }
  `;
  document.head.appendChild(st);
}

// Mark an element as scrollable: applies the gold scrollbar styling and
// wires the "▼ MORE BELOW" hint to auto-show/hide based on overflow +
// current scroll position. Safe to call multiple times on the same node;
// the wire-up flag prevents duplicate observers.
export function markScrollable(el: HTMLElement) {
  if (!el) return;
  ensureScrollCueStyle();
  el.setAttribute('data-scrollable', '');
  if ((el as any).__scrollCuesWired) return;
  (el as any).__scrollCuesWired = true;

  // Inject the hint chip as a sticky child. Append after the element's
  // existing children so it sits at the bottom of the scroll content.
  let hint = el.querySelector('.rtd-scroll-hint') as HTMLElement | null;
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'rtd-scroll-hint';
    hint.textContent = '▼ SCROLL FOR MORE';
    el.appendChild(hint);
  }

  const recompute = () => {
    const overflows = el.scrollHeight > el.clientHeight + 2;
    el.setAttribute('data-overflows', overflows ? 'true' : 'false');
    if (!overflows) {
      hint?.classList.remove('visible');
      return;
    }
    // Hide hint when user has scrolled to within 12px of the bottom.
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
    if (atBottom) hint?.classList.remove('visible');
    else hint?.classList.add('visible');
  };

  el.addEventListener('scroll', recompute, { passive: true });
  // Watch for content changes that might toggle overflow status.
  if (typeof ResizeObserver !== 'undefined') {
    try {
      const ro = new ResizeObserver(recompute);
      ro.observe(el);
      (el as any).__scrollCuesObserver = ro;
    } catch { /* fallback to manual */ }
  }
  // Run once after a tick so layout settles.
  setTimeout(recompute, 30);
}

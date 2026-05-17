import { tex } from './Assets';

// Mercator visual: a center-of-screen panel that appears whenever the
// traveling merchant is in town (build phase before the upcoming boss
// wave). Player can click VIEW WARES to open the shop or DISMISS to
// collapse it into a side tab that stays visible until the wave starts.
//
// 2026-05 v10 redesign: simpler, more professional layout. The old
// version stacked an EB_MERCATOR sheet-background, a wagon banner, and
// overlapping wave-modifier UI behind it — visually chaotic. New design:
// a clean dark panel with the merchant sprite as the focal point, three
// compact info rows (towers / items / lives), and a flat 2-button row.

export interface MercatorBannerHooks {
  onView: () => void;
}

function mercatorImgSrc(key: string): string | null {
  const t = tex(key);
  if (!t) return null;
  const res: any = t.baseTexture?.resource;
  return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
}

const BANNER_ID = 'mercator-banner';
const TAB_ID = 'mercator-tab';
const STYLE_ID = 'mercator-banner-style';

let dismissedForVisitWave = -1;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes mercatorEnter {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.94); }
      100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    @keyframes mercatorTabPulse {
      0%, 100% { box-shadow: 0 0 10px rgba(212,175,55,0.5); }
      50%      { box-shadow: 0 0 20px rgba(212,175,55,0.95); }
    }

    #${BANNER_ID} {
      position: absolute;
      /* 2026-05 v11: moved from top:50% → top:62% so the Mercator card */
      /* clears the pre-wave tip banner (anchored to top:2%, can grow */
      /* tall on multi-mechanic waves). Pair-tuned with main.ts's        */
      /* ensureBannerStack offset so both fit on screen without overlap. */
      left: 50%; top: 62%;
      transform: translate(-50%, -50%);
      width: min(420px, 92%);
      background: linear-gradient(180deg, #1a1209 0%, #0c0a08 100%);
      border: 3px solid #d4af37;
      box-shadow: 0 6px 28px rgba(0,0,0,0.75);
      color: #f0e3b8;
      z-index: 70;
      font-family: 'Courier New', monospace;
      animation: mercatorEnter 0.28s ease-out both;
    }

    #${BANNER_ID} .merc-head {
      background: linear-gradient(180deg, #2a1d0e, #1a1209);
      border-bottom: 2px solid #5a4a30;
      padding: 14px 18px 12px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    #${BANNER_ID} .merc-portrait {
      width: 64px; height: 64px;
      flex-shrink: 0;
      background: #0c0a08;
      border: 2px solid #d4af37;
      box-shadow: inset 0 0 8px rgba(212,175,55,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${BANNER_ID} .merc-portrait img {
      width: 56px;
      height: 56px;
      image-rendering: pixelated;
    }
    #${BANNER_ID} .merc-headline { flex: 1; min-width: 0; }
    #${BANNER_ID} .merc-title {
      font-size: 16px;
      letter-spacing: 3px;
      font-weight: bold;
      color: #ffd34d;
      margin: 0 0 3px;
    }
    #${BANNER_ID} .merc-sub {
      font-size: 11px;
      letter-spacing: 0.5px;
      color: #cdb98a;
      line-height: 1.4;
      margin: 0;
    }

    #${BANNER_ID} .merc-body { padding: 12px 16px 10px; }
    #${BANNER_ID} .merc-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 10px;
      background: rgba(20, 16, 12, 0.7);
      border-left: 3px solid #d4af37;
      margin-bottom: 5px;
      font-size: 11px;
      line-height: 1.4;
    }
    #${BANNER_ID} .merc-row.is-tower { border-left-color: #ff5050; }
    #${BANNER_ID} .merc-row.is-item  { border-left-color: #ffaa33; }
    #${BANNER_ID} .merc-row.is-life  { border-left-color: #88ff88; }
    #${BANNER_ID} .merc-row-label {
      font-size: 9px;
      letter-spacing: 2px;
      font-weight: bold;
      width: 78px;
      flex-shrink: 0;
    }
    #${BANNER_ID} .merc-row.is-tower .merc-row-label { color: #ff5050; }
    #${BANNER_ID} .merc-row.is-item  .merc-row-label { color: #ffaa33; }
    #${BANNER_ID} .merc-row.is-life  .merc-row-label { color: #88ff88; }
    #${BANNER_ID} .merc-row-body { color: #fff8e0; flex: 1; }

    #${BANNER_ID} .merc-foot {
      padding: 10px 16px 14px;
      border-top: 2px solid #5a4a30;
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    #${BANNER_ID} button {
      font-family: inherit;
      font-size: 12px;
      letter-spacing: 2px;
      padding: 8px 16px;
      cursor: pointer;
      border: 1px solid #5a4a30;
      background: #2a1d0e;
      color: #ffd34d;
      transition: background 0.1s;
    }
    #${BANNER_ID} button:hover { background: #3a2818; }
    #${BANNER_ID} button.primary {
      background: linear-gradient(180deg, #d4af37, #8a6a20);
      color: #1a1209;
      font-weight: bold;
      border-color: #d4af37;
    }
    #${BANNER_ID} button.primary:hover {
      background: linear-gradient(180deg, #ffd34d, #b58820);
    }

    /* 2026-05 v10 — Mercator floating tab REDESIGN. Was a thin vertical
       strip at right:8px top:38% (cramped, easy to miss). Now lives in
       the BOTTOM-RIGHT corner as a horizontal pill with a portrait, a
       MERCATOR label, and a price hint. Same click-to-open behavior,
       far better readability. */
    #${TAB_ID} {
      position: absolute;
      right: 12px; bottom: 12px;
      min-width: 220px;
      padding: 10px 14px 10px 10px;
      background: linear-gradient(180deg, #2d1d0e, #1a1209);
      border: 3px solid #d4af37;
      color: #ffd34d;
      cursor: pointer;
      z-index: 65;
      font-family: 'Courier New', monospace;
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow:
        0 6px 20px rgba(0,0,0,0.65),
        0 0 14px rgba(212,175,55,0.55),
        inset 0 0 12px rgba(212,175,55,0.10);
      animation: mercatorTabPulse 2.2s ease-in-out infinite;
      transition: transform 0.12s, box-shadow 0.12s;
    }
    #${TAB_ID}:hover {
      transform: translateY(-2px);
      box-shadow:
        0 8px 26px rgba(0,0,0,0.75),
        0 0 22px rgba(255,211,77,0.85),
        inset 0 0 14px rgba(212,175,55,0.18);
    }
    #${TAB_ID} .tab-portrait {
      width: 48px; height: 48px;
      background: #0c0a08;
      border: 2px solid #d4af37;
      box-shadow: inset 0 0 8px rgba(212,175,55,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    #${TAB_ID} .tab-portrait img {
      width: 42px; height: 42px;
      image-rendering: pixelated;
      display: block;
    }
    #${TAB_ID} .tab-portrait .tab-icon {
      font-size: 26px;
      color: #d4af37;
      line-height: 1;
    }
    #${TAB_ID} .tab-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    #${TAB_ID} .tab-title {
      font-size: 13px;
      font-weight: bold;
      color: #ffd34d;
      letter-spacing: 3px;
      line-height: 1.1;
      text-shadow: 1px 1px 0 #000;
    }
    #${TAB_ID} .tab-sub {
      font-size: 9.5px;
      color: #cdb98a;
      letter-spacing: 0.5px;
      line-height: 1.25;
    }
    #${TAB_ID} .tab-pricerow {
      display: flex;
      gap: 6px;
      margin-top: 3px;
      flex-wrap: wrap;
    }
    #${TAB_ID} .tab-chip {
      font-size: 9px;
      letter-spacing: 1px;
      padding: 1px 5px;
      background: rgba(212,175,55,0.10);
      border: 1px solid rgba(212,175,55,0.45);
      color: #ffd34d;
    }
    #${TAB_ID} .tab-chip.t { color: #ff7777; border-color: rgba(255,80,80,0.55); background: rgba(255,80,80,0.10); }
    #${TAB_ID} .tab-chip.l { color: #88ff88; border-color: rgba(136,255,136,0.55); background: rgba(136,255,136,0.10); }
    #${TAB_ID} .tab-cta {
      margin-left: auto;
      font-size: 10px;
      color: #1a1209;
      background: linear-gradient(180deg, #ffd34d, #b58820);
      border: 1px solid #d4af37;
      padding: 5px 9px;
      letter-spacing: 2px;
      font-weight: bold;
      align-self: stretch;
      display: flex;
      align-items: center;
    }
    #${TAB_ID}:hover .tab-cta {
      background: linear-gradient(180deg, #ffe680, #ca9a30);
    }
  `;
  document.head.appendChild(s);
}

// Show the big center banner. Stamps the visit wave so dismissal is per-visit.
export function showMercatorBanner(parent: HTMLElement, visitWave: number, hooks: MercatorBannerHooks) {
  ensureStyle();
  if (document.getElementById(BANNER_ID)) return; // already up
  if (dismissedForVisitWave === visitWave) {
    // Player previously dismissed — show the side tab instead.
    showMercatorTab(parent, hooks);
    return;
  }
  document.getElementById(TAB_ID)?.remove();

  const banner = document.createElement('div');
  banner.id = BANNER_ID;

  const merchantArt = mercatorImgSrc('MERCATOR');
  const portrait = merchantArt
    ? `<img src="${merchantArt}" alt=""/>`
    : '<span style="font-size:36px;color:#d4af37">⚱</span>';

  banner.innerHTML = `
    <div class="merc-head">
      <div class="merc-portrait">${portrait}</div>
      <div class="merc-headline">
        <h2 class="merc-title">MERCATOR</h2>
        <p class="merc-sub">Traveling merchant. Leaves when next wave begins. Gate Shop stays open beside him.</p>
      </div>
    </div>
    <div class="merc-body">
      <div class="merc-row is-tower">
        <span class="merc-row-label">★ ARMORY</span>
        <span class="merc-row-body">3 random <b style="color:#ff5050">T5</b> towers · <b style="color:#f0c040">50g</b> each</span>
      </div>
      <div class="merc-row is-item">
        <span class="merc-row-label">★ TROPHIES</span>
        <span class="merc-row-body">2 build-defining Legendaries · 1 Rare · 3 Mids</span>
      </div>
      <div class="merc-row is-life">
        <span class="merc-row-label">+ LIVES</span>
        <span class="merc-row-body">Up to 3 lives at <b style="color:#f0c040">7g</b> each</span>
      </div>
    </div>
    <div class="merc-foot">
      <button id="merc-dismiss">MAYBE LATER</button>
      <button class="primary" id="merc-view">BROWSE STOCK</button>
    </div>
  `;
  parent.appendChild(banner);
  banner.querySelector<HTMLButtonElement>('#merc-view')!.onclick = () => {
    hideMercatorBanner();
    hooks.onView();
    showMercatorTab(parent, hooks);
  };
  banner.querySelector<HTMLButtonElement>('#merc-dismiss')!.onclick = () => {
    dismissedForVisitWave = visitWave;
    hideMercatorBanner();
    showMercatorTab(parent, hooks);
  };
}

export function showMercatorTab(parent: HTMLElement, hooks: MercatorBannerHooks) {
  ensureStyle();
  if (document.getElementById(TAB_ID)) return;
  const tab = document.createElement('div');
  tab.id = TAB_ID;
  const merchantArt = mercatorImgSrc('MERCATOR');
  const portraitInner = merchantArt
    ? `<img src="${merchantArt}" alt=""/>`
    : '<span class="tab-icon">⚱</span>';
  // 2026-05 v10: bottom-right pill with portrait, MERCATOR label, a
  // one-line subtitle, three price chips (T5 towers / legendary trophies
  // / lives), and a gold "BROWSE" CTA. Whole pill is clickable; the CTA
  // just gives the eye a clear hit-target.
  tab.innerHTML = `
    <div class="tab-portrait">${portraitInner}</div>
    <div class="tab-text">
      <div class="tab-title">MERCATOR</div>
      <div class="tab-sub">Traveling merchant — this wave only</div>
      <div class="tab-pricerow">
        <span class="tab-chip t">T5 · 50g</span>
        <span class="tab-chip">★ Trophies</span>
        <span class="tab-chip l">+ Lives 7g</span>
      </div>
    </div>
    <div class="tab-cta">BROWSE</div>
  `;
  tab.title = 'Mercator is in town this wave only. Click to view wares — the Gate Shop stays open beside him.';
  tab.onclick = () => hooks.onView();
  parent.appendChild(tab);
}

export function hideMercatorBanner() { document.getElementById(BANNER_ID)?.remove(); }
export function hideMercatorTab() { document.getElementById(TAB_ID)?.remove(); }

// Called when the wave starts — Mercator leaves town entirely.
export function dismissMercatorVisit() {
  hideMercatorBanner();
  hideMercatorTab();
  dismissedForVisitWave = -1;
}

// ─────────────────────────────────────────────────────────────────────
// CHOOSE HERO MODAL (2026-05-19)
//
// The 3-card draft. Fires after name entry at run start. Mounts on
// document.body (NOT #app — full-screen modals inside #app get
// clipped on big monitors). Responsive clamping matches the Hall of
// Glory pattern at Leaderboard.ts:188-221.
//
// Flow:
//   1. draftHeroChoices() returns 3 random hero ids from the 6-pool
//   2. Render 3 hero cards side by side
//   3. Hover: card border brightens to hero tint, scale 1.02
//   4. Click: confirm strip appears (biography + "⚔ MARCH TO WAR")
//   5. March → pickHero(state, heroId) + modal removes itself
//
// The pickHero call queues the hero placement token in
// state.pendingPurchasedTowers with source: 'hero'. The next empty-
// tile click on the canvas drops the hero — see main.ts:4486.
// ─────────────────────────────────────────────────────────────────────

import { GameStateShape } from '../GameState';
import { draftHeroChoices, pickHero, type HeroId } from '../systems/HeroSystem';
import HERO_DEFS from '../data/herodefs.json';

export function showChooseHeroModal(state: GameStateShape): void {
  if (document.getElementById('choose-hero-modal')) return;   // already open

  // Inject the modal-local stylesheet exactly once. Encapsulates
  // entrance fade, hover transitions, and the keyboard-hint pulse so
  // each card / button doesn't need its own inline keyframes string.
  ensureChooseHeroStyle();

  const overlay = document.createElement('div');
  overlay.id = 'choose-hero-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    display: flex; align-items: flex-start; justify-content: center;
    padding: clamp(16px, 3vh, 36px) clamp(8px, 2vw, 24px);
    box-sizing: border-box;
    overflow: auto;
    background: radial-gradient(ellipse at center, rgba(20,8,8,0.92) 0%, rgba(0,0,0,0.97) 80%);
    z-index: 9999;
    font-family: 'Courier New', monospace;
    color: #e8d6a8;
    animation: chmFadeIn 0.32s ease-out;
    backdrop-filter: blur(2px);
  `;

  // Read the player's last hero choice for the ★ LAST PICK badge.
  let lastHeroId: string | null = null;
  try { lastHeroId = localStorage.getItem('roman_td_last_hero_id'); } catch { /* ignore */ }

  // Draft 3 distinct heroes via Fisher-Yates.
  const choices = draftHeroChoices(lastHeroId);

  // Title header + tagline
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: relative;
    width: min(1180px, 96vw);
    max-height: calc(100% - 24px);
    overflow: auto;
    padding: clamp(20px, 3vh, 40px) clamp(20px, 3vw, 40px);
    text-align: center;
  `;
  panel.innerHTML = `
    <div style="font-size: clamp(11px, 1.4vh, 14px); color: #aa6a1a; letter-spacing: 6px; font-weight: 900; margin-bottom: 6px; text-shadow: 1px 1px 0 #000;">ROME CALLS A CHAMPION</div>
    <div style="font-size: clamp(28px, 5vh, 52px); color: #ffd34d; letter-spacing: clamp(4px, 0.8vw, 12px); font-weight: 900; line-height: 1.05; margin-bottom: 6px; text-shadow: 0 0 18px #ffd34d, 4px 4px 0 #1a0808;">CHOOSE YOUR HERO</div>
    <div style="font-size: clamp(11px, 1.4vh, 14px); color: #cdb98a; letter-spacing: 2px; margin-bottom: 4px; font-style: italic;">Three champions stand ready. Only one may answer the legion's call.</div>
    <div class="chm-kbd-hint" style="font-size: 10px; color: #88735a; letter-spacing: 3px; margin-bottom: clamp(18px, 3vh, 32px);">
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">1</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">2</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">3</span>
      keys to focus
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 0 0 8px; background:#1a0e08;">ENTER</span>
      to march · or click
    </div>
  `;

  // Card row — 3 columns on desktop, stacked on phones
  const row = document.createElement('div');
  row.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
    gap: clamp(12px, 2vw, 24px);
    margin-bottom: clamp(18px, 3vh, 32px);
  `;

  const confirmStrip = document.createElement('div');
  confirmStrip.id = 'choose-hero-confirm-strip';
  confirmStrip.style.cssText = `
    margin-top: clamp(12px, 2vh, 24px);
    padding: clamp(14px, 2vh, 22px) clamp(20px, 3vw, 32px);
    border-top: 2px dashed #5a4a30;
    text-align: center;
    display: none;
  `;

  let pickedHero: HeroId | null = null;
  const cards: HTMLElement[] = [];

  // 2026-05-19 — Common selection painter. Used by both mouse click and
  // keyboard (1/2/3 keys). Keeping the visual update in one place
  // means the card scale, dim opacity, and glow always match.
  const selectByIndex = (idx: number) => {
    const heroId = choices[idx];
    const def: any = (HERO_DEFS as any)[heroId];
    pickedHero = heroId;
    for (let i = 0; i < cards.length; i++) {
      const isSel = i === idx;
      cards[i].style.opacity = isSel ? '1' : '0.5';
      cards[i].style.transform = isSel ? 'scale(1.04)' : 'scale(0.95)';
      cards[i].style.boxShadow = isSel
        ? `0 0 30px ${def.visual?.particleColor ?? '#ffd34d'}, 0 0 64px ${def.visual?.particleColor ?? '#ffd34d'}44, inset 0 0 24px ${def.visual?.particleColor ?? '#ffd34d'}22`
        : '0 0 8px rgba(0,0,0,0.6)';
      cards[i].style.borderColor = isSel ? (def.visual?.tierUpColor ?? '#ffd34d') : '#5a4a30';
    }
    confirmStrip.innerHTML = `
      <div style="font-size: clamp(20px, 2.4vh, 28px); color: ${def.visual?.tierUpColor ?? '#ffd34d'}; letter-spacing: 4px; font-weight: 900; margin-bottom: 4px; text-shadow: 0 0 12px ${def.visual?.tierUpColor ?? '#ffd34d'};">${def.name?.toUpperCase()}</div>
      <div style="font-size: clamp(11px, 1.3vh, 13px); color: #cdb98a; letter-spacing: 2px; margin-bottom: 14px;">${def.title ?? ''}</div>
      <div style="font-size: clamp(12px, 1.4vh, 14px); color: #e8d6a8; max-width: 720px; margin: 0 auto 18px; line-height: 1.6; font-style: italic; text-align: center;">"${(def.biography ?? '').replace(/"/g, '”')}"</div>
      <button id="choose-hero-march" type="button" style="
        padding: clamp(10px, 1.6vh, 16px) clamp(28px, 4vw, 56px);
        background: linear-gradient(180deg, #5a3a16, #2a1a08);
        border: 3px solid #ffd34d;
        color: #ffd34d;
        font-family: 'Courier New', monospace;
        font-size: clamp(13px, 1.6vh, 16px);
        letter-spacing: 4px;
        font-weight: 900;
        cursor: pointer;
        box-shadow: 0 0 18px rgba(255,211,77,0.4);
        transition: transform 0.18s cubic-bezier(.2,.8,.2,1), box-shadow 0.22s ease-out;
        text-shadow: 2px 2px 0 #000;
      ">⚔ MARCH TO WAR</button>
    `;
    confirmStrip.style.display = 'block';
    const marchBtn = confirmStrip.querySelector('#choose-hero-march') as HTMLButtonElement;
    marchBtn.onmouseenter = () => { marchBtn.style.transform = 'translateY(-2px) scale(1.02)'; marchBtn.style.boxShadow = '0 0 36px rgba(255,211,77,0.9)'; };
    marchBtn.onmouseleave = () => { marchBtn.style.transform = ''; marchBtn.style.boxShadow = '0 0 18px rgba(255,211,77,0.4)'; };
    marchBtn.onclick = () => {
      if (!pickedHero) return;
      pickHero(state, pickedHero);
      cleanup();
    };
    setTimeout(() => confirmStrip.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  };

  for (let i = 0; i < choices.length; i++) {
    const heroId = choices[i];
    const def: any = (HERO_DEFS as any)[heroId];
    const card = renderHeroCard(heroId, def, lastHeroId === heroId, i + 1);
    const idx = i;
    card.addEventListener('click', () => selectByIndex(idx));
    cards.push(card);
    row.appendChild(card);
  }

  panel.appendChild(row);
  panel.appendChild(confirmStrip);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Keyboard support: 1/2/3 focus a hero, Enter confirms the focused
  // pick. Useful for keyboard players and accessibility — the click
  // path stays the canonical interaction so this is purely additive.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        selectByIndex(idx);
        e.preventDefault();
      }
    } else if (e.key === 'Enter' && pickedHero) {
      pickHero(state, pickedHero);
      cleanup();
      e.preventDefault();
    }
  };
  function cleanup() {
    window.removeEventListener('keydown', onKey);
    overlay.style.animation = 'chmFadeOut 0.22s ease-in forwards';
    setTimeout(() => overlay.remove(), 220);
  }
  window.addEventListener('keydown', onKey);
}

// One-time stylesheet for the modal. Encapsulates @keyframes so they
// don't leak into other inline styles, and centralizes the hover
// transition curve for cards.
function ensureChooseHeroStyle(): void {
  if (document.getElementById('choose-hero-modal-style')) return;
  const style = document.createElement('style');
  style.id = 'choose-hero-modal-style';
  style.textContent = `
    @keyframes chmFadeIn  { from { opacity: 0;   } to { opacity: 1; } }
    @keyframes chmFadeOut { from { opacity: 1;   } to { opacity: 0; } }
    @keyframes chmPulse   { 0%,100% { opacity:0.55; } 50% { opacity:1; } }
    .chm-kbd-hint { animation: chmPulse 2.4s ease-in-out infinite; }
    #choose-hero-modal [data-hero-card] {
      transition: transform 0.22s cubic-bezier(.2,.8,.2,1),
                  border-color 0.22s ease-out,
                  box-shadow 0.28s ease-out,
                  opacity 0.22s ease-out;
    }
    #choose-hero-modal [data-hero-card]:focus { outline: none; }
  `;
  document.head.appendChild(style);
}

// ─── Card renderer ─────────────────────────────────────────────────

function renderHeroCard(heroId: string, def: any, isLastPick: boolean, slot: number): HTMLElement {
  const tint = def.visual?.tierUpColor ?? '#ffd34d';
  const particleColor = def.visual?.particleColor ?? tint;
  // 2026-05-19 — Higgs Field portrait cards. Each hero has a custom
  // pixel-art card image stored in /assets/heroes/hero_card_<id>.png
  // (filename slug = hero id minus the HERO_ prefix, lowercase). The
  // card image gets dropped in as the top banner. If the file is
  // missing (e.g. early dev branches before assets land), the modal
  // falls back to the tinted gradient header generated below.
  const heroSlug = heroId.replace(/^HERO_/, '').toLowerCase();
  const cardImageUrl = `assets/heroes/hero_card_${heroSlug}.png`;

  const card = document.createElement('div');
  card.dataset.heroId = heroId;
  card.dataset.heroCard = '1';
  card.style.cssText = `
    position: relative;
    background: linear-gradient(180deg, rgba(34,25,18,0.96), rgba(10,6,4,0.96));
    border: 3px solid #5a4a30;
    padding: 0;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  `;
  // Hover uses the stylesheet transition declared in ensureChooseHeroStyle.
  card.onmouseenter = () => {
    // Don't fight the selected state if a different card is picked —
    // selectByIndex() already applies tint to the active card. On
    // hover we only nudge the resting card; the selected card's own
    // glow stays intact.
    if (card.style.opacity && parseFloat(card.style.opacity) < 0.9) return;
    card.style.borderColor = tint;
    card.style.transform = card.style.transform.includes('scale(1.04)') ? card.style.transform : 'scale(1.02)';
    card.style.boxShadow = `0 0 24px ${particleColor}66, inset 0 0 16px ${particleColor}22`;
  };
  card.onmouseleave = () => {
    // Only reset if this card is NOT currently the selected one (it
    // would carry the 1.04 scale + saturated glow in that case).
    if (card.style.transform.includes('scale(1.04)')) return;
    card.style.borderColor = '#5a4a30';
    card.style.transform = 'scale(1)';
    card.style.boxShadow = 'none';
  };

  // Slot digit chip (top-left). Mirrors the keyboard hint at the top
  // of the modal so the 1/2/3 mapping is obvious without needing to
  // glance back at the legend.
  const slotChip = `
    <div style="position: absolute; top: 10px; left: 10px; min-width: 22px; height: 22px; padding: 0 6px;
                background: #1a0e08; border: 2px solid ${tint}; color: ${tint};
                display: flex; align-items: center; justify-content: center;
                font-size: 12px; letter-spacing: 1px; font-weight: 900;
                box-shadow: 0 0 10px ${particleColor}66;
                text-shadow: 0 0 6px ${tint};">${slot}</div>
  `;

  // ★ LAST PICK badge
  const lastPickBadge = isLastPick ? `
    <div style="position: absolute; top: 10px; right: 10px; background: #1a0a1a; color: #ffd34d; border: 1px solid #ffd34d; padding: 3px 8px; font-size: 9px; letter-spacing: 2px; font-weight: 900; text-shadow: 1px 1px 0 #000;">★ LAST PICK</div>
  ` : '';

  // Header: the Higgs Field-generated pixel-art portrait card. The
  // generated image already embeds the hero's name, title, and a
  // thematic background — it IS the card visual identity, not just a
  // portrait inside one. Onerror fallback paints the synthetic
  // tinted-letter banner so the modal still renders if assets are
  // missing.
  const portraitBg = `radial-gradient(circle at center, ${particleColor}55 0%, ${particleColor}11 50%, transparent 70%)`;
  const header = `
    <div style="position: relative; width: 100%; aspect-ratio: 3 / 4; background: ${portraitBg}; overflow: hidden;">
      <img src="${cardImageUrl}"
           alt="${(def.name ?? heroId).toUpperCase()}"
           style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; image-rendering: crisp-edges;"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
      <div style="display: none; position: absolute; inset: 0; flex-direction: column; align-items: center; justify-content: center; padding: 28px 16px; text-align: center;">
        <div style="font-size: clamp(48px, 7vw, 72px); color: ${tint}; text-shadow: 0 0 18px ${tint};">⚔</div>
        <div style="font-size: clamp(16px, 2.0vh, 20px); color: ${tint}; letter-spacing: 3px; font-weight: 900; margin-top: 8px; text-shadow: 0 0 8px ${tint}88, 2px 2px 0 #000;">${def.name?.toUpperCase()}</div>
        <div style="font-size: clamp(10px, 1.2vh, 12px); color: #cdb98a; letter-spacing: 2px; margin-top: 4px;">${def.title ?? ''}</div>
        <div style="margin-top: 10px;">
          <span style="display: inline-block; padding: 3px 10px; background: ${tint}22; border: 1px solid ${tint}; color: ${tint}; font-size: 9.5px; letter-spacing: 2px; font-weight: 900;">${def.specialty ?? ''}</span>
        </div>
      </div>
    </div>
  `;

  // "Built for:" callout
  const builtFor = def.playerProblemSolved
    ? `
      <div style="font-size: 9px; color: #aa9a4a; letter-spacing: 2px; margin-bottom: 4px;">BUILT FOR</div>
      <div style="font-size: clamp(11px, 1.3vh, 13px); color: #e8d6a8; line-height: 1.5; margin-bottom: clamp(12px, 1.8vh, 18px); padding-left: 10px; border-left: 3px solid ${tint}; font-style: italic;">${def.playerProblemSolved}</div>
    `
    : '';

  // Passive aura
  const passiveText = def.passive?.description ?? '';
  const passive = `
    <div style="font-size: 9px; color: #aa9a4a; letter-spacing: 2px; margin-bottom: 4px;">PASSIVE</div>
    <div style="font-size: clamp(11px, 1.25vh, 13px); color: #cdb98a; line-height: 1.5; margin-bottom: clamp(12px, 1.8vh, 18px); padding: 8px 10px; background: rgba(0,0,0,0.35); border-left: 2px solid #5a4a30;">${passiveText}</div>
  `;

  // Ability ladder
  const abilities: any[] = def.abilities ?? [];
  const tierTitles: string[] = def.tierTitles ?? ['TIRO','LEGATUS','CONSUL','IMPERATOR','DIVUS'];
  const abilityRows = abilities.map((a) => {
    const tierLabel = tierTitles[a.level] ?? `T${a.level}`;
    const cd = a.cooldownSec ? `${a.cooldownSec}s` : '';
    return `
      <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; padding: 6px 8px; background: rgba(0,0,0,0.25); border-left: 2px solid ${tint}88;">
        <div style="flex: 0 0 auto; padding: 2px 6px; background: ${tint}; color: #1a0808; font-size: 8.5px; letter-spacing: 1px; font-weight: 900; min-width: 64px; text-align: center;">${tierLabel}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: clamp(11px, 1.25vh, 13px); color: ${tint}; font-weight: 900; letter-spacing: 1px;">${a.name ?? a.id}<span style="color: #aa9a4a; font-size: 9.5px; font-weight: normal; letter-spacing: 0.5px; margin-left: 8px;">⏱ ${cd}</span></div>
          <div style="font-size: clamp(10px, 1.15vh, 12px); color: #cdb98a; line-height: 1.45; margin-top: 2px;">${a.description ?? ''}</div>
        </div>
      </div>
    `;
  }).join('');

  // 2026-05-19 — Padded body wraps the description sections so the
  // banner image bleeds edge-to-edge on top while the text content
  // below sits inside comfortable internal padding. Slot chip and
  // LAST PICK badge are absolutely positioned over the banner.
  card.innerHTML = `
    ${header}
    ${slotChip}
    ${lastPickBadge}
    <div style="padding: clamp(14px, 2vh, 22px) clamp(14px, 2vw, 20px);">
      ${builtFor}
      ${passive}
      <div style="font-size: 9px; color: #aa9a4a; letter-spacing: 2px; margin-bottom: 6px; padding-top: 4px; border-top: 1px dashed #3a2a1a;">ABILITIES</div>
      ${abilityRows}
    </div>
  `;

  return card;
}

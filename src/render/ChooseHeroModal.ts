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

  const overlay = document.createElement('div');
  overlay.id = 'choose-hero-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    display: flex; align-items: flex-start; justify-content: center;
    padding: clamp(16px, 3vh, 36px) clamp(8px, 2vw, 24px);
    box-sizing: border-box;
    overflow: auto;
    background: radial-gradient(ellipse at center, rgba(20,8,8,0.92) 0%, rgba(0,0,0,0.96) 80%);
    z-index: 9999;
    font-family: 'Courier New', monospace;
    color: #e8d6a8;
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
    <div style="font-size: clamp(11px, 1.4vh, 14px); color: #cdb98a; letter-spacing: 2px; margin-bottom: clamp(18px, 3vh, 32px); font-style: italic;">Three champions stand ready. Only one may answer the legion's call.</div>
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

  for (const heroId of choices) {
    const def: any = (HERO_DEFS as any)[heroId];
    const card = renderHeroCard(heroId, def, lastHeroId === heroId);
    card.addEventListener('click', () => {
      pickedHero = heroId;
      // Highlight selected card; dim others.
      for (let i = 0; i < cards.length; i++) {
        const isSel = cards[i] === card;
        cards[i].style.opacity = isSel ? '1' : '0.55';
        cards[i].style.transform = isSel ? 'scale(1.04)' : 'scale(0.97)';
        cards[i].style.boxShadow = isSel
          ? `0 0 30px ${def.visual?.particleColor ?? '#ffd34d'}, 0 0 60px ${def.visual?.particleColor ?? '#ffd34d'}33`
          : '0 0 6px rgba(0,0,0,0.6)';
      }
      // Show / refresh confirm strip
      confirmStrip.innerHTML = `
        <div style="font-size: clamp(20px, 2.4vh, 28px); color: ${def.visual?.tierUpColor ?? '#ffd34d'}; letter-spacing: 4px; font-weight: 900; margin-bottom: 4px; text-shadow: 0 0 12px ${def.visual?.tierUpColor ?? '#ffd34d'};">${def.name?.toUpperCase()}</div>
        <div style="font-size: clamp(11px, 1.3vh, 13px); color: #cdb98a; letter-spacing: 2px; margin-bottom: 14px;">${def.title ?? ''}</div>
        <div style="font-size: clamp(12px, 1.4vh, 14px); color: #e8d6a8; max-width: 720px; margin: 0 auto 18px; line-height: 1.55; font-style: italic; text-align: center;">"${(def.biography ?? '').replace(/"/g, '”')}"</div>
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
          transition: transform 0.12s, box-shadow 0.18s;
          text-shadow: 2px 2px 0 #000;
        ">⚔ MARCH TO WAR</button>
      `;
      confirmStrip.style.display = 'block';
      const marchBtn = confirmStrip.querySelector('#choose-hero-march') as HTMLButtonElement;
      marchBtn.onmouseenter = () => { marchBtn.style.transform = 'translateY(-2px)'; marchBtn.style.boxShadow = '0 0 32px rgba(255,211,77,0.85)'; };
      marchBtn.onmouseleave = () => { marchBtn.style.transform = ''; marchBtn.style.boxShadow = '0 0 18px rgba(255,211,77,0.4)'; };
      marchBtn.onclick = () => {
        if (!pickedHero) return;
        pickHero(state, pickedHero);
        overlay.remove();
      };
      // Smooth scroll the confirm strip into view.
      setTimeout(() => confirmStrip.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    });
    cards.push(card);
    row.appendChild(card);
  }

  panel.appendChild(row);
  panel.appendChild(confirmStrip);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

// ─── Card renderer ─────────────────────────────────────────────────

function renderHeroCard(heroId: string, def: any, isLastPick: boolean): HTMLElement {
  const tint = def.visual?.tierUpColor ?? '#ffd34d';
  const particleColor = def.visual?.particleColor ?? tint;

  const card = document.createElement('div');
  card.dataset.heroId = heroId;
  card.style.cssText = `
    position: relative;
    background: linear-gradient(180deg, rgba(34,25,18,0.96), rgba(10,6,4,0.96));
    border: 3px solid #5a4a30;
    padding: clamp(14px, 2vh, 22px) clamp(14px, 2vw, 20px);
    cursor: pointer;
    transition: transform 0.18s, border-color 0.18s, box-shadow 0.18s, opacity 0.18s;
    text-align: left;
    overflow: hidden;
  `;
  card.onmouseenter = () => {
    card.style.borderColor = tint;
    card.style.transform = 'scale(1.02)';
    card.style.boxShadow = `0 0 24px ${particleColor}66`;
  };
  card.onmouseleave = () => {
    card.style.borderColor = '#5a4a30';
    card.style.transform = 'scale(1)';
    card.style.boxShadow = 'none';
  };

  // ★ LAST PICK badge
  const lastPickBadge = isLastPick ? `
    <div style="position: absolute; top: 8px; right: 8px; background: #1a0a1a; color: #ffd34d; border: 1px solid #ffd34d; padding: 3px 8px; font-size: 9px; letter-spacing: 2px; font-weight: 900; text-shadow: 1px 1px 0 #000;">★ LAST PICK</div>
  ` : '';

  // Header: portrait silhouette + name + title + specialty
  const portraitBg = `radial-gradient(circle at center, ${particleColor}44 0%, ${particleColor}11 50%, transparent 70%)`;
  const header = `
    <div style="display: flex; gap: clamp(10px, 1.5vw, 16px); align-items: flex-start; margin-bottom: clamp(12px, 1.8vh, 18px);">
      <div style="
        flex: 0 0 auto;
        width: clamp(64px, 8vw, 96px);
        height: clamp(64px, 8vw, 96px);
        background: ${portraitBg};
        border: 2px solid ${tint};
        display: flex; align-items: center; justify-content: center;
        font-size: clamp(34px, 5vw, 52px); color: ${tint};
        box-shadow: inset 0 0 24px ${particleColor}44, 0 0 16px ${particleColor}66;
        text-shadow: 0 0 12px ${tint};
      ">⚔</div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: clamp(16px, 1.9vh, 20px); color: ${tint}; letter-spacing: 3px; font-weight: 900; text-shadow: 0 0 8px ${tint}88, 2px 2px 0 #000;">${def.name?.toUpperCase()}</div>
        <div style="font-size: clamp(10px, 1.2vh, 12px); color: #cdb98a; letter-spacing: 2px; margin-top: 2px;">${def.title ?? ''}</div>
        <div style="margin-top: 6px;">
          <span style="display: inline-block; padding: 2px 8px; background: ${tint}22; border: 1px solid ${tint}; color: ${tint}; font-size: 9.5px; letter-spacing: 2px; font-weight: 900;">${def.specialty ?? ''}</span>
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

  card.innerHTML = `
    ${lastPickBadge}
    ${header}
    ${builtFor}
    ${passive}
    <div style="font-size: 9px; color: #aa9a4a; letter-spacing: 2px; margin-bottom: 4px;">ABILITIES</div>
    ${abilityRows}
  `;

  return card;
}

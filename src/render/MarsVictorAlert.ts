// MarsVictorAlert — celebratory "all six heroes are on the field" prompt.
//
// Fires once when the player has every one of the six hero identities placed
// (their starter HERO_* plus the five CHAMPION_* recruits — see
// CombinationEngine.ingTypeMatches). Plays a triumphant sting, shows the six
// hero portraits converging behind a gold burst, and offers a one-click
// option to fuse them into MARS VICTOR. "Not yet" dismisses; the prompt
// re-arms only if the player drops back below six and returns to six again
// (the caller owns that gating via a state flag).
import { SFX } from './AudioManager';
import { heroIdForTowerType } from '../systems/HeroIdentity';
import type { GameStateShape } from '../GameState';
import { GamePhase } from '../types';

const HERO_SLUGS = ['marius', 'agrippa', 'agricola', 'scipio', 'caesar', 'sulla'];

/** Count the distinct hero identities (starter HERO_* + recruited CHAMPION_*)
 *  among PLACED (non-pending) towers. Six = the full Mars Victor set. */
export function distinctHeroIdentities(state: GameStateShape): number {
  const ids = new Set<string>();
  for (const t of state.towers.values()) {
    if ((t as any).pending) continue;
    const id = heroIdForTowerType(String(t.type));
    if (id) ids.add(id);
  }
  return ids.size;
}

/** Fire the Mars Victor readiness prompt at most once per completed set.
 *  Re-arms automatically when the set drops below six (a hero is consumed
 *  or replaced) and is completed again. No-op while Mars Victor stands. */
export function maybeOfferMarsVictor(
  parent: HTMLElement | null,
  state: GameStateShape,
  hasMarsVictor: boolean,
  onFuse: () => void
): void {
  const complete = distinctHeroIdentities(state) >= 6;
  if (!complete) {
    (state as any).__marsVictorOffered = false;
    (state as any).__marsVictorPromptDeferred = false;
    return;
  }
  if (hasMarsVictor) {
    (state as any).__marsVictorPromptDeferred = false;
    return;
  }
  if (state.phase === GamePhase.WAVE_PHASE) {
    (state as any).__marsVictorPromptDeferred = true;
    return;
  }
  if ((state as any).__marsVictorOffered && !(state as any).__marsVictorPromptDeferred) return;
  (state as any).__marsVictorOffered = true;
  (state as any).__marsVictorPromptDeferred = false;
  if (parent) showMarsVictorReady(parent, onFuse);
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    @keyframes mv-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes mv-burst { 0% { transform: scale(0.2); opacity: 0.0; } 40% { opacity: 0.85; } 100% { transform: scale(1.9); opacity: 0; } }
    @keyframes mv-glow { 0%,100% { box-shadow: 0 0 18px #ffcf52, inset 0 0 22px #6b4a0e; } 50% { box-shadow: 0 0 38px #ffe082, inset 0 0 30px #8a5e12; } }
    @keyframes mv-portrait-in { 0% { transform: translateY(14px) scale(0.7); opacity: 0; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
    @keyframes mv-headline { 0% { letter-spacing: 14px; opacity: 0; } 100% { letter-spacing: 6px; opacity: 1; } }
    .mv-portrait { animation: mv-portrait-in 0.5s cubic-bezier(.2,.9,.3,1.2) backwards; }
  `;
  document.head.appendChild(s);
}

/**
 * Show the Mars Victor readiness celebration + fuse prompt.
 * @param parent  the stage-wrap element to overlay.
 * @param onFuse  called when the player chooses to fuse (caller opens the
 *                combo picker / executes the MARS_VICTOR recipe).
 * @param onDismiss optional — called when the player picks "Not yet".
 */
export function showMarsVictorReady(parent: HTMLElement, onFuse: () => void, onDismiss?: () => void): void {
  injectStyle();
  // Never stack two of these.
  parent.querySelector('#mars-victor-ready')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mars-victor-ready';
  overlay.style.cssText = `position:absolute;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center, rgba(40,26,4,0.72), rgba(8,5,2,0.88));backdrop-filter:blur(2px);font-family:'Courier New',monospace;`;

  const card = document.createElement('div');
  card.style.cssText = `position:relative;width:min(540px,92vw);padding:22px 20px 18px;text-align:center;background:linear-gradient(180deg,#1c1206,#0c0803);border:2px solid #d4af37;border-radius:10px;animation:mv-pop 0.45s cubic-bezier(.2,.9,.3,1.2), mv-glow 2.4s ease-in-out infinite;`;

  // Gold burst ring behind the portraits.
  const burst = document.createElement('div');
  burst.style.cssText = `position:absolute;top:96px;left:50%;width:200px;height:200px;margin-left:-100px;border-radius:50%;background:radial-gradient(circle, rgba(255,224,130,0.55), rgba(255,160,40,0.0) 70%);animation:mv-burst 1.1s ease-out 0.15s 1 both;pointer-events:none;`;
  card.appendChild(burst);

  const headline = document.createElement('div');
  headline.textContent = 'MARS VICTOR AWAKENS';
  headline.style.cssText = `position:relative;font-size:22px;font-weight:bold;letter-spacing:6px;color:#ffe082;text-shadow:0 0 10px #ff9b1e,0 2px 0 #5a3a06;animation:mv-headline 0.6s ease-out both;`;
  card.appendChild(headline);

  const sub = document.createElement('div');
  sub.textContent = 'All six heroes of Rome stand as one. Fuse them into the god of war.';
  sub.style.cssText = `position:relative;margin-top:6px;font-size:11px;color:#e8d6a8;line-height:1.4;`;
  card.appendChild(sub);

  // Six converging portraits.
  const row = document.createElement('div');
  row.style.cssText = `position:relative;display:flex;justify-content:center;gap:6px;margin:14px 0 4px;flex-wrap:wrap;`;
  HERO_SLUGS.forEach((slug, i) => {
    const p = document.createElement('img');
    p.src = `assets/heroes/hero_card_${slug}.png`;
    p.className = 'mv-portrait';
    p.style.cssText = `width:64px;height:80px;object-fit:cover;object-position:top center;border:1.5px solid #d4af37;border-radius:6px;background:#0c0803;box-shadow:0 0 8px rgba(255,200,80,0.4);animation-delay:${0.12 + i * 0.08}s;`;
    p.onerror = () => { p.style.display = 'none'; };
    row.appendChild(p);
  });
  card.appendChild(row);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = `position:relative;display:flex;gap:10px;justify-content:center;margin-top:14px;`;

  const fuse = document.createElement('button');
  fuse.textContent = '⚔ FORM MARS VICTOR';
  fuse.style.cssText = `flex:0 0 auto;padding:10px 18px;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:1px;color:#1a0f02;background:linear-gradient(180deg,#ffe082,#d4901f);border:1px solid #fff2c0;border-radius:6px;cursor:pointer;text-shadow:0 1px 0 #ffefb0;`;
  fuse.onmouseenter = () => { fuse.style.filter = 'brightness(1.12)'; };
  fuse.onmouseleave = () => { fuse.style.filter = 'none'; };
  fuse.onclick = () => { overlay.remove(); onFuse(); };

  const later = document.createElement('button');
  later.textContent = 'Not yet';
  later.style.cssText = `flex:0 0 auto;padding:10px 16px;font-family:inherit;font-size:12px;color:#cdb98a;background:#241a0e;border:1px solid #5a4a30;border-radius:6px;cursor:pointer;`;
  later.onclick = () => { overlay.remove(); onDismiss?.(); };

  btnRow.appendChild(fuse);
  btnRow.appendChild(later);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  parent.appendChild(overlay);

  // Triumphant sting — thunder + war-horn fanfare (reused God of War combo cue).
  try { SFX.comboGodOfWar(); } catch { /* audio not ready */ }
}

// ─────────────────────────────────────────────────────────────────────
// CHOOSE HERO MODAL (2026-05-19, full roster redesign 2026-05-21)
//
// All-6 horizontal-scroll picker. Fires after name entry at run
// start. Mounts on document.body (NOT #app — full-screen modals
// inside #app get clipped on big monitors). Responsive clamping
// matches the Hall of Glory pattern at Leaderboard.ts:188-221.
//
// Flow:
//   1. draftHeroChoices() returns the FULL 6-hero roster (shuffled
//      for visual freshness; no random subset).
//   2. Render 6 hero cards in a horizontal-scrolling row with
//      scroll-snap so each card snaps cleanly into view.
//   3. Hover: card border brightens to hero tint, scale 1.02
//   4. Click: confirm strip appears (name + title + "⚔ MARCH TO WAR")
//   5. March → pickHero(state, heroId) + modal removes itself
//
// The pickHero call queues the hero placement token in
// state.pendingPurchasedTowers with source: 'hero'. The next empty-
// tile click on the canvas drops the hero — see main.ts:4486.
//
// Keyboard: 1-6 focuses the corresponding card (left-to-right in the
// scroll), Enter confirms. The ★ LAST PICK badge highlights the
// player's previous hero so re-runs feel continuous.
// ─────────────────────────────────────────────────────────────────────

import { GameStateShape } from '../GameState';
import { draftHeroChoices, pickHero, type HeroId } from '../systems/HeroSystem';
import HERO_DEFS from '../data/herodefs.json';
// 2026-05-19 — Three audio cues for the choose-hero moment:
//   • playMusicTrack at modal open      → "Choose your character" theme (one-shot)
//   • SFX.prospectKeep at card click    → commit-decision blip
//   • SFX.waveStartBlast at MARCH       → war-horn kickoff
import { playMusicTrack, stopMusicTrack, sfx, SFX } from './AudioManager';
// 2026-05-22 UX HM — Haptic feedback. Mobile vibrates briefly on card
// select + MARCH commit so the touch lands with a physical confirmation.
import { vibrate } from '../Mobile';
// 2026-05-19 — towers.json carries the hero's combat stats (baseDps,
// attackSpeed, range, damageType, critChance). The draft modal pulls
// these so the card surfaces the same numbers the in-game inspect
// panel will show after the player places the hero, helping them
// compare heroes head-to-head with the rest of their roster.
import TOWERS_DATA from '../data/towers.json';

// Pretty-print a damageType string (e.g. PHYS_MELEE → "MELEE").
function prettyDamageType(dt: any): string {
  const s = String(dt ?? '');
  if (s === 'PHYS_MELEE')      return 'MELEE';
  if (s === 'PHYS_RANGED')     return 'RANGED';
  if (s === 'SIEGE')           return 'SIEGE';
  if (s === 'ELEMENTAL_FIRE')  return 'FIRE';
  if (s === 'DIVINE')          return 'DIVINE';
  return s.replace(/_/g, ' ');
}

// 2026-05-19 — Defensive passive-description lookup. Most heroes
// declare a single flat `passive.description`, but Agricola uses a
// `kind:'DUAL'` shape with nested `global` and `local` blocks. This
// helper falls back to assembling a combined string from those
// nested entries when the top-level field is missing, so the
// PASSIVE row in the modal / Codex / inspect panel never renders
// empty for a DUAL hero. Future DUAL heroes work without code edits.
function passiveDescription(passive: any): string {
  if (!passive) return '';
  if (passive.description) return passive.description;
  const parts: string[] = [];
  if (passive.global?.description) parts.push(`Global: ${passive.global.description}`);
  if (passive.local?.description)  parts.push(`Local: ${passive.local.description}`);
  return parts.join(' ');
}

export function showChooseHeroModal(state: GameStateShape): void {
  if (document.getElementById('choose-hero-modal')) return;   // already open

  // Inject the modal-local stylesheet exactly once. Encapsulates
  // entrance fade, hover transitions, and the keyboard-hint pulse so
  // each card / button doesn't need its own inline keyframes string.
  ensureChooseHeroStyle();

  // 2026-05-19 — Modal background music. The "Choose your character"
  // sting from Smash Bros sets the picking-a-hero mood (already
  // used as a one-shot when the player hits the 10-prospect cap;
  // re-purposed here too — different game moment, same emotional
  // beat). Single play (no loop) so the announcer line doesn't
  // repeat on a loop if the player lingers; the modal can sit in
  // silence afterward without losing impact. Stopped in cleanup()
  // in case the player marches before the track finishes.
  playMusicTrack(
    'choose-hero-bgm',
    sfx('assets/sfx/smash_bros_choose.mp3'),
    { loop: false, gain: 0.55 }
  );

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

  // Draft all 6 heroes (shuffled display order via Fisher-Yates).
  // 2026-05-21 — Was a 3-of-6 random draft; now the picker surfaces
  // every hero so the player chooses freely from the full roster.
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
    <div style="font-size: clamp(11px, 1.4vh, 14px); color: #cdb98a; letter-spacing: 2px; margin-bottom: 4px; font-style: italic;">Six champions stand ready. Scroll the line and answer the legion's call.</div>
    <div class="chm-kbd-hint" style="font-size: 10px; color: #88735a; letter-spacing: 3px; margin-bottom: clamp(18px, 3vh, 32px);">
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">1</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">2</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">3</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">4</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">5</span>
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 2px; background:#1a0e08;">6</span>
      keys to focus
      <span style="display:inline-block; padding:1px 6px; border:1px solid #5a4a30; margin:0 0 0 8px; background:#1a0e08;">ENTER</span>
      to march · or click · scroll →
    </div>
  `;

  // 2026-05-21 — Card row redesigned as a horizontal-scroll flex
  // strip. With 6 heroes the old responsive grid would stack into
  // multiple rows on common screen widths, breaking the "browse the
  // roster" reading order. The scroll row preserves a single line of
  // cards left-to-right with scroll-snap so each card lands cleanly
  // in view as the player swipes / scrolls. Card width stays at the
  // existing 320px so card content reads identically to the prior
  // 3-card layout.
  //
  // 2026-05-22 V15 — Wrapped the row in a positioned container so we
  // can stack visible scroll affordances on top of it: pulsing left
  // + right chevron buttons + edge gradient fades. Without these the
  // 4th-6th hero cards live off-screen on most monitors and players
  // never discover them. Chevrons auto-hide when scrolled to the
  // matching end of the row.
  const rowWrap = document.createElement('div');
  rowWrap.style.cssText = `
    position: relative;
    margin-bottom: clamp(18px, 3vh, 32px);
  `;
  const row = document.createElement('div');
  row.style.cssText = `
    display: flex;
    gap: clamp(12px, 2vw, 18px);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 4px 12px 4px;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
  `;
  // ── Edge gradient fades — visually hint that content continues off-edge.
  const fadeBaseStyle = `
    position: absolute;
    top: 0;
    bottom: 12px;
    width: 64px;
    pointer-events: none;
    transition: opacity 0.25s ease-out;
    z-index: 2;
  `;
  const leftFade = document.createElement('div');
  leftFade.style.cssText = fadeBaseStyle + `
    left: 0;
    background: linear-gradient(to right, rgba(20, 10, 6, 0.92) 0%, rgba(20, 10, 6, 0) 100%);
    opacity: 0;
  `;
  const rightFade = document.createElement('div');
  rightFade.style.cssText = fadeBaseStyle + `
    right: 0;
    background: linear-gradient(to left, rgba(20, 10, 6, 0.92) 0%, rgba(20, 10, 6, 0) 100%);
    opacity: 1;
  `;
  // ── Chevron buttons — pulse to advertise scrollability, click to
  //    scroll one card-width. Keyboard 1-6 still works in parallel.
  const chevBaseStyle = `
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    border: 2px solid #ffd34d;
    background: linear-gradient(180deg, #4a2a0a, #2a1408);
    color: #ffd34d;
    font-family: 'Courier New', monospace;
    font-size: 30px;
    font-weight: 900;
    line-height: 1;
    cursor: pointer;
    z-index: 3;
    box-shadow: 0 0 16px rgba(255, 211, 77, 0.55), 0 0 32px rgba(255, 211, 77, 0.25);
    transition: opacity 0.25s ease-out, transform 0.18s cubic-bezier(.2,.8,.2,1), box-shadow 0.22s ease-out;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 0 3px 0;
    user-select: none;
    animation: chmChevPulse 1.8s ease-in-out infinite;
  `;
  const leftChev = document.createElement('button');
  leftChev.type = 'button';
  leftChev.setAttribute('aria-label', 'Scroll heroes left');
  leftChev.textContent = '‹';
  leftChev.style.cssText = chevBaseStyle + `
    left: -22px;
    opacity: 0;
    pointer-events: none;
  `;
  const rightChev = document.createElement('button');
  rightChev.type = 'button';
  rightChev.setAttribute('aria-label', 'Scroll heroes right');
  rightChev.textContent = '›';
  rightChev.style.cssText = chevBaseStyle + `
    right: -22px;
    opacity: 1;
    animation-delay: 0.9s;
  `;
  // Hover lift
  const hoverIn = (el: HTMLElement) => {
    el.style.transform = 'translateY(-50%) scale(1.08)';
    el.style.boxShadow = '0 0 28px rgba(255, 211, 77, 0.95), 0 0 56px rgba(255, 211, 77, 0.45)';
  };
  const hoverOut = (el: HTMLElement) => {
    el.style.transform = 'translateY(-50%)';
    el.style.boxShadow = '0 0 16px rgba(255, 211, 77, 0.55), 0 0 32px rgba(255, 211, 77, 0.25)';
  };
  leftChev.onmouseenter = () => hoverIn(leftChev);
  leftChev.onmouseleave = () => hoverOut(leftChev);
  rightChev.onmouseenter = () => hoverIn(rightChev);
  rightChev.onmouseleave = () => hoverOut(rightChev);
  const scrollByCard = (dir: 1 | -1) => {
    // Card width (320px) + gap (~16px) = one card stride. Browser
    // honors scroll-behavior: smooth from the row's css.
    row.scrollBy({ left: dir * 336, top: 0, behavior: 'smooth' });
  };
  leftChev.onclick = () => scrollByCard(-1);
  rightChev.onclick = () => scrollByCard(1);

  // Inject keyframes for the chevron pulse animation. CSS-only so it
  // costs nothing at runtime. Idempotent — only adds the stylesheet
  // block once even if the modal opens multiple times.
  if (!document.getElementById('chm-chev-pulse-style')) {
    const style = document.createElement('style');
    style.id = 'chm-chev-pulse-style';
    style.textContent = `
      @keyframes chmChevPulse {
        0%, 100% { box-shadow: 0 0 16px rgba(255, 211, 77, 0.55), 0 0 32px rgba(255, 211, 77, 0.25); }
        50%      { box-shadow: 0 0 28px rgba(255, 211, 77, 0.95), 0 0 56px rgba(255, 211, 77, 0.55); }
      }
    `;
    document.head.appendChild(style);
  }

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
    // 2026-05-19 — Hero pick audio cue. Re-using the prospect-keep
    // sting because it already reads as "decision committed" in the
    // game's audio vocabulary (same beat the player hears when
    // saving a prospect). Only fires when the selection actually
    // changes — re-clicking the same card doesn't spam the sound.
    if (pickedHero !== heroId) {
      SFX.prospectKeep();
      vibrate('light');
    }
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
    // 2026-05-20 — Biography quote dropped per design ask. The
    // confirmation strip now shows just NAME + TITLE + the
    // MARCH TO WAR button — cleaner read, less mid-draft flavor.
    confirmStrip.innerHTML = `
      <div style="font-size: clamp(20px, 2.4vh, 28px); color: ${def.visual?.tierUpColor ?? '#ffd34d'}; letter-spacing: 4px; font-weight: 900; margin-bottom: 4px; text-shadow: 0 0 12px ${def.visual?.tierUpColor ?? '#ffd34d'};">${def.name?.toUpperCase()}</div>
      <div style="font-size: clamp(11px, 1.3vh, 13px); color: #cdb98a; letter-spacing: 2px; margin-bottom: clamp(14px, 2.2vh, 22px);">${def.title ?? ''}</div>
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
      // 2026-05-19 — MARCH TO WAR audio kickoff. The wave-start
      // blast is the game's "we're going to battle" signature
      // horn — same cue the player hears at the moment a wave
      // begins. Firing it on the march-button click delivers the
      // dramatic transition from "choose your hero" into the
      // first prospect-placement phase.
      SFX.waveStartBlast();
      vibrate('success');
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

  // 2026-05-22 V15 — Mount the row inside the positioned wrapper, then
  // stack the fades + chevrons on top. Scroll listener updates chevron
  // visibility so the user knows whether more heroes live in either
  // direction. Threshold of 8px on each end accounts for sub-pixel
  // rounding from scroll-snap.
  rowWrap.appendChild(row);
  rowWrap.appendChild(leftFade);
  rowWrap.appendChild(rightFade);
  rowWrap.appendChild(leftChev);
  rowWrap.appendChild(rightChev);
  const updateChevs = () => {
    const max = row.scrollWidth - row.clientWidth;
    const atStart = row.scrollLeft <= 8;
    const atEnd = row.scrollLeft >= max - 8;
    leftChev.style.opacity = atStart ? '0' : '1';
    leftChev.style.pointerEvents = atStart ? 'none' : 'auto';
    rightChev.style.opacity = atEnd ? '0' : '1';
    rightChev.style.pointerEvents = atEnd ? 'none' : 'auto';
    leftFade.style.opacity = atStart ? '0' : '1';
    rightFade.style.opacity = atEnd ? '0' : '1';
    // If the row isn't even scrollable (rare — wide monitor, all 6
    // heroes visible), hide everything entirely.
    if (max <= 4) {
      leftChev.style.opacity = '0';
      rightChev.style.opacity = '0';
      leftFade.style.opacity = '0';
      rightFade.style.opacity = '0';
    }
  };
  row.addEventListener('scroll', updateChevs, { passive: true });
  // Initial sync — defer to next frame so the row has measured itself.
  requestAnimationFrame(updateChevs);
  // Re-evaluate on window resize (mobile rotation, monitor disconnect)
  window.addEventListener('resize', updateChevs);

  panel.appendChild(rowWrap);
  panel.appendChild(confirmStrip);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Keyboard support: 1-6 focus a hero, Enter confirms the focused
  // pick. Useful for keyboard players and accessibility — the click
  // path stays the canonical interaction so this is purely additive.
  // The selected card scrolls into view so an off-screen hero (e.g.
  // pressing "6" on a narrow monitor) doesn't get lost behind the
  // viewport edge.
  const onKey = (e: KeyboardEvent) => {
    if (e.key >= '1' && e.key <= '6') {
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        selectByIndex(idx);
        cards[idx]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        e.preventDefault();
      }
    } else if (e.key === 'Enter' && pickedHero) {
      // Enter key takes the same march-to-war audio path as the
      // button click so the keyboard player gets the same kickoff.
      SFX.waveStartBlast();
      vibrate('success');
      pickHero(state, pickedHero);
      cleanup();
      e.preventDefault();
    }
  };
  function cleanup() {
    window.removeEventListener('keydown', onKey);
    // 2026-05-22 V15 — Also tear down the resize listener added for
    // the chevron visibility update. Without this, every time the
    // modal closes we leak a listener that fires on every resize for
    // the remainder of the session.
    window.removeEventListener('resize', updateChevs);
    // Stop the modal's choose-hero theme if it's still playing —
    // the player marched (or otherwise dismissed) before the
    // single-shot sting finished. Idempotent: no-op if the track
    // already ended naturally.
    stopMusicTrack('choose-hero-bgm');
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
  // 2026-05-21 — Locked card width + scroll-snap so the horizontal
  // flex row reads as a clean filmstrip. flex-shrink: 0 prevents the
  // browser from squishing cards to fit; scroll-snap-align: start
  // makes each card click into place as the player scrolls.
  card.style.cssText = `
    position: relative;
    flex: 0 0 320px;
    width: 320px;
    scroll-snap-align: start;
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

  // Tower-style stats block (DPS / atk speed / range / damage type /
  // crit). Pulls baseDps × the global +10% spawn buff used by
  // TowerSystem.createTower so the displayed DPS exactly matches
  // what the player will see in the in-game inspect panel when they
  // place the hero. Per-hit damage = baseDps / attackSpeed.
  const towerStats: any = (TOWERS_DATA as any)[heroId] ?? {};
  const baseDpsRaw = (towerStats.baseDps ?? 0) * 1.10;   // matches createTower
  const atkSpd     = towerStats.attackSpeed ?? 1.0;
  const rangeTiles = towerStats.range ?? 0;
  const perHit     = atkSpd > 0 ? baseDpsRaw / atkSpd : baseDpsRaw;
  const dmgTypeLbl = prettyDamageType(towerStats.damageType);
  const critPct    = Math.round((towerStats.critChance ?? 0) * 100);
  const critMult   = towerStats.critMult ?? 2.0;
  // Mini "stat-box" matches the regular tower menu's stat-grid format:
  // small uppercase label on top, bold value below.
  const statBox = (label: string, value: string, color = '#e8d6a8') =>
    `<div style="background:rgba(0,0,0,0.35);padding:6px 8px;border:1px solid #3a2a1a">
       <div style="color:#aa9a4a;letter-spacing:1.5px;text-transform:uppercase;font-size:8.5px">${label}</div>
       <div style="color:${color};font-size:13px;font-weight:bold;margin-top:2px">${value}</div>
     </div>`;
  const stats = `
    <div style="font-size:9px;color:#aa9a4a;letter-spacing:2px;margin-bottom:6px">STATS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:clamp(12px,1.8vh,18px)">
      ${statBox('DAMAGE / HIT', perHit.toFixed(1), '#ee9966')}
      ${statBox('ATK SPEED',    atkSpd.toFixed(2) + ' /s')}
      ${statBox('RANGE',        rangeTiles + ' tiles')}
      ${statBox('DPS',          baseDpsRaw.toFixed(1), '#ffbe7a')}
      ${statBox('CRIT',         critPct + '%' + (critPct > 0 ? ' × ' + critMult.toFixed(1) : ''))}
      ${statBox('TYPE',         dmgTypeLbl, tint)}
    </div>
    <div style="font-size:9px;color:#5a8a5a;letter-spacing:1px;margin-top:-10px;margin-bottom:clamp(10px,1.6vh,16px);font-style:italic">↑ Scales 1.0× → 2.4× across the 5 tiers as XP rises.</div>
  `;

  // 2026-05-20 — "BUILT FOR" block removed per design ask. The pitch
  // line cluttered the draft card; players read stats / passive /
  // abilities to decide, not a marketing tagline. Kept the variable
  // as an empty string so the card layout below doesn't have to
  // change shape.
  const builtFor = '';

  // Passive aura — pulls through the defensive helper so DUAL-kind
  // heroes (Agricola) render a real description instead of an empty
  // block. See passiveDescription() at the top of this file.
  const passiveText = passiveDescription(def.passive);
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
  //
  // 2026-05-22 UX1/UX3 — Mobile collapse: abilities ladder is the
  // longest section of the card and dominates the vertical real
  // estate on a phone (1322px card vs. 393px viewport). Wrap it in
  // a [data-card-abilities] container plus a [data-card-expand]
  // toggle button. CSS in index.html (html.mobile-mode) hides the
  // ladder by default and shows the toggle; the toggle's click
  // handler is registered just below to flip a `expanded` class on
  // the card root so the rule can re-reveal it. Desktop is unaffected
  // because the toggle button has `display: none` outside mobile-mode.
  card.innerHTML = `
    ${header}
    ${slotChip}
    ${lastPickBadge}
    <div style="padding: clamp(14px, 2vh, 22px) clamp(14px, 2vw, 20px);">
      ${stats}
      ${builtFor}
      ${passive}
      <button data-card-expand type="button" style="
        display:none; width:100%; margin: 4px 0 10px; padding: 10px 12px;
        background: rgba(0,0,0,0.4); border: 1px dashed ${tint}66; color: ${tint};
        font-family:'Courier New',monospace; font-size:11px; letter-spacing:2px;
        font-weight:900; cursor:pointer; text-shadow:1px 1px 0 #000;
      ">▼ TAP FOR ${abilities.length || 0} ABILIT${abilities.length === 1 ? 'Y' : 'IES'}</button>
      <div data-card-abilities>
        <div style="font-size: 9px; color: #aa9a4a; letter-spacing: 2px; margin-bottom: 6px; padding-top: 4px; border-top: 1px dashed #3a2a1a;">ABILITIES</div>
        ${abilityRows}
      </div>
    </div>
  `;
  // Toggle wires up after innerHTML lands — flips the card's `expanded`
  // data flag so the mobile CSS can re-show the abilities block. The
  // button label flips between "▼ TAP FOR …" / "▲ HIDE ABILITIES" so
  // the affordance reads honestly in both states.
  const expandBtn = card.querySelector('[data-card-expand]') as HTMLButtonElement | null;
  const abilWrap  = card.querySelector('[data-card-abilities]') as HTMLElement | null;
  if (expandBtn && abilWrap) {
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();   // don't trigger card selection
      const open = card.dataset.expanded === '1';
      card.dataset.expanded = open ? '0' : '1';
      expandBtn.textContent = open
        ? `▼ TAP FOR ${abilities.length || 0} ABILIT${abilities.length === 1 ? 'Y' : 'IES'}`
        : '▲ HIDE ABILITIES';
    });
  }

  return card;
}

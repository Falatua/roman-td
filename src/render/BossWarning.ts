// BossWarning — two-stage CRT-arcade verification screen that appears
// before every scheduled boss wave (W5/W10/W20/W21/W24/W25/W27/W30 in the
// 30-wave campaign). The game taunts the player twice before letting them
// proceed. Same visual language as the Hall of Glory + loading screen:
// dark CRT background, scanlines, screen flicker, gold/amber text,
// deep red accents.
//
// Flow:
//   1) showBossWarning(parent, wave, onConfirm)
//      → Renders the FIRST confirmation screen
//      → "YES, I AM READY" routes to step 2
//      → "NO, I NEED MORE TIME" closes without firing onConfirm
//   2) Second confirmation
//      → "I ACCEPT MY FATE" → screen flash + shake → onConfirm()
//      → "ACTUALLY... NO" closes without firing onConfirm
//
// Sprites: uses existing boss enemy sprites for the menacing portrait.

import { tex } from './Assets';
// 2026-05-22 — Audio kick on the I ACCEPT MY FATE button: fire a
// short "FINISH HIM" Mortal-Kombat-style punch + start FF7's
// One-Winged Angel as the dramatic music bed. Same track used on
// W30 boss arrival; the click-to-start path here owns the lifecycle
// so any major boss wave gets the iconic Sephiroth
// swell on confirmation, not just the final boss.
import { SFX, playMusicTrack, sfx } from './AudioManager';

function spriteSrcFor(key: string): string | null {
  const t = tex(key);
  if (!t) return null;
  const res: any = t.baseTexture?.resource;
  return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
}

// ─── Boss-specific copy by wave ─────────────────────────────────────────
interface BossDossier {
  name: string;             // Display name
  faction: string;          // Faction display string
  sprite: string;           // Assets.ts key for the in-game boss sprite (fallback)
  warning: string[];        // Lines for FIRST screen (after the headline)
  doom: string[];           // Lines for SECOND screen
  portrait?: string;        // Optional dedicated boss-portrait art (direct DOM
                            // src under public/, e.g. 'assets/bosses/boss_brennus.png').
                            // Preferred over `sprite` when present.
}

const BOSS_DATA: Record<number, BossDossier> = {
  5: {
    name: 'BRENNUS',
    faction: 'CELTS',
    sprite: 'CELTIC_WARLORD',
    portrait: 'assets/bosses/boss_brennus.png',
    warning: [
      'The Celts already buried three of your towers and the wave hasn\'t started.',
      'Brennus once sacked Rome. He is here to repeat the lesson.',
      'The gods of Gallia are taking bets, general. You are not favored.',
      'ARE YOU REALLY SURE?'
    ],
    doom: [
      'You actually clicked yes. Brennus just heard.',
      'Druidic Mist will eat 20% of your shots. We told you to read the Codex.',
      'Your last prospect roll was, statistically, an insult to Rome.',
      'The Senate has prepared a brief eulogy. They can edit it for victories. Probably.',
      'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
    ]
  },
  10: {
    name: 'HANNIBAL BARCA',
    faction: 'CARTHAGE',
    sprite: 'HANNIBAL_BARCA',
    portrait: 'assets/bosses/boss_hannibal.png',
    warning: [
      'You barely survived Brennus. Hannibal already knows.',
      'He brings three war elephants. They are all bosses. They all leak 10 lives.',
      'At 55% HP he rebirths, summons two more elephants, and adds +60% speed.',
      'Your treasury cannot afford this. Your strategy is, frankly, optimistic.',
      'ARE YOU REALLY SURE?'
    ],
    doom: [
      'Hannibal sent his regards. He has read your tower placements.',
      'He has crossed the Alps. Your maze is a speed bump.',
      'You leaked a basic mob on wave 7. Don\'t pretend you didn\'t.',
      'The historians are sharpening their pens. They write losers gently.',
      'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
    ]
  },
  25: {
    name: 'SUPER GIANT COLOSSUS',
    faction: 'ROMAN MYTH',
    sprite: 'SUPER_GIANT_COLOSSUS',
    portrait: 'assets/bosses/boss_colossus.png',
    warning: [
      'The myth-age opens and the ground files a complaint.',
      'Wave 25 fields TWO Colossus Gigas — each two Giants fused into one titan.',
      'Titan Stomp slows your towers. Colossal Regen heals what you fail to finish.',
      'Bring SIEGE: it deals 3x final damage. DIVINE still lands, but 80% is resisted.',
      'ARE YOU REALLY SURE?'
    ],
    doom: [
      'You clicked yes. The Colossus felt the tremor of your confidence and ignored it.',
      'Chip damage is a personality, not a strategy. The titan regenerates faster than you commit.',
      'Your maze is tall. The Colossus is taller, and significantly less polite.',
      'Five waves remain after this. The titans are merely the warm-up act.',
      'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
    ]
  },
  27: {
    name: 'TYPHON',
    faction: 'ROMAN MYTH',
    sprite: 'TYPHON',
    portrait: 'assets/bosses/boss_typhon.png',
    warning: [
      'Father of monsters. The other bosses were his children.',
      'Wave 27 brings Typhon himself, escorted by a herd of Giant Gigas.',
      'Serpent storms, dread auras, and a hide that laughs at single damage types.',
      'If your composition is one trick, this is where the trick runs out.',
      'ARE YOU REALLY SURE?'
    ],
    doom: [
      'You clicked yes. Typhon has been killed by gods. You are not one.',
      'Diversify your damage or watch every type bounce off in turn.',
      'The Hall of Glory keeps a special page for generals who died on wave 27.',
      'Three waves left. Typhon intends to make them academic.',
      'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
    ]
  },
  20: {
    name: 'VULTURE IMPERATOR',
    faction: 'EGYPTIANS',
    sprite: 'BOSS_FLYER_VULTURE',
    portrait: 'assets/bosses/boss_vulture.png',
    warning: [
      'The sky has developed an opinion about your anti-air coverage.',
      'Wave 20 is a flyer boss. Ground-only confidence will not be accepted.',
      'The Vulture Imperator dives past sloppy lanes and punishes lazy target modes.',
      'If your ranged towers are ornamental, Rome is about to learn bird law.',
      'ARE YOU REALLY SURE?'
    ],
    doom: [
      'You clicked yes. The bird noticed.',
      'Your melee towers look inspiring. They will be cheering from below.',
      'If Sagittarius, Venator, Aquila Venator, Exploratores, and Skyreaper Battery are asleep, wake them now.',
      'There are ten waves after this. Surviving this one is merely permission to suffer.',
      'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
    ]
  },
  21: {
    name: 'KESHIG NOYAN',
    faction: 'MONGOLS',
    sprite: 'KHAN_RIDER',
    portrait: 'assets/bosses/boss_khan.png',
    warning: [
      'The second cave opens and the riders do not wait politely.',
      'Keshig Noyan brings late-campaign speed, commander pressure, and no patience.',
      'Your maze now has two mouths to feed. One of them bites.',
      'ARE YOU REALLY SURE?'
    ],
    doom: [
      'You clicked yes. The Noyan appreciates punctual generals.',
      'Your slows are weaker now. Your excuses remain fully effective.',
      'Watch both lanes or the second cave will write your ending.',
      'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
    ]
  },
  24: {
    name: 'ANUBIS KING',
    faction: 'EGYPTIANS',
    sprite: 'ANUBIS_KING',
    portrait: 'assets/bosses/boss_anubis.png',
    warning: [
      'The desert has upgraded from unpleasant to theological.',
      'Anubis King arrives after priests, plague, sphinxes, and checkpoint-healing guards.',
      'Status builds still help, but the late campaign no longer lets them do all the work.',
      'ARE YOU REALLY SURE?'
    ],
    doom: [
      'You clicked yes. Anubis has opened the ledger.',
      'Your towers may continue firing while judgment is processed.',
      'If this boss leaks, the Hall of Glory will not be gentle.',
      'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
    ]
  },
  30: {
    name: 'DAEMON IMPERATOR',
    faction: 'SUPER_DEMONS',
    sprite: 'DAEMON_IMPERATOR',
    portrait: 'assets/bosses/boss_daemon.png',
    warning: [
      'THIS IS THE FINAL WAVE.',
      'The Daemon Imperator himself cannot breach Rome. Escorts use normal life costs.',
      'The Daemon Imperator hellscapes your towers every 12 seconds.',
      'He regenerates 2.24% maxHP per second out of combat. Keep the pressure on.',
      'No banner pitied you. The Senate stopped watching at wave 24.',
      'ARE YOU REALLY SURE?'
    ],
    doom: [
      'You clicked yes. On the final wave. Against the Daemon Imperator. Bold.',
      'The legends remember winners and warn about everyone else. You are between.',
      'The Hall of Glory has a seat reserved. It is not the one you want.',
      'Hellscape weather is already shortening your status durations 20%.',
      'There is no wave 31. There is only victory or the leaderboard.',
      'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
    ]
  }
};

const VERIFIED_BOSS_WAVES = [5, 10, 20, 21, 24, 25, 27, 30] as const;

export function bossWarningPortraitForWave(wave: number): string | null {
  const dossier = BOSS_DATA[wave] ?? GENERIC_DOSSIER;
  if (typeof dossier.portrait === 'string') return dossier.portrait;
  return spriteSrcFor(dossier.sprite);
}

// Fallback dossier — fires if a boss wave outside the table somehow triggers.
const GENERIC_DOSSIER: BossDossier = {
  name: 'A BOSS',
  faction: 'UNKNOWN',
  sprite: 'DAEMON_IMPERATOR',
  warning: [
    'You are about to face a boss. Your record is not encouraging.',
    'The empire suggests reviewing the Codex one last time.',
    'Your towers are positioned. They will not move themselves.',
    'ARE YOU REALLY SURE?'
  ],
  doom: [
    'You actually clicked yes. The boss is now in motion.',
    'The Senate has begun drafting your replacement.',
    'There is dignity in retreat. You have apparently chosen otherwise.',
    'ARE YOU ABSOLUTELY CERTAIN YOU WANT TO DIE TODAY?'
  ]
};

// ─── Rotating flavor taunts (15+) ───────────────────────────────────────
// Sprinkled onto either confirmation screen. Two random non-repeating
// lines per modal.
const ROTATING_TAUNTS = [
  'YOUR LAST WIN WAS AN ACCIDENT AND YOU KNOW IT',
  'THE ENEMY HAS STUDIED YOUR STRATEGY. THEY ARE NOT WORRIED.',
  'STATISTICALLY SPEAKING, YOU SHOULD QUIT NOW',
  'THE PREVIOUS BOSS LET YOU WIN OUT OF PITY',
  'YOUR TOWERS ARE ADORABLE. THE BOSS FINDS THEM CUTE.',
  'ROME DID NOT FALL IN A DAY. YOUR DEFENSE WILL.',
  'WE HAVE REVIEWED YOUR PERFORMANCE. IT WAS NOT GOOD.',
  'THE BOSS HAS SEEN BETTER GENERALS RETIRE IN SHAME',
  'YOU SURVIVED LAST TIME BY ACCIDENT. THE ALGORITHM KNOWS.',
  'HISTORIANS WILL NOT REMEMBER YOUR NAME',
  'YOUR COMBINATION STRATEGY NEEDS WORK. A LOT OF WORK.',
  'THE ENEMY LAUGHED WHEN THEY SAW YOUR SETUP',
  'CONFIDENCE IS NOT A STRATEGY, GENERAL',
  'THE GODS ARE WATCHING. THEY ARE EMBARRASSED FOR YOU.',
  'PLEASE RECONSIDER. FOR ROME. FOR YOUR FAMILY. FOR YOURSELF.',
  'YOUR MAZE IS LOVELY. UNFORTUNATELY THE ENEMY CAN READ MAPS.',
  'YOU UNLOCKED ONE COMBO. THE BOSS HAS EATEN MEN WITH FOUR.',
  'THE EAGLE STANDARD WEEPS FOR THIS COMPOSITION'
];

function pickTwoTaunts(): string[] {
  const a = ROTATING_TAUNTS.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return [a[0], a[1]];
}

// ─── CRT styling (shared with BossWarning modals) ───────────────────────
function ensureStyle() {
  if (document.getElementById('boss-warning-style')) return;
  const s = document.createElement('style');
  s.id = 'boss-warning-style';
  s.textContent = `
    @keyframes bwScanlines {
      0% { background-position: 0 0; }
      100% { background-position: 0 6px; }
    }
    @keyframes bwTitleFlash {
      0%, 100% { color: #ffd34d; text-shadow: 0 0 14px #ffd34d, 0 0 28px #ffaa33, 4px 4px 0 #1a0808; }
      50%      { color: #ff5050; text-shadow: 0 0 18px #ff5050, 0 0 32px #aa1a1a, 4px 4px 0 #1a0808; }
    }
    @keyframes bwFlicker {
      0%, 96%, 100% { filter: brightness(1) saturate(1); }
      97%           { filter: brightness(1.2) saturate(1.1); }
      98%           { filter: brightness(0.75) saturate(0.85); }
      99%           { filter: brightness(1.06); }
    }
    @keyframes bwBossSway {
      0%, 100% { transform: translateX(0) rotate(0deg); }
      25%      { transform: translateX(-6px) rotate(-1deg); }
      75%      { transform: translateX(6px) rotate(1deg); }
    }
    @keyframes bwBossIn {
      0%   { opacity: 0; transform: translateX(-120px) scale(0.6); }
      60%  { transform: translateX(8px) scale(1.06); }
      100% { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes bwRowIn {
      0%   { opacity: 0; transform: translateY(8px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes bwScreenFlash {
      0%   { background: rgba(255,255,255,0); }
      30%  { background: rgba(255,255,255,0.85); }
      100% { background: rgba(255,255,255,0); }
    }
    .bw-overlay {
      position: absolute; inset: 0; z-index: 195;
      background: radial-gradient(ellipse at center, #1a0808 0%, #0a0202 60%, #000 100%);
      color: #ffd34d; font-family: 'Courier New', monospace;
      display: flex; align-items: center; justify-content: center;
      animation: bwFlicker 5.4s infinite;
      overflow: hidden;
    }
    .bw-scanlines {
      position: absolute; inset: 0; pointer-events: none; z-index: 1;
      background: repeating-linear-gradient(
        to bottom,
        rgba(0,0,0,0) 0px,
        rgba(0,0,0,0) 2px,
        rgba(0,0,0,0.40) 2px,
        rgba(0,0,0,0.40) 3px
      );
      mix-blend-mode: multiply;
    }
    .bw-vignette {
      position: absolute; inset: 0; pointer-events: none; z-index: 1;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.85) 100%);
    }
    .bw-flash {
      position: absolute; inset: 0; pointer-events: none; z-index: 9999;
      animation: bwScreenFlash 600ms ease-out forwards;
    }
    .bw-panel {
      position: relative; z-index: 2;
      width: min(820px, 94%); max-height: 90vh; padding: 30px 36px;
      background: rgba(15,3,3,0.95);
      border: 3px solid #aa1a1a;
      box-shadow: 0 0 40px rgba(170,26,26,0.6), inset 0 0 50px rgba(0,0,0,0.8);
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      text-align: center;
    }
    .bw-headline {
      font-size: clamp(28px, 5vw, 44px);
      letter-spacing: clamp(4px, 0.7vw, 8px);
      font-weight: 900;
      animation: bwTitleFlash 1.4s ease-in-out infinite;
      line-height: 1.1;
    }
    .bw-subhead {
      font-size: 12px; letter-spacing: 5px; color: #aa4a1a;
      font-weight: 900; text-shadow: 1px 1px 0 #000;
    }
    .bw-bossart {
      display: flex; align-items: center; justify-content: center; gap: 18px;
      margin: 6px 0 4px;
    }
    .bw-bossart img {
      width: 96px; height: 96px; image-rendering: pixelated;
      filter: drop-shadow(0 0 12px rgba(255,80,80,0.7)) drop-shadow(2px 2px 0 #000);
      animation: bwBossIn 0.55s cubic-bezier(.2,1.4,.4,1) both, bwBossSway 2.4s ease-in-out 0.55s infinite;
    }
    .bw-bossname {
      font-size: 22px; letter-spacing: 6px; font-weight: 900; color: #ee5050;
      text-shadow: 0 0 10px #ee5050, 2px 2px 0 #000;
    }
    .bw-bossfaction {
      font-size: 10px; letter-spacing: 4px; color: #aa9a4a; margin-top: 2px;
    }
    .bw-lines {
      width: 100%; display: flex; flex-direction: column; gap: 6px;
      margin: 8px 0;
    }
    .bw-lines > div {
      font-size: 14px; letter-spacing: 1px; line-height: 1.5;
      color: #fff8e0; font-weight: 900;
      text-shadow: 1px 1px 0 #000;
      animation: bwRowIn 0.35s ease-out both;
    }
    .bw-lines > div.final {
      margin-top: 4px;
      font-size: 16px; letter-spacing: 2px;
      color: #ffd34d;
      text-shadow: 0 0 10px #ffd34d, 2px 2px 0 #000;
    }
    .bw-taunts {
      width: 100%; display: flex; flex-direction: column; gap: 4px;
      padding: 8px 0; border-top: 1px dashed #5a1010; border-bottom: 1px dashed #5a1010;
    }
    .bw-taunts > div {
      font-size: 10px; letter-spacing: 3px; color: #aa6a1a;
      text-shadow: 1px 1px 0 #000;
    }
    .bw-buttons {
      display: flex; gap: 14px; margin-top: 12px; flex-wrap: wrap; justify-content: center;
    }
    .bw-btn {
      font-family: 'Courier New', monospace;
      font-size: 14px; letter-spacing: 3px;
      padding: 12px 22px;
      cursor: pointer;
      font-weight: 900;
      border: 3px solid #fff8e0;
      box-shadow: 0 0 16px rgba(255,80,80,0.3);
      transition: transform 0.1s, box-shadow 0.15s;
    }
    .bw-btn:hover { transform: translateY(-2px); box-shadow: 0 0 26px rgba(255,80,80,0.7); }
    .bw-btn:active { transform: translateY(1px); }
    .bw-btn.danger {
      background: linear-gradient(180deg, #aa1a1a, #5a0606);
      color: #ffd34d;
      text-shadow: 0 0 8px #ffd34d, 1px 1px 0 #000;
    }
    .bw-btn.safe {
      background: linear-gradient(180deg, #3a3a3a, #1a1a1a);
      color: #cdb98a;
      border-color: #5a4a30;
    }
    .bw-buildup {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      z-index: 196; background: radial-gradient(circle, rgba(255,80,80,0.15), rgba(0,0,0,0.9));
      font-family: 'Courier New', monospace; color: #ff5050; font-weight: 900;
      font-size: clamp(48px, 8vw, 96px); letter-spacing: 12px;
      text-shadow: 0 0 24px #ff5050, 4px 4px 0 #000;
    }
  `;
  document.head.appendChild(s);
}

// ─── Render helper ──────────────────────────────────────────────────────
interface RenderArgs {
  parent: HTMLElement;
  dossier: BossDossier;
  taunts: string[];
  headline: string;
  subhead: string;
  lines: string[];          // body lines; last one rendered with .final
  confirmLabel: string;
  cancelLabel: string;
  isFinal: boolean;         // true for the second screen — adds the dramatic exit
  onConfirm: () => void;
  onCancel: () => void;
}

function renderScreen(args: RenderArgs): HTMLElement {
  ensureStyle();
  const wrap = document.createElement('div');
  wrap.id = args.isFinal ? 'boss-warning-2' : 'boss-warning-1';
  wrap.className = 'bw-overlay';
  // Prefer dedicated boss-portrait art when supplied; fall back to the
  // in-game enemy sprite otherwise.
  const portrait = args.dossier.portrait ?? spriteSrcFor(args.dossier.sprite);
  const portraitHtml = portrait
    ? `<img src="${portrait}" alt="${args.dossier.name}"/>`
    : '<div style="width:96px;height:96px;border:2px solid #aa1a1a;background:#1a0404;color:#ee5050;display:flex;align-items:center;justify-content:center;font-size:11px;letter-spacing:2px">BOSS</div>';
  const linesHtml = args.lines.map((line, idx) => {
    const cls = idx === args.lines.length - 1 ? 'final' : '';
    const delay = (idx * 0.08).toFixed(2);
    return `<div class="${cls}" style="animation-delay:${delay}s">${line}</div>`;
  }).join('');
  const tauntsHtml = args.taunts.map(t => `<div>▸ ${t}</div>`).join('');
  wrap.innerHTML = `
    <div class="bw-scanlines"></div>
    <div class="bw-vignette"></div>
    <div class="bw-panel">
      <div class="bw-subhead">${args.subhead}</div>
      <div class="bw-headline">${args.headline}</div>
      <div class="bw-bossart">
        ${portraitHtml}
        <div>
          <div class="bw-bossname">${args.dossier.name}</div>
          <div class="bw-bossfaction">${args.dossier.faction}</div>
        </div>
      </div>
      <div class="bw-lines">${linesHtml}</div>
      <div class="bw-taunts">${tauntsHtml}</div>
      <div class="bw-buttons">
        <button class="bw-btn danger" id="bw-confirm">${args.confirmLabel}</button>
        <button class="bw-btn safe" id="bw-cancel">${args.cancelLabel}</button>
      </div>
    </div>`;
  args.parent.appendChild(wrap);
  (wrap.querySelector('#bw-confirm') as HTMLButtonElement).onclick = args.onConfirm;
  (wrap.querySelector('#bw-cancel') as HTMLButtonElement).onclick = args.onCancel;
  // 2026-05-24 — Per UI audit: pressing Escape on the boss warning used
  // to be intercepted by main.ts's universal ESC handler, which just
  // .remove()d the DOM node WITHOUT firing onCancel. That left the
  // audio sting playing, the scheduled wave-start armed, and a
  // half-confirmed UI state. Now Escape routes through onCancel so the
  // dismissal is clean.
  const escHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      args.onCancel();
    }
  };
  document.addEventListener('keydown', escHandler);
  // Auto-cleanup the listener whenever the wrap is removed from the DOM
  // (e.g. the universal ESC handler still kicks in on Escape, or
  // onConfirm/onCancel does the .remove()).
  const observer = new MutationObserver(() => {
    if (!wrap.isConnected) {
      document.removeEventListener('keydown', escHandler);
      observer.disconnect();
    }
  });
  observer.observe(args.parent, { childList: true });
  return wrap;
}

// ─── Public entry point ─────────────────────────────────────────────────
export function showBossWarning(parent: HTMLElement, wave: number, onConfirm: () => void) {
  ensureStyle();
  const dossier = BOSS_DATA[wave] ?? GENERIC_DOSSIER;

  // Try to play an alert SFX if the audio manager exposes one.
  try {
    const audio = (window as any).SFX ?? (window as any).__sfx;
    if (audio && typeof audio.bossArrival === 'function') audio.bossArrival();
  } catch { /* silent */ }

  // ── First screen: warning ────────────────────────────────────────────
  const firstScreen = renderScreen({
    parent,
    dossier,
    taunts: pickTwoTaunts(),
    subhead: 'INCOMING BOSS WAVE ' + wave,
    headline: 'HALT, GENERAL.',
    lines: dossier.warning,
    confirmLabel: 'YES, I AM READY',
    cancelLabel: 'NO, I NEED MORE TIME',
    isFinal: false,
    onConfirm: () => {
      firstScreen.remove();
      // ── Second screen: doom ────────────────────────────────────────
      const secondScreen = renderScreen({
        parent,
        dossier,
        taunts: pickTwoTaunts(),
        subhead: 'FINAL CHANCE — WAVE ' + wave,
        headline: 'YOU ACTUALLY CLICKED YES.',
        lines: dossier.doom,
        confirmLabel: 'I ACCEPT MY FATE',
        cancelLabel: 'ACTUALLY... NO',
        isFinal: true,
        onConfirm: () => {
          // 2026-05-22 — Audio kick on I ACCEPT MY FATE.
          //   1) FINISH HIM punch — Mortal-Kombat-style sting that
          //      lands hard the instant the player commits.
          //   2) FF7 One-Winged Angel music bed — looped, starts
          //      with the flash, carries through the buildup and
          //      into the wave so the boss arrives mid-Sephiroth.
          //      Tagged 'boss-fate' so the existing W20 wave-start
          //      hook (which also plays this track under id 'boss20')
          //      doesn't conflict — both id slots can coexist.
          try { SFX.finishHim(); } catch { /* ignore */ }
          try {
            playMusicTrack(
              'boss-fate',
              sfx('assets/sfx/ff7_one_winged_angel.mp3'),
              { loop: true, gain: 0.65 }
            );
          } catch { /* ignore */ }
          // Dramatic flash on the second confirmation.
          const flash = document.createElement('div');
          flash.className = 'bw-flash';
          secondScreen.appendChild(flash);

          // After flash, show a brief countdown buildup, then fire.
          setTimeout(() => {
            secondScreen.querySelector('.bw-panel')!.remove();
            const buildup = document.createElement('div');
            buildup.className = 'bw-buildup';
            buildup.textContent = '3';
            secondScreen.appendChild(buildup);
            let n = 3;
            const tick = setInterval(() => {
              n -= 1;
              if (n <= 0) {
                clearInterval(tick);
                secondScreen.remove();
                onConfirm();
                return;
              }
              buildup.textContent = String(n);
            }, 500);
          }, 600);
        },
        onCancel: () => {
          secondScreen.remove();
        }
      });
    },
    onCancel: () => { firstScreen.remove(); }
  });
}

// Helper used by main.ts to check if a wave should gate behind verification.
// Currently the authored major boss waves in the 30-wave campaign.
export function isVerifiedBossWave(wave: number): boolean {
  // 2026-06-25 — added the myth-age signature bosses W25 (Super Giant
  // Colossus) and W27 (Typhon); dropped W15 (no longer a boss wave).
  return (VERIFIED_BOSS_WAVES as readonly number[]).includes(wave);
}

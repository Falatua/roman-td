// Lightweight Web Audio synth for SFX. No real audio assets — generates tones on demand.
// Faction BGM is also synthesized as a slow looped chord progression.
//
// 2026-05 v11 (B2): Separate volume tracks (master / music / sfx) with
// localStorage persistence. The global `muted` flag still mutes everything.

let ctx: AudioContext | null = null;
let muted = false;

// Volume tracks (0..1). Master gates both; music + sfx scale their respective tones.
let masterVol = 1;
let musicVol = 1;
let sfxVol = 1;

const LS_KEY = 'roman_td_audio_v1';

function loadAudioPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (typeof obj.masterVol === 'number') masterVol = Math.max(0, Math.min(1, obj.masterVol));
    if (typeof obj.musicVol === 'number') musicVol = Math.max(0, Math.min(1, obj.musicVol));
    if (typeof obj.sfxVol === 'number') sfxVol = Math.max(0, Math.min(1, obj.sfxVol));
    if (typeof obj.muted === 'boolean') muted = obj.muted;
  } catch {/* corrupt JSON — ignore */}
}
// Auto-load on module init so first sound respects saved prefs.
loadAudioPrefs();

function persistAudioPrefs() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ masterVol, musicVol, sfxVol, muted }));
  } catch {/* private mode / quota — ignore */}
}

function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// `track` switches between sfx and music volume buses. Defaults to 'sfx'.
function tone(freq: number, durationSec: number, type: OscillatorType = 'sine', gain = 0.18, sweepTo?: number, track: 'sfx' | 'music' = 'sfx') {
  if (muted) return;
  const trackVol = track === 'music' ? musicVol : sfxVol;
  const finalGain = gain * masterVol * trackVol;
  if (finalGain <= 0.0001) return; // fully attenuated — skip Web Audio work
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (sweepTo !== undefined) o.frequency.exponentialRampToValueAtTime(sweepTo, a.currentTime + durationSec);
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(finalGain, a.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + durationSec);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + durationSec);
}

export const SFX = {
  // ─── MELEE FAMILY (distinct from ranged twangs) ──────────────────────────
  // Quick high slash — light melee (Milites, Skizzer, Pugio Assassin)
  meleeSwordLight: () => { tone(540, 0.07, 'sawtooth', 0.14, 220); },
  // Heavy clang + low thud — Centurion, Primus Pilus, Imperator Guard, Cohort Guard, Praetorian Wall, Cataphract, Evocatus
  meleeSwordHeavy: () => { tone(180, 0.10, 'square', 0.20, 90); setTimeout(()=>tone(110, 0.18, 'sawtooth', 0.22, 60), 35); },
  // Spear thrust — Hastati, Triarius, Horseman
  meleeSpear: () => { tone(380, 0.06, 'sawtooth', 0.13, 200); setTimeout(()=>tone(260, 0.08, 'square', 0.10, 160), 40); },
  // Legacy alias
  swordSwing: () => tone(220, 0.12, 'sawtooth', 0.15, 80),
  // ─── RANGED FAMILY ──────────────────────────────────────────────────────
  bowstring: () => tone(640, 0.07, 'square', 0.10, 360),
  // Crossbow click-snap — Arcuballista, Carroballista
  crossbow: () => { tone(900, 0.04, 'square', 0.10, 700); setTimeout(()=>tone(420, 0.06, 'sawtooth', 0.12, 280), 30); },
  // Heavy javelin throw — Decurion, Clibanarius, Praefectus, Eques, Frozen Legion
  javelinThrow: () => { tone(560, 0.06, 'sawtooth', 0.12, 320); setTimeout(()=>tone(320, 0.07, 'square', 0.10, 220), 35); },
  // Divine staff cast — Legate, Flamen, Augur, Haruspex, Solar Priest
  staffCast: () => { tone(880, 0.10, 'sine', 0.12); setTimeout(()=>tone(1320, 0.12, 'sine', 0.10), 60); },
  // Fire whoosh — Ignifer, Plague Cart
  fireWhoosh: () => { tone(140, 0.20, 'sawtooth', 0.18, 320); tone(420, 0.14, 'square', 0.10, 200); },
  ballista: () => tone(120, 0.18, 'sawtooth', 0.22, 60),
  catapultBoom: () => { tone(80, 0.4, 'sawtooth', 0.3, 30); tone(180, 0.25, 'square', 0.18, 70); },
  hit: () => tone(380, 0.06, 'square', 0.1, 220),
  // ─── COMBO TOWER SIGNATURE SOUNDS ────────────────────────────────────────
  // Each combo unit has a unique on-attack flavor.
  comboHorseman: () => { tone(140, 0.10, 'square', 0.18, 80); setTimeout(()=>tone(180, 0.10, 'square', 0.16, 110), 60); setTimeout(()=>tone(220, 0.08, 'square', 0.14, 140), 120); }, // hoofbeats
  comboScorpionBolt: () => { tone(140, 0.06, 'sawtooth', 0.20, 70); setTimeout(()=>tone(140, 0.06, 'sawtooth', 0.18, 70), 35); setTimeout(()=>tone(140, 0.06, 'sawtooth', 0.16, 70), 70); }, // 3 bolts
  comboCohortGuard: () => { tone(220, 0.12, 'square', 0.22, 110); setTimeout(()=>tone(360, 0.10, 'sawtooth', 0.16, 240), 60); }, // shield bash
  comboWarChariot: () => { tone(90, 0.30, 'sawtooth', 0.28, 50); setTimeout(()=>tone(220, 0.18, 'square', 0.18, 90), 100); }, // wheels + impact
  comboEagleStandard: () => { [440, 554, 659, 880].forEach((f, i) => setTimeout(()=>tone(f, 0.16, 'triangle', 0.16), i * 60)); }, // trumpet fanfare
  comboPlagueCart: () => { tone(200, 0.18, 'sawtooth', 0.18, 90); setTimeout(()=>tone(120, 0.18, 'square', 0.14, 180), 80); }, // sickly hiss
  comboNumidian: () => { tone(680, 0.05, 'square', 0.14, 320); setTimeout(()=>tone(580, 0.05, 'square', 0.12, 280), 30); setTimeout(()=>tone(480, 0.05, 'square', 0.10, 240), 60); }, // light volley
  comboPraetorianWall: () => { tone(160, 0.18, 'square', 0.24, 90); setTimeout(()=>tone(100, 0.22, 'sawtooth', 0.20, 60), 60); }, // big shield clang
  comboAerarium: () => { [880, 1100, 1320, 1760].forEach((f, i) => setTimeout(()=>tone(f, 0.07, 'sine', 0.12), i * 35)); }, // coin chime
  comboSiegeOnager: () => { tone(60, 0.5, 'sawtooth', 0.32, 22); setTimeout(()=>tone(160, 0.30, 'square', 0.22, 60), 90); setTimeout(()=>tone(90, 0.40, 'sawtooth', 0.18, 40), 220); }, // huge boom
  comboAquilifer: () => { tone(220, 0.40, 'sawtooth', 0.22, 110); setTimeout(()=>tone(165, 0.50, 'sawtooth', 0.22, 82), 200); setTimeout(()=>tone(110, 0.6, 'square', 0.20, 55), 400); }, // deep horn + reverb
  comboInfernoCart: () => { tone(110, 0.22, 'sawtooth', 0.26, 70); tone(330, 0.18, 'square', 0.16, 220); setTimeout(()=>tone(80, 0.30, 'sawtooth', 0.20, 50), 100); }, // fire roar
  comboFrozenLegion: () => { tone(1760, 0.05, 'sine', 0.14); setTimeout(()=>tone(2200, 0.06, 'sine', 0.12), 40); setTimeout(()=>tone(880, 0.18, 'triangle', 0.14), 90); }, // ice shatter + chime
  comboJuliusCaesar: () => { [330, 415, 494, 659, 880].forEach((f, i) => setTimeout(()=>tone(f, 0.18, 'triangle', 0.16), i * 70)); }, // imperial fanfare
  comboHannibal: () => { tone(85, 0.50, 'sawtooth', 0.30, 50); setTimeout(()=>tone(140, 0.40, 'square', 0.22, 90), 200); setTimeout(()=>tone(200, 0.30, 'triangle', 0.18, 130), 400); }, // war elephant
  comboGodOfWar: () => { tone(40, 0.50, 'sawtooth', 0.34, 25); setTimeout(()=>{ [440, 554, 659, 880, 1109].forEach((f, i)=>setTimeout(()=>tone(f, 0.20, 'triangle', 0.18), i*80)); }, 200); }, // thunder + war horn
  enemyDeath: () => tone(120, 0.18, 'sawtooth', 0.18, 60),
  bossDeath: () => { tone(80, 0.6, 'sawtooth', 0.3, 30); tone(220, 0.4, 'square', 0.2, 120); },
  bossArrival: () => {
    /* Distinct from waveStart: heavy descending brass triple + low drum thud */
    tone(330, 0.35, 'sawtooth', 0.28, 110);
    setTimeout(() => tone(247, 0.40, 'sawtooth', 0.30, 90), 200);
    setTimeout(() => tone(165, 0.55, 'sawtooth', 0.34, 60), 460);
    setTimeout(() => { tone(55, 0.6, 'square', 0.34, 28); tone(82, 0.4, 'sawtooth', 0.20, 40); }, 800);
  },
  itemPickup: (rarity: string) => {
    const base = { COMMON: 440, UNCOMMON: 520, RARE: 660, LEGENDARY: 880, UNIQUE: 1024 } as Record<string, number>;
    const f = base[rarity] ?? 440;
    tone(f, 0.12, 'sine', 0.18);
    setTimeout(() => tone(f * 1.5, 0.12, 'sine', 0.16), 80);
    if (rarity === 'LEGENDARY' || rarity === 'UNIQUE') {
      setTimeout(() => tone(f * 2, 0.18, 'sine', 0.14), 160);
      setTimeout(() => tone(f * 2.5, 0.22, 'sine', 0.12), 250);
    }
  },
  // Distinct from pickup: this fires the moment an enemy DROPS the item on the ground,
  // so the player notices the drop before auto-pickup at wave end. Bright bell-toll triad.
  itemDrop: (rarity: string) => {
    const base = { COMMON: 660, UNCOMMON: 740, RARE: 880, LEGENDARY: 988, UNIQUE: 1175 } as Record<string, number>;
    const f = base[rarity] ?? 660;
    tone(f, 0.18, 'triangle', 0.22);
    setTimeout(() => tone(f * 1.25, 0.18, 'triangle', 0.20), 90);
    setTimeout(() => tone(f * 1.5, 0.22, 'sine', 0.18), 180);
    if (rarity === 'LEGENDARY' || rarity === 'UNIQUE') {
      // Extra fanfare for legendaries
      setTimeout(() => tone(f * 2, 0.30, 'sine', 0.20), 280);
      setTimeout(() => tone(f * 2.5, 0.40, 'sine', 0.16), 380);
    }
  },
  waveStart: () => { tone(220, 0.18, 'sawtooth', 0.2); setTimeout(() => tone(330, 0.25, 'sawtooth', 0.18), 100); },
  buy: () => tone(880, 0.08, 'sine', 0.16),
  combo: () => { tone(330, 0.18, 'sine', 0.18); setTimeout(() => tone(440, 0.18, 'sine', 0.18), 120); setTimeout(() => tone(660, 0.3, 'sine', 0.18), 240); },
  comboAvailable: () => {
    /* Distinct three-note ascending chime when a new combination becomes available. */
    tone(523, 0.10, 'sine', 0.16);
    setTimeout(() => tone(659, 0.10, 'sine', 0.16), 90);
    setTimeout(() => tone(784, 0.18, 'sine', 0.18), 180);
  },
  // Triumphant fanfare when a combination is actually executed (player merged a tower).
  // Bigger arpeggio + a low-register punctuation, distinct from comboAvailable.
  comboExecuted: () => {
    tone(523, 0.08, 'triangle', 0.18);
    setTimeout(() => tone(659, 0.08, 'triangle', 0.18), 70);
    setTimeout(() => tone(784, 0.10, 'triangle', 0.20), 140);
    setTimeout(() => tone(1047, 0.20, 'sine', 0.22), 230);
    setTimeout(() => tone(110, 0.30, 'sawtooth', 0.20, 55), 280);    // low punctuation
    setTimeout(() => tone(1320, 0.18, 'sine', 0.16), 360);
  },
  victory: () => {
    [440, 550, 660, 880].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'sine', 0.2), i * 250));
  },
  defeat: () => { tone(220, 1.5, 'sawtooth', 0.3, 60); },
  // ─── BOSS WAVE STING ────────────────────────────────────────────────
  // Eerie pre-boss-wave atmosphere: dropping low rumble + dissonant minor
  // chord stack + a high whining drone. Plays once when a boss wave kicks
  // off, separate from the existing bossArrival fanfare (which fires for
  // boss spawns mid-wave too).
  bossWaveImpending: () => {
    // Low rumble bed
    tone(38, 1.6, 'sawtooth', 0.34, 22);
    tone(55, 1.4, 'square', 0.22, 32);
    // Dissonant tritone over the rumble — instant "wrong"
    setTimeout(() => tone(220, 0.9, 'sawtooth', 0.18, 100), 200);
    setTimeout(() => tone(311, 0.9, 'square',   0.16, 140), 250);   // tritone (220 → 311 ≈ F♯)
    // High whining drone — slow descending glide for dread
    setTimeout(() => tone(1320, 1.4, 'triangle', 0.10, 720), 450);
    setTimeout(() => tone(880,  1.2, 'sine',     0.10, 540), 700);
    // Final ominous hit
    setTimeout(() => { tone(60, 0.8, 'sawtooth', 0.34, 28); tone(165, 0.5, 'square', 0.22, 70); }, 1400);
  },
  // ─── ENEMY LEAK / GATE BREACH ────────────────────────────────────────
  // Heavy gate-clang + low impact thud. Fires every time an enemy slips
  // through to Rome — distinct from bossArrival/defeat so the player knows
  // a leak just happened. Slightly different pitch for boss leaks (lower,
  // more dramatic) controlled by the `isBoss` arg.
  gateBreach: (isBoss = false) => {
    const lowF = isBoss ? 60 : 90;
    const clangF = isBoss ? 180 : 280;
    tone(lowF, 0.30, 'sawtooth', 0.30, 30);
    tone(clangF, 0.18, 'square', 0.22, 140);
    setTimeout(() => tone(lowF * 0.7, 0.40, 'sawtooth', 0.24, 25), 90);
    if (isBoss) {
      // Boss-leak adds an extra slow whump for emphasis
      setTimeout(() => tone(45, 0.6, 'sawtooth', 0.32, 22), 200);
    }
  },
  // ─── SAMPLE-BASED SFX ────────────────────────────────────────────────
  // One-shot MP3s for placement / keep / combo. All route through the
  // master × sfx bus and respect mute — same control surface as every
  // other SFX in this module.
  prospectPlace:  () => playSample(sfx('assets/sfx/prospect_place.mp3'), 0.65),
  prospectKeep:   () => playSample(sfx('assets/sfx/prospect_keep.mp3'),  0.7),
  comboMade:      () => playSample(sfx('assets/sfx/combo_made.mp3'),     0.7),
  waveStartBlast: () => playSample(sfx('assets/sfx/wave_start.mp3'),     0.65),
  bossKilled:     () => playSample(sfx('assets/sfx/boss_killed.mp3'),    0.75),
  waveSurvived:   () => playSample(sfx('assets/sfx/wave_survived.mp3'),  0.7),
  flyerKilled:    () => playSample(sfx('assets/sfx/flyer_killed.mp3'),   0.7),
  poolUpgrade:    () => playSample(sfx('assets/sfx/pool_upgrade.mp3'),   0.7),
  bossWaveStart:  () => playSample(sfx('assets/sfx/boss_wave_start.mp3'), 0.8),
  coinSlot:       () => playSample(sfx('assets/sfx/coin_slot.mp3'),      0.7),
  codexOpen:      () => playSample(sfx('assets/sfx/codex_open.mp3'),     0.7),
  // 2026-05 v10 — themed-music drops. Each one is a real licensed/
  // referential cue from the original brief; the engine plays them
  // through the standard MP3 sample path.
  //   • coin3 → basic-ground-enemy kill bling
  //   • fatality → game over (lives = 0)
  // Looping cues (loading screen, W20 boss, prospect-phase reminder)
  // and the boss low-HP one-shot are wired below via dedicated
  // helpers so they can respect start/stop semantics.
  coin3:          () => playSample(sfx('assets/sfx/coin_3.mp3'),         0.55),
  fatality:       () => playSample(sfx('assets/sfx/fatality_5.mp3'),     0.85),
  finishHim:      () => playSample(sfx('assets/sfx/finish_him.mp3'),     0.85)
};

// 2026-05-16 — SURPRISE EVENT STINGS. Each event gets a unique sinister
// signature so the player learns to identify Invasion vs Uprising by ear:
//   • INVASION → low brass triad + crackle hiss (siege, raid, burning gates).
//   • UPRISING → discordant church organ + bone-rattle clicks (necrotic ritual).
// Both are synth-only (no sample files yet) so they ship without an asset
// dependency. Each fires once at the moment the first spawn point lights up.
export function surpriseEventSting(kind: 'INVASION' | 'UPRISING'): void {
  if (kind === 'INVASION') {
    // Heavy low-brass descending triad — "the gates are burning"
    tone(165, 0.55, 'sawtooth', 0.30, 110);     // F3
    setTimeout(() => tone(123, 0.65, 'sawtooth', 0.34, 82), 280);   // B2
    setTimeout(() => tone(82,  0.85, 'square',   0.36, 55), 600);   // E2 (deep)
    // Fire crackle hiss layered on top — short bursts of high noise
    setTimeout(() => { for (let i = 0; i < 6; i++) setTimeout(() => tone(1800 + Math.random()*900, 0.04, 'square', 0.08, 600), i*55); }, 200);
    // Closing low impact thud
    setTimeout(() => { tone(45, 0.5, 'sawtooth', 0.34, 22); tone(110, 0.3, 'square', 0.20, 55); }, 1100);
  } else {
    // UPRISING — dissonant minor-second church organ stab + bone clicks
    tone(196, 0.7, 'triangle', 0.22, 196);      // G3 sustain
    setTimeout(() => tone(207, 0.7, 'triangle', 0.22, 207), 60);     // G#3 (minor 2nd) — instant "wrong"
    setTimeout(() => tone(98,  0.9, 'sawtooth', 0.28, 70), 200);    // G2 deep pedal
    // Bone-rattle clicks — short high taps in an irregular rhythm
    [0, 110, 200, 340, 480, 620, 760].forEach((delay, i) => {
      setTimeout(() => tone(2400 + (i % 3) * 200, 0.03, 'square', 0.12, 1800), 300 + delay);
    });
    // Closing dirge note — deep dissonant fundamental
    setTimeout(() => { tone(58, 0.9, 'sawtooth', 0.32, 28); tone(87, 0.7, 'square', 0.20, 55); }, 1200);
  }
}

// 2026-05-17 — RELATIVE-PATH BUG FIX. We were using `/assets/sfx/foo.mp3`
// everywhere, which is an ABSOLUTE path. On GitHub Pages the game lives
// under `/roman-td/`, so `/assets/...` resolves to the root domain and
// every mp3 silently 404s. `sfx()` prepends the Vite-supplied BASE_URL
// (which is `./` in our config) so the same string works in both `npm
// run dev` (page at `/`) and on the deployed site (page at `/roman-td/`).
//
// Call this for every mp3 url instead of writing a literal string with
// a leading `/`. Sample call sites use it directly below.
export function sfx(path: string): string {
  // Vite injects BASE_URL into the bundle at build time; in `npm run dev`
  // it's `/`, on GitHub Pages with `base: './'` it becomes `./`.
  // (Cast to any avoids a tsc complaint without needing the `vite/client`
  // ambient types in tsconfig.)
  const base = (import.meta as any).env?.BASE_URL || './';
  const clean = path.replace(/^\/+/, '');     // strip leading slashes if any
  return base.endsWith('/') ? base + clean : base + '/' + clean;
}

// Sample cache: decoded AudioBuffers keyed by URL.
const sampleCache = new Map<string, AudioBuffer>();
const samplePending = new Map<string, Promise<AudioBuffer>>();

async function loadSample(url: string): Promise<AudioBuffer> {
  const cached = sampleCache.get(url);
  if (cached) return cached;
  const pending = samplePending.get(url);
  if (pending) return pending;
  const p = (async () => {
    const a = ac();
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const audioBuf = await a.decodeAudioData(buf);
    sampleCache.set(url, audioBuf);
    samplePending.delete(url);
    return audioBuf;
  })();
  samplePending.set(url, p);
  return p;
}

// 2026-05-17 — Preload every mp3 SFX at boot so the first play is
// instant. Without this, each unique sound has a perceptible delay on
// first trigger (fetch + decode latency, typically 100-500ms on the
// public CDN). Preload runs in parallel and silently swallows errors so
// a missing file doesn't block gameplay.
//
// The list mirrors every `playSample(sfx('assets/sfx/...'))` call site
// in this module — keep them in sync when adding a new sample.
const PRELOAD_SFX_PATHS = [
  'assets/sfx/prospect_place.mp3',
  'assets/sfx/prospect_keep.mp3',
  'assets/sfx/combo_made.mp3',
  'assets/sfx/wave_start.mp3',
  'assets/sfx/boss_killed.mp3',
  'assets/sfx/wave_survived.mp3',
  'assets/sfx/flyer_killed.mp3',
  'assets/sfx/pool_upgrade.mp3',
  'assets/sfx/boss_wave_start.mp3',
  'assets/sfx/coin_slot.mp3',
  'assets/sfx/codex_open.mp3',
  'assets/sfx/coin_3.mp3',
  'assets/sfx/fatality_5.mp3',
  'assets/sfx/finish_him.mp3'
];

export async function preloadAllSamples(): Promise<void> {
  // Fire all loads in parallel. Web Audio decode is CPU-bound so the
  // browser will serialize the decode step regardless, but the fetches
  // can race in parallel.
  await Promise.allSettled(PRELOAD_SFX_PATHS.map(p => loadSample(sfx(p))));
}

// Plays a decoded sample through the SFX bus. Fires-and-forgets — safe to
// call from any UI handler. First call for a given URL does a one-time
// fetch+decode; subsequent calls hit the cache.
function playSample(url: string, gain = 0.6) {
  if (muted) return;
  const finalGain = gain * masterVol * sfxVol;
  if (finalGain <= 0.0001) return;
  loadSample(url).then(buf => {
    // Re-check mute at play time — user may have toggled during the async load.
    if (muted) return;
    const a = ac();
    const src = a.createBufferSource();
    src.buffer = buf;
    const g = a.createGain();
    g.gain.setValueAtTime(finalGain, a.currentTime);
    src.connect(g).connect(a.destination);
    src.start();
  }).catch(() => { /* asset missing / decode failure — silent fallback */ });
}

let bgmInterval: number | null = null;
let currentFaction: string | null = null;

const FACTION_CHORDS: Record<string, number[][]> = {
  DOGS:           [[110, 165], [110, 220]],
  CELTS:          [[147, 220], [147, 196], [196, 247]],
  CARTHAGE:       [[110, 165, 220], [98, 147, 196]],
  UNDEAD_CELTS:   [[110, 138, 165], [98, 124, 147]],
  UNDEAD_CARTHAGE:[[87, 110, 138], [82, 104, 130]],
  SUPER_DEMONS:   [[65, 87, 110], [73, 98, 123]]
};

export function setFactionBGM(faction: string) {
  if (currentFaction === faction) return;
  currentFaction = faction;
  if (bgmInterval !== null) clearInterval(bgmInterval);
  const chords = FACTION_CHORDS[faction] ?? FACTION_CHORDS.DOGS;
  let idx = 0;
  bgmInterval = window.setInterval(() => {
    if (muted) return;
    const ch = chords[idx % chords.length];
    // Music track — `track='music'` routes through musicVol bus.
    for (const f of ch) tone(f, 1.6, 'triangle', 0.05, undefined, 'music');
    idx++;
  }, 1700);
}

export function setMuted(m: boolean) {
  muted = m;
  if (m && bgmInterval !== null) { clearInterval(bgmInterval); bgmInterval = null; }
  else if (!m && currentFaction) {
    const f = currentFaction;
    currentFaction = null;       // force setFactionBGM to re-prime
    setFactionBGM(f);
  }
  // 2026-05 v10 — propagate mute to in-flight HTML5 music tracks too.
  // Without this the FF7 / Smash Bros / boss music would keep playing
  // through the speakers even after the player muted the game.
  for (const a of musicTracks.values()) a.muted = m;
  persistAudioPrefs();
}

export function isMuted(): boolean { return muted; }

// ─── Volume bus controls (B2) ────────────────────────────────────────────
export function getMasterVolume(): number { return masterVol; }
export function getMusicVolume(): number { return musicVol; }
export function getSfxVolume(): number { return sfxVol; }
export function setMasterVolume(v: number) {
  masterVol = Math.max(0, Math.min(1, v));
  reapplyMusicVolumes();
  persistAudioPrefs();
}
export function setMusicVolume(v: number) {
  musicVol = Math.max(0, Math.min(1, v));
  reapplyMusicVolumes();
  persistAudioPrefs();
}
export function setSfxVolume(v: number) {
  sfxVol = Math.max(0, Math.min(1, v));
  persistAudioPrefs();
}

// ─── MUSIC TRACK LOOPS (2026-05 v10) ─────────────────────────────────
// Track-based music playback. Each track has a unique ID; calling
// `playMusicTrack(id, url, opts)` starts the loop (replacing any prior
// track with the same id if `replace: true`). `stopMusicTrack(id)`
// halts the loop and disposes the audio element.
//
// Implementation uses a single `HTMLAudioElement` per track (rather
// than WebAudio buffer-source) so we get free streaming + looping for
// the longer cues (One-Winged Angel, fanfare) without parking the
// entire file in memory. Volume routes through musicVol × masterVol.
const musicTracks = new Map<string, HTMLAudioElement>();

export function playMusicTrack(
  id: string,
  url: string,
  opts: { loop?: boolean; gain?: number; replace?: boolean } = {}
) {
  if (muted) return;
  const loop = opts.loop ?? true;
  const gain = opts.gain ?? 0.7;
  const replace = opts.replace ?? true;
  // If the same id is already loaded but PAUSED (browser autoplay
  // rejection), attempt to play it again — the calling site is
  // typically inside a user gesture so this second try succeeds.
  // If it's already playing, leave it alone when replace=false.
  const existing = musicTracks.get(id);
  if (existing && !replace) {
    if (existing.paused) {
      const p = existing.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* still blocked */ });
    }
    return;
  }
  // Otherwise stop the prior instance of this id so the new track
  // doesn't double-up.
  stopMusicTrack(id);
  try {
    const audio = new Audio(url);
    audio.loop = loop;
    audio.volume = Math.max(0, Math.min(1, gain * masterVol * musicVol));
    audio.preload = 'auto';
    // Some browsers reject autoplay without a prior user gesture. The
    // calling site is responsible for being downstream of one (click,
    // wave-start, etc.). On rejection, log silently — the next call
    // will retry.
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => { /* autoplay-blocked — silent fallback */ });
    }
    musicTracks.set(id, audio);
  } catch { /* ignore decode/load errors */ }
}

export function stopMusicTrack(id: string) {
  const existing = musicTracks.get(id);
  if (!existing) return;
  try {
    existing.pause();
    existing.currentTime = 0;
    existing.src = '';     // help GC reclaim the stream
  } catch { /* ignore */ }
  musicTracks.delete(id);
}

export function stopAllMusicTracks() {
  for (const id of Array.from(musicTracks.keys())) stopMusicTrack(id);
}

// Re-apply mute/volume to in-flight music elements. Called by setMuted
// and the volume setters so existing tracks honor changes immediately
// instead of waiting for the next play call.
export function reapplyMusicVolumes() {
  for (const a of musicTracks.values()) {
    a.volume = muted ? 0 : Math.max(0, Math.min(1, 0.7 * masterVol * musicVol));
  }
}

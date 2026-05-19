import { GamePhase, TileType, TowerType, TargetingMode, DrawCard, DamageType } from './types';
import { ECONOMY, GRID, FACTION_WEATHER, WAVE_MODIFIERS, WORLD, AURA_TILES, AURA_TILE_EFFECTS } from './constants';
import { createGameState } from './GameState';
import { initializeGrid, isBuildable, pixelToTile, setTile, tileAt } from './systems/GridManager';
import { buildGroundPath, buildFlyerPath, canPlaceStone, resnapEnemiesToPath } from './systems/PathFinder';
import { tickEnemies, spawnEnemy, tickBurnPatches, tickBossHazards } from './systems/EnemySystem';
import { startWave, tickSpawns, checkWaveEnd, getNextWaveInfo } from './systems/WaveManager';
import { tickCombat, awardKillBonus, applyDamageAndStatus, hasCleave } from './systems/CombatResolver';
import { tickProjectiles } from './systems/ProjectileSystem';
import { createGoreState, emitDeathSplatter, emitHitSplatter, emitHitSpark, emitTypedImpact, emitStatusImpact, emitFloatingNumber, fadeCorpsesAtWaveEnd, pruneCorpses, tickGore } from './systems/GoreSystem';
import { createInventory, maybeRollLootOnKill, rollBossDrop, spawnLootAt, autoPickupOnBuildPhase, inventoryAdd, inventoryRemove, currentlyOwnedLegendarySet } from './systems/LootSystem';
import { buildGateShop, buildMercatorStock, buildMercatorTowerOffers, isMercatorWave, gateShopRefreshDue, ShopState } from './systems/MerchantSystem';
import { createBossRuntime, tickBossScripts, handleBossDeath, applyEnemyAuras } from './systems/BossScripts';
import wavesData from './data/waves.json';
import { canAfford, earnGold, poolUpgradeCost, spendGold, bumpHeroXP, effectivePoolLevel } from './systems/EconomySystem';
import { BASE_TOWER_TYPES, createTower, rollDraw, findRandomBuildTiles, towerAuraTileKind, towerEffectiveStats } from './systems/TowerSystem';
import { scanCombos, executeCombo } from './systems/CombinationEngine';
import { evaluateQuests, ensureQuestState, QuestDef, QUESTS, activeQuestsByTier, evaluateQuestTierBonuses, QUEST_TIER_BONUS } from './systems/QuestSystem';
import towersData from './data/towers.json';
import itemsData from './data/items_permanent.json';
import { loadAllAssets, tex as getTexture, texUrl } from './render/Assets';
import { RenderEngine } from './render/RenderEngine';
import { UIManager } from './render/UIManager';
import { renderShop, renderInventoryButton, showInventoryModal, inventorySellPrice } from './render/ShopUI';
import { showGameOver, showVictory } from './render/EndScreens';
import { runEndOfGameFlow, insertEndlessEntry, showEndlessLeaderboard } from './render/Leaderboard';
import { showBossWarning, isVerifiedBossWave } from './render/BossWarning';
import { showCodex } from './render/Codex';
import { showTowerMenu } from './render/TowerMenu';
import { showTowerLeaderboard } from './render/TowerLeaderboard';
import { showStoneMenu } from './render/StoneMenu';
import { showComboPicker } from './render/ComboPicker';
import { showMercatorBanner, dismissMercatorVisit } from './render/MercatorBanner';
import { showSettingsPanel } from './render/SettingsPanel';
import { renderPinnedRecipeWidget, ensurePinnedRecipeDefault } from './render/PinnedRecipe';
import { markScrollable } from './render/ScrollCues';
import { Logger } from './Logger';
import { towerName, enemyName, factionName, pretty } from './format';
import { showEnemyInspect, showEnemyInspectByType } from './render/EnemyInspect';
import { armorProfileForGroup, armorDamageTypeShortLabel } from './systems/EnemyResistances';
import { SFX, setFactionBGM, setMuted, isMuted, playMusicTrack, stopMusicTrack, stopAllMusicTracks, surpriseEventSting, sfx, preloadAllSamples, unmuteAndRestartMusicTrack } from './render/AudioManager';
import { tickSurpriseEvents, notifySurpriseEnemyResolved, clearSurpriseEventsForWaveEnd, notifyHellGateDestroyed } from './systems/SurpriseEvents';
import { showSurpriseRewardModal } from './render/SurpriseReward';

async function boot() {
  const wrap = document.getElementById('stage-wrap')!;
  const loadingEl = document.getElementById('loading')!;
  const app = document.getElementById('app')!;

  // 2026-05-15 v5: every fresh game start plants the Scorpion Bolt
  // recipe in the pinned slot if the player has no current pin.
  // Players can hide it for the session via UNPIN, but reloading
  // brings the tutorial scaffold back so new players never miss it.
  // A custom pin (anything other than empty) survives this call.
  ensurePinnedRecipeDefault();

  // Build state + grid + path
  const state = createGameState();
  const gore = createGoreState();
  const inventory = createInventory();
  // 2026-05 v10: starting inventory bonus — Cavalry Spur (UNCOMMON melee
  // item, MELEE-ONLY gate). Gives the player a real T1 build option right
  // out of the gate: equip on a Milites/Hastati/Centurion for +30% atk
  // speed and +0.5 tile range. Pairs naturally with the bumped 100g
  // starting purse so an opening combo path is on the table.
  inventoryAdd(inventory, 'CAVALRY_SPUR' as any, 'UNCOMMON', false);
  // 2026-05 v11: also start with a Barbed Gladius (COMMON melee DoT item,
  // MELEE-ONLY gate). 1% maxHp/sec bleed for 10s — drops a sticky chip-DoT
  // onto whichever swordsman wears it, so the player has two distinct
  // early-game melee buffs (speed/range vs sustain DoT) to choose between.
  inventoryAdd(inventory, 'BARBED_GLADIUS' as any, 'COMMON', false);
  // SHOP STATE — two distinct vendors that run in parallel during Mercator
  // waves. The Gate Shop is always reachable via the SHOP button / GATE
  // tile / B-G hotkey. The Mercator only exists during a Mercator visit
  // (W4 / W9 / W14 / W19) and gets its own dedicated button + banner entry
  // point. Splitting them means visiting the Mercator does NOT lock the
  // player out of the gate shop on that same wave.
  let gateShop: ShopState | null = null;
  let mercatorShop: ShopState | null = null;
  let mercatorActive = false;
  let bossRuntime = createBossRuntime();
  let waveStartTick = 0;
  let bossLegendaryDropped = false;
  // (stoneMode removed — stones merged into prospect placement)
  let lastComboCount = 0;    // for one-shot audio cue when combo becomes newly available
  let speedMult = 1;          // 1x or 2x game speed
  // 2026-05 v11 (B1 Pause). Manual pause toggled by HUD button or P key.
  // autoPaused fires on tab blur via visibilitychange; resumes only if
  // the user didn't also click PAUSE in between.
  let paused = false;
  let autoPaused = false;
  const placementUndo = new Map<string, { card: DrawCard; cost: number; index: number; col: number; row: number }>();
  // Build Phase action history — Build Phase Doc §10.2 / §10.3
  const undoStack: Array<{ undo: () => void; redo: () => void; type: string }> = [];
  const redoStack: Array<{ undo: () => void; redo: () => void; type: string }> = [];
  function pushAction(type: string, undo: () => void, redo: () => void) {
    undoStack.push({ type, undo, redo });
    redoStack.length = 0; // any new action invalidates redo
  }
  // Snapshot taken at the start of every build phase, so RESET can roll back the whole round.
  let buildPhaseSnapshot: any = null;

  function showMvpBanner(text: string, _tileX: number, _tileY: number, towerType?: string) {
    document.getElementById('mvp-banner')?.remove();
    const b = document.createElement('div');
    b.id = 'mvp-banner';
    // 2026-05: show the tower SPRITE alongside the banner text so the
    // player visually identifies which tower won. The sprite is rendered
    // as an <img> with image-rendering:pixelated to match the pixel-art
    // look. Falls back to text-only if the sprite isn't resolvable.
    const src = towerType ? imgSrc(towerType) : null;
    // 2026-05 v10: MVP sprite bumped 36px → 64px with a gold ring + drop
    // shadow so the tower-of-the-wave is unmissable in the banner queue.
    const portrait = src
      ? `<img src="${src}" style="width:64px;height:64px;image-rendering:pixelated;display:block;border:2px solid #ffd34d;background:#1a1410;padding:3px;box-shadow:0 0 14px rgba(255,211,77,0.7), inset 0 0 8px rgba(255,211,77,0.25);flex-shrink:0">`
      : '';
    b.innerHTML = `<div style="display:flex;align-items:center;gap:16px;justify-content:center">${portrait}<div style="font-size:15px;font-weight:bold;letter-spacing:3px;color:#ffd34d;text-shadow:2px 2px 0 #000">${text}</div></div>`;
    b.style.cssText = `padding:10px 18px;background:linear-gradient(90deg,#332200,#665500,#332200);border:2px solid #ffd34d;font-family:'Courier New',monospace;box-shadow:0 0 14px rgba(255,211,77,0.5);`;
    pushBanner(b, 3000);
    // Also briefly flash a star above the MVP tower's tile via tip
    state.hint = `MVP this wave: ${text.split('—')[1]?.trim() ?? text}`;
  }
  // Map a faction to its boss portrait sprite key.
  function bossPortraitKey(faction: string): string | null {
    switch (faction) {
      case 'DOGS': return 'BP_ALPHA_DOG';
      case 'CELTS': return 'BP_CELTIC_WARLORD';
      case 'CARTHAGE': return 'BP_HANNIBAL_BARCA';
      case 'UNDEAD_CELTS': return 'BP_UNDEAD_WARLORD';
      case 'UNDEAD_CARTHAGE': return 'BP_UNDEAD_WAR_ELEPHANT';
      case 'SUPER_DEMONS': return 'BP_DAEMON_IMPERATOR';
    }
    return null;
  }
  function imgSrc(key: string): string | null {
    const t = getTexture(key);
    if (!t) return null;
    const res: any = t.baseTexture?.resource;
    return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
  }
  // ─── Banner stack ──────────────────────────────────────────────────────
  // Single flexbox container centered on the stage that holds every transient
  // wave banner (boss, weather, modifier, phalanx, bonus boss, pre-wave tip,
  // first-round, combo nudge, etc.). Each banner is appended as a flex child;
  // when multiple are active they auto-stack vertically without overlapping.
  // Banners with `data-modal=true` (click-to-dismiss tutorial-style modals)
  // sit in their own row above the stack so they never get pushed off-screen.
  function ensureBannerStack(): HTMLElement {
    let stack = document.getElementById('banner-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'banner-stack';
      // Anchor near the TOP of the play area so the field below stays visible
      // (was vertical-center, which obscured spawning enemies). Stack grows
      // downward as more banners arrive.
      // 2026-05 v11: bumped from top:6% → top:2% so the pre-wave tip banner
      // doesn't collide with the centered Mercator visit card (also moved
      // down to 62%). Pair-tuned for waves where both appear at once
      // (W4 / W9 / W14 / W19 → W5 / W10 / W15 / W20 boss transitions).
      stack.style.cssText = `position:absolute;left:50%;top:2%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:80;pointer-events:none;width:auto;max-width:90%;`;
      document.getElementById('stage-wrap')?.appendChild(stack);
    }
    return stack;
  }
  // ─── Banner queue ──────────────────────────────────────────────────────
  // Banners now play SEQUENTIALLY rather than piling up. The queue holds
  // pending banners and shows them one at a time; modal banners block until
  // the user dismisses them.
  type BannerJob = { node: HTMLElement; durationMs: number; opts: { modal?: boolean; clickDismiss?: boolean } };
  const bannerQueue: BannerJob[] = [];
  let bannerActive: { node: HTMLElement; timer: number | null } | null = null;
  function processBannerQueue() {
    if (bannerActive) return;
    const next = bannerQueue.shift();
    if (!next) return;
    next.node.style.position = 'relative';
    next.node.style.left = ''; next.node.style.top = ''; next.node.style.transform = '';
    // All banners now accept pointer events so the player can click-skip
    // through the queue when they've already read the headline. Modals still
    // require the click to dismiss; non-modal banners simply finish early.
    next.node.style.pointerEvents = 'auto';
    next.node.style.cursor = 'pointer';
    const stack = ensureBannerStack();
    stack.appendChild(next.node);
    const finishCurrent = () => {
      if (bannerActive?.node !== next.node) return;
      if (bannerActive.timer != null) clearTimeout(bannerActive.timer);
      next.node.remove();
      bannerActive = null;
      processBannerQueue();
    };
    // 2026-05-17 — ONE-CLICK QUEUE DISMISS. Previously, clicking the active
    // banner only removed it and slid the next one in. On the first run
    // (or after a wave clear) up to five banners could queue back-to-back,
    // forcing the player through five separate clicks. Now a single click
    // on ANY banner removes the current one AND empties the rest of the
    // queue — one click = everything dismissed. Auto-timer dismissal still
    // advances the queue normally (auto-dismissed informational banners
    // shouldn't suppress queued modals the player may want to read).
    const finishAllOnClick = () => {
      // Drain any queued banner nodes that weren't shown yet so the
      // player isn't ambushed by a fresh banner sliding in after the
      // click. Discarded nodes never attached to the DOM so no removal.
      bannerQueue.length = 0;
      finishCurrent();
    };
    next.node.addEventListener('click', finishAllOnClick, { once: true });
    let timer: number | null = null;
    if (next.durationMs > 0 && !next.opts.modal) {
      timer = window.setTimeout(finishCurrent, next.durationMs);
    }
    bannerActive = { node: next.node, timer };
  }
  function pushBanner(b: HTMLElement, durationMs: number, opts: { modal?: boolean; clickDismiss?: boolean } = {}) {
    // Trimmed minimum hold (2026-05) so banners don't linger on the queue
    // and pile up at wave start. Modals stay manual-dismiss.
    const dur = opts.modal ? 0 : Math.max(durationMs, 2400);
    bannerQueue.push({ node: b, durationMs: dur, opts });
    processBannerQueue();
  }
  // ─── 2026-05 v11 DPS CHECK ────────────────────────────────────────────
  // Track the active training dummy + the tick it spawned, so the summary
  // popup can compute time-on-field, total damage taken, and DPS.
  let dpsCheckActiveId: string | null = null;
  let dpsCheckStartTick = 0;
  function isDpsCheckAvailable(): boolean {
    // Available only between waves (any pre-wave phase) AND when no dummy
    // is currently walking the path. The button reflects this state.
    return isPreWavePhase() && dpsCheckActiveId === null;
  }
  function spawnDpsCheckDummy() {
    if (!isDpsCheckAvailable()) {
      state.hint = dpsCheckActiveId !== null
        ? 'Training dummy already on the field — wait for it to finish.'
        : 'DPS Check is a pre-wave tool — start it between waves.';
      return;
    }
    const e: any = spawnEnemy(state, 'TRAINING_DUMMY' as any, 1.0);
    e.isDpsCheck = true;
    // Pin HP to baseHp regardless of any wave multipliers — the dummy is
    // a measurement tool, not a difficulty-scaled foe.
    e.maxHp = (enemiesData as any).TRAINING_DUMMY.baseHp;
    e.hp = e.maxHp;
    e.livesCost = 0;
    // 2026-05-15: scrub any late-wave elite mutation roll (SWIFT skews the
    // measurement, AURA_STAR would buff neighbors, BLOATED would split on
    // death). The dummy is a pure control variable — no random modifiers.
    e.mutation = undefined;
    // 2026-05-15 v2: the dummy is UNKILLABLE — it regenerates back to full
    // HP every tick so it always walks the entire path, regardless of how
    // much damage the maze can output. This makes the DPS readout valid
    // even for endgame setups that could one-shot a fixed-HP dummy. The
    // damage tally is tracked SEPARATELY on this accumulator field rather
    // than the standard maxHp-hp delta, because hp is restored to maxHp
    // every frame in the side-tick (see line ~3490). The accumulator
    // captures cumulative damage applied across the walk.
    e.__dpsDmgAccum = 0;
    dpsCheckActiveId = e.id;
    dpsCheckStartTick = state.tick;
    (state as any).__dpsCheckActive = true;
    state.hint = '🎯 DPS CHECK — training dummy on the path. Damage is being measured.';
  }
  function showDpsCheckSummary(e: any, killed: boolean) {
    // 2026-05-15 v2: dummy is unkillable; total damage comes from the
    // tick-by-tick accumulator (e.__dpsDmgAccum) since hp resets every
    // frame. Fall back to the old maxHp−hp delta only if the accumulator
    // is missing (e.g., dummy that pre-dated this feature, defensive).
    const accum = (e as any).__dpsDmgAccum;
    const fallbackDelta = Math.max(0, (e.maxHp ?? 0) - Math.max(0, e.hp ?? 0));
    const totalDmgDealt = typeof accum === 'number'
      ? accum
      : (killed ? (e.maxHp ?? fallbackDelta) : fallbackDelta);
    // 2026-05-15 fix: `state.tick` advances by `dt` (seconds), not 60Hz
    // frames, so the old `/60` divisor inflated the reported DPS by ~60×.
    const elapsed = Math.max(0.01, state.tick - dpsCheckStartTick);
    const dps = totalDmgDealt / elapsed;
    // Clear the active dummy so the button rearms.
    dpsCheckActiveId = null;
    (state as any).__dpsCheckActive = false;
    state.enemies.delete(e.id);
    // Build popup
    document.getElementById('dps-check-summary')?.remove();
    const modal = document.createElement('div');
    modal.id = 'dps-check-summary';
    modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:62;font-family:'Courier New',monospace`;
    const fmt = (n: number) => n >= 1000000 ? (n/1000000).toFixed(2) + 'M' : n >= 1000 ? (n/1000).toFixed(1) + 'k' : Math.round(n).toString();
    // 2026-05-15 v2: with the unkillable dummy, "killed" is effectively
    // never true — the dummy regens every tick and always reaches Rome.
    // We keep the killed branch as a defensive fallback in case some
    // path bypasses regen, but the normal flow is always "COMPLETE".
    const tierBorder = killed ? '#88ff88' : '#ffd34d';
    const headline = killed ? '🎯 DUMMY DESTROYED' : '🎯 DPS CHECK COMPLETE';
    const sub = killed
      ? 'Your maze killed the dummy before it reached Rome.'
      : 'The unkillable dummy walked the entire path — pure damage measurement.';
    modal.innerHTML = `
      <div style="width:min(520px,92%);background:linear-gradient(180deg,#241a12,#0c0a08);border:3px solid ${tierBorder};box-shadow:0 0 28px ${tierBorder}55;padding:18px 22px;color:#e8d6a8">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-size:18px;font-weight:bold;letter-spacing:3px;color:${tierBorder}">${headline}</div>
            <div style="font-size:11px;color:#cdb98a;margin-top:3px">${sub}</div>
          </div>
          <button id="dps-summary-close" style="background:#3a1606;color:#ffd34d;border:2px solid #d4af37;padding:5px 10px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0">
          <div style="background:#120c08;border:1px solid #5a4a30;padding:10px"><div style="font-size:10px;color:#aa9a4a;letter-spacing:2px">TOTAL DAMAGE</div><div style="color:#ff7733;font-size:20px;font-weight:bold">${fmt(totalDmgDealt)}</div></div>
          <div style="background:#120c08;border:1px solid #5a4a30;padding:10px"><div style="font-size:10px;color:#aa9a4a;letter-spacing:2px">TIME ON FIELD</div><div style="color:#9be0ff;font-size:20px;font-weight:bold">${elapsed.toFixed(1)}s</div></div>
          <div style="background:#120c08;border:1px solid #5a4a30;padding:10px"><div style="font-size:10px;color:#aa9a4a;letter-spacing:2px">EFFECTIVE DPS</div><div style="color:#ffd34d;font-size:22px;font-weight:bold">${fmt(dps)}</div></div>
          <div style="background:#120c08;border:1px solid #5a4a30;padding:10px"><div style="font-size:10px;color:#aa9a4a;letter-spacing:2px">DUMMY HP</div><div style="color:#cdb98a;font-size:14px">${killed ? `${fmt(e.maxHp ?? 0)} (KILLED)` : '∞ <span style="color:#88ff88">(unkillable)</span>'}</div></div>
        </div>
        <div style="font-size:11px;color:#cdb98a;line-height:1.5;padding:8px 0;border-top:1px dashed #3a3025;margin-top:8px">
          Use this to gauge maze throughput before the next wave. The dummy moves at standard speed, takes damage like a real enemy, and pays <b style="color:#88ff88">zero penalty</b> for reaching Rome. Click <b style="color:#88ddff">LEADERBOARD</b> below to see per-tower contribution to this run.
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px">
          <button id="dps-open-leaderboard" style="background:linear-gradient(180deg,#10243a,#0a1825);color:#9be0ff;border:2px solid #9be0ff;padding:8px 14px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:bold;letter-spacing:2px">⚔ LEADERBOARD</button>
          <button id="dps-dismiss" style="background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:8px 14px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px">DISMISS</button>
        </div>
      </div>
    `;
    app.appendChild(modal);
    const dismiss = () => modal.remove();
    modal.addEventListener('click', (ev) => { if (ev.target === modal) dismiss(); });
    (modal.querySelector('#dps-summary-close') as HTMLButtonElement).onclick = dismiss;
    (modal.querySelector('#dps-dismiss')        as HTMLButtonElement).onclick = dismiss;
    (modal.querySelector('#dps-open-leaderboard') as HTMLButtonElement).onclick = () => {
      dismiss();
      (ui as any).cb.onOpenLeaderboard?.();
    };
  }

  function showBossBanner(text: string, faction?: string) {
    document.getElementById('boss-banner')?.remove();
    const b = document.createElement('div');
    b.id = 'boss-banner';
    const portraitSrc = faction ? imgSrc(bossPortraitKey(faction) ?? '') : null;
    const portraitHtml = portraitSrc
      ? `<img src="${portraitSrc}" alt="" style="width:96px;height:96px;image-rendering:pixelated;display:block;margin:0 auto 8px;filter:drop-shadow(2px 2px 0 #000) drop-shadow(0 0 12px #aa1010aa)"/>`
      : '';
    b.innerHTML = `${portraitHtml}<div>⚔ ${text} ⚔</div>`;
    // Solid red gradient — no painted EB_BOSS_WAVE background. Players need
    // the boss-name text to read instantly, not blend into Roman art.
    b.style.cssText = `padding:20px 36px;background:linear-gradient(90deg,#440000,#aa1010,#440000);border:3px solid #ffd34d;color:#fff8e0;font-size:20px;font-weight:bold;letter-spacing:6px;text-shadow:2px 2px 0 #000,0 0 12px #ff3030;box-shadow:0 0 32px #aa1010cc;font-family:'Courier New',monospace;text-align:center;min-width:380px`;
    pushBanner(b, 2600);
    SFX.bossArrival();
  }
  // ─── Path-block alert ───────────────────────────────────────────────────
  // 2026-05 v6: when a placement (tower / stone / prospect) is rejected
  // because it would orphan spawn, gate, or a checkpoint, players need a
  // clear, visible signal — not just a buried hint string. This helper:
  //   • Sets state.hint with the descriptive message
  //   • Pops a floating red toast above the rejected tile that fades out
  //   • Triggers a red flash on the canvas via the renderer's impact ring
  //   • Plays a denial SFX so headphone players also get feedback
  // The toast is purely visual; no interaction required to dismiss.
  function showBlockedAlert(col: number, row: number, msg: string) {
    state.hint = msg;
    try { (SFX as any).uiCancel?.(); } catch { /* SFX not loaded, ignore */ }
    if (renderer?.triggerImpactRing) {
      const cx = col * 32 + 16;
      const cy = row * 32 + 16;
      renderer.triggerImpactRing(cx, cy, state.tick, 28, 0xff3030);
    }
    document.getElementById('block-alert')?.remove();
    const toast = document.createElement('div');
    toast.id = 'block-alert';
    toast.innerHTML = `<div style="font-size:11px;letter-spacing:3px;color:#ffd34d;margin-bottom:3px">⛔ BLOCKED</div>
      <div style="font-size:13px;color:#fff8e0;line-height:1.35">${msg}</div>`;
    const stage = document.getElementById('stage-wrap');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    // 2026-05-17 — Apply world-zoom forward transform so the DOM toast
    // appears over the correct tile on the zoomed canvas.
    const pxX = WORLD.OFFSET_X + (col * 32 + 16) * WORLD.ZOOM;
    const pxY = WORLD.OFFSET_Y + (row * 32 - 6) * WORLD.ZOOM;
    // Clamp to canvas bounds so the toast never spills off-screen.
    const left = Math.min(Math.max(pxX - 130, 8), rect.width - 268);
    const top  = Math.max(8, pxY - 64);
    toast.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:260px;padding:8px 12px;background:linear-gradient(180deg,#3a0a0a,#1a0606);border:2px solid #ff3030;color:#fff8e0;font-family:'Courier New',monospace;text-align:center;box-shadow:0 0 18px rgba(255,48,48,0.55);z-index:80;pointer-events:none;animation:blockAlertFade 1.8s ease-out forwards;`;
    if (!document.getElementById('block-alert-style')) {
      const st = document.createElement('style');
      st.id = 'block-alert-style';
      st.textContent = `@keyframes blockAlertFade { 0% { opacity:0; transform:translateY(6px); } 12% { opacity:1; transform:translateY(0); } 70% { opacity:1; } 100% { opacity:0; transform:translateY(-10px); } }`;
      document.head.appendChild(st);
    }
    stage.appendChild(toast);
    setTimeout(() => toast.remove(), 1900);
  }

  // ─── First-time INSPECT tip (one-time teaching banner) ─────────────────
  // 2026-05-19 — Shown ONCE per device (localStorage flag) the first time
  // the player places a prospect. Teaches the click-to-inspect interaction
  // for both sidebar thumbnails AND towers placed on the field. Stays on
  // screen until the player clicks "GOT IT" or 12 seconds pass, whichever
  // comes first.
  function showInspectTip() {
    if (document.getElementById('inspect-tip-banner')) return;
    const stage = document.getElementById('stage-wrap');
    if (!stage) return;
    const banner = document.createElement('div');
    banner.id = 'inspect-tip-banner';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;padding:12px 18px">
        <div style="font-size:30px">💡</div>
        <div style="flex:1">
          <div style="font-size:11px;letter-spacing:3px;color:#88ddff;font-weight:bold;margin-bottom:5px">PROTIP — INSPECT TOWERS</div>
          <div style="font-size:12px;color:#fff8e0;line-height:1.5">
            <b style="color:#ffd34d">Click any tower</b> — either a thumbnail in the sidebar OR a placed tower on the map — to open its full detail panel.
            You'll see <b style="color:#88ff88">live stats</b>, equipped items, and every <b style="color:#88ff88">combo recipe</b> that uses this tower.
          </div>
        </div>
        <button id="inspect-tip-dismiss" style="background:#2a5520;color:#e8d6a8;border:2px solid #5a8a3a;padding:8px 14px;font-family:'Courier New',monospace;font-size:11px;font-weight:bold;letter-spacing:1.5px;cursor:pointer;align-self:center">GOT IT</button>
      </div>`;
    banner.style.cssText = `position:absolute;left:50%;top:24px;transform:translateX(-50%);max-width:560px;background:linear-gradient(180deg,#1a2030,#0c1018);border:2px solid #88ddff;color:#fff8e0;font-family:'Courier New',monospace;box-shadow:0 0 24px rgba(136,221,255,0.45);z-index:90;animation:inspectTipFade 0.35s ease-out;`;
    if (!document.getElementById('inspect-tip-style')) {
      const st = document.createElement('style');
      st.id = 'inspect-tip-style';
      st.textContent = `@keyframes inspectTipFade { 0% { opacity:0; transform:translate(-50%, -8px); } 100% { opacity:1; transform:translate(-50%, 0); } }`;
      document.head.appendChild(st);
    }
    stage.appendChild(banner);
    const dismiss = () => { banner.style.opacity = '0'; setTimeout(() => banner.remove(), 250); };
    banner.querySelector('#inspect-tip-dismiss')?.addEventListener('click', dismiss);
    setTimeout(dismiss, 12000);
  }

  // ─── Insufficient-gold floating tooltip ────────────────────────────────
  // 2026-05 v9: anywhere the player tries to spend gold they don't have,
  // a small "NEED Xg" tooltip pops near the cursor (or anchor point) and
  // fades out. Centralised so every purchase path — tower placement,
  // shop offers, pool upgrade, gambles — gets the SAME visible feedback
  // instead of some silently returning and others setting only state.hint.
  // The tooltip is purely visual; no interaction required to dismiss.
  function showInsufficientGoldToast(cost: number, anchorX?: number, anchorY?: number) {
    try { (SFX as any).uiCancel?.(); } catch { /* SFX not loaded, ignore */ }
    const need = Math.max(0, cost - state.gold);
    document.getElementById('insuff-gold-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'insuff-gold-toast';
    toast.innerHTML = `<div style="font-size:10px;letter-spacing:3px;color:#ffd34d;margin-bottom:2px">⛔ NOT ENOUGH GOLD</div>
      <div style="font-size:14px;color:#fff8e0;line-height:1.3;font-weight:bold">Need <span style="color:#ffd34d">${need}g</span> more</div>
      <div style="font-size:10px;color:#bba886;margin-top:3px">Cost: ${cost}g · You have: ${state.gold}g</div>`;
    // Anchor — prefer caller-supplied screen coords; fall back to last
    // mouse position; final fallback is top-center of the stage.
    let px = anchorX, py = anchorY;
    if (px == null || py == null) {
      const mp: any = (window as any).__lastMousePos;
      if (mp && typeof mp.x === 'number') { px = mp.x; py = mp.y; }
    }
    const stage = document.getElementById('stage-wrap');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (px == null || py == null) { px = rect.width / 2; py = 32; }
    const left = Math.min(Math.max((px as number) - 110, 8), rect.width - 228);
    const top  = Math.max(8, (py as number) - 70);
    toast.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:220px;padding:8px 12px;background:linear-gradient(180deg,#2a1a06,#140a02);border:2px solid #ffd34d;color:#fff8e0;font-family:'Courier New',monospace;text-align:center;box-shadow:0 0 18px rgba(255,210,80,0.55);z-index:80;pointer-events:none;animation:insuffGoldFade 1.6s ease-out forwards;`;
    if (!document.getElementById('insuff-gold-style')) {
      const st = document.createElement('style');
      st.id = 'insuff-gold-style';
      st.textContent = `@keyframes insuffGoldFade { 0% { opacity:0; transform:translateY(6px); } 14% { opacity:1; transform:translateY(0); } 70% { opacity:1; } 100% { opacity:0; transform:translateY(-8px); } }`;
      document.head.appendChild(st);
    }
    stage.appendChild(toast);
    setTimeout(() => toast.remove(), 1700);
  }
  // Expose globally so ShopUI / TowerMenu / any sub-module can trigger
  // the same toast without having to import a helper from main.ts.
  (window as any).__showInsufficientGoldToast = showInsufficientGoldToast;

  // ─── Equip-blocked floating tooltip ──────────────────────────────────
  // 2026-05 v10: when the player clicks an inventory cell that's
  // currently blocked from equipping on the open tower (family conflict,
  // melee/ranged mismatch, slot full, already equipped), pop a red toast
  // anchored to the cell explaining EXACTLY why. The corner badge on
  // the grid is a visual hint but a player who clicks anyway deserves a
  // loud explanation, not a silent no-op + a fleeting HUD hint.
  function showEquipBlockedToast(reason: string, anchorX?: number, anchorY?: number) {
    try { (SFX as any).uiCancel?.(); } catch { /* SFX not loaded, ignore */ }
    document.getElementById('equip-blocked-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'equip-blocked-toast';
    toast.innerHTML = `<div style="font-size:10px;letter-spacing:3px;color:#ff7777;margin-bottom:3px">⛔ CAN'T EQUIP</div>
      <div style="font-size:12px;color:#fff8e0;line-height:1.35">${reason}</div>`;
    const stage = document.getElementById('stage-wrap');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    let px = anchorX, py = anchorY;
    if (px == null || py == null) {
      const mp: any = (window as any).__lastMousePos;
      if (mp && typeof mp.x === 'number') { px = mp.x; py = mp.y; }
    }
    if (px == null || py == null) { px = rect.width / 2; py = 64; }
    const left = Math.min(Math.max((px as number) - 140, 8), rect.width - 288);
    const top  = Math.max(8, (py as number) - 84);
    toast.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:280px;padding:9px 12px;background:linear-gradient(180deg,#3a0a0a,#1a0606);border:2px solid #ff3030;color:#fff8e0;font-family:'Courier New',monospace;text-align:center;box-shadow:0 0 18px rgba(255,48,48,0.55);z-index:90;pointer-events:none;animation:equipBlockedFade 2.0s ease-out forwards;`;
    if (!document.getElementById('equip-blocked-style')) {
      const st = document.createElement('style');
      st.id = 'equip-blocked-style';
      st.textContent = `@keyframes equipBlockedFade { 0% { opacity:0; transform:translateY(6px); } 12% { opacity:1; transform:translateY(0); } 78% { opacity:1; } 100% { opacity:0; transform:translateY(-8px); } }`;
      document.head.appendChild(st);
    }
    stage.appendChild(toast);
    setTimeout(() => toast.remove(), 2100);
  }
  (window as any).__showEquipBlockedToast = showEquipBlockedToast;

  // ─── Decade Doom banner ─────────────────────────────────────────────────
  // Fires when a wave starts that is a multiple of 10 (W10/20/30/40/50).
  // Big screen-spanning red banner announcing the HP doubling step.
  // ─── ENDLESS MODE TRANSITION (2026-05 v10) ────────────────────────
  // Called after the player commits their name on the W20 victory
  // screen. Flips `state.endlessMode = true`, resets the wave counter
  // logic, and pops a chaos-mode intro banner before dropping the
  // player back into BUILD_PHASE to prep for Endless Wave 1.
  function beginEndlessMode(playerName: string) {
    state.endlessMode = true;
    state.endlessWave = 0;        // bumps to 1 on first startWave call
    state.endlessScore = 0;
    state.endlessPlayerName = playerName;
    state.phase = GamePhase.BUILD_PHASE;
    state.victoryAt = -1;          // clear the victory flag so the loop runs
    // Restock starting lives + a small gold boost so the player has a
    // launching pad for E1 (Endless explicitly punishes economy, so the
    // initial pad helps the transition feel like a reward).
    state.lives = Math.max(state.lives, 25);
    state.gold += 100;
    // Banner: "CHAOS MODE" intro card.
    const b = document.createElement('div');
    b.id = 'endless-intro';
    b.innerHTML = `
      <div style="font-size:30px;font-weight:bold;letter-spacing:6px;color:#ff5050;text-shadow:3px 3px 0 #000,0 0 16px #ff3030">☠ ENDLESS MODE ☠</div>
      <div style="margin-top:14px;font-size:13px;color:#fff8e0;letter-spacing:1px;line-height:1.5">
        Wave 20 cleared — name submitted to the Hall of Glory.<br/>
        Now <b style="color:#ff5050">they're coming back. All of them.</b><br/>
        Huns, Egyptians, and every banner you ever faced.<br/><br/>
        <b>Difficulty scales aggressively per wave.</b> Gold is unstable.<br/>
        Every cleared Endless wave is added to your Endless score.<br/>
        Lose your last life → the run ends.<br/>
      </div>
      <div style="margin-top:18px;font-size:11px;color:#aa9a4a;letter-spacing:3px">[ CLICK TO BEGIN ]</div>
    `;
    b.style.cssText = `width:min(640px,90%);text-align:center;padding:32px 36px;background:linear-gradient(180deg,#1a0606,#0c0a08);border:4px solid #ff5050;box-shadow:0 0 40px #ff3030cc,inset 0 0 28px rgba(0,0,0,0.7);font-family:'Courier New',monospace;cursor:pointer;`;
    pushBanner(b, 0, { modal: true, clickDismiss: true });
  }

  // ─── ENDLESS FAILURE STATE (2026-05 v10) ──────────────────────────
  // When the player runs out of lives during Endless, run a dedicated
  // end-of-Endless flow: save to the endless leaderboard, show the
  // wave reached + endless score, then offer "PLAY AGAIN" (page reload).
  function runEndlessFailure() {
    document.getElementById('end-summary')?.remove();
    document.getElementById('hall-of-glory')?.remove();
    const summary = document.createElement('div');
    summary.id = 'endless-failure';
    summary.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.92);z-index:200;font-family:'Courier New',monospace`;
    const panel = document.createElement('div');
    panel.style.cssText = `width:min(560px,90%);padding:32px 36px;background:linear-gradient(180deg,#1a0606,#0c0608);border:3px solid #ff5050;color:#fff8e0;text-align:center;box-shadow:0 0 40px #ff3030aa;`;
    panel.innerHTML = `
      <div style="font-size:24px;font-weight:bold;letter-spacing:5px;color:#ff5050;text-shadow:2px 2px 0 #000">☠ ROME HAS FALLEN ☠</div>
      <div style="margin-top:18px;font-size:13px;color:#cdb98a;line-height:1.6">
        Endless run ended for <b style="color:#ffd34d">${state.endlessPlayerName ?? 'UNKNOWN'}</b>.
      </div>
      <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="padding:14px;background:#0c0608;border:2px solid #ff5050">
          <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px">ENDLESS WAVE</div>
          <div style="font-size:30px;color:#ff5050;font-weight:bold;margin-top:4px">${state.endlessWave ?? 0}</div>
        </div>
        <div style="padding:14px;background:#0c0608;border:2px solid #ffd34d">
          <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px">ENDLESS SCORE</div>
          <div style="font-size:30px;color:#ffd34d;font-weight:bold;margin-top:4px">${(state.endlessScore ?? 0).toLocaleString()}</div>
        </div>
      </div>
      <div style="margin-top:26px;display:flex;gap:12px;justify-content:center">
        <button id="endless-fail-leaderboard" style="padding:10px 22px;background:#222;color:#ffd34d;border:2px solid #ffd34d;font-family:inherit;font-size:12px;letter-spacing:2px;cursor:pointer">VIEW LEADERBOARD</button>
        <button id="endless-fail-restart" style="padding:10px 22px;background:linear-gradient(180deg,#ff5050,#aa1a1a);color:#fff;border:2px solid #ff7777;font-family:inherit;font-size:12px;letter-spacing:2px;font-weight:bold;cursor:pointer">MAIN MENU</button>
      </div>
    `;
    summary.appendChild(panel);
    app.appendChild(summary);
    const entry = {
      name: state.endlessPlayerName ?? 'UNKNOWN',
      endlessWave: state.endlessWave ?? 0,
      endlessScore: state.endlessScore ?? 0,
      date: new Date().toLocaleString(),
      ts: Date.now()
    };
    insertEndlessEntry(entry);
    panel.querySelector<HTMLButtonElement>('#endless-fail-leaderboard')!.onclick = () => {
      summary.remove();
      showEndlessLeaderboard(app, entry, () => location.reload());
    };
    panel.querySelector<HTMLButtonElement>('#endless-fail-restart')!.onclick = () => {
      location.reload();
    };
  }
  (window as any).__runEndlessFailure = runEndlessFailure;

  // Endless pre-wave banner. Fires at the start of every BUILD_PHASE
  // before an upcoming Endless wave. We deliberately DON'T forecast
  // the next wave's mechanic flags here — the generator is random and
  // the chaos is part of the experience. The banner just hypes the
  // upcoming wave number + reminds the player of their running score.
  function showEndlessPreWaveBanner(upcomingEndlessIdx: number) {
    document.getElementById('endless-pre-banner')?.remove();
    const isBossWave = upcomingEndlessIdx % 5 === 0;
    const subline = isBossWave
      ? `<b style="color:#ff5050">BOSS WAVE</b> — every 5th Endless wave anchors on a boss. Twin bosses possible past E10.`
      : 'Huns, Egyptians, and returning hordes. No faction rules. Mechanics stack.';
    const b = document.createElement('div');
    b.id = 'endless-pre-banner';
    b.innerHTML = `
      <div style="font-size:22px;font-weight:bold;letter-spacing:5px;color:#ff5050;text-shadow:2px 2px 0 #000">☠ ENDLESS WAVE ${upcomingEndlessIdx}</div>
      <div style="margin-top:10px;font-size:12px;color:#cdb98a;line-height:1.55">${subline}</div>
      <div style="margin-top:10px;font-size:12px;color:#ffd34d;line-height:1.55">
        <b>Score so far:</b> ${(state.endlessScore ?? 0).toLocaleString()} ·
        <b>Lives:</b> ${state.lives}
      </div>
      <div style="margin-top:14px;font-size:10px;letter-spacing:3px;color:#aa9a4a">[ CLICK TO DISMISS ]</div>
    `;
    b.style.cssText = `width:min(560px,88%);text-align:center;padding:22px 28px;background:linear-gradient(180deg,#1a0a08,#0c0608);border:3px solid #ff5050;box-shadow:0 0 26px #ff3030aa,inset 0 0 18px rgba(0,0,0,0.6);font-family:'Courier New',monospace;cursor:pointer;`;
    pushBanner(b, 0, { modal: true, clickDismiss: true });
  }

  function showDecadeDoomBanner(wave: number) {
    document.getElementById('decade-doom')?.remove();
    const isFinal = wave === 50;
    const b = document.createElement('div');
    b.id = 'decade-doom';
    const title = isFinal ? '☠ THE FINAL HOUR ☠' : `☠ DECADE ${wave / 10} OF DOOM ☠`;
    const sub = isFinal
      ? 'DAEMON IMPERATOR HAS COME. PRAY TO YOUR GODS.'
      : `Wave ${wave}: enemies grow significantly stronger. Their resolve is unbroken.`;
    b.innerHTML = `<div style="font-size:${isFinal ? 32 : 26}px;font-weight:bold;letter-spacing:${isFinal ? 8 : 6}px">${title}</div>
      <div style="margin-top:10px;font-size:13px;letter-spacing:2px;color:${isFinal ? '#ffd34d' : '#ffaa55'}">${sub}</div>`;
    // Solid red radial — drop the EB_DECADE_DOOM/EB_FINAL_HOUR painted bg.
    b.style.cssText = `width:min(760px,92%);text-align:center;padding:32px 44px;background:radial-gradient(ellipse,${isFinal ? '#5a0000' : '#3a0808'},#0c0a08 75%);border:4px solid ${isFinal ? '#ffd34d' : '#cc2828'};color:#fff8e0;box-shadow:0 0 56px ${isFinal ? '#ffaa00' : '#aa1010'}cc;font-family:'Courier New',monospace;text-shadow:3px 3px 0 #000, 0 0 14px #ff3030;`;
    pushBanner(b, 3500);
    return;
    if (isFinal) renderer.triggerShake(8, 1.4);
    else renderer.triggerShake(4, 0.6);
    SFX.bossArrival();
  }
  // ─── Low-lives vignette ─────────────────────────────────────────────────
  // Pulsing red border around the play area when lives drop below 10.
  function updateLowLivesVignette() {
    const stage = document.getElementById('stage-wrap');
    if (!stage) return;
    let v = document.getElementById('low-lives-vignette') as HTMLElement | null;
    if (state.lives <= 0 || state.lives > 10) {
      if (v) v.remove();
      return;
    }
    if (!v) {
      v = document.createElement('div');
      v.id = 'low-lives-vignette';
      v.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:55;border:6px solid transparent;box-shadow:inset 0 0 60px rgba(220,30,30,0.45);animation:vignettePulse 1.4s ease-in-out infinite`;
      stage.appendChild(v);
      if (!document.getElementById('vignette-style')) {
        const s = document.createElement('style');
        s.id = 'vignette-style';
        s.textContent = `@keyframes vignettePulse {
          0%, 100% { box-shadow: inset 0 0 60px rgba(220,30,30,0.35), inset 0 0 120px rgba(220,30,30,0.15); }
          50% { box-shadow: inset 0 0 80px rgba(255,30,30,0.7), inset 0 0 180px rgba(255,30,30,0.30); }
        }`;
        document.head.appendChild(s);
      }
    }
    // Intensify as lives approach 0
    const intensity = 1 - (state.lives / 10);
    v.style.opacity = String(0.5 + intensity * 0.5);
  }
  // FINAL HOUR AURA — pulsing gold border around the play area during
  // every build/prospect/keeper phase that precedes W20. It's a visual
  // companion to the hype modal so the field itself reminds the player
  // this is THE round to spend everything. Removes when W20 starts (or
  // earlier if game is lost/won). Stays alongside the low-lives vignette
  // when both fire.
  function updateFinalHourAura() {
    const stage = document.getElementById('stage-wrap');
    if (!stage) return;
    let v = document.getElementById('final-hour-aura') as HTMLElement | null;
    const isFinalBuild = state.wave + 1 === 20 && (
      state.phase === GamePhase.BUILD_PHASE ||
      state.phase === GamePhase.PROSPECT_PLACEMENT ||
      state.phase === GamePhase.PICK_KEEPER
    );
    if (!isFinalBuild) {
      if (v) v.remove();
      return;
    }
    if (!v) {
      v = document.createElement('div');
      v.id = 'final-hour-aura';
      v.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:54;border:4px solid transparent;animation:finalHourPulse 2.2s ease-in-out infinite`;
      stage.appendChild(v);
      if (!document.getElementById('final-hour-style')) {
        const s = document.createElement('style');
        s.id = 'final-hour-style';
        s.textContent = `@keyframes finalHourPulse {
          0%, 100% { box-shadow: inset 0 0 50px rgba(255,170,0,0.18), inset 0 0 120px rgba(180,30,30,0.10); border-color: rgba(255,211,77,0.30); }
          50%      { box-shadow: inset 0 0 90px rgba(255,200,40,0.45), inset 0 0 200px rgba(220,40,40,0.25); border-color: rgba(255,170,0,0.85); }
        }`;
        document.head.appendChild(s);
      }
    }
  }
  // Persistent on-screen weather chip — visible the entire wave so the player
  // can read the active environmental effect at any time. Removed at wave end.
  function updateWeatherChip() {
    let chip = document.getElementById('weather-chip') as HTMLElement | null;
    const profile = state.weatherKey ? FACTION_WEATHER[state.weatherKey] : null;
    if (!profile || state.phase !== GamePhase.WAVE_PHASE) {
      if (chip) chip.remove();
      return;
    }
    const colorHex = '#' + profile.color.toString(16).padStart(6, '0');
    // Compose penalty bullets that are ACTIVE
    const penalties: string[] = [];
    const inten = state.weatherIntensity ?? 1;
    // Scroll text rule (2026-05): everything on a parchment scroll is
    // BOLD BLACK with NO shadow. No colored accents, no glow halos. Reads
    // like hand-inked text on the paper. Applies to every future scroll too.
    if (profile.missChance > 0)            penalties.push(`⊘ ${Math.round(profile.missChance * inten * 100)}% miss`);
    if (profile.rangePenalty > 0)          penalties.push(`↘ −${(profile.rangePenalty * inten).toFixed(1)} range`);
    if (profile.attackSpeedPenalty > 0)    penalties.push(`⏲ −${Math.round(profile.attackSpeedPenalty * inten * 100)}% atk speed`);
    if (profile.statusDurationPenalty > 0) penalties.push(`⏱ −${Math.round(profile.statusDurationPenalty * inten * 100)}% status`);
    const intensityTag = inten > 1 ? ` · BOSS ×${inten}` : '';
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'weather-chip';
      const parchmentSrc = imgSrc('CB_PARCHMENT_WIDE');
      const baseStyle = parchmentSrc
        ? `background-image:url('${parchmentSrc}');background-size:100% 100%;background-repeat:no-repeat;`
        : `background:rgba(12,10,8,0.85);border:2px solid ${colorHex};`;
      // BOLDER SCROLL TEXT (2026-05): bigger font, heavier weight, stronger
      // contrast so the parchment-style chip reads clearly during chaos.
      // WEATHER-CHIP SCROLL TEXT (2026-05 v4): every glyph is BOLD BLACK,
      // NO text-shadow, on the parchment background. The scroll outer glow
      // (box-shadow) remains for the chip itself; the text inside stays
      // flat ink. Future scrolls follow this rule.
      chip.style.cssText = `position:absolute;top:8px;left:8px;padding:14px 20px;${baseStyle}color:#000;font-family:'Courier New',monospace;font-size:13px;letter-spacing:1px;z-index:60;pointer-events:none;max-width:320px;box-shadow:0 0 16px ${colorHex}66;font-weight:900;`;
      document.getElementById('stage-wrap')?.appendChild(chip);
    } else {
      chip.style.boxShadow = `0 0 16px ${colorHex}66`;
    }
    chip.innerHTML = `<div style="font-weight:900;font-size:14px;letter-spacing:2px;margin-bottom:5px">🌫 ${profile.name.toUpperCase()}${intensityTag}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;font-weight:900">${penalties.join(' · ') || 'cosmetic only'}</div>`;
  }
  function showModifierBanner(modifier: { name: string; blurb: string; color: number }) {
    document.getElementById('modifier-banner')?.remove();
    const colorHex = '#' + modifier.color.toString(16).padStart(6, '0');
    const b = document.createElement('div');
    b.id = 'modifier-banner';
    // RNG-EVENT BANNER (2026-05): the wave modifier is a double-edged
    // sword and the copy reflects it. The mechanic blurb explains the
    // pain. The reward/risk panel underneath spells out exactly what
    // the player gets for surviving and what the gods take if they don't.
    b.innerHTML = `
      <div style="font-size:11px;font-weight:bold;letter-spacing:6px;color:#ffd34d;text-shadow:1px 1px 0 #000;margin-bottom:2px">🎲 THE GODS ROLLED THE BONES</div>
      <div style="font-size:20px;font-weight:bold;letter-spacing:5px;color:${colorHex};text-shadow:2px 2px 0 #000,0 0 14px ${colorHex}88">⚡ ${modifier.name.toUpperCase()}</div>
      <div style="margin-top:8px;font-size:13px;font-weight:bold;letter-spacing:1px;color:#fff8e0;line-height:1.5;text-shadow:1px 1px 0 #000">${modifier.blurb}</div>
      <div style="margin-top:12px;padding:10px 14px;background:rgba(0,0,0,0.55);border:1px solid ${colorHex};display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:left">
        <div>
          <div style="font-size:10px;font-weight:bold;letter-spacing:3px;color:#88ff88;text-shadow:1px 1px 0 #000;margin-bottom:3px">★ SURVIVE</div>
          <div style="font-size:11px;font-weight:bold;color:#cdffce;line-height:1.45;text-shadow:1px 1px 0 #000">Survive: +60g + 4000 score. Free Uncommon item is already in your inventory. The Senate notices.</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:bold;letter-spacing:3px;color:#ff7766;text-shadow:1px 1px 0 #000;margin-bottom:3px">✗ FAIL</div>
          <div style="font-size:11px;font-weight:bold;color:#ffd1cc;line-height:1.45;text-shadow:1px 1px 0 #000">The gods laugh. Rome remembers the name on the column.</div>
        </div>
      </div>`;
    b.style.cssText = `width:min(640px,90%);text-align:center;padding:18px 28px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid ${colorHex};box-shadow:0 0 30px ${colorHex}aa;font-family:'Courier New',monospace;`;
    pushBanner(b, 4500);
    SFX.bossArrival();
  }
  // Wave Brief — a single compact panel in the lower-left listing every
  // special mechanic active this wave. Designed to consolidate scattered
  // banner info so the player can READ what's happening without clutter.
  // Positioned lower-left so it doesn't fight with weather/modifier chips.
  function updateWaveBrief() {
    let brief = document.getElementById('wave-brief') as HTMLElement | null;
    if (state.phase !== GamePhase.WAVE_PHASE) {
      if (brief) brief.remove();
      return;
    }
    // 2026-05 v10 — ENDLESS MODE: read spawns from the in-flight
    // endless wave cfg instead of wavesData[19] (which is the W20 boss
    // config and would emit wrong enemy callouts every endless wave).
    // The endless cfg carries its own `spawns`, `type`, and `faction`
    // plus a `combinedMechanics` list the brief surfaces verbatim.
    const endlessCfg = state.endlessMode ? (state as any).__endlessWaveCfg : null;
    const w: any = endlessCfg ?? wavesData[state.wave - 1];
    if (!w) return;
    // 2026-05-15 v5: enemiesInWave kept here since the categorized
    // briefLines section below uses it for enemy-type callouts.
    const enemiesInWave = new Set((w.spawns ?? []).map((s: any) => s.type));
    // 2026-05-15 v5 WAVE BRIEF REDESIGN: ditched the parchment scroll
    // graphic (which had magenta-fringed curls leaking into the
    // background and looked unprofessional with 3+ stacked modifiers)
    // in favor of a clean dark gradient panel matching the rest of
    // the Roman HUD (Codex, Settings, Tower Menu all share this style).
    //
    // Each modifier is now a discrete row with:
    //   • Left-accent stripe color-coded by category
    //     (BOSS=red, MECHANIC=violet, ENEMY=orange, RNG=cyan)
    //   • Icon column for the emoji
    //   • Text column with light-cream readable typography
    //   • Subtle hairline divider between rows
    //
    // The panel auto-fits any number of modifiers because rows wrap
    // independently — no more overlapping text on heavy-modifier waves
    // like W15 (boss crescendo + necromancy + bonus-boss + RNG modifier).
    //
    // Categorize each item so the accent stripe pulls from one taxonomy.
    type Category = 'BOSS' | 'MECHANIC' | 'ENEMY' | 'RNG';
    const COLOR: Record<Category, string> = {
      BOSS:     '#ff5050',      // crimson — wave-structural boss-mode
      MECHANIC: '#c070ff',      // violet — necromancy, phalanx, etc.
      ENEMY:    '#ffaa55',      // amber — shielded / phoenix / surge / regen
      RNG:      '#9be0ff'       // cyan — RNG modifiers + bonus-boss roll
    };
    type BriefLine = { text: string; cat: Category };
    const briefLines: BriefLine[] = [];
    // 2026-05 v10 — ENDLESS BRIEF LINES. Surface the procedurally-
    // generated mechanic flags from the cfg, plus the running endless
    // score and the wave-specific HP/resist scaling. State.wave is
    // frozen at 20 in endless so the W11+ / W17 / boss-crescendo
    // checks below would all misfire — skip them entirely.
    if (endlessCfg) {
      briefLines.push({ text: `☠ ENDLESS WAVE ${state.endlessWave} · Huns, Egyptians, and returning hordes. Mechanics stack freely.`, cat: 'BOSS' });
      if (endlessCfg.type === 'B') briefLines.push({ text: '⚔ ENDLESS BOSS WAVE · expect twin bosses past E10.', cat: 'BOSS' });
      if (endlessCfg.necromancy) briefLines.push({ text: '💀 NECROMANCY · slain grunts rise as 6-9 undead per kill.', cat: 'MECHANIC' });
      for (const m of (endlessCfg.combinedMechanics ?? [])) {
        briefLines.push({ text: `▸ ${m}`, cat: 'MECHANIC' });
      }
      briefLines.push({ text: `🏆 Endless score so far: ${(state.endlessScore ?? 0).toLocaleString()}`, cat: 'RNG' });
    } else {
      // Mirror the original lines/callouts split, but categorize each.
      if ([5, 10, 15, 20].includes(state.wave)) briefLines.push({ text: '☠ BOSS CRESCENDO · HP scales +50%', cat: 'BOSS' });
      if ((w as any).necromancy) briefLines.push({ text: '💀 NECROMANCY · slain grunts rise as 6-9 undead per kill', cat: 'MECHANIC' });
      if (state.wave === 17) briefLines.push({ text: '🛡 IRON PHALANX · melee-immune armored at end', cat: 'MECHANIC' });
      if (w.type === 'B') briefLines.push({ text: '⚔ BOSS WAVE · faction signature mechanics', cat: 'BOSS' });
      // VEILED IN ASH mechanic has been removed; no callout needed.
      if (state.wave >= 10) {
        const elitePct = Math.min(20, 4 + (state.wave - 10) * 0.5);
        briefLines.push({ text: `⭐ Elites possible · ${elitePct.toFixed(0)}% mutation roll`, cat: 'RNG' });
      }
      if (state.wave > 11) briefLines.push({ text: '🎲 Bonus boss roll · +2.5× gold +50g +2 lives +1 RARE on kill', cat: 'RNG' });
      // Late-stage resistance buff — surfaced once the W11+ cohort starts
      // spawning so the player isn't surprised by chip damage suddenly
      // doing less. Ground non-flyers absorb 15% more from every damage
      // type AND resist DoTs 15% harder; bosses absorb 25% more on both
      // axes. Flyers are unaffected.
      if (state.wave >= 11) briefLines.push({ text: '🛡 LATE-STAGE RESISTANCE · ground enemies take −15% damage + DoT, bosses take −25%. Flyers unaffected. Diversify damage types or stack tier-ups to punch through.', cat: 'MECHANIC' });
      if (state.waveModifier) {
        const m = WAVE_MODIFIERS.find(x => x.key === state.waveModifier);
        if (m) briefLines.push({ text: `🎲 RNG · ${m.name.toUpperCase()} · survive = +25g +1 item +1000 pts`, cat: 'RNG' });
      }
    }
    // Enemy-type callouts (replaces the older `callouts` array).
    const enemyCallouts: BriefLine[] = [];
    if (enemiesInWave.has('CARTHAGE_ELITE_GUARD') || enemiesInWave.has('UNDEAD_SPEARMAN')) enemyCallouts.push({ text: '🛡 SHIELDED · needs melee first to break', cat: 'ENEMY' });
    if (enemiesInWave.has('SPECTRAL_SCOUT') || enemiesInWave.has('GHOST_RIDER')) enemyCallouts.push({ text: '👻 GHOSTS · silence towers passing within 1.2 tiles', cat: 'ENEMY' });
    if (enemiesInWave.has('GHOST_RIDER')) enemyCallouts.push({ text: '💰 GHOST RIDERS · steal gold on leak', cat: 'ENEMY' });
    if (enemiesInWave.has('GALLIC_DRUID') || enemiesInWave.has('ZOMBIE_DRUID') || enemiesInWave.has('DEMON_LEGATE')) enemyCallouts.push({ text: '🌫 DRUID/LEGATE · aura slows nearby towers', cat: 'ENEMY' });
    // 2026-05 v10 — DRUIDS ALSO CAST SLEEP DARTS (3s tower inert on hit).
    // Separate callout from the slow-aura line so the player sees both.
    if (enemiesInWave.has('GALLIC_DRUID') || enemiesInWave.has('ZOMBIE_DRUID')) enemyCallouts.push({ text: '💤 DRUID SLEEP CURSE · channels a 0.5s telegraph then launches a slow cyan dart at the nearest tower. Hit = tower asleep 3s. Burst the druid mid-channel or stun/freeze it.', cat: 'ENEMY' });
    // 2026-05 v10 — ELEPHANT DUST SHIELD: nearby ground allies become
    // ranged-immune until the elephant dies. Pairs with the +45/+40%
    // siege weakness so the player has a clear answer (siege + melee).
    // The gold sparkle that pops over each protected ally is the same
    // visual cue surfaced here so players can read the field at a glance.
    if (enemiesInWave.has('WAR_ELEPHANT') || enemiesInWave.has('UNDEAD_WAR_ELEPHANT')) enemyCallouts.push({ text: '🐘 ELEPHANT DUST SHIELD · the 2-tile dust dome around every elephant blocks ranged attacks on nearby GROUND allies until the elephant dies. Allies inside the dome are marked with a small <b>gold sparkle</b> overhead — those are the ones currently shielded. Ranged towers will silently skip them; melee and the elephant itself stay targetable. Counter: SIEGE (elephants take +45%) or melee inside the dome.', cat: 'ENEMY' });
    // 2026-05 v10 — GENERALIZED DAMAGE-CLASS EFFECTIVENESS CALLOUTS.
    // Tell the player which damage type EXPLOITS the enemies they're
    // about to fight, scoped to the actual wave roster. The existing
    // ARMOR strip below shows resists numerically per damage type; these
    // callouts surface the WEAKNESSES with the same loudness so players
    // pick the right tower archetype before placing.
    //
    // DEMONS — ~3× divine (1.5×/1.3× per-enemy × +100% faction row).
    if (enemiesInWave.has('DEMON_HELLHOUND') || enemiesInWave.has('CELTIC_FIRE_DEMON') || enemiesInWave.has('SHADOW_CAVALRY') || enemiesInWave.has('DEMON_LEGATE') || enemiesInWave.has('DAEMON_IMPERATOR')) enemyCallouts.push({ text: '✨ DEMONS — DIVINE WEAKNESS · demons take ~3× damage from divine sources (Flamen / Augur / Haruspex / Solar Priest / Pontifex). Fire deals 0 damage — leave the Igniferas at home. Bleed and poison also hit demons HARDER than normal (+25-30% per tick).', cat: 'ENEMY' });
    // ELEPHANTS — +45/+40% siege.
    if (enemiesInWave.has('WAR_ELEPHANT') || enemiesInWave.has('UNDEAD_WAR_ELEPHANT')) enemyCallouts.push({ text: '🪨 ELEPHANTS — SIEGE WEAKNESS · elephants take +45% damage from SIEGE (Libritor, Ballistarius, Carroballista, Vulcan Engineer, Colossus Onager, Siege Onager, War Chariot, Nemesis Engine). Stones crack hide that arrows can\'t. Bleed and poison resisted heavily — DoT-stacker builds skip elephants.', cat: 'ENEMY' });
    // GALLIC DRUIDS — sacred-ward shield + Celtic faction takes +15% ranged.
    if (state.wave === 4 && enemiesInWave.has('GALLIC_DRUID')) enemyCallouts.push({ text: '🛡 CELTS — RANGED VULNERABILITY · the Celtic faction takes +15% ranged damage. After a melee tower cracks the druid\'s sacred ward, your archers shred them. Pair Sagittarius/Velites/Decurion behind a Milites or Hastati for the W4 break.', cat: 'ENEMY' });
    // UNDEAD CELTS — +25% fire / +50% divine (faction-side).
    if (enemiesInWave.has('UNDEAD_CELT') || enemiesInWave.has('ZOMBIE_DRUID') || enemiesInWave.has('UNDEAD_BERSERKER') || enemiesInWave.has('SPECTRAL_SCOUT') || enemiesInWave.has('UNDEAD_WARLORD')) enemyCallouts.push({ text: '🔥 UNDEAD CELTS — FIRE & DIVINE WEAKNESS · faction takes +25% fire damage and +50% divine damage. Burn the bones, smite the spirits. Poison and bleed deal 0 — no flesh to corrupt.', cat: 'ENEMY' });
    // CARTHAGE living — ranged-resistant (-20%) + melee-vulnerable (+30%).
    if (enemiesInWave.has('CARTHAGE_SPEARMAN') || enemiesInWave.has('CARTHAGE_ELITE_GUARD') || enemiesInWave.has('NUMIDIAN_RIDER') || enemiesInWave.has('HANNIBAL_BARCA')) enemyCallouts.push({ text: '⚔ CARTHAGE — MELEE FAVORED · faction takes +30% melee damage and resists ranged by 20%. Push close-range builds (Centurion / Primus Pilus / Cohort Guard / Imperator Guard) for the W7-W10 stretch.', cat: 'ENEMY' });
    // UNDEAD CARTHAGE — fire-immune, but +25% melee vulnerable.
    if (enemiesInWave.has('UNDEAD_SPEARMAN') || enemiesInWave.has('GHOST_RIDER') || enemiesInWave.has('IRON_PHALANX') || enemiesInWave.has('ARCHITECTUS') || enemiesInWave.has('UNDEAD_WAR_ELEPHANT')) enemyCallouts.push({ text: '🛡 UNDEAD CARTHAGE — FIRE IMMUNE / MELEE FAVORED · faction is fully fire-immune (Ignifer / Inferno Cart / fire items wasted). +25% melee damage taken. Poison and bleed land for 0 — DoTs that aren\'t fire still fail. Lean into melee + divine + siege.', cat: 'ENEMY' });
    if (enemiesInWave.has('SPECTRAL_SCOUT') || enemiesInWave.has('CELTIC_FIRE_DEMON')) enemyCallouts.push({ text: '🔥 PHOENIX · burst into 3 minions on death', cat: 'ENEMY' });
    if (enemiesInWave.has('RABID_DOG') || enemiesInWave.has('CELTIC_BERSERKER') || enemiesInWave.has('DEMON_HELLHOUND')) enemyCallouts.push({ text: '💨 LOW-HP SURGE · finish them or they leak', cat: 'ENEMY' });
    if (enemiesInWave.has('HANNIBAL_BARCA') || enemiesInWave.has('DAEMON_IMPERATOR') || enemiesInWave.has('GHOST_RIDER') || enemiesInWave.has('GALLIC_DRUID') || enemiesInWave.has('ZOMBIE_DRUID')) enemyCallouts.push({ text: '💚 OOC REGEN · pressure constantly to deny heal', cat: 'ENEMY' });
    // 2026-05-15: checkpoint regen — enemies that gain HP every time
    // they cross a checkpoint coin on the path. Listed here per-wave
    // so the player knows to burst them BETWEEN checkpoints rather
    // than chipping continuously across the full path.
    if (enemiesInWave.has('CELTIC_BERSERKER') || enemiesInWave.has('CARTHAGE_ELITE_GUARD') || enemiesInWave.has('UNDEAD_CELT') || enemiesInWave.has('UNDEAD_BERSERKER') || enemiesInWave.has('UNDEAD_SPEARMAN')) enemyCallouts.push({ text: '🩸 CHECKPOINT HEAL · enemies regen 20% maxHP every checkpoint coin they cross — kill BEFORE the next coin or reset', cat: 'ENEMY' });
    if (enemiesInWave.has('ARCHITECTUS')) enemyCallouts.push({ text: '⚱ AURA NULLIFIER · Architectus silences every tower aura within 2 tiles while present. Move aura towers (Eagle Standard, Cohort Guard, Triumvirate, banner items) off the path so they keep buffing', cat: 'ENEMY' });
    const allLines = [...briefLines, ...enemyCallouts];
    // 2026-05-15 v9: the brief used to remove itself when there were no
    // mechanic callouts. Now that we also show the per-wave ARMOR strip
    // (universally useful info), we keep the panel up whenever the wave
    // has any enemies — the armor row is enough reason to stay open.
    if (allLines.length === 0 && enemiesInWave.size === 0) {
      if (brief) brief.remove();
      return;
    }
    if (!brief) {
      brief = document.createElement('div');
      brief.id = 'wave-brief';
      brief.style.cssText = [
        'position:absolute',
        'bottom:10px',
        'left:10px',
        'min-width:260px',
        'max-width:360px',
        'padding:10px 12px 12px',
        'background:linear-gradient(180deg,rgba(26,20,16,0.96),rgba(12,10,8,0.96))',
        'border:2px solid #d4af37',
        'border-radius:2px',
        "font-family:'Courier New',monospace",
        'color:#e8d6a8',
        'font-size:12px',
        'line-height:1.4',
        'z-index:60',
        // pointer-events:auto so the collapse-toggle button receives clicks.
        // The brief's body content is purely informational so this won't
        // accidentally steal clicks meant for towers — the brief sits
        // bottom-left while the player typically clicks the map center.
        'pointer-events:auto',
        'box-shadow:0 0 14px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.04)'
      ].join(';') + ';';
      // Click-to-collapse hook. The collapsed state is preserved in
      // localStorage so the player's last preference persists across
      // waves and reloads — once they decide "hide the brief" they
      // shouldn't have to keep dismissing it every wave.
      brief.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement;
        if (!target.closest('#wave-brief-toggle')) return;
        ev.stopPropagation();
        const cur = localStorage.getItem('roman_td_wave_brief_collapsed') === '1';
        localStorage.setItem('roman_td_wave_brief_collapsed', cur ? '0' : '1');
        // The next updateWaveBrief tick will rebuild with the new state.
      });
      document.getElementById('stage-wrap')?.appendChild(brief);
    }
    // Collapsed state — read fresh each tick so a click toggle takes
    // effect on the very next frame.
    const collapsed = localStorage.getItem('roman_td_wave_brief_collapsed') === '1';
    // Header strip — small gold-accent letter-spaced label, with a
    // collapse / expand toggle on the right. Toggle text shows the
    // CURRENT-state symbol — ▾ when expanded (click to collapse), ▸
    // when collapsed (click to expand).
    const headerRight = allLines.length === 0
      ? 'ARMOR ONLY'
      : `${allLines.length} CALLOUT${allLines.length === 1 ? '' : 'S'}`;
    const toggleSymbol = collapsed ? '▸' : '▾';
    const toggleTitle = collapsed ? 'Click to expand the wave brief' : 'Click to collapse the wave brief (it stays out of your way during the wave)';
    const waveLabel = endlessCfg
      ? `⚔  ENDLESS ${state.endlessWave} BRIEF`
      : `⚔  WAVE ${state.wave} BRIEF`;
    const header = `<div style="display:flex;align-items:center;gap:8px;${collapsed ? '' : 'padding-bottom:7px;margin-bottom:8px;border-bottom:1px solid #5a4a30'}">
      <span style="font-size:11px;letter-spacing:3px;color:${endlessCfg ? '#ff5050' : '#d4af37'};font-weight:bold;text-shadow:1px 1px 0 #000">${waveLabel}</span>
      <span style="flex:1"></span>
      <span style="font-size:10px;color:#aa9a4a;letter-spacing:1.5px">${headerRight}</span>
      <button id="wave-brief-toggle" title="${toggleTitle}" style="background:#1a1410;border:1px solid #5a4a30;color:#d4af37;font-family:inherit;font-size:11px;font-weight:bold;padding:2px 8px;cursor:pointer;letter-spacing:1px;line-height:1">${toggleSymbol}</button>
    </div>`;
    // 2026-05-15 v9 ARMOR STRIP — compact one-row summary of the wave's
    // average armor per damage type. Helps the player pick which damage
    // family to lean into before the wave starts. Computed across every
    // unique enemy type in the wave, then condensed into a 5-chip strip
    // (Melee · Ranged · Siege · Fire · Divine). Chip color follows the
    // same EnemyInspect taxonomy so the visual language is consistent.
    const armorByType = armorProfileForGroup(Array.from(enemiesInWave) as any);
    const armorChips = armorByType.map(r => {
      const label = armorDamageTypeShortLabel(r.damageType);
      let display: string;
      let color: string;
      // 2026-05-18 — Defense-stat sign convention. "+" = positive defense
      // (enemy resists, player should avoid). "−" = less defense (enemy
      // is vulnerable, player should use). Color also differs.
      if (r.immune)              { display = 'IMMUNE';                       color = '#ee2a2a'; }
      else if (r.armorPct >= 70) { display = `+${r.armorPct}%`;              color = '#ff6b3a'; }
      else if (r.armorPct >= 30) { display = `+${r.armorPct}%`;              color = '#ffaa55'; }
      else if (r.armorPct > 0)   { display = `+${r.armorPct}%`;              color = '#ffd34d'; }
      else if (r.armorPct === 0) { display = '—';                            color = '#cdb98a'; }
      else                       { display = `−${Math.abs(r.armorPct)}%`;    color = '#7896c8'; }
      return `<span style="flex:1;text-align:center;background:#0c0a08;padding:4px 2px;border:1px solid #3a3025;font-size:10px;letter-spacing:0.5px;line-height:1.25">
        <div style="color:#aa9a4a;font-size:8.5px;letter-spacing:1px">${label}</div>
        <div style="color:${color};font-weight:bold">${display}</div>
      </span>`;
    }).join('');
    const armorStrip = `
      <div style="margin:2px 0 8px;display:flex;flex-direction:column;gap:3px">
        <div style="font-size:9px;color:#ffd34d;letter-spacing:2px;font-weight:bold">🛡 ARMOR THIS WAVE <span style="color:#aa9a4a;font-weight:normal">(avg)</span></div>
        <div style="display:flex;gap:2px">${armorChips}</div>
      </div>
    `;
    // 2026-05-19 — Tag layout: short callouts render as compact chips
    // (flex-wrap, blocky border, small font) so 4-6 tags stack
    // cleanly without colliding. Long callouts (>60 chars, e.g.
    // mechanic explainers) fall back to full-width rows so the
    // detail is still readable. Both styles share the category
    // accent color so the visual taxonomy stays consistent.
    const rows = allLines.map(l => {
      const accent = COLOR[l.cat];
      const isShort = l.text.length <= 60;
      if (isShort) {
        return `<span style="display:inline-block;background:rgba(255,255,255,0.04);border-left:3px solid ${accent};padding:3px 8px 3px 6px;margin:2px 4px 2px 0;font-size:10.5px;color:#e8d6a8;letter-spacing:0.4px;line-height:1.35;vertical-align:top">${l.text}</span>`;
      }
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:4px 0 4px 8px;border-left:3px solid ${accent};margin:2px 0;background:rgba(255,255,255,0.02)">
        <span style="flex:1;color:#e8d6a8;font-size:11.5px;letter-spacing:0.4px;line-height:1.4;word-break:break-word">${l.text}</span>
      </div>`;
    }).join('');
    // Wrap the chips in a flex container so they wrap and never
    // overflow the panel's max-width.
    const rowsHtml = `<div style="display:flex;flex-wrap:wrap;align-items:flex-start;gap:0 2px;padding-top:4px">${rows}</div>`;
    // (the older variable used downstream is renamed to rowsHtml)
    void rows;
    // When collapsed, only the header row renders — the body content
    // (armor strip + callouts) is hidden so the panel shrinks to a
    // compact bar. The collapse button stays clickable so the player
    // can re-expand any time.
    //
    // Signature-cache anti-flicker: previously the brief's innerHTML
    // was rewritten every render frame (~60 Hz), which destroyed the
    // toggle button's DOM node between mousedown and mouseup so clicks
    // never landed (same bug the pinned-recipe widget had). Skip the
    // rebuild when the content signature is unchanged from the last
    // tick. Toggle clicks update localStorage which IS part of the sig
    // so the next frame DOES rebuild with the new state.
    const newHtml = collapsed ? header : (header + armorStrip + rowsHtml);
    const newSig = `${collapsed ? '1' : '0'}|${newHtml.length}|${allLines.length}|${state.wave}|e${state.endlessWave ?? 0}`;
    if ((brief as any).__sig !== newSig) {
      (brief as any).__sig = newSig;
      brief.innerHTML = newHtml;
    }
    // Collapsed mode trims padding so the bar is even smaller.
    if (collapsed) {
      brief.style.padding = '6px 10px';
      brief.style.minWidth = '180px';
    } else {
      brief.style.padding = '10px 12px 12px';
      brief.style.minWidth = '260px';
    }
  }
  // 2026-05-17 — Modifier chip REDESIGNED. The old sprite-scroll background
  // (CB_BANNER_SMALL) read as a busy stage prop that didn't match the rest
  // of the HUD. New version uses the same dark-panel/gold-border vocabulary
  // as the wave brief, with a collapse caret in the top-right so the player
  // can hide the chip entirely when they need to see the field beneath.
  // Collapsed state shows just a small ⚡ icon + caret to expand again.
  function updateModifierChip() {
    let chip = document.getElementById('modifier-chip') as HTMLElement | null;
    const mod = state.waveModifier ? WAVE_MODIFIERS.find(m => m.key === state.waveModifier) : null;
    if (!mod || state.phase !== GamePhase.WAVE_PHASE) {
      if (chip) chip.remove();
      return;
    }
    const colorHex = '#' + mod.color.toString(16).padStart(6, '0');
    const collapseKey = 'roman_td_modifier_chip_collapsed';
    let collapsed = false;
    try { collapsed = localStorage.getItem(collapseKey) === '1'; } catch { /* ignore */ }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'modifier-chip';
      // 2026-05-17 — Pulsing glow animation around the chip border so RNG
      // waves are unmistakably flagged. Sits above all other HUD chrome.
      chip.style.cssText = `position:absolute;top:8px;right:8px;padding:8px 12px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:2px solid ${colorHex};color:#e8d6a8;font-family:'Courier New',monospace;font-size:12px;letter-spacing:1.5px;font-weight:bold;z-index:60;display:flex;flex-direction:column;gap:4px;min-width:200px;max-width:260px;box-shadow:0 0 16px ${colorHex}55;animation:modifierChipPulse 1.8s ease-in-out infinite;`;
      if (!document.getElementById('modifier-chip-style')) {
        const s = document.createElement('style');
        s.id = 'modifier-chip-style';
        s.textContent = `
          @keyframes modifierChipPulse {
            0%, 100% { box-shadow: 0 0 16px ${colorHex}55; }
            50%      { box-shadow: 0 0 28px ${colorHex}aa, 0 0 8px ${colorHex}ff; }
          }
          #modifier-chip .mod-rng-tag {
            cursor: help;
            position: relative;
            border-bottom: 1px dotted ${colorHex};
          }
          #modifier-chip .mod-rng-tag:hover .mod-tooltip { display: block; }
          #modifier-chip .mod-tooltip {
            display: none;
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            width: 260px;
            padding: 10px 12px;
            background: linear-gradient(180deg, #0c0a08, #1a1410);
            border: 2px solid ${colorHex};
            color: #e8d6a8;
            font-size: 11px;
            font-weight: normal;
            letter-spacing: 0.5px;
            line-height: 1.5;
            text-shadow: 1px 1px 0 #000;
            box-shadow: 0 6px 18px rgba(0,0,0,0.7);
            z-index: 80;
            text-transform: none;
          }
        `;
        document.head.appendChild(s);
      }
      document.getElementById('stage-wrap')?.appendChild(chip);
    } else {
      chip.style.borderColor = colorHex;
      chip.style.boxShadow = `0 0 16px ${colorHex}55`;
    }
    const ICON_KEY: Record<string, string> = {
      BLOOD_MOON: 'MB_BLOOD_MOON', STORM_SURGE: 'MB_STORM_SURGE',
      DEATH_PACT: 'MB_DEATH_PACT', VEIL: 'MB_VEIL',
      REVENANT: 'MB_REVENANT', GROUP_MARCH: 'MB_GROUP_MARCH'
    };
    const src = texUrl(ICON_KEY[mod.key]);
    const imgHtml = src ? `<img src="${src}" alt="" style="width:18px;height:18px;image-rendering:pixelated;flex-shrink:0"/>` : '<span style="font-size:14px;flex-shrink:0">⚡</span>';
    if (collapsed) {
      chip.style.padding = '4px 8px';
      chip.style.minWidth = '0';
      chip.innerHTML = `<div style="display:flex;align-items:center;gap:6px">${imgHtml}<span style="font-size:11px;color:${colorHex};font-weight:bold">🎲</span><button id="modifier-chip-toggle" title="Expand" style="background:transparent;border:none;color:${colorHex};font-size:14px;line-height:1;cursor:pointer;padding:0 2px;font-weight:bold">▸</button></div>`;
    } else {
      chip.style.padding = '10px 12px';
      chip.style.minWidth = '200px';
      // Hover-detail tooltip on the "RNG WAVE" tag — shows mod.blurb (the
      // exact mechanic explanation pulled from constants.ts WAVE_MODIFIERS).
      const blurbEsc = mod.blurb.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      chip.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px">
          ${imgHtml}
          <span style="flex:1;color:${colorHex};font-size:13px;letter-spacing:2px">${mod.name.toUpperCase()}</span>
          <button id="modifier-chip-toggle" title="Collapse" style="background:transparent;border:none;color:#aa9a4a;font-size:13px;line-height:1;cursor:pointer;padding:0 2px;font-weight:bold">▾</button>
        </div>
        <div style="font-size:10px;letter-spacing:1.5px;color:#cdb98a;font-weight:bold;line-height:1.4;margin-top:2px">
          🎲 <span class="mod-rng-tag" title="">RNG WAVE</span> · survive = <b style="color:#88ff88">+60g · +ITEM · +4000 pts</b>
          <div class="mod-tooltip">
            <div style="font-size:10px;letter-spacing:2px;color:${colorHex};margin-bottom:5px;font-weight:bold">🎲 ${mod.name.toUpperCase()}</div>
            <div style="margin-bottom:6px">${blurbEsc}</div>
            <div style="font-size:10px;color:#88ff88;letter-spacing:1px;border-top:1px solid #3a3025;padding-top:5px">SURVIVE → <b>+60g · +1 UNCOMMON ITEM · +4000 score</b></div>
          </div>
        </div>
      `;
    }
    const toggleBtn = chip.querySelector('#modifier-chip-toggle') as HTMLButtonElement | null;
    if (toggleBtn) {
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        try { localStorage.setItem(collapseKey, collapsed ? '0' : '1'); } catch { /* ignore */ }
        updateModifierChip();     // re-render with new state
      };
    }
  }
  function showWeatherBanner(profile: { name: string; blurb: string; color: number }) {
    document.getElementById('weather-banner')?.remove();
    const colorHex = '#' + profile.color.toString(16).padStart(6, '0');
    const b = document.createElement('div');
    b.id = 'weather-banner';
    b.innerHTML = `<div style="font-size:16px;font-weight:bold;letter-spacing:4px;color:${colorHex}">🌫 ${profile.name.toUpperCase()}</div>
      <div style="margin-top:6px;font-size:11px;letter-spacing:1px;color:#cdb98a;line-height:1.45">${profile.blurb}</div>`;
    b.style.cssText = `width:min(560px,82%);text-align:center;padding:12px 18px;background:linear-gradient(180deg,#0c0a08,#1a1410);color:#e8d6a8;border:2px solid ${colorHex};box-shadow:0 0 24px ${colorHex}aa;font-family:'Courier New',monospace;text-shadow:1px 1px 0 #000;`;
    pushBanner(b, 3600);
  }
  // BONUS-ITEM REWARD (2026-05): when an RNG event spikes the wave —
  // twin/ambush boss, or a wave modifier rolls — the player gets a free
  // item dropped straight into the inventory to soften the swing.
  // Items are sampled from `items_permanent.json` at or above the rarity
  // floor passed in. Returns the granted item id, or null if no slot.
  function grantBonusItem(rarityFloor: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'): string | null {
    // 2026-05-18 — EPIC tier inserted between RARE and LEGENDARY.
    const order = ['COMMON','UNCOMMON','RARE','EPIC','LEGENDARY'];
    const floor = order.indexOf(rarityFloor);
    // 2026-05 v6: DOT items (BARBED_GLADIUS, FIRE_OIL_FLASK, POISONED_BLADE,
    // FALCATA_BLADE, ALPHA_PACK_FANG) are excluded from free-grant pools so
    // damage-over-time builds remain Mercator-exclusive. The wave-modifier
    // survival reward + bonus-boss item still drops something useful, just
    // never a DOT — those have to be earned/purchased explicitly.
    const DOT_ITEMS = new Set([
      'BARBED_GLADIUS','FIRE_OIL_FLASK','POISONED_BLADE','FALCATA_BLADE','ALPHA_PACK_FANG'
    ]);
    const pool: [string, any][] = Object.entries(itemsData as any)
      // 2026-05-18 — Event-exclusive legendaries (Invasion / Uprising /
      // Gates of Hell rewards) are NEVER offered by the free-grant pool.
      // They only drop from their event's reward modal.
      .filter(([id, def]: any) => order.indexOf(def.rarity) >= floor && !DOT_ITEMS.has(id) && !def.eventExclusive);
    if (pool.length === 0) return null;
    const [id, def]: any = pool[Math.floor(Math.random() * pool.length)];
    const ok = inventoryAdd(inventory, id as any, def.rarity, false);
    if (!ok) return null;
    const niceName = def.name ?? id.replace(/_/g, ' ');
    state.hint = `🎁 Good job! Bonus item: ${niceName} added to inventory.`;
    return id;
  }
  function showBonusBossBanner(text: string) {
    document.getElementById('bonus-boss-banner')?.remove();
    const b = document.createElement('div');
    b.id = 'bonus-boss-banner';
    // RNG BONUS BOSS BANNER (2026-05): mirrors the modifier banner shape —
    // top eyebrow names the RNG event, headline screams the threat, then a
    // two-column stakes panel spells the reward and the penalty in voice.
    b.innerHTML = `
      <div style="font-size:11px;font-weight:bold;letter-spacing:6px;color:#ffd34d;text-shadow:1px 1px 0 #000;margin-bottom:2px">🎲 THE GODS ROLLED THE BONES</div>
      <div style="font-size:20px;font-weight:bold;letter-spacing:5px;color:#ffd34d;text-shadow:2px 2px 0 #000,0 0 14px rgba(255,170,51,0.6)">⚡ ${text}</div>
      <div style="margin-top:8px;font-size:13px;font-weight:bold;letter-spacing:1px;color:#fff8e0;line-height:1.5;text-shadow:1px 1px 0 #000">An extra boss. No warning. No discount. The dice owe Rome a result.</div>
      <div style="margin-top:12px;padding:10px 14px;background:rgba(0,0,0,0.55);border:1px solid #ffaa33;display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:left">
        <div>
          <div style="font-size:10px;font-weight:bold;letter-spacing:3px;color:#88ff88;text-shadow:1px 1px 0 #000;margin-bottom:3px">★ KILL HIM</div>
          <div style="font-size:11px;font-weight:bold;color:#cdffce;line-height:1.45;text-shadow:1px 1px 0 #000">2.5× wave gold +50g handler fee. +2 lives. +1 RARE+ item. +3000 score. The Senate orders a parade.</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:bold;letter-spacing:3px;color:#ff7766;text-shadow:1px 1px 0 #000;margin-bottom:3px">✗ LET HIM LEAK</div>
          <div style="font-size:11px;font-weight:bold;color:#ffd1cc;line-height:1.45;text-shadow:1px 1px 0 #000">10 lives per stride. He does not die at the gate. He walks back and tries again.</div>
        </div>
      </div>`;
    b.style.cssText = `width:min(680px,90%);text-align:center;padding:18px 28px;background:linear-gradient(180deg,#3a1606,#0c0a08);border:3px solid #ffaa33;box-shadow:0 0 32px #ffaa33aa;font-family:'Courier New',monospace;`;
    pushBanner(b, 4500);
    SFX.bossArrival();
  }
  // 2026-05-17 — W2 CODEX-PIN TOOLTIP. Subtle, dismissible callout
  // pointing toward the CODEX button. Fires once when wave 2 starts
  // (after the player has seen a placement + combat loop). Persists
  // a dismissed flag in localStorage so it never re-shows. Auto-fades
  // after 14 seconds even without dismissal. Non-blocking — sits in
  // the top-right corner of the stage so the player can keep playing.
  function showCodexPinTip() {
    const STORE_KEY = 'roman_td_codex_pin_tip_dismissed_v1';
    try {
      if (localStorage.getItem(STORE_KEY) === '1') return;
    } catch { /* private mode — show the tip anyway */ }
    if (document.getElementById('codex-pin-tip')) return;
    const stage = document.getElementById('stage-wrap');
    if (!stage) return;
    const tip = document.createElement('div');
    tip.id = 'codex-pin-tip';
    tip.style.cssText = `
      position:absolute;
      top:54px; right:12px;
      width:228px;
      padding:10px 26px 10px 12px;
      background:linear-gradient(180deg,#1a1410,#0c0a08);
      border:2px solid #ffd34d;
      color:#e8d6a8;
      font-family:'Courier New',monospace;
      font-size:11px;
      letter-spacing:0.7px;
      line-height:1.45;
      box-shadow:0 0 14px rgba(255,211,77,0.35);
      z-index:55;
      cursor:default;
      animation:codexPinTipIn 0.45s ease-out both;
    `;
    tip.innerHTML = `
      <div style="font-size:10px;letter-spacing:2.5px;color:#ffd34d;font-weight:bold;margin-bottom:5px">📌 PRO TIP</div>
      <div>Pin recipes from the <b style="color:#ffd34d">CODEX → COMBINATIONS</b> tab. Click <b style="color:#ffd34d">📌 PIN</b> on any combo to keep its ingredients + cost visible in your side panel during battle — no more guessing which towers to merge.</div>
      <button id="codex-pin-tip-x" title="Dismiss"
        style="position:absolute;top:4px;right:4px;background:transparent;border:none;color:#aa9a4a;font-size:14px;line-height:1;cursor:pointer;padding:2px 6px;font-weight:bold">×</button>
    `;
    // Inject one-shot fade-in keyframes if not already present.
    if (!document.getElementById('codex-pin-tip-style')) {
      const s = document.createElement('style');
      s.id = 'codex-pin-tip-style';
      s.textContent = `
        @keyframes codexPinTipIn {
          0%   { opacity:0; transform:translateY(-6px); }
          100% { opacity:1; transform:translateY(0); }
        }
        @keyframes codexPinTipOut {
          0%   { opacity:1; transform:translateY(0); }
          100% { opacity:0; transform:translateY(-6px); }
        }
        #codex-pin-tip-x:hover { color:#ffd34d; }
      `;
      document.head.appendChild(s);
    }
    stage.appendChild(tip);
    const dismiss = () => {
      try { localStorage.setItem(STORE_KEY, '1'); } catch { /* ignore */ }
      tip.style.animation = 'codexPinTipOut 0.4s ease-in both';
      setTimeout(() => tip.remove(), 420);
    };
    (tip.querySelector('#codex-pin-tip-x') as HTMLButtonElement | null)?.addEventListener('click', dismiss);
    // Auto-fade after 14 seconds if the player didn't dismiss it. The
    // localStorage flag is set on auto-fade too so it doesn't reappear
    // on the next session — once seen, it's seen.
    setTimeout(() => {
      if (document.getElementById('codex-pin-tip')) dismiss();
    }, 14000);
  }

  // 2026-05-17 — Surprise event info chip. Fires once at the start of an
  // invasion / uprising event so the player isn't lost when the screen
  // suddenly tints + enemies spawn from unusual locations. Non-blocking
  // small chip in the top-left of the play area, dismissible by click,
  // auto-fades after 6 seconds. Color-coded to match the event tint
  // (red for invasion, purple for uprising).
  function showSurpriseEventInfoChip(kind: 'INVASION' | 'UPRISING' | 'GATES_OF_HELL') {
    document.getElementById('surprise-info-chip')?.remove();
    const stage = document.getElementById('stage-wrap');
    if (!stage) return;
    const accent = kind === 'INVASION' ? '#ff7733'
                 : kind === 'UPRISING' ? '#a050ff'
                 : '#ff4422';                           // GATES_OF_HELL hellfire red
    const headline = kind === 'INVASION' ? '⚔ INVASION'
                   : kind === 'UPRISING' ? '☠ UPRISING'
                   : '🔥 GATES OF HELL';
    const body = kind === 'INVASION'
      ? 'Barbarians breach the perimeter! Enemies are coming from all four sides of the map this wave — not from the cave. Survive to claim a reward.'
      : kind === 'UPRISING'
        ? 'The dead are rising! Skeletal portals open in the center of the map this wave — enemies emerge from the ground, not the cave. Survive to claim a reward.'
        : 'The Underworld breaks open at checkpoints 3 and 4! Two gates pump out fire giants — 500,000 HP each, fire-immune, slow but lethal. Crack the gates with siege or divine to shut them down before they overrun you.';
    const chip = document.createElement('div');
    chip.id = 'surprise-info-chip';
    chip.style.cssText = `
      position:absolute;
      top:54px; left:12px;
      width:240px;
      padding:10px 24px 10px 12px;
      background:linear-gradient(180deg,#1a1410,#0c0a08);
      border:2px solid ${accent};
      color:#e8d6a8;
      font-family:'Courier New',monospace;
      font-size:11px;
      letter-spacing:0.6px;
      line-height:1.45;
      box-shadow:0 0 16px ${accent}55;
      z-index:58;
      cursor:pointer;
      animation:surpriseChipIn 0.40s ease-out both;
    `;
    chip.innerHTML = `
      <div style="font-size:10px;letter-spacing:2.5px;color:${accent};font-weight:bold;margin-bottom:5px">${headline}</div>
      <div>${body}</div>
      <button id="surprise-info-x" title="Dismiss"
        style="position:absolute;top:4px;right:4px;background:transparent;border:none;color:#aa9a4a;font-size:14px;line-height:1;cursor:pointer;padding:2px 6px;font-weight:bold">×</button>
    `;
    if (!document.getElementById('surprise-info-style')) {
      const s = document.createElement('style');
      s.id = 'surprise-info-style';
      s.textContent = `
        @keyframes surpriseChipIn {
          0% { opacity:0; transform:translateX(-8px); }
          100% { opacity:1; transform:translateX(0); }
        }
        @keyframes surpriseChipOut {
          0% { opacity:1; transform:translateX(0); }
          100% { opacity:0; transform:translateX(-8px); }
        }
        #surprise-info-x:hover { color:#fff8e0; }
      `;
      document.head.appendChild(s);
    }
    stage.appendChild(chip);
    const dismiss = () => {
      chip.style.animation = 'surpriseChipOut 0.35s ease-in both';
      setTimeout(() => chip.remove(), 380);
    };
    (chip.querySelector('#surprise-info-x') as HTMLButtonElement | null)?.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
    // Auto-fade after 6 seconds. Long enough to read, short enough to
    // not clutter the screen mid-combat.
    setTimeout(() => {
      if (document.getElementById('surprise-info-chip')) dismiss();
    }, 6000);
  }

  function showPhalanxWarning(thisWave: number) {
    document.getElementById('phalanx-warning')?.remove();
    const b = document.createElement('div');
    b.id = 'phalanx-warning';
    b.innerHTML = `<div style="font-size:20px;font-weight:bold;letter-spacing:5px;color:#f0e3b8;text-shadow:2px 2px 0 #000,0 0 14px rgba(192,192,192,0.55)">⚒ IRON PHALANX INCOMING</div>
      <div style="margin-top:10px;font-size:13px;font-weight:bold;letter-spacing:1.5px;color:#fff8e0;text-shadow:1px 1px 0 #000">Wave ${thisWave}: melee-immune armored troops. Only RANGED towers can hurt them.</div>`;
    b.style.cssText = `width:min(580px,86%);text-align:center;padding:18px 28px;background:linear-gradient(180deg,#1c1814,#0c0a08);border:3px solid #c0c0c0;box-shadow:0 0 22px #c0c0c088;font-family:'Courier New',monospace;`;
    pushBanner(b, 5000);
  }
  // Pre-wave contextual tip — fires whenever we transition to prospect/build
  // phase. Scans the NEXT wave's spawn list for special enemy mechanics and
  // pops a modal-style tip explaining what's coming and how to prepare. The
  // player must click to dismiss before they can build, so they actually
  // read it. Always cross-references the CODEX for deeper info.
  function showPreWaveTip(nextWave: number) {
    const w: any = wavesData[nextWave - 1];
    if (!w) return;
    document.getElementById('pre-wave-tip')?.remove();
    // Detect mechanics in upcoming wave.
    const types = new Set<string>(w.spawns?.map((g: any) => g.type) ?? []);
    const enemyDef = (k: string) => (enemiesData as any)[k] ?? {};
    const hasFlyers = Array.from(types).some(k => enemyDef(k as string).isFlyer);
    const hasShielded = types.has('CARTHAGE_ELITE_GUARD') || types.has('UNDEAD_SPEARMAN');
    const hasGhosts = types.has('SPECTRAL_SCOUT') || types.has('GHOST_RIDER');
    const hasDruid = types.has('GALLIC_DRUID') || types.has('ZOMBIE_DRUID') || types.has('DEMON_LEGATE');
    const hasPhoenix = types.has('SPECTRAL_SCOUT') || types.has('CELTIC_FIRE_DEMON');
    const hasRunners = types.has('RABID_DOG') || types.has('CELTIC_BERSERKER') || types.has('DEMON_HELLHOUND');
    const hasRegen = types.has('HANNIBAL_BARCA') || types.has('DAEMON_IMPERATOR') || types.has('GALLIC_DRUID');
    const isBossWave = w.type === 'B';
    const isPhalanx = nextWave === 17;
    const isDecade = nextWave === 5 || nextWave === 10 || nextWave === 15 || nextWave === 20;
    // NECROMANCY / CHECKPOINT-HEAL flags pulled directly from data so any
    // future wave tweak surfaces automatically in the pre-wave brief.
    const isNecromancy = !!(w as any).necromancy;
    const hasCheckpointHealers = Array.from(types).some(k => !!enemyDef(k as string).checkpointHealPct);
    // 2026-05 v10 — damage-vulnerability detection. Used to emit the
    // "this damage type is the answer for this wave" tip just like the
    // existing flyers / shielded / phoenix tips: warn the player BEFORE
    // they place towers, not after they've watched chip damage do nothing.
    const hasDemons = types.has('DEMON_HELLHOUND') || types.has('CELTIC_FIRE_DEMON')
                   || types.has('SHADOW_CAVALRY') || types.has('DEMON_LEGATE')
                   || types.has('DAEMON_IMPERATOR');
    const hasElephants = types.has('WAR_ELEPHANT') || types.has('UNDEAD_WAR_ELEPHANT');
    const hasUndeadCelts = types.has('UNDEAD_CELT') || types.has('ZOMBIE_DRUID')
                        || types.has('UNDEAD_BERSERKER') || types.has('SPECTRAL_SCOUT')
                        || types.has('UNDEAD_WARLORD');
    const hasUndeadCarthage = types.has('UNDEAD_SPEARMAN') || types.has('GHOST_RIDER')
                           || types.has('IRON_PHALANX') || types.has('ARCHITECTUS')
                           || types.has('UNDEAD_WAR_ELEPHANT');
    const hasLivingCarthage = types.has('CARTHAGE_SPEARMAN') || types.has('CARTHAGE_ELITE_GUARD')
                           || types.has('NUMIDIAN_RIDER') || types.has('HANNIBAL_BARCA');
    // Pick the most important mechanic to lead with.
    const tips: { headline: string; body: string; color: string }[] = [];
    if (isBossWave) tips.push({
      headline: '⚔ A BOSS IS HERE FOR YOU',
      body: `Wave <b>${nextWave}</b>: a <b>${factionName(String(w.faction))}</b> boss. <b style="color:#ff5050">Solo arrival, 2× HP, 10 lives per leak — and if he reaches Rome, he is REBORN ON THE NEXT WAVE with the HP he had at the gate</b> (chip damage carries over). Bring real damage. Look for <b style="color:#ffd34d">high single-target damage</b>, <b style="color:#ffd34d">boss-damage modifiers</b>, and <b style="color:#ffd34d">multi-shot or splash</b> to chip through that HP bar.`,
      color: '#dd3333'
    });
    if (hasFlyers) tips.push({
      headline: '✈ THEY BROUGHT WINGS',
      body: `Flyers inbound on wave <b>${nextWave}</b>. <b style="color:#ff5050">Melee swings at empty air.</b> You need <b style="color:#ffd34d">ranged or siege</b> on the path. <b style="color:#ffd34d">Anti-air specialists</b> and <b style="color:#ffd34d">multi-shot</b> abilities turn this wave into a quick clear. The <b style="color:#ffd34d">CODEX</b> lists every anti-air option — read fast.`,
      color: '#66ccff'
    });
    if (isPhalanx) tips.push({
      headline: '🛡 IRON PHALANX SAYS HELLO',
      body: `Wave <b>${nextWave}</b> ends with melee-immune <b>Iron Phalanx</b> AND they phase the first 2 ranged hits. <b style="color:#ff5050">Your sword arm is irrelevant.</b> Park <b style="color:#ffd34d">heavy ranged or siege</b> on the last leg, and stack <b style="color:#ffd34d">DoT (burn / poison / bleed)</b> so their out-of-combat regen never gets a moment to breathe.`,
      color: '#cccccc'
    });
    if (hasShielded) tips.push({
      headline: '🛡 SHIELDS UP, GENERAL',
      body: `Shielded infantry on the march. They <b style="color:#ff5050">eat ranged shots until a melee tower cracks their guard.</b> No melee in line of sight = no kills. Plan accordingly or watch them stroll to Rome.`,
      color: '#aabbdd'
    });
    if (hasGhosts) tips.push({
      headline: '👻 THE DEAD ARE FUNNY THAT WAY',
      body: `Spectral enemies on wave <b>${nextWave}</b>. They <b style="color:#ff5050">silence every tower they pass within 1.2 tiles</b> — and the Ghost Rider variant <b>pickpockets your treasury on leak</b>. Spread your firepower; a single-file maze just turns into a graveyard for your DPS.`,
      color: '#cc88cc'
    });
    if (hasDruid) tips.push({
      headline: '🌫 DRUIDS — KILL THESE FIRST',
      body: `Druids and Demon Legates radiate an aura that <b style="color:#ff5050">slows your towers</b>. Ignore them at your own gate. The tankier targets can wait — these are the priority kill.`,
      color: '#88cc88'
    });
    if (hasPhoenix) tips.push({
      headline: '🔥 THEY GET TO DIE THREE TIMES',
      body: `Some of wave <b>${nextWave}</b> <b style="color:#ff5050">burst into 3 reduced-HP minions on death</b>. Plan on roughly <b>3×</b> the damage budget you'd guess. <b style="color:#ffd34d">DoTs</b> (Bleed, Burn, Poison) keep ticking through the spawned minions — apply pressure across the cluster so the second wave of mini-phoenixes melts before they reach Rome. The minions can't chain-phoenix, but there are three of them.`,
      color: '#ff8855'
    });
    if (hasRunners) tips.push({
      headline: '💨 RUNNERS — DON\'T LET THEM SMELL THE GATE',
      body: `Wave <b>${nextWave}</b> brings sprinters. <b style="color:#ff5050">Below 30% HP they accelerate hard</b> — if you can't finish them mid-maze, they don't bleed out, they leak. Lean on <b style="color:#ffd34d">fast attack speed</b>, <b style="color:#ffd34d">melee cleave</b>, and any tower with a <b style="color:#ffd34d">bonus-vs-runner</b> ability to drop them before they hit critical speed.`,
      color: '#ffaa44'
    });
    if (hasRegen) tips.push({
      headline: '💚 THEY HEAL WHEN YOU BLINK',
      body: `Wave <b>${nextWave}</b> has enemies that <b style="color:#ff5050">regenerate the moment you stop hitting them</b>. Apply constant pressure. DoTs (<b style="color:#ffd34d">Burn</b>, <b style="color:#ffd34d">Poison</b>, <b style="color:#ffd34d">Bleed</b>) count as damage and shut regen off — keep at least one DoT on every priority target.`,
      color: '#88dd88'
    });
    if (isDecade && !isBossWave) tips.push({
      headline: '☠ DECADE OF DOOM',
      body: `Wave <b>${nextWave}</b> is a 5-wave milestone: <b style="color:#ff5050">enemy HP DOUBLES across the board</b>, compounding with every cleared boss. If you don't have a T4+ combo on the field yet, you're not going to build one mid-wave. The <b style="color:#ffd34d">CODEX</b> has every recipe — go shopping for ingredients before you press START.`,
      color: '#ff5050'
    });
    if (isNecromancy) tips.push({
      headline: '💀 NECROMANCY — THEY GET UP',
      body: `Wave <b>${nextWave}</b> is a necromancy wave. Every <b style="color:#ff5050">Celtic, Carthaginian, or Undead grunt</b> you kill spits a <b>purple portal</b> open at the death tile and <b style="color:#aaffcc">6-9 reanimated undead</b> rise from it (each at 85-100% HP, staggered — they're tougher than the originals). Skeleton-axe for berserker types. Blue zombie for footman types. Hooded green-flame lich for druid types. <b style="color:#ffd34d">They don't chain</b> — the risen form stays dead when you kill it again — so plan on roughly <b>7-8× the kills</b> to clear the wave. Burn and bleed beat them faster than poison.`,
      color: '#aa55ff'
    });
    // 2026-05 v10 — DEMON DIVINE WEAKNESS TIP. Pops at W19 (mixed demons)
    // and at W20 (final boss). Calls out the divine multiplier and the
    // fire immunity in one shot so the player knows the answer before
    // placing the first prospect.
    if (hasDemons) tips.push({
      headline: '✨ DEMONS — DIVINE IS YOUR ANSWER',
      body: `Wave <b>${nextWave}</b> brings demons. They take <b style="color:#ffd34d">~3× damage from DIVINE sources</b> (per-enemy ×1.5 stacked with the SUPER_DEMONS faction +100% row). Park a <b style="color:#ffd34d">Solar Priest</b>, <b style="color:#ffd34d">Flamen</b>, <b style="color:#ffd34d">Augur</b>, <b style="color:#ffd34d">Haruspex</b>, <b style="color:#ffd34d">Pontifex</b>, or any divine combo on the path — every gold-haloed projectile hits for triple. <b style="color:#ff5050">FIRE deals ZERO damage</b> (demons are hellborn) — leave Igniferas, Inferno Carts, and fire-oil flasks at home. Poison and bleed still tick at +25-30% bonus on demons, so non-fire DoTs are also welcome.`,
      color: '#ffd34d'
    });
    // 2026-05 v10 — ELEPHANT WAVE TIPS. Combines the dust shield warning
    // with the siege weakness so the player has BOTH problem + solution
    // in one banner. The gold-sparkle visual cue is named so they know
    // what they're seeing on the field.
    if (hasElephants) tips.push({
      headline: '🐘 ELEPHANTS — DUST SHIELD + SIEGE WEAKNESS',
      body: `Wave <b>${nextWave}</b> has war elephants. Each one projects a <b style="color:#cdb98a">2-tile dust dome</b> around itself that <b style="color:#ff5050">blocks ranged attacks on every nearby GROUND ally</b> until the elephant dies. Protected allies get a small <b style="color:#ffe066">gold sparkle</b> overhead — that's your visual cue. Counter: <b style="color:#ffd34d">SIEGE</b> towers (Librator, Turris, Carroballista, Vulcan Engineer, Colossus Onager, Siege Onager, War Chariot, Nemesis Engine) — elephants take <b style="color:#88ff88">+45% damage</b> from siege. Melee also pierces the dome and hits the allies inside.`,
      color: '#cdb98a'
    });
    // Late-game divine smite tip — fires only when undead celts are
    // present (faction row gives +50% divine).
    if (hasUndeadCelts && !hasDemons) tips.push({
      headline: '🔥 UNDEAD CELTS — FIRE AND DIVINE WIN',
      body: `Wave <b>${nextWave}</b> has Undead Celts. Faction takes <b style="color:#ffd34d">+25% FIRE damage</b> and <b style="color:#ffd34d">+50% DIVINE damage</b> — burn the bones, smite the spirits. <b style="color:#ff5050">Poison and bleed deal 0</b> (no flesh to corrupt), so DoT-stacker builds will whiff this wave.`,
      color: '#ff8a22'
    });
    // Living Carthage — melee + SIEGE favored.
    if (hasLivingCarthage && !isBossWave) tips.push({
      headline: '⚔ CARTHAGE — MELEE + SIEGE WIN',
      body: `Wave <b>${nextWave}</b> brings living Carthage troops. Faction takes <b style="color:#ffd34d">+30% MELEE</b> and resists ranged by 20%. <b style="color:#ff9933">SIEGE is now a hard answer too</b> — every Carthage unit is siege-vulnerable: Spearman <b>+30%</b>, Numidian Rider <b>+15%</b>, Sacred Band Elite Guard <b>+40%</b>, Hannibal himself <b>+25%</b>. Park Onagers + Ballistarius on the path alongside your <b>Centurion / Primus Pilus / Cohort Guard / Imperator Guard</b>. Spearmen drilled in pitch-treated linen still resist fire — bleed is the safer DoT.`,
      color: '#ff7733'
    });
    // Undead Carthage — fire-immune.
    if (hasUndeadCarthage) tips.push({
      headline: '🛡 UNDEAD CARTHAGE — FIRE BURNS NOTHING',
      body: `Wave <b>${nextWave}</b> has Undead Carthage troops. The faction is <b style="color:#ff5050">fully fire-immune</b> (Ignifer, Inferno Cart, Fire Oil Flask, Vestal Pyre wasted). Poison and bleed deal 0 too — undead don't bleed. <b style="color:#ffd34d">+25% melee damage</b> taken, though. Lean into <b style="color:#ffd34d">melee + divine + siege</b> for this stretch.`,
      color: '#aabbdd'
    });
    if (hasCheckpointHealers && !isBossWave) tips.push({
      headline: '⛨ THEY HEAL AT EACH CHECKPOINT',
      body: `Wave <b>${nextWave}</b> brings stubborn grunts that regain <b style="color:#66ff88">25% maxHP</b> the first time they cross each waypoint coin (seven coins on the map). Each coin pays out once per enemy. <b style="color:#ff5050">Finish them BETWEEN coins or watch them walk back to full.</b> Pinch the path right before each waypoint with cleave melee or splash so the kill window stays narrow.`,
      color: '#66ff88'
    });
    if (tips.length === 0) {
      // Generic nudge so the early game still gets a confident voice.
      if (nextWave >= 5) {
        tips.push({
          headline: '★ THE QUIET BEFORE THE PROBLEM',
          body: `Wave <b>${nextWave}</b> — standard ${factionName(String(w.faction))} pressure. Use the breathing room to <b style="color:#ffd34d">build, upgrade, and combo</b>. The next wave never gets easier; you do.`,
          color: '#aabbdd'
        });
      } else {
        return;     // first few waves don't need a popup
      }
    }
    // Show the highest-priority tip (first one). If multiple, append a small
    // "+N more" line so player knows others apply but isn't drowned.
    const lead = tips[0];
    const moreLine = tips.length > 1
      ? `<div style="margin-top:10px;font-size:10px;letter-spacing:1px;color:#aa9a4a">+ ${tips.length - 1} other problem${tips.length > 2 ? 's' : ''} also coming. Open the <b style="color:#ffd34d">CODEX</b> before you regret it.</div>`
      : '';
    const b = document.createElement('div');
    b.id = 'pre-wave-tip';
    b.innerHTML = `
      <div style="font-size:16px;font-weight:bold;letter-spacing:3px;color:${lead.color};text-shadow:2px 2px 0 #000">${lead.headline}</div>
      <div style="margin-top:10px;font-size:12px;letter-spacing:0.6px;color:#fff8e0;line-height:1.6">${lead.body}</div>
      ${moreLine}
      <div style="margin-top:14px;font-size:10px;letter-spacing:2px;color:#aa9a4a">[ click anywhere to start preparing your defense ]</div>`;
    b.style.cssText = `width:min(580px,86%);text-align:center;padding:18px 24px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid ${lead.color};box-shadow:0 0 28px ${lead.color}88,inset 0 0 18px rgba(0,0,0,0.6);font-family:'Courier New',monospace;cursor:pointer;`;
    pushBanner(b, 0, { modal: true, clickDismiss: true });
  }
  // Legacy generic boss/flyer warning. Subsumed entirely by showPreWaveTip
  // which produces a richer, mechanic-aware tip per wave. Kept as a no-op
  // to avoid editing every call site, but the FINAL BOSS shake is preserved.
  function showNextWaveWarning(nextWave: number) {
    if (nextWave === 50) (window as any).__renderer?.triggerShake?.(4, 0.6);
  }
  (window as any).__game = state; // debug handle
  (window as any).__gore = gore;
  // Expose floating-number emitter so EnemySystem can pop DOT damage numbers.
  (window as any).__emitFloatingNumber = emitFloatingNumber;
  (window as any).__inv = inventory;
  (window as any).__waves__ = wavesData;
  // Provide enemy name lookup for renderers
  const enemiesData = await import('./data/enemies.json').then(m => m.default ?? m);
  (window as any).__enemiesData = enemiesData;
  // Provide waypoint data for ambient rune-pulse rendering
  const waypointsData = await import('./data/waypoints.json').then(m => m.default ?? m);
  (window as any).__wpData = waypointsData;
  initializeGrid(state);
  const path = buildGroundPath(state);
  if (!path) throw new Error('Could not build initial ground path');
  state.groundPath = path;
  // GHOST PATH — the path enemies WOULD take on a clean grid (no stones,
  // no towers). Captured once at game start, never updated. Renderer
  // draws this as a faded brown stripe permanently under the play field
  // so the player can SEE the baseline route even after they maze.
  (state as any).ghostPath = path.slice();
  state.flyerPath = buildFlyerPath();
  state.draw = []; // unused in Gem TD mode
  state.gold = ECONOMY.STARTING_GOLD;     // 10g — enough for an early stone-maze + a couple of pool draws

  // Roll 5 random prospects into a queue. Player will click 5 empty tiles to "reveal" them.
  function rollProspects() {
    const draw = rollDraw(state, BASE_TOWER_TYPES);
    state.prospectQueue = draw;
    state.prospectsPlaced = 0;
    state.phase = GamePhase.PROSPECT_PLACEMENT;
    // 2026-05 v10 — reset the per-round "choose-your-character" SFX
    // flag so the next round's cap-hit or keep-prompt can fire its
    // reminder cue again.
    (state as any).__chooseCharFiredThisRound = false;
    // First-round starter bonus: before wave 1 the player gets to KEEP TWO
    // prospects (instead of the usual one) so the opening defensive maze
    // has more shape. Every subsequent round = 1 keep.
    // Every round now allows TWO keeps (was: 2 only on round 1, 1 thereafter).
    state.keepsRemainingThisRound = 2;
    const bumpNote = draw.find((c: any) => c.__duplicateBumped)
      ? ` (Duplicate match! One prospect upgraded +${(draw.find((c: any) => c.__duplicateBumped) as any).__duplicateBumped} tier)` : '';
    state.hint = `Click empty tiles to roll prospects (1g each). KEEP two — the rest become walls. The maze is doing half the work either way.${bumpNote}`;
    // First-run intro modal: explains the prospect-cost loop. Skipped if
    // the player has already seen it on a prior run (localStorage flag).
    const isFirstRound = state.wave === 0 && !state.hasKeptAnyTowerEver;
    if (isFirstRound && !tipAlreadySeen('first_run_intro')) {
      showFirstRoundBanner();
      markTipSeen('first_run_intro');
    }
  }
  // Persistent "I've seen this tip" gate. Recurring tips (combo nudges,
  // downgrade hint, quest tip) check this so a returning player isn't
  // re-pestered every run. localStorage so it survives reloads.
  const TIP_SEEN_KEY = 'roman_td_tips_seen_v1';
  function getTipsSeen(): Record<string, boolean> {
    try { return JSON.parse(localStorage.getItem(TIP_SEEN_KEY) ?? '{}'); }
    catch { return {}; }
  }
  function markTipSeen(id: string) {
    try {
      const cur = getTipsSeen();
      cur[id] = true;
      localStorage.setItem(TIP_SEEN_KEY, JSON.stringify(cur));
    } catch {}
  }
  function tipAlreadySeen(id: string): boolean {
    return !!getTipsSeen()[id];
  }
  function showComboNudge(wave: number) {
    document.getElementById('combo-nudge')?.remove();
    // 2026-05-18 — Copy tightened. Each tip is one short sentence with the
    // hook word highlighted. Players read these as glances, not essays.
    const messages: Record<number, { headline: string; body: string }> = {
      5:  { headline: '★ THE FORGE IS OPEN', body: 'Stack 3-of-a-kind or follow a recipe in the <span style="color:#ffd34d">CODEX</span>.' },
      10: { headline: '⚠ COMBINE OR FALL OFF', body: 'Base towers stop scaling here. <span style="color:#ff5050">Combos carry mid-game</span>.' },
      15: { headline: '⚠ ELITES DEMAND COMBOS', body: 'Iron Phalanx is tuned around combo damage. <span style="color:#ff5050">Build one.</span>' },
      20: { headline: '★ MID-TIER ABILITIES UNLOCKED', body: 'Chain lightning, line-pierce, status extend. Pick a recipe in the <span style="color:#ffd34d">CODEX</span>.' },
      25: { headline: '⚠ T5 OR BUST', body: 'Boss HP doubles per cleared boss. <span style="color:#ff5050">Plan T5 ingredients now.</span>' },
      30: { headline: '★ APEX COMBOS WIN GAMES', body: 'Global auras, true damage, divine pierce — apex combos only.' },
      40: { headline: '⚠ NO COMBO, NO CHANCE', body: 'Solo bosses, double HP. Apex tower or apex obituary.' }
    };
    const tipId = `combo_nudge_${wave}`;
    if (tipAlreadySeen(tipId)) return;     // returning player has seen this tip
    const m = messages[wave] ?? { headline: '★ COMBO REMINDER', body: 'Combine towers via the codex.' };
    const b = document.createElement('div');
    b.id = 'combo-nudge';
    b.innerHTML = `
      <div style="font-size:15px;font-weight:bold;letter-spacing:3px;color:#ffd34d;text-shadow:2px 2px 0 #000">${m.headline}</div>
      <div style="margin-top:8px;font-size:11px;letter-spacing:0.8px;color:#fff8e0;line-height:1.55">${m.body}</div>
      <div style="margin-top:8px;font-size:9px;letter-spacing:1px;color:#aa9a4a">[ click to dismiss · ✕ to never show again ]</div>`;
    b.style.cssText = `width:min(520px,82%);text-align:center;padding:14px 20px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:2px solid #ffd34d;box-shadow:0 0 22px rgba(255,211,77,0.45);font-family:'Courier New',monospace;text-shadow:1px 1px 0 #000;cursor:pointer;`;
    b.addEventListener('click', () => { markTipSeen(tipId); }, { once: true });
    pushBanner(b, 4000);
  }
  // 2026-05-18 — Downgrade tip retired. Recipes no longer use "minTier",
  // they use "tier 2+ / 3+ at least one ingredient" semantics, so
  // ranking a tower DOWN doesn't unlock recipes — it just costs you
  // a tier. The tip nudged the wrong intuition. Function kept as a
  // no-op so the wave-start scheduler still compiles; the calls in
  // the wave-start dispatch are stubbed out.
  function showDowngradeTip() { /* retired — kept as no-op stub */ }
  // ─── Prospect-phase reminder banner ────────────────────────────────────
  // Persistent thin banner at the TOP of the play area during prospect
  // placement. Reminds the player they can KEEP UP TO 2 each round. The
  // player can dismiss it with a click; it reappears next round unless
  // they've dismissed it 3 times (then it stops nagging entirely).
  const REMINDER_DISMISS_KEY = 'roman_td_prospect_reminder_dismisses_v1';
  function dismissCountsThisSession(): number { return (window as any).__reminderDismisses ?? 0; }
  function bumpDismissCount() {
    (window as any).__reminderDismisses = dismissCountsThisSession() + 1;
    try {
      const total = (parseInt(localStorage.getItem(REMINDER_DISMISS_KEY) ?? '0') || 0) + 1;
      localStorage.setItem(REMINDER_DISMISS_KEY, String(total));
    } catch {}
  }
  function totalLifetimeDismisses(): number {
    try { return parseInt(localStorage.getItem(REMINDER_DISMISS_KEY) ?? '0') || 0; }
    catch { return 0; }
  }
  function updateProspectReminder() {
    let bar = document.getElementById('prospect-reminder') as HTMLElement | null;
    const inProspect = state.phase === GamePhase.PROSPECT_PLACEMENT
                    || state.phase === GamePhase.PICK_KEEPER;
    if (!inProspect || totalLifetimeDismisses() >= 3) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'prospect-reminder';
      // 2026-05-19 — Banner tightened. Was a wide top-center bar that
      // collided with the wave-brief panel and the codex/shop buttons
      // on smaller viewports. Now a compact pill stacked into a corner
      // with shorter copy. Top-right is clear of the wave-brief
      // (lower-left) and the right-side HUD column.
      bar.style.cssText = `position:absolute;top:8px;right:14px;padding:6px 12px;background:linear-gradient(180deg,rgba(26,20,16,0.96),rgba(12,10,8,0.96));border:2px solid #ffd34d;color:#fff8e0;font-family:'Courier New',monospace;font-size:10.5px;font-weight:bold;letter-spacing:1.2px;z-index:75;cursor:pointer;text-shadow:1px 1px 0 #000;box-shadow:0 0 12px rgba(255,211,77,0.45);display:flex;flex-direction:column;align-items:center;gap:2px;max-width:200px;text-align:center;`;
      bar.addEventListener('click', () => { bumpDismissCount(); bar?.remove(); }, { once: true });
      document.getElementById('stage-wrap')?.appendChild(bar);
    }
    const left = state.keepsRemainingThisRound ?? 2;
    bar.innerHTML = `<span style="color:#ffd34d">⚠ KEEP <b>${left}</b> OF 2 PROSPECTS</span>
      <span style="color:#aa9a4a;font-weight:normal;font-size:9px;letter-spacing:1px">rest cement → walls · click ✕</span>`;
  }
  // ─── Prospect sidebar ──────────────────────────────────────────────────
  // Right-edge vertical panel showing every prospect for the current round
  // (already-placed pending towers + queued cards not yet placed). Click
  // any placed prospect to open its full tower menu — same UI as clicking
  // the tower on the field. Vanishes outside of PROSPECT_PLACEMENT and
  // PICK_KEEPER phases. First-round flow naturally shows all 5 here so the
  // player can compare before picking 2 to keep.
  function updateProspectSidebar() {
    let panel = document.getElementById('prospect-sidebar') as HTMLElement | null;
    const inProspectFlow = state.phase === GamePhase.PROSPECT_PLACEMENT
                        || state.phase === GamePhase.PICK_KEEPER;
    if (!inProspectFlow) {
      if (panel) panel.remove();
      return;
    }
    // Gather only ALREADY-PLACED pending towers. We deliberately do NOT show
    // queued (un-revealed) prospects — the panel is meant to fill in as the
    // player clicks tiles, not to spoil what's coming. If the player hasn't
    // placed anything yet, the panel stays hidden so the screen is clean.
    const placedPending = Array.from(state.towers.values())
      .filter(t => t.pending)
      .sort((a, b) => a.placedAtWave === b.placedAtWave ? a.tileY - b.tileY : a.placedAtWave - b.placedAtWave);
    if (placedPending.length === 0) {
      if (panel) panel.remove();
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'prospect-sidebar';
      // 2026-05-15 v4: relocated from the right edge of the canvas
      // (96 px absolute column floating over the playfield) into the
      // LEFT HUD panel, directly below the wave/lives/gold block.
      // The previous absolute-positioning ate canvas space and made
      // long lists scroll. Now it flows naturally in the left flex
      // column, fills the full 200–240 px panel width, and grows
      // downward without overlapping anything.
      //
      // The cells are bigger here (≈100 px sprite vs the old 54 px)
      // because we have ~3× the horizontal room — readability of the
      // tower portrait + CRIT row is dramatically better, especially
      // when triaging 8–10 prospects between rounds.
      panel.style.cssText = `width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:8px;background:linear-gradient(180deg,rgba(26,20,16,0.96),rgba(12,10,8,0.96));border:2px solid #d4af37;box-shadow:0 0 14px rgba(212,175,55,0.25);font-family:'Courier New',monospace;max-height:calc(100vh - 240px);overflow-y:auto;overflow-x:hidden;`;
      // Insert into the LEFT HUD column instead of stage-wrap. Falls
      // back to stage-wrap if the panel doesn't exist (defensive).
      const leftPanel = document.getElementById('left-panel')
        ?? document.getElementById('stage-wrap');
      leftPanel?.appendChild(panel);
      markScrollable(panel);   // gold scrollbar + "▼ SCROLL FOR MORE" hint
    }
    // 2026-05-19 — Inject the cell :hover CSS exactly once. Brightens
    // the border + adds a cyan glow so the click affordance is obvious
    // before the player commits. Pairs with the "▶ INSPECT" pill drawn
    // inside each cell.
    if (!document.getElementById('ps-cell-hover-style')) {
      const st = document.createElement('style');
      st.id = 'ps-cell-hover-style';
      st.textContent = `
        .ps-cell[data-tower-id]:hover {
          border-color: #88ddff !important;
          box-shadow: 0 0 10px rgba(136, 221, 255, 0.55);
        }
      `;
      document.head.appendChild(st);
    }
    const TIER_HEX: Record<number,string> = { 1:'#aaaaaa',2:'#b87333',3:'#c0c0c0',4:'#ffd34d',5:'#ff5050' };
    const keepsLeft = state.keepsRemainingThisRound ?? 2;
    const headline = state.phase === GamePhase.PICK_KEEPER
      ? `KEEP ${keepsLeft} / 2`
      : `${placedPending.length} PLACED`;
    // 2026-05-15 v4: header bumped from 9 px to 12 px now that the
    // panel sits in the wider left HUD column — it can breathe.
    // 2026-05-19 — Added a two-line click-affordance tip below the
    // headline so players actually realize the thumbnails are clickable
    // and that clicking shows the same tower UI they get from clicking
    // a tower on the map (stats, items, RECIPES list, upgrade buttons).
    // The CRIT/T-tier row above is a quick read; the click opens the
    // full detail panel.
    const headerHtml = `<div style="text-align:center;padding-bottom:6px;border-bottom:1px solid #5a4a30;margin-bottom:4px">
      <div style="font-size:12px;letter-spacing:3px;color:#ffd34d;font-weight:bold;text-shadow:1px 1px 0 #000">${headline}</div>
      <div style="font-size:9px;letter-spacing:0.8px;color:#88ddff;font-weight:bold;margin-top:3px">🖱 CLICK ANY TOWER FOR FULL INFO + RECIPES</div>
    </div>`;
    const cellHtml = (sprKey: string, type: string, tier: number, opts: { towerId?: string; queued?: boolean; bumped?: number } = {}) => {
      const src = texUrl(sprKey) ?? '';
      const bumpTag = opts.bumped ? `<span style="position:absolute;top:-3px;left:-3px;background:#ee55cc;color:#fff;font-size:7px;font-weight:bold;padding:1px 3px;border:1px solid #000">+${opts.bumped}</span>` : '';
      const queuedTag = opts.queued ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-size:8px;color:#ffd34d;letter-spacing:1px;font-weight:bold;text-shadow:1px 1px 0 #000">QUEUED</div>` : '';
      const cursor = opts.towerId ? 'pointer' : 'default';
      const dataAttr = opts.towerId ? `data-tower-id="${opts.towerId}"` : '';
      // 2026-05 v11: CRIT badge — small one-liner under the name so the
      // player can compare prospects' burst potential without clicking.
      const tdef: any = (towersData as any)[type] ?? {};
      const cc = (tdef.critChance ?? 0) as number;
      const cm = (tdef.critMult ?? 1.5) as number;
      const critTxt = cc > 0 ? `${Math.round(cc*100)}% ${cm.toFixed(1)}×` : '—';
      const critCol = cc >= 0.18 ? '#ffd34d' : (cc > 0 ? '#ffbe7a' : '#aa9a4a');
      // 2026-05-15 v4: cell scales up to fill the wider left-panel
      // column. Sprite jumped 54 → 92 px (≈70% larger), tower name
      // bumped to 11 px so it's actually readable, CRIT row keeps
      // its yellow accent. Names wrap to 2 lines if they're long
      // (no more "AQUILIFER…" truncation in a 96 px column).
      // 2026-05-19 — Added a small "▶ INSPECT" pill at the bottom of
      // every clickable cell so the click affordance is explicit. The
      // CSS :hover rule (injected once below) also brightens the cell
      // border on hover to confirm clickability before commit.
      const inspectPill = opts.towerId
        ? `<div style="font-size:9px;color:#88ddff;letter-spacing:1px;font-weight:bold;margin-top:2px;padding:2px 6px;background:rgba(136,221,255,0.08);border:1px solid rgba(136,221,255,0.35);border-radius:2px">▶ INSPECT</div>`
        : '';
      return `<div class="ps-cell" ${dataAttr} style="position:relative;border:2px solid ${TIER_HEX[tier]};background:#0c0a08;padding:6px;cursor:${cursor};display:flex;flex-direction:column;align-items:center;gap:3px;transition:border-color 120ms ease, box-shadow 120ms ease">
        ${bumpTag}
        <div style="position:relative;width:92px;height:92px">
          ${src ? `<img src="${src}" style="width:92px;height:92px;image-rendering:pixelated;display:block"/>` : ''}
          ${queuedTag}
        </div>
        <div style="font-size:11px;color:${TIER_HEX[tier]};font-weight:bold;letter-spacing:1px">T${tier}</div>
        <div style="font-size:10px;color:#cdb98a;text-align:center;line-height:1.2;letter-spacing:0.5px;word-break:break-word;font-weight:bold">${type.replace(/_/g,' ')}</div>
        <div style="font-size:9px;color:${critCol};letter-spacing:0.7px;font-weight:bold">CRIT ${critTxt}</div>
        ${inspectPill}
      </div>`;
    };
    const placedHtml = placedPending.map(t =>
      cellHtml(String(t.type), String(t.type), t.qualityTier, { towerId: t.id, bumped: (t as any).duplicateBumped })
    ).join('');

    // 2026-05 v10: live recipe status block. Surfaces every combo that
    // includes any of the currently-pending prospects, with green/orange
    // text indicating whether each ingredient is already KEPT or still
    // PENDING. As soon as the player saves the first prospect, the ones
    // that were orange flip to green here — instant visual feedback that
    // the combo state has progressed.
    const combos = scanCombos(state).filter(cb =>
      cb.ingredients.some(ing => placedPending.some(p => p.id === ing.id))
    );
    let recipeHtml = '';
    if (combos.length > 0) {
      // 2026-05-15 v4: recipe text bumped 8.5 → 11 px now that the
      // panel is in the wider HUD column, with full multi-word
      // ingredient names instead of split-on-underscore[0]. "Cohort
      // Guard" reads properly instead of "Cohort". Lines wrap when
      // long instead of clipping.
      const lines = combos.slice(0, 5).map(cb => {
        const resultName = String(cb.result).replace(/_/g, ' ');
        const anyPending = cb.ingredients.some(ing => state.towers.get(ing.id)?.pending);
        const headerColor = anyPending ? '#ff9933' : '#88ff88';
        const statusTag = anyPending ? 'READY-IF-KEPT' : 'READY';
        const ingTxt = cb.ingredients.map(ing => {
          const isPending = !!state.towers.get(ing.id)?.pending;
          const c = isPending ? '#ff9933' : '#88ff88';
          return `<span style="color:${c}">${String(ing.type).replace(/_/g, ' ')}</span>`;
        }).join('<span style="color:#cdb98a"> + </span>');
        return `<div style="font-size:11px;line-height:1.35;margin-bottom:6px;padding:4px 6px;background:#100c08;border-left:2px solid ${headerColor}">
          <div style="color:${headerColor};font-weight:bold;letter-spacing:1px">▶ ${resultName}</div>
          <div style="font-size:10px;letter-spacing:0.5px;word-break:break-word;margin-top:2px">${ingTxt}</div>
          <div style="font-size:9px;color:${headerColor};letter-spacing:1.2px;margin-top:2px;font-weight:bold">${statusTag} · ${cb.cost}g</div>
        </div>`;
      }).join('');
      recipeHtml = `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #5a4a30">
        <div style="font-size:11px;letter-spacing:3px;color:#ffd34d;text-align:center;margin-bottom:5px;font-weight:bold">RECIPES</div>
        ${lines}
      </div>`;
    }
    panel.innerHTML = headerHtml + placedHtml + recipeHtml;
    // Wire clicks → open the tower menu for placed prospects. Hover →
    // preview that tower's range ring on the field WITHOUT opening the
    // menu, so the player can quickly compare ranges between prospects
    // before committing to a keeper.
    panel.querySelectorAll('.ps-cell[data-tower-id]').forEach(el => {
      const id = (el as HTMLElement).dataset.towerId!;
      (el as HTMLElement).onclick = () => {
        const tw = state.towers.get(id);
        if (tw) inspectTower(tw);
      };
      (el as HTMLElement).onmouseenter = (ev: MouseEvent) => {
        // Save the current selection so we can restore on leave.
        if (renderer.selectedTowerId !== id) {
          (panel as any).__prevSelectedId = renderer.selectedTowerId;
          renderer.selectedTowerId = id;
        }
        // 2026-05-19 — Also show the tower hover preview so players
        // can read the stats of each prospect from the sidebar without
        // clicking through. Mirrors the canvas-hover preview path.
        updateTowerHoverPreview(id, ev.clientX, ev.clientY);
      };
      (el as HTMLElement).onmousemove = (ev: MouseEvent) => {
        // Keep the preview tracking the cursor across the cell.
        updateTowerHoverPreview(id, ev.clientX, ev.clientY);
      };
      (el as HTMLElement).onmouseleave = () => {
        const prev = (panel as any).__prevSelectedId;
        renderer.selectedTowerId = prev ?? null;
        (panel as any).__prevSelectedId = null;
        document.getElementById('tower-hover-preview')?.remove();
      };
    });
  }
  // ─── Tower-queue indicator ─────────────────────────────────────────────
  // Bottom-left chip that surfaces purchased / quest-granted towers waiting
  // to be placed. Shows the next tower's type+tier + total queue size so
  // the player can never miss them, especially after a quest completion.
  function updateTowerQueueIndicator() {
    const queue = state.pendingPurchasedTowers ?? [];
    let chip = document.getElementById('tower-queue-chip') as HTMLElement | null;
    if (queue.length === 0) {
      if (chip) chip.remove();
      return;
    }
    // 2026-05-17 — moved from bottom-left → top-left of stage so it
    // stops blocking the wave-brief content beneath. Also collapsible
    // now via ▾/▸ caret in the top-right of the chip; localStorage
    // remembers the player's preference across waves.
    const collapseKey = 'roman_td_tower_queue_collapsed';
    let collapsed = false;
    try { collapsed = localStorage.getItem(collapseKey) === '1'; } catch { /* ignore */ }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'tower-queue-chip';
      chip.style.cssText = `position:absolute;left:8px;top:8px;padding:8px 12px;background:linear-gradient(180deg,#1a3a20,#0c1a08);border:2px solid #88ff88;color:#fff8e0;font-family:'Courier New',monospace;font-size:11px;z-index:62;box-shadow:0 0 14px rgba(136,255,136,0.4);text-shadow:1px 1px 0 #000;max-width:200px;`;
      document.getElementById('stage-wrap')?.appendChild(chip);
    }
    const head = queue[0];
    const headPrice = purchasedTowerPrice(head);
    const moreLine = queue.length > 1 ? `<div style="font-size:9px;color:#cdb98a;margin-top:2px">+${queue.length - 1} more queued</div>` : '';
    const toggleBtn = `<button id="tower-queue-toggle" title="${collapsed ? 'Expand' : 'Collapse'}" style="position:absolute;top:2px;right:4px;background:transparent;border:none;color:#88ff88;font-size:13px;line-height:1;cursor:pointer;padding:2px 4px;font-weight:bold">${collapsed ? '▸' : '▾'}</button>`;
    if (collapsed) {
      chip.style.padding = '6px 22px 6px 10px';
      chip.style.maxWidth = '';
      chip.innerHTML = `
        ${toggleBtn}
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:14px">📥</span>
          <span style="font-size:11px;color:#ffd34d;font-weight:bold">${queue.length} TOWER${queue.length === 1 ? '' : 'S'}</span>
        </div>`;
    } else {
      chip.style.padding = '8px 22px 8px 12px';
      chip.style.maxWidth = '200px';
      chip.innerHTML = `
        ${toggleBtn}
        <div style="font-size:9px;letter-spacing:2px;color:#88ff88;font-weight:bold">📥 PLACE NEXT</div>
        <div style="font-size:13px;font-weight:bold;color:#ffd34d;margin-top:2px">${head.type.replace(/_/g,' ')} <span style="color:#fff">T${head.tier}</span></div>
        <div style="font-size:9px;color:#cdb98a;margin-top:1px">click any empty tile</div>
        ${moreLine}
        <button id="tower-queue-putback" style="margin-top:6px;width:100%;background:#3a1a1a;color:#e8d6a8;border:1px solid #a04040;padding:3px 6px;font-family:inherit;font-size:10px;letter-spacing:1px;cursor:pointer">PUT BACK (refund ${headPrice}g)</button>`;
    }
    const toggleEl = chip.querySelector<HTMLButtonElement>('#tower-queue-toggle');
    if (toggleEl) toggleEl.onclick = (ev) => {
      ev.stopPropagation();
      try { localStorage.setItem(collapseKey, collapsed ? '0' : '1'); } catch { /* ignore */ }
      updateTowerQueueIndicator();
    };
    const btn = chip.querySelector<HTMLButtonElement>('#tower-queue-putback');
    if (btn) btn.onclick = (ev) => {
      ev.stopPropagation();
      const q = state.pendingPurchasedTowers ?? [];
      if (q.length === 0) return;
      const popped = q.shift()!;
      state.pendingPurchasedTowers = q;
      earnGold(state, purchasedTowerPrice(popped));
      state.hint = `Put back ${popped.type.replace(/_/g,' ')} T${popped.tier} — ${purchasedTowerPrice(popped)}g refunded.`;
      updateTowerQueueIndicator();
    };
  }
  // Refund price for queued purchased towers. Mercator T5 flat 50g; quest
  // grants refund the wave's place cost as a fair stand-in (no purchase price
  // to recover). Tower types from `pendingPurchasedTowers` carry .source.
  function purchasedTowerPrice(entry: { type: string; tier: number; source: 'mercator' | 'quest' }): number {
    if (entry.source === 'mercator') return 50;
    return (ECONOMY.TIER_PLACE_COST as Record<number, number>)[entry.tier] ?? 5;
  }
  // ─── Wave-preview chip (bottom-left) ────────────────────────────────
  // 2026-05 v6: persistent chip during BUILD / PROSPECT / PICK_KEEPER
  // phases showing the NEXT wave's faction + enemy sprites. Each sprite
  // is clickable — opens the enemy-inspect modal so the player can study
  // resistances, traits, and immunities before the wave starts. Hidden
  // during WAVE_PHASE (the top wave-info bar already shows what's live).
  //
  // STATE-CACHE (2026-05 v6 bugfix): the chip used to rebuild its HTML
  // on every frame, which destroyed and recreated the `.wpv-cell` DOM
  // elements ~60×/s. A click that landed mid-frame had its mousedown
  // target destroyed before mouseup fired, so the click event never
  // registered. We now cache the last-rendered signature (wave + phase)
  // and skip the rebuild when nothing changed. The cells stay alive,
  // their click handlers fire normally.
  let __wavePreviewLastSig = '';
  function updateWavePreviewChip() {
    const inBuild = state.phase === GamePhase.BUILD_PHASE
                 || state.phase === GamePhase.PROSPECT_PLACEMENT
                 || state.phase === GamePhase.PICK_KEEPER;
    let chip = document.getElementById('wave-preview-chip') as HTMLElement | null;
    if (!inBuild) {
      if (chip) { chip.remove(); __wavePreviewLastSig = ''; }
      return;
    }
    const nextWaveIdx = state.wave;       // wave that's about to start
    const w: any = wavesData[nextWaveIdx];
    if (!w) {
      if (chip) { chip.remove(); __wavePreviewLastSig = ''; }
      return;
    }
    // Signature for diffing — if unchanged, skip the rebuild so the
    // existing DOM (and its click handlers) stay intact.
    const sig = `${nextWaveIdx}|${state.phase}|${w.spawns.map((s: any) => `${s.type}x${s.count}`).join(',')}`;
    if (chip && sig === __wavePreviewLastSig) return;
    __wavePreviewLastSig = sig;
    // Build the chip lazily.
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'wave-preview-chip';
      // Sits in the bottom-left area, ABOVE the tower-queue chip when
      // both are visible. Z-index high enough to float over the playfield
      // but below modals (which use 50+).
      // z-index 40 keeps the chip above the canvas but BELOW every modal
      // (codex 60, boss banner 65, enemy-inspect 55, shop 50) so opening
      // the inspect modal via clicking a sprite isn't covered by the chip.
      chip.style.cssText = `position:absolute;left:8px;bottom:90px;max-width:340px;padding:8px 10px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:2px solid #d4af37;color:#fff8e0;font-family:'Courier New',monospace;font-size:11px;z-index:40;box-shadow:0 0 14px rgba(212,175,55,0.32);`;
      document.getElementById('stage-wrap')?.appendChild(chip);
    }
    // Header line
    const isBoss = w.type === 'B';
    const isFlyer = w.type === 'F';
    const isMixed = w.type === 'M';
    const typeBadge = isBoss ? '<span style="color:#ee5555;font-weight:bold;letter-spacing:2px">⚠ BOSS</span>'
                    : isFlyer ? '<span style="color:#66ccff;font-weight:bold">FLYERS</span>'
                    : isMixed ? '<span style="color:#ffd34d">MIXED</span>'
                    :          '<span style="color:#cdb98a">GROUND</span>';
    const necroTag = w.necromancy ? ' <span style="color:#aa55ff;font-weight:bold;font-size:9px">💀 NECRO</span>' : '';
    const factionLabel = String(w.faction).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const headerHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #5a4a30;padding-bottom:4px;margin-bottom:5px">
        <span style="font-size:10px;letter-spacing:2px;color:#9be0ff">NEXT — W${nextWaveIdx + 1}</span>
        <span>${typeBadge}${necroTag}</span>
      </div>
      <div style="font-size:10px;color:#cdb98a;margin-bottom:5px">${factionLabel}</div>`;
    // Enemy sprite grid — one tile per unique enemy type. Count badge in
    // corner. Tooltip on hover; click opens enemy-inspect modal.
    const rows: string[] = [];
    for (const spawn of w.spawns) {
      const def: any = (enemiesData as any)[spawn.type];
      if (!def) continue;
      // Skip the same stripped/orphan filter the Codex uses — if this
      // enemy won't actually spawn (boss wave strips non-boss mobs),
      // hide it.
      if (isBoss && !def.isBoss) continue;
      const src = texUrl(spawn.type) ?? '';
      const portrait = src
        ? `<img src="${src}" style="width:36px;height:36px;image-rendering:pixelated;display:block" alt="${def.name}"/>`
        : `<div style="width:36px;height:36px;background:#2a2218;color:#aa9a4a;font-size:9px;display:flex;align-items:center;justify-content:center">?</div>`;
      const bossTint = def.isBoss ? 'border:2px solid #ee5555;box-shadow:0 0 6px rgba(238,85,85,0.5)' : 'border:1px solid #5a4a30';
      rows.push(`<div class="wpv-cell" data-enemy-type="${spawn.type}" title="${def.name} ×${spawn.count} — click for stats" style="position:relative;${bossTint};background:#0c0a08;padding:2px;cursor:pointer;transition:transform 0.1s">
        ${portrait}
        <div style="position:absolute;right:-2px;bottom:-3px;background:#1a1410;color:#ffd34d;font-size:8px;font-weight:bold;padding:1px 3px;border:1px solid #5a4a30">×${spawn.count}</div>
      </div>`);
    }
    chip.innerHTML = headerHtml + `<div style="display:flex;flex-wrap:wrap;gap:5px">${rows.join('')}</div>
      <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px;margin-top:5px;text-align:center">CLICK A SPRITE FOR STATS</div>`;
    chip.querySelectorAll<HTMLElement>('.wpv-cell').forEach(cell => {
      const type = cell.dataset.enemyType;
      if (!type) return;
      cell.onmouseenter = () => { cell.style.transform = 'scale(1.08)'; };
      cell.onmouseleave = () => { cell.style.transform = 'scale(1)'; };
      // stopPropagation prevents the click from bubbling to the canvas
      // tile-click handler (which would treat it as a stray empty-tile
      // click during prospect phase).
      cell.onclick = (ev) => {
        ev.stopPropagation();
        // Pass the upcoming wave number so the inspect modal scales HP to
        // the actual spawn HP for that wave (was showing raw baseHp).
        showEnemyInspectByType(app, type, nextWaveIdx + 1);
      };
    });
  }
  // ─── Quest modal ──────────────────────────────────────────────────────
  // Click-to-open dialog (triggered by the QUESTS button at the bottom of
  // the screen). Shows EVERY active quest with its progress + reward. The
  // modal is dismissed by clicking outside or pressing the close button.
  // No persistent overlay on the playfield — the canvas stays unobstructed.
  function showQuestsModal() {
    document.getElementById('quests-modal')?.remove();
    ensureQuestState(state);
    const all = activeQuestsByTier(state);
    const completed = state.completedQuests ?? [];
    const tierColor: Record<string,string> = { EARLY:'#88ddff', MID:'#ffd34d', LATE:'#ff5050' };
    const rewardLabel = (q: QuestDef) => {
      const r = q.reward;
      if (r.kind === 'GOLD') return `+${r.amount}g`;
      if (r.kind === 'ITEM') return `item: ${(r.item ?? '').replace(/_/g,' ').toLowerCase()}`;
      if (r.kind === 'TOWER') return `tower: ${String(r.towerType).replace(/_/g,' ')} T${r.towerTier}`;
      if (r.kind === 'LIFE') return `+${r.amount} life`;
      return '?';
    };
    const renderQuest = (q: QuestDef) => {
      const prog = Math.min(q.target, state.questProgress?.[q.id] ?? 0);
      const pct = Math.floor((prog / q.target) * 100);
      // Tier label intentionally hidden — colored bar carries the tier signal.
      return `<div style="background:#0c0a08;border-left:3px solid ${tierColor[q.tier]};padding:8px 12px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div style="color:${tierColor[q.tier]};font-weight:bold;font-size:13px;letter-spacing:0.5px">${q.title}</div>
          <div style="color:#88ff88;font-size:11px;font-weight:bold">→ ${rewardLabel(q)}</div>
        </div>
        <div style="color:#cdb98a;font-size:11px;margin-top:3px;line-height:1.45">${q.blurb}</div>
        <div style="margin-top:6px;background:#1a1410;border:1px solid #3a3025;height:8px;position:relative">
          <div style="background:${tierColor[q.tier]};height:100%;width:${pct}%"></div>
        </div>
        <div style="font-size:10px;color:#aa9a4a;margin-top:3px">${prog} / ${q.target}</div>
      </div>`;
    };
    // 2026-05-17 — Tier banner. Per-tier completion pays a one-time gold
    // bonus (50 / 100 / 200) and the full clear pays a 500g capstone.
    // Banner shows current progress, the gold value, and a paid-out tag
    // once the bonus has already banked.
    const granted = new Set(state.questTierBonusGranted ?? []);
    const tierBonusValues: Record<'EARLY'|'MID'|'LATE', number> = { EARLY: 50, MID: 100, LATE: 200 };
    const tierTitle: Record<'EARLY'|'MID'|'LATE', string> = { EARLY: '🌱 EARLY GAME', MID: '⚔ MID GAME', LATE: '👑 LATE GAME' };
    const renderTierBanner = (tierKey: 'EARLY'|'MID'|'LATE') => {
      const tierQuests = QUESTS.filter(q => q.tier === tierKey);
      const done = tierQuests.filter(q => completed.includes(q.id)).length;
      const total = tierQuests.length;
      const paid = granted.has(tierKey);
      const status = paid
        ? `<span style="color:#88ff88;font-weight:bold;letter-spacing:1px">✓ PAID OUT</span>`
        : (done === total
            ? `<span style="color:#ffd34d;font-weight:bold;letter-spacing:1px">READY — bonus next tick</span>`
            : `<span style="color:#aa9a4a">${done} / ${total} done</span>`);
      return `<div style="background:linear-gradient(180deg,#1a1410,#0c0a08);border:1px solid ${tierColor[tierKey]};border-left:4px solid ${tierColor[tierKey]};padding:7px 10px;margin:10px 0 6px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="color:${tierColor[tierKey]};font-weight:bold;letter-spacing:2px;font-size:12px">${tierTitle[tierKey]}</div>
          <div style="font-size:10px;color:#cdb98a;margin-top:2px">Complete all ${total} for a <b style="color:#88ff88">+${tierBonusValues[tierKey]}g</b> bonus</div>
        </div>
        <div style="font-size:10px;text-align:right">${status}</div>
      </div>`;
    };
    const renderTierSection = (tierKey: 'EARLY'|'MID'|'LATE') => {
      const banner = renderTierBanner(tierKey);
      const quests = all[tierKey];
      const body = quests.length > 0
        ? quests.map(renderQuest).join('')
        : `<div style="text-align:center;color:#aa9a4a;padding:8px;font-style:italic;font-size:11px">All ${tierKey.toLowerCase()}-game quests done.</div>`;
      return banner + body;
    };
    // Grand-completion capstone banner — shown at the top of the modal so
    // players can see the prize before they finish.
    const allPaid = granted.has('ALL');
    const allDone = QUESTS.every(q => completed.includes(q.id));
    const grandStatus = allPaid
      ? `<span style="color:#88ff88;font-weight:bold">✓ PAID OUT</span>`
      : (allDone
          ? `<span style="color:#ffd34d;font-weight:bold">READY — capstone banks next tick</span>`
          : `<span style="color:#aa9a4a">${completed.length} / ${QUESTS.length} done</span>`);
    const grandBanner = `<div style="background:linear-gradient(180deg,#2a1f12,#1a1410);border:2px solid #d4af37;padding:9px 12px;margin-bottom:8px;text-align:center">
      <div style="color:#ffd34d;font-weight:bold;letter-spacing:2px;font-size:13px">🏆 GRAND COMPLETION</div>
      <div style="font-size:10px;color:#cdb98a;margin-top:3px">Clear all 18 quests to bank an additional <b style="color:#88ff88">+500g</b> capstone</div>
      <div style="font-size:10px;margin-top:4px">${grandStatus}</div>
    </div>`;
    const list = QUESTS.length === completed.length
      ? grandBanner + renderTierSection('EARLY') + renderTierSection('MID') + renderTierSection('LATE') +
        `<div style="text-align:center;color:#88ff88;padding:14px 8px;font-style:italic;font-size:12px;margin-top:8px">All quests complete. Glory to the legion.</div>`
      : grandBanner + renderTierSection('EARLY') + renderTierSection('MID') + renderTierSection('LATE');
    const completedHtml = completed.length > 0
      ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #5a4a30;font-size:11px;color:#aa9a4a"><b style="color:#88ff88">Completed:</b> ${completed.length} / 18</div>`
      : '';
    const modal = document.createElement('div');
    modal.id = 'quests-modal';
    modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);z-index:62;font-family:'Courier New',monospace;`;
    const panel = document.createElement('div');
    panel.style.cssText = `background:#1a1410;border:3px solid #88ff88;color:#e8d6a8;width:560px;max-height:84vh;overflow:auto;padding:14px 16px;box-shadow:0 0 28px rgba(136,255,136,0.35);`;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #5a4a30">
        <div style="font-size:18px;font-weight:bold;letter-spacing:3px;color:#88ff88;text-shadow:1px 1px 0 #000">📜 QUESTS</div>
        <button id="quests-close" style="background:#3a3025;color:#e8d6a8;border:1px solid #5a4a30;padding:6px 12px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px">CLOSE</button>
      </div>
      ${list}
      ${completedHtml}`;
    modal.appendChild(panel);
    modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove(); });
    document.getElementById('stage-wrap')?.appendChild(modal);
    panel.querySelector('#quests-close')?.addEventListener('click', () => modal.remove());
  }
  // ─── Quest dispatch ────────────────────────────────────────────────────
  // Called every wave-end + after every kill/combo. Iterates QUESTS, awards
  // rewards exactly once per quest, and pops a celebratory banner so the
  // player notices.
  function tickQuests() {
    ensureQuestState(state);
    const newly = evaluateQuests(state);
    for (const q of newly) grantQuestReward(q);
    // 2026-05-17 — Tier completion bonuses. After individual quest
    // rewards land, check whether a whole tier (or all 18) just closed
    // and pop a separate bonus banner with the gold reward.
    const newTiers = evaluateQuestTierBonuses(state);
    for (const tierKey of newTiers) grantQuestTierBonus(tierKey);
  }
  // Pays out the tier-completion gold bonus and pops a celebratory
  // banner. Hooks into the same toast stack the per-quest grants use,
  // but with louder copy so the player feels the milestone.
  function grantQuestTierBonus(tierKey: 'EARLY' | 'MID' | 'LATE' | 'ALL') {
    const amount = QUEST_TIER_BONUS[tierKey];
    earnGold(state, amount);
    const titles: Record<'EARLY' | 'MID' | 'LATE' | 'ALL', string> = {
      EARLY: 'EARLY-GAME QUESTS CLEARED',
      MID:   'MID-GAME QUESTS CLEARED',
      LATE:  'LATE-GAME QUESTS CLEARED',
      ALL:   'EVERY QUEST CLEARED — GRAND COMPLETION'
    };
    const lines: Record<'EARLY' | 'MID' | 'LATE' | 'ALL', string> = {
      EARLY: 'All six early-game quests done. The treasury rewards opening discipline.',
      MID:   'All six mid-game quests done. Real campaign currency for a real campaign run.',
      LATE:  'All six late-game quests done. Apex tier work, apex tier purse.',
      ALL:   'All 18 quests in the campaign. A legendary clear — capstone bonus paid.'
    };
    showQuestBanner(titles[tierKey], `+${amount}g`, lines[tierKey]);
    SFX.bossArrival();
  }
  function grantQuestReward(q: QuestDef) {
    const r = q.reward;
    let rewardLabel = '';
    let destination = '';
    if (r.kind === 'GOLD') {
      earnGold(state, r.amount ?? 0);
      rewardLabel = `+${r.amount}g`;
      destination = `Added directly to your treasury (now ${state.gold}g).`;
      SFX.bossArrival();
    } else if (r.kind === 'LIFE') {
      state.lives = Math.min(ECONOMY.MAX_LIVES, state.lives + (r.amount ?? 1));
      rewardLabel = `+${r.amount ?? 1} life`;
      destination = `Lives restored (now ${state.lives}/${ECONOMY.MAX_LIVES}).`;
      SFX.bossArrival();
    } else if (r.kind === 'ITEM' && r.item) {
      const itemName = r.item.replace(/_/g,' ').toLowerCase();
      const ok = inventoryAdd(inventory, r.item as any, 'RARE', false);
      if (ok) {
        rewardLabel = `+1 ${itemName}`;
        destination = `Placed in your INVENTORY — open it to equip on a tower.`;
        SFX.bossArrival();
      } else {
        rewardLabel = `+1 ${itemName}`;
        destination = `<span style="color:#ff5050">INVENTORY FULL</span> — sell something to make room, the item is forfeit.`;
      }
    } else if (r.kind === 'TOWER' && r.towerType && r.towerTier) {
      if (!state.pendingPurchasedTowers) state.pendingPurchasedTowers = [];
      state.pendingPurchasedTowers.push({ type: String(r.towerType), tier: r.towerTier, source: 'quest' });
      const total = state.pendingPurchasedTowers.length;
      rewardLabel = `+1 ${String(r.towerType).replace(/_/g,' ')} T${r.towerTier}`;
      destination = total > 1
        ? `Added to your TOWER QUEUE (${total} waiting). Click any empty grass tile to place the next one.`
        : `Added to your TOWER QUEUE. Click any empty grass tile to place it.`;
      SFX.comboExecuted();
    }
    showQuestBanner(q.title, rewardLabel, destination);
  }
  function showQuestBanner(title: string, rewardLabel: string, destination: string) {
    // Quest-completion toast (2026-05): moved to BOTTOM-RIGHT corner so it
    // never sits between the player and the play field. Compact card with
    // a slide-in from the right; click to dismiss; auto-dismiss after 5s.
    // Newer toasts push older ones up — same stacking behavior, just out
    // of the action area.
    document.getElementById('quest-toast-stack') ?? (() => {
      const stack = document.createElement('div');
      stack.id = 'quest-toast-stack';
      stack.style.cssText = `position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column-reverse;align-items:flex-end;gap:6px;z-index:64;pointer-events:none;`;
      document.getElementById('stage-wrap')?.appendChild(stack);
      return stack;
    })();
    const stack = document.getElementById('quest-toast-stack')!;
    const b = document.createElement('div');
    b.innerHTML = `
      <div style="font-size:10px;letter-spacing:3px;color:#88ff88;font-weight:bold;text-shadow:1px 1px 0 #000">✓ QUEST COMPLETE</div>
      <div style="margin-top:2px;font-size:13px;font-weight:bold;letter-spacing:1.5px;color:#ffd34d;text-shadow:2px 2px 0 #000">${title}</div>
      <div style="margin-top:4px;font-size:11px;font-weight:bold;letter-spacing:1px;color:#88ff88;text-shadow:1px 1px 0 #000">${rewardLabel}</div>
      <div style="margin-top:3px;font-size:9px;letter-spacing:0.3px;color:#cdb98a;line-height:1.4;max-width:260px">${destination}</div>`;
    b.style.cssText = `pointer-events:auto;cursor:pointer;width:min(280px,40vw);text-align:left;padding:8px 12px;background:linear-gradient(180deg,rgba(12,26,8,0.96),rgba(12,10,8,0.96));border:2px solid #88ff88;box-shadow:0 0 14px rgba(136,255,136,0.4);font-family:'Courier New',monospace;animation:questToastIn 0.35s ease-out;`;
    if (!document.getElementById('quest-toast-style')) {
      const s = document.createElement('style');
      s.id = 'quest-toast-style';
      s.textContent = `@keyframes questToastIn { 0% { opacity: 0; transform: translateX(40px); } 100% { opacity: 1; transform: translateX(0); } }`;
      document.head.appendChild(s);
    }
    b.addEventListener('click', () => b.remove(), { once: true });
    stack.appendChild(b);
    setTimeout(() => b.remove(), 5000);
  }
  // Periodic quest reminder. Points to the bottom-right panel + codex tab.
  function showQuestTip() {
    if (tipAlreadySeen('quest_tip')) return;
    const b = document.createElement('div');
    b.innerHTML = `
      <div style="font-size:14px;font-weight:bold;letter-spacing:3px;color:#88ff88;text-shadow:2px 2px 0 #000">📜 ROME IS WATCHING — QUESTS UNLOCKED</div>
      <div style="margin-top:6px;font-size:11px;letter-spacing:0.5px;color:#fff8e0;line-height:1.55">
        Click <b style="color:#88ff88">QUESTS</b> to see what the Senate expects of you today. Gold, items, even free towers — but only if you actually do the work.
      </div>
      <div style="margin-top:8px;font-size:9px;letter-spacing:1px;color:#aa9a4a">[ click to dismiss · won't show again ]</div>`;
    b.style.cssText = `width:min(420px,80%);text-align:center;padding:12px 18px;background:linear-gradient(180deg,#0c1a08,#0c0a08);border:2px solid #88ff88;box-shadow:0 0 22px rgba(136,255,136,0.45);font-family:'Courier New',monospace;text-shadow:1px 1px 0 #000;cursor:pointer;`;
    b.addEventListener('click', () => { markTipSeen('quest_tip'); }, { once: true });
    pushBanner(b, 5500);
  }
  // Pool-upgrade celebration banner. Highlights every concrete benefit
  // the player just unlocked so the rising upgrade cost feels earned.
  // POOL UPGRADE BANNER (2026-05): rewritten as a snappy stand-alone toast
  // instead of a queued banner. Consecutive upgrades replace each other
  // instantly — no waiting for the previous banner to time out — so the
  // interaction stays sharp when the player buys 3-4 levels in a row.
  // Lives independently of the main banner queue; auto-dismisses after a
  // short hold; CSS animations handle in/out for tactile feel.
  function showPoolUpgradeBanner(level: number, _rebate: number) {
    const probs = [
      [95,5,0,0,0],[70,20,8,2,0],[50,28,15,6,1],[32,30,22,12,4],[20,28,28,18,6],
      [12,22,30,26,10],[8,18,30,28,16],[5,14,28,32,21],[3,10,25,35,27],
      [2,7,22,38,31],[1,5,18,38,38]
    ];
    const row = probs[level] ?? probs[probs.length - 1];
    const dmgBonus = Math.max(0, level - 1) * 3;
    const TIER_COL = ['#aaaaaa','#b87333','#c0c0c0','#ffd34d','#ff5050'];
    const probsHtml = row.map((p, i) => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <div style="color:${TIER_COL[i]};font-weight:bold;font-size:11px">T${i+1}</div>
        <div style="color:#fff8e0;font-size:11px">${p}%</div>
      </div>`).join('');

    // One-time stylesheet for the snappy in/out animations.
    if (!document.getElementById('pool-toast-style')) {
      const s = document.createElement('style');
      s.id = 'pool-toast-style';
      s.textContent = `
        @keyframes poolToastIn {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
          60%  { transform: translate(-50%, -50%) scale(1.06); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes poolToastOut {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
        }
        @keyframes poolToastBump {
          0%   { transform: translate(-50%, -50%) scale(1); }
          40%  { transform: translate(-50%, -50%) scale(1.10); box-shadow: 0 0 38px rgba(255,211,77,0.85), inset 0 0 18px rgba(0,0,0,0.6); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }
      `;
      document.head.appendChild(s);
    }

    let toast = document.getElementById('pool-upgrade-toast') as HTMLElement | null;
    const isReplace = !!toast;
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pool-upgrade-toast';
      toast.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(460px,82%);text-align:center;padding:16px 22px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid #ffd34d;box-shadow:0 0 28px rgba(255,211,77,0.55),inset 0 0 18px rgba(0,0,0,0.6);font-family:'Courier New',monospace;z-index:75;pointer-events:none;animation:poolToastIn 200ms cubic-bezier(.2,1.4,.4,1) both;`;
      app.appendChild(toast);
    }
    toast.innerHTML = `
      <div style="font-size:17px;font-weight:bold;letter-spacing:4px;color:#ffd34d;text-shadow:2px 2px 0 #000,0 0 14px rgba(255,211,77,0.55)">★ POOL LEVEL ${level} ★</div>
      <div style="margin-top:10px;font-size:12px;color:#fff8e0;line-height:1.55;text-shadow:1px 1px 0 #000">
        ${dmgBonus > 0 ? `<span style="color:#88ff88">+${dmgBonus}% global tower damage</span>` : `<span style="color:#aabbdd">Better prospect rolls (damage bonus starts at L2)</span>`}
      </div>
      <div style="display:flex;justify-content:center;gap:14px;margin-top:10px;padding:8px;background:rgba(0,0,0,0.45);border:1px solid #5a4a30">
        ${probsHtml}
      </div>
      <div style="margin-top:8px;font-size:10px;color:#aa9a4a;letter-spacing:1px">new prospect tier weights — your draws just got better</div>`;

    // Consecutive upgrades: instead of waiting in a queue, pop the same
    // toast with a tight "bump" animation so the player feels each click
    // land instantly. Cancels any pending auto-dismiss timer first.
    if (isReplace) {
      toast.style.animation = 'poolToastBump 200ms ease-out';
      toast.getAnimations?.().forEach(a => { try { a.cancel(); a.play(); } catch {} });
    }
    const HOLD_MS = 1500;       // shorter than the old 4500ms — sharper feel
    const existingTimer = (toast as any).__hideTimer as number | undefined;
    if (existingTimer) clearTimeout(existingTimer);
    (toast as any).__hideTimer = window.setTimeout(() => {
      const el = document.getElementById('pool-upgrade-toast');
      if (!el) return;
      el.style.animation = 'poolToastOut 180ms ease-in forwards';
      setTimeout(() => el.remove(), 200);
    }, HOLD_MS);
  }
  function showFirstRoundBanner() {
    document.getElementById('first-round-banner')?.remove();
    const b = document.createElement('div');
    b.id = 'first-round-banner';
    b.innerHTML = `
      <div style="font-size:11px;letter-spacing:5px;color:#aa9a4a;font-weight:bold">⚔ ROME EXPECTS A LEGION ⚔</div>
      <div style="margin-top:6px;font-size:24px;font-weight:bold;letter-spacing:4px;color:#ffd34d;text-shadow:2px 2px 0 #000,0 0 18px rgba(255,211,77,0.55)">FORGE YOUR LEGION</div>
      <div style="margin-top:14px;font-size:13px;letter-spacing:0.5px;color:#fff8e0;line-height:1.7">
        Empty grass tile + click = <b style="color:#ffd34d">1 gold</b>, one random prospect tower. The dice don't care about your plan.
      </div>
      <div style="margin-top:14px;display:grid;grid-template-columns:32px 1fr;gap:10px 12px;text-align:left;font-size:11px;color:#cdb98a;line-height:1.55">
        <div style="color:#88ff88;font-size:18px;font-weight:bold;text-align:center">1</div>
        <div>Spam clicks. Build the maze. Bad rolls become walls — they're still doing work.</div>
        <div style="color:#88ff88;font-size:18px;font-weight:bold;text-align:center">2</div>
        <div>Click a glowing prospect → <b style="color:#ffd34d">KEEP</b>. You get <b style="color:#ffd34d">two per round.</b> Choose like the gate depends on it.</div>
        <div style="color:#88ff88;font-size:18px;font-weight:bold;text-align:center">3</div>
        <div>Press <b style="color:#ffd34d">START WAVE</b>. The unkept prospects cement into stone. The wave doesn't wait for confidence.</div>
      </div>
      <div style="margin-top:16px;font-size:11px;letter-spacing:1px;color:#cdb98a;background:rgba(255,80,80,0.08);border-left:3px solid #ff5050;padding:8px 10px;text-align:left;line-height:1.55">
        <b style="color:#ff5050">⚠ THIS GAME WILL HUMBLE YOU.</b> The <b style="color:#ffd34d">CODEX</b> has every recipe, every resistance, every survival rule. Read it now or learn the same lessons at the Hall of Glory later. Combinations are non-optional past wave 5.
      </div>
      <div style="margin-top:14px;font-size:10px;letter-spacing:2px;color:#aa9a4a">[ click anywhere when you're brave enough ]</div>`;
    b.style.cssText = `width:min(560px,86%);text-align:center;padding:22px 28px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid #ffd34d;box-shadow:0 0 36px rgba(255,211,77,0.55),inset 0 0 24px rgba(0,0,0,0.6);font-family:'Courier New',monospace;cursor:pointer;`;
    pushBanner(b, 0, { modal: true, clickDismiss: true });
  }
  // ─── FINAL HOUR HYPE — fires once at the start of W20's build phase ───
  // The player just cleared W19. They have ONE round to finalize their
  // legion before the Daemon Imperator walks onto the field. This is a
  // celebratory but lethal modal that names what's earned, what's at
  // stake, and what last-chance resources are still on the table. The
  // tone is "you actually made it — now don't ruin it." Voice rules:
  // confident, Roman, slightly mocking, no em dashes in player-facing
  // copy except where used as in-voice punctuation that already exists.
  function showFinalHourHype() {
    if (tipAlreadySeen('final_hour_hype')) return;
    document.getElementById('final-hour-hype')?.remove();
    const eff = Math.max(state.poolLevel, state.heroLevel);
    const poolNote = eff >= ECONOMY.POOL_MAX_LEVEL
      ? `<span style="color:#88ff88">Pool is MAXED — your rolls cannot get hotter.</span>`
      : `<span style="color:#ffd34d">Pool is L${eff}/${ECONOMY.POOL_MAX_LEVEL}.</span> One more upgrade swings every remaining roll.`;
    const goldNote = state.gold >= 50
      ? `<span style="color:#88ff88">Treasury looks healthy.</span>`
      : `<span style="color:#ff7766">Treasury thin — every gold piece matters now.</span>`;
    const livesNote = state.lives >= 15
      ? `<span style="color:#88ff88">Lives intact: ${state.lives}.</span>`
      : state.lives >= 8
        ? `<span style="color:#ffd34d">Lives: ${state.lives}. One boss leak costs 10 of those.</span>`
        : `<span style="color:#ff7766">Lives: ${state.lives}. He leaks once and you watch the leaderboard.</span>`;
    const b = document.createElement('div');
    b.id = 'final-hour-hype';
    b.innerHTML = `
      <div style="font-size:11px;letter-spacing:6px;color:#ff5050;font-weight:bold;text-shadow:0 0 8px #ff5050">⚔ ROME IS WATCHING ⚔</div>
      <div style="margin-top:8px;font-size:30px;font-weight:bold;letter-spacing:6px;color:#ffd34d;text-shadow:3px 3px 0 #000,0 0 22px #ffaa00cc;line-height:1.1">THE FINAL HOUR</div>
      <div style="margin-top:6px;font-size:14px;letter-spacing:3px;color:#fff8e0;font-weight:bold;text-shadow:1px 1px 0 #000">WAVE 20 · IMPERATOR OR COLUMN</div>

      <div style="margin-top:18px;font-size:13px;color:#fff8e0;line-height:1.7;text-shadow:1px 1px 0 #000;text-align:left;background:rgba(0,0,0,0.35);border-left:3px solid #ffd34d;padding:10px 14px">
        <b style="color:#ffd34d">Nineteen waves. Six bosses. You're still here.</b><br/>
        The Senate stopped writing speeches halfway through. The leaderboard sharpened its pen. The Daemon Imperator finished sharpening his.
      </div>

      <div style="margin-top:14px;padding:12px 14px;background:rgba(80,0,0,0.45);border:1px solid #ff5050;text-align:left">
        <div style="font-size:11px;letter-spacing:3px;color:#ff5050;font-weight:bold;margin-bottom:6px">⚔ WHAT WALKS ONTO THE FIELD</div>
        <div style="font-size:12px;color:#fff8e0;line-height:1.55;text-shadow:1px 1px 0 #000">
          <b style="color:#ff5050">Daemon Imperator</b> · TRUE solo arrival — no mobs, no escort, just the boss. 6× HP, base speed 0.85, 10 lives per leak, and a single leak ends the run (W20 LOCKDOWN).<br/>
          <b style="color:#ffaa55">HELLSCAPE</b> every 12s stuns your towers' cooldowns. <b style="color:#ffaa55">REBIRTH at 60% HP</b> into Wrathful: +90% speed, status-immune, 6s.<br/>
          <span style="color:#ff7766">Hellscape weather is already shortening your status durations 20%. There is no wave 21.</span>
        </div>
      </div>

      <div style="margin-top:12px;padding:12px 14px;background:rgba(0,40,0,0.35);border:1px solid #88ff88;text-align:left">
        <div style="font-size:11px;letter-spacing:3px;color:#88ff88;font-weight:bold;margin-bottom:6px">⏳ YOUR LAST ROUND OF DECISIONS</div>
        <div style="font-size:12px;color:#fff8e0;line-height:1.6;text-shadow:1px 1px 0 #000">
          ★ <b style="color:#ffd34d">Mercator visited last wave</b>. If you skipped him, you missed your last T5 buy.<br/>
          ★ <b style="color:#ffd34d">Gate Shop just refreshed</b> (W20 hits the cycle). Items now, or never.<br/>
          ★ ${poolNote}<br/>
          ★ ${goldNote} ${livesNote}<br/>
          ★ Every <b style="color:#ffd34d">prospect roll</b>, every <b style="color:#ffd34d">combine</b>, every <b style="color:#ffd34d">item slot</b> — last call. The wave does not wait for second thoughts.
        </div>
      </div>

      <div style="margin-top:12px;padding:10px 14px;background:rgba(60,40,0,0.35);border:1px solid #ffaa00;text-align:left">
        <div style="font-size:11px;letter-spacing:3px;color:#ffaa00;font-weight:bold;margin-bottom:6px">★ THE SPOILS, IF YOU WIN</div>
        <div style="font-size:12px;color:#fff8e0;line-height:1.55;text-shadow:1px 1px 0 #000">
          Survive and you take the rank — <b style="color:#88ddff">LEGATUS</b>, <b style="color:#ffd34d">IMPERATOR</b>, or <b style="color:#ff5050">DIVINUS</b> depending on lives left. The Hall of Glory keeps your name in gilt. Your towers eat the boss's gold and the Senate orders a parade. <span style="opacity:0.8;font-style:italic">A small one.</span>
        </div>
      </div>

      <div style="margin-top:18px;font-size:14px;letter-spacing:4px;font-weight:bold;color:#ffd34d;text-shadow:0 0 10px #ffaa00">⚔ GLORY OR THE COLUMN — YOU CHOOSE ⚔</div>
      <div style="margin-top:10px;font-size:10px;letter-spacing:2px;color:#aa9a4a">[ click anywhere when you're ready ]</div>`;
    b.style.cssText = `width:min(620px,92%);text-align:center;padding:24px 32px;background:radial-gradient(ellipse,#3a0808,#0c0a08 80%);border:4px solid #ffd34d;box-shadow:0 0 48px rgba(255,170,0,0.65),inset 0 0 32px rgba(0,0,0,0.7);font-family:'Courier New',monospace;cursor:pointer;`;
    b.addEventListener('click', () => { markTipSeen('final_hour_hype'); }, { once: true });
    pushBanner(b, 0, { modal: true, clickDismiss: true });
    SFX.bossArrival();
    // Subtle camera punch so it feels like the field acknowledges the moment.
    try { renderer.triggerShake(3, 0.35); } catch {}
  }

  // ─── W20 OVER-THE-TOP HP CALLOUT ────────────────────────────────────────
  // 2026-05-17 — When wave 20 actually starts (the player clicks past the
  // BossWarning gate and the Daemon Imperator walks onto the field), swap
  // the normal "BOSS APPROACHES" banner for a cartoonishly exaggerated HP
  // readout. The Daemon Imperator carries 100M baseHp × 6.0 wave hpMult =
  // 600M effective HP — comically large by tower-defense standards, and
  // the user wants the banner to acknowledge that publicly with humor.
  // The HP number counts up in a slot-machine reel while satirical
  // captions cycle ("ACTUALLY HOW MUCH?" → "YES, REALLY"). Auto-dismisses
  // after ~5.5s; the wave continues normally underneath.
  function showFinalBossHpBanner() {
    document.getElementById('boss-banner')?.remove();
    document.getElementById('final-boss-hp')?.remove();
    // Compute the actual display HP from data so it stays correct if the
    // designer retunes baseHp / hpMult later.
    const def: any = (enemiesData as any).DAEMON_IMPERATOR;
    const baseHp = def?.baseHp ?? 100000000;
    const waveDef: any = (wavesData as any[])[19]; // W20 = index 19
    const hpMult = waveDef?.hpMult ?? 6.0;
    const finalHp = Math.round(baseHp * hpMult);
    const portraitSrc = imgSrc(bossPortraitKey('SUPER_DEMONS') ?? '');
    // Inject one-shot style block (animations are unique to this banner).
    if (!document.getElementById('final-boss-hp-style')) {
      const s = document.createElement('style');
      s.id = 'final-boss-hp-style';
      s.textContent = `
        @keyframes fbhpHeadlinePulse {
          0%, 100% { color:#ffd34d; text-shadow:0 0 18px #ffd34d, 0 0 32px #ffaa33, 4px 4px 0 #000; }
          50%      { color:#ff5050; text-shadow:0 0 22px #ff5050, 0 0 40px #aa1010, 4px 4px 0 #000; }
        }
        @keyframes fbhpBossIn {
          0%   { opacity:0; transform:translateX(-180px) scale(0.4) rotate(-8deg); }
          55%  { transform:translateX(14px) scale(1.15) rotate(2deg); }
          100% { opacity:1; transform:translateX(0) scale(1) rotate(0); }
        }
        @keyframes fbhpBossSway {
          0%, 100% { transform:translate(0,0) rotate(0); }
          25%      { transform:translate(-4px,2px) rotate(-1.5deg); }
          75%      { transform:translate(4px,-2px) rotate(1.5deg); }
        }
        @keyframes fbhpNumberKick {
          0%   { transform:scale(0.7); opacity:0; filter:blur(8px); }
          60%  { transform:scale(1.18); filter:blur(0); }
          100% { transform:scale(1); opacity:1; filter:blur(0); }
        }
        @keyframes fbhpCaptionSwap {
          0%, 18%   { opacity:0; transform:translateY(8px); }
          22%, 78%  { opacity:1; transform:translateY(0); }
          82%, 100% { opacity:0; transform:translateY(-8px); }
        }
        @keyframes fbhpZeroFlash {
          0%, 100% { color:#fff8e0; text-shadow:0 0 12px #ffd34d, 3px 3px 0 #000; }
          50%      { color:#ff5050; text-shadow:0 0 24px #ff5050, 3px 3px 0 #000; }
        }
        @keyframes fbhpStripe {
          0% { background-position: 0 0; }
          100% { background-position: 80px 0; }
        }
        .fbhp-wrap {
          width:min(680px,94%);
          padding:22px 30px 18px;
          background:
            repeating-linear-gradient(135deg, rgba(0,0,0,0.0) 0 24px, rgba(255,170,0,0.06) 24px 48px),
            radial-gradient(ellipse,#3a0808,#0c0a08 80%);
          background-size: 80px 80px, auto;
          animation: fbhpStripe 3.6s linear infinite;
          border:4px solid #ffd34d;
          box-shadow:0 0 56px rgba(255,80,80,0.7), inset 0 0 32px rgba(0,0,0,0.75);
          font-family:'Courier New',monospace;
          text-align:center;
          color:#fff8e0;
        }
        .fbhp-eyebrow {
          font-size:11px; letter-spacing:6px; font-weight:bold; color:#ff5050;
          text-shadow:0 0 8px #ff5050;
        }
        .fbhp-headline {
          margin-top:6px; font-size:30px; font-weight:900; letter-spacing:6px;
          line-height:1.05;
          animation: fbhpHeadlinePulse 1.2s ease-in-out infinite;
        }
        .fbhp-portrait {
          margin:10px auto 4px; width:112px; height:112px;
          image-rendering:pixelated;
          filter:drop-shadow(0 0 16px rgba(255,80,80,0.85)) drop-shadow(3px 3px 0 #000);
          animation: fbhpBossIn 0.6s cubic-bezier(.2,1.5,.3,1) both, fbhpBossSway 2.2s ease-in-out 0.7s infinite;
        }
        .fbhp-bossname {
          font-size:22px; letter-spacing:6px; font-weight:900; color:#ee5050;
          text-shadow:0 0 12px #ee5050, 2px 2px 0 #000; margin-top:4px;
        }
        .fbhp-hp-block {
          margin:14px 0 6px; padding:14px 16px;
          background:rgba(0,0,0,0.55); border:2px dashed #ff5050;
        }
        .fbhp-hp-label {
          font-size:10px; letter-spacing:5px; color:#ffaa00; font-weight:900;
          text-shadow:1px 1px 0 #000;
        }
        .fbhp-hp-number {
          margin-top:6px;
          font-size:clamp(34px, 6vw, 56px); font-weight:900; letter-spacing:3px;
          color:#fff8e0;
          text-shadow:0 0 14px #ffd34d, 3px 3px 0 #000;
          animation: fbhpNumberKick 0.55s cubic-bezier(.2,1.6,.3,1) both;
          font-variant-numeric: tabular-nums;
        }
        .fbhp-hp-unit {
          margin-top:2px; font-size:13px; letter-spacing:5px; color:#ffd34d;
          font-weight:bold;
        }
        .fbhp-caption {
          margin-top:8px; font-size:14px; letter-spacing:3px; font-weight:900;
          color:#fff8e0; text-shadow:1px 1px 0 #000, 0 0 10px #ffaa00aa;
          min-height:1.4em;
          animation: fbhpCaptionSwap 1.8s ease-in-out infinite;
        }
        .fbhp-footer {
          margin-top:10px; font-size:10px; letter-spacing:4px; color:#aa9a4a;
        }
      `;
      document.head.appendChild(s);
    }
    const b = document.createElement('div');
    b.id = 'final-boss-hp';
    b.className = 'fbhp-wrap';
    const portraitHtml = portraitSrc
      ? `<img class="fbhp-portrait" src="${portraitSrc}" alt="Daemon Imperator"/>`
      : `<div class="fbhp-portrait" style="display:flex;align-items:center;justify-content:center;background:#1a0404;border:3px solid #aa1010;color:#ee5050;font-size:14px;letter-spacing:3px">BOSS</div>`;
    b.innerHTML = `
      <div class="fbhp-eyebrow">⚔ THE GATE OPENS ⚔</div>
      <div class="fbhp-headline">WAVE 20 — DAEMON IMPERATOR</div>
      ${portraitHtml}
      <div class="fbhp-bossname">EMPEROR OF THE NINTH PIT</div>
      <div class="fbhp-hp-block">
        <div class="fbhp-hp-label">⚠ HIT POINTS UNDER MANAGEMENT ⚠</div>
        <div class="fbhp-hp-number" id="fbhp-num">0</div>
        <div class="fbhp-hp-unit">HP · YES, REALLY</div>
      </div>
      <div class="fbhp-caption" id="fbhp-cap">HOW MUCH HEALTH DOES HE HAVE?</div>
      <div class="fbhp-footer">[ glory or the column · the wave begins ]</div>
    `;
    pushBanner(b, 5500, { modal: false });
    SFX.bossArrival();
    try { renderer.triggerShake(5, 0.6); } catch {}
    // ── Slot-reel HP counter — climbs through ~12 milestones, each kick
    //    is a satisfying tick. Final value lands at finalHp with a flash.
    const numEl = b.querySelector('#fbhp-num') as HTMLElement | null;
    const capEl = b.querySelector('#fbhp-cap') as HTMLElement | null;
    if (numEl) {
      const steps = [
        100, 5000, 50000, 250000, 1500000, 8000000,
        25000000, 60000000, 120000000, 250000000, 400000000, finalHp
      ].filter(v => v <= finalHp).concat([finalHp]);
      // De-dupe in case finalHp was already in the list.
      const uniq = Array.from(new Set(steps));
      let i = 0;
      const tick = () => {
        if (i >= uniq.length) {
          // Final flash — lock the number with a tinted color.
          numEl.style.color = '#ffd34d';
          numEl.style.animation = 'fbhpZeroFlash 0.9s ease-in-out infinite';
          return;
        }
        numEl.textContent = uniq[i].toLocaleString();
        // Re-trigger kick animation each step.
        numEl.style.animation = 'none';
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        numEl.offsetHeight; // force reflow
        numEl.style.animation = 'fbhpNumberKick 0.32s cubic-bezier(.2,1.6,.3,1) both';
        i++;
        if (i < uniq.length) setTimeout(tick, 220);
        else setTimeout(tick, 260);
      };
      tick();
    }
    if (capEl) {
      const captions = [
        'HOW MUCH HEALTH DOES HE HAVE?',
        'OK BUT ACTUALLY HOW MUCH?',
        'THAT CAN\'T BE RIGHT.',
        'IT IS RIGHT. WE CHECKED.',
        'SIX HUNDRED MILLION. ROUNDED DOWN.',
        'YOU\'RE GOING TO NEED EVERY TOWER.',
        'GLORY OR THE COLUMN — CHOOSE.'
      ];
      let ci = 0;
      capEl.textContent = captions[ci];
      const cycle = setInterval(() => {
        ci++;
        if (ci >= captions.length) { clearInterval(cycle); return; }
        capEl.textContent = captions[ci];
      }, 800);
    }
  }

  // PICK-KEEPER GUIDE — modal popup that fires whenever the player tries
  // to START WAVE while prospects are still pending decisions. Tells them
  // exactly what to do, names the keep count, and is dismissed with a
  // click. Renders fresh every time so the message reflects current keeps
  // remaining; doesn't use the "seen once" gate.
  function showPickKeeperGuide() {
    document.getElementById('pick-keeper-guide')?.remove();
    const keepsLeft = state.keepsRemainingThisRound ?? 2;
    const pendingCount = Array.from(state.towers.values()).filter(t => t.pending).length;
    const b = document.createElement('div');
    b.id = 'pick-keeper-guide';
    b.innerHTML = `
      <div style="font-size:11px;letter-spacing:6px;color:#ffd34d;font-weight:bold;text-shadow:0 0 8px #ffaa00">⚠ THE SENATE INTERRUPTS YOU ⚠</div>
      <div style="margin-top:8px;font-size:22px;font-weight:bold;letter-spacing:4px;color:#fff8e0;text-shadow:2px 2px 0 #000,0 0 14px #ffaa00cc">PICK YOUR PROSPECTS</div>
      <div style="margin-top:14px;font-size:13px;font-weight:bold;color:#fff8e0;line-height:1.65;text-shadow:1px 1px 0 #000;text-align:left;background:rgba(0,0,0,0.45);border-left:3px solid #ffd34d;padding:10px 14px">
        You have <b style="color:#ffd34d">${pendingCount} glowing prospect${pendingCount === 1 ? '' : 's'}</b> on the field waiting for a verdict.<br/>
        You get <b style="color:#88ff88">${keepsLeft}</b> keep${keepsLeft === 1 ? '' : 's'} this round.
      </div>
      <div style="margin-top:14px;font-size:12px;color:#cdb98a;line-height:1.65;text-shadow:1px 1px 0 #000;text-align:left;background:rgba(40,40,40,0.45);border:1px dashed #5a4a30;padding:10px 14px">
        <b style="color:#88ff88">HOW TO PICK:</b><br/>
        ★ Click any glowing prospect tower on the field.<br/>
        ★ Press the <b style="color:#ffd34d">KEEP</b> button that appears.<br/>
        ★ Anything you don't keep cements into a stone wall — still useful for the maze.<br/>
        ★ Want them ALL to become walls? Click <b style="color:#ffd34d">"CEMENT ALL"</b> below to commit without keeping anything.
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:center">
        <button id="pkg-pick" style="background:#3a5520;color:#e8d6a8;border:2px solid #88ff88;padding:8px 18px;cursor:pointer;font-family:'Courier New',monospace;font-size:12px;font-weight:bold;letter-spacing:2px">PICK NOW</button>
        <button id="pkg-cement" style="background:#3a2010;color:#cdb98a;border:2px solid #7a5a1a;padding:8px 18px;cursor:pointer;font-family:'Courier New',monospace;font-size:12px;font-weight:bold;letter-spacing:2px">CEMENT ALL &amp; START</button>
      </div>`;
    b.style.cssText = `width:min(560px,90%);text-align:center;padding:22px 28px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid #ffd34d;box-shadow:0 0 36px rgba(255,170,0,0.55),inset 0 0 24px rgba(0,0,0,0.6);font-family:'Courier New',monospace;`;
    pushBanner(b, 0, { modal: true, clickDismiss: false });
    // Wire the two action buttons. Both dismiss the banner; the PICK button
    // just closes so the player can click a prospect; CEMENT crystallizes
    // every pending prospect into stone walls and then starts the wave.
    setTimeout(() => {
      const pickBtn = document.getElementById('pkg-pick');
      const cementBtn = document.getElementById('pkg-cement');
      if (pickBtn) pickBtn.onclick = (ev) => {
        ev.stopPropagation();
        b.remove();
        // Force-process the queue so the next banner (if any) shows.
        processBannerQueue();
      };
      if (cementBtn) cementBtn.onclick = (ev) => {
        ev.stopPropagation();
        crystallizeAll();
        b.remove();
        processBannerQueue();
        // Re-fire the start-wave action so the wave actually launches now
        // that no prospects are pending. Mimics a second SPACE press.
        const startBtn = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent?.includes('START WAVE')) as HTMLButtonElement | undefined;
        startBtn?.click();
      };
    }, 0);
  }

  function snapshotBuildPhase() {
    buildPhaseSnapshot = {
      tiles: state.tiles.map(row => row.slice()),
      towers: Array.from(state.towers.entries()).map(([id, t]) => [id, { ...t, equippedItems: [...t.equippedItems], builtFrom: [...t.builtFrom] }]),
      gold: state.gold,
      score: state.score,
      lives: state.lives,
      goldTowerCount: state.goldTowerCount,
      poolLevel: state.poolLevel,
      hasKeptAnyTowerEver: state.hasKeptAnyTowerEver,
      keepsRemainingThisRound: state.keepsRemainingThisRound,
      inventory: inventory.slots.map(s => ({ ...s }))
    };
  }
  function restoreBuildPhase() {
    if (!buildPhaseSnapshot) { state.hint = 'Nothing to reset to. The empire does not forget that easily.'; return false; }
    const s = buildPhaseSnapshot;
    state.tiles = s.tiles.map((row: number[]) => row.slice());
    state.towers.clear();
    for (const [id, t] of s.towers) state.towers.set(id, { ...t, equippedItems: [...t.equippedItems], builtFrom: [...t.builtFrom] });
    state.gold = s.gold;
    state.score = s.score;
    state.lives = s.lives;
    state.goldTowerCount = s.goldTowerCount;
    state.poolLevel = s.poolLevel;
    state.hasKeptAnyTowerEver = s.hasKeptAnyTowerEver;
    state.keepsRemainingThisRound = s.keepsRemainingThisRound ?? 1;
    inventory.slots = s.inventory.map((it: any) => ({ ...it }));
    state.prospectQueue = [];
    state.prospectsPlaced = 0;
    state.phase = GamePhase.BUILD_PHASE;
    undoStack.length = 0;
    state.hint = 'Build phase reset. The Senate hopes you make better choices this time.';
    const np = buildGroundPath(state); if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
    return true;
  }
  rollProspects();
  snapshotBuildPhase();

  // Player chose to KEEP one of the pending towers. The chosen one becomes permanent.
  // If they still have keeps left this round (e.g. first-round starter bonus = 2),
  // remaining prospects stay pending and the player can pick another. Once keeps
  // are exhausted, every other pending tower converts to a STONE wall.
  function keepPending(keepId: string) {
    const keeper = state.towers.get(keepId);
    if (!keeper || !keeper.pending) return;
    keeper.pending = false;
    keeper.placedAtWave = state.wave;
    if (keeper.isAerarium) state.goldTowerCount += 1;
    state.hasKeptAnyTowerEver = true;
    state.keepsRemainingThisRound = Math.max(0, state.keepsRemainingThisRound - 1);
    // 2026-05 v11: user-supplied keep bumper SFX (replaces the synth chime).
    SFX.prospectKeep();

    if (state.keepsRemainingThisRound > 0 && hasPendingTowers()) {
      // More keeps remaining. Important: if the player still has cards in
      // the prospect queue (i.e. they kept mid-placement before clicking
      // out all 10 tiles), stay in PROSPECT_PLACEMENT so they can keep
      // placing. Only switch to PICK_KEEPER when the queue is fully
      // drained — that's the natural "pick from what's on the field" phase.
      const hasMoreCardsToPlace = state.prospectQueue.length > 0;
      state.phase = hasMoreCardsToPlace ? GamePhase.PROSPECT_PLACEMENT : GamePhase.PICK_KEEPER;
      state.hint = hasMoreCardsToPlace
        ? `Kept ${towerName(keeper.type)} T${keeper.qualityTier}. Keep placing — ${state.prospectQueue.length} card${state.prospectQueue.length === 1 ? '' : 's'} left, ${state.keepsRemainingThisRound} more keep${state.keepsRemainingThisRound === 1 ? '' : 's'} available.`
        : `Kept ${towerName(keeper.type)} T${keeper.qualityTier}. Pick ${state.keepsRemainingThisRound} more (or START WAVE to skip).`;
      const np = buildGroundPath(state);
      if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
      return;
    }

    // Keeps exhausted: convert every still-pending tower into a wall stone.
    for (const t of Array.from(state.towers.values())) {
      if (t.pending && t.id !== keepId) {
        state.towers.delete(t.id);
        setTile(state, t.tileX, t.tileY, TileType.STONE);
      }
    }
    state.hint = `Kept ${towerName(keeper.type)} T${keeper.qualityTier}. The rejected prospects are now load-bearing.`;
    state.phase = GamePhase.BUILD_PHASE;
    const np = buildGroundPath(state);
    if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
  }
  // CRYSTALLIZE fallback: turn all pending prospects into walls (free) without picking one.
  function crystallizeAll() {
    for (const t of Array.from(state.towers.values())) {
      if (t.pending) {
        state.towers.delete(t.id);
        setTile(state, t.tileX, t.tileY, TileType.STONE);
      }
    }
    // Also clear any unrevealed prospects in queue
    state.prospectQueue = [];
    state.phase = GamePhase.BUILD_PHASE;
    state.hint = 'Every prospect cemented into stone. Their service was brief but architectural.';
    const np = buildGroundPath(state); if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
  }
  function hasPendingTowers(): boolean {
    for (const t of state.towers.values()) if (t.pending) return true;
    return false;
  }
  function isPreWavePhase(): boolean {
    return state.phase === GamePhase.BUILD_PHASE ||
      state.phase === GamePhase.PROSPECT_PLACEMENT ||
      state.phase === GamePhase.PICK_KEEPER;
  }
  // 2026-05-15 v3 (Sell Stones multi-select): re-skin the SELL STONES
  // button based on whether the player is in stone-selection mode + how
  // many stones are currently selected. Idle state shows the rocky
  // "🪨 SELL STONES"; selection mode shows "✓ CONFIRM SELL (N · +Ng)"
  // with a cyan accent so it reads as the commit action. Called from
  // the onSellAllStones handler whenever mode or selection changes.
  function updateSellStonesButton() {
    const btn = document.getElementById('sell-stones-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const m: any = state as any;
    if (m.__sellStoneMode) {
      const sel: Set<string> = m.__sellStoneSelection ?? new Set<string>();
      const refund = sel.size * (ECONOMY.STONE_COST ?? 1);
      btn.textContent = sel.size > 0
        ? `✓ CONFIRM SELL · ${sel.size} stone${sel.size === 1 ? '' : 's'} (+${refund}g)`
        : '✓ CONFIRM SELL · click stones first';
      btn.style.background = sel.size > 0 ? '#10243a' : '#222';
      btn.style.color = '#9be0ff';
      btn.style.border = '2px solid #9be0ff';
      btn.style.fontWeight = 'bold';
      btn.style.letterSpacing = '1px';
    } else {
      btn.textContent = '🪨 SELL STONES';
      btn.style.background = '#222';
      btn.style.color = '';
      btn.style.border = '';
      btn.style.fontWeight = '';
      btn.style.letterSpacing = '';
    }
  }
  // Kept for reference but no longer wired — prospect placement is locked.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function undoProspect(towerId: string) {
    const tw = state.towers.get(towerId);
    if (!tw || !tw.pending) return;
    if (state.phase !== GamePhase.PROSPECT_PLACEMENT && state.phase !== GamePhase.PICK_KEEPER) return;
    // Return the prospect's card to the FRONT of the queue and clear the tile.
    const restoredCard: DrawCard = { type: tw.type, tier: tw.qualityTier };
    if ((tw as any).duplicateBumped) (restoredCard as any).__duplicateBumped = (tw as any).duplicateBumped;
    state.towers.delete(towerId);
    setTile(state, tw.tileX, tw.tileY, TileType.EMPTY);
    state.prospectQueue.unshift(restoredCard);
    state.prospectsPlaced = Math.max(0, state.prospectsPlaced - 1);
    state.phase = GamePhase.PROSPECT_PLACEMENT;
    selectedTowerId = null;
    renderer.selectedTowerId = null;
    const np = buildGroundPath(state);
    if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
    state.hint = `Returned ${towerName(tw.type)} T${tw.qualityTier} to the queue. Click another empty tile to place it.`;
  }
  function executeCombineFromMenu(recipeIndex: number, isSameTierMerge: boolean, resultTileTowerId: string) {
    const combos = scanCombos(state);
    const target = combos.find(cb =>
      (isSameTierMerge ? !!cb.isSameTierMerge : cb.recipeIndex === recipeIndex)
      && cb.ingredients.some(ing => ing.id === resultTileTowerId)
    );
    if (!target) { state.hint = 'That combination slipped away. The pieces moved.'; return; }
    // Snapshot ingredient IDs BEFORE executing so we can scrub stale
    // undo/placement metadata after the towers are deleted. Without this
    // scrub, `placementUndo` held dead IDs that referenced towers no
    // longer in `state.towers`, and the older `undoStack` closures
    // could try to restore them — producing the "random things break
    // and change later in the game" symptom.
    const ingredientIds = target.ingredients.map(i => i.id);
    // Snapshot the result tile coords BEFORE executeCombo mutates ingredient
    // state — we need them for the tier-up shimmer below if this is a merge.
    const resultIngr = target.ingredients.find(i => i.id === resultTileTowerId) ?? target.ingredients[0];
    const shimmerX = resultIngr.tileX * 32 + 16;
    const shimmerY = resultIngr.tileY * 32 + 16;
    const isMergeShimmer = !!target.isSameTierMerge;
    const ok = executeCombo(state, target, resultTileTowerId);
    if (ok) {
      // TIER-UP SHIMMER (2026-05 v6 polish): on a same-tier 3-of-a-kind
      // merge, fire a 2-pulse golden ring at the result tile so the
      // player sees the ladder step land. Two staggered impactRings
      // (one immediate, one +80ms) give a satisfying "tier-up clink"
      // beat. Cross-unit recipes already have the comboFxQueue
      // emergence animation, so we only shimmer for the merge case.
      if (isMergeShimmer && renderer?.triggerImpactRing) {
        renderer.triggerImpactRing(shimmerX, shimmerY, state.tick, 30, 0xffd34d);
        renderer.triggerImpactRing(shimmerX, shimmerY, state.tick + 0.08, 48, 0xffe88c);
        // A sparkle column of 6 gold particles arcing upward from the
        // tile. Reuses the gore particle pool — capped, no new allocs.
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
          const sp = 70 + Math.random() * 60;
          gore.particles.push({
            x: shimmerX + (Math.random() - 0.5) * 8,
            y: shimmerY,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.55 + Math.random() * 0.25,
            size: 2 + Math.random() * 1.5,
            color: 0xffd34d
          });
        }
      }
      // Scrub any placementUndo entries for ingredients that no longer
      // exist. (The result tower keeps its own placementUndo only if it
      // already had one — combos don't create new placementUndo entries.)
      for (const id of ingredientIds) placementUndo.delete(id);
      // Combos are committed actions — past undo entries that reference
      // consumed ingredients are now invalid. Drop the entire stack so
      // we never replay a closure against a deleted tower.
      undoStack.length = 0;
      // 2026-05 v11: user-supplied combo SFX (replaces the synth fanfare).
      SFX.comboMade();
      // Drain any leftover items from the combine into the inventory. If
      // inventory is full, the rest are silently lost (consistent with the
      // existing "INVENTORY FULL" pattern from quest item rewards).
      const leftover = (state as any).__leftoverItemsFromCombo as string[] | undefined;
      if (leftover && leftover.length > 0) {
        let returned = 0;
        for (const item of leftover) {
          // Pull the real rarity from the item definition instead of
          // force-tagging everything as RARE — a leftover Legendary used
          // to come back as Rare, which broke sell-prices and merchant
          // display later in the run.
          const def: any = (itemsData as any)[item];
          const rarity = (def?.rarity as any) ?? 'COMMON';
          const ok2 = inventoryAdd(inventory, item as any, rarity, false);
          if (ok2) returned++;
          else break;
        }
        (state as any).__leftoverItemsFromCombo = [];
        if (returned > 0) state.hint = `Combined! ${returned} extra item${returned > 1 ? 's' : ''} returned to inventory.`;
      }
      // Quest tracking: count combos built (cross-cutting) + unique combo
      // result types so the "Diverse Legions" quest fires correctly.
      state.combosBuilt = (state.combosBuilt ?? 0) + 1;
      if (!state.combosBuiltUniqueTypes) state.combosBuiltUniqueTypes = [];
      const resultType = String(target.result);
      if (!state.combosBuiltUniqueTypes.includes(resultType)) state.combosBuiltUniqueTypes.push(resultType);
      // CRITICAL: rebuild the ground path BEFORE redrawing terrain. drawStatic
      // reads state.groundPath to decide where the dirt-path tiles render —
      // if we redraw before rebuilding, dirt sprites paint along the old
      // path while the new tower-converted-to-stone layout disagrees, and
      // the result is the "brown sprites everywhere" terrain glitch.
      const np = buildGroundPath(state);
      if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
      renderer.drawStatic(state);
    }
  }
  function inspectTower(tw: any) {
    selectedTowerId = tw.id;
    renderer.selectedTowerId = tw.id;
    showTowerMenu(app, tw, state, inventory, {
      onClose: () => document.getElementById('tower-menu')?.remove(),
      onPathRefresh: () => { const np = buildGroundPath(state); if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); } },
      onKeep: (id) => keepPending(id),
      onUndoPlacement: placementUndo.has(tw.id) ? undoTowerPlacement : undefined,
      // Prospect placement supports free undo — clicking UNDO on a pending
      // prospect returns the SAME tower card to the front of the queue, so
      // misclicks don't cost the player. The RNG is NOT re-rolled (the card
      // type and tier stay identical), only the tile commitment is undone.
      // Only available while still in PROSPECT_PLACEMENT / PICK_KEEPER.
      onUndoProspect: tw.pending ? undoProspect : undefined,
      // Combine is now available on PENDING prospects too — if a lucky
      // prospect-round roll happens to satisfy a recipe, the player can
      // combine the prospects directly into the resulting tower (which
      // becomes a kept tower, counts as a "win" of the round).
      onCombine: (state.phase === GamePhase.BUILD_PHASE
                  || state.phase === GamePhase.PROSPECT_PLACEMENT
                  || state.phase === GamePhase.PICK_KEEPER)
        ? executeCombineFromMenu : undefined
    });
  }
  function undoTowerPlacement(towerId: string) {
    const rec = placementUndo.get(towerId);
    const tw = state.towers.get(towerId);
    if (!rec || !tw || state.phase !== GamePhase.BUILD_PHASE) {
      state.hint = 'That tower has signed the legion contract. No takebacks.';
      return;
    }
    if (tw.killCount > 0 || tw.builtFrom.length > 0) {
      state.hint = 'Veterans and combined towers earned their tile. They are not leaving.';
      return;
    }
    if (tw.equippedItems.length > 0) {
      state.hint = 'Strip the items off this tower first. The Senate insists.';
      return;
    }
    state.towers.delete(towerId);
    setTile(state, rec.col, rec.row, TileType.EMPTY);
    if (tw.isAerarium) state.goldTowerCount = Math.max(0, state.goldTowerCount - 1);
    earnGold(state, rec.cost);
    state.draw.splice(Math.min(rec.index, state.draw.length), 0, rec.card);
    placementUndo.delete(towerId);
    selectedTowerId = null;
    renderer.selectedTowerId = null;
    const np = buildGroundPath(state);
    if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
    state.hint = `Undid ${towerName(tw.type)} T${tw.qualityTier}. Card returned.`;
    document.getElementById('tower-menu')?.remove();
  }
  function inspectStone(col: number, row: number) {
    if (!isPreWavePhase()) { state.hint = 'No demolishing walls mid-battle. The empire pays for cohesion.'; return; }
    showStoneMenu(app, col, row, state, {
      onClose: () => document.getElementById('stone-menu')?.remove(),
      onSell: () => {
        setTile(state, col, row, TileType.EMPTY);
        earnGold(state, ECONOMY.STONE_COST);
        const np = buildGroundPath(state);
        if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
        state.hint = `Sold stone (+${ECONOMY.STONE_COST}g).`;
        document.getElementById('stone-menu')?.remove();
      }
    });
  }

  // ─── 70s ARCADE BOOT SEQUENCE ────────────────────────────────────────
  // 2026-05 v10 — LOADING SCREEN MUSIC. The FF7 victory fanfare loops
  // while the loading screen is visible. Most browsers block autoplay
  // before any user gesture, so we attach a one-shot pointerdown
  // listener at document level that primes the music on first
  // interaction. The fanfare also gets a direct attempt right away —
  // if the browser allows it (often the case after a recent gesture
  // on the page, e.g. tab activation), it plays immediately.
  const LOADING_MUSIC_URL = sfx('assets/sfx/ff7_victory_fanfare.mp3');
  // 2026-05-18 v4 — AUDIBLE-AUTOPLAY-FIRST strategy. Most users
  // reaching this page have prior engagement with the falatua.github.io
  // origin (they followed a link, used a bookmark, or it's a return
  // visit), which means Chrome's Media Engagement Index has accumulated
  // and audible autoplay will succeed on the first .play() call. The
  // user hears the fanfare the instant the loading screen renders, no
  // gesture required.
  //
  // playMusicTrack's internal fallback handles the cold-load case: if
  // audible play() is rejected (NotAllowedError, brand-new visitor in
  // incognito with zero MEI), it automatically retries with muted=true.
  // The audio still streams silently, and the unmute primers below
  // flip it audible on the first user gesture (mousemove / click /
  // key / touch / focus) with currentTime=0 so they hear the song
  // from the beginning. Both paths land at "song plays as fast as
  // browser policy allows."
  playMusicTrack('loading', LOADING_MUSIC_URL, {
    loop: true,
    gain: 0.55
  });
  // Primer net: any sign of user presence flips muted -> unmuted +
  // rewinds to 0 so the player hears the song from the start.
  //   • mousemove   — most desktop users (cursor enters the page)
  //   • pointerdown — covers users who click without moving mouse
  //   • keydown     — keyboard-only / tab-into users
  //   • touchstart  — mobile / tablet
  //   • focus       — tab regains focus
  //   • visibilitychange — tab becomes visible
  // All { once: true } so each fires at most once and self-removes.
  const primeLoadingMusic = () => {
    unmuteAndRestartMusicTrack('loading');
  };
  document.addEventListener('mousemove', primeLoadingMusic, { once: true, passive: true });
  document.addEventListener('pointerdown', primeLoadingMusic, { once: true });
  document.addEventListener('keydown', primeLoadingMusic, { once: true });
  document.addEventListener('touchstart', primeLoadingMusic, { once: true, passive: true });
  window.addEventListener('focus', primeLoadingMusic, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') primeLoadingMusic();
  }, { once: true });

  // 2026-05-17 — Preload every mp3 SFX in parallel during the loading
  // screen. Without this, the first time each unique sound plays the
  // browser has to fetch + decode it (100-500ms latency on the public
  // CDN), so combat ticks, prospect placements, wave starts etc. feel
  // delayed for new players. After preload the cache is hot and every
  // call plays instantly. Fire-and-forget — if anything fails we still
  // fall back to synth tones for missing samples.
  void preloadAllSamples();

  // Loading copy: rotating, self-aware, slightly menacing one-liners.
  // Typewriter-effect each line in, hold ~2.4s, then move on. The list
  // loops until assets finish AND the player clicks the coin slot.
  const LOADING_COPY = [
    'LOADING YOUR INEVITABLE DEFEAT...',
    'WARNING: THIS GAME HAS HUMBLED GENERALS',
    'ROME WAS NOT BUILT IN A DAY. YOUR DEFENSE WILL FALL FASTER.',
    'PREPARING 20 WAVES OF PAIN',
    'SHARPENING ENEMY SWORDS... PLEASE WAIT',
    'NO REFUNDS. NO MERCY. NO EASY MODE.',
    'CALCULATING HOW BADLY YOU WILL LOSE',
    'THE LEGION IS COMING. ARE YOU READY? (HINT: YOU ARE NOT)',
    'LOADING COMPLEXITY YOU DID NOT ASK FOR',
    'STRATEGY REQUIRED. LUCK WILL NOT SAVE YOU.',
    'BRIBING THE PATHFINDER... PLEASE WAIT',
    'TEACHING THE BARBARIANS TO READ YOUR MAZE',
    'IMPORTING 27 RECIPES YOU WILL FORGET',
    'THE CODEX IS LONGER THAN YOUR PATIENCE',
    'POLISHING THE GATE YOU WILL FAIL TO HOLD'
  ];
  const copyEl  = document.getElementById('loading-copy') as HTMLElement | null;
  const barEl   = document.getElementById('loading-bar') as HTMLElement | null;
  const slotWrap = document.getElementById('loading-coinslot-wrap') as HTMLElement | null;
  const slotEl   = document.getElementById('loading-coinslot') as HTMLElement | null;
  const coinHint = document.getElementById('loading-coin-hint') as HTMLElement | null;

  // Typewriter helper — writes `text` into el char-by-char.
  let typewriterAbort = false;
  async function typeInto(el: HTMLElement, text: string, perCharMs = 22) {
    el.classList.add('typing');
    el.textContent = '';
    for (let i = 0; i < text.length; i++) {
      if (typewriterAbort) break;
      el.textContent = text.slice(0, i + 1);
      await new Promise(r => setTimeout(r, perCharMs));
    }
    el.classList.remove('typing');
  }
  // Spin the rotating copy in the background. We don't await it — the
  // outer flow awaits asset loading then waits on the coin click.
  let copyLoopAlive = true;
  (async () => {
    let i = 0;
    while (copyLoopAlive && copyEl) {
      const line = LOADING_COPY[i % LOADING_COPY.length];
      await typeInto(copyEl, line);
      // Hold for a beat, then erase for the next line.
      await new Promise(r => setTimeout(r, 1600));
      if (!copyLoopAlive) break;
      i++;
    }
  })();

  await loadAllAssets((loaded, total) => {
    const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
    if (barEl) barEl.style.width = `${pct}%`;
  });

  // Assets are in — reveal the coin slot and hand off to the player.
  if (slotWrap) slotWrap.classList.add('ready');
  if (barEl) barEl.style.width = '100%';
  // 2026-05-17 — JAMMED COIN SLOT MINI-GAME.
  // The coin requires 10 clicks to be hammered into the slot. Each
  // click nudges the coin down a fraction and shakes the cabinet a
  // beat. The cabinet's loading fanfare keeps playing UNDISTURBED in
  // the background (no rewind, no replay) — the player hears one
  // continuous song while they whack the coin.
  //
  // Sound policy (per user feedback 2026-05-17):
  //   • Clicks 1-9: silent except for the cabinet rattle animation.
  //     No coin SFX, no music primer call. The visual jolt + new
  //     taunt copy is the feedback.
  //   • Click 10: SFX.coinSlot() fires once on commit. The big "coin
  //     drops in" payoff sound lands only when the coin actually
  //     goes in.
  //
  // Taunt policy: each of the 9 pre-commit clicks shows a UNIQUE
  // taunt in sequence (no repeats, no random pulls). The arc walks
  // from polite-explanation to mock-frustration so the player feels
  // the cabinet getting more annoyed with every whack.
  const JAM_TAUNTS = [
    'The coin slot is JAMMED. Whack it, soldier.',
    'Some idiot crammed a coin in sideways. Try the slot again.',
    'The Senate has not fixed this cabinet since the Punic Wars. Keep hitting.',
    'This machine has eaten more coins than a Carthaginian quartermaster. One more.',
    'Smack it like you mean it, citizen.',
    'The Aerarium cut maintenance from the budget. YOU are the maintenance now.',
    'Are you Roman or are you Greek? Hit the slot harder.',
    'Hannibal\'s elephants were easier to move than this coin. Press on.',
    'One last whack. The coin can smell glory. So can you.'
  ];
  const COIN_SLOT_CLICKS_REQUIRED = 10;
  await new Promise<void>(resolve => {
    if (!slotEl) { resolve(); return; }
    let clicks = 0;
    // Stash the coin's starting Y position so each click can lerp it
    // down by a fraction of the total distance to the slit.
    const insertEl = document.getElementById('loading-insert');
    const coinJamHandler = () => {
      clicks++;
      // 2026-05-17 — Do NOT call primeLoadingMusic() here. The
      // document-level pointerdown primer (registered with
      // { once: true } in the music boot block above) ALREADY fires
      // before this click handler runs and unmutes the track from t=0.
      // Calling it again on every click rewinds currentTime to 0,
      // which interrupts the song the player is enjoying. The
      // listener removes itself after firing once, so we don't need
      // to do anything here for music.
      //
      // 2026-05-17 — Coin SFX moved out of the per-click branch. It
      // now fires ONLY on the 10th-click commit (see below) so the
      // pre-commit whacks rely on the visual jolt for feedback.
      // Brief cabinet jitter on each whack so the player feels feedback.
      loadingEl.classList.remove('jolt');
      // Force reflow so the animation restarts even on rapid clicks.
      void loadingEl.offsetWidth;
      loadingEl.classList.add('jolt');
      if (clicks < COIN_SLOT_CLICKS_REQUIRED) {
        // Lerp the coin downward — each click closes 1/10th of the gap
        // to the slit. CSS uses the --coin-progress custom property to
        // translate the coin Y position.
        const progress = clicks / COIN_SLOT_CLICKS_REQUIRED;
        if (coinHint) {
          (coinHint as HTMLElement).style.setProperty('--coin-progress', String(progress));
        }
        // Update the insert-coin label with the SEQUENTIAL taunt for
        // this click number. JAM_TAUNTS has exactly 9 entries — one
        // per pre-commit click (clicks 1..9 → indices 0..8).
        if (insertEl) {
          const taunt = JAM_TAUNTS[clicks - 1] ?? JAM_TAUNTS[JAM_TAUNTS.length - 1];
          insertEl.textContent = `▶ ${taunt} ◀  (${clicks}/${COIN_SLOT_CLICKS_REQUIRED})`;
        }
        return;       // not yet committed — wait for more clicks
      }
      // Final hit — commit the coin and transition into the game.
      slotEl.removeEventListener('click', coinJamHandler);
      if (insertEl) insertEl.textContent = '▶ COIN ACCEPTED — GLORY AWAITS ◀';
      // User-supplied coin-slot SFX — fires on commit, on top of the
      // visual coin-drop + shake + warp.
      SFX.coinSlot();
      // Stop the FF7 fanfare loop the moment the coin commits.
      stopMusicTrack('loading');
      // Clean up every primer listener (mousemove / pointerdown / keydown
      // / touchstart / focus). visibilitychange uses an inline arrow so
      // it can't be removed by reference, but it's { once: true } so it
      // self-removes after firing once.
      document.removeEventListener('mousemove', primeLoadingMusic);
      document.removeEventListener('pointerdown', primeLoadingMusic);
      document.removeEventListener('keydown', primeLoadingMusic);
      document.removeEventListener('touchstart', primeLoadingMusic);
      window.removeEventListener('focus', primeLoadingMusic);
      // 1) Coin drops into the slot.
      if (coinHint) coinHint.classList.add('dropping');
      // 2) Immediate screen shake — cabinet just got hit.
      setTimeout(() => {
        loadingEl.classList.add('shake');
      }, 380);
      // 3) After the shake settles, zoom-warp into the game.
      setTimeout(() => {
        loadingEl.classList.remove('shake');
        loadingEl.classList.add('warp');
        copyLoopAlive = false;
        typewriterAbort = true;
      }, 900);
      // 4) Once the warp keyframe finishes, tear the screen down.
      setTimeout(() => {
        loadingEl.classList.add('hidden');
        setTimeout(() => loadingEl.remove(), 200);
        resolve();
      }, 1620);
    };
    slotEl.addEventListener('click', coinJamHandler);
  });
  // ─── Auto-scale stage to viewport ─────────────────────────────────────
  // 2026-05-15 v8: now scales UP as well as DOWN. Previously the scale was
  // capped at 1.0 (`Math.min(1, vw/w, vh/h)`), so on a 1440p+/ultra-wide
  // monitor the game would render at its natural 1216×832 canvas size with
  // huge black gutters on either side. The user explicitly wants the map
  // to fill the visible window — small window → small game, big window →
  // big game, map always the priority. We now compute the largest scale
  // that still inscribes the entire #app inside the viewport (so neither
  // axis overflows), with no upper cap.
  //
  // Pixel-art crispness: `image-rendering: pixelated` on the canvas keeps
  // the sprites sharp under non-integer CSS transform scales. The HUD
  // (DOM elements) does anti-alias slightly at fractional scales but
  // that's the right trade-off vs. unused screen real estate.
  //
  // Narrow-window fallback: if the natural width is wider than the
  // viewport even after a scale-down would shrink the map below a
  // reasonable minimum, we let the body scroll so the HUD remains
  // reachable instead of crushing the map. Scale floor of 0.55 keeps
  // text legible on small laptops.
  const MIN_SCALE = 0.55;
  function fitStageToViewport() {
    const app = document.getElementById('app');
    if (!app) return;
    // Reset transform first to measure natural size, then re-apply scale.
    app.style.setProperty('--app-scale', '1');
    const w = app.scrollWidth;
    const h = app.scrollHeight;
    const vw = window.innerWidth - 16;
    const vh = window.innerHeight - 16;
    // Largest scale that fits both axes inside the viewport.
    const fitScale = Math.min(vw / w, vh / h);
    // Clamp to a sensible minimum so very small viewports don't crush
    // the map into illegibility — instead we trust the body's scroll
    // overflow to let the player reach the HUD.
    const scale = Math.max(MIN_SCALE, fitScale);
    app.style.setProperty('--app-scale', String(scale));
    // Allow body scroll iff the scaled-down content STILL exceeds the
    // viewport (which only happens when we hit the MIN_SCALE floor).
    const overflowsX = w * scale > vw;
    const overflowsY = h * scale > vh;
    document.body.style.overflowX = overflowsX ? 'auto' : 'hidden';
    document.body.style.overflowY = overflowsY ? 'auto' : 'hidden';
  }
  fitStageToViewport();
  window.addEventListener('resize', fitStageToViewport);
  // Re-fit shortly after first paint in case fonts/sprites adjust layout.
  setTimeout(fitStageToViewport, 100);
  setTimeout(fitStageToViewport, 600);

  // 2026-05-18 — Page-exit guard. When the player tries to close the
  // tab, refresh the page, or navigate away mid-game, prompt them to
  // confirm so they don't accidentally throw away their run progress.
  // Browsers no longer honor custom messages here (Chrome/Firefox/
  // Safari all show a generic "Leave site? Changes you made may not
  // be saved." dialog) so the only control we have is whether the
  // dialog appears at all — call event.preventDefault() + set
  // returnValue to trigger it.
  //
  // Gated on actual mid-run state: only prompt if the player is
  // actually in the middle of a campaign or endless run with
  // unsaved progress. Don't prompt on the loading screen, fresh
  // game-start, or after victory/game-over (no progress to lose).
  window.addEventListener('beforeunload', (event) => {
    // No run in progress yet? Skip — the player hasn't started.
    // Wave 0 + lives at starting value means they haven't engaged.
    if (state.wave <= 0) return;
    // Already won or lost? No progress to lose.
    if (state.phase === GamePhase.GAME_OVER || state.phase === GamePhase.VICTORY) return;
    // Player IS mid-run. Fire the confirm dialog. The browser shows
    // its generic localized message; we can't customize the text.
    event.preventDefault();
    // returnValue is the legacy API — still required by some browsers
    // for the dialog to appear. Setting it to a non-empty string is
    // the canonical "show the prompt" signal.
    event.returnValue = 'Are you sure? You will lose your current run progress.';
    return 'Are you sure? You will lose your current run progress.';
  });

  // Renderer
  const renderer = new RenderEngine();
  (window as any).__renderer = renderer;
  renderer.attachTo(wrap);
  // 2026-05-16 — give the renderer access to the gore particle pool so
  // surprise-event ember helpers can push particles into the same capped
  // pool the rest of the game uses (no extra allocation, no leak).
  (renderer.app as any).__attachedGore = gore;
  renderer.drawStatic(state);

  // 2026-05-19 — "Etch your name in the history of Rome" prompt.
  // Fires once per page load before the player can interact with
  // prospects. The chosen name persists in localStorage so reload
  // pre-fills it; the prompt is suppressed entirely if a saved name
  // is already on file (player can change via the settings panel).
  // Stored on `state.playerName` so the leaderboard pre-fills it
  // automatically at end-of-run.
  const SAVED_NAME_KEY = 'roman_td_player_name';
  function readSavedName(): string {
    try { return (localStorage.getItem(SAVED_NAME_KEY) ?? '').toUpperCase(); }
    catch { return ''; }
  }
  function writeSavedName(name: string) {
    try { localStorage.setItem(SAVED_NAME_KEY, name); } catch { /* ignore */ }
  }
  const existingName = readSavedName();
  if (existingName) {
    (state as any).playerName = existingName;
  } else {
    // Player has no saved name → show the etch-your-name modal. Block
    // start-wave / prospect placement clicks via a translucent overlay
    // until they commit a name.
    showEtchNameModal((name) => {
      writeSavedName(name);
      (state as any).playerName = name;
    });
  }
  function showEtchNameModal(onSubmit: (name: string) => void) {
    const modal = document.createElement('div');
    modal.id = 'etch-name-modal';
    modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#1a1410,#0c0a08);z-index:130;font-family:'Courier New',monospace;`;
    modal.innerHTML = `
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(to bottom,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 2px,rgba(0,0,0,0.30) 2px,rgba(0,0,0,0.30) 3px);pointer-events:none;mix-blend-mode:multiply"></div>
      <div style="position:relative;width:min(560px,92%);padding:32px 36px;background:linear-gradient(180deg,#241a12,#0c0a08);border:3px solid #d4af37;color:#e8d6a8;box-shadow:0 0 38px rgba(212,175,55,0.55),inset 0 0 32px rgba(0,0,0,0.7);text-align:center">
        <div style="font-size:11px;letter-spacing:6px;color:#aa6a1a;font-weight:bold;margin-bottom:10px">▾ SENATUS POPULUSQUE ROMANUS ▾</div>
        <div style="font-size:26px;font-weight:900;letter-spacing:6px;color:#ffd34d;text-shadow:0 0 14px #ffaa00,3px 3px 0 #000;line-height:1.1;margin-bottom:18px">ETCH YOUR NAME<br/>IN THE HISTORY OF ROME</div>
        <div style="font-size:13px;color:#fff8e0;line-height:1.6;letter-spacing:0.5px;text-shadow:1px 1px 0 #000;margin-bottom:24px;text-align:left;padding:0 8px">
          Before the wave begins, the Senate requires a name for the marble. They like to know who to honor — or, more often, who to forget. The Hall of Glory has space for the worthy. Don't disappoint them.
        </div>
        <input id="etch-name-input" type="text" maxlength="12" placeholder="LEGATUS"
          style="width:100%;box-sizing:border-box;background:#0c0a08;border:2px solid #5a4a30;color:#ffd34d;font-family:'Courier New',monospace;font-size:24px;font-weight:bold;letter-spacing:6px;padding:14px 12px;text-align:center;text-transform:uppercase;outline:none;margin-bottom:16px"/>
        <div style="font-size:9px;color:#aa6a1a;letter-spacing:2.5px;margin-bottom:18px">12 CHARS · LETTERS + NUMBERS · NO VULGARITY</div>
        <button id="etch-name-submit" style="width:100%;padding:16px 18px;background:linear-gradient(180deg,#aa1a1a,#5a0606);border:3px solid #ffd34d;color:#ffd34d;font-family:inherit;font-size:14px;font-weight:bold;letter-spacing:4px;cursor:pointer;text-shadow:0 0 8px #ffd34d,1px 1px 0 #000;box-shadow:0 0 18px rgba(255,80,80,0.35)">⚔  CARRY THE EAGLE  ⚔</button>
        <div style="margin-top:14px;font-size:10px;color:#5a4a30;letter-spacing:2px;font-style:italic">— ROME REMEMBERS EVERY NAME ENTERED HERE —</div>
      </div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector('#etch-name-input') as HTMLInputElement;
    const btn = modal.querySelector('#etch-name-submit') as HTMLButtonElement;
    // Autofocus the input on a slight delay so the modal animation
    // has time to render before the cursor lands inside it.
    setTimeout(() => input.focus(), 80);
    const commit = () => {
      let raw = (input.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      if (!raw) raw = 'LEGATUS';
      // Profanity gate uses the same list as the end-of-run prompt.
      // Avoid coupling to that module here — quick inline check.
      const lower = raw.toLowerCase();
      const PROFANE = ['fuck','shit','bitch','cunt','nigg','niger','hitler','nazi','kkk','rape'];
      for (const w of PROFANE) {
        if (lower.includes(w)) {
          input.value = '';
          input.placeholder = 'TRY A SENATE-APPROVED NAME';
          input.focus();
          return;
        }
      }
      modal.remove();
      onSubmit(raw);
    };
    btn.onclick = commit;
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    });
  }

  // UI
  let selectedTowerId: string | null = null;
  const ui = new UIManager(app, {
    onCardSelected: (idx) => { state.selectedCard = idx; },
    onConfirmCard: () => {
      // Empty-round bonus: if the player took ZERO actions this build phase
      // (no prospects revealed, no stones placed, no items bought, no pool
      // upgrades, no combos), reward +8g for strategic patience. (Was +5g
      // — bumped 2026-05 to make skipping a build phase a real lever.)
      const noActionsThisRound =
        undoStack.length === 0 &&
        state.prospectsPlaced === 0 &&
        !hasPendingTowers();
      if (noActionsThisRound && state.wave >= 1) {
        earnGold(state, 12);     // 2026-05 v6: trimmed 20→12 with the gold pass
        state.hint = '✨ +12g Empty Round Bonus — discipline tastes like gold.';
      }
      // START WAVE in PROSPECT_PLACEMENT now transitions to PICK_KEEPER
      // first IF the player has placed any prospects, so they get a chance
      // to KEEP one (or 2 first round). With unlimited prospect placement
      // (1g each), the player decides when to stop placing — pressing
      // START is the "I'm done placing, let me pick" signal. If they have
      // ZERO prospects placed, fall through and let the wave start dry.
      if (state.phase === GamePhase.PROSPECT_PLACEMENT) {
        if (hasPendingTowers()) {
          state.phase = GamePhase.PICK_KEEPER;
          state.hint = state.keepsRemainingThisRound > 1
            ? `Pick ${state.keepsRemainingThisRound} towers to KEEP — click any glowing prospect, press KEEP.`
            : 'Pick ONE tower to KEEP — click any glowing prospect, press KEEP.';
          showPickKeeperGuide();
          // 2026-05 v10 — the player is being asked to KEEP a tower
          // now. Fire the Choose-Your-Character cue here (once per
          // round) so the moment of decision is musically loud.
          if (!(state as any).__chooseCharFiredThisRound) {
            (state as any).__chooseCharFiredThisRound = true;
            playMusicTrack('choose-char', sfx('assets/sfx/smash_bros_choose.mp3'), { loop: false, gain: 0.55 });
          }
          return;       // wave does NOT start yet — pick first
        }
        crystallizeAll();
      }
      // PICK_KEEPER (2026-05 guard): the player MUST commit a keep decision
      // before the wave starts. Pressing START WAVE while prospects are
      // still pending fires a guide modal instead of crystallizing them
      // into walls silently. Empty-round (zero prospects placed) still
      // falls through and starts dry — the guard only kicks in when there
      // are actual pending prospects waiting on a verdict.
      if (state.phase === GamePhase.PICK_KEEPER && hasPendingTowers()) {
        showPickKeeperGuide();
        return;
      }
      if (hasPendingTowers()) {
        showPickKeeperGuide();
        return;
      }
      // 2026-05-19 — First-wave empty-defense WARNING (not a block).
      // If the brand-new player presses START WAVE before placing any
      // prospects or keeping any towers, surface a friendly confirm()
      // dialog explaining the prospect flow and asking if they want
      // to proceed anyway. OK → wave starts (their choice). Cancel →
      // they stay on build phase and can place prospects normally.
      // Mirrors the existing soft-warning pattern used at line ~3503
      // for "no towers + unspent gold" on later waves.
      const activeTowers = Array.from(state.towers.values()).filter(t => !t.pending && t.damageType !== 5).length;
      const isFirstWaveStart = state.wave === 0 && !state.hasKeptAnyTowerEver;
      if (isFirstWaveStart && activeTowers === 0 && state.prospectsPlaced === 0) {
        const msg = `WARNING: You have no defenses yet.\n\n`
                  + `Starting the wave now means instant defeat — there's nothing on the map to fight.\n\n`
                  + `TIP: Click empty tiles to roll prospect towers (1g each). Press START WAVE again to enter the KEEP phase, then click a glowing prospect and press KEEP to save it.\n\n`
                  + `Start the wave anyway?`;
        if (!confirm(msg)) return;
      }
      // Soft low-defense warning (Build Phase Doc §7.4)
      if (state.wave > 0 && activeTowers === 0 && state.gold >= 5) {
        if (!confirm(`Warning: You have NO active towers and ${state.gold} unspent gold.\nStarting now will likely lose lives.\n\nStart wave anyway?`)) {
          return;
        }
      }
      // BOSS-WAVE DOUBLE VERIFICATION (2026-05): on the four scheduled
      // boss waves (W5/W10/W15/W20) the game taunts the player twice
      // before actually launching. The second click triggers a flash +
      // shake + 3-2-1 countdown via showBossWarning's own flow; we hand
      // off the actual wave start as the final callback so all the
      // standard side effects (Mercator dismiss, SFX, bossRuntime reset,
      // etc.) still fire inside `launchWave()` below.
      const upcomingWaveIdx = state.wave;       // wave that's about to start
      const upcomingWaveNum = upcomingWaveIdx + 1;
      // Everything that happens on a wave start — extracted so the boss
      // verification flow can fire it as the FINAL callback after the
      // player accepts their fate.
      const launchWave = () => {
        // 2026-05-15: if a DPS check dummy is still walking when the
        // player launches the next wave, retire it cleanly so its half-
        // measured stats don't bleed into the real wave or trigger a
        // mid-wave summary popup. Player gets the data they earned up to
        // this moment; the new wave starts with a clean slate.
        if (dpsCheckActiveId !== null) {
          const dummy: any = state.enemies.get(dpsCheckActiveId);
          if (dummy) showDpsCheckSummary(dummy, /*killed=*/false);
          else { dpsCheckActiveId = null; (state as any).__dpsCheckActive = false; }
        }
        // 2026-05-15 audit fix: if the player entered SELL STONES
        // selection mode and then pressed START WAVE without confirming,
        // the mode persisted into WAVE_PHASE and the canvas-click guard
        // ate every interaction (enemy inspect / tower menu blocked).
        // Cleanly exit selection mode at wave start so the UI is back
        // to normal regardless of what the player was doing.
        if ((state as any).__sellStoneMode) {
          (state as any).__sellStoneMode = false;
          (state as any).__sellStoneSelection = new Set<string>();
          updateSellStonesButton();
        }
        // Reset per-wave stats on every committed tower
        for (const tw of state.towers.values()) {
          tw.killsThisWave = 0;
          tw.damageThisWave = 0;
          // 2026-05 v7: Triumphator wreath resets between waves so the
          // stacking damage bonus is a "per-wave climb" not a permanent
          // accumulator. Same lifecycle as killsThisWave / damageThisWave.
          (tw as any).__triumphalWreath = 0;
        }
        bossRuntime = createBossRuntime();
        bossLegendaryDropped = false;
        waveStartTick = state.tick;
        if (mercatorActive) {
          dismissMercatorVisit();
          mercatorActive = false;
          mercatorShop = null;
          ui.setMercatorAvailable(false);
        }
        startWave(state);
        // User-supplied wave-start bumper SFX (plays the moment the wave starts).
        SFX.waveStartBlast();
        // 2026-05-17 — W2 PINNED-RECIPE TIP. First subtle teaching moment
        // for the codex-pinning feature, fired exactly once per device
        // (localStorage gates re-fires). The tip is non-blocking — it
        // sits in the top-right corner of the play area with a clear
        // × dismiss, auto-fades after 14 seconds, and points toward the
        // CODEX button in the right panel.
        if (state.wave === 2 && !state.endlessMode) {
          showCodexPinTip();
        }
        // 2026-05 v10 — ENDLESS WAVE START. state.wave is frozen at 20
        // so wavesData[19] is the W20 boss config — playing W20 boss
        // music + banner + vignette on every endless wave is wrong.
        // Route to the endless-specific handler and skip the W1-W20
        // banner stack.
        if (state.endlessMode) {
          const ecfg = (state as any).__endlessWaveCfg;
          // Cycle faction BGM through the endless cfg's dominant faction
          // (varies per wave per the generator). Gives the chaos audible
          // variety without W20's super-demons stinger on every wave.
          if (ecfg) setFactionBGM(ecfg.faction);
          // Boss anchor: every 5th endless wave gets the boss-wave SFX
          // sting and vignette. One-Winged Angel does NOT loop on every
          // endless boss — it's reserved for the W20 finale.
          const isEndlessBoss = ecfg && ecfg.type === 'B';
          if (isEndlessBoss) setTimeout(() => SFX.bossWaveStart(), 1500);
          renderer.setBossWaveActive(!!isEndlessBoss);
          return;
        }
        const justStarted = wavesData[state.wave - 1];
        // Boss wave: play the user-supplied boss-wave-start sting 3 seconds
        // after START WAVE is pressed (replaces the older 350 ms synth
        // bossWaveImpending warning — same sting, new timing + sample).
        if (justStarted?.type === 'B') setTimeout(() => SFX.bossWaveStart(), 3000);
        // 2026-05 v10 — W20 BOSS MUSIC. The Daemon Imperator gets
        // One-Winged Angel on loop for the duration of the wave.
        // Stops on wave end OR game over (handled in checkWaveEnd
        // callback + GAME_OVER hook below).
        if (state.wave === 20 && justStarted?.type === 'B') {
          playMusicTrack('boss20', sfx('assets/sfx/ff7_one_winged_angel.mp3'), { loop: true, gain: 0.7 });
        }
        // BOSS VIGNETTE (2026-05 v6 polish): fade in the subtle red-shifted
        // corner darken on boss waves; the per-frame tween in
        // drawBossVignette eases it from 0 → 0.32 over ~0.35s. Cleared
        // at wave-end (checkWaveEnd callback below) back to 0.
        renderer.setBossWaveActive(justStarted?.type === 'B');
        // Periodic combo nudges + quest tips (downgrade tip retired 2026-05-18).
        if (state.wave === 5 || state.wave === 10 || state.wave === 15 ||
            state.wave === 20 || state.wave === 25 || state.wave === 30 ||
            state.wave === 40) {
          showComboNudge(state.wave);
        } else if (state.wave === 3 || state.wave === 12 || state.wave === 22 || state.wave === 32) {
          showQuestTip();
        }
        const w = wavesData[state.wave - 1];
        if (w) {
          setFactionBGM(w.faction);
          if (w.type === 'B') {
            // 2026-05-17 — W20 swaps the regular boss banner for the over-
            // the-top HP callout (counts up to 600M with satirical
            // captions). Every other boss wave keeps the standard banner.
            if (state.wave === 20) {
              showFinalBossHpBanner();
            } else {
              showBossBanner(`WAVE ${state.wave} — ${factionName(w.faction).toUpperCase()} BOSS APPROACHES`, w.faction);
            }
          } else if (state.wave === 17) {
            showPhalanxWarning(state.wave);
          }
          const profile = FACTION_WEATHER[w.faction];
          if (profile) setTimeout(() => showWeatherBanner(profile), w.type === 'B' ? 2400 : 600);
          if (state.waveModifier) {
            const mod = WAVE_MODIFIERS.find(m => m.key === state.waveModifier);
            if (mod) setTimeout(() => showModifierBanner(mod), w.type === 'B' ? 4200 : 2400);
            grantBonusItem('UNCOMMON');
          }
          // (VEILED IN ASH wave-warning removed — the mechanic itself was
          // pulled. Other wave-tag banners above still fire normally.)
        }
      };
      if (isVerifiedBossWave(upcomingWaveNum)) {
        showBossWarning(app, upcomingWaveNum, launchWave);
        return;
      }
      launchWave();
    },
    onPoolUpgrade: () => {
      if (!isPreWavePhase()) { state.hint = 'Pool upgrades are bought between waves, not during. The barbarians won\'t pause.'; return; }
      const cost = poolUpgradeCost(state);
      if (cost > 0 && !canAfford(state, cost)) {
        showInsufficientGoldToast(cost);
        state.hint = `Pool upgrade costs ${cost}g — treasury is short.`;
        return;
      }
      if (cost > 0 && canAfford(state, cost)) {
        // User-supplied pool-upgrade SFX — fires on the successful purchase
        // path only, after the affordability + phase checks have passed,
        // so misclicks during a wave don't trigger the sound.
        SFX.poolUpgrade();
        const prevLevel = state.poolLevel;
        const prevDraw = [...state.draw];
        const prevProspectQueue = [...state.prospectQueue];
        spendGold(state, cost);
        state.poolLevel = Math.min(ECONOMY.POOL_MAX_LEVEL, state.poolLevel + 1);
        if (state.phase === GamePhase.PROSPECT_PLACEMENT && state.prospectQueue.length > 0) {
          state.prospectQueue = rollDraw(state, BASE_TOWER_TYPES).slice(0, state.prospectQueue.length);
        } else {
          state.draw = rollDraw(state, BASE_TOWER_TYPES);
        }
        // 2026-05: gold rebate on pool upgrades REMOVED. You pay the full
        // cost — the value is the better prospect rolls + the global damage
        // bonus, not a partial refund.
        const newLevel = state.poolLevel;
        const dmgBonusPct = Math.max(0, newLevel - 1) * 3;
        state.hint = `Pool advanced to L${newLevel}. ${dmgBonusPct > 0 ? `+${dmgBonusPct}% global damage — it still might not be enough.` : 'Better prospects start arriving. No damage bonus until L2 — patience, general.'}`;
        showPoolUpgradeBanner(newLevel, 0);
        pushAction(`Pool → ${state.poolLevel}`,
          () => { state.poolLevel = prevLevel; earnGold(state, cost); state.draw = prevDraw; state.prospectQueue = prevProspectQueue; },
          () => {
            spendGold(state, cost);
            state.poolLevel = Math.min(ECONOMY.POOL_MAX_LEVEL, prevLevel + 1);
            if (state.phase === GamePhase.PROSPECT_PLACEMENT && state.prospectQueue.length > 0) {
              state.prospectQueue = rollDraw(state, BASE_TOWER_TYPES).slice(0, state.prospectQueue.length);
            } else {
              state.draw = rollDraw(state, BASE_TOWER_TYPES);
            }
          }
        );
      }
    },
    onComboList: () => {
      const combos = scanCombos(state);
      showComboPicker(app, combos, state, {
        onPick: (combo, resultTileTowerId) => {
          // Snapshot result tile coords + merge flag BEFORE executeCombo for
          // the tier-up shimmer below. Same pattern as executeCombineFromMenu.
          const pickerResultIng = combo.ingredients.find(i => i.id === resultTileTowerId) ?? combo.ingredients[0];
          const sx = pickerResultIng.tileX * 32 + 16;
          const sy = pickerResultIng.tileY * 32 + 16;
          const pickerIsMerge = !!combo.isSameTierMerge;
          const ok = executeCombo(state, combo, resultTileTowerId);
          if (ok) {
            // 2026-05 v11: user-supplied combo SFX (replaces the synth fanfare).
            SFX.comboMade();
            // 2026-05 v10: drain leftover items into inventory — same logic
            // as executeCombineFromMenu. Combo-picker path was previously
            // stranding overflow items (rare but real on merge-laddering
            // a tower with multiple equipped items into a lower-slot result).
            const leftoverPicker = (state as any).__leftoverItemsFromCombo as string[] | undefined;
            if (leftoverPicker && leftoverPicker.length > 0) {
              let returnedP = 0;
              for (const item of leftoverPicker) {
                const def: any = (itemsData as any)[item];
                const rarity = (def?.rarity as any) ?? 'COMMON';
                const ok2 = inventoryAdd(inventory, item as any, rarity, false);
                if (ok2) returnedP++;
                else break;
              }
              (state as any).__leftoverItemsFromCombo = [];
              if (returnedP > 0) state.hint = `Combined! ${returnedP} extra item${returnedP > 1 ? 's' : ''} returned to inventory.`;
            }
            // TIER-UP SHIMMER on the combo-picker path — mirrors the
            // executeCombineFromMenu path's effect so both entry points
            // give the same satisfying "ladder step" cue on merges.
            if (pickerIsMerge && renderer?.triggerImpactRing) {
              renderer.triggerImpactRing(sx, sy, state.tick, 30, 0xffd34d);
              renderer.triggerImpactRing(sx, sy, state.tick + 0.08, 48, 0xffe88c);
              for (let i = 0; i < 6; i++) {
                const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
                const speed = 70 + Math.random() * 60;
                gore.particles.push({
                  x: sx + (Math.random() - 0.5) * 8,
                  y: sy,
                  vx: Math.cos(a) * speed,
                  vy: Math.sin(a) * speed,
                  life: 0.55 + Math.random() * 0.25,
                  size: 2 + Math.random() * 1.5,
                  color: 0xffd34d
                });
              }
            }
            // BUGFIX 2026-05 v6 — rebuild the ground path BEFORE drawStatic.
            // executeCombo converts ingredient tiles to STONE which forces a
            // path reroute. If drawStatic runs first it bakes dirt-vs-grass
            // sprite decisions against the STALE state.groundPath while the
            // tiles themselves have already moved, producing the "terrain
            // sprite chaos / grass turning brown" glitch the player reported.
            // Same fix already in executeCombineFromMenu — that path was
            // safe, this combo-picker path wasn't. Now both routes are
            // consistent. See line 1455 comment for the same warning.
            const np = buildGroundPath(state);
            if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
            renderer.drawStatic(state);
          }
        },
        onClose: () => {}
      });
    },
    onOpenShop: () => {
      if (!isPreWavePhase()) { state.hint = 'The shop is closed while there\'s a battle on. Survive first, browse later.'; return; }
      if (!gateShop) gateShop = buildGateShop(state.wave, currentlyOwnedLegendarySet(state, inventory));
      // 2026-05 v11: clear the "NEW STOCK" badge — player has now seen the rotation.
      state.shopRefreshedUnopened = false;
      renderShop(app, gateShop, state, inventory, {
        onClose: () => {
          const m = document.getElementById('shop-modal');
          if (m) m.remove();
        }
      });
    },
    // Dedicated entry point for the Mercator wagon. The UIManager button and
    // the floating MercatorBanner both call this; the gate shop is opened
    // separately via onOpenShop, so the two vendors never lock each other out.
    onOpenMercator: () => {
      if (!mercatorActive) { state.hint = 'The Mercator is not in town. He visits W4 / 9 / 14 / 19 only.'; return; }
      if (!isPreWavePhase()) { state.hint = 'The Mercator does not haggle mid-battle. Survive first.'; return; }
      if (!mercatorShop) {
        mercatorShop = buildMercatorStock(state.wave, currentlyOwnedLegendarySet(state, inventory));
        mercatorShop.towerOffers = buildMercatorTowerOffers(state.wave, 5);
      }
      renderShop(app, mercatorShop, state, inventory, {
        onClose: () => document.getElementById('shop-modal')?.remove()
      });
    },
    onOpenInventory: () => showInventoryModal(app, inventory, state, {
      onClose: () => document.getElementById('inventory-modal')?.remove(),
      onSell: (idx) => {
        // 2026-05 v11 BUGFIX: selling was gated to BUILD_PHASE only, but the
        // sell button itself was enabled during all pre-wave phases. The
        // button looked active during PROSPECT_PLACEMENT / PICK_KEEPER but
        // silently no-op'd. Now any pre-wave phase can sell — matches the
        // button enable check + the wider "no transactions mid-battle" rule.
        if (!isPreWavePhase()) {
          state.hint = 'The market is closed mid-battle. Survive first, profit later.';
          return;
        }
        const slot = inventory.slots[idx];
        if (!slot) return;
        const refund = inventorySellPrice(slot);
        const removed = inventoryRemove(inventory, slot.id);
        if (!removed) return;
        earnGold(state, refund);
        state.hint = `Sold ${removed.rarity} for ${refund}g.`;
        document.getElementById('inventory-modal')?.remove();
        (ui as any).cb.onOpenInventory?.();
      }
    }),
    onOpenCodex: () => { SFX.codexOpen(); showCodex(app, { poolLevel: state.poolLevel, heroLevel: state.heroLevel, totalKills: state.totalKills, towers: Array.from(state.towers.values()).map(t => ({ type: String(t.type), qualityTier: t.qualityTier, pending: !!t.pending })), completedQuests: state.completedQuests ?? [] }); },
    onOpenQuests: () => showQuestsModal(),
    onOpenLeaderboard: () => showTowerLeaderboard(app, state, {
      onClose: () => document.getElementById('tower-leaderboard')?.remove(),
      // Clicking a row in the leaderboard opens the standard tower menu —
      // same UI you'd get clicking the tower on the map. The leaderboard
      // is closed first so the menu has clean focus, and ESC reopens the
      // map view (no leaderboard left under it).
      onSelectTower: (tw) => {
        document.getElementById('tower-leaderboard')?.remove();
        inspectTower(tw);
      }
    }),
    onToggleMute: (btn: HTMLButtonElement) => {
      setMuted(!isMuted());
      btn.textContent = isMuted() ? '🔇 MUTED' : '🔊 SOUND';
    },
    // onToggleStone removed — stones are no longer a separate mode.
    // Prospect placement (1g each) replaces both stone placement AND
    // stone toggling; unkept prospects auto-convert to walls.
    onToggleSpeed: (btn: HTMLButtonElement) => {
      speedMult = speedMult === 1 ? 2 : 1;
      btn.textContent = speedMult === 2 ? '▶▶ 2×' : '▶ 1×';
      btn.style.background = speedMult === 2 ? '#5a3a1a' : '#222';
    },
    onTogglePause: (btn: HTMLButtonElement) => {
      paused = !paused;
      autoPaused = false;    // manual press supersedes auto-pause state
      btn.textContent = paused ? '▶ RESUME' : '⏸ PAUSE';
      btn.style.background = paused ? '#5a3a1a' : '#222';
      updatePauseOverlay();
    },
    // 2026-05-15 v3 (Sell Stones — multi-select redesign):
    // Two-step flow replacing the old "click button → wipes EVERY stone"
    // behavior. Selling the whole map at once was destructive; now the
    // button is a mode-toggle.
    //
    // Flow:
    //   1. Click SELL STONES → enters selection mode (button label flips
    //      to "✓ CONFIRM SELL (0)"); the canvas paints a cyan ring on
    //      every stone tile clicked.
    //   2. Click stones on the map to toggle them in/out of the selection.
    //      Selected stones get a pulsing cyan highlight + the button label
    //      tracks the running count + refund total.
    //   3. Click ✓ CONFIRM SELL → sells only the selected stones, refunds
    //      1g per stone, rebuilds the ground path. ESC at any point
    //      cancels without selling. Right-click on canvas also cancels.
    //   4. Selecting zero stones and confirming exits mode without action.
    //
    // Towers, gates, waypoints, etc. are never selectable in this mode —
    // the canvas-click guard short-circuits on tile === STONE only.
    onSellAllStones: () => {
      if (!isPreWavePhase()) {
        state.hint = 'No demolition during battle. The empire pays for cohesion.';
        return;
      }
      const mode: any = state as any;
      if (mode.__sellStoneMode) {
        // ─── CONFIRM SELL ──────────────────────────────────────────────
        const sel: Set<string> = mode.__sellStoneSelection ?? new Set<string>();
        let count = 0;
        for (const key of sel) {
          const [r, c] = key.split(',').map(Number);
          if (state.tiles[r]?.[c] === TileType.STONE) {
            setTile(state, c, r, TileType.EMPTY);
            count++;
          }
        }
        mode.__sellStoneMode = false;
        mode.__sellStoneSelection = new Set<string>();
        updateSellStonesButton();
        if (count === 0) {
          state.hint = 'Stone-sell cancelled — none selected.';
          return;
        }
        earnGold(state, count * ECONOMY.STONE_COST);
        const np = buildGroundPath(state);
        if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
        state.hint = `Sold ${count} stone${count === 1 ? '' : 's'} (+${count * ECONOMY.STONE_COST}g).`;
        return;
      }
      // ─── ENTER SELECTION MODE ────────────────────────────────────────
      // Quick check: any stones at all on the map?
      let anyStones = false;
      for (let r = 0; r < GRID.ROWS && !anyStones; r++) {
        for (let c = 0; c < GRID.COLS && !anyStones; c++) {
          if (state.tiles[r][c] === TileType.STONE) anyStones = true;
        }
      }
      if (!anyStones) {
        state.hint = 'No stones to sell. The map is already pristine.';
        return;
      }
      mode.__sellStoneMode = true;
      mode.__sellStoneSelection = new Set<string>();
      state.hint = '🪨 Pick stones to sell — click each one on the map. Press ✓ CONFIRM SELL when ready, or ESC to cancel.';
      updateSellStonesButton();
    },
    // 2026-05 v11 (B2 Settings): open audio settings panel.
    onOpenSettings: () => {
      showSettingsPanel(app);
    },
    // DPS CHECK: spawn a training dummy for damage measurement, OR cancel
    // the active dummy if one is already on the path. Player-side cancel
    // lets them clear a stuck/no-longer-wanted measurement without
    // waiting for the full path traversal.
    onDpsCheck: () => {
      if (dpsCheckActiveId !== null) {
        // Cancel: silently remove the dummy and reset the active state.
        // No summary popup — player explicitly aborted, no need to
        // surface partial measurement data they didn't ask for.
        const dummy = state.enemies.get(dpsCheckActiveId);
        if (dummy) state.enemies.delete(dpsCheckActiveId);
        dpsCheckActiveId = null;
        (state as any).__dpsCheckActive = false;
        state.hint = '🎯 DPS check cancelled. Dummy cleared.';
        return;
      }
      spawnDpsCheckDummy();
    },
    onUndo: () => {
      if (state.phase !== GamePhase.BUILD_PHASE && state.phase !== GamePhase.PROSPECT_PLACEMENT && state.phase !== GamePhase.PICK_KEEPER) {
        state.hint = 'Undo is a peacetime privilege. Battle is final.'; return;
      }
      const last = undoStack.pop();
      if (!last) { state.hint = 'Nothing to undo. Your record is unblemished. So far.'; return; }
      last.undo();
      redoStack.push(last);
      state.hint = `Undone: ${String(last.type).replace(/_/g,' ')}.`;
    },
    onReset: () => {
      if (state.phase === GamePhase.WAVE_PHASE) { state.hint = 'You cannot reset the campaign while it is killing you.'; return; }
      if (!confirm('Reset all actions taken this build phase? Towers placed, stones, items bought / equipped, and pool upgrades this round will all be undone.')) return;
      restoreBuildPhase();
    }
  });

  // (Old HUD mute-button sync block removed 2026-05 v11 — the standalone
  //  SOUND button no longer exists. Mute toggle now lives in the Settings
  //  panel's SOUND tab; persistence handled by AudioManager.)

  // Canvas pointer handling
  const canvas = renderer.app.view as HTMLCanvasElement;
  let hoverCol = -1, hoverRow = -1;
  canvas.style.cursor = 'crosshair';
  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    // 2026-05-17 — Apply inverse world-zoom transform so a click on the
    // visually-zoomed canvas resolves to the correct logical tile coords.
    // Without this, clicks at the edges would be off by ~1 tile.
    const rawX = (e.clientX - rect.left) * (GRID.CANVAS_W / rect.width);
    const rawY = (e.clientY - rect.top) * (GRID.CANVAS_H / rect.height);
    const x = (rawX - WORLD.OFFSET_X) / WORLD.ZOOM;
    const y = (rawY - WORLD.OFFSET_Y) / WORLD.ZOOM;
    // Track mouse pos in stage-relative pixels so the insufficient-gold
    // tooltip can pop near the cursor for non-tile UI interactions (shop
    // buy buttons, pool upgrade clicks, etc.).
    const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
    if (stageRect) {
      (window as any).__lastMousePos = {
        x: e.clientX - stageRect.left,
        y: e.clientY - stageRect.top
      };
    }
    const t = pixelToTile(x, y);
    hoverCol = t.col; hoverRow = t.row;
    let valid = false;
    let rangePreview = 0;
    if (state.selectedCard !== null) {
      valid = isBuildable(state, t.col, t.row);
      const card = state.draw[state.selectedCard];
      const def: any = (towersData as any)[card.type];
      rangePreview = def?.range ?? 0;
    }
    renderer.drawHover(t.col, t.row, valid, rangePreview);
    // 2026-05 v11 (B3 Hover Range): map mouse to tile → find any tower
    // sitting on it (pending OR kept) → mark it as the hovered tower so
    // the renderer draws a dim copper range circle for it. Clears when
    // the cursor isn't over a tower tile. Loop avoids per-mousemove
    // Array.from allocation.
    let hoverTowerId: string | null = null;
    for (const tw of state.towers.values()) {
      if (tw.tileX === t.col && tw.tileY === t.row) { hoverTowerId = tw.id; break; }
    }
    renderer.hoveredTowerId = hoverTowerId;
    // 2026-05-19 — Aura tile tooltip. Hovering one of the 5 fixed
    // buff tiles pops a small chip explaining the tile's effect.
    updateAuraTileTooltip(t.col, t.row, e.clientX, e.clientY);
    // 2026-05-19 — TOWER HOVER PREVIEW. When the cursor is over a
    // placed tower, show a floating panel with its key stats so
    // the player can scan tower info without opening the full menu.
    // Click still opens the interactive menu for sell/combine/equip.
    updateTowerHoverPreview(hoverTowerId, e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', () => {
    hoverCol = -1; hoverRow = -1;
    renderer.drawHover(-1, -1, false);
    renderer.hoveredTowerId = null;
    document.getElementById('aura-tile-tooltip')?.remove();
    document.getElementById('tower-hover-preview')?.remove();
  });
  // 2026-05-19 — Tower hover preview helper. Shows a floating chip with
  // name / tier / DPS / range / attack speed / item count / kill count.
  // Auto-tracks the cursor and hides when the cursor leaves any tower.
  function updateTowerHoverPreview(towerId: string | null, mouseX: number, mouseY: number) {
    let tip = document.getElementById('tower-hover-preview');
    if (!towerId) { tip?.remove(); return; }
    const t = state.towers.get(towerId);
    if (!t) { tip?.remove(); return; }
    const def: any = (towersData as any)[t.type] ?? {};
    const tierCol = ['#aaaaaa','#aaaaaa','#b87333','#c0c0c0','#ffd34d','#ff5050'][t.qualityTier] ?? '#aaaaaa';
    const stats = towerEffectiveStats(t);
    const pendingTag = t.pending ? '<span style="color:#ff9933;font-weight:bold">PENDING — keep to activate</span>' : '';
    const auraKind = towerAuraTileKind(t);
    const auraTag = auraKind
      ? `<span style="color:#${AURA_TILE_EFFECTS[auraKind].color.toString(16).padStart(6,'0')};font-weight:bold;font-size:9px;letter-spacing:1.5px">★ ON ${AURA_TILE_EFFECTS[auraKind].label}</span>`
      : '';
    const items = (t.equippedItems ?? []).length;
    const niceName = def.name ?? String(t.type).replace(/_/g, ' ');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'tower-hover-preview';
      tip.style.cssText = `position:fixed;pointer-events:none;z-index:100;background:linear-gradient(180deg,#1a1410,#0c0a08);border:2px solid ${tierCol};padding:8px 12px;font-family:'Courier New',monospace;color:#e8d6a8;font-size:10.5px;letter-spacing:0.5px;line-height:1.5;box-shadow:0 0 18px rgba(0,0,0,0.6);min-width:200px;max-width:280px;`;
      document.body.appendChild(tip);
    } else {
      tip.style.borderColor = tierCol;
    }
    tip.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;border-bottom:1px solid #3a3025;padding-bottom:4px">
        <div style="color:${tierCol};font-weight:bold;font-size:12px;letter-spacing:1px">${niceName}</div>
        <div style="color:${tierCol};font-weight:bold">T${t.qualityTier}</div>
      </div>
      ${pendingTag ? `<div style="margin-bottom:4px">${pendingTag}</div>` : ''}
      <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px">
        <span style="color:#aa9a4a">DPS</span><b style="color:#fff8e0">${Math.round(stats.dps).toLocaleString()}</b>
        <span style="color:#aa9a4a">Range</span><b style="color:#fff8e0">${stats.range.toFixed(1)} tiles</b>
        <span style="color:#aa9a4a">Atk Speed</span><b style="color:#fff8e0">${stats.attackSpeed.toFixed(2)}/sec</b>
        <span style="color:#aa9a4a">Items</span><b style="color:#fff8e0">${items} equipped</b>
        <span style="color:#aa9a4a">Kills</span><b style="color:#88ff88">${t.killCount ?? 0}</b>
      </div>
      ${auraTag ? `<div style="margin-top:5px;padding-top:4px;border-top:1px dashed #3a3025">${auraTag}</div>` : ''}
      <div style="margin-top:6px;font-size:9px;color:#aa9a4a;letter-spacing:1px;font-style:italic">click for full menu</div>`;
    const tipW = 280, tipH = 160;
    const left = Math.min(window.innerWidth - tipW - 8, Math.max(8, mouseX + 16));
    const top  = Math.min(window.innerHeight - tipH - 8, Math.max(8, mouseY + 16));
    tip.style.left = left + 'px';
    tip.style.top  = top + 'px';
  }
  // 2026-05-19 — Aura-tile hover tooltip helper. Lazy-creates the
  // popup element on first hover, positions it near the cursor, hides
  // when the cursor leaves an aura tile. Constant lookup since there
  // are only 5 fixed tiles.
  function updateAuraTileTooltip(col: number, row: number, mouseX: number, mouseY: number) {
    const aura = AURA_TILES.find(a => a.col === col && a.row === row);
    let tip = document.getElementById('aura-tile-tooltip');
    if (!aura) {
      if (tip) tip.remove();
      return;
    }
    const eff = AURA_TILE_EFFECTS[aura.kind];
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'aura-tile-tooltip';
      tip.style.cssText = `position:fixed;pointer-events:none;z-index:120;background:linear-gradient(180deg,#1a1410,#0c0a08);border:2px solid #d4af37;padding:8px 12px;font-family:'Courier New',monospace;color:#e8d6a8;font-size:11px;letter-spacing:0.5px;line-height:1.5;box-shadow:0 0 14px rgba(0,0,0,0.55);max-width:240px;`;
      document.body.appendChild(tip);
    }
    const colorHex = '#' + eff.color.toString(16).padStart(6, '0');
    tip.innerHTML = `
      <div style="font-size:10px;letter-spacing:2px;color:${colorHex};font-weight:bold;margin-bottom:4px">${eff.label}</div>
      <div style="font-size:11px;color:#fff8e0;line-height:1.45">${eff.description}</div>
      <div style="margin-top:4px;font-size:9px;color:#aa9a4a;letter-spacing:1px;font-style:italic">place a tower on this tile to activate</div>`;
    // Position: slightly below-right of cursor, clamped to viewport.
    const w = 260, h = 80;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, mouseX + 14));
    const top  = Math.min(window.innerHeight - h - 8, Math.max(8, mouseY + 14));
    tip.style.left = left + 'px';
    tip.style.top  = top + 'px';
  }
  canvas.addEventListener('click', (e: MouseEvent) => { try { return _handleCanvasClick(e); } catch (err) { Logger.error('CanvasClick', err); return; } });
  function _handleCanvasClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    // 2026-05-17 — Inverse world-zoom transform (matches mousemove handler).
    const rawX = (e.clientX - rect.left) * (GRID.CANVAS_W / rect.width);
    const rawY = (e.clientY - rect.top) * (GRID.CANVAS_H / rect.height);
    const x = (rawX - WORLD.OFFSET_X) / WORLD.ZOOM;
    const y = (rawY - WORLD.OFFSET_Y) / WORLD.ZOOM;
    let { col, row } = pixelToTile(x, y);
    let tile = tileAt(state, col, row);

    // 2026-05-15 v3 (Sell Stones multi-select): while the player is in
    // stone-selection mode, the canvas only handles "toggle this stone
    // in/out of the selection set" — every other click path (enemy
    // inspect, tower menu, tile snap, prospect roll, etc.) is bypassed
    // so the player can't accidentally trigger them. ESC or the
    // CONFIRM SELL button exits the mode.
    const _mode: any = state as any;
    if (_mode.__sellStoneMode) {
      if (tile === TileType.STONE) {
        const sel: Set<string> = _mode.__sellStoneSelection ?? new Set<string>();
        const key = `${row},${col}`;
        if (sel.has(key)) sel.delete(key); else sel.add(key);
        _mode.__sellStoneSelection = sel;
        const refund = sel.size * (ECONOMY.STONE_COST ?? 1);
        state.hint = sel.size > 0
          ? `${sel.size} stone${sel.size === 1 ? '' : 's'} selected (+${refund}g). Click ✓ CONFIRM SELL to commit or ESC to cancel.`
          : 'Selection cleared. Pick stones to sell, or ESC to cancel.';
        updateSellStonesButton();
      } else {
        state.hint = 'Selection mode: click STONES only. Towers, paths, and grass are off-limits — press ✓ CONFIRM SELL or ESC.';
      }
      return;
    }

    // Click on enemy → inspection panel (Enemy Doc §14.1)
    // Try this first because enemies often overlap path tiles.
    for (const e of state.enemies.values()) {
      const r = e.isBoss ? GRID.TILE * 1.0 : GRID.TILE * 0.55;
      if (Math.hypot(e.x - x, e.y - y) <= r) {
        showEnemyInspect(app, e);
        return;
      }
    }

    // 2026-05-15 TIGHT-CLICK FIX: tower sprites render at 1.5× tile size
    // (48px on a 32px grid), so the visible edges spill 8px into adjacent
    // tiles. When the player clicks on the *visual* part of a tower whose
    // center sits in the next tile, vanilla tile resolution lands on the
    // empty grass underneath and the click does nothing. Snap to the
    // nearest tower center within a 0.75-tile radius so those near-miss
    // clicks still register on the tower the player obviously meant.
    //
    // Only kicks in when the resolved tile is EMPTY — TOWER, STONE, GATE,
    // SPAWN, WAYPOINT all retain their direct-tile semantics so we never
    // hijack a legitimate "click on empty grass to roll a prospect" gesture
    // unless a neighbor sprite is closer than the player's own tile center.
    //
    // ALSO skip the snap when the player has an active placement intent
    // (selected card OR a queued purchased-tower placement) — in those
    // modes the empty tile is the desired target, and snapping would
    // misroute the click to the neighbor tower's inspect panel.
    const hasPlacementIntent =
      state.selectedCard !== null ||
      ((state.pendingPurchasedTowers ?? []).length > 0);
    if (tile === TileType.EMPTY && !hasPlacementIntent) {
      const snapR = GRID.TILE * 0.75;       // 24px — covers full sprite halo
      let best: { tw: any; d: number } | null = null;
      for (const tw of state.towers.values()) {
        const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
        const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
        const d = Math.hypot(cx - x, cy - y);
        if (d <= snapR && (!best || d < best.d)) best = { tw, d };
      }
      if (best) {
        // Only snap if the candidate tower's center is closer than the
        // center of the empty tile we landed on. Prevents accidental
        // hijacks when the player is clearly aiming at open grass.
        const emptyCx = col * GRID.TILE + GRID.TILE / 2;
        const emptyCy = row * GRID.TILE + GRID.TILE / 2;
        const emptyD = Math.hypot(emptyCx - x, emptyCy - y);
        if (best.d < emptyD) {
          col = best.tw.tileX;
          row = best.tw.tileY;
          tile = TileType.TOWER;
        }
      }
    }

    // Click on the Roman GATE tile (or its immediate footprint) opens the Gate Shop.
    if (tile === TileType.GATE && isPreWavePhase()) {
      if (!gateShop) gateShop = buildGateShop(state.wave, currentlyOwnedLegendarySet(state, inventory));
      renderShop(app, gateShop, state, inventory, {
        onClose: () => { document.getElementById('shop-modal')?.remove(); }
      });
      return;
    }

    // During all pre-wave placement states, every existing tower/stone is inspectable.
    if (isPreWavePhase() && tile === TileType.TOWER) {
      const tw = Array.from(state.towers.values()).find(t => t.tileX === col && t.tileY === row);
      if (tw) {
        inspectTower(tw);
        return;
      }
    }
    if (isPreWavePhase() && tile === TileType.STONE) {
      inspectStone(col, row);
      return;
    }

    // PURCHASED-TOWER PLACEMENT: pops the FRONT of the queue. Both Mercator
    // purchases and quest rewards append here so they never collide.
    const queue = state.pendingPurchasedTowers ?? [];
    if (queue.length > 0 && tile === TileType.EMPTY) {
      setTile(state, col, row, TileType.TOWER);
      const np = buildGroundPath(state);
      if (!np) {
        setTile(state, col, row, TileType.EMPTY);
        showBlockedAlert(col, row, 'That tile would seal the path — enemies couldn\'t reach Rome. Try one tile over.');
        return;
      }
      state.groundPath = np;
      resnapEnemiesToPath(state, np);
      const head = queue.shift()!;
      const tw = createTower(head.type as TowerType, head.tier as 1|2|3|4|5, col, row, state.wave);
      state.towers.set(tw.id, tw);
      state.pendingPurchasedTowers = queue;
      state.pendingPurchasedTower = null;
      const remaining = queue.length;
      state.hint = remaining > 0
        ? `Placed ${head.type.replace(/_/g,' ')} T${head.tier}. ${remaining} purchased tower${remaining > 1 ? 's' : ''} still waiting.`
        : `Placed ${head.type.replace(/_/g,' ')} T${head.tier}.`;
      return;
    }

    // 2026-05 v11: during PROSPECT_PLACEMENT, clicking an existing tower
    // (kept OR pending prospect) opens the full tower menu so the player
    // can COMBINE existing towers before they commit to placing more
    // prospects. Previously this bounced with "Empty grass only" which
    // blocked the natural "merge first, then roll more" flow between waves.
    if (state.phase === GamePhase.PROSPECT_PLACEMENT && tile === TileType.TOWER) {
      const tw = Array.from(state.towers.values()).find(t => t.tileX === col && t.tileY === row);
      if (tw) {
        inspectTower(tw);
        return;
      }
    }

    // PROSPECT_PLACEMENT: each empty-tile click costs 1g and reveals one
    // prospect. Hard cap of 10 prospects per round (2026-05 v11: 8 → 10)
    // — past that, the player must KEEP picks and start the wave. Press
    // START WAVE (or click tile-less area / shop) when done; unkept
    // prospects convert to walls.
    if (state.phase === GamePhase.PROSPECT_PLACEMENT) {
      if (tile !== TileType.EMPTY) { state.hint = 'Empty grass only. The other tiles are spoken for.'; return; }
      if (state.prospectsPlaced >= 10) {
        state.hint = 'Ten prospects is the Senate-approved limit. Press START WAVE and let them prove themselves.';
        // 2026-05 v10 — once per round, fire the Smash Bros
        // "Choose your character" cue at the 10-prospect cap so the
        // player feels the moment of choice. Stamped state flag dedupes.
        if (!(state as any).__chooseCharFiredThisRound) {
          (state as any).__chooseCharFiredThisRound = true;
          playMusicTrack('choose-char', sfx('assets/sfx/smash_bros_choose.mp3'), { loop: false, gain: 0.55 });
        }
        return;
      }
      if (state.gold < 1) {
        // 2026-05 v10: surface insufficient-gold as a floating tooltip,
        // not just a status hint. Players were missing the hint and
        // clicking repeatedly without realising they were broke.
        showBlockedAlert(col, row, `Need 1g to roll a prospect — treasury is empty. Press START WAVE.`);
        // 2026-05 v10 — also fire the Choose-Your-Character cue when
        // the player has placed prospects but exhausted their gold
        // before keeping any — they're stuck on the keep decision.
        if (state.prospectsPlaced > 0 && (state.keepsRemainingThisRound ?? 0) > 0 && !(state as any).__chooseCharFiredThisRound) {
          (state as any).__chooseCharFiredThisRound = true;
          playMusicTrack('choose-char', sfx('assets/sfx/smash_bros_choose.mp3'), { loop: false, gain: 0.55 });
        }
        return;
      }
      // Auto-refill the queue if it ran dry. The pool RNG still applies to
      // every roll — players can spam at L0 but only see T1/T2 most of the
      // time. Higher pool levels make repeat rolling more lucrative, which
      // is the intended power curve.
      if (state.prospectQueue.length === 0) {
        state.prospectQueue = rollDraw(state, BASE_TOWER_TYPES);
      }
      // Path validation
      setTile(state, col, row, TileType.TOWER);
      const np = buildGroundPath(state);
      if (!np) {
        setTile(state, col, row, TileType.EMPTY);
        showBlockedAlert(col, row, 'That prospect would close the route. Place it one tile over so the path stays open.');
        return;
      }
      state.groundPath = np;
      resnapEnemiesToPath(state, np);
      spendGold(state, 1);                  // 1g per prospect placement
      const card = state.prospectQueue.shift()!;
      const t = createTower(card.type, card.tier, col, row, state.wave, true);
      if ((card as any).__duplicateBumped) (t as any).duplicateBumped = (card as any).__duplicateBumped;
      state.towers.set(t.id, t);
      state.prospectsPlaced += 1;
      // 2026-05 v11: user-supplied bumper SFX every time a prospect lands.
      SFX.prospectPlace();
      state.towersBuilt = (state.towersBuilt ?? 0) + 1;
      // 2026-05-19 — One-time learning tip the FIRST time a player ever
      // places a prospect. Surfaces the click-to-inspect interaction so
      // they discover the full tower UI (stats, items, RECIPES). Stored
      // in localStorage so it never fires again after first dismiss.
      if (!localStorage.getItem('roman_td_seen_inspect_tip')) {
        localStorage.setItem('roman_td_seen_inspect_tip', '1');
        showInspectTip();
      }
      const remainingProspects = Math.max(0, 10 - state.prospectsPlaced);
      state.hint = remainingProspects > 0
        ? `Rolled ${towerName(t.type)} T${t.qualityTier} (-1g). ${remainingProspects} more roll${remainingProspects === 1 ? '' : 's'} before the Senate cuts you off.`
        : `Rolled ${towerName(t.type)} T${t.qualityTier} (-1g). Ten prospects is the limit. Press START WAVE.`;
      return;
    }

    // PICK_KEEPER: only tower clicks open the keep menu
    if (state.phase === GamePhase.PICK_KEEPER) {
      if (tile === TileType.TOWER) {
        const tw = Array.from(state.towers.values()).find(t => t.tileX === col && t.tileY === row);
        if (tw) {
          selectedTowerId = tw.id;
          renderer.selectedTowerId = tw.id;
          state.hint = `${towerName(tw.type)} T${tw.qualityTier}: range shown. Choose KEEP, PUT BACK, or inspect another prospect.`;
          inspectTower(tw);
        }
      } else {
        state.hint = 'Click a glowing prospect to promote it. The non-believers cement into stone.';
      }
      return;
    }

    // Tower click during WAVE phase: open inspect-only menu (read-only stats)
    if (state.phase === GamePhase.WAVE_PHASE && tile === TileType.TOWER) {
      const tw = Array.from(state.towers.values()).find(t => t.tileX === col && t.tileY === row);
      if (tw) {
        selectedTowerId = tw.id;
        renderer.selectedTowerId = tw.id;
        showTowerMenu(app, tw, state, inventory, {
          onClose: () => document.getElementById('tower-menu')?.remove(),
          onPathRefresh: () => {},
        });
      }
      return;
    }
    // Stone placement is allowed in any pre-wave phase (PROSPECT_PLACEMENT, PICK_KEEPER, BUILD_PHASE)
    // — players can interleave stones with prospects however they want. Other actions
    // (regular tower placement from a card draw) are still BUILD_PHASE-only.
    if (state.phase !== GamePhase.BUILD_PHASE) return;

    // Tower click → tower-menu modal (sell/downgrade/target/equip/combine)
    if (tile === TileType.TOWER) {
      const tw = Array.from(state.towers.values()).find(t => t.tileX === col && t.tileY === row);
      if (tw) {
        inspectTower(tw);
        return;
      }
    }
    // Stone mode and stone-toggle removed — prospects are now the unified
    // "place a tile" mechanic. Unkept prospects auto-convert to walls when
    // the wave starts. The "Maze Builder" quest tracks tile placements
    // generally now, since stones-as-such no longer exist.

    // Tower placement from selected card
    if (state.selectedCard === null) return;
    const card = state.draw[state.selectedCard];
    const cost = ECONOMY.TIER_PLACE_COST[card.tier];
    if (!canAfford(state, cost)) {
      // 2026-05 v9: surface insufficient-gold as a floating toast above
      // the click target so the player notices even when their eyes are
      // on the tile, not the HUD hint bar.
      // 2026-05-17 — Forward world-zoom transform for DOM-space toast.
      showInsufficientGoldToast(cost, WORLD.OFFSET_X + (col * 32 + 16) * WORLD.ZOOM, WORLD.OFFSET_Y + (row * 32 - 6) * WORLD.ZOOM);
      state.hint = `The treasury wants ${cost}g you don't have. Kill more enemies.`;
      return;
    }
    if (!isBuildable(state, col, row)) { state.hint = 'That tile won\'t hold a tower. Try one that the engineers approve of.'; return; }
    // path validation
    setTile(state, col, row, TileType.TOWER);
    const newPath = buildGroundPath(state);
    if (!newPath) {
      setTile(state, col, row, TileType.EMPTY);
      showBlockedAlert(col, row, 'That placement would block the path — enemies need a route from the cave to Rome.');
      return;
    }
    state.groundPath = newPath;
    resnapEnemiesToPath(state, newPath);
    spendGold(state, cost);
    const t = createTower(card.type as TowerType, card.tier, col, row, state.wave);
    if (t.isAerarium) state.goldTowerCount += 1;
    state.towers.set(t.id, t);
    state.towersBuilt = (state.towersBuilt ?? 0) + 1;
    const placedCard = card;
    const placedIdx = state.selectedCard;
    state.draw.splice(state.selectedCard, 1);
    state.selectedCard = null;
    placementUndo.set(t.id, { card: placedCard, cost, index: placedIdx, col, row });
    state.hint = `Placed ${towerName(card.type)} T${card.tier}.`;
    pushAction(`Placed ${towerName(card.type)} T${card.tier}`,
      () => { setTile(state, col, row, TileType.EMPTY); state.towers.delete(t.id); placementUndo.delete(t.id); if (t.isAerarium) state.goldTowerCount = Math.max(0, state.goldTowerCount - 1); earnGold(state, cost); state.draw.splice(placedIdx, 0, placedCard); const p = buildGroundPath(state); if (p) { state.groundPath = p; resnapEnemiesToPath(state, p); } },
      () => { setTile(state, col, row, TileType.TOWER); state.towers.set(t.id, t); placementUndo.set(t.id, { card: placedCard, cost, index: placedIdx, col, row }); if (t.isAerarium) state.goldTowerCount += 1; spendGold(state, cost); state.draw.splice(placedIdx, 1); const p = buildGroundPath(state); if (p) { state.groundPath = p; resnapEnemiesToPath(state, p); } }
    );
  } // end _handleCanvasClick

  // Keyboard shortcuts
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'c') { showCodex(app, { poolLevel: state.poolLevel, heroLevel: state.heroLevel, totalKills: state.totalKills, towers: Array.from(state.towers.values()).map(t => ({ type: String(t.type), qualityTier: t.qualityTier, pending: !!t.pending })), completedQuests: state.completedQuests ?? [] }); }
    else if (k === 'b' || k === 'g') {
      // B / G: always the gate shop. Mercator has its own button + the
      // floating banner, so keys don't fight over which vendor opens.
      if (state.phase === GamePhase.BUILD_PHASE) {
        if (!gateShop) gateShop = buildGateShop(state.wave, currentlyOwnedLegendarySet(state, inventory));
        renderShop(app, gateShop, state, inventory, { onClose: () => document.getElementById('shop-modal')?.remove() });
      }
    }
    else if (k === 'm') {
      // M: open the Mercator if he's in town. No-op otherwise.
      if (mercatorActive && state.phase === GamePhase.BUILD_PHASE) {
        if (!mercatorShop) {
          mercatorShop = buildMercatorStock(state.wave, currentlyOwnedLegendarySet(state, inventory));
          mercatorShop.towerOffers = buildMercatorTowerOffers(state.wave, 5);
        }
        renderShop(app, mercatorShop, state, inventory, { onClose: () => document.getElementById('shop-modal')?.remove() });
      }
    }
    // 2026-05-19 — SPACE start-wave hotkey removed. Players were
    // accidentally launching waves with stray taps during placement;
    // the explicit START WAVE button is the only way now.
    else if (k === 'escape') {
      // 2026-05-19 — Universal ESC: close ANY open modal. Adds the
      // major modals we've shipped since the original 3 (tower /
      // shop / codex):
      //   • tower-leaderboard (live wave breakdown)
      //   • enemy-inspect (click-on-enemy details)
      //   • settings-panel / pause-overlay aren't modals, skip
      //   • surprise-reward-modal — pause-blocking, ESC closes
      //   • inventory-modal — already had its own ESC, this is a
      //     belt-and-suspenders catch
      //   • mercator-shop / gate-shop both render through shop-modal
      //   • dps-check-summary
      //   • settings-panel
      const modalsToClose = [
        'tower-menu', 'shop-modal', 'codex-modal', 'tower-leaderboard',
        'enemy-inspect', 'surprise-reward-modal', 'inventory-modal',
        'dps-check-summary', 'settings-panel', 'hall-of-glory',
        'end-summary', 'endless-failure', 'pick-keeper-guide',
        'final-hour-hype', 'boss-warning-1', 'boss-warning-2',
        'final-boss-hp'
      ];
      for (const id of modalsToClose) document.getElementById(id)?.remove();
      // Also clear any in-flight "click a row" modes triggered by the
      // SELL STONES button — pressing ESC mid-mode aborts cleanly.
      if ((state as any).__sellStoneMode) {
        (state as any).__sellStoneMode = false;
        (state as any).__sellStoneSelection = new Set<string>();
      }
    }
  });

  // 2026-05 v11 (B1 Pause helpers).
  function updatePauseOverlay() {
    let overlay = document.getElementById('pause-overlay');
    if (paused || autoPaused) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'pause-overlay';
        overlay.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:90;pointer-events:none;font-family:'Courier New',monospace;color:#ffd34d;font-size:42px;font-weight:bold;letter-spacing:8px;text-shadow:3px 3px 0 #000`;
        document.getElementById('stage-wrap')?.appendChild(overlay);
      }
      overlay.textContent = autoPaused ? '⏸ AUTO-PAUSED' : '⏸ PAUSED';
    } else if (overlay) {
      overlay.remove();
    }
  }
  // Pause when tab loses focus, auto-resume only if not manually paused.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!paused) { autoPaused = true; updatePauseOverlay(); }
    } else {
      if (autoPaused) { autoPaused = false; updatePauseOverlay(); }
    }
  });
  // P hotkey toggles pause (skips while typing in inputs — same guard as
  // the existing C/M/B/G hotkeys further down the file).
  // ESC cancels the SELL STONES selection mode without selling anything.
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key.toLowerCase() === 'p') {
      paused = !paused;
      autoPaused = false;
      const btn = document.getElementById('pause-btn') as HTMLButtonElement | null;
      if (btn) {
        btn.textContent = paused ? '▶ RESUME' : '⏸ PAUSE';
        btn.style.background = paused ? '#5a3a1a' : '#222';
      }
      updatePauseOverlay();
    }
    if (e.key === 'Escape' && (state as any).__sellStoneMode) {
      (state as any).__sellStoneMode = false;
      (state as any).__sellStoneSelection = new Set<string>();
      updateSellStonesButton();
      state.hint = 'Stone-sell cancelled — no stones removed.';
    }
  });

  // Game loop. Use setInterval (not RAF) so the loop keeps running when the
  // page is in a hidden / iframe context (Claude Preview, background tabs).
  let last = performance.now();
  function frame() {
    const now = performance.now();
    let dt = (now - last) / 1000;
    if (dt > 0.1) dt = 0.1;
    last = now;
    // 2026-05 v11: when paused, skip gameplay-time advance but still run
    // the render path so the screen doesn't freeze (overlay sits on top).
    // 2026-05-16: surprise-reward modal also forces a hard pause so the
    // player can decide strategically (per the design lock — "pauses the
    // game so they can choose strategically").
    const rewardModalOpen = !!(state as any).__surpriseRewardOpen;
    if (paused || autoPaused || rewardModalOpen) {
      dt = 0;
    } else {
      dt *= speedMult;     // fast-forward applied uniformly to game-time delta
    }
    state.tick += dt;
    // 2026-05-17 — REWARD MODAL TRIGGER (relocated). Fires the instant
    // pendingSurpriseReward is set, regardless of game phase. Previous
    // placement was inside the WAVE_PHASE conditional, but WaveManager's
    // checkWaveEnd transitions to BUILD_PHASE in the same tick that
    // sets the flag — the modal trigger then sat dormant until the
    // NEXT wave's WAVE_PHASE ran, opening the modal at the wrong time.
    // Moving the check out here means the modal opens within ~16ms of
    // the last enemy dying (or leaking), exactly when the player
    // expects the "you survived the invasion" payoff.
    if (state.pendingSurpriseReward && !(state as any).__surpriseRewardModalShown) {
      (state as any).__surpriseRewardModalShown = true;
      const kind = state.pendingSurpriseReward.kind;
      state.pendingSurpriseReward = null;
      showSurpriseRewardModal(app, kind, inventory, state, () => {
        (state as any).__surpriseRewardModalShown = false;
        // 2026-05-18 — Stacked-event handling. If the player resolved
        // multiple events back-to-back, there may be queued rewards
        // waiting. Pop the next one and let main's per-tick check
        // fire it on the next frame. Only clear surprise state once
        // ALL queued rewards are processed.
        if (state.queuedSurpriseRewards && state.queuedSurpriseRewards.length > 0) {
          state.pendingSurpriseReward = state.queuedSurpriseRewards.shift()!;
        } else {
          clearSurpriseEventsForWaveEnd(state);
        }
      });
    }
    if (state.phase === GamePhase.WAVE_PHASE) {
      tickSpawns(state, dt);
      // 2026-05-16 — SURPRISE EVENTS tick. Drains the 4-point spawn
      // schedule for the active Invasion / Uprising. Fires the
      // sinister-sting audio + camera shake on the FIRST spawn of an
      // active event (one-shot, gated by __surpriseEventStingFired).
      tickSurpriseEvents(state);
      // 2026-05-18 — Iterate primary + extras. Each event fires its
      // own sting + camera shake once its first spawn lights up. The
      // info chip shows only for the FIRST event to fire (avoids 3
      // overlapping chips on a triple-stacked endless wave). The
      // sting-fired tracker is per-event, keyed by ev.startedAt
      // (unique per scheduling).
      const stingFired: Set<number> = ((state as any).__surpriseStingFired ??= new Set<number>());
      // Iterate every active event — primary + extras.
      // Build the array inline so it's only one allocation per frame.
      const allActiveEvs: any[] = [];
      if (state.activeSurpriseEvent) allActiveEvs.push(state.activeSurpriseEvent);
      if (state.extraSurpriseEvents) for (const ex of state.extraSurpriseEvents) allActiveEvs.push(ex);
      for (const ev of allActiveEvs) {
        if (stingFired.has(ev.startedAt)) continue;
        if (!ev.spawnPoints.some((p: any) => p.fired)) continue;
        stingFired.add(ev.startedAt);
        surpriseEventSting(ev.kind);
        if (renderer?.triggerShake) renderer.triggerShake(6, 0.45);
        // Only the first event in this session pops the explanatory
        // chip. If multiple events stack in endless, the player just
        // sees the screen go nuclear and feels the chaos — no chip
        // pile-up.
        if (stingFired.size === 1) {
          showSurpriseEventInfoChip(ev.kind === 'INVASION' ? 'INVASION' : ev.kind === 'UPRISING' ? 'UPRISING' : 'GATES_OF_HELL');
        } else if (stingFired.size === 2) {
          // Quick HUD hint that more is coming.
          state.hint = '⚠ ANOTHER EVENT JUST OPENED — endless chaos stacks';
        } else if (stingFired.size === 3) {
          state.hint = '☠ A THIRD EVENT ON THE SAME WAVE — Rome will not forget this run';
        }
      }
      if (allActiveEvs.length === 0) {
        // Reset when no events active so the next event re-fires the sting.
        stingFired.clear();
      }
      // Bonus-boss announcement: WaveManager sets this when a surprise boss arrives.
      if ((state as any).bonusBossAnnouncement) {
        showBonusBossBanner((state as any).bonusBossAnnouncement);
        (state as any).bonusBossAnnouncement = null;
        // 2026-05 v6: announcement grants a free UNCOMMON item as a
        // "warning consolation" — the boss just showed up uninvited.
        // The real RARE+ reward fires on KILL (see onKill bonus-boss
        // handler) so success gives the bigger payoff, not just arrival.
        grantBonusItem('UNCOMMON');
      }
      // BOSS REBIRTH ANNOUNCEMENT (2026-05 v6): if any boss leaked last
      // wave, WaveManager queued them for respawn with the HP they had
      // at leak time. Fire a banner so the player knows what's coming
      // and at what HP — actionable info, not just a surprise.
      if ((state as any).pendingRebornBosses && (state as any).pendingRebornBosses > 0) {
        const n = (state as any).pendingRebornBosses;
        const carry: any[] = (state as any).__pendingBossCarry ?? [];
        const fractions = carry.map(c => Math.max(1, Math.round((c.hpFraction ?? 1) * 100)));
        const fracStr = fractions.length > 0 ? ` AT ${fractions.join('% / ')}%` : '';
        showBonusBossBanner(`☠ ${n === 1 ? 'A LEAKED BOSS RETURNS' : `${n} LEAKED BOSSES RETURN`}${fracStr} HP`);
        (state as any).pendingRebornBosses = 0;
      }
      applyEnemyAuras(state);
      tickBossScripts(state, dt, bossRuntime, waveStartTick);
      tickBurnPatches(state, dt);
      tickBossHazards(state, dt);
      // 2026-05 v10 — BOSS LOW-HP CUE. Per-frame scan: if ANY boss on
      // the field drops below 25% HP and hasn't already triggered the
      // "FINISH HIM" sample this wave, fire it once. `__finishHimFired`
      // stamp prevents replays on the same boss; cleared at wave-end.
      for (const e of state.enemies.values()) {
        if (!e.isBoss || e.hp <= 0) continue;
        if ((e as any).__finishHimFired) continue;
        if (e.hp / e.maxHp <= 0.25) {
          (e as any).__finishHimFired = true;
          SFX.finishHim();
        }
      }
      tickEnemies(state, dt,
        (e) => {
          // 2026-05 v11 DPS CHECK: training-dummy leaks deal NO damage. The
          // dummy walked the maze for damage measurement; reaching Rome
          // fires the summary popup and frees the DPS-CHECK button so the
          // player can run it again. NO lives lost, NO wave count, NO
          // gateBreach SFX (a softer chime instead).
          if (e.isDpsCheck) {
            showDpsCheckSummary(e, /*killed=*/false);
            return;
          }
          // W20 LOCKDOWN (2026-05): the final wave does not allow ANY leaks.
          // A single enemy reaching Rome on W20 zeros lives and ends the run
          // immediately — Rome falls if you can't hold the gate.
          if (state.wave === 20) {
            state.lives = 0;
            state.enemiesLeakedThisWave++;
            state.leaksByArchetype[e.archetype] = (state.leaksByArchetype[e.archetype] ?? 0) + 1;
            renderer.triggerGateImpact();
            renderer.triggerShake(8, 1.0);
            SFX.gateBreach(true);
            state.hint = '☠ ROME HAS FALLEN — W20 admits no leaks.';
            if (state.gameOverAt < 0) state.gameOverAt = state.tick;
            return;
          }
          state.lives -= e.livesCost;
          state.enemiesLeakedThisWave++;
          state.leaksByArchetype[e.archetype] = (state.leaksByArchetype[e.archetype] ?? 0) + 1;
          renderer.triggerGateImpact();
          if (e.isBoss) renderer.triggerShake(5, 0.5);
          // Auditory leak confirmation — heavy gate-clang. Boss leaks get
          // the deeper, more dramatic variant.
          SFX.gateBreach(e.isBoss);
          // 2026-05 v6: BOSS LEAK ALERT. When a boss reaches Rome, surface
          // a big red banner explaining what just happened and what's
          // coming next wave (rebirth at carried HP). Players otherwise
          // can miss the implication if they're focused mid-battle.
          if (e.isBoss) {
            const carryPct = Math.max(1, Math.round((e.hp / e.maxHp) * 100));
            const bossDef: any = (enemiesData as any)[e.type];
            const bossName = bossDef?.name ?? e.type.replace(/_/g, ' ');
            // Use the existing showBossBanner shape so the visual matches
            // the boss-arrival banner the player already recognizes.
            const factionKey = bossDef?.faction;
            showBossBanner(`☠ ${bossName.toUpperCase()} REACHED ROME — REBORN NEXT WAVE AT ${carryPct}% HP`, factionKey);
            state.hint = `☠ ${bossName} leaked at ${carryPct}% HP — he returns next wave with that HP.`;
          }
          // GHOST RIDER signature: on leak, also steal gold (5g + 1g per wave/10).
          // Punishes letting them through, adds to their thematic threat.
          if (e.type === 'GHOST_RIDER') {
            const stolen = Math.min(state.gold, 5 + Math.floor(state.wave / 10));
            if (stolen > 0) {
              state.gold -= stolen;
              state.hint = `💀 GHOST RIDER STOLE ${stolen}g!`;
            }
          }
          if (state.lives <= 0 && state.gameOverAt < 0) state.gameOverAt = state.tick;
          // 2026-05-16 — surprise-event enemies that leak still count as
          // "resolved" for reward-modal purposes (a leak removes them from
          // the active spawn pool just like a kill does).
          notifySurpriseEnemyResolved(state, e.id);
        },
        (e) => {
          // 2026-05 v11 DPS CHECK: if the player ACTUALLY killed the dummy,
          // celebrate with the summary popup (marked killed=true).
          if (e.isDpsCheck) {
            showDpsCheckSummary(e, /*killed=*/true);
            return;
          }
          // 2026-05-16 — surprise-event resolution check (death path).
          notifySurpriseEnemyResolved(state, e.id);
          // 2026-05-17 — GATES OF HELL. If a HELL_GATE just died, mark
          // its pointId destroyed so future fire-giant spawns from
          // that gate get skipped. If a FIRE_GIANT just died, drop a
          // burn-ground tile on its corpse that lasts the rest of the
          // wave.
          if (e.type === 'HELL_GATE' && typeof (e as any).__surprisePointId === 'number') {
            notifyHellGateDestroyed(state, (e as any).__surprisePointId);
            // Dramatic shatter VFX: fire-ring eruption + screen shake +
            // ember burst at the gate's center. The gate sprite will
            // fade naturally via the regular enemy-death animation
            // hook in the renderer.
            try {
              renderer.triggerImpactRing?.(e.x, e.y, state.tick, 56, 0xff8833);
              renderer.triggerImpactRing?.(e.x, e.y, state.tick + 0.08, 92, 0xff5511);
              renderer.triggerImpactRing?.(e.x, e.y, state.tick + 0.16, 132, 0xaa1010);
              renderer.triggerShake?.(6, 0.7);
            } catch { /* renderer hooks optional */ }
          }
          if (e.type === 'FIRE_GIANT') {
            // Permanent (wave-long) burn patch at the giant's death
            // tile. Uses the existing burnPatches system with a huge
            // `life` so it survives until clearWaveState wipes the
            // array at wave end. sourceTier 5 = max DoT.
            const patches = state.burnPatches ?? (state.burnPatches = []);
            patches.push({
              id: 'fg-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
              x: e.x,
              y: e.y,
              born: state.tick,
              life: 9999,            // effectively wave-end-bound
              sourceTier: 5
            });
            // Dramatic fire-pillar eruption on death.
            try {
              renderer.triggerImpactRing?.(e.x, e.y, state.tick, 42, 0xff7733);
              renderer.triggerImpactRing?.(e.x, e.y, state.tick + 0.10, 68, 0xff4411);
              renderer.triggerShake?.(4, 0.4);
            } catch { /* optional */ }
          }
          state.enemiesKilledThisWave++;
          state.score += Math.round(10 * e.maxHp / 10);
          // BLOATED mutation: explode into 3 minions of the same base type at
          // half HP, mid-path. Forces the player to keep killing.
          if (e.mutation === 'BLOATED') {
            const w = wavesData[state.wave - 1];
            for (let i = 0; i < 3; i++) {
              const minion = spawnEnemy(state, e.type as any, w.hpMult * 0.5);
              minion.x = e.x + (Math.random() - 0.5) * 24;
              minion.y = e.y + (Math.random() - 0.5) * 24;
              minion.pathIndex = e.pathIndex;
              minion.pathProgress = e.pathProgress;
              minion.mutation = undefined;
            }
            state.hint = `💥 Bloated burst: 3 minions spawned!`;
          }
          // ─── WAVE MODIFIER death triggers ─────────────────────────
          // DEATH_PACT — every kill heals every surviving enemy 4% maxHp.
          if (state.waveModifier === 'DEATH_PACT') {
            for (const o of state.enemies.values()) {
              if (o.id === e.id) continue;
              o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.04);
              o.hpFlashTimer = 0.18;
            }
          }
          // REVENANT — silence the nearest tower for 4s as the ghost passes.
          if (state.waveModifier === 'REVENANT') {
            let closest: any = null;
            let bestD = Infinity;
            for (const tw of state.towers.values()) {
              if (tw.pending) continue;
              const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
              const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
              const d = Math.hypot(cx - e.x, cy - e.y);
              if (d < bestD) { bestD = d; closest = tw; }
            }
            if (closest && bestD < 5 * GRID.TILE) {
              closest.silencedUntil = state.tick + 1.5;
              closest.attackCooldown = Math.max(closest.attackCooldown, 1.5);
            }
          }
        }
      );
      const combatHooks = {
        onHit: (t: any, e: any, d: number, resMod = 1, isCrit = false) => {
          // 2026-05 v6: blood spray now ONLY fires when the target is
          // actively BLEEDING — non-bleed hits show damage-type sparks /
          // typed impacts only (sword strike, arrow puncture, divine flash)
          // without the gory red particle stream. Previously every hit
          // produced blood which made every fight look like a slaughter
          // regardless of the actual damage type.
          const hasBleed = e.statusEffects.some((s: any) => s.kind === 'BLEED');
          if (hasBleed) emitHitSplatter(gore, e.x, e.y, false);
          emitHitSpark(gore, e.x, e.y);
          // Damage-type-specific impact (Animation Doc §17.3-6)
          if (t) emitTypedImpact(gore, e.x, e.y, t.damageType);
          // Status-specific impact (poison cloud / frost burst / burn embers)
          for (const s of e.statusEffects) {
            // Only emit when first applied — heuristic: full duration left
            if (s.remaining > 0.95 * 6) emitStatusImpact(gore, e.x, e.y, s.kind);
          }
          // CRIT-ONLY FLOATERS (2026-05): the damage-number stream above the
          // towers was visually noisy when every hit emitted a number. Now we
          // ONLY emit a floater when the originating tower's last attack was a
          // real crit (per CombatResolver's `__lastWasCrit` flag). MISS floaters
          // still fire — they're rare and the player needs that feedback.
          // 2026-05 v11 (B8 Crit Punch): pass the isCrit flag through so
          // emitFloatingNumber renders the crit at 1.6× scale + gold with
          // a "CRIT!" tag. Also stamp the renderer with a tiny shake on
          // crits to sell the impact. The existing __lastWasCrit read is
          // still a safety net for any path that didn't thread isCrit.
          const wasCrit = isCrit || !!(t && (t as any).__lastWasCrit);
          // Weather-miss override: distinct grey "MISS!" floater instead of damage.
          const weatherMissed = (e as any).__weatherMissTick === state.tick && d === 0;
          if (weatherMissed) {
            emitFloatingNumber(gore, e.x, e.y - 4, 0, 0xaaaaaa);
            const last = gore.numbers[gore.numbers.length - 1];
            if (last) { last.text = 'MISS!'; last.life = 0.7; last.vy = -40; }
          } else if (wasCrit) {
            // 2026-05 v11: anchor the crit floater on the FIRING TOWER, not
            // the enemy. Keeps player attention on the tower that earned the
            // crit and stops the number from drifting away with the moving
            // enemy. Falls back to enemy position if tower is missing.
            const cx = t ? t.tileX * GRID.TILE + GRID.TILE / 2 : e.x;
            const cy = t ? t.tileY * GRID.TILE - 4              : e.y;
            emitFloatingNumber(gore, cx, cy, d, 0xffd34d, true);
            // Trigger a tiny screen shake so the hit reads physical.
            if (renderer?.triggerShake) renderer.triggerShake(2.5, 0.12);
          }
          if (t) {
            t.totalDamageDealt += d;
            t.damageThisWave += d;
            if (e.isBoss) t.bossDamageDealt += d;
          }
        },
        onMeleeSwing: (t: any, e: any, _d: number) => {
          // Same BLEED-gate as onHit — melee swings only produce blood
          // spray when the target is actively bleeding. Sword-impact
          // visuals + slash arc sprites still play unconditionally.
          const hasBleed = e.statusEffects.some((s: any) => s.kind === 'BLEED');
          if (hasBleed) emitHitSplatter(gore, e.x, e.y, false);
          // Distinct melee audio per role family. Combo melees use their unique sounds.
          const COMBO_MELEE_SFX: Record<string, () => void> = {
            HORSEMAN: SFX.comboHorseman,
            COHORT_GUARD: SFX.comboCohortGuard,
            PRAETORIAN_WALL: SFX.comboPraetorianWall
          };
          if (t && COMBO_MELEE_SFX[t.type]) {
            COMBO_MELEE_SFX[t.type]();
          } else {
            const HEAVY_SET = new Set(['CENTURION','PRIMUS_PILUS','IMPERATOR_GUARD','CATAPHRACT','EVOCATUS']);
            const SPEAR_SET = new Set(['HASTATI','TRIARIUS']);
            if (t && HEAVY_SET.has(t.type)) SFX.meleeSwordHeavy();
            else if (t && SPEAR_SET.has(t.type)) SFX.meleeSpear();
            else SFX.meleeSwordLight();
          }
          if (t) {
            const sx = t.tileX * GRID.TILE + GRID.TILE / 2;
            const sy = t.tileY * GRID.TILE + GRID.TILE / 2;
            const angle = Math.atan2(e.y - sy, e.x - sx);
            const HEAVY = new Set(['PRIMUS_PILUS','TRIARIUS','CENTURION','COHORT_GUARD','PRAETORIAN_WALL','IMPERATOR_GUARD','EVOCATUS','CATAPHRACT','HORSEMAN']);
            // 2026-05-18: heavy multiplier 1.3 → 1.5. Paired with the
            // restored base slash size (RenderEngine.triggerMeleeSlash:
            // 18 → 26 px). Heavy hits now visibly dominate over light
            // ones without being overwhelming on stacked combat frames.
            const size = HEAVY.has(t.type) ? 1.5 : 1.0;
            // 2026-05 v10 — pass cleave flag so cleavers draw a wider
            // primary slash + a trailing echo arc on every swing.
            const cleaver = hasCleave(t);
            renderer.triggerMeleeSlash(e.x, e.y, angle, state.tick, size, cleaver);
            if (e.isBoss && HEAVY.has(t.type)) renderer.triggerShake(2, 0.12);
          }
        },
        onProjectileFire: (t: any, target: any, _d: number) => {
          // Combo towers get unique signature audio.
          const COMBO_SFX: Record<string, () => void> = {
            SCORPION_BOLT: SFX.comboScorpionBolt,
            WAR_CHARIOT: SFX.comboWarChariot,
            EAGLE_STANDARD: SFX.comboEagleStandard,
            PLAGUE_CART: SFX.comboPlagueCart,
            NUMIDIAN_CAVALRY: SFX.comboNumidian,
            AERARIUM: SFX.comboAerarium,
            SIEGE_ONAGER: SFX.comboSiegeOnager,
            AQUILIFER_TITAN: SFX.comboAquilifer,
            INFERNO_CART: SFX.comboInfernoCart,
            FROZEN_LEGION: SFX.comboFrozenLegion,
            JULIUS_CAESAR: SFX.comboJuliusCaesar,
            HANNIBALS_NIGHTMARE: SFX.comboHannibal,
            GOD_OF_WAR: SFX.comboGodOfWar
          };
          if (t && COMBO_SFX[t.type]) {
            COMBO_SFX[t.type]();
          } else if (t.type === 'SCORPIO') {
            SFX.ballista();
          } else if (t.type === 'IGNIFER' || t.type === 'VULCAN_ENGINEER') {
            SFX.fireWhoosh();
          } else if (t.type === 'BALLISTARIUS' || t.type === 'CARROBALLISTA' || t.type === 'COLOSSUS_ONAGER') {
            // Heavy crew-served siege engines — crossbow click-snap fits.
            SFX.crossbow();
          } else if (t.type === 'ARCUBALLISTA') {
            // 2026-05 v9: now a single auxilia archer (sprite swap) — fire
            // a regular bowstring sound, not the crew-served crossbow click.
            SFX.bowstring();
          } else if (t.type === 'LEGATE' || t.type === 'FLAMEN' || t.type === 'AUGUR' || t.type === 'HARUSPEX' || t.type === 'SOLAR_PRIEST' || t.type === 'PRAEFECTUS') {
            // Divine + scepter casters — staff cast SFX. Praefectus's eagle
            // scepter (2026-05 v9 sprite swap) belongs here even though its
            // damage type is PHYS_RANGED — the cast is cosmetic.
            SFX.staffCast();
          } else if (t.type === 'DECURION' || t.type === 'CLIBANARIUS' || t.type === 'SPECULATOR' || t.type === 'FUNDIBULUS') {
            // Spear/javelin/sling throwers — javelin throw whistle.
            // SPECULATOR flings a marker dagger, FUNDIBULUS releases a
            // sling stone. (Venator returned to bow archer in v10.)
            SFX.javelinThrow();
          } else {
            SFX.bowstring();
          }
          // Muzzle flash at firing tip, color-keyed to damage type.
          if (t && target) {
            const sx = t.tileX * GRID.TILE + GRID.TILE / 2;
            const sy = t.tileY * GRID.TILE + GRID.TILE / 2;
            // Tip is ~12 px from the tower center along the firing ray.
            const ang = Math.atan2(target.y - sy, target.x - sx);
            const tipX = sx + Math.cos(ang) * 14;
            const tipY = sy + Math.sin(ang) * 14;
            const COLOR_BY_TYPE: Record<number, number> = {
              0: 0xffe6a8, // PHYS_MELEE (unused for ranged but here for completeness)
              1: 0xffe6a8, // PHYS_RANGED — pale yellow
              2: 0xb88a4a, // SIEGE — brown
              3: 0xff7733, // ELEMENTAL_FIRE — orange
              4: 0xfff4a8, // DIVINE — gold-white
              5: 0xffffff  // NONE
            };
            const c = COLOR_BY_TYPE[t.damageType] ?? 0xffffff;
            renderer.triggerMuzzleFlash(tipX, tipY, c, state.tick);
            // Heavy ranged engines (siege/onager) get an extra ground impact at firing position
            const HEAVY_RANGED = new Set(['SCORPIO','BALLISTARIUS','ARCUBALLISTA','CARROBALLISTA','SIEGE_ONAGER','VULCAN_ENGINEER','COLOSSUS_ONAGER']);
            if (HEAVY_RANGED.has(t.type)) renderer.triggerImpactRing(sx, sy, state.tick, 16, 0xddaa55);
          }
        },
        onKill: (t: any, e: any) => {
          awardKillBonus(t);
          // 2026-05-16 — surprise-event resolution. If this kill was an
          // event-spawned enemy and it was the last one alive, the helper
          // sets state.pendingSurpriseReward → next tick opens the modal.
          notifySurpriseEnemyResolved(state, e.id);
          // 2026-05 v10 — BASIC GROUND ENEMY KILL → coin bling SFX.
          // Gated to "basic ground enemy": not boss, not flyer, not
          // a reanim/derived spawn. The reanim guard keeps necromancy
          // waves from spamming the coin sound on every risen body.
          // Throttled to once per 90ms so a 30-enemy swarm reads as a
          // satisfying rhythm of clinks instead of a single noise wall.
          if (!e.isBoss && !e.isFlyer && !(e as any).__reanimated) {
            const lastCoinTick = (state as any).__lastCoinSfxTick ?? -999;
            if (state.tick - lastCoinTick >= 0.09) {
              (state as any).__lastCoinSfxTick = state.tick;
              SFX.coin3();
            }
          }
          // 2026-05 v6: tactile gold feedback. Every gold-earning hook
          // emits a small golden floater + pulse at the earning tower so
          // the player can SEE the gold being minted, not just watch
          // the HUD counter tick. Cheap — uses the existing floating
          // number system + impact-ring renderer (no new allocations).
          let goldEarnedHere = 0;
          if (t.isAerarium) { earnGold(state, ECONOMY.AERARIUM_BONUS); goldEarnedHere += ECONOMY.AERARIUM_BONUS; }
          // GOLD-PER-KILL TROPHIES — linear rarity ladder (2026-05-19
          // rebalance): Common +1 → Rare +2 → Legendary +3. Stack
          // additively if multiple are equipped (rare in practice — same
          // ECONOMY family, so only one fits per tower slot anyway).
          if (t.equippedItems?.includes('GOLD_PURSE'))                  { earnGold(state, 2); goldEarnedHere += 2; }
          if (t.equippedItems?.includes('HANNIBALS_STRATEGY_SCROLL'))   { earnGold(state, 3); goldEarnedHere += 3; }
          // Gate-exclusive PRAETORIAN_COIN (Common): +1g per kill.
          // Cheaper than the Rare GOLD_PURSE (+2); same ECONOMY family
          // so they can't both be equipped on the same tower.
          if (t.equippedItems?.includes('PRAETORIAN_COIN'))              { earnGold(state, 1); goldEarnedHere += 1; }
          // 2026-05-19 — TREASURY TILE (GOLD aura tile): +2g per kill.
          // Stacks with PRAETORIAN_COIN / GOLD_PURSE / Aerarium — all
          // independent gold-on-kill sources.
          if (towerAuraTileKind(t) === 'GOLD')                            { earnGold(state, 2); goldEarnedHere += 2; }
          if (goldEarnedHere > 0 && t) {
            const tcx = t.tileX * 32 + 16;
            const tcy = t.tileY * 32 + 16;
            // Soft gold ring pulse at the tower (cheap — pooled GFX).
            if (renderer?.triggerImpactRing) {
              renderer.triggerImpactRing(tcx, tcy, state.tick, 22, 0xffd34d);
            }
            // Floating "+Xg" gold-tinted floater above the tower so the
            // earn is visible mid-action. Reuses gore-system pool, capped.
            emitFloatingNumber(gore, tcx, tcy - 8, 0, 0xffd34d);
            const last = gore.numbers[gore.numbers.length - 1];
            if (last) { last.text = `+${goldEarnedHere}g`; last.life = 0.9; last.vy = -28; }
            // Mark the tower for a one-frame portrait glow — RenderEngine
            // honors __goldGlowUntil to brighten the tower sprite briefly
            // (see drawTowers patch). Compounds gracefully on streaks.
            (t as any).__goldGlowUntil = state.tick + 0.45;
          }
          // KILL-STREAK MILESTONE FLASH (2026-05 v6): on every 50/200/500
          // kills, fire a one-shot laurel-colored ring + floater so the
          // veteran-badge tier-up is felt, not just rendered on the HUD.
          const milestones = [50, 200, 500];
          if (t && milestones.includes(t.killCount)) {
            const tcx = t.tileX * 32 + 16;
            const tcy = t.tileY * 32 + 16;
            const milestoneColor = t.killCount === 500 ? 0xffd34d
                                 : t.killCount === 200 ? 0xc0c0c0
                                 :                       0xb87333;
            if (renderer?.triggerImpactRing) {
              renderer.triggerImpactRing(tcx, tcy, state.tick, 36, milestoneColor);
              renderer.triggerImpactRing(tcx, tcy, state.tick + 0.05, 52, milestoneColor);
            }
            emitFloatingNumber(gore, tcx, tcy - 14, 0, milestoneColor);
            const last = gore.numbers[gore.numbers.length - 1];
            if (last) {
              const rank = t.killCount === 500 ? 'GOLD'
                         : t.killCount === 200 ? 'SILVER'
                         :                       'BRONZE';
              last.text = `★ ${rank} ★`;
              last.life = 1.6;
              last.vy = -22;
            }
          }
          state.score += Math.round(10 * e.maxHp / 10) + (e.isBoss ? 500 : 0);
          state.enemiesKilledThisWave += 1;
          if (t) t.killsThisWave += 1;
          // QUEST TRACKING — total kills + boss-kill counter for quest progress.
          state.totalKills = (state.totalKills ?? 0) + 1;
          if (e.isBoss) state.bossesKilled = (state.bossesKilled ?? 0) + 1;
          // BOSS-KILL gold bonus — extra reward separate from wave-end gold.
          // Scales with wave so late-game bosses pay proper bounties.
          if (e.isBoss) {
            // 20-WAVE CAMPAIGN: bounty scales faster with wave so the
            // BOSS BOUNTY (2026-05 tuning): playtest showed players
            // ended W12 swimming in gold. Trimmed from 60+wave×8 (W20=220g)
            // to 35+wave×5 (W20=135g). Still a real payday — Mercator T5
            // costs 50g, the final boss buys 2-3 towers' worth — but the
            // mid-run accumulator (Hannibal at W10 paid 140g, now pays 85g)
            // no longer outpaces what you can actually spend.
            // 2026-05 v6: boss bounty trimmed again. Players were still
            // ending W15+ with excess gold. 35+wave×5 → 22+wave×3.5 (W20
            // = 92g from 135g). Still meaningful, no longer a paycheck.
            const bossBonus = 22 + Math.round(state.wave * 3.5);
            earnGold(state, bossBonus);
          }
          // Lightweight quest tick — only triggers reward for newly-completed
          // quests so it's cheap to call this every kill.
          tickQuests();
          // TESSERARIUS — SIGNAL STANDARD (2026-05-15 v11 retheme):
          // The v7 "every-6th-kill AoE mark pulse" has been fully replaced
          // by a per-hit BOSS MARK that lives in CombatResolver (case
          // TESSERARIUS). Each Tesserarius hit on a boss increments a
          // counter on that boss; every 3rd hit applies a 6s MARK (+20%)
          // that is read by direct-damage attacks but bypassed by DoT
          // ticks. No on-kill bookkeeping needed here anymore.
          //
          // Intentionally left blank — the kill hook used to trigger the
          // AoE pulse, but the new mechanic is hit-driven so it lives in
          // the per-attack pipeline. Removing the kill-pulse logic also
          // drops the `t.__bloodKills` counter, which is no longer read.
          emitDeathSplatter(gore, e, state.tick);
          // 2026-05-18 — KILL POP ring. Every enemy death now drops a
          // small expanding white ring at the death position so the kill
          // reads as a snappy "pop" instead of just particles. Bosses get
          // a bigger gold ring to mark the milestone. Cheap — uses the
          // pooled impactRing graphics (no new allocations).
          if (renderer?.triggerImpactRing) {
            if (e.isBoss) {
              renderer.triggerImpactRing(e.x, e.y, state.tick, 48, 0xffd34d);
              renderer.triggerImpactRing(e.x, e.y, state.tick + 0.06, 80, 0xffe88c);
            } else {
              renderer.triggerImpactRing(e.x, e.y, state.tick, 18, 0xffffff);
            }
          }
          // BONUS BOSS reward — double the gold the wave would normally pay,
          // plus a flashy floating "+Xg BONUS" banner above the corpse.
          if (e.isBonusBoss) {
            const w = wavesData[state.wave - 1];
            // 2026-05 v6: BONUS BOSS PAYOUT BUFFED — RNG threats should
            // feel like a JACKPOT not a tax. Bumped from 1.5× + 25g
            // back up to 2.5× wave gold + 50g flat. Plus +2 lives
            // restored (capped at MAX_LIVES). Plus a free RARE+ item
            // (one-shot, queued via grantBonusItem). Plus +3000 score.
            // A W12 modifier-twin pays ~80g; a W20 ambush pays ~135g.
            const bonus = Math.round((w?.gold ?? 10) * 2.5) + 50;
            earnGold(state, bonus);
            // Restore up to +2 lives (caps at MAX_LIVES).
            const livesBefore = state.lives;
            state.lives = Math.min(ECONOMY.MAX_LIVES, state.lives + 2);
            const livesGained = state.lives - livesBefore;
            // Free RARE+ item drop.
            const grantedItem = grantBonusItem('RARE');
            // RNG-event score tracking: each bonus boss the player puts
            // in the dirt feeds the end-of-run score formula.
            state.score += 3000;
            state.bonusBossesKilled = (state.bonusBossesKilled ?? 0) + 1;
            const livesNote = livesGained > 0 ? ` +${livesGained} ❤️` : '';
            const itemNote = grantedItem ? ` +1 item` : '';
            state.hint = `★ BONUS BOSS DEFEATED! +${bonus}g${livesNote}${itemNote} ★`;
            renderer.triggerShake(5, 0.6);
            // Big gold sparkle
            for (let i = 0; i < 28; i++) {
              const a = Math.random() * Math.PI * 2;
              const sp = 80 + Math.random() * 160;
              gore.particles.push({
                x: e.x, y: e.y,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 100,
                life: 0.9 + Math.random() * 0.5,
                size: 2 + Math.random() * 2,
                color: 0xffd34d
              });
            }
            emitFloatingNumber(gore, e.x, e.y - 12, 0, 0xffd34d);
            const lastNum = gore.numbers[gore.numbers.length - 1];
            if (lastNum) { lastNum.text = `+${bonus}g BONUS BOSS`; lastNum.life = 2.0; lastNum.vy = -28; }
          }
          // Flyer kill SFX — fires for every flyer death (boss or basic).
          // Stacks on top of bossDeath/bossKilled for boss flyers, which
          // is fine because the flyer sample is short and mid-pitched —
          // it slots between the bass boss-death sting and the bossKilled
          // sample without clashing.
          if (e.isFlyer) SFX.flyerKilled();
          // Boss death scripts (Alpha Dog spawns 3 dogs, etc.)
          if (e.isBoss) {
            handleBossDeath(state, e, bossRuntime);
            SFX.bossDeath();
            // User-supplied boss-kill SFX (layers on top of the synth
            // bossDeath sting — together they sell the moment).
            SFX.bossKilled();
            renderer.triggerShake(3, 0.4);    // §10.5 dramatic finish
            // 2026-05 v6 polish: rain blood across the map when a boss
            // falls. Champion / twin / ambush bosses get a lighter rain
            // (~70 drops) while scheduled wave bosses (W5/10/15/20) get
            // the full 130-drop downpour. Visceral payoff using the
            // existing v_blood_* sprites — no shaders, no new assets.
            const isScheduledBoss = (wavesData[state.wave - 1]?.type === 'B') && !e.isBonusBoss;
            const drops = isScheduledBoss ? 130 : 70;
            const intensity = isScheduledBoss ? 1.15 : 0.9;
            renderer.triggerBloodRain(state.tick, drops, intensity);
          }
          else SFX.enemyDeath();
          // Hero XP / level-up
          const newLvl = bumpHeroXP(state);
          if (newLvl > 0) {
            state.hint = `HERO LEVEL ${newLvl}! Higher-tier towers now possible.`;
            SFX.combo();
          }
          // 2026-05: EVERY boss-flagged kill guarantees a legendary drop,
          // regardless of wave type or whether other bosses fell first this
          // wave. Champion adds (W3 Alpha Dog, W14 Undead War Elephant,
          // W17 Architectus), Hannibal's escort elephants, and twin/ambush
          // boss spawns all qualify. Boss loot is the marquee reward path.
          const w = wavesData[state.wave - 1];
          const orbsBefore = state.lootOrbs.length;
          if (e.isBoss) {
            // 2026-05 v11: legendary drop tracks the BOSS, not the wave.
            // The `isScheduledBoss` flag is set at spawn for the authored
            // boss of a 'B' wave and persists across leak/respawn — so the
            // legendary fires when you actually kill the boss, even if it
            // carried over into a non-boss wave. Twin/ambush/bonus bosses
            // sharing a 'B' wave still get guaranteed drops (the wave-type
            // check covers them). Off-wave champion adds (Alpha Dog,
            // Hannibal's escort elephants, Architectus, surprise ambush
            // bosses on non-B waves) keep the 35% probabilistic drop.
            // 2026-05 v11 cap: non-B waves with multiple boss-flagged
            // enemies (W9 War Elephants ×5, W10 Hannibal's escort herd,
            // etc.) are capped at ONE legendary per wave total. Once
            // `bossLegendaryDropped` is true on a non-B wave, subsequent
            // boss kills skip the legendary roll. Scheduled-boss kills on
            // B waves bypass the cap (twin bosses still each pay out).
            // 2026-05 v11: `guaranteesLegendary` flag on the enemy def
            // (data/enemies.json) marks specific champion adds — like the W3
            // Alpha Dog — as ALWAYS-drops bosses. The flag bypasses both the
            // wave-type check AND the per-wave cap, so kills of these enemies
            // pay the legendary even if a prior boss kill on this wave
            // already tripped `bossLegendaryDropped`.
            const enemyDef: any = (window as any).__enemiesData?.[e.type] ?? {};
            const alwaysLegendary = !!enemyDef.guaranteesLegendary;
            const guaranteed = !!e.isScheduledBoss || w.type === 'B' || alwaysLegendary;
            const capHit = bossLegendaryDropped && w.type !== 'B' && !alwaysLegendary;
            if (!capHit && (guaranteed || Math.random() < 0.35)) {
              const drop = rollBossDrop(w.faction, state, inventory);
              if (drop) {
                spawnLootAt(state, e, drop);
                bossLegendaryDropped = true;
              }
            }
          } else {
            // Non-boss enemies still roll the regular common/uncommon table
            // by GROUND/FLYER drop rate.
            maybeRollLootOnKill(state, e);
          }
          // Visual + audio cue: only fire if a drop actually appeared.
          if (state.lootOrbs.length > orbsBefore) {
            const newOrb = state.lootOrbs[state.lootOrbs.length - 1];
            const dropRarity = newOrb.rarity;
            // Bright sparkle burst at the drop location, color-keyed to rarity.
            const COLOR: Record<string, number> = {
              COMMON: 0xcccccc, UNCOMMON: 0x5cd05c, RARE: 0x5ca0ff,
              LEGENDARY: 0xff9933, UNIQUE: 0xffd34d
            };
            const c = COLOR[dropRarity] ?? 0xffd34d;
            for (let i = 0; i < 22; i++) {
              const a = Math.random() * Math.PI * 2;
              const sp = 60 + Math.random() * 130;
              gore.particles.push({
                x: e.x, y: e.y,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
                life: 0.7 + Math.random() * 0.4,
                size: 2 + Math.random() * 2,
                color: c
              });
            }
            // Floating "ITEM!" text + rarity tag
            emitFloatingNumber(gore, e.x, e.y - 8, 0, c);
            const lastNum = gore.numbers[gore.numbers.length - 1];
            if (lastNum) { lastNum.text = `★ ${dropRarity} ITEM ★`; lastNum.life = 1.6; lastNum.vy = -22; }
            SFX.itemDrop(dropRarity);
          }
          state.enemies.delete(e.id);
        }
      };
      tickCombat(state, dt, combatHooks);
      tickProjectiles(state, dt, {
        onImpact: (p, target, hx, hy) => {
          // Cosmetic projectiles (SPEAR OF MARS spear-throw, JUPITER'S
          // WRATH thunder bolt) carry a pre-resolved attack — damage and
          // statuses were already applied at swing time. Skip the impact
          // damage path entirely so on-hit effects don't double-fire.
          if (p.cosmetic) return;
          if (target && target.hp > 0) {
            const tw = state.towers.get(p.sourceTowerId);
            if (tw) applyDamageAndStatus(state, tw, target, p.damage, combatHooks);
            // 2026-05-17 — STUCK ARROWS REMOVED. The per-boss embedded
            // shafts (up to 5 sprites per boss, redrawn every frame with
            // per-frame Math.atan2/random offset math) were a non-trivial
            // perf tax in heavy late-game waves with twin / ambush /
            // surprise bosses on screen. The hit-spark + typed-impact
            // VFX from onHit still fires, so projectile impacts still
            // read clearly — we just don't keep a visual residue.
            // splash: damage other enemies in radius
            if (p.splash > 0) {
              const r = p.splash * GRID.TILE;
              for (const other of state.enemies.values()) {
                if (other.id === target.id) continue;
                if (Math.hypot(other.x - hx, other.y - hy) <= r) {
                  if (tw) applyDamageAndStatus(state, tw, other, p.damage * 0.6, combatHooks);
                }
              }
              // 2026-05 v10 — VISUAL: splash impact gets a tan/cream
              // shockwave ring scaled to the actual splash radius so the
              // player can see where the AoE landed. Color matches the
              // projectile family for splash-aware coding (orange for
              // BARREL/fire, brown for ballista, neutral cream otherwise).
              if (renderer?.triggerImpactRing) {
                const ringColor = p.spriteKey === 'PROJ_BARREL' ? 0xff8a22
                  : p.spriteKey === 'PROJ_BALLISTA' ? 0xb88a4a
                  : p.spriteKey === 'PROJ_POISON_CLOUD' ? 0x66dd44
                  : 0xeed8a0;
                renderer.triggerImpactRing(hx, hy, state.tick, r * 0.9, ringColor);
              }
            }
            // 2026-05 v10 — DIVINE IMPACT: any DIVINE-damageType projectile
            // landing on a target gets a gold radiant impact ring + a
            // secondary inner cream ring. Stacks with splash ring above so
            // divine-splash combos read as both "AoE" and "holy".
            if (p.damageType === DamageType.DIVINE && renderer?.triggerImpactRing) {
              renderer.triggerImpactRing(hx, hy, state.tick, 22, 0xffe066);
              renderer.triggerImpactRing(hx, hy, state.tick + 0.05, 36, 0xfff4a8);
            }
          } else {
            // Projectile missed (no target) — emit a small dust puff at
            // the impact tile. Was previously red `emitHitSplatter` (stale
            // — that function emits blood, not dust). Now we push 4-5
            // tan particles directly so a missed shot reads as "ground
            // impact" rather than "phantom bleeding".
            for (let i = 0; i < 5; i++) {
              const a = Math.random() * Math.PI * 2;
              const sp = 25 + Math.random() * 35;
              gore.particles.push({
                x: hx, y: hy,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - 20,
                life: 0.35 + Math.random() * 0.25,
                size: 1.5 + Math.random() * 1,
                color: 0xa67a4a
              });
            }
          }
        }
      });
      tickGore(gore, dt);
      checkWaveEnd(state, (gold) => {
        earnGold(state, gold);
        // 2026-05 v11: user-supplied wave-survived bumper SFX. Fires the
        // moment a wave's spawn queue empties + no live enemies remain.
        // VICTORY (W20 clear) overrides phase below to GamePhase.VICTORY
        // and runs SFX.victory() — both can play, the layering is intentional.
        SFX.waveSurvived();
        // 2026-05 v10 — stop any boss music + low-HP cue that was
        // playing during this wave. One-Winged Angel for W20, plus the
        // generic 'bossLowHp' track if it spun up.
        stopMusicTrack('boss20');
        stopMusicTrack('bossLowHp');
        // 2026-05 v10: stamp wave-clear duration for the speed bonus that
        // feeds into the final-score formula. 2026-05-15 fix: state.tick is
        // already in seconds (advances by dt), so the old `/60` divisor
        // made every wave look ~60× faster than it really was and the
        // speed-bonus scoring was effectively dead.
        const waveSec = Math.max(0, state.tick - waveStartTick);
        if (!state.waveDurations) state.waveDurations = [];
        state.waveDurations[state.wave - 1] = waveSec;
        // PERFECT WAVE BONUS (2026-05 v6, bumped 20g → 50g): zero leaks
        // this wave pays +200 score AND +50 gold on top of the normal
        // wave reward. Clean defense is now a meaningful gold spike
        // (roughly half a Mercator legendary per clean wave).
        if (state.enemiesLeakedThisWave === 0) {
          state.score += 200;
          earnGold(state, 50);
          state.hint = `✨ PERFECT WAVE — +50g bonus on top of the +${gold}g wave reward.`;
          if (renderer?.triggerImpactRing) {
            // Gold celebration ring at the gate location (middle-right of map).
            renderer.triggerImpactRing(GRID.COLS * GRID.TILE - 64, GRID.ROWS * GRID.TILE / 2, state.tick, 48, 0xffd34d);
          }
        }
        // 2026-05 v6: MODIFIER WAVE SURVIVED celebration. WaveManager
        // stamps __modifierJustSurvived with the modifier key when the
        // wave ends with the modifier flag still active. Show the player
        // a real banner so the +60g / +4000 score / +1 item reward feels
        // like a victory, not just a number tick.
        const modSurvived = (state as any).__modifierJustSurvived;
        if (modSurvived) {
          (state as any).__modifierJustSurvived = null;
          const modDef = WAVE_MODIFIERS.find(m => m.key === modSurvived);
          const modName = modDef?.name ?? String(modSurvived).replace(/_/g, ' ');
          showBonusBossBanner(`✨ ${modName.toUpperCase()} SURVIVED — +60g, +4000 SCORE, +1 ITEM ✨`);
          // Violet celebration ring at center of map.
          if (renderer?.triggerImpactRing) {
            renderer.triggerImpactRing(GRID.CANVAS_W / 2, GRID.CANVAS_H / 2, state.tick, 80, 0xc070ff);
          }
        }
        // Boss vignette tween-out — drawBossVignette will ease alpha back
        // to 0 over ~0.35s. Safe to call unconditionally.
        renderer.setBossWaveActive(false);
        // Award MVP for this wave (Player Fantasy §3 step 4 / §4)
        let mvp: any = null;
        let mvpScore = 0;
        for (const tw of state.towers.values()) {
          if (tw.pending) continue;
          // weighted: damage + 50 per kill
          const score = tw.damageThisWave + tw.killsThisWave * 50;
          if (score > mvpScore) { mvpScore = score; mvp = tw; }
        }
        if (mvp && mvpScore > 0) {
          mvp.mvpAwards += 1;
          // Stash the MVP id on state so the renderer can scale that tower
          // larger until the next wave ends and a new MVP is crowned.
          (state as any).lastWaveMvpId = mvp.id;
          const mvpDef: any = (towersData as any)[mvp.type] ?? {};
          const mvpName = mvpDef.name ?? String(mvp.type).replace(/_/g, ' ');
          showMvpBanner(`★ MVP — ${mvpName} T${mvp.qualityTier}: ${mvp.killsThisWave} kills, ${Math.round(mvp.damageThisWave)} dmg ★`, mvp.tileX, mvp.tileY, mvp.type);
        }
        state.draw = [];
        state.selectedCard = null;
        rollProspects();
        snapshotBuildPhase();
        // 2026-05 v10 — pre-wave banners skip in Endless mode (the
        // generator-built waves don't have authored mechanic flags for
        // the existing tip system to consume). A dedicated endless
        // banner fires instead.
        if (state.endlessMode) {
          showEndlessPreWaveBanner((state.endlessWave ?? 0) + 1);
        } else {
          showNextWaveWarning(state.wave + 1);
          showPreWaveTip(state.wave + 1);
          // FINAL HOUR HYPE — once-per-run modal that fires the moment the
          // player rolls into W20's build phase. Queued AFTER the standard
          // pre-wave tip so the hype banner stacks on top in the queue order
          // and reads as the headline event.
          if (state.wave + 1 === 20) showFinalHourHype();
        }
        // Quest evaluation tick (also runs after kills, but safety net here).
        tickQuests();
        // Trigger corpse fade
        fadeCorpsesAtWaveEnd(gore, state.tick);
        // Clear ephemeral combat VFX (floating damage numbers + flying particles)
        // so they don't sit frozen on the field during the build phase.
        gore.numbers.length = 0;
        gore.particles.length = 0;
        // Auto-pickup loot during build phase (Architectus character not yet animated)
        const picked = autoPickupOnBuildPhase(state, inventory);
        if (picked > 0) state.hint = `Picked up ${picked} item${picked > 1 ? 's' : ''}.`;
        // Mercator visit. Builds a SEPARATE shop state from the gate shop
        // so both vendors are usable on the same wave. The dedicated HUD
        // button is toggled on (and back off when the player starts the
        // next wave, handled at line ~1509).
        if (isMercatorWave(state.wave)) {
          mercatorActive = true;
          mercatorShop = buildMercatorStock(state.wave, currentlyOwnedLegendarySet(state, inventory));
          mercatorShop.towerOffers = buildMercatorTowerOffers(state.wave, 5);
          ui.setMercatorAvailable(true);
          state.hint = `★ Mercator arrives — wave ${state.wave + 1} boss imminent. Click ★ MERCATOR for his stock, or hit SHOP for the gate. Both vendors are open this round.`;
          // Show the big floating banner so the player can't miss it.
          const stage = document.getElementById('stage-wrap');
          if (stage) showMercatorBanner(stage, state.wave, {
            onView: () => {
              if (!mercatorShop) {
                mercatorShop = buildMercatorStock(state.wave, currentlyOwnedLegendarySet(state, inventory));
                mercatorShop.towerOffers = buildMercatorTowerOffers(state.wave, 5);
              }
              renderShop(app, mercatorShop, state, inventory, {
                onClose: () => document.getElementById('shop-modal')?.remove()
              });
            }
          });
        }
        if (gateShopRefreshDue(state.wave)) {
          // Gate shop refresh runs INDEPENDENTLY of the Mercator visit — both
          // vendors can be live on the same wave. Drop the cached stock so
          // the next SHOP click builds the new rotation.
          gateShop = null;
          state.hint = `New stock at the Gate Shop! (wave ${state.wave} rotation)`;
          // 2026-05 v11: stamp the "NEW STOCK" badge flag so the SHOP button
          // glows until the player opens it. Cleared in onOpenShop below.
          state.shopRefreshedUnopened = true;
        }
        // 20-WAVE CAMPAIGN VICTORY: clearing W20 with the gate intact
        // wins the main run. 2026-05 v10 — Endless mode freezes
        // state.wave at 20 by design (endlessWave is the counter that
        // climbs), so this check would re-fire VICTORY on every
        // endless wave clear. Gate on `!state.endlessMode` so victory
        // only triggers on the ORIGINAL W20 clear, then Endless takes
        // over and the player can't re-enter the victory state.
        if (state.wave >= 20 && state.lives > 0 && !state.endlessMode) {
          state.phase = GamePhase.VICTORY;
          state.victoryAt = state.tick;
        }
      });
      pruneCorpses(gore, state.tick);
    } else if ((state as any).__dpsCheckActive) {
      // ────── DPS CHECK pre-wave side-tick ───────────────────────────────
      // 2026-05-15 fix: the dummy was spawning but freezing at the cave
      // mouth because tickEnemies/tickCombat/tickProjectiles only ran
      // during WAVE_PHASE. During pre-wave with a DPS dummy active, run a
      // stripped tick that moves the dummy, lets towers attack it, and
      // resolves projectile impacts. NO spawn queue, NO wave-end, NO boss
      // scripts, NO leak penalty (the dummy's livesCost is already 0 and
      // its onLeak callback shows the summary popup instead).
      // 2026-05-15 v2: trigger the SAME visual feedback during DPS check
      // as during a real wave so the player sees melee slash VFX +
      // projectile sprites land on the dummy. Previously the hooks were
      // no-ops, which made the test feel dead (towers attacked silently).
      const dpsCombatHooks = {
        onKill: (_t: any, e: any) => {
          if (e.isDpsCheck) showDpsCheckSummary(e, /*killed=*/true);
        },
        onHit: () => {},                  // skip gore/sparks (wave polish)
        onMeleeSwing: (t: any, e: any) => {
          // Render the slash arc at the enemy position — same logic as
          // the main wave-phase onMeleeSwing handler. Without this, the
          // Hastati / Milites / etc. attack a dummy in eerie silence.
          if (!t) return;
          const sx = t.tileX * GRID.TILE + GRID.TILE / 2;
          const sy = t.tileY * GRID.TILE + GRID.TILE / 2;
          const angle = Math.atan2(e.y - sy, e.x - sx);
          const HEAVY = new Set(['PRIMUS_PILUS','TRIARIUS','CENTURION','COHORT_GUARD','PRAETORIAN_WALL','IMPERATOR_GUARD','EVOCATUS','CATAPHRACT','HORSEMAN']);
          const size = HEAVY.has(t.type) ? 1.3 : 1.0;
          const cleaver = hasCleave(t);
          renderer.triggerMeleeSlash(e.x, e.y, angle, state.tick, size, cleaver);
        },
        onProjectileFire: () => {},       // projectile sprites spawn from tickCombat directly
      };
      // 2026-05-15 audit fix: DPS-check side-tick was missing
      // tickBurnPatches, so fire-tower builds (Draconarius, Hannibal's
      // Nightmare, God of War, IGNIFER, INFERNO_CART, etc.) had their
      // burn-ground patches sit inert and the dummy under-read 30-50%
      // of true DPS. Wiring the patch tick here makes the measurement
      // honest across every tower archetype.
      tickBurnPatches(state, dt);
      tickEnemies(state, dt,
        /*onLeak*/ (e) => {
          if (e.isDpsCheck) showDpsCheckSummary(e, /*killed=*/false);
        },
        /*onDeath*/ () => { /* handled by onKill hook above */ }
      );
      tickCombat(state, dt, dpsCombatHooks);
      tickProjectiles(state, dt, {
        onImpact: (p, target, _hx, _hy) => {
          if (p.cosmetic) return;
          if (target && target.hp > 0) {
            const tw = state.towers.get(p.sourceTowerId);
            if (tw) applyDamageAndStatus(state, tw, target, p.damage, dpsCombatHooks);
          }
        }
      });
      // 2026-05-15 v2 UNKILLABLE DUMMY: any HP loss this tick gets
      // siphoned into the dummy's damage accumulator, then HP snaps back
      // to maxHp. The dummy is never killable — it walks the full path
      // every time so the measurement is valid even for builds that
      // could one-shot a fixed-HP dummy. Total damage in the summary
      // reads from the accumulator, not the maxHp − hp delta.
      for (const e of state.enemies.values()) {
        if (!(e as any).isDpsCheck) continue;
        if (e.hp < e.maxHp) {
          const taken = e.maxHp - e.hp;
          (e as any).__dpsDmgAccum = ((e as any).__dpsDmgAccum ?? 0) + taken;
          e.hp = e.maxHp;
        }
      }
      tickGore(gore, dt);
    }
    // Lives reaching 0 always forces GAME_OVER, regardless of which phase fired the leak.
    if (state.lives <= 0 && state.phase !== GamePhase.GAME_OVER) {
      if (state.gameOverAt < 0) state.gameOverAt = state.tick;
      // Brief delay so the death animation can be seen, then snap to GAME_OVER.
      if (state.tick - state.gameOverAt > 1.0) state.phase = GamePhase.GAME_OVER;
    }
    // End-screen triggers (one-shot per phase). New flow (2026-05): show
    // a single recap card with a count-up score, then prompt for a
    // 12-char alphanumeric name (profanity-blocked), then the Hall of
    // Glory leaderboard. Player presses ENTER to play again.
    if (state.phase === GamePhase.GAME_OVER && !document.getElementById('end-summary') && !document.getElementById('hall-of-glory') && !document.getElementById('endless-failure')) {
      SFX.defeat();
      // 2026-05 v10 — fatality SFX punctuates the loss state. Plays on
      // top of the existing defeat synth so the audio reads as
      // "FATALITY — Rome has fallen." Also stop any still-playing
      // boss music tracks so the failure scream has the field to itself.
      SFX.fatality();
      stopAllMusicTracks();
      // Suppress legacy end screen if it happens to still mount.
      document.getElementById('end-screen')?.remove();
      void showGameOver;     // keep import alive while we transition
      // 2026-05 v10 — ENDLESS FAILURE: if the player ran out of lives
      // DURING Endless mode, skip the normal Hall of Glory flow and
      // route to the dedicated Endless failure screen (separate
      // leaderboard, separate copy).
      if (state.endlessMode) {
        runEndlessFailure();
      } else {
        runEndOfGameFlow(app, state, false, () => location.reload());
      }
    }
    if (state.phase === GamePhase.VICTORY && !document.getElementById('end-summary') && !document.getElementById('hall-of-glory')) {
      SFX.victory();
      document.getElementById('end-screen')?.remove();
      void showVictory;
      // 2026-05 v10 — POST-VICTORY ENDLESS TRANSITION. After the player
      // submits their name and the W20 entry saves, route them into
      // Endless mode instead of dropping into the static leaderboard.
      runEndOfGameFlow(app, state, true, () => location.reload(), (savedName) => {
        beginEndlessMode(savedName);
      });
    }
    renderer.drawDynamic(state);
    renderer.setTileRef(state.tiles);
    {
      const wIdx = Math.min(49, Math.max(0, state.wave - 1));
      const wInfo = wavesData[wIdx];
      renderer.drawAmbient(state.tick, state.wave, wInfo?.type === 'B');
    }
    renderer.drawImpactOverlays(state.tick);
    renderer.applyShake(dt, state.tick);
    renderer.drawGore(gore, state.tick);
    // 2026-05-19 — Aura buff tiles: 5 fixed glowing tiles with
    // per-frame pulse animation.
    renderer.drawAuraTiles(state, state.tick);
    renderer.drawComboFx(state, state.tick);
    renderer.drawCheckpointHealFx(state, state.tick);
    renderer.drawReanimationFx(state, state.tick);
    renderer.drawChainLightningFx(state, state.tick);
    renderer.drawProjectiles(state);
    renderer.drawDruidSleepDarts(state);
    renderer.drawElephantAura(state);
    renderer.drawMeleeSlashes(state.tick);
    renderer.drawBossBar(state);
    renderer.drawBossLowHpAura(state);
    renderer.drawBossVignette(state, dt);
    renderer.tickBloodRain(dt);
    renderer.drawSelectedRange(state);
    renderer.drawSellStoneSelection(state, state.tick);
    renderer.drawBurnPatches(state, state.tick);
    // 2026-05-16 — Surprise event VFX (fires/urns/scars + screen tint).
    // Sits between burn patches and weather so the event tint sits over
    // the play area but under the weather overlay (rain still reads).
    renderer.drawSurpriseEvents(state, state.tick);
    renderer.drawWeather(state, state.tick);
    renderer.drawAuras(state, state.tick);
    renderer.drawTierPips(state);
    renderer.drawLootOrbs(state, state.tick);
    renderer.emitBloodDripsForWounded(state, gore, state.tick);
    updateLowLivesVignette();
    updateFinalHourAura();
    updateWeatherChip();
    updateModifierChip();
    updateWaveBrief();
    updateProspectSidebar();
    updateProspectReminder();
    updateTowerQueueIndicator();
    updateWavePreviewChip();
    // Pulsing red glow on towers that are ingredients in an available combo.
    // The connecting line + centroid are intentionally NOT drawn — combos are
    // executed from inside the tower menu now.
    // Combo glow runs in every pre-wave phase (2026-05): BUILD_PHASE,
    // PROSPECT_PLACEMENT, and PICK_KEEPER. The combo engine already
    // treats pending prospects as eligible ingredients, so the sparkle
    // ring fires on any prospect whose KEEP would complete a recipe.
    // No more clicking into every prospect to check.
    let comboCount = 0;
    const showComboGlow = state.phase === GamePhase.BUILD_PHASE
                       || state.phase === GamePhase.PROSPECT_PLACEMENT
                       || state.phase === GamePhase.PICK_KEEPER;
    if (showComboGlow) {
      const combos = scanCombos(state);
      comboCount = combos.length;
      const eligibleIds = new Set<string>();
      for (const cb of combos) for (const ing of cb.ingredients) eligibleIds.add(ing.id);
      renderer.drawComboGlow(eligibleIds, state, state.tick);
    } else {
      renderer.drawComboGlow(new Set(), state, state.tick);
    }
    // 2026-05 v11 (A2): combo alert chip in top-right of stage area is now
    // CLICKABLE. Click → opens the ComboPicker directly so the player doesn't
    // have to hunt for a glowing tower on the field. Wires the same path as
    // the (currently hidden) HUD COMBINE button.
    const alertEl = document.getElementById('combo-alert');
    if (alertEl) {
      if (comboCount > 0) {
        alertEl.classList.add('active');
        alertEl.textContent = `⚔ ${comboCount} COMBINATION${comboCount > 1 ? 'S' : ''} READY — click to combine`;
        if (!(alertEl as any).__wired) {
          (alertEl as any).__wired = true;
          alertEl.addEventListener('click', () => {
            (ui as any).cb.onComboList?.();
          });
        }
      } else {
        alertEl.classList.remove('active');
      }
    }
    // One-shot audio when combo count goes from 0 → ≥1 (a recipe just unlocked).
    // 2026-05-15 v7: broadened to PROSPECT_PLACEMENT / PICK_KEEPER too, now
    // that combinations can fire in those phases — the chime fires the
    // moment a placed prospect completes a recipe, no waiting for KEEP.
    const preWaveForCombo = state.phase === GamePhase.BUILD_PHASE
                         || state.phase === GamePhase.PROSPECT_PLACEMENT
                         || state.phase === GamePhase.PICK_KEEPER;
    if (preWaveForCombo && lastComboCount === 0 && comboCount > 0) {
      SFX.comboAvailable();
    }
    lastComboCount = comboCount;
    renderer.app.render();
    // Tower info if any selected
    let info: string | null = null;
    if (selectedTowerId) {
      const t = state.towers.get(selectedTowerId);
      if (t) info = `${towerName(t.type)} T${t.qualityTier} | DPS ${(t.baseDps * (t.attackSpeed)).toFixed(1)} | Kills ${t.killCount} (+${t.killBonusFlat.toFixed(1)} flat) | Target: ${TargetingMode[t.targetingMode]}`;
      else { selectedTowerId = null; renderer.selectedTowerId = null; }
    } else if (state.phase === GamePhase.BUILD_PHASE && state.draw.length > 0) {
      info = `Build phase. Pick a card, click a tile. Next wave: ${factionName(getNextWaveInfo(state).faction)}.`;
    }
    ui.update(state, info);
    renderInventoryButton(app, inventory, { onOpen: () => (ui as any).cb.onOpenInventory?.() });
    // 2026-05 v11 (Pin Recipe QoL): floats the player's pinned combo recipe
    // below the INVENTORY button with live ingredient status colors.
    renderPinnedRecipeWidget(state);
  }
  // Configure logger to surface errors into the game's hint bar.
  Logger.configure({
    level: 'warn',
    surfaceErrorsToHint: (m) => { state.hint = m; }
  });
  // Crash-resistant frame driver: wrap each tick in try/catch so a single
  // bad frame can't kill the whole session. Errors get logged + surfaced.
  let frameErrorCount = 0;
  function safeFrame() {
    try {
      frame();
    } catch (err) {
      frameErrorCount++;
      Logger.error('GameLoop', err, { wave: state.wave, phase: state.phase, frameErrorCount });
      // After many consecutive errors, stop hammering the loop and warn loudly.
      if (frameErrorCount > 20) {
        console.error('[Roman TD] Frame loop has thrown 20+ times — halting to prevent runaway logs.');
        clearInterval(loopHandle);
      }
    }
  }
  const loopHandle = setInterval(safeFrame, 16);
  // Debug: manual tick driver for headless / hidden-iframe environments.
  (window as any).__tick = (seconds: number, dt = 0.016) => {
    const steps = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < steps; i++) {
      last = performance.now() - dt * 1000;
      frame();
    }
    return { phase: state.phase, wave: state.wave, lives: state.lives, gold: state.gold, enemies: state.enemies.size, queue: state.spawnQueue.length, killed: state.enemiesKilledThisWave, leaked: state.enemiesLeakedThisWave };
  };
}

boot().catch(err => {
  console.error(err);
  document.getElementById('loading')!.textContent = 'BOOT ERROR — see console';
});

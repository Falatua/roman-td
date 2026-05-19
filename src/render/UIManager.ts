import { GameStateShape } from '../GameState';
import { GamePhase, TowerType, TargetingMode } from '../types';
import { ECONOMY, GRID, POOL_PROBABILITIES } from '../constants';
import { tex } from './Assets';
import { canAfford, poolUpgradeCost } from '../systems/EconomySystem';
import { previewSpawnHp } from '../systems/WaveManager';
import { factionName, enemyName, damageTypeLabel } from '../format';
import towersData from '../data/towers.json';

export interface UICallbacks {
  onCardSelected: (idx: number) => void;
  onConfirmCard: () => void;
  onPoolUpgrade: () => void;
  onComboList: () => void;
  onOpenShop: () => void;
  onOpenMercator?: () => void;
  onToggleStone?: () => void;       // legacy hook — stone button removed in 2026-05
  onToggleSpeed?: (btn: HTMLButtonElement) => void;
  onUndo?: () => void;
  onReset?: () => void;
  onOpenInventory?: () => void;
  onOpenCodex?: () => void;
  onOpenQuests?: () => void;
  onOpenLeaderboard?: () => void;
  onToggleMute?: (btn: HTMLButtonElement) => void;
  onTogglePause?: (btn: HTMLButtonElement) => void;
  onSellAllStones?: () => void;
  onOpenSettings?: () => void;
  onDpsCheck?: () => void;
  // 2026-05-19 — Bulk-set every placed tower's targetingMode at once
  // (right-panel "TARGET ALL" button + 7-button mode picker). Saves
  // the player from opening each tower one at a time when they want
  // a global retarget (e.g. flip everything to WEAKEST during a
  // grunt-clearing wave, then back to STRONG for the boss).
  onSetAllTargeting?: (mode: TargetingMode) => void;
}

// Vanilla-DOM HUD overlay positioned above the canvas.
export class UIManager {
  root: HTMLElement;
  hud: HTMLElement;
  cards: HTMLElement;
  hint: HTMLElement;
  startBtn: HTMLButtonElement;
  upgradeBtn: HTMLButtonElement;
  comboBtn: HTMLButtonElement;
  // Mercator button — hidden by default. main.ts toggles visibility via
  // `setMercatorAvailable()` when a Mercator visit lands and dismisses it
  // when the player presses START WAVE.
  mercatorBtn: HTMLButtonElement;
  cb: UICallbacks;

  constructor(parent: HTMLElement, cb: UICallbacks) {
    this.cb = cb;
    // SPLIT-PANEL LAYOUT: HUD (waves/gold/lives) lives in the LEFT panel.
    // Action buttons (start, speed, pool, shop, quests, codex) live in
    // the RIGHT panel. Stage-wrap is the middle column — already wired in
    // index.html as a flex sibling, so we DON'T move it into a wrapper
    // (doing so re-ordered the columns and pushed the map to the far right).
    const leftPanel = document.getElementById('left-panel') ?? parent;
    const rightPanel = document.getElementById('right-panel') ?? parent;
    this.root = parent; // legacy ref — no #frame wrapper anymore
    this.hud = document.createElement('div');
    this.hud.id = 'hud-top';
    this.hud.style.cssText = 'flex-direction:column;align-items:stretch;gap:6px;';
    leftPanel.appendChild(this.hud);

    this.cards = document.createElement('div');
    this.cards.style.cssText = `display:none`;          // unused in Gem TD mode but keep ref
    rightPanel.appendChild(this.cards);

    const buttons = document.createElement('div');
    buttons.id = 'buttons';
    rightPanel.appendChild(buttons);

    this.startBtn = mkBtn('START WAVE', '#7a1a1a');
    this.startBtn.title = 'Begin the next wave. Builds and item-purchases lock in until the wave ends.';
    this.startBtn.onclick = () => cb.onConfirmCard();
    this.upgradeBtn = mkBtn('UPGRADE POOL', '#1a4a7a');
    this.upgradeBtn.title = 'Improve your tower-draw pool. Higher pool levels raise the odds of rolling rarer, stronger towers when you reveal a prospect.';
    this.upgradeBtn.onclick = () => cb.onPoolUpgrade();
    // Combine button removed: combinations are now triggered from inside the
    // tower menu (click any glowing tower → choose a recipe).
    this.comboBtn = mkBtn('COMBINE', '#4a7a1a');
    this.comboBtn.style.display = 'none';
    this.comboBtn.onclick = () => cb.onComboList();
    const shopBtn = mkBtn('SHOP', '#7a5a1a');
    shopBtn.id = 'shop-btn';
    shopBtn.title = 'Open the gate shop. Buy items (DoTs, stat boosts, auras, legendaries) and extra lives. Stock rotates every 4 waves. Open mid-wave too.';
    shopBtn.onclick = () => cb.onOpenShop();
    // MERCATOR button — only visible during a Mercator visit wave. The
    // gate shop button stays available alongside; the two are separate
    // entry points so the player can hop between vendors freely.
    this.mercatorBtn = mkBtn('★ MERCATOR', '#5a3a16');
    this.mercatorBtn.title = 'Open the traveling Mercator (only this wave). Sells T5 towers and Legendary trophies.';
    this.mercatorBtn.onclick = () => (cb as any).onOpenMercator?.();
    this.mercatorBtn.style.color = '#ffd34d';
    this.mercatorBtn.style.fontWeight = 'bold';
    this.mercatorBtn.style.letterSpacing = '2px';
    this.mercatorBtn.style.border = '2px solid #d4af37';
    this.mercatorBtn.style.boxShadow = '0 0 10px rgba(212,175,55,0.45)';
    this.mercatorBtn.style.display = 'none';     // hidden until Mercator arrives
    // STONE button removed — placing a prospect now costs 1g directly,
    // unifying "stone or prospect" into one click flow. Unkept prospects
    // still convert to walls automatically when the wave starts.
    // Codex button — text label, not an icon, so players don't have to guess.
    const codexBtn = mkBtn('CODEX', '#3a2010');
    codexBtn.title = 'Open the Legion Codex: all towers, enemies, recipes, items';
    codexBtn.onclick = () => (cb as any).onOpenCodex?.();
    codexBtn.style.color = '#ffd34d';
    codexBtn.style.fontWeight = 'bold';
    codexBtn.style.letterSpacing = '2px';
    codexBtn.style.border = '2px solid #ffd34d';
    codexBtn.style.boxShadow = '0 0 10px rgba(255,211,77,0.35)';
    // QUESTS button — opens the run-quest progress modal. Replaces the
    // persistent on-screen panel so the playfield isn't crowded.
    const questsBtn = mkBtn('QUESTS', '#1a3a20');
    questsBtn.title = 'Open the active quest list with progress and rewards';
    questsBtn.onclick = () => (cb as any).onOpenQuests?.();
    questsBtn.style.color = '#88ff88';
    questsBtn.style.fontWeight = 'bold';
    questsBtn.style.letterSpacing = '2px';
    questsBtn.style.border = '2px solid #88ff88';
    questsBtn.style.boxShadow = '0 0 10px rgba(136,255,136,0.35)';
    // LEADERBOARD button — opens the tower leaderboard modal (sortable rank
    // of every tower by damage / kills / tier, click row to open tower menu).
    const leaderBtn = mkBtn('⚔ LEADERBOARD', '#10243a');
    leaderBtn.title = 'Tower leaderboard: damage / kills / tier, click any row for full stats';
    leaderBtn.onclick = () => (cb as any).onOpenLeaderboard?.();
    leaderBtn.style.color = '#9be0ff';
    leaderBtn.style.fontWeight = 'bold';
    leaderBtn.style.letterSpacing = '2px';
    leaderBtn.style.border = '2px solid #9be0ff';
    leaderBtn.style.boxShadow = '0 0 10px rgba(155,224,255,0.35)';
    // 2026-05 v11: the standalone SOUND mute button has been folded into
    // the Settings panel — open SETTINGS → Audio tab to mute or adjust
    // master/music/sfx volumes. Removed from the HUD stack to keep the
    // right column cleaner; the existing `onToggleMute` callback path
    // stays available so the Settings panel checkbox can call it.
    const speedBtn = mkBtn('▶ 1×', '#222');
    speedBtn.id = 'speed-btn';
    speedBtn.title = 'Cycle game speed: 1× → 2× → 3× → 1×. Same simulation, just faster. Use during routine waves to save real time.';
    speedBtn.onclick = () => (cb as any).onToggleSpeed?.(speedBtn);
    // 2026-05 v11 (B1 Pause): pause button. Click or press P to toggle.
    // Auto-pause on tab blur is wired separately in main.ts.
    const pauseBtn = mkBtn('⏸ PAUSE', '#222');
    pauseBtn.id = 'pause-btn';
    pauseBtn.title = 'Pause the wave (also bound to the P key). Auto-pauses if you tab away from the window.';
    pauseBtn.onclick = () => (cb as any).onTogglePause?.(pauseBtn);
    // 2026-05 v11 (B7 Sell stones): bulk-refund every stone wall on the
    // map. main.ts handles the actual loop; the button just dispatches.
    const sellStonesBtn = mkBtn('🪨 SELL STONES', '#222');
    sellStonesBtn.id = 'sell-stones-btn';
    sellStonesBtn.title = 'Bulk-refund stone walls. Click to enter selection mode, click stones on the map to mark them, then confirm to sell. Only available between waves.';
    sellStonesBtn.onclick = () => (cb as any).onSellAllStones?.();
    // 2026-05 v11 (B2 Settings): opens audio settings panel.
    const settingsBtn = mkBtn('⚙ SETTINGS', '#222');
    settingsBtn.id = 'settings-btn';
    settingsBtn.title = 'Open settings: master volume, music, SFX, mute toggle, and UI preferences.';
    settingsBtn.onclick = () => (cb as any).onOpenSettings?.();
    // 2026-05 v11 DPS CHECK: spawns a harmless training dummy so the player
    // can measure maze throughput between waves. Button disables itself
    // while a dummy is on the field.
    const dpsBtn = mkBtn('🎯 DPS CHECK', '#10243a');
    dpsBtn.id = 'dps-check-btn';
    dpsBtn.title = 'Spawn an invincible training dummy that walks the path so you can measure your maze\'s throughput. Free, deals 0 damage on leak. Click again to cancel mid-run.';
    dpsBtn.style.color = '#9be0ff';
    dpsBtn.style.border = '2px solid #9be0ff';
    dpsBtn.style.fontWeight = 'bold';
    dpsBtn.style.letterSpacing = '2px';
    dpsBtn.onclick = () => (cb as any).onDpsCheck?.();
    // 2026-05-19 — TARGET ALL: opens an inline mode picker that bulk-
    // applies the chosen targeting mode to every placed tower. Saves
    // the player from opening each tower individually. The picker is
    // a sibling DOM block toggled below the button — no modal, no
    // overlay, dismisses on selection or on a re-click of the button.
    const targetAllBtn = mkBtn('🎯 TARGET ALL', '#3a1a2a');
    targetAllBtn.id = 'target-all-btn';
    targetAllBtn.title = 'Bulk-retarget EVERY placed tower at once. Click to open the mode picker (FIRST / LAST / STRONG / WEAKEST / CLOSE / FLYERS / FAST), pick a mode, and every tower on the map switches to it. Saves you from opening each tower individually.';
    targetAllBtn.style.color = '#ffb3d9';
    targetAllBtn.style.border = '2px solid #ffb3d9';
    targetAllBtn.style.fontWeight = 'bold';
    targetAllBtn.style.letterSpacing = '2px';
    targetAllBtn.style.boxShadow = '0 0 10px rgba(255,179,217,0.35)';
    const targetAllPicker = document.createElement('div');
    targetAllPicker.id = 'target-all-picker';
    targetAllPicker.style.cssText = 'display:none;background:#1a0f18;border:1px solid #5a3a4a;border-top:none;padding:8px;flex-direction:column;gap:4px;';
    // 7 mode buttons matching the per-tower row in TowerMenu, in the
    // same order: FIRST · LAST · STRONG · WEAKEST · CLOSE · FLYERS · FAST.
    const TARGET_ALL_MODES: { mode: TargetingMode; label: string; tip: string }[] = [
      { mode: TargetingMode.FIRST,   label: 'FIRST',   tip: 'Furthest along the path (closest to leaking)' },
      { mode: TargetingMode.LAST,    label: 'LAST',    tip: 'Earliest in the path (newest spawn)' },
      { mode: TargetingMode.STRONG,  label: 'STRONG',  tip: 'Highest HP — bosses get priority' },
      { mode: TargetingMode.WEAKEST, label: 'WEAKEST', tip: 'Lowest HP grunt — finisher mode' },
      { mode: TargetingMode.CLOSE,   label: 'CLOSE',   tip: 'Physically closest enemy' },
      { mode: TargetingMode.FLYERS,  label: 'FLYERS',  tip: 'Flyers first, then ground' },
      { mode: TargetingMode.FAST,    label: 'FAST',    tip: 'Highest current speed — catch sprinters' },
    ];
    for (const m of TARGET_ALL_MODES) {
      const b = document.createElement('button');
      b.textContent = m.label;
      b.title = m.tip;
      b.style.cssText = 'background:#2a1a25;color:#ffb3d9;border:1px solid #5a3a4a;padding:6px 8px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px;text-align:left';
      b.onmouseenter = () => { b.style.background = '#3a2535'; };
      b.onmouseleave = () => { b.style.background = '#2a1a25'; };
      b.onclick = () => {
        (cb as any).onSetAllTargeting?.(m.mode);
        targetAllPicker.style.display = 'none';
        targetAllBtn.style.background = '#3a1a2a';
      };
      targetAllPicker.appendChild(b);
    }
    targetAllBtn.onclick = () => {
      const open = targetAllPicker.style.display !== 'none';
      targetAllPicker.style.display = open ? 'none' : 'flex';
      // Subtle highlight while the picker is open so the player can tell.
      targetAllBtn.style.background = open ? '#3a1a2a' : '#5a2a3a';
    };
    // Order: START / SPEED / PAUSE / POOL / SHOP / QUESTS / CODEX / SELL-STONES / LEADERBOARD / DPS CHECK / TARGET ALL (+ picker) / SETTINGS.
    // (Sound mute lives inside SETTINGS panel now — 2026-05 v11.)
    buttons.append(this.startBtn, speedBtn, pauseBtn, this.upgradeBtn, shopBtn, this.mercatorBtn, questsBtn, codexBtn, sellStonesBtn, leaderBtn, dpsBtn, targetAllBtn, targetAllPicker, settingsBtn);

    this.hint = document.createElement('div');
    this.hint.style.cssText = `display:none`;
    rightPanel.appendChild(this.hint);
  }

  // Toggle the gold-bordered ★ MERCATOR button. main.ts flips this on when
  // the Mercator visit fires and off after the player presses START WAVE.
  // While on, the regular SHOP button is still fully functional — the two
  // vendors are independent entry points and either can be opened freely.
  setMercatorAvailable(on: boolean) {
    this.mercatorBtn.style.display = on ? '' : 'none';
    if (on) {
      // Quick attention pulse on first arrival so the player notices.
      this.mercatorBtn.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
        { duration: 600, iterations: 2, easing: 'ease-in-out' }
      );
    }
  }

  update(state: GameStateShape, selectedTowerInfo: string | null) {
    this.hud.innerHTML = '';
    const left = document.createElement('div');
    left.className = 'hud-l';
    const phaseStr =
      state.phase === GamePhase.WAVE_PHASE ? 'WAVE' :
      state.phase === GamePhase.PROSPECT_PLACEMENT ? 'PLACING PROSPECTS' :
      state.phase === GamePhase.PICK_KEEPER ? 'PICK KEEPER' :
      state.phase === GamePhase.GAME_OVER ? 'CASTRUM LUNUM HAS FALLEN' :
      state.phase === GamePhase.VICTORY ? 'IMPERATOR' : 'BUILD';
    // Live enemy counter + threat summary during waves (§7.1, §16.1)
    let waveCounter = '';
    if (state.phase === GamePhase.WAVE_PHASE) {
      const onField = state.enemies.size;
      const queued = state.spawnQueue.length;
      const remaining = onField + queued;
      const total = (state as any).totalEnemiesThisWave ?? (remaining || 1);
      const killed = total - remaining;
      const pct = Math.max(0, Math.min(100, (killed / total) * 100));
      // Active threats (Enemy Doc §16.1)
      const archetypeCounts: Record<string, number> = {};
      let eliteCount = 0;
      for (const e of state.enemies.values()) {
        archetypeCounts[e.archetype] = (archetypeCounts[e.archetype] ?? 0) + 1;
        if (e.archetype === 'ELITE' || e.archetype === 'BOSS') eliteCount++;
      }
      const topThreats = Object.entries(archetypeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k)
        .join(', ');
      waveCounter = `
        <span class="hud-icon" title="Enemies remaining (on field + queued)">
          <span style="display:inline-block;width:90px;height:8px;background:#1a1410;border:1px solid #5a4a30;position:relative">
            <span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#aa1010,#ee5555)"></span>
          </span>
          <b style="margin-left:6px">${killed}/${total}</b>
        </span>
        <span class="hud-icon" title="Active enemies on field"><b>ACTIVE</b> ${onField}</span>
        ${eliteCount > 0 ? `<span class="hud-icon" title="Elite/Boss enemies present" style="color:#ffd34d;font-size:14px"><b>⚠ ${eliteCount}</b></span>` : ''}
        ${topThreats ? `<span class="hud-icon" title="Most common archetypes on field" style="font-size:12px;opacity:0.85">${topThreats}</span>` : ''}`;
    }
    // 2026-05 v10 — Endless mode: display E1/E2/… and the running
    // endless score in place of the 20-wave campaign counter.
    const waveDisplay = state.endlessMode
      ? `<span class="hud-icon" style="color:#ff5050"><span class="ic ic-wave"></span><b>ENDLESS</b> E${state.endlessWave ?? 0}</span>
         <span class="hud-icon" title="Cumulative endless score" style="color:#ff5050"><b>SCORE</b> ${(state.endlessScore ?? 0).toLocaleString()}</span>`
      : `<span class="hud-icon"><span class="ic ic-wave"></span><b>WAVE</b> ${state.wave}/20</span>`;
    left.innerHTML = `
      ${waveDisplay}
      <span class="hud-icon"><span class="ic ic-life"></span><b>LIVES</b> ${state.lives}</span>
      <span class="hud-icon"><span class="ic ic-gold"></span><b>GOLD</b> ${state.gold}</span>
      ${waveCounter}
    `;
    const right = document.createElement('div');
    right.className = 'hud-r';
    const eff = Math.max(state.poolLevel, state.heroLevel);
    const POOL_PROBS = POOL_PROBABILITIES;
    const TIER_COL = ['#cccccc','#b87333','#c0c0c0','#ffd34d','#ff5050'];
    const probs = POOL_PROBS[Math.min(POOL_PROBS.length - 1, eff)];
    const probStrip = probs.map((p, i) => `<span title="Tier ${i+1}: ${p}% chance per prospect" style="color:${TIER_COL[i]};font-size:13px;font-weight:900;letter-spacing:0.5px">${p}%</span>`).join('<span style="opacity:0.4;font-size:12px"> · </span>');
    right.innerHTML = `
      <span class="hud-icon"><span class="ic ic-pool"></span><b>POOL</b> ${state.poolLevel}/${ECONOMY.POOL_MAX_LEVEL}</span>
      <span class="hud-icon" title="Tier roll probabilities at the current effective pool. Click 📖 CODEX → POOL for full table.">${probStrip}</span>
      <span class="hud-icon"><span class="ic ic-score"></span><b>SCORE</b> ${state.score}</span>
      <span style="color:#9be0ff;font-weight:900;font-size:14px;letter-spacing:2px;text-shadow:1px 1px 0 #000">${phaseStr}</span>
    `;
    this.hud.append(left, right);

    // Draw 5 cards
    this.cards.innerHTML = '';
    state.draw.forEach((card, idx) => {
      const div = document.createElement('div');
      const def: any = (towersData as any)[card.type];
      const isSelected = state.selectedCard === idx;
      const cost = ECONOMY.TIER_PLACE_COST[card.tier];
      const affordable = canAfford(state, cost);
      div.style.cssText = `width:120px;height:130px;background:${isSelected ? '#3a2a14' : '#1a1410'};border:2px solid ${isSelected ? '#ffd34d' : '#5a4a30'};padding:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;font-size:11px;${affordable ? '' : 'opacity:0.45;'}`;
      div.innerHTML = `<div style="font-weight:bold;color:#d4af37">T${card.tier}</div>`;
      const img = document.createElement('img');
      const t = tex(card.type);
      const res: any = t?.baseTexture?.resource;
      const cardSrc = res?.src ?? res?.url ?? (t as any)?.__srcPath ?? null;
      if (cardSrc) img.src = cardSrc;
      img.style.cssText = `width:64px;height:64px;image-rendering:pixelated;`;
      div.appendChild(img);
      // 2026-05 v11: surface CRIT info on every prospect card so the
      // player can see the burst potential at draw time without having
      // to dig through the Codex. Format: "12% · 1.5×" or "—" for none.
      const cc = (def.critChance ?? 0) as number;
      const cm = (def.critMult ?? 1.5) as number;
      const critTxt = cc > 0 ? `${Math.round(cc * 100)}% · ${cm.toFixed(2)}×` : '—';
      const critCol = cc >= 0.18 ? '#ffd34d' : (cc > 0 ? '#ffbe7a' : '#aa9a4a');
      div.innerHTML += `<div style="margin-top:2px">${def.name}</div><div style="color:#aaa">${cost}g · ${damageTypeLabel(def.damageType)}</div><div style="font-size:9.5px;letter-spacing:1px;margin-top:1px"><span style="color:#aa9a4a">CRIT</span> <span style="color:${critCol};font-weight:bold">${critTxt}</span></div>`;
      div.onclick = () => this.cb.onCardSelected(idx);
      this.cards.appendChild(div);
    });

    // Buttons enable/disable
    this.startBtn.disabled = !(
      state.phase === GamePhase.BUILD_PHASE ||
      state.phase === GamePhase.PROSPECT_PLACEMENT ||
      state.phase === GamePhase.PICK_KEEPER
    );
    this.startBtn.style.opacity = this.startBtn.disabled ? '0.4' : '1';
    const uc = poolUpgradeCost(state);
    this.upgradeBtn.textContent = uc < 0 ? 'POOL MAXIMA' : `UPGRADE POOL (${uc}g)`;
    this.upgradeBtn.disabled = state.phase === GamePhase.WAVE_PHASE || state.phase === GamePhase.GAME_OVER || state.phase === GamePhase.VICTORY || uc < 0 || !canAfford(state, uc);
    this.upgradeBtn.style.opacity = this.upgradeBtn.disabled ? '0.4' : '1';
    // Probability tooltip on UPGRADE POOL button (Strategy doc §6)
    {
      const POOL_PROBS = POOL_PROBABILITIES;
      const MAX = ECONOMY.POOL_MAX_LEVEL;
      const eff = Math.max(state.poolLevel, state.heroLevel);
      const cur = POOL_PROBS[Math.min(POOL_PROBS.length - 1, eff)];
      const nxt = POOL_PROBS[Math.min(POOL_PROBS.length - 1, eff + 1)];
      const fmt = (arr: number[]) => arr.map((p, i) => `T${i+1} ${p}%`).join('  ');
      this.upgradeBtn.title = uc < 0
        ? `Effective pool ${eff}/${MAX} (MAX)\n${fmt(cur)}`
        : `Currently ${eff}/${MAX} → ${fmt(cur)}\nNext  ${eff+1}/${MAX} → ${fmt(nxt)}`;
    }
    this.comboBtn.disabled = state.phase === GamePhase.WAVE_PHASE || state.phase === GamePhase.GAME_OVER || state.phase === GamePhase.VICTORY;

    // DPS CHECK button state: enabled between waves OR while a dummy is
    // active (so the second click can cancel it). The flag lives on
    // `state.__dpsCheckActive` (set/cleared in main.ts).
    const dpsBtnEl = document.getElementById('dps-check-btn') as HTMLButtonElement | null;
    if (dpsBtnEl) {
      const preWave = state.phase === GamePhase.BUILD_PHASE || state.phase === GamePhase.PROSPECT_PLACEMENT || state.phase === GamePhase.PICK_KEEPER;
      const active = !!(state as any).__dpsCheckActive;
      // Cancel path is available regardless of phase — even mid-wave the
      // player should be able to clear out a stuck dummy. Spawning is
      // still pre-wave only.
      const enabled = active || preWave;
      dpsBtnEl.disabled = !enabled;
      dpsBtnEl.style.opacity = enabled ? '1' : '0.45';
      dpsBtnEl.style.cursor = enabled ? 'pointer' : 'not-allowed';
      dpsBtnEl.textContent = active ? '🎯 CANCEL DUMMY' : '🎯 DPS CHECK';
      dpsBtnEl.title = active
        ? 'Click to cancel the training dummy and clear it from the path. No summary popup will appear.'
        : preWave
          ? 'Spawn a training dummy on the path to measure damage. Causes zero harm — pure data.'
          : 'DPS Check is a pre-wave tool — use it between waves.';
    }

    // 2026-05 v11: SHOP "NEW STOCK!" badge — every 4 waves the gate-shop
    // rotation refreshes. The badge pulses on the SHOP button to make the
    // refresh visible so players don't think the shop is permanently
    // stale. Cleared on next shop open. Style: gold glowing border + a
    // small "★ NEW" prefix injected into the button text.
    const shopBtnEl = document.getElementById('shop-btn') as HTMLButtonElement | null;
    if (shopBtnEl) {
      const refreshed = !!(state as any).shopRefreshedUnopened;
      if (refreshed) {
        if (shopBtnEl.textContent !== '★ NEW · SHOP') shopBtnEl.textContent = '★ NEW · SHOP';
        shopBtnEl.style.background = 'linear-gradient(180deg,#aa7a1a,#5a3a08)';
        shopBtnEl.style.boxShadow = '0 0 12px rgba(255,211,77,0.85), inset 0 0 8px #000';
        shopBtnEl.style.border = '2px solid #ffd34d';
        shopBtnEl.style.color = '#ffd34d';
        shopBtnEl.style.fontWeight = 'bold';
        shopBtnEl.style.animation = 'shopRefreshPulse 1.4s ease-in-out infinite';
        // Inject the keyframes once.
        if (!document.getElementById('shop-refresh-keyframes')) {
          const st = document.createElement('style');
          st.id = 'shop-refresh-keyframes';
          st.textContent = `@keyframes shopRefreshPulse { 0%,100% { box-shadow: 0 0 12px rgba(255,211,77,0.85), inset 0 0 8px #000; } 50% { box-shadow: 0 0 20px rgba(255,211,77,1), inset 0 0 10px #000; } }`;
          document.head.appendChild(st);
        }
      } else {
        if (shopBtnEl.textContent !== 'SHOP') shopBtnEl.textContent = 'SHOP';
        shopBtnEl.style.background = '#7a5a1a';
        shopBtnEl.style.boxShadow = '';
        shopBtnEl.style.border = '';
        shopBtnEl.style.color = '';
        shopBtnEl.style.fontWeight = '';
        shopBtnEl.style.animation = '';
      }
    }

    // 2026-05 v11 (B5): Mercator countdown chip — fires 1-2 waves before
    // each Mercator visit (W4/W9/W14/W19) so the player knows to save gold
    // for the legendary trophies + T5 armory. Sits just above the next-wave
    // preview chip; same insert-anchor + visual language so the two read as
    // a single info strip.
    const MERCATOR_VISIT_WAVES = [4, 9, 14, 19];
    let mercChip = document.getElementById('mercator-countdown');
    if (!mercChip) {
      mercChip = document.createElement('div');
      mercChip.id = 'mercator-countdown';
      mercChip.style.cssText = `padding:5px 10px;background:linear-gradient(180deg,#2a1d0e,#1a1209);border:2px solid #d4af37;color:#ffd34d;font-size:10.5px;letter-spacing:1.5px;text-align:center;display:none;font-weight:bold;box-shadow:0 0 12px rgba(212,175,55,0.35)`;
      this.hud.parentElement?.insertBefore(mercChip, this.hud.nextSibling);
    }
    const inPreWave = state.phase === GamePhase.BUILD_PHASE || state.phase === GamePhase.PROSPECT_PLACEMENT || state.phase === GamePhase.PICK_KEEPER;
    // 2026-05 v10 — Endless mode has no Mercator visits (state.wave is
    // frozen at 20, never matches MERCATOR_VISIT_WAVES). Hide the chip
    // entirely so the player isn't teased with a vendor that won't
    // appear. Could be reworked later as an endless-specific stocker.
    if (inPreWave && !state.endlessMode) {
      const nextWaveNum = state.wave + 1;
      const arrivesNext = MERCATOR_VISIT_WAVES.includes(nextWaveNum);
      const arrivesIn2  = MERCATOR_VISIT_WAVES.includes(nextWaveNum + 1);
      if (arrivesNext) {
        mercChip.style.display = '';
        mercChip.innerHTML = `★ MERCATOR ARRIVES NEXT WAVE (W${nextWaveNum}) — save your gold · 75g LEGENDARIES · 50g T5 TOWERS`;
      } else if (arrivesIn2) {
        mercChip.style.display = '';
        mercChip.innerHTML = `★ MERCATOR ARRIVES IN 2 WAVES (W${nextWaveNum + 1}) — start banking gold`;
      } else {
        mercChip.style.display = 'none';
      }
    } else {
      mercChip.style.display = 'none';
    }

    // Next-wave preview: small banner under HUD listing the upcoming wave's composition
    let preview = document.getElementById('next-wave-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'next-wave-preview';
      preview.style.cssText = `padding:6px 10px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:1px solid #3a3025;color:#cdb98a;font-size:11px;letter-spacing:1px;text-align:center;display:none`;
      this.hud.parentElement?.insertBefore(preview, this.hud.nextSibling);
    }
    // 2026-05 v10 — Endless mode hides the authored next-wave preview
    // entirely. The wave generator is random per-launch, so an accurate
    // preview can't be built ahead of time. The endless pre-wave
    // banner (in main.ts) replaces it.
    if (state.endlessMode) {
      preview.style.display = 'none';
      return;
    }
    if (state.phase === GamePhase.BUILD_PHASE || state.phase === GamePhase.PROSPECT_PLACEMENT || state.phase === GamePhase.PICK_KEEPER) {
      const wavesData = (window as any).__waves__ ?? null;
      const enemiesData = (window as any).__enemiesData ?? null;
      // Lazy-load waves data (cached on window after first read)
      const idx = state.wave; // since startWave does state.wave += 1, next index = state.wave
      const w = wavesData?.[idx];
      if (w) {
        // 2026-05 v11 (A3): enriched preview — each spawn group now shows
        // the per-unit runtime HP via the same `previewSpawnHp` helper the
        // Codex uses, so the player can size up the wave at a glance. The
        // wave-level threat tags (FLYERS / SHIELDED / REGEN / etc.) appear
        // as a one-line callout below the roster.
        const fmt = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1)}k` : `${n}`;
        const enemies = w.spawns.map((s: any) => {
          const def = enemiesData?.[s.type];
          const hp = def ? previewSpawnHp(def, idx + 1, w.type, w.hpMult) : 0;
          return `<span style="color:#e8d6a8">${s.count}× ${enemyName(s.type)}</span> <span style="color:#aa9a4a;font-size:10px">(${fmt(hp)} HP)</span>`;
        }).join(', ');
        // Carried-over enemies still walking the path from the previous wave.
        const carriedCounts: Record<string, number> = {};
        for (const e of state.enemies.values()) {
          carriedCounts[e.type] = (carriedCounts[e.type] ?? 0) + 1;
        }
        const carriedStr = Object.entries(carriedCounts)
          .map(([t, n]) => `${n}× ${enemyName(t)}`)
          .join(', ');
        const carriedSuffix = carriedStr ? ` <span style="color:#ffaa55">+ ${carriedStr} (carried over)</span>` : '';
        // 2026-05 v11 (A3): threat tags — distilled from per-enemy flags in
        // the wave's spawn list. Each tag is one-word actionable so the
        // player knows what they need (anti-air for FLYERS, melee for
        // SHIELDED, DoT for REGEN, etc.) without opening the Codex.
        const types = new Set<string>(w.spawns.map((s: any) => s.type));
        const carriedTypes = new Set(carriedCounts ? Object.keys(carriedCounts) : []);
        for (const t of carriedTypes) types.add(t);
        const tags: { txt: string; color: string }[] = [];
        const seen = (test: (d: any) => boolean) => {
          for (const t of types) {
            const d = enemiesData?.[t];
            if (d && test(d)) return true;
          }
          return false;
        };
        if (w.type === 'B') tags.push({ txt: 'BOSS', color: '#ee5555' });
        if (seen(d => d.isFlyer))                          tags.push({ txt: 'FLYERS',   color: '#66ccff' });
        if (seen(d => d.requiresMeleeBreak))               tags.push({ txt: 'SHIELDED', color: '#aabbdd' });
        if (seen(d => d.outOfCombatRegen || d.regenPctPerSec)) tags.push({ txt: 'REGEN',    color: '#88dd88' });
        if (seen(d => d.checkpointHealPct))                tags.push({ txt: 'WAYPOINT-HEAL', color: '#66ff88' });
        if (seen(d => d.meleeImmune))                      tags.push({ txt: 'MELEE-IMMUNE', color: '#cccccc' });
        if (seen(d => d.lowHpSpeedBoost))                  tags.push({ txt: 'RUNNERS',  color: '#ffaa44' });
        if (seen(d => d.splitOnDeath))                     tags.push({ txt: 'SPLIT-ON-DEATH', color: '#ff8855' });
        if (seen(d => d.rebirthAtPct))                     tags.push({ txt: 'REBIRTH', color: '#aa55ff' });
        if (seen(d => d.dodgeChance))                      tags.push({ txt: 'DODGES', color: '#cc88cc' });
        if (seen(d => d.stealthInterval))                  tags.push({ txt: 'STEALTH', color: '#aaaaff' });
        if (seen(d => d.auraTowerSlow))                    tags.push({ txt: 'TOWER-SLOW-AURA', color: '#ff7733' });
        if ((w as any).necromancy)                         tags.push({ txt: 'NECROMANCY', color: '#aa55ff' });
        const tagBar = tags.length > 0
          ? `<div style="margin-top:3px;font-size:9.5px;letter-spacing:1.5px">THREATS: ${tags.map(t => `<span style="color:${t.color};font-weight:bold;border:1px solid ${t.color}55;padding:1px 4px;margin:0 2px">${t.txt}</span>`).join('')}</div>`
          : '';
        const isBoss = w.type === 'B';
        preview.style.display = '';
        preview.innerHTML = `${isBoss ? '<span style="color:#ee5555;font-weight:bold;letter-spacing:2px">⚠ BOSS WAVE ⚠</span> · ' : ''}<b style="color:#9be0ff">NEXT: WAVE ${idx + 1}</b> · ${factionName(w.faction)} · ${enemies}${carriedSuffix}${tagBar}`;
      } else {
        preview.style.display = 'none';
      }
    } else {
      preview.style.display = 'none';
    }

    // Tip bar with context-aware tutorial
    const tipText = document.getElementById('tip-text');
    if (tipText) {
      // Prospect placement: actual remaining-click count is the cap (10) minus
      // what's been placed this round — the prospectQueue is just the
      // pre-rolled pool that auto-refills, not the placement budget.
      // 2026-05 v11: cap raised 8 → 10 for more maze-shaping flexibility.
      const prospectsLeft = Math.max(0, 10 - (state.prospectsPlaced ?? 0));
      // FINAL HOUR override — when the next wave to start is W20 (the
      // upcoming-wave index is state.wave during the build/prospect/keeper
      // round), the tip bar trades its normal coaching line for a hype
      // sliver so the player sees the stakes every time they glance down.
      const upcomingIsFinal = state.wave + 1 === 20 && (
        state.phase === GamePhase.PROSPECT_PLACEMENT ||
        state.phase === GamePhase.PICK_KEEPER ||
        state.phase === GamePhase.BUILD_PHASE
      );
      const phaseTip = upcomingIsFinal
        ? `⚔ FINAL HOUR — wave 20 is one fight against the Daemon Imperator. Combine, shop, top off lives. There is no wave 21. Glory or the column.`
        : state.phase === GamePhase.PROSPECT_PLACEMENT
          ? (prospectsLeft > 0
              ? `Click any empty grass tile to roll a prospect (1g each). ${prospectsLeft} roll${prospectsLeft === 1 ? '' : 's'} left this round. Press START WAVE when done — unkept prospects cement into walls.`
              : `Roll cap reached (10/10). Press START WAVE to pick your 2 keepers.`)
          : state.phase === GamePhase.PICK_KEEPER
            ? 'Click a glowing prospect tower to KEEP it (2 keeps per round). Press START WAVE to lock in your picks; everything unkept cements into walls.'
            : state.phase === GamePhase.BUILD_PHASE
              ? (state.lives < 10
                  ? `LOW LIVES. Buy +Lives at the SHOP, combine glowing towers, sell weak stones to redraw the maze. Press START WAVE when ready.`
                  : 'Build phase. Combine eligible (red-ringed) towers, shop the gate, sell stones to redraw the maze. Press START WAVE when ready.')
              : state.phase === GamePhase.WAVE_PHASE
                ? `Wave ${state.wave} in progress. Towers fight automatically. Click any enemy to inspect resistances.`
                : state.hint;
      tipText.textContent = selectedTowerInfo ?? phaseTip ?? state.hint;
    }
  }
}

function formatHpMult(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function mkBtn(label: string, bg: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = `background:${bg};color:#e8d6a8;border:2px solid #5a4a30;padding:8px 14px;font-family:inherit;font-size:13px;cursor:pointer;letter-spacing:1px;`;
  return b;
}

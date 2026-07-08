import { GameStateShape } from '../GameState';
import { GamePhase, TowerType, TargetingMode } from '../types';
// 2026-05-19 — Hero defs for HUD chip rendering. Reads tier title,
// XP thresholds, and ability tier requirements off the JSON.
import HERO_DEFS_TABLE from '../data/herodefs.json';
import { ECONOMY, GRID, POOL_PROBABILITIES, WAVE } from '../constants';
import { tex } from './Assets';
import { canAfford, poolUpgradeCost } from '../systems/EconomySystem';
import { previewSpawnHp } from '../systems/WaveManager';
import { displayWaveNumber } from '../systems/TestYourMightLabels';
import { factionName, enemyName, damageTypeLabel } from '../format';
import towersData from '../data/towers.json';
import { computeLeaderboardScoreForState } from './Leaderboard';

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
  // 2026-05-19 — Hero HUD chip → inspect panel handler. Fired when
  // the player clicks the chip below the GOLD/LIVES block.
  onHeroInspect?: (heroTowerId: string) => void;
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
  // 2026-05-25 — track the last bulk-set targeting mode so the TARGET
  // ALL picker can highlight the "currently on" option. Without this
  // the player clicked into the submenu and couldn't tell which mode
  // they'd last applied — the buttons all looked identical.
  // 2026-05-29 — defaults to FIRST (not null) so the TARGET ALL button reads
  // "🎯 TARGET ALL · FIRST" and the FIRST picker row shows the active ✓ from
  // game start, matching the FIRST default every freshly-placed tower now
  // lands on (TowerSystem.createTower). A new game is a full page reload, so
  // this re-initializes to FIRST every game — the player adjusts from there.
  private lastBulkTargetMode: TargetingMode | null = TargetingMode.FIRST;
  private targetAllPickerButtons: { mode: TargetingMode; btn: HTMLButtonElement }[] = [];
  private targetAllBtn: HTMLButtonElement | null = null;

  constructor(parent: HTMLElement, cb: UICallbacks, opts?: { leftPanel?: HTMLElement; rightPanel?: HTMLElement }) {
    this.cb = cb;
    // SPLIT-PANEL LAYOUT: HUD (waves/gold/lives) lives in the LEFT panel.
    // Action buttons (start, speed, pool, shop, quests, codex) live in
    // the RIGHT panel. Stage-wrap is the middle column — already wired in
    // index.html as a flex sibling, so we DON'T move it into a wrapper
    // (doing so re-ordered the columns and pushed the map to the far right).
    //
    // 2026-05-29 — Co-op Legion reuses this exact sidebar. It passes its own
    // panel containers via `opts` so the HUD + buttons render INSIDE the
    // Legion overlay rather than the campaign's static #left/#right panels.
    // Single-player passes no opts → identical behavior (the ?? chain falls
    // straight through to getElementById exactly as before).
    const leftPanel = opts?.leftPanel ?? document.getElementById('left-panel') ?? parent;
    const rightPanel = opts?.rightPanel ?? document.getElementById('right-panel') ?? parent;
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
    this.startBtn.title = 'Begin the next wave. If prospect cards are still unplaced, Rome will warn you first.';
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
    speedBtn.title = 'Cycle game speed: 1× → 2× → 4× → 1×. Same simulation, just faster. 4× is noticeably less readable mid-boss but saves real time on routine clear-up waves and replays.';
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
    targetAllBtn.title = 'Bulk-retarget EVERY placed tower at once. Click to open the mode picker (FIRST / LAST / STRONG / WEAKEST / CLOSE / FLYERS / FAST), pick a mode, and every eligible tower on the map switches to it. Flyer-only towers stay on FLYERS. Saves you from opening each tower individually.';
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
      { mode: TargetingMode.STRONG,  label: 'STRONG',  tip: 'Bosses first, then commanders, then highest HP' },
      { mode: TargetingMode.WEAKEST, label: 'WEAKEST', tip: 'Lowest current HP enemy — finisher mode' },
      { mode: TargetingMode.CLOSE,   label: 'CLOSE',   tip: 'Physically closest enemy' },
      { mode: TargetingMode.FLYERS,  label: 'FLYERS',  tip: 'Flyers first, then ground when allowed' },
      { mode: TargetingMode.FAST,    label: 'FAST',    tip: 'Highest current speed — catch sprinters' },
    ];
    // 2026-05-25 — restyle each picker button to support an "ACTIVE"
    // visual state. The currently selected bulk-set mode renders with
    // a gold-on-green background (matches the per-tower TARGETING row
    // in TowerMenu) and a "✓ " prefix; inactive modes stay the dim
    // pink-on-maroon default. Hover styles respect the active state so
    // hovering the active button doesn't lose the highlight.
    const renderPickerState = () => {
      for (const { mode, btn } of this.targetAllPickerButtons) {
        const isActive = this.lastBulkTargetMode === mode;
        btn.style.background = isActive ? '#3a5520' : '#2a1a25';
        btn.style.color      = isActive ? '#d4af37' : '#ffb3d9';
        btn.style.borderColor = isActive ? '#d4af37' : '#5a3a4a';
        btn.style.fontWeight  = isActive ? 'bold'   : 'normal';
        // Label updates so the player can see at a glance which mode is on.
        const label = TARGET_ALL_MODES.find(m => m.mode === mode)?.label ?? '';
        btn.textContent = isActive ? `✓ ${label}` : label;
      }
      // Also reflect on the closed button so the player can see the
      // current bulk mode without opening the picker.
      const closedLabel = this.lastBulkTargetMode != null
        ? `🎯 TARGET ALL · ${TargetingMode[this.lastBulkTargetMode]}`
        : '🎯 TARGET ALL';
      targetAllBtn.textContent = closedLabel;
    };
    for (const m of TARGET_ALL_MODES) {
      const b = document.createElement('button');
      b.textContent = m.label;
      b.title = m.tip;
      b.style.cssText = 'background:#2a1a25;color:#ffb3d9;border:1px solid #5a3a4a;padding:6px 8px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px;text-align:left';
      b.onmouseenter = () => {
        // Hover only brightens the inactive buttons. The active button
        // keeps its gold-on-green highlight so the player never loses
        // sight of "what's currently on."
        if (this.lastBulkTargetMode !== m.mode) b.style.background = '#3a2535';
      };
      b.onmouseleave = () => {
        if (this.lastBulkTargetMode !== m.mode) b.style.background = '#2a1a25';
      };
      b.onclick = () => {
        this.lastBulkTargetMode = m.mode;
        (cb as any).onSetAllTargeting?.(m.mode);
        // Don't auto-close — the player asked for the selection to
        // persist visually, and keeping the picker open lets them see
        // the new highlight land BEFORE they look away. Closes on a
        // second click of the TARGET ALL button (toggle), same as it
        // did before.
        renderPickerState();
      };
      targetAllPicker.appendChild(b);
      this.targetAllPickerButtons.push({ mode: m.mode, btn: b });
    }
    this.targetAllBtn = targetAllBtn;
    targetAllBtn.onclick = () => {
      const open = targetAllPicker.style.display !== 'none';
      targetAllPicker.style.display = open ? 'none' : 'flex';
      // Subtle highlight while the picker is open so the player can tell.
      targetAllBtn.style.background = open ? '#3a1a2a' : '#5a2a3a';
      // Re-stamp the picker state each time it opens so the active
      // highlight reflects the most recent bulk choice.
      if (!open) renderPickerState();
    };
    // Initial paint so the closed button label reflects state on boot
    // (defaults to "🎯 TARGET ALL · FIRST" — every game starts on FIRST;
    // picking another mode swaps the suffix to "· STRONG", etc.).
    renderPickerState();
    // Order: START / SPEED / PAUSE / POOL / SHOP / QUESTS / CODEX / SELL-STONES / LEADERBOARD / DPS CHECK / TARGET ALL (+ picker) / SETTINGS.
    // (Sound mute lives inside SETTINGS panel now — 2026-05 v11.)
    //
    // 2026-05-22 UX4 — Mobile overflow menu. Sidebar has 13 buttons; on
    // a phone-landscape viewport that's overwhelming and pushes
    // primary actions below the fold. We group the secondary /
    // diagnostic actions (SELL STONES / LEADERBOARD / DPS CHECK /
    // TARGET ALL / SETTINGS) inside a single #hud-overflow-group
    // container that is hidden by default on mobile via CSS in
    // index.html. A #hud-overflow-toggle button toggles the
    // .hud-overflow-open class on #right-panel so the group reveals.
    // On desktop the toggle is hidden via CSS, the group is always
    // visible inline — no behavior change.
    const overflowGroup = document.createElement('div');
    overflowGroup.id = 'hud-overflow-group';
    overflowGroup.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    overflowGroup.append(sellStonesBtn, leaderBtn, dpsBtn, targetAllBtn, targetAllPicker, settingsBtn);
    const overflowToggle = mkBtn('⋯ MORE', '#2a1a14');
    overflowToggle.id = 'hud-overflow-toggle';
    overflowToggle.title = 'More controls (Sell Stones, Leaderboard, DPS Check, Target All, Settings)';
    overflowToggle.onclick = () => {
      const rp = document.getElementById('right-panel');
      if (!rp) return;
      const open = rp.classList.toggle('hud-overflow-open');
      overflowToggle.textContent = open ? '✕ HIDE' : '⋯ MORE';
    };
    buttons.append(
      this.startBtn, speedBtn, pauseBtn, this.upgradeBtn,
      shopBtn, this.mercatorBtn, questsBtn, codexBtn,
      overflowToggle, overflowGroup
    );

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
    // endless score in place of the campaign counter.
    // 2026-05-22 UX6 — Each hud-icon gains data-stat="…" so the mobile
    // tap-to-reveal popover (wired below) can match it to a friendly
    // explanation. Desktop hover-title strings stay as the fallback.
    const waveNum = displayWaveNumber(state);
    const currentWaveCleared = state.phase !== GamePhase.WAVE_PHASE && state.phase !== GamePhase.GAME_OVER;
    const campaignLeaderboardScore = computeLeaderboardScoreForState(state, currentWaveCleared);
    const waveDisplay = state.endlessMode
      ? `<span class="hud-icon" data-stat="endless" style="color:#ff5050"><span class="ic ic-wave"></span><b>ENDLESS</b> E${state.endlessWave ?? 0}</span>
         <span class="hud-icon" data-stat="score" title="Cumulative endless score" style="color:#ff5050"><b>SCORE</b> ${(state.endlessScore ?? 0).toLocaleString()}</span>`
      : `<span class="hud-icon" data-stat="wave"><span class="ic ic-wave"></span><b>WAVE</b> ${waveNum}/${WAVE.TOTAL}</span>`;
    left.innerHTML = `
      ${waveDisplay}
      <span class="hud-icon" data-stat="lives"><span class="ic ic-life"></span><b>LIVES</b> ${Math.floor(state.lives)}</span>
      <span class="hud-icon" data-stat="gold"><span class="ic ic-gold"></span><b>GOLD</b> ${Math.floor(state.gold)}</span>
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
      <span class="hud-icon" data-stat="pool"><span class="ic ic-pool"></span><b>POOL</b> ${state.poolLevel}/${ECONOMY.POOL_MAX_LEVEL}</span>
      <span class="hud-icon" data-stat="probs" title="Tier roll probabilities at the current effective pool. Click 📖 CODEX → POOL for full table.">${probStrip}</span>
      <span class="hud-icon" data-stat="score"><span class="ic ic-score"></span><b>SCORE</b> ${campaignLeaderboardScore.toLocaleString()}</span>
      <span class="hud-icon" data-stat="phase" style="color:#9be0ff;font-weight:900;font-size:14px;letter-spacing:2px;text-shadow:1px 1px 0 #000">${phaseStr}</span>
    `;
    this.hud.append(left, right);
    // UX6 — Wire tap-to-reveal popover for each stat chip. Same handler
    // for desktop click (low cost, helpful) and mobile tap. The popover
    // is created on-demand and dismissed by tapping the document
    // anywhere outside it.
    const STAT_HELP: Record<string, { title: string; body: string }> = {
      wave:    { title: 'WAVE',     body: 'Current wave out of 30. Survive all 30 to clear the campaign. Bosses arrive at major milestones; the difficulty curve steepens hard after W15.' },
      endless: { title: 'ENDLESS',  body: 'Endless mode in progress. HP scales +50% per endless wave; rewards stack with the campaign score on the leaderboard.' },
      lives:   { title: 'LIVES',    body: 'How many enemies can reach your gate before Rome falls. Bosses cost 10 lives if they leak. Buy more lives in the SHOP — but each purchased life dings your score.' },
      gold:    { title: 'GOLD',     body: 'Spent on placing prospects (1 g per roll), buying items in the SHOP, and upgrading your draw POOL. Earned from kills and quests.' },
      pool:    { title: 'POOL',     body: 'Draw-pool level. Higher levels skew prospect rolls toward rarer, stronger towers. Upgrade with the UPGRADE POOL button between waves.' },
      probs:   { title: 'TIER ODDS', body: 'Chance of rolling each tier when you spend 1 g on an empty tile. Reading left to right: T1 · T2 · T3 · T4 · T5. CODEX → POOL has the full curve.' },
      score:   { title: 'SCORE',    body: 'Leaderboard score estimate. It uses waves cleared, combo towers forged, quests completed, and the W30 victory bonus. Kill/event points are no longer shown as the campaign score.' },
      phase:   { title: 'PHASE',    body: 'BUILD = place towers, you have time. PLACING PROSPECTS = roll any leftover prospects. WAVE = combat is live. Use ⏸ PAUSE any time.' }
    };
    const showHudPopover = (anchor: HTMLElement, key: string) => {
      const info = STAT_HELP[key];
      if (!info) return;
      document.getElementById('hud-stat-popover')?.remove();
      const pop = document.createElement('div');
      pop.id = 'hud-stat-popover';
      const ar = anchor.getBoundingClientRect();
      pop.style.cssText = `
        position: fixed; left: ${Math.max(8, ar.left)}px; top: ${ar.bottom + 6}px;
        max-width: min(320px, 90vw); padding: 12px 14px;
        background: linear-gradient(180deg, #1a1208, #0c0804);
        border: 2px solid #ffd34d;
        box-shadow: 0 0 18px rgba(255,211,77,0.45), 0 8px 22px rgba(0,0,0,0.55);
        font-family: 'Courier New', monospace; color: #e8d6a8;
        z-index: 130; line-height: 1.5; font-size: 13px;
      `;
      pop.innerHTML = `
        <div style="color:#ffd34d;font-weight:900;font-size:12px;letter-spacing:3px;margin-bottom:6px">${info.title}</div>
        <div>${info.body}</div>
        <div style="text-align:right;margin-top:8px;font-size:10px;letter-spacing:2px;color:#aa9a4a;cursor:pointer" data-close>TAP TO CLOSE ✕</div>
      `;
      document.body.appendChild(pop);
      const dismiss = (ev: Event) => {
        if (pop.contains(ev.target as Node)) {
          pop.remove();
          document.removeEventListener('click', dismiss, true);
          return;
        }
        pop.remove();
        document.removeEventListener('click', dismiss, true);
      };
      // Defer one tick so the click that opened the popover doesn't
      // immediately close it via the capture-phase listener.
      setTimeout(() => document.addEventListener('click', dismiss, true), 0);
    };
    for (const el of Array.from(this.hud.querySelectorAll('[data-stat]'))) {
      (el as HTMLElement).style.cursor = 'pointer';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const key = (el as HTMLElement).dataset.stat || '';
        showHudPopover(el as HTMLElement, key);
      });
    }

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
    this.upgradeBtn.disabled = state.phase === GamePhase.WAVE_PHASE || state.phase === GamePhase.GAME_OVER || state.phase === GamePhase.VICTORY || uc < 0;
    this.upgradeBtn.style.opacity = this.upgradeBtn.disabled ? '0.4' : (!canAfford(state, uc) ? '0.65' : '1');
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
        mercChip.innerHTML = `★ MERCATOR ARRIVES NEXT WAVE (W${nextWaveNum}) — save your gold · 740g LEGENDARIES · 325g T5 TOWERS`;
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
          const hp = def ? previewSpawnHp(def, idx + 1, w.type, w.hpMult, !!state.activeHeroId) : 0;
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
        if (idx + 1 >= 26)                                tags.push({ txt: 'APEX CHECK', color: '#ffd34d' });
        if (seen(d => d.isFlyer))                          tags.push({ txt: 'FLYERS',   color: '#66ccff' });
        if ((w as any).comboAntiAirArmorPct)                tags.push({ txt: 'COMBO-AA', color: '#88ddff' });
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
      // FINAL HOUR override — when the next wave to start is W30 (the
      // upcoming-wave index is state.wave during the build/prospect/keeper
      // round), the tip bar trades its normal coaching line for a hype
      // sliver so the player sees the stakes every time they glance down.
      const upcomingIsFinal = state.wave + 1 === WAVE.TOTAL && (
        state.phase === GamePhase.PROSPECT_PLACEMENT ||
        state.phase === GamePhase.PICK_KEEPER ||
        state.phase === GamePhase.BUILD_PHASE
      );
      const phaseTip = upcomingIsFinal
        ? `⚔ FINAL HOUR — wave ${WAVE.TOTAL} is one fight against the Daemon Imperator. Combine, shop, top off lives. There is no wave ${WAVE.TOTAL + 1}. Glory or the column.`
        : state.phase === GamePhase.PROSPECT_PLACEMENT
          ? (prospectsLeft > 0
              ? `Click any empty grass tile to roll a prospect (1g each). ${prospectsLeft} roll${prospectsLeft === 1 ? '' : 's'} left this round. START WAVE warns you if prospect cards are still unplaced.`
              : `Roll cap reached (10/10). Press START WAVE to pick your 2 keepers.`)
          : state.phase === GamePhase.PICK_KEEPER
            ? 'Click a glowing prospect tower to KEEP it (2 keeps per round). Press START WAVE to lock in your picks; everything unkept cements into walls.'
            : state.phase === GamePhase.BUILD_PHASE
              ? (state.lives < 10
                  ? `LOW LIVES. Buy +Lives at the SHOP, combine glowing towers, sell weak stones to redraw the maze. Press START WAVE when ready.`
                  : 'Build phase. Combine eligible (red-ringed) towers, shop the gate, sell stones to redraw the maze. Press START WAVE when ready.')
              : state.phase === GamePhase.WAVE_PHASE
                ? `Wave ${displayWaveNumber(state)} in progress. Towers fight automatically. Click any enemy to inspect resistances.`
                : state.hint;
      tipText.textContent = selectedTowerInfo ?? phaseTip ?? state.hint;
    }
    // 2026-05-19 — HERO HUD CHIP. Renders below the GOLD/LIVES block
    // when state.activeHeroId is set. Click → opens hero inspect
    // panel (TowerMenu short-circuits on tower.isHero in C9).
    if (state.activeHeroId) {
      const heroDef: any = (HERO_DEFS_TABLE as any)[state.activeHeroId];
      if (heroDef) {
        const tier = state.heroTier ?? 0;
        const xp = state.heroXp ?? 0;
        const thresholds: number[] = heroDef.xpThresholds ?? [0, 75, 280, 650, 1300];
        const tierTitles: string[] = heroDef.tierTitles ?? ['TIRO','LEGATUS','CONSUL','IMPERATOR','DIVUS'];
        const nextThreshold = thresholds[Math.min(thresholds.length - 1, tier + 1)] ?? thresholds[thresholds.length - 1];
        const curThreshold = thresholds[tier] ?? 0;
        const pctToNext = tier >= 4
          ? 100
          : Math.max(0, Math.min(100, ((xp - curThreshold) / Math.max(1, nextThreshold - curThreshold)) * 100));
        const tint = heroDef.visual?.tierUpColor ?? '#ffd34d';
        const chip = document.createElement('div');
        chip.id = 'hero-hud-chip';
        chip.title = 'Click to inspect the hero (XP, abilities, items).';
        chip.style.cssText = `
          margin-top: 6px;
          padding: 8px 10px;
          background: linear-gradient(180deg, rgba(34,25,18,0.95), rgba(10,6,4,0.95));
          border: 2px solid ${tint};
          color: ${tint};
          cursor: pointer;
          font-family: 'Courier New', monospace;
          box-shadow: 0 0 10px ${tint}33;
          transition: box-shadow 0.18s, transform 0.12s;
        `;
        chip.onmouseenter = () => { chip.style.boxShadow = `0 0 20px ${tint}88`; chip.style.transform = 'translateY(-1px)'; };
        chip.onmouseleave = () => { chip.style.boxShadow = `0 0 10px ${tint}33`; chip.style.transform = ''; };
        // 2026-05-20 v2 — Hero Forge stack badges. Three small chips
        // showing the player's investment per path (DMG/CD/AURA, 0..5).
        // Always rendered (even at 0/0/0) so the player learns the
        // feature exists; dimmed to 0.55 alpha when stack=0.
        const forge = state.heroForgeStacks ?? { dmg: 0, cd: 0, aura: 0 };
        const forgeRow = `<div style="display:flex;gap:4px;margin-top:4px">
          ${[['dmg','⚔','#ff5a4a','SHARPEN'],['cd','⏱','#5a9fff','HASTEN'],['aura','✨','#ffd34d','EMPOWER']].map(([key,icon,col,name]) => {
            const v = (forge as any)[key] as number;
            const op = v === 0 ? 0.45 : 1;
            return `<span title="${name} — ${v}/5" style="flex:1;display:flex;align-items:center;justify-content:center;gap:2px;background:#0c0a08;border:1px solid ${col};color:${col};font-size:9px;padding:2px 0;opacity:${op};letter-spacing:1px"><span style="font-size:10px">${icon}</span>${v}/5</span>`;
          }).join('')}
        </div>`;
        chip.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
            <div style="font-size:11px;font-weight:bold;letter-spacing:2px">⚔ ${(heroDef.name ?? '').toUpperCase()}</div>
            <div style="font-size:9px;color:#cdb98a;letter-spacing:1px">${tierTitles[tier] ?? ''}</div>
          </div>
          <div style="position:relative;background:#0c0a08;border:1px solid #5a4a30;height:8px;overflow:hidden">
            <div style="width:${pctToNext}%;height:100%;background:linear-gradient(90deg, ${tint}, ${tint}aa);transition:width 0.3s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:9px;color:#aa9a4a;letter-spacing:1px">
            <span>XP ${xp}${tier < 4 ? ` / ${nextThreshold}` : ''}</span>
            <span>${(heroDef.abilities ?? []).map((a: any, i: number) => {
              const unlocked = (tier >= a.level);
              const dot = unlocked ? tint : '#3a3025';
              return `<span title="${(a.name ?? a.id)}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};margin-left:3px;box-shadow:${unlocked ? `0 0 6px ${tint}` : 'none'}"></span>`;
            }).join('')}</span>
          </div>
          ${forgeRow}
        `;
        chip.onclick = () => {
          // Click → re-route to the hero's tower-tile click flow.
          const heroTowerId = state.activeHeroTowerId;
          if (heroTowerId && this.cb?.onHeroInspect) this.cb.onHeroInspect(heroTowerId);
        };
        this.hud.appendChild(chip);
      }
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

import { GameStateShape } from '../GameState';
import { WAVE } from '../constants';
import { TowerType } from '../types';

const HS_KEY = 'roman_td_highscore_v1';

export function loadHighScore(): { score: number; rank: string } {
  try {
    const raw = localStorage.getItem(HS_KEY);
    if (!raw) return { score: 0, rank: 'NONE' };
    return JSON.parse(raw);
  } catch { return { score: 0, rank: 'NONE' }; }
}

export function saveHighScore(score: number, rank: string) {
  const cur = loadHighScore();
  if (score > cur.score) localStorage.setItem(HS_KEY, JSON.stringify({ score, rank }));
}

// Threshold (seconds): clear a wave faster than this and you start
// earning the speed bonus. 60s ≈ the natural duration of an average
// mid-game wave with steady kills; tuned so casual play earns a small
// bonus and very-fast clears earn a large one.
const SPEED_BONUS_TARGET_SEC = 60;
// Score awarded per FULL second saved against the target, per wave.
const SPEED_BONUS_PER_SEC = 25;
// Hard cap per-wave so a tiny early wave can't print 1500g of points.
const SPEED_BONUS_MAX_PER_WAVE = 1200;

// Detail of the wave-speed bonus — exposed for the end-screen breakdown
// so the player can SEE how their pace stacked up vs. the target.
export interface SpeedBonusBreakdown {
  total: number;
  perWave: Array<{ wave: number; sec: number; bonus: number }>;
}

export function computeSpeedBonus(state: GameStateShape): SpeedBonusBreakdown {
  const durations = state.waveDurations ?? [];
  let total = 0;
  const perWave: SpeedBonusBreakdown['perWave'] = [];
  for (let i = 0; i < durations.length; i++) {
    const sec = durations[i] ?? 0;
    if (sec <= 0) continue;
    // Linear bonus = (target - actual) × per-sec, clamped 0..max.
    const raw = (SPEED_BONUS_TARGET_SEC - sec) * SPEED_BONUS_PER_SEC;
    const bonus = Math.max(0, Math.min(SPEED_BONUS_MAX_PER_WAVE, Math.round(raw)));
    total += bonus;
    perWave.push({ wave: i + 1, sec: Math.round(sec * 10) / 10, bonus });
  }
  return { total, perWave };
}

export function computeFinalScore(state: GameStateShape, won: boolean): number {
  let s = state.score;
  s += state.lives * 100;     // +100 per life remaining
  s += state.gold * 10;    // +10 per unspent gold
  // 2026-05 v10: speed bonus — clearing waves quickly is rewarded.
  s += computeSpeedBonus(state).total;
  if (won) s += 10000;
  // 2026-05-22 V33 — Lives bought at gate / Mercator cost 300 score each.
  // Mirrors the breakdown formula in computeFinalScoreBreakdown so the
  // legacy end-screen path and the modern showEndSummary path apply the
  // same penalty. Clamped to 0 so the run never goes negative.
  s -= (state.livesBoughtThisRun ?? 0) * 300;
  return Math.max(0, s);
}

export function computeRank(state: GameStateShape, won: boolean): string {
  const towersTypes = new Set(Array.from(state.towers.values()).map(t => t.type));
  if (won && towersTypes.has(TowerType.JULIUS_CAESAR) && towersTypes.has(TowerType.GOD_OF_WAR)) return 'DIVINUS';
  if (won && state.lives >= 10) return 'IMPERATOR';
  if (won) return 'LEGATUS';
  if (state.wave >= 14) return 'CENTURIO';
  if (state.wave >= 8) return 'MILES';
  return 'TIRO';
}

// Build a "WHY YOU LOST" analysis from the leak data + tower/combo state.
// Surfaces the top cause of the failure AND specific actionable improvement
// tips for the NEXT run.
function buildDeathAnalysis(state: GameStateShape): string {
  const leaks = state.leaksByArchetype ?? {};
  const total = (Object.values(leaks) as number[]).reduce((s, n) => s + n, 0);
  const sorted = (Object.entries(leaks) as [string, number][]).sort((a, b) => b[1] - a[1]);
  // ─── Build state snapshot for diagnosing build mistakes ───────────────
  const towers = Array.from(state.towers.values()).filter(t => !t.pending);
  const towersByType = new Set(towers.map(t => String(t.type)));
  const damageTypes = new Set(towers.map(t => String((t as any).damageType ?? '')));
  const hasAntiAir = towers.some(t => {
    const tt = String(t.type);
    return tt === 'AQUILA_VENATOR' || tt === 'SAGITTARIUS' || tt === 'VENATOR'
        || tt === 'NEMESIS_ENGINE' || tt === 'NUMIDIAN_CAVALRY';
  });
  const bossKillers = ['SCORPIO','PRIMUS_PILUS','SCORPION_BOLT','WAR_CHARIOT','JULIUS_CAESAR',
                       'HANNIBALS_NIGHTMARE','PONTIFEX_MAXIMUS','CARTHAGE_SCOURGE','PRAEFECTUS'];
  const hasBossKiller = towers.some(t => bossKillers.includes(String(t.type)));
  const combosBuilt = state.combosBuilt ?? 0;
  const uniqueCombos = (state.combosBuiltUniqueTypes ?? []).length;
  const stonesPlaced = state.stonesPlaced ?? 0;
  const poolLevel = state.poolLevel ?? 0;
  const ownedT4plus = towers.filter(t => t.qualityTier >= 4).length;
  const wave = state.wave;
  // ─── Primary cause from archetype leaks (existing logic, refined) ─────
  const PRIMARY_CAUSE: Record<string, string> = {
    SWARM: 'Swarm enemies overwhelmed you — too many small enemies, not enough AoE.',
    RUNNER: 'Runners outran your towers — fast enemies leaked before you could finish them.',
    ARMORED: 'Armored enemies absorbed your damage — physical hits glanced off.',
    RESISTANT: 'Your damage type was being resisted — the enemies were tuned against your build.',
    BULKY: 'Tanky enemies soaked your damage — you needed bigger single-target hits.',
    ELITE: 'Elite enemies broke through — their auras debuffed your towers.',
    BOSS: 'A boss reached the gate — you lacked focused boss damage.'
  };
  const PRIMARY_TIP: Record<string, string> = {
    SWARM: 'Build AoE — Hastati cleave, Plague Cart, Inferno Cart, Siege Onager, War Chariot, Triumphator nova.',
    RUNNER: 'Add slows + burst — Velites (slow), Plague Cart (slow+poison), Frozen Legion (freeze), Pugio Assassin (anti-runner +50%).',
    ARMORED: 'Apply Armor Shred (Centurion, Retiarius, Speculator) then hammer with SIEGE (Turris, Carroballista) or DIVINE (Flamen, Solar Priest).',
    RESISTANT: 'Diversify damage types — physical alone gets absorbed. Add DIVINE (Solar Priest ignores resists) or SIEGE.',
    BULKY: "Stack burst — Scorpio (every 5th hit ×3), Primus Pilus, Hannibal's Nightmare. Apply MARK for +damage from all sources.",
    ELITE: 'Kill druid/legate units FIRST — they aura-slow your towers. Speculator marks them for +damage.',
    BOSS: 'Build a boss-killer lane — Scorpio (+40% bosses), Primus Pilus, War Chariot (+50% bosses), Julius Caesar (-50% boss armor), Pontifex Maximus (+200% bosses).'
  };
  // ─── Cross-cutting "you missed this entirely" tips ────────────────────
  const tips: string[] = [];
  if (!hasAntiAir) {
    tips.push('⚠ <b>NO ANTI-AIR TOWERS</b> — every run will see flyer waves. Sagittarius, Aquila Venator (AA-only), Eques, or the Nemesis Engine combo cover the sky.');
  }
  if (!hasBossKiller && wave >= 5) {
    tips.push('⚠ <b>NO BOSS-KILLER</b> — major bosses land at W5 / 10 / 20 / 24 / 30. Build at least one Scorpio / Primus Pilus / War Chariot / Pontifex Maximus before W10.');
  }
  if (combosBuilt < Math.floor(wave / 4) && wave >= 6) {
    tips.push(`⚠ <b>LOW COMBO COUNT</b> — only ${combosBuilt} combos built by wave ${wave}. Base towers fall off past W10; the recipes in the codex are how you keep up.`);
  }
  if (uniqueCombos < 3 && wave >= 10) {
    tips.push(`⚠ <b>NO COMBO VARIETY</b> — only ${uniqueCombos} unique combo type${uniqueCombos === 1 ? '' : 's'}. Diversify damage types via different combos to break resistance walls.`);
  }
  if (damageTypes.size <= 2 && wave >= 10) {
    tips.push('⚠ <b>SINGLE DAMAGE TYPE</b> — every faction resists at least one type. Spread across PHYS / SIEGE / FIRE / DIVINE so no faction sponges you.');
  }
  if (poolLevel < 3 && wave >= 8) {
    tips.push(`⚠ <b>LOW POOL LEVEL</b> — pool ${poolLevel}/8. Each upgrade tilts your prospect rolls to higher tiers AND grants +3% global tower damage. Invest by wave 8.`);
  }
  if (stonesPlaced < 10 && wave >= 6) {
    tips.push('⚠ <b>SHORT MAZE</b> — fewer than 10 prospect tiles placed. Longer paths = more shots fired per enemy. Each empty-tile click during prospects costs 1g and the unkept ones cement into walls; the codex calls this "maze for time."');
  }
  if (ownedT4plus === 0 && wave >= 15) {
    tips.push('⚠ <b>NO T4+ TOWERS</b> — by W15 you should own at least one Tier 4 tower (via lucky rolls, same-tier merging, or Mercator purchase).');
  }
  // ─── Leak breakdown rows (top 4) ──────────────────────────────────────
  const leakRows = total > 0
    ? sorted.slice(0, 4).map(([k, n]) => `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:12px"><span style="color:#aa9a4a">${k}</span><b style="color:#ee5555">${n} leaked</b></div>`).join('')
    : '<div style="color:#aa9a4a;font-size:11px;font-style:italic">No leaks recorded.</div>';
  // ─── Compose ──────────────────────────────────────────────────────────
  const primaryCause = total > 0 && sorted[0] ? sorted[0][0] : null;
  const primaryHtml = primaryCause
    ? `<div style="margin-top:10px;color:#fff8e0;font-size:12px;line-height:1.55"><b style="color:#ee5555">Primary cause:</b> ${PRIMARY_CAUSE[primaryCause] ?? 'Mixed leaks.'}</div>
       <div style="margin-top:6px;color:#88ff88;font-size:11px;line-height:1.55"><b>→ Next run:</b> ${PRIMARY_TIP[primaryCause] ?? 'Adjust your build to the leak source.'}</div>`
    : '';
  const tipsHtml = tips.length > 0
    ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #5a3a3a">
        <div style="font-size:11px;color:#88ff88;letter-spacing:2px;margin-bottom:6px;font-weight:bold">IMPROVEMENT TIPS</div>
        ${tips.map(t => `<div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:6px">${t}</div>`).join('')}
      </div>`
    : '';
  return `<div style="margin-top:14px;text-align:left;background:#0c0a08;border:1px solid #5a3a3a;padding:12px 14px;max-height:46vh;overflow-y:auto">
    <div style="font-size:11px;color:#aa9a4a;letter-spacing:2px;margin-bottom:6px">WHY YOU LOST</div>
    ${leakRows}
    ${primaryHtml}
    ${tipsHtml}
  </div>`;
}

// Compact end-screen line summarizing the speed bonus.
function speedBonusLine(state: GameStateShape): string {
  const sb = computeSpeedBonus(state);
  if (sb.total <= 0 || sb.perWave.length === 0) return '';
  const wavesEarning = sb.perWave.filter(w => w.bonus > 0).length;
  const avgSec = sb.perWave.length > 0
    ? sb.perWave.reduce((s, w) => s + w.sec, 0) / sb.perWave.length
    : 0;
  return `<div>Speed Bonus: <b style="color:#88ff88">+${sb.total.toLocaleString()}</b> <span style="color:#aa9a4a;font-size:12px">(${wavesEarning}/${sb.perWave.length} fast waves, avg ${avgSec.toFixed(1)}s)</span></div>`;
}

export function showGameOver(parent: HTMLElement, state: GameStateShape, onRestart: () => void) {
  const existing = document.getElementById('end-screen');
  if (existing) return;
  const finalScore = computeFinalScore(state, false);
  const rank = computeRank(state, false);
  saveHighScore(finalScore, rank);
  const hi = loadHighScore();
  const analysis = buildDeathAnalysis(state);
  const speedLine = speedBonusLine(state);
  const modal = document.createElement('div');
  modal.id = 'end-screen';
  // 2026-05-19 — Responsive clamping (Codex pattern).
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:radial-gradient(circle,rgba(80,0,0,0.85),rgba(0,0,0,0.95));z-index:100;padding:16px 8px;box-sizing:border-box;overflow:auto;color:#e8d6a8;font-family:'Courier New',monospace;`;
  modal.innerHTML = `<div style="text-align:center;padding:24px 28px;border:3px solid #aa1a1a;background:#1a0a08;width:min(580px,94vw);box-shadow:0 0 36px rgba(170,26,26,0.55)">
    <h1 style="margin:0;font-size:32px;color:#ee2a2a;letter-spacing:6px;text-shadow:3px 3px 0 #000">ROME HAS FALLEN</h1>
    <div style="margin:6px 0 18px;font-size:14px;color:#aa6a6a;letter-spacing:2px">CASTRUM LUNUM, AVGVSTI MMXXVI</div>
    <div style="font-size:14px;line-height:1.7">
      <div>Wave reached: <b style="color:#d4af37">${state.wave}</b> / ${WAVE.TOTAL}</div>
      <div>Score: <b style="color:#d4af37">${finalScore.toLocaleString()}</b></div>
      ${speedLine}
      <div>Latin Rank: <b style="color:#d4af37">${rank}</b></div>
      <div>Best: <b style="color:#aa9a4a">${hi.score.toLocaleString()} (${hi.rank})</b></div>
    </div>
    ${analysis}
    <button id="restart-btn" style="margin-top:20px;background:#7a1a1a;color:#e8d6a8;border:2px solid #5a4a30;padding:10px 24px;font-family:inherit;font-size:14px;letter-spacing:3px;cursor:pointer">TRY AGAIN</button>
  </div>`;
  parent.appendChild(modal);
  document.getElementById('restart-btn')!.onclick = () => { modal.remove(); onRestart(); };
}

export function showVictory(parent: HTMLElement, state: GameStateShape, onRestart: () => void) {
  const existing = document.getElementById('end-screen');
  if (existing) return;
  const finalScore = computeFinalScore(state, true);
  const rank = computeRank(state, true);
  saveHighScore(finalScore, rank);
  const hi = loadHighScore();
  const modal = document.createElement('div');
  modal.id = 'end-screen';
  // 2026-05-19 — Responsive clamping (Codex pattern).
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:radial-gradient(circle,rgba(120,90,0,0.85),rgba(0,0,0,0.95));z-index:100;padding:16px 8px;box-sizing:border-box;overflow:auto;color:#e8d6a8;font-family:'Courier New',monospace;`;
  modal.innerHTML = `<div style="text-align:center;padding:30px;border:3px solid #d4af37;background:#1a1410;width:min(500px,94vw);">
    <h1 style="margin:0;font-size:32px;color:#ffd34d;letter-spacing:6px;text-shadow:3px 3px 0 #000">ROMA AETERNA</h1>
    <div style="margin:6px 0 18px;font-size:14px;color:#aa9a4a;letter-spacing:2px">CASTRUM LUNUM STANDS</div>
    <div style="font-size:14px;line-height:1.7">
      <div>Wave 50 boss DEFEATED.</div>
      <div>Score: <b style="color:#ffd34d">${finalScore.toLocaleString()}</b></div>
      ${speedBonusLine(state)}
      <div>Latin Rank: <b style="color:#ffd34d">${rank}</b></div>
      <div>Best: <b style="color:#aa9a4a">${hi.score.toLocaleString()} (${hi.rank})</b></div>
    </div>
    <button id="restart-btn" style="margin-top:20px;background:#3a5520;color:#e8d6a8;border:2px solid #5a4a30;padding:10px 24px;font-family:inherit;font-size:14px;letter-spacing:3px;cursor:pointer">PLAY AGAIN</button>
  </div>`;
  parent.appendChild(modal);
  document.getElementById('restart-btn')!.onclick = () => { modal.remove(); onRestart(); };
}

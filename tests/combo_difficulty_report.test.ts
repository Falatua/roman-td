// Combo difficulty ↔ power correlation report (2026-07-11). Run with:
//   COMBO_REPORT=1 npx vitest run tests/combo_difficulty_report.test.ts
//
// Question under test: do harder-to-assemble combo recipes actually pay off
// with more power, and are the easy ones appropriately weaker?
//
// DIFFICULTY = expected number of prospect draws to assemble the recipe,
// computed from the REAL draw machinery: tier rolled from POOL_PROBABILITIES
// at a pool level, then type picked uniformly from the Solo tier pool
// (native unlock band through the rolled tier, max-tier filtered) — the exact
// mirror of TowerSystem.rollSoloDraw. P(ingredient) sums P(tier)×P(type|tier)
// over tiers ≥ minTier; expected draws = 1/P; recipe difficulty = Σ over
// ingredients, recursing into combo ingredients (memoized). Reported at the
// pool level that MINIMIZES the recipe's expected draws (the level a player
// hunting it would sit at). Combine gold (recursive) reported alongside.
// Known simplifications: ignores the 5-cards-per-draw parallelism, duplicate
// -upgrade bumps, same-tier merge side-paths, and Fortuna rerolls — these
// compress absolute numbers but preserve relative ranking.
//
// POWER = the resist-weighted screen model from balance_report.test.ts,
// blended across MID/LATE/END phases (0.25/0.35/0.40 — combos are mid-to-
// late-game assets). DoT contribution is clamped to 1.5× the tower's direct
// output so the late-game %maxHP blowup (shared 7%/sec cap, immunities)
// doesn't distort rank.
import { describe, expect, it } from 'vitest';
import towersData from '../src/data/towers.json';
import combosData from '../src/data/towerCombinations.json';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import { DamageType, EnemyFaction, StatusEffectKind } from '../src/types';
import { resistanceModifier } from '../src/systems/DamageTypeSystem';
import { enemyDamageMultiplier, statusEffectiveness } from '../src/systems/EnemyResistances';
import { POOL_PROBABILITIES } from '../src/constants';
import { soloProspectTierPool } from '../src/systems/TowerSystem';

const RUN = !!process.env.COMBO_REPORT;

// ── draw-probability model (mirrors rollDraw) ──────────────────────────────
function tierPools(): Record<number, string[]> {
  const pools: Record<number, string[]> = {};
  for (let tier = 1; tier <= 5; tier++) {
    pools[tier] = soloProspectTierPool(tier).map(String);
  }
  return pools;
}

function drawChance(pools: Record<number, string[]>, level: number, type: string, minTier: number): number {
  const weights = POOL_PROBABILITIES[Math.min(POOL_PROBABILITIES.length - 1, level)];
  const sum = weights.reduce((a, b) => a + b, 0);
  let p = 0;
  for (let tier = Math.max(1, minTier); tier <= 5; tier++) {
    const pool = pools[tier];
    if (!pool.includes(type)) continue;
    p += (weights[tier - 1] / sum) / pool.length;
  }
  return p;
}

interface Difficulty { draws: number; gold: number; level: number; special: string[]; }

function computeDifficulty(): Map<string, Difficulty> {
  const pools = tierPools();
  const recipeOf = new Map<string, any>();
  for (const r of combosData as any[]) recipeOf.set(r.result, r);
  const memo = new Map<string, Difficulty>();

  function bestIngredientDraws(type: string, minTier: number): { perLevel: number[]; special?: string } {
    const perLevel: number[] = [];
    for (let level = 0; level < POOL_PROBABILITIES.length; level++) {
      const p = drawChance(pools, level, type, minTier);
      perLevel.push(p > 0 ? 1 / p : Infinity);
    }
    if (perLevel.every(v => !isFinite(v))) return { perLevel, special: type };
    return { perLevel };
  }

  function solve(result: string, stack: string[] = []): Difficulty {
    if (memo.has(result)) return memo.get(result)!;
    if (stack.includes(result)) return { draws: Infinity, gold: 0, level: 0, special: [`cycle:${result}`] };
    const recipe = recipeOf.get(result);
    if (!recipe) {
      // no prospect-path recipe (Mercator champions etc.)
      const d: Difficulty = { draws: Infinity, gold: 0, level: 0, special: [`no-recipe:${result}`] };
      memo.set(result, d);
      return d;
    }
    // Per pool level, sum expected draws of BASE ingredients; combo/naval
    // ingredients contribute their own solved difficulty (level-independent
    // once minimized) — a simplification that keeps levels comparable.
    const special: string[] = [];
    let comboDraws = 0;
    let gold = recipe.cost ?? 0;
    const basePerLevel = new Array(POOL_PROBABILITIES.length).fill(0);
    for (const ing of recipe.ingredients) {
      const def: any = (towersData as any)[ing.type];
      const minTier = ing.minTier ?? 1;
      if (def?.kind === 'BASE') {
        const { perLevel, special: sp } = bestIngredientDraws(ing.type, minTier);
        if (sp) { special.push(`${sp}≥T${minTier}`); continue; }
        for (let l = 0; l < basePerLevel.length; l++) basePerLevel[l] += perLevel[l];
      } else if (def?.kind === 'NAVAL') {
        special.push(`naval:${ing.type}`);
      } else {
        const sub = solve(ing.type, [...stack, result]);
        comboDraws += sub.draws;
        gold += sub.gold;
        special.push(...sub.special);
      }
    }
    let bestLevel = 0;
    for (let l = 1; l < basePerLevel.length; l++) if (basePerLevel[l] < basePerLevel[bestLevel]) bestLevel = l;
    const d: Difficulty = {
      draws: basePerLevel[bestLevel] + comboDraws,
      gold, level: bestLevel, special
    };
    memo.set(result, d);
    return d;
  }

  for (const r of combosData as any[]) solve(r.result);
  return memo;
}

// ── power model (compact copy of balance_report scoring, DoT clamped) ──────
const DT_OF: Record<string, DamageType> = {
  PHYS_MELEE: DamageType.PHYS_MELEE, PHYS_RANGED: DamageType.PHYS_RANGED,
  SIEGE: DamageType.SIEGE, ELEMENTAL_FIRE: DamageType.ELEMENTAL_FIRE,
  DIVINE: DamageType.DIVINE, NONE: DamageType.NONE
};
interface PoolEntry { faction: number; isFlyer: boolean; isBoss: boolean; weight: number; hp: number; type: string; }

function buildPhases(): PoolEntry[][] {
  const spans: Array<[number, number]> = [[8, 15], [16, 23], [24, 30]];
  return spans.map(([lo, hi]) => {
    const out: PoolEntry[] = [];
    for (const wave of wavesData as any[]) {
      if (wave.wave < lo || wave.wave > hi) continue;
      const milestone = Math.pow(1.5, Math.max(0, Math.floor((wave.wave - 1) / 5)));
      for (const g of wave.spawns) {
        const def: any = (enemiesData as any)[g.type];
        if (!def || def.isBoss) continue;
        const hp = def.baseHp * (wave.hpMult ?? 1) * milestone * (def.isFlyer ? 1.22 : 1);
        out.push({ type: g.type, faction: (EnemyFaction as any)[def.faction], isFlyer: !!def.isFlyer, isBoss: false, weight: g.count * hp, hp });
      }
    }
    return out;
  });
}

function parsePower(def: any, pool: PoolEntry[], lateHaircut: boolean): number {
  const a: string = def.ability ?? '';
  const num = (re: RegExp): number => { const m = a.match(re); return m ? parseFloat(m[1]) : 0; };
  const splash = num(/(\d+(?:\.\d+)?)[- ]tile splash/i);
  let multi = 0;
  const wordN: Record<string, number> = { TWIN: 2, TWO: 2, TRIPLE: 3, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6 };
  const mm = a.match(/(?:fires at|rains? .*? at|volley at) (\d+|two|three|four|five|six) (?:separate |distinct )?(?:targets|flyers|enemies)/i);
  if (mm) multi = parseInt(mm[1]) || wordN[mm[1].toUpperCase()] || 0;
  if (/SIX-bolt volley|six-target/i.test(a)) multi = 6;
  if (/TWIN (?:ARTILLERY|SIEGE|JAVELINS)/i.test(a)) multi = 2;
  if (/TRIPLE BOLT/i.test(a)) multi = 3;
  const pierce = num(/[Pp]ierces (\d+) targets/);
  if (pierce) multi = Math.max(multi, pierce);
  let chainMult = 0;
  const cm = a.match(/chains to (\d+)/i);
  if (cm) {
    const decay = num(/decaying (\d+)% per jump/i);
    const keepPct = num(/retaining (\d+)%/i);
    const keep = keepPct ? keepPct / 100 : decay ? 1 - decay / 100 : 0.75;
    for (let k = 0; k <= parseInt(cm[1]); k++) chainMult += Math.pow(keep, k);
  }
  let aoe = 1;
  if (/CLEAVE|cleaves/i.test(a)) aoe = Math.max(aoe, 1.77);
  if (def.coneAttack) aoe = Math.max(aoe, 2.0);
  if (splash > 0) aoe = Math.max(aoe, 1 + splash);
  if (multi > 1) aoe = Math.max(aoe, multi);
  if (chainMult > 0) aoe = Math.max(aoe, chainMult);
  const flyerPct = num(/\+(\d+)% (?:damage )?vs (?:Flyers|FLYERS)/i) / 100;
  const dotM = a.match(/(\d+(?:\.\d+)?)(?:[–-]\d+(?:\.\d+)?)?% ?(?:maxHP|HP)\/sec/i);
  const dotMag = dotM ? Math.min(parseFloat(dotM[1]) / 100, /HELLFIRE/i.test(a) ? 0.02 : 0.07) : 0;
  const dotKind = /HELLFIRE/i.test(a) ? StatusEffectKind.HELLFIRE : /POISON/i.test(a) ? StatusEffectKind.POISON : /BLEED/i.test(a) ? StatusEffectKind.BLEED : StatusEffectKind.BURN;

  const dt = DT_OF[def.damageType] ?? DamageType.NONE;
  const isMelee = !!def.melee;
  const crit = 1 + (def.critChance ?? 0) * ((def.critMult ?? 1) - 1);
  let wSum = 0, dmgSum = 0, dotSum = 0, coverW = 0, totalW = 0;
  for (const e of pool) {
    totalW += e.weight;
    const targetable = def.antiAirOnly ? e.isFlyer : isMelee ? !e.isFlyer : true;
    if (!targetable) continue;
    coverW += e.weight;
    const fake: any = { type: e.type, isFlyer: e.isFlyer, isBoss: false, statusEffects: [], mutation: undefined };
    let res = resistanceModifier(e.faction, dt) * enemyDamageMultiplier(fake, dt);
    if (lateHaircut && !e.isFlyer && (dt === DamageType.PHYS_RANGED || dt === DamageType.SIEGE)) res *= 0.75;
    if (e.isFlyer && dt === DamageType.SIEGE) res *= 1.20;
    let bonus = 1;
    if (e.isFlyer && flyerPct) bonus *= 1 + flyerPct;
    dmgSum += e.weight * res * bonus;
    if (dotMag > 0) dotSum += e.weight * dotMag * e.hp * statusEffectiveness(fake, dotKind);
    wSum += e.weight;
  }
  if (wSum === 0) return 0;
  const direct = (def.baseDps ?? 0) * crit * (dmgSum / wSum) * aoe;
  const dot = Math.min(dotSum / wSum, 1.5 * Math.max(1, direct));   // clamp the late blowup
  return (direct + dot) * (coverW / Math.max(1, totalW));
}

(RUN ? describe : describe.skip)('combo difficulty vs power', () => {
  it('prints the correlation report', () => {
    const difficulty = computeDifficulty();
    const phases = buildPhases();
    const rows: any[] = [];
    for (const r of combosData as any[]) {
      const def: any = (towersData as any)[r.result];
      if (!def) continue;
      const d = difficulty.get(r.result)!;
      const p = phases.map((pool, i) => parsePower(def, pool, true));
      const power = 0.25 * p[0] + 0.35 * p[1] + 0.40 * p[2];
      rows.push({
        result: r.result, name: def.name, band: def.tierBand ?? '-',
        support: (def.baseDps ?? 0) === 0,
        draws: d.draws, gold: d.gold, level: d.level,
        special: d.special.join(','),
        power: Math.round(power)
      });
    }
    // rank only the plain prospect-path damage combos; support + special-path listed separately
    const core = rows.filter(r => isFinite(r.draws) && !r.special && !r.support);
    core.sort((a, b) => a.draws - b.draws);
    core.forEach((r, i) => (r.diffRank = i + 1));
    const byPower = [...core].sort((a, b) => b.power - a.power);
    byPower.forEach((r, i) => (r.powerRank = i + 1));
    const n = core.length;
    const lines: string[] = [];
    lines.push(`prospect-path damage combos ranked: ${n} (of ${rows.length} recipes)`);
    lines.push('result                band draws  gold  Lv power  diffR powR  flag');
    for (const r of core) {
      // difficulty rank 1 = easiest. Power rank 1 = strongest. In a perfect
      // ladder easiest ≈ weakest: diffRank ≈ (n+1-powerRank).
      const expectedPowerRank = n + 1 - r.diffRank;
      const gap = r.powerRank - expectedPowerRank;   // negative = stronger than its difficulty earns
      let flag = '';
      if (gap <= -Math.round(n * 0.25)) flag = '⚠ TOO STRONG for its difficulty';
      if (gap >= Math.round(n * 0.25)) flag = '⚠ TOO WEAK for its difficulty';
      lines.push(
        `${(r.name as string).padEnd(21)} T${String(r.band).padEnd(2)} ${String(Math.round(r.draws)).padStart(5)} ${String(r.gold).padStart(5)} ${String(r.level).padStart(3)} ${String(r.power).padStart(6)} ${String(r.diffRank).padStart(5)} ${String(r.powerRank).padStart(4)}  ${flag}`
      );
    }
    lines.push('\nsupport combos (no damage score; judge by difficulty + aura package):');
    for (const r of rows.filter(x => x.support)) {
      lines.push(`${(r.name as string).padEnd(21)} T${String(r.band).padEnd(2)} draws=${isFinite(r.draws) ? Math.round(r.draws) : 'special'} gold=${r.gold} ${r.special}`);
    }
    lines.push('\nspecial-acquisition recipes (naval contracts / Mercator champions in the chain):');
    for (const r of rows.filter(x => x.special && !x.support)) {
      lines.push(`${(r.name as string).padEnd(21)} T${String(r.band).padEnd(2)} baseDraws=${isFinite(r.draws) ? Math.round(r.draws) : '-'} gold=${r.gold} power=${r.power} [${r.special}]`);
    }
    const out = lines.join('\n');
    console.log(out);
    const fs = require('node:fs');
    fs.writeFileSync(process.env.COMBO_REPORT_OUT || '/tmp/combo-report.txt', out);
    expect(rows.length).toBeGreaterThan(40);
  });
});

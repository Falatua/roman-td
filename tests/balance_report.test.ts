// Deep tower/item balance report (2026-07-09). Run with:
//   BALANCE_REPORT=1 npx vitest run tests/balance_report.test.ts
//
// Not a pass/fail test — it prints a phase-weighted effective-power model
// for every tower using the REAL resist pipeline (resistanceModifier ×
// enemyDamageMultiplier), the real 30-wave spawn tables, crits, AoE/multi-
// target expectations, DoT (%maxHP/sec vs phase-average HP, shared boss ward),
// the post-W7 ranged/siege ground haircut, and flyer-coverage rules.
// Mechanics that live only in ability prose (splash tiles, bolt counts,
// chains, DoT magnitudes, boss/flyer bonuses) are regex-extracted from the
// ability strings — the parsed struct is printed so extraction errors are
// visible rather than silent.
import { describe, expect, it } from 'vitest';
import towersData from '../src/data/towers.json';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import itemsData from '../src/data/items_permanent.json';
import { DamageType, EnemyFaction, StatusEffectKind } from '../src/types';
import { resistanceModifier } from '../src/systems/DamageTypeSystem';
import { bossDotDamageMultiplier, enemyDamageMultiplier, statusEffectiveness } from '../src/systems/EnemyResistances';

const RUN = !!process.env.BALANCE_REPORT;

const DT_OF: Record<string, DamageType> = {
  PHYS_MELEE: DamageType.PHYS_MELEE, PHYS_RANGED: DamageType.PHYS_RANGED,
  SIEGE: DamageType.SIEGE, ELEMENTAL_FIRE: DamageType.ELEMENTAL_FIRE,
  DIVINE: DamageType.DIVINE, NONE: DamageType.NONE
};

interface PoolEntry { type: string; faction: number; isFlyer: boolean; isBoss: boolean; weight: number; hp: number; }
interface Phase { name: string; lo: number; hi: number; nonboss: PoolEntry[]; boss: PoolEntry[]; }

function buildPhases(): Phase[] {
  const phases: Phase[] = [
    { name: 'EARLY W1-7', lo: 1, hi: 7, nonboss: [], boss: [] },
    { name: 'MID W8-15', lo: 8, hi: 15, nonboss: [], boss: [] },
    { name: 'LATE W16-23', lo: 16, hi: 23, nonboss: [], boss: [] },
    { name: 'END W24-30', lo: 24, hi: 30, nonboss: [], boss: [] }
  ];
  for (const wave of wavesData as any[]) {
    const phase = phases.find(p => wave.wave >= p.lo && wave.wave <= p.hi)!;
    const milestone = Math.pow(1.5, Math.max(0, Math.floor((wave.wave - 1) / 5)));
    for (const g of wave.spawns) {
      const def: any = (enemiesData as any)[g.type];
      if (!def) continue;
      const hp = def.baseHp * (wave.hpMult ?? 1) * milestone * (def.isFlyer ? 1.22 : 1);
      const entry: PoolEntry = {
        type: g.type, faction: (EnemyFaction as any)[def.faction],
        isFlyer: !!def.isFlyer, isBoss: !!def.isBoss,
        weight: g.count * hp, hp
      };
      (def.isBoss ? phase.boss : phase.nonboss).push(entry);
    }
  }
  return phases;
}

// ── ability-prose extraction ────────────────────────────────────────────────
interface Mech {
  splash: number; multi: number; chain: { n: number; keep: number } | null; cleave: boolean; cone: boolean;
  bossPct: number; flyerPct: number; dot: { kind: 'BURN' | 'POISON' | 'BLEED' | 'HELLFIRE'; mag: number; dur: number } | null;
  slowPct: number; stun: boolean; freeze: boolean; support: boolean;
}
function parseMech(id: string, def: any): Mech {
  const a: string = def.ability ?? '';
  const num = (re: RegExp): number => { const m = a.match(re); return m ? parseFloat(m[1]) : 0; };
  const splash = num(/(\d+(?:\.\d+)?)[- ]tile splash/i);
  let multi = 0;
  const wordN: Record<string, number> = { TWIN: 2, TWO: 2, TRIPLE: 3, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6 };
  const mm = a.match(/(?:fires at|rains? .*? at|volley at) (\d+|two|three|four|five|six) (?:separate |distinct )?(?:targets|flyers|enemies)/i);
  if (mm) multi = parseInt(mm[1]) || wordN[mm[1].toUpperCase()] || 0;
  if (/SIX-bolt volley/i.test(a)) multi = 6;
  if (/six-target/i.test(a)) multi = 6;
  if (/TWIN (?:ARTILLERY|SIEGE|JAVELINS)/i.test(a)) multi = 2;
  if (/TRIPLE BOLT/i.test(a)) multi = 3;
  const pierce = num(/[Pp]ierces (\d+) targets/);
  if (pierce) multi = Math.max(multi, pierce);
  let chain: Mech['chain'] = null;
  const cm = a.match(/chains to (\d+)/i);
  if (cm) {
    const decay = num(/decaying (\d+)% per jump/i);
    const keepPct = num(/retaining (\d+)%/i);
    chain = { n: parseInt(cm[1]), keep: keepPct ? keepPct / 100 : decay ? 1 - decay / 100 : 0.75 };
  }
  const dotM = a.match(/(\d+(?:\.\d+)?)(?:[–-]\d+(?:\.\d+)?)?% ?(?:maxHP|HP)\/sec/i);
  let dot: Mech['dot'] = null;
  if (dotM) {
    const mag = parseFloat(dotM[1]) / 100;
    const dur = num(/for (\d+(?:\.\d+)?)s/i) || (/permanent/i.test(a) ? 999 : 4);
    const kind = /HELLFIRE/i.test(a) ? 'HELLFIRE' : /POISON/i.test(a) ? 'POISON' : /BLEED/i.test(a) ? 'BLEED' : 'BURN';
    dot = { kind, mag, dur };
  } else if (/applies (?:stacking )?BLEED/i.test(a)) dot = { kind: 'BLEED', mag: 0.03, dur: 4 };
  else if (/POISON DoT on every strike/i.test(a)) dot = { kind: 'POISON', mag: 0.04, dur: 4 };
  const slowPct = Math.max(num(/[Ss]low(?:ing|s|ed)?(?: them| enemies| flyers)?(?: by)? (\d+)%/), num(/(\d+)% (?:movement )?SLOW/i), num(/Slow on every hit \((\d+)%/));
  return {
    splash, multi, chain,
    cleave: /CLEAVE|cleaves/i.test(a),
    cone: !!def.coneAttack,
    bossPct: num(/\+(\d+)% (?:damage )?(?:vs|to) Bosses/i) / 100,
    flyerPct: num(/\+(\d+)% (?:damage )?vs (?:Flyers|FLYERS)/i) / 100,
    dot, slowPct,
    stun: /STUN/i.test(a), freeze: /FREEZE|FROZEN/i.test(a),
    support: (def.baseDps ?? 0) === 0
  };
}

function aoeMult(m: Mech): number {
  let mult = 1;
  if (m.cleave) mult = Math.max(mult, 1.77);          // ~1.1 extra bodies at 70%
  if (m.cone) mult = Math.max(mult, 2.0);
  if (m.splash > 0) mult = Math.max(mult, 1 + 1.0 * m.splash);
  if (m.multi > 1) mult = Math.max(mult, m.multi);
  if (m.chain) {
    let s = 0; for (let k = 0; k <= m.chain.n; k++) s += Math.pow(m.chain.keep, k);
    mult = Math.max(mult, s);
  }
  return mult;
}

const KIND_OF: Record<string, StatusEffectKind> = {
  BURN: StatusEffectKind.BURN, POISON: StatusEffectKind.POISON,
  BLEED: StatusEffectKind.BLEED, HELLFIRE: StatusEffectKind.HELLFIRE
};

function score(id: string, def: any, m: Mech, pool: PoolEntry[], phaseIdx: number, vsBoss: boolean) {
  const dt = DT_OF[def.damageType] ?? DamageType.NONE;
  const isMelee = !!def.melee;
  const crit = 1 + (def.critChance ?? 0) * ((def.critMult ?? 1) - 1);
  let wSum = 0, dmgSum = 0, dotSum = 0, hpSum = 0, coverW = 0, totalW = 0;
  for (const e of pool) {
    totalW += e.weight;
    const targetable = def.antiAirOnly ? e.isFlyer : isMelee ? !e.isFlyer : true;
    if (!targetable) continue;
    coverW += e.weight;
    const fake: any = { type: e.type, isFlyer: e.isFlyer, isBoss: e.isBoss, statusEffects: [], mutation: undefined };
    let res = resistanceModifier(e.faction, dt) * enemyDamageMultiplier(fake, dt);
    if (phaseIdx > 0 && !e.isBoss && !e.isFlyer && (dt === DamageType.PHYS_RANGED || dt === DamageType.SIEGE)) res *= 0.75;
    if (e.isFlyer && dt === DamageType.SIEGE) res *= 1.20;
    let bonus = 1;
    if (e.isBoss && m.bossPct) bonus *= 1 + m.bossPct;
    if (e.isFlyer && m.flyerPct) bonus *= 1 + m.flyerPct;
    dmgSum += e.weight * res * bonus;
    if (m.dot) {
      const eff = statusEffectiveness(fake, KIND_OF[m.dot.kind]);
      const bossMod = bossDotDamageMultiplier(fake);
      const mag = Math.min(m.dot.mag, m.dot.kind === 'HELLFIRE' ? 0.02 : 0.07);
      dotSum += e.weight * mag * e.hp * eff * bossMod;
      hpSum += e.weight;
    }
    wSum += e.weight;
  }
  if (wSum === 0) return { st: 0, dotDps: 0, cover: 0, screen: 0 };
  const avgRes = dmgSum / wSum;
  const st = (def.baseDps ?? 0) * crit * avgRes;
  const dotDps = m.dot ? dotSum / wSum : 0;   // avg DoT dps on one targetable enemy
  const cover = coverW / Math.max(1, totalW);
  const screen = (st * aoeMult(m) + dotDps * Math.min(aoeMult(m), 3)) * cover;
  return { st, dotDps, cover, screen };
}

(RUN ? describe : describe.skip)('balance report', () => {
  it('prints the report', () => {
    const phases = buildPhases();
    const towers = Object.entries(towersData as any).filter(([, d]: any) => !d.isHero);
    const rows: any[] = [];
    for (const [id, def] of towers as Array<[string, any]>) {
      const m = parseMech(id, def);
      const perPhase = phases.map((p, i) => score(id, def, m, p.nonboss, i, false));
      const bossPhase = phases.map((p, i) => p.boss.length ? score(id, def, m, p.boss, i, true) : { screen: 0, st: 0, dotDps: 0, cover: 0 });
      rows.push({
        id, name: def.name, kind: def.kind, tier: def.tierBand ?? '-', dt: def.damageType,
        dps: def.baseDps, aoe: +aoeMult(m).toFixed(2),
        mech: m,
        screen: perPhase.map(s => Math.round(s.screen)),
        boss: bossPhase.map(s => Math.round(s.st + s.dotDps)),
        cover: perPhase.map(s => +s.cover.toFixed(2))
      });
    }
    // group and print
    const groups: Record<string, any[]> = {};
    for (const r of rows) {
      const key = `${r.kind} T${r.tier}`;
      (groups[key] ??= []).push(r);
    }
    const lines: string[] = [];
    for (const [g, rs] of Object.entries(groups).sort()) {
      lines.push(`\n═══ ${g} ═══`);
      rs.sort((a, b) => b.screen[2] - a.screen[2]);
      const med = rs.map(r => r.screen[2]).sort((a, b) => a - b)[Math.floor(rs.length / 2)] || 1;
      for (const r of rs) {
        const flags: string[] = [];
        if (rs.length > 2 && r.screen[2] > 1.7 * med) flags.push('⚠OVER');
        if (rs.length > 2 && r.screen[2] < 0.5 * med && !r.mech.support) flags.push('⚠UNDER');
        const cc = [r.mech.slowPct ? `slow${r.mech.slowPct}%` : '', r.mech.stun ? 'stun' : '', r.mech.freeze ? 'freeze' : ''].filter(Boolean).join('/');
        const dot = r.mech.dot ? `${r.mech.dot.kind}${(r.mech.dot.mag * 100).toFixed(0)}%/s` : '';
        lines.push(
          `${(r.name as string).padEnd(20)} ${String(r.dt).padEnd(14)} dps=${String(r.dps).padStart(6)} aoe=${String(r.aoe).padStart(5)} ` +
          `screen[E,M,L,F]=${JSON.stringify(r.screen).padEnd(26)} boss=${JSON.stringify(r.boss).padEnd(26)} cover=${JSON.stringify(r.cover)} ${dot} ${cc} ${flags.join(' ')}`
        );
      }
    }
    // items summary
    lines.push('\n═══ ITEMS (parsed +% by rarity) ═══');
    const rarityOrder = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
    for (const rar of rarityOrder) {
      const its = Object.entries(itemsData as any).filter(([, v]: any) => v.rarity === rar);
      for (const [iid, v] of its as Array<[string, any]>) {
        const dmg = v.effect.match(/\+(\d+)% damage/i)?.[1] ?? '';
        const spd = v.effect.match(/\+(\d+)% (?:attack )?speed/i)?.[1] ?? '';
        const rng = v.effect.match(/\+(\d+(?:\.\d+)?) tile/i)?.[1] ?? '';
        lines.push(`${rar.padEnd(10)} ${(v.name as string).padEnd(24)} dmg=${dmg.padStart(3)} spd=${spd.padStart(3)} rng=${rng.padStart(4)} :: ${v.effect}`);
      }
    }
    const out = lines.join('\n');
    console.log(out);
    // vitest may swallow console output in run mode — persist to disk too.
    const fs = require('node:fs');
    const dest = process.env.BALANCE_REPORT_OUT || '/tmp/roman-td-balance-report.txt';
    fs.writeFileSync(dest, out);
    expect(rows.length).toBeGreaterThan(50);
  });
});

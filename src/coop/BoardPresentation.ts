// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — BoardPresentation
//
// The single-player game's VISUAL + AUDIO layer lives in main.ts's frame
// loop and combat-hook closures (NOT exported). RomanBoard composed only
// the LOGIC systems, so Legion boards ticked combat but never drew the
// VFX (projectiles / slashes / blood / floaters / impact rings / boss bar
// / combo glow) and never played the per-tower / per-event sounds.
//
// This module faithfully MIRRORS those closures using the base game's
// already-exported pieces — every RenderEngine draw call is public, every
// gore emitter is exported from GoreSystem, and 100% of audio is exported
// from AudioManager. So a Legion board can present EXACTLY like
// single-player without forking main.ts (isolation contract preserved).
//
// It also fixes a real correctness gap: in the base engine, ranged/caster/
// siege towers apply their damage in the PROJECTILE'S onImpact (via
// applyDamageAndStatus), not at fire time. RomanBoard passed an empty
// onImpact, so every projectile tower was firing blanks. buildProjectileHooks
// restores the real impact-damage path.
// ─────────────────────────────────────────────────────────────────────

import { GRID, ECONOMY } from '../constants';
import type { GameStateShape } from '../GameState';
import { DamageType, GamePhase, type Enemy, type Tower } from '../types';
import type { RenderEngine } from '../render/RenderEngine';
import {
  type GoreState,
  emitHitSplatter, emitHitSpark, emitTypedImpact, emitStatusImpact,
  emitFloatingNumber, emitDeathSplatter,
} from '../systems/GoreSystem';
import { type CombatHooks, applyDamageAndStatus, hasCleave } from '../systems/CombatResolver';
import { realizableCombos } from '../systems/CombinationEngine';
import { SFX, setFactionBGM, playMusicTrack, sfx } from '../render/AudioManager';
import wavesData from '../data/waves.json';

// The Legion runtime supplies these to keep its own bookkeeping (gold per
// kill is owned by RomanBoard; onHit/onKill forward to the team scoreboard).
export interface LegionForward {
  onKill?: (tower: Tower, enemy: Enemy) => void;
  onHit?: (tower: Tower, enemy: Enemy, damage: number) => void;
}

// ── melee slash tint (mirror of main.ts:77 meleeSlashTintFor) ───────────
function meleeSlashTintFor(towerType: string): number | undefined {
  switch (towerType) {
    case 'HERO_CAESAR':
    case 'JULIUS_CAESAR':
    case 'PONTIFEX_MAXIMUS':
      return 0xffd34d;                 // divine gold
    case 'CONSULAR_FATEBINDER':
      return 0xc89cff;                 // apex divine-purple
    case 'GOD_OF_WAR':
      return 0xff7733;                 // hellfire orange-red
    default:
      return undefined;                // PHYS_MELEE default
  }
}

// Muzzle-flash color keyed to damage type (mirror of main.ts COLOR_BY_TYPE).
const MUZZLE_COLOR_BY_TYPE: Record<number, number> = {
  0: 0xffe6a8, 1: 0xffe6a8, 2: 0xb88a4a, 3: 0xff7733, 4: 0xfff4a8, 5: 0xffffff,
};

const COMBO_MELEE_SFX: Record<string, () => void> = {
  HORSEMAN: SFX.comboHorseman,
  COHORT_GUARD: SFX.comboCohortGuard,
  PRAETORIAN_WALL: SFX.comboPraetorianWall,
};
const HEAVY_MELEE = new Set(['CENTURION', 'PRIMUS_PILUS', 'IMPERATOR_GUARD', 'CATAPHRACT', 'EVOCATUS']);
const SPEAR_MELEE = new Set(['HASTATI', 'TRIARIUS']);
const HEAVY_SLASH = new Set(['PRIMUS_PILUS', 'TRIARIUS', 'CENTURION', 'COHORT_GUARD', 'PRAETORIAN_WALL', 'IMPERATOR_GUARD', 'EVOCATUS', 'CATAPHRACT', 'HORSEMAN']);

const COMBO_FIRE_SFX: Record<string, () => void> = {
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
  GOD_OF_WAR: SFX.comboGodOfWar,
};
const HEAVY_RANGED = new Set(['SCORPIO', 'BALLISTARIUS', 'ARCUBALLISTA', 'CARROBALLISTA', 'SIEGE_ONAGER', 'VULCAN_ENGINEER', 'COLOSSUS_ONAGER']);
const HERO_MUZZLE_TINT: Record<string, number> = {
  HERO_AGRIPPA: 0xb88a4a, HERO_AGRICOLA: 0xaaccff, HERO_SCIPIO: 0xffe6a8, HERO_SULLA: 0xff7733,
};

// ─────────────────────────────────────────────────────────────────────
// COMBAT HOOKS — onHit / onMeleeSwing / onProjectileFire / onKill.
// Faithful mirror of main.ts:6373-6644 (VFX + SFX), with gold/score kept
// by RomanBoard (forwarded through LegionForward).
// ─────────────────────────────────────────────────────────────────────
export function buildCombatHooks(
  renderer: RenderEngine,
  state: GameStateShape,
  gore: GoreState,
  legion: LegionForward,
): CombatHooks {
  return {
    onHit: (t: any, e: any, d: number, _resMod = 1, isCrit = false) => {
      const hasBleed = e.statusEffects?.some((s: any) => s.kind === 'BLEED');
      if (hasBleed) emitHitSplatter(gore, e.x, e.y, false);
      emitHitSpark(gore, e.x, e.y);
      if (t) emitTypedImpact(gore, e.x, e.y, t.damageType);
      for (const s of e.statusEffects ?? []) {
        if (s.remaining > 0.95 * 6) emitStatusImpact(gore, e.x, e.y, s.kind);
      }
      const wasCrit = isCrit || !!(t && (t as any).__lastWasCrit);
      const weatherMissed = (e as any).__weatherMissTick === state.tick && d === 0;
      if (weatherMissed) {
        emitFloatingNumber(gore, e.x, e.y - 4, 0, 0xaaaaaa);
        const last = gore.numbers[gore.numbers.length - 1];
        if (last) { last.text = 'MISS!'; last.life = 0.7; last.vy = -40; }
      } else if (wasCrit) {
        const cx = t ? t.tileX * GRID.TILE + GRID.TILE / 2 : e.x;
        const cy = t ? t.tileY * GRID.TILE - 4 : e.y;
        emitFloatingNumber(gore, cx, cy, d, 0xffd34d, true);
        renderer.triggerShake(2.5, 0.12);
      }
      if (t) {
        t.totalDamageDealt += d;
        t.damageThisWave += d;
        if (e.isBoss) t.bossDamageDealt += d;
      }
      legion.onHit?.(t, e, d);
    },

    onMeleeSwing: (t: any, e: any, d: number) => {
      const hasBleed = e.statusEffects?.some((s: any) => s.kind === 'BLEED');
      if (hasBleed) emitHitSplatter(gore, e.x, e.y, false);
      if (t && COMBO_MELEE_SFX[t.type]) COMBO_MELEE_SFX[t.type]();
      else if (t && HEAVY_MELEE.has(t.type)) SFX.meleeSwordHeavy();
      else if (t && SPEAR_MELEE.has(t.type)) SFX.meleeSpear();
      else SFX.meleeSwordLight();
      if (t) {
        const sx = t.tileX * GRID.TILE + GRID.TILE / 2;
        const sy = t.tileY * GRID.TILE + GRID.TILE / 2;
        const angle = Math.atan2(e.y - sy, e.x - sx);
        const isHero = !!t.isHero;
        const size = isHero ? 2.2 : (HEAVY_SLASH.has(t.type) ? 1.5 : 1.0);
        const cleaver = hasCleave(t);
        const slashTint = meleeSlashTintFor(t.type);
        renderer.triggerMeleeSlash(e.x, e.y, angle, state.tick, size, cleaver, slashTint);
        if (isHero) {
          renderer.triggerMeleeSlash(e.x, e.y, angle + 0.5, state.tick, size * 0.75, false, slashTint);
          renderer.triggerShake(3, 0.18);
          renderer.triggerImpactRing(e.x, e.y, state.tick, GRID.TILE * 0.9, slashTint ?? 0xfff5cc);
        }
        if (t.type === 'TRIPLEX_ACIES') {
          renderer.triggerMeleeSlash(e.x, e.y, angle - 0.4, state.tick, size * 1.1, true, 0xe8d6a8);
          renderer.triggerMeleeSlash(e.x, e.y, angle + 0.4, state.tick, size * 1.1, true, 0xe8d6a8);
          renderer.triggerShake(2.5, 0.16);
          renderer.triggerImpactRing(e.x, e.y, state.tick, GRID.TILE * 0.8, 0xfff5cc);
        } else if (t.type === 'CONSULAR_FATEBINDER') {
          renderer.triggerMeleeSlash(e.x, e.y, angle + 0.6, state.tick, size * 1.0, true, 0xc89cff);
          renderer.triggerShake(5, 0.28);
          renderer.triggerImpactRing(e.x, e.y, state.tick, GRID.TILE * 1.3, 0xffd34d);
          renderer.triggerImpactRing(e.x, e.y, state.tick, GRID.TILE * 0.7, 0xc89cff);
        }
        if (e.isBoss && HEAVY_SLASH.has(t.type)) renderer.triggerShake(2, 0.12);
      }
      legion.onHit?.(t, e, d);
    },

    onProjectileFire: (t: any, target: any, _d: number) => {
      if (t && COMBO_FIRE_SFX[t.type]) COMBO_FIRE_SFX[t.type]();
      else if (t?.type === 'SCORPIO') SFX.ballista();
      else if (t?.type === 'IGNIFER' || t?.type === 'VULCAN_ENGINEER') SFX.fireWhoosh();
      else if (t?.type === 'BALLISTARIUS' || t?.type === 'CARROBALLISTA' || t?.type === 'COLOSSUS_ONAGER') SFX.crossbow();
      else if (t?.type === 'ARCUBALLISTA') SFX.bowstring();
      else if (t?.type === 'LEGATE' || t?.type === 'FLAMEN' || t?.type === 'AUGUR' || t?.type === 'HARUSPEX' || t?.type === 'SOLAR_PRIEST' || t?.type === 'PRAEFECTUS') SFX.staffCast();
      else if (t?.type === 'DECURION' || t?.type === 'CLIBANARIUS' || t?.type === 'SPECULATOR' || t?.type === 'FUNDIBULUS') SFX.javelinThrow();
      else SFX.bowstring();
      if (t && target) {
        const sx = t.tileX * GRID.TILE + GRID.TILE / 2;
        const sy = t.tileY * GRID.TILE + GRID.TILE / 2;
        const ang = Math.atan2(target.y - sy, target.x - sx);
        const tipX = sx + Math.cos(ang) * 14;
        const tipY = sy + Math.sin(ang) * 14;
        const c = MUZZLE_COLOR_BY_TYPE[t.damageType] ?? 0xffffff;
        renderer.triggerMuzzleFlash(tipX, tipY, c, state.tick);
        if (HEAVY_RANGED.has(t.type)) renderer.triggerImpactRing(sx, sy, state.tick, 16, 0xddaa55);
        if (t.isHero) {
          const heroC = HERO_MUZZLE_TINT[t.type] ?? c;
          renderer.triggerMuzzleFlash(tipX, tipY, heroC, state.tick);
          renderer.triggerImpactRing(sx, sy, state.tick, 22, heroC);
          renderer.triggerShake(2, 0.10);
        }
        if (t.type === 'LEGION_PRIME') {
          renderer.triggerMuzzleFlash(tipX, tipY, 0xffd34d, state.tick);
          renderer.triggerMuzzleFlash(tipX, tipY, 0xfff5cc, state.tick);
          renderer.triggerImpactRing(sx, sy, state.tick, 28, 0xddaa55);
          renderer.triggerImpactRing(sx, sy, state.tick, 18, 0xffd34d);
          renderer.triggerShake(4, 0.20);
        } else if (t.type === 'IMPERIUM_ETERNUM') {
          renderer.triggerMuzzleFlash(tipX, tipY, 0xffd34d, state.tick);
          renderer.triggerMuzzleFlash(tipX, tipY, 0xc89cff, state.tick);
          renderer.triggerMuzzleFlash(tipX, tipY, 0xffffff, state.tick);
          renderer.triggerImpactRing(sx, sy, state.tick, 32, 0xffd34d);
          renderer.triggerImpactRing(sx, sy, state.tick, 20, 0xc89cff);
          renderer.triggerShake(3.5, 0.22);
        } else if (t.type === 'CARTHAGE_SCOURGE') {
          renderer.triggerMuzzleFlash(tipX, tipY, 0xcc3322, state.tick);
          renderer.triggerMuzzleFlash(tipX, tipY, 0xff7733, state.tick);
          renderer.triggerImpactRing(sx, sy, state.tick, 18, 0xcc3322);
          renderer.triggerShake(1.8, 0.08);
        }
      }
    },

    // Gold/score are owned by RomanBoard's economy; death FX/SFX fire in
    // emitBoardDeathFx at the universal removal point. Here we only mint
    // the baseline kill gold (matching RomanBoard's prior behavior) and
    // forward to the Legion scoreboard.
    onKill: (t: any, e: any) => {
      state.gold += (e.reward ?? 0) + ECONOMY.BASE_GOLD_PER_KILL;
      state.totalKills += 1;
      state.enemiesKilledThisWave += 1;
      legion.onKill?.(t, e);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// PROJECTILE IMPACT — mirror of main.ts:6982-7049. CRUCIAL: this is where
// projectile damage is actually applied (applyDamageAndStatus), so wiring
// it makes Legion ranged/caster/siege towers deal damage again. Also draws
// splash + divine impact rings and the missed-shot dust puff.
// ─────────────────────────────────────────────────────────────────────
export function buildProjectileHooks(
  renderer: RenderEngine,
  state: GameStateShape,
  gore: GoreState,
  combatHooks: CombatHooks,
) {
  return {
    onImpact: (p: any, target: Enemy | null, hx: number, hy: number) => {
      if (p.cosmetic) return;
      if (target && target.hp > 0) {
        const tw = state.towers.get(p.sourceTowerId);
        if (tw) applyDamageAndStatus(state, tw, target, p.damage, combatHooks);
        if (p.splash > 0) {
          const r = p.splash * GRID.TILE;
          for (const other of state.enemies.values()) {
            if (other.id === target.id) continue;
            if (Math.hypot(other.x - hx, other.y - hy) <= r) {
              if (tw) applyDamageAndStatus(state, tw, other, p.damage * 0.6, combatHooks);
            }
          }
          const ringColor = p.spriteKey === 'PROJ_BARREL' ? 0xff8a22
            : p.spriteKey === 'PROJ_BALLISTA' ? 0xb88a4a
            : p.spriteKey === 'PROJ_POISON_CLOUD' ? 0x66dd44
            : 0xeed8a0;
          renderer.triggerImpactRing(hx, hy, state.tick, r * 0.9, ringColor);
        }
        if (p.damageType === DamageType.DIVINE) {
          renderer.triggerImpactRing(hx, hy, state.tick, 22, 0xffe066);
          renderer.triggerImpactRing(hx, hy, state.tick + 0.05, 36, 0xfff4a8);
        }
      } else {
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 25 + Math.random() * 35;
          gore.particles.push({
            x: hx, y: hy,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
            life: 0.35 + Math.random() * 0.25,
            size: 1.5 + Math.random() * 1,
            color: 0xa67a4a,
          });
        }
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// DEATH FX/SFX — fires once per enemy death at the universal removal point
// (tickEnemies onDeath). Covers both tower kills AND DoT/burn kills, so it
// is cleaner than base (which only splattered on tower kills). Mirrors the
// death-splatter + kill-pop ring + per-archetype death SFX from main.ts.
// ─────────────────────────────────────────────────────────────────────
export function emitBoardDeathFx(
  renderer: RenderEngine,
  state: GameStateShape,
  gore: GoreState,
  e: any,
): void {
  emitDeathSplatter(gore, e, state.tick);
  // KILL-POP ring: bosses get a bigger gold double-ring; mobs a white pop.
  if (e.isBoss) {
    renderer.triggerImpactRing(e.x, e.y, state.tick, 48, 0xffd34d);
    renderer.triggerImpactRing(e.x, e.y, state.tick + 0.06, 80, 0xffe88c);
  } else {
    renderer.triggerImpactRing(e.x, e.y, state.tick, 22, 0xffffff);
  }
  // Per-archetype death SFX (throttled coin bling for basic ground mobs).
  if (e.isFlyer) SFX.flyerKilled();
  if (e.isBoss) {
    SFX.bossDeath();
    SFX.bossKilled();
    renderer.triggerShake(3, 0.4);
    const isScheduledBoss = (wavesData as any)[state.wave - 1]?.type === 'B' && !e.isBonusBoss;
    renderer.triggerBloodRain(state.tick, isScheduledBoss ? 32 : 18, isScheduledBoss ? 1.15 : 0.9);
  } else if (!e.isFlyer && !(e as any).__reanimated) {
    const lastCoin = (state as any).__lastCoinSfxTick ?? -999;
    if (state.tick - lastCoin >= 0.09) {
      (state as any).__lastCoinSfxTick = state.tick;
      SFX.coin3();
    }
  } else {
    SFX.enemyDeath();
  }
}

// ─────────────────────────────────────────────────────────────────────
// FRAME RENDER — the full ordered draw sequence base runs every frame
// (main.ts:7375-7459), minus the DOM/HUD updates (handled by the sidebar).
// Reads state.tick internally. Call last in the board tick, before
// renderer.app.render().
// ─────────────────────────────────────────────────────────────────────
export function drawBoardFrame(
  renderer: RenderEngine,
  state: GameStateShape,
  gore: GoreState,
  dt: number,
): void {
  const tick = state.tick;
  renderer.drawDynamic(state);
  renderer.setTileRef(state.tiles);
  const isBossWave = (wavesData as any)[state.wave - 1]?.type === 'B';
  renderer.drawAmbient(tick, state.wave, isBossWave);
  renderer.drawImpactOverlays(tick);
  renderer.applyShake(dt, tick);
  renderer.drawGore(gore, tick);
  renderer.drawAuraTiles(state, tick);
  renderer.drawComboFx(state, tick);
  renderer.drawCheckpointHealFx(state, tick);
  renderer.drawReanimationFx(state, tick);
  renderer.drawChainLightningFx(state, tick);
  renderer.drawProjectiles(state);
  renderer.drawDruidSleepDarts(state);
  renderer.drawElephantAura(state);
  renderer.drawMeleeSlashes(tick);
  renderer.drawHeroAbilityFx(tick);
  renderer.drawBossBar(state);
  renderer.drawBossLowHpAura(state);
  renderer.drawBossVignette(state, dt);
  renderer.tickBloodRain(dt);
  renderer.drawSelectedRange(state);
  renderer.drawBurnPatches(state, tick);
  renderer.drawSurpriseEvents(state, tick);
  renderer.drawWeather(state, tick);
  renderer.drawAuras(state, tick);
  renderer.drawTierPips(state);
  renderer.drawLootOrbs(state, tick);
  renderer.emitBloodDripsForWounded(state, gore, tick);
  // Pulsing combo glow on ingredient towers during the build phases.
  const showGlow = state.phase === GamePhase.BUILD_PHASE
    || state.phase === GamePhase.PROSPECT_PLACEMENT
    || state.phase === GamePhase.PICK_KEEPER;
  if (showGlow) {
    const combos = realizableCombos(state).filter((cb) => !cb.ingredients.some((t: any) => t.pending));
    const ids = new Set<string>();
    for (const cb of combos) for (const ing of cb.ingredients) ids.add(ing.id);
    renderer.drawComboGlow(ids, state, tick);
  } else {
    renderer.drawComboGlow(new Set(), state, tick);
  }
}

/** Count of combos that can execute right now (for the unlock chime). */
export function realizableComboCount(state: GameStateShape): number {
  const pre = state.phase === GamePhase.BUILD_PHASE
    || state.phase === GamePhase.PROSPECT_PLACEMENT
    || state.phase === GamePhase.PICK_KEEPER;
  if (!pre) return 0;
  return realizableCombos(state).filter((cb) => !cb.ingredients.some((t: any) => t.pending)).length;
}

// ─────────────────────────────────────────────────────────────────────
// WAVE AUDIO — mirror of main.ts:4525-4593 (the non-endless path). Fires
// the wave-start bumper, faction BGM loop, boss-wave sting + boss vignette.
// Called by RomanBoard.march() with the wave it is about to fight.
// ─────────────────────────────────────────────────────────────────────
export function boardWaveAudio(renderer: RenderEngine, faction: string | undefined, isBoss: boolean, wave: number): void {
  SFX.waveStartBlast();
  if (isBoss) setTimeout(() => SFX.bossWaveStart(), 1500);
  if (faction) setFactionBGM(faction);
  renderer.setBossWaveActive(isBoss);
  // W20 finale gets One-Winged Angel on loop, same as the campaign.
  if (wave === 20 && isBoss) {
    playMusicTrack('boss-fate', sfx('assets/sfx/ff7_one_winged_angel.mp3'), { loop: true, gain: 0.7, replace: false });
  }
}

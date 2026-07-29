import { Enemy, EnemyType, EnemyFaction } from '../types';
import { GameStateShape } from '../GameState';
import { spawnEnemy, applyTowerAtkSpeedDebuff } from './EnemySystem';
import wavesData from '../data/waves.json';
import enemiesData from '../data/enemies.json';
import { scaledEnemyRegenRate } from './EnemyHealing';

export const VULTURE_DIVE_PERIOD_SECONDS = 6;
export const VULTURE_DIVE_SLOW_PCT = 0.50;
export const VULTURE_DIVE_DURATION_SECONDS = 5;
export const VULTURE_FIRST_FLOCK_COUNT = 4;
export const VULTURE_FINAL_FLOCK_COUNT = 3;
export const KESHIG_RALLY_HEAL_PCT = 0.12;

interface BossRuntime {
  ambushFired: boolean;        // Undead Warlord ambush
  necromancyFired: boolean;    // Undead Warlord raise dead — first wave at 40% HP
  necromancySecondFired: boolean;  // Undead Warlord raise dead — second wave at 15% HP (2026-05-21 difficulty pass)
  alphaDogFenzy: boolean;      // Alpha Dog speed double below 30% HP
  alphaDogHowlEndsAt: number;  // Alpha Dog pack howl buff
  alphaDogNextHowl: number;    // next howl time
  alphaDogDeathSpawned: boolean;
  warlordCryEndsAt: number;    // Celtic Warlord war cry
  warlordRebirthed: boolean;   // Celtic Warlord one-shot rebirth
  hannibalRebirthed: boolean;  // Hannibal phase 2
  hannibalEnragedEndsAt: number;
  hannibalRebirthTelegraphAt: number;   // 0 = not yet armed; >0 = fire rebirth at this tick
  warElephantStampedeFired: Set<string>;   // per-elephant stampede flag
  // 2026-05-20 — daemonImperatorRebirthed removed. The Daemon's rebirth
  // mechanic was retired per user direction; this flag had no remaining
  // readers. daemonNextHellscape stays — Hellscape still fires every 12s.
  daemonNextHellscape: number;             // tower-stun cycle time
  undeadElephantRebirthed: boolean;
}

export function createBossRuntime(): BossRuntime {
  return {
    ambushFired: false,
    necromancyFired: false,
    necromancySecondFired: false,
    alphaDogFenzy: false,
    alphaDogHowlEndsAt: 0,
    alphaDogNextHowl: 0,
    alphaDogDeathSpawned: false,
    warlordCryEndsAt: 0,
    warlordRebirthed: false,
    hannibalRebirthed: false,
    hannibalEnragedEndsAt: 0,
    hannibalRebirthTelegraphAt: 0,
    warElephantStampedeFired: new Set<string>(),
    daemonNextHellscape: 0,
    undeadElephantRebirthed: false
  };
}

function spawnBossEscort(
  state: GameStateShape,
  boss: Enemy,
  type: EnemyType,
  bossHpFraction: number
): Enemy {
  const escort = spawnEnemy(state, type, 1);
  const escortHp = Math.max(1, Math.round(boss.maxHp * bossHpFraction));
  escort.maxHp = escortHp;
  escort.hp = escortHp;
  escort.x = escort.prevX = boss.x;
  escort.y = escort.prevY = boss.y;
  escort.pathIndex = boss.pathIndex;
  escort.pathProgress = boss.pathProgress;
  return escort;
}

// Tick boss-specific scripts. Called each frame from main loop in WAVE phase.
export function tickBossScripts(state: GameStateShape, dt: number, rt: BossRuntime, waveStartTick: number) {
  for (const e of state.enemies.values()) {
    switch (e.type) {

      // ─── VULTURE IMPERATOR (W20 boss flyer, 2026 v2 spec Ch6) ───────────
      case EnemyType.BOSS_FLYER_VULTURE: {
        // DIVE BOMB — pressures the player's proven carry rather than a
        // random tower. The shorter cadence makes the boss survive long
        // enough for both flock phases without adding another immunity.
        const nextDive = (e as any).__nextDiveBomb ?? (waveStartTick + VULTURE_DIVE_PERIOD_SECONDS);
        if (state.tick >= nextDive) {
          (e as any).__nextDiveBomb = state.tick + VULTURE_DIVE_PERIOD_SECONDS;
          let best: any = null, bestKills = -1;
          for (const tw of state.towers.values()) {
            const kc = (tw as any).killCount ?? 0;
            if (kc > bestKills) { bestKills = kc; best = tw; }
          }
          if (best) applyTowerAtkSpeedDebuff(best, VULTURE_DIVE_SLOW_PCT, VULTURE_DIVE_DURATION_SECONDS, state.tick);
        }
        // FLOCK CALL — two readable air phases. Escorts inherit a bounded
        // fraction of boss HP so they stay relevant without silently picking
        // up every ordinary-wave multiplier.
        if (!(e as any).__flockCalled && e.hp / e.maxHp <= 0.6) {
          (e as any).__flockCalled = true;
          for (let i = 0; i < VULTURE_FIRST_FLOCK_COUNT; i++) {
            spawnBossEscort(state, e, EnemyType.SPHINX, 0.05);
          }
          state.hint = '🦅 FLOCK CALL — four Sphinx escorts descend around the Imperator!';
        }
        if (!(e as any).__finalFlockCalled && e.hp / e.maxHp <= 0.25) {
          (e as any).__finalFlockCalled = true;
          for (let i = 0; i < VULTURE_FINAL_FLOCK_COUNT; i++) {
            spawnBossEscort(state, e, EnemyType.SPHINX, 0.05);
          }
          state.hint = '🦅 LAST MURDER — the Vulture calls its final three Sphinx!';
        }
        break;
      }

      // ─── KESHIG NOYAN (W21 Mongol boss) ────────────────────────────────
      case EnemyType.KHAN_RIDER: {
        // FEIGNED RETREAT — at 60%, shed hard control, recover 12% max HP,
        // and reform with a mixed cavalry guard. The recovery is visible and
        // finite, unlike passive regeneration.
        if (!(e as any).__noyanRallied && e.hp / e.maxHp <= 0.6) {
          (e as any).__noyanRallied = true;
          e.statusEffects = e.statusEffects.filter(status =>
            status.kind !== 'SLOW' &&
            status.kind !== 'FREEZE' &&
            status.kind !== 'STUN' &&
            status.kind !== 'KNOCKBACK'
          );
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * KESHIG_RALLY_HEAL_PCT);
          for (let i = 0; i < 3; i++) spawnBossEscort(state, e, EnemyType.MONGOL_HORSE_ARCHER, 0.035);
          for (let i = 0; i < 2; i++) spawnBossEscort(state, e, EnemyType.MONGOL_SPEAR_RIDER, 0.035);
          state.hint = '⚔ FEIGNED RETREAT — Keshig Noyan reforms with five cavalry guards!';
        }
        // LAST RIDE — the authored low-HP speed boost supplies the charge;
        // this phase clears control once and adds a compact spear escort.
        if (!(e as any).__noyanLastRide && e.hp / e.maxHp <= 0.25) {
          (e as any).__noyanLastRide = true;
          e.statusEffects = e.statusEffects.filter(status =>
            status.kind !== 'SLOW' &&
            status.kind !== 'FREEZE' &&
            status.kind !== 'STUN' &&
            status.kind !== 'KNOCKBACK'
          );
          for (let i = 0; i < 3; i++) spawnBossEscort(state, e, EnemyType.MONGOL_SPEAR_RIDER, 0.035);
          state.hint = '⚔ LAST RIDE — Keshig Noyan and three lancers charge Rome!';
        }
        break;
      }

      // ─── ROMAN-MYTH ELITES (W25-29, 2026 v2 spec Ch10-11) ───────────────
      // Abilities reuse the shared primitives: Fire Breath / Ground Slam =
      // timed atk-speed debuff (applyTowerAtkSpeedDebuff); Eye Blast /
      // Serpent Storm = tower silence (silencedUntil + attackCooldown, the
      // Tusk-Quake pattern); Triple Howl = a one-time pack speed surge.
      case EnemyType.CHIMERA: {
        // FIRE BREATH — every 3s: towers within ~2 tiles lose 30% atk speed for 2s.
        const next = (e as any).__nextFireBreath ?? (state.tick + 3);
        if (state.tick >= next) {
          (e as any).__nextFireBreath = state.tick + 3;
          const r = 32 * 2.2;
          for (const tw of state.towers.values()) {
            if (tw.pending) continue;
            if (Math.hypot(tw.tileX * 32 + 16 - e.x, tw.tileY * 32 + 16 - e.y) <= r)
              applyTowerAtkSpeedDebuff(tw, 0.30, 2, state.tick);
          }
        }
        break;
      }
      case EnemyType.GIANT_GIGAS: {
        // SUPER-GIANT MERGE (W28, 2026 v2 spec Ch12) — two Giants within 1.5
        // tiles past Checkpoint 2 fuse into a Colossus Gigas after a 1.5s
        // cancellable wind-up. The lower-id Giant drives the fusion. The
        // merged Giants are REMOVED (not killed) so the fusion yields no
        // gold / loot / kill-credit — only the Colossus does, on its death.
        if (e.pathIndex >= 2 && !(e as any).__mergedAway) {
          const windUntil = (e as any).__mergeWindupUntil ?? 0;
          if (windUntil > 0) {
            const partner = state.enemies.get((e as any).__mergePartner);
            const ok = partner && partner.hp > 0 && partner.type === EnemyType.GIANT_GIGAS
                       && !(partner as any).__mergedAway
                       && Math.hypot(partner.x - e.x, partner.y - e.y) <= 32 * 2.0;
            if (!ok) {
              (e as any).__mergeWindupUntil = 0; (e as any).__mergePartner = undefined; (e as any).__glowScale = 1;
            } else if (state.tick >= windUntil && e.id < partner!.id) {
              const cx = (e.x + partner!.x) / 2, cy = (e.y + partner!.y) / 2;
              const colossus = spawnEnemy(state, EnemyType.SUPER_GIANT_COLOSSUS, 1);
              const sumHp = (e.hp + partner!.hp) * 1.3;
              colossus.maxHp = sumHp; colossus.hp = sumHp;
              colossus.x = colossus.prevX = cx; colossus.y = colossus.prevY = cy;
              colossus.pathIndex = Math.max(e.pathIndex, partner!.pathIndex);
              colossus.pathProgress = e.pathProgress ?? 0;
              (e as any).__mergedAway = true; (partner as any).__mergedAway = true;
              state.enemies.delete(e.id); state.enemies.delete(partner!.id);
              const renderer = (window as any).__renderer;
              renderer?.triggerImpactRing?.(cx, cy, state.tick, 32 * 3, 0xE87020);
              renderer?.triggerShake?.(6, 0.4);
              state.hint = '🗿 THE GIANTS FUSE — COLOSSUS GIGAS RISES!';
              break;
            }
          } else {
            for (const o of state.enemies.values()) {
              if (o.id === e.id || o.type !== EnemyType.GIANT_GIGAS) continue;
              if (((o as any).__mergeWindupUntil ?? 0) > 0 || (o as any).__mergedAway) continue;
              if (o.pathIndex >= 2 && Math.hypot(o.x - e.x, o.y - e.y) <= 32 * 1.5) {
                const until = state.tick + 1.5;
                (e as any).__mergeWindupUntil = until; (e as any).__mergePartner = o.id; (e as any).__glowScale = 1.6;
                (o as any).__mergeWindupUntil = until; (o as any).__mergePartner = e.id; (o as any).__glowScale = 1.6;
                state.hint = '🗿 TWO GIANTS CONVERGE — they begin to merge!';
                break;
              }
            }
          }
        }
        // GROUND SLAM — every 5s: towers within ~2.5 tiles lose 35% atk speed for 2.5s.
        const next = (e as any).__nextGroundSlam ?? (state.tick + 5);
        if (state.tick >= next) {
          (e as any).__nextGroundSlam = state.tick + 5;
          const r = 32 * 2.5;
          let hit = 0;
          for (const tw of state.towers.values()) {
            if (tw.pending) continue;
            if (Math.hypot(tw.tileX * 32 + 16 - e.x, tw.tileY * 32 + 16 - e.y) <= r) {
              applyTowerAtkSpeedDebuff(tw, 0.35, 2.5, state.tick); hit++;
            }
          }
          if (hit > 0) {
            const renderer = (window as any).__renderer;
            renderer?.triggerImpactRing?.(e.x, e.y, state.tick, r, 0xE87020);
            renderer?.triggerShake?.(2, 0.15);
          }
        }
        break;
      }
      // ─── COLOSSUS GIGAS (W28 merged Super-Giant, 2026 v2 spec Ch12) ──────
      case EnemyType.SUPER_GIANT_COLOSSUS: {
        // TITAN STOMP — a heavier Ground Slam: every 4s, towers within ~3.5
        // tiles lose 45% atk speed for 3s. (Colossal Regen is data-driven via
        // regenPctPerSec in enemies.json.)
        const nextStomp = (e as any).__nextTitanStomp ?? (state.tick + 4);
        if (state.tick >= nextStomp) {
          (e as any).__nextTitanStomp = state.tick + 4;
          const r = 32 * 3.5;
          let hit = 0;
          for (const tw of state.towers.values()) {
            if (tw.pending) continue;
            if (Math.hypot(tw.tileX * 32 + 16 - e.x, tw.tileY * 32 + 16 - e.y) <= r) {
              applyTowerAtkSpeedDebuff(tw, 0.45, 3, state.tick); hit++;
            }
          }
          if (hit > 0) {
            const renderer = (window as any).__renderer;
            renderer?.triggerImpactRing?.(e.x, e.y, state.tick, r, 0xE87020);
            renderer?.triggerShake?.(5, 0.3);
            state.hint = `🗿 TITAN STOMP — ${hit} tower${hit === 1 ? '' : 's'} staggered!`;
          }
        }
        break;
      }
      case EnemyType.CYCLOPS: {
        // EYE BLAST — every 6s: fully silence the single nearest tower for 2s.
        const next = (e as any).__nextEyeBlast ?? (state.tick + 6);
        if (state.tick >= next) {
          (e as any).__nextEyeBlast = state.tick + 6;
          let best: any = null, bestD = Infinity;
          for (const tw of state.towers.values()) {
            if (tw.pending) continue;
            const d = Math.hypot(tw.tileX * 32 + 16 - e.x, tw.tileY * 32 + 16 - e.y);
            if (d < bestD) { bestD = d; best = tw; }
          }
          if (best) {
            best.silencedUntil = Math.max(best.silencedUntil ?? 0, state.tick + 2);
            best.attackCooldown = Math.max(best.attackCooldown, 2);
            const renderer = (window as any).__renderer;
            renderer?.triggerImpactRing?.(best.tileX * 32 + 16, best.tileY * 32 + 16, state.tick, 24, 0xE87020);
            state.hint = '👁 EYE BLAST — a tower is struck blind!';
          }
        }
        break;
      }
      case EnemyType.TYPHON: {
        // SERPENT STORM — every 5s: silence every tower within ~3 tiles for 1.5s.
        const next = (e as any).__nextSerpentStorm ?? (state.tick + 5);
        if (state.tick >= next) {
          (e as any).__nextSerpentStorm = state.tick + 5;
          const r = 32 * 3;
          let silenced = 0;
          for (const tw of state.towers.values()) {
            if (tw.pending) continue;
            if (Math.hypot(tw.tileX * 32 + 16 - e.x, tw.tileY * 32 + 16 - e.y) <= r) {
              tw.silencedUntil = Math.max(tw.silencedUntil ?? 0, state.tick + 1.5);
              tw.attackCooldown = Math.max(tw.attackCooldown, 1.5); silenced++;
            }
          }
          if (silenced > 0) {
            const renderer = (window as any).__renderer;
            renderer?.triggerImpactRing?.(e.x, e.y, state.tick, r, 0x6a5acd);
            renderer?.triggerShake?.(3, 0.2);
            state.hint = `🐍 SERPENT STORM — ${silenced} tower${silenced === 1 ? '' : 's'} silenced!`;
          }
        }
        break;
      }
      case EnemyType.CERBERUS: {
        // TRIPLE HOWL — every 7s: one-time +25% speed surge to nearby myth
        // allies that haven't been howled yet (flag-gated, no compounding).
        const next = (e as any).__nextTripleHowl ?? (state.tick + 7);
        if (state.tick >= next) {
          (e as any).__nextTripleHowl = state.tick + 7;
          let buffed = 0;
          for (const ally of state.enemies.values()) {
            if (ally.faction !== e.faction || (ally as any).__cerberusHowled) continue;
            if (Math.hypot(ally.x - e.x, ally.y - e.y) <= 32 * 3) {
              (ally as any).__cerberusHowled = true;
              ally.baseSpeed *= 1.25; ally.currentSpeed *= 1.25; buffed++;
            }
          }
          if (buffed > 0) state.hint = '🐺 TRIPLE HOWL — the myth horde surges forward!';
        }
        break;
      }

      // ─── PLAGUE BEARER (Egyptian, 2026 v2 spec Ch14) ────────────────────
      // The continuous plague aura is data-driven (auraTowerSlow). On top of
      // it, once at <=20% HP the bearer's cracked urn shatters: a PLAGUE
      // BURST saps every tower within ~2.5 tiles by 40% atk speed for 5s —
      // the on-death plague-zone, delivered via the shared debuff framework.
      case EnemyType.PLAGUE_BEARER: {
        if (!(e as any).__plagueBurst && e.hp / e.maxHp <= 0.2) {
          (e as any).__plagueBurst = true;
          const r = 32 * 2.5;
          let hit = 0;
          for (const tw of state.towers.values()) {
            if (tw.pending) continue;
            if (Math.hypot(tw.tileX * 32 + 16 - e.x, tw.tileY * 32 + 16 - e.y) <= r) {
              applyTowerAtkSpeedDebuff(tw, 0.40, 5, state.tick); hit++;
            }
          }
          const renderer = (window as any).__renderer;
          renderer?.triggerImpactRing?.(e.x, e.y, state.tick, r, 0x6fae3a);
          if (hit > 0) state.hint = `☠ PLAGUE BURST — ${hit} tower${hit === 1 ? '' : 's'} sickened!`;
        }
        break;
      }

      // ─── ALPHA DOG (W5) ──────────────────────────────────────────────────
      // Frenzy at <30% HP (existing) + Pack Howl every 8s buffing nearby Feral Dogs.
      case EnemyType.ALPHA_DOG:
        if (!rt.alphaDogFenzy && e.hp / e.maxHp < 0.3) {
          rt.alphaDogFenzy = true;
          e.baseSpeed *= 2;
          e.currentSpeed *= 2;
        }
        if (state.tick >= rt.alphaDogNextHowl) {
          rt.alphaDogNextHowl = state.tick + 8;
          rt.alphaDogHowlEndsAt = state.tick + 3;
          for (const ally of state.enemies.values()) {
            if (ally.type === EnemyType.FERAL_DOG && Math.hypot(ally.x - e.x, ally.y - e.y) < 5 * 32) {
              ally.baseSpeed *= 1.5;
              ally.currentSpeed *= 1.5;
              (ally as any).__howlBuffed = true;
            }
          }
          state.hint = '🐺 ALPHA DOG HOWLS — pack speeds up!';
        }
        break;

      // ─── BRENNUS (W5 — Celtic chieftain who sacked Rome) ──────────────
      // 2026-05-17 — Low-HP rebirth surge REMOVED per design feedback.
      // The W5 boss is now a clean intro encounter: one war-cry buff
      // when he drops below 70% HP (Celts gain +30% speed for 8s), then
      // a straightforward fight to the death. No phoenix, no enrage
      // window, no status-clear on rebirth. The lore name swap (Celtic
      // Warlord → Brennus) gives him a clear identity as the historical
      // chieftain who sacked Rome in 387 BC.
      case EnemyType.CELTIC_WARLORD:
        if (e.hp / e.maxHp < 0.7 && rt.warlordCryEndsAt === 0) {
          rt.warlordCryEndsAt = state.tick + 8;
          for (const en of state.enemies.values()) {
            if (en.faction === EnemyFaction.CELTS) {
              en.baseSpeed *= 1.3;
              en.currentSpeed *= 1.3;
            }
          }
          state.hint = '⚔ BRENNUS WAR CRY — Celts gain +30% speed';
        }
        break;

      // ─── WAR ELEPHANT (mid-wave) ─────────────────────────────────────────
      // STAMPEDE: at <50% HP, become immune to slow/freeze/stun for 4s and surge ahead.
      // TUSK QUAKE (2026-05 v6): every 6s, every tower within 2 tiles is
      // silenced for 0.6s. Tower silence inherits the same flicker visual
      // as Ghost Rider drive-bys. The elephants now apply real pressure
      // without needing more HP — the player must build out of the
      // quake radius OR eat the silence and let the elephant push on.
      // PASSIVE: auraTowerSlow:0.2 on data side slows nearby towers
      // continuously by another 20% atk speed; immuneSlow/Freeze make
      // CC towers useless against them.
      case EnemyType.WAR_ELEPHANT:
      case EnemyType.UNDEAD_WAR_ELEPHANT: {
        if (!rt.warElephantStampedeFired.has(e.id) && e.hp / e.maxHp < 0.5) {
          rt.warElephantStampedeFired.add(e.id);
          (e as any).__stampedeEndsAt = state.tick + 4;
          e.baseSpeed *= 1.75;
          e.currentSpeed *= 1.75;
          // strip any disabling statuses immediately
          e.statusEffects = e.statusEffects.filter(s =>
            s.kind !== 'SLOW' && s.kind !== 'FREEZE' && s.kind !== 'STUN' && s.kind !== 'KNOCKBACK'
          );
          state.hint = '🐘 ELEPHANT STAMPEDE — status-immune, +75% speed!';
        }
        if ((e as any).__stampedeEndsAt && state.tick >= (e as any).__stampedeEndsAt) {
          e.baseSpeed /= 1.75;
          e.currentSpeed /= 1.75;
          (e as any).__stampedeEndsAt = 0;
        }
        // TUSK QUAKE pulse — every 6s, silence towers in a 2-tile radius
        // for 0.6s. First fire delayed 4s after spawn so the elephant
        // gets within tower range before the first quake.
        const nextQuake = (e as any).__nextTuskQuake ?? (state.tick + 4);
        if (state.tick >= nextQuake) {
          (e as any).__nextTuskQuake = state.tick + 6;
          const r = 32 * 2;       // 2 tiles in pixels
          let silenced = 0;
          for (const tw of state.towers.values()) {
            if (tw.pending) continue;
            const tx = tw.tileX * 32 + 16;
            const ty = tw.tileY * 32 + 16;
            if (Math.hypot(tx - e.x, ty - e.y) <= r) {
              tw.silencedUntil = Math.max(tw.silencedUntil ?? 0, state.tick + 0.6);
              tw.attackCooldown = Math.max(tw.attackCooldown, 0.6);
              silenced++;
            }
          }
          if (silenced > 0) {
            const renderer = (window as any).__renderer;
            if (renderer?.triggerImpactRing) {
              renderer.triggerImpactRing(e.x, e.y, state.tick, r, 0xa67a4a);
            }
            renderer?.triggerShake?.(2, 0.15);
            state.hint = `🐘 TUSK QUAKE — ${silenced} tower${silenced === 1 ? '' : 's'} silenced.`;
          }
        }
        // Undead War Elephant gets a ONE-SHOT REBIRTH at 40% HP — kept
        // inside the elephant case so the rebirth fires for both species.
        if (e.type === EnemyType.UNDEAD_WAR_ELEPHANT && !rt.undeadElephantRebirthed && e.hp <= e.maxHp * 0.40 && !e.hasRebirthed) {
          rt.undeadElephantRebirthed = true;
          e.hasRebirthed = true;
          e.hp = e.maxHp * 0.55;
          e.statusEffects = [];
          // Summon 2 Ghost Riders at his position
          const w = wavesData[state.wave - 1];
          for (let i = 0; i < 2; i++) {
            const ghost = spawnEnemy(state, EnemyType.GHOST_RIDER, w.hpMult * 0.5);
            ghost.x = e.x; ghost.y = e.y;
            ghost.pathIndex = Math.max(0, e.pathIndex - 1);
            ghost.pathProgress = 0;
          }
          state.hint = '💀 UNDEAD ELEPHANT RISES! Spawned 2 Ghost Riders!';
        }
        break;
      }

      // ─── HANNIBAL BARCA (W10) ────────────────────────────────────────────
      // REBIRTH near half HP. Phase 2 is status-immune and faster, but does
      // not create new elephants: the Wave 10 escort is the full elephant
      // budget. Hannibal no longer has passive boss regeneration.
      case EnemyType.HANNIBAL_BARCA: {
        // 2026-05 v6: TELEGRAPHED REBIRTH. When Hannibal first crosses
        // ~55% HP we arm a 1-second telegraph window — the renderer
        // paints a shrinking red ring on him so the player sees the
        // windup and can time burst damage. When the telegraph timer
        // expires, the rebirth fires regardless of current HP (so it
        // can't be soft-locked by a brief heal-back-above-50%).
        if (!rt.hannibalRebirthed && rt.hannibalRebirthTelegraphAt === 0 && e.hp <= e.maxHp * 0.55 && !e.hasRebirthed) {
          rt.hannibalRebirthTelegraphAt = state.tick + 1.0;
        }
        if (rt.hannibalRebirthTelegraphAt > 0 && state.tick < rt.hannibalRebirthTelegraphAt) {
          // Emit a telegraph each tick — the ring lives ~1s so multiple
          // overlapping emits keep it solid and pulsing on Hannibal.
          const renderer = (globalThis as any).__renderer;
          if (renderer?.triggerTelegraphRing) {
            const remaining = rt.hannibalRebirthTelegraphAt - state.tick;
            renderer.triggerTelegraphRing(e.x, e.y, state.tick, remaining, 48, 0xff2222);
          }
          if (!(e as any).__rebirthWarned) {
            (e as any).__rebirthWarned = true;
            state.hint = '⚠ HANNIBAL IS ABOUT TO RETURN — burst him NOW.';
          }
        }
        if (!rt.hannibalRebirthed && rt.hannibalRebirthTelegraphAt > 0 && state.tick >= rt.hannibalRebirthTelegraphAt && !e.hasRebirthed) {
          rt.hannibalRebirthed = true;
          e.hasRebirthed = true;
          e.hp = e.maxHp * 0.65;
          e.statusEffects = [];
          e.baseSpeed *= 1.6;
          e.currentSpeed *= 1.6;
          rt.hannibalEnragedEndsAt = state.tick + 10;
          (e as any).__hannibalEnraged = true;
          state.hint = '⚔ HANNIBAL RETURNS! +60% speed and status immunity!';
        }
        break;
      }

      // ─── UNDEAD WARLORD (W15 boss) ───────────────────────────────────────
      // Ambush 10 berserkers + NECROMANCY at 40% HP: raise 6 Undead Celts +
      // a second NECROMANCY trigger at 15% HP for the final-push panic.
      // 2026-05-21 — Difficulty pass per player feedback ("too easy to
      // kill"). Bumps:
      //   • ambush 8 → 10 berserkers
      //   • necromancy 4 → 6 Undead Celts at 40% HP
      //   • new 2nd necromancy: 5 more Undead Celts at 15% HP
      //   • regen 0.7%/sec → 1.0%/sec (mid-fight pressure)
      //   • baseHp 2020 → 2600 in enemies.json (separate file change)
      // Resistances unchanged — fire/burn still chunk him at 1.25× so
      // committed fire builds remain the clear counter.
      case EnemyType.UNDEAD_WARLORD:
        if (!rt.ambushFired && (state.tick - waveStartTick) > 5) {
          rt.ambushFired = true;
          const path = state.groundPath;
          const mid = path[Math.floor(path.length * 0.5)];
          const w = wavesData[state.wave - 1];
          for (let i = 0; i < 10; i++) {
            const ambusher = spawnEnemy(state, EnemyType.UNDEAD_BERSERKER, w.hpMult);
            ambusher.x = mid.col * 32 + 16;
            ambusher.y = mid.row * 32 + 16;
            ambusher.pathIndex = Math.floor(path.length * 0.5);
            ambusher.pathProgress = 0;
          }
          state.hint = '💀 AMBUSH! 10 Undead Berserkers rise mid-path!';
        }
        if (!rt.necromancyFired && e.hp <= e.maxHp * 0.40) {
          rt.necromancyFired = true;
          const w = wavesData[state.wave - 1];
          for (let i = 0; i < 6; i++) {
            const risen = spawnEnemy(state, EnemyType.UNDEAD_CELT, w.hpMult * 0.6);
            risen.x = e.x + (Math.random() - 0.5) * 30;
            risen.y = e.y + (Math.random() - 0.5) * 30;
            risen.pathIndex = e.pathIndex;
            risen.pathProgress = e.pathProgress;
          }
          state.hint = '💀 NECROMANCY! 6 Undead Celts raised at the Warlord!';
        }
        if (!rt.necromancySecondFired && e.hp <= e.maxHp * 0.15) {
          rt.necromancySecondFired = true;
          const w = wavesData[state.wave - 1];
          for (let i = 0; i < 5; i++) {
            const risen = spawnEnemy(state, EnemyType.UNDEAD_CELT, w.hpMult * 0.6);
            risen.x = e.x + (Math.random() - 0.5) * 30;
            risen.y = e.y + (Math.random() - 0.5) * 30;
            risen.pathIndex = e.pathIndex;
            risen.pathProgress = e.pathProgress;
          }
          state.hint = '💀 FINAL UPRISING! 5 more Undead Celts at the Warlord — finish him!';
        }
        // Mid-fight HP regen. Bumped 0.7%/sec → 1.0%/sec (2026-05-21).
        // The Warlord shouldn't fall to chip damage alone; players
        // need to land committed bursts to push him past each
        // necromancy threshold. Fire/burn still chunks at 1.25× so
        // sustained fire pressure overcomes the regen cleanly.
        if (((e as any).__healingBlockedUntil ?? 0) <= state.tick) {
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * scaledEnemyRegenRate(0.010) * dt);
        }
        break;

      // ─── DAEMON IMPERATOR (W20 boss) ─────────────────────────────────────
      // 2026-05-20 — REBIRTH MECHANIC REMOVED per user direction. The
      // boss no longer flips into a "Wrathful" +90% speed status-immune
      // form at 60% HP. Players who timed their burst to chunk past 60%
      // were being punished by an unstoppable surge that often leaked
      // the gate. HELLSCAPE every 12s is kept — towers within 5 tiles
      // of the Daemon take a 1.5s cooldown stamp on each pulse, so the
      // boss still threatens dedicated lanes without an instant-rebirth
      // panic moment.
      case EnemyType.DAEMON_IMPERATOR:
        if (state.tick >= rt.daemonNextHellscape) {
          rt.daemonNextHellscape = state.tick + 12;
          for (const t of state.towers.values()) {
            const cx = t.tileX * 32 + 16;
            const cy = t.tileY * 32 + 16;
            if (Math.hypot(cx - e.x, cy - e.y) <= 5 * 32) {
              t.attackCooldown += 1.5;       // skip ~1 attack cycle
            }
          }
          state.hint = '🔥 HELLSCAPE — towers near the Daemon are stunned!';
        }
        break;
    }
  }
  // Expire warlord cry buff
  if (rt.warlordCryEndsAt > 0 && state.tick >= rt.warlordCryEndsAt) {
    rt.warlordCryEndsAt = -1;
    for (const en of state.enemies.values()) {
      if (en.faction === EnemyFaction.CELTS) {
        en.baseSpeed /= 1.3;
        en.currentSpeed /= 1.3;
      }
    }
  }
  // Expire pack-howl buffs on Feral Dogs
  if (rt.alphaDogHowlEndsAt > 0 && state.tick >= rt.alphaDogHowlEndsAt) {
    rt.alphaDogHowlEndsAt = -1;
    for (const ally of state.enemies.values()) {
      if ((ally as any).__howlBuffed) {
        ally.baseSpeed /= 1.5;
        ally.currentSpeed /= 1.5;
        (ally as any).__howlBuffed = false;
      }
    }
  }
}

// Called when an enemy dies. Returns true if death triggered an additional spawn (not loot).
export function handleBossDeath(state: GameStateShape, e: Enemy, rt: BossRuntime): void {
  if (e.type === EnemyType.ALPHA_DOG && !rt.alphaDogDeathSpawned) {
    rt.alphaDogDeathSpawned = true;
    const w = wavesData[state.wave - 1];
    for (let i = 0; i < 3; i++) {
      const sp = spawnEnemy(state, EnemyType.FERAL_DOG, w.hpMult * 0.6);
      sp.x = e.x; sp.y = e.y;
      sp.pathIndex = Math.max(0, e.pathIndex - 1);
      sp.pathProgress = 0;
    }
  }
}

// Aura debuffs from living enemies (Druid, Zombie Druid, Demon Legate) — applied to towers each frame
export function applyEnemyAuras(state: GameStateShape) {
  // Reset any prior debuff state — we set per-frame
  for (const t of state.towers.values()) (t as any).__auraSpeedDebuff = 0;
  for (const en of state.enemies.values()) {
    const def: any = (enemiesData as any)[en.type];
    if (!def?.auraTowerSlow) continue;
    const radius = (en.type === EnemyType.DEMON_LEGATE ? 3 : 2) * 32;
    for (const t of state.towers.values()) {
      const cx = t.tileX * 32 + 16;
      const cy = t.tileY * 32 + 16;
      if (Math.hypot(en.x - cx, en.y - cy) <= radius) {
        (t as any).__auraSpeedDebuff = Math.max((t as any).__auraSpeedDebuff ?? 0, def.auraTowerSlow);
      }
    }
  }
}

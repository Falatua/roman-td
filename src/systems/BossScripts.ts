import { Enemy, EnemyType, EnemyFaction } from '../types';
import { GameStateShape } from '../GameState';
import { spawnEnemy } from './EnemySystem';
import wavesData from '../data/waves.json';
import enemiesData from '../data/enemies.json';

interface BossRuntime {
  ambushFired: boolean;        // Undead Warlord ambush
  necromancyFired: boolean;    // Undead Warlord raise dead
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
  daemonImperatorRebirthed: boolean;       // Daemon phase 2
  daemonNextHellscape: number;             // tower-stun cycle time
  undeadElephantRebirthed: boolean;
}

export function createBossRuntime(): BossRuntime {
  return {
    ambushFired: false,
    necromancyFired: false,
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
    daemonImperatorRebirthed: false,
    daemonNextHellscape: 0,
    undeadElephantRebirthed: false
  };
}

// Tick boss-specific scripts. Called each frame from main loop in WAVE phase.
export function tickBossScripts(state: GameStateShape, dt: number, rt: BossRuntime, waveStartTick: number) {
  for (const e of state.enemies.values()) {
    switch (e.type) {

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

      // ─── HANNIBAL BARCA (W20) ────────────────────────────────────────────
      // OOC regen (data) + heal-while-elephants-live (existing) + REBIRTH at 50% HP
      // — phase 2: status-immune, +60% speed, summons 2 War Elephants on rebirth.
      case EnemyType.HANNIBAL_BARCA: {
        // 2026-05: elephant-heal nerf 1.2%/s → 0.4%/s (and only fires if
        // Hannibal hasn't been touched recently — DoT keeps it suppressed).
        const hasElephants = Array.from(state.enemies.values()).some(en => en.type === EnemyType.WAR_ELEPHANT);
        const recentlyHit  = (state.tick - (e.lastDamagedTick ?? -999)) < 0.5;
        if (hasElephants && !recentlyHit) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.004 * dt);
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
          const renderer = (window as any).__renderer;
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
          // Spawn 2 War Elephants
          const w = wavesData[state.wave - 1];
          for (let i = 0; i < 2; i++) {
            const we = spawnEnemy(state, EnemyType.WAR_ELEPHANT, w.hpMult * 0.5);
            we.x = e.x; we.y = e.y;
            we.pathIndex = Math.max(0, e.pathIndex - 1);
            we.pathProgress = 0;
          }
          state.hint = '⚔ HANNIBAL RETURNS! +60% speed, status-immune, 2 War Elephants summoned!';
        }
        break;
      }

      // ─── UNDEAD WARLORD (W30) ────────────────────────────────────────────
      // Ambush 8 berserkers (existing) + NECROMANCY: at 40% HP raise 4 Undead Celts.
      case EnemyType.UNDEAD_WARLORD:
        if (!rt.ambushFired && (state.tick - waveStartTick) > 5) {
          rt.ambushFired = true;
          const path = state.groundPath;
          const mid = path[Math.floor(path.length * 0.5)];
          const w = wavesData[state.wave - 1];
          for (let i = 0; i < 8; i++) {
            const ambusher = spawnEnemy(state, EnemyType.UNDEAD_BERSERKER, w.hpMult);
            ambusher.x = mid.col * 32 + 16;
            ambusher.y = mid.row * 32 + 16;
            ambusher.pathIndex = Math.floor(path.length * 0.5);
            ambusher.pathProgress = 0;
          }
          state.hint = '💀 AMBUSH! 8 Undead Berserkers rise mid-path!';
        }
        if (!rt.necromancyFired && e.hp <= e.maxHp * 0.40) {
          rt.necromancyFired = true;
          const w = wavesData[state.wave - 1];
          for (let i = 0; i < 4; i++) {
            const risen = spawnEnemy(state, EnemyType.UNDEAD_CELT, w.hpMult * 0.6);
            risen.x = e.x + (Math.random() - 0.5) * 30;
            risen.y = e.y + (Math.random() - 0.5) * 30;
            risen.pathIndex = e.pathIndex;
            risen.pathProgress = e.pathProgress;
          }
          state.hint = '💀 NECROMANCY! 4 Undead Celts raised at the Warlord!';
        }
        // Mid-fight HP regen. 2026-05-19 v3 — dropped 1.2%/sec → 0.7%/
        // sec per user direction (−0.5 percentage points). The Warlord's
        // toughness was over-reliant on healing through chip damage,
        // which made melee-light builds feel powerless even when they
        // were landing hits. The regen still bridges short pauses
        // between volleys, but committed damage now sticks better.
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.007 * dt);
        break;

      // ─── DAEMON IMPERATOR (W50) ──────────────────────────────────────────
      // OOC regen (data) + HELLSCAPE every 12s stuns nearby tower cooldowns
      // + REBIRTH at 60% HP into "Wrathful" form: +90% speed for 6s, status-immune.
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
        if (!rt.daemonImperatorRebirthed && e.hp <= e.maxHp * 0.60 && !e.hasRebirthed) {
          rt.daemonImperatorRebirthed = true;
          e.hasRebirthed = true;
          e.hp = e.maxHp * 0.80;
          e.statusEffects = [];
          e.baseSpeed *= 1.9;
          e.currentSpeed *= 1.9;
          rt.hannibalEnragedEndsAt = state.tick + 6;
          (e as any).__daemonWrathful = true;
          state.hint = '😈 THE DAEMON IS WRATHFUL! +90% speed, status-immune for 6s!';
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

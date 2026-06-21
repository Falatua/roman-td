// TrapSystem — consumable, purchasable ground traps (2026 v2).
//
// Flow: buy from the shop/Mercator into state.trapInventory; select one
// (state.selectedTrapType); click a tile to place it (consumes 1, pushes a
// placedTraps entry); when an enemy comes within trigger range the trap fires
// once, applies its effect to a small AoE, then is removed. Reuses the
// burn-patch ground-hazard model + the exported pushStatus status system.
//
// Traps DO pop a damage number when they hit (via the onDamage callback), are
// drawn bright + pulsing (RenderEngine.drawTraps), and some specialise vs
// bosses / flyers.
import { GameStateShape } from '../GameState';
import { GRID } from '../constants';
import { StatusEffectKind } from '../types';
import { pushStatus } from './CombatResolver';

export type TrapEffect = 'DAMAGE' | 'POISON' | 'BURN' | 'SLOW' | 'BOSS' | 'FLYER';

export interface TrapDef {
  name: string;
  price: number;          // gold per single trap
  color: number;          // map glow / pulse tint
  spriteKey: string;      // Assets manifest key
  effect: TrapEffect;
  blurb: string;          // shop + codex copy
  pulse: boolean;         // does the placed trap pulse (easy to spot)
  triggerTiles: number;   // proximity (tiles) that sets it off
  radiusTiles: number;    // AoE (tiles) the effect hits
  damage?: number;        // instant damage on trigger
  bossMult?: number;      // extra multiplier vs bosses
  dotDuration?: number;   // POISON/BURN seconds
  dotMag?: number;        // POISON/BURN status magnitude
  slowDuration?: number;  // SLOW seconds
  slowMag?: number;       // SLOW fraction (0.5 = -50% speed)
  flyerOnly?: boolean;    // only fliers can set it off / be hit
}

// Six traps covering damage / poison / burn / slow + a BOSS specialist and a
// FLYER specialist. Prices are cheap-ish since they are one-shot consumables.
export const TRAP_DEFS: Record<string, TrapDef> = {
  IRON_SPIKE_TRAP: {
    name: 'Iron Spike Trap', price: 18, color: 0xc0c0c0, spriteKey: 'TRAP_IRON_SPIKE',
    effect: 'DAMAGE', blurb: 'Bursts for heavy physical damage to everything nearby.',
    pulse: false, triggerTiles: 0.7, radiusTiles: 1.1, damage: 1300,
  },
  VENOM_TRAP: {
    name: 'Venom Trap', price: 22, color: 0x66dd44, spriteKey: 'TRAP_VENOM',
    effect: 'POISON', blurb: 'A toxic cloud: a hit plus lingering POISON over 5s.',
    pulse: true, triggerTiles: 0.8, radiusTiles: 1.4, damage: 450, dotDuration: 5, dotMag: 0.05,
  },
  TAR_FIRE_TRAP: {
    name: 'Tar Fire Trap', price: 22, color: 0xff7722, spriteKey: 'TRAP_TAR_FIRE',
    effect: 'BURN', blurb: 'Ignites tar: a hit plus lingering BURN over 5s.',
    pulse: true, triggerTiles: 0.8, radiusTiles: 1.4, damage: 450, dotDuration: 5, dotMag: 0.05,
  },
  FROST_SNARE: {
    name: 'Frost Snare', price: 20, color: 0x88ddff, spriteKey: 'TRAP_FROST',
    effect: 'SLOW', blurb: 'Chills a wide area, SLOWING enemies 50% for 3.5s.',
    pulse: true, triggerTiles: 0.8, radiusTiles: 1.6, damage: 200, slowDuration: 3.5, slowMag: 0.5,
  },
  BALLISTA_SNARE: {
    name: 'Ballista Snare', price: 45, color: 0xffcc44, spriteKey: 'TRAP_BALLISTA',
    effect: 'BOSS', blurb: 'BOSS SPECIALIST: a massive bolt that hits 4x as hard against bosses.',
    pulse: true, triggerTiles: 0.7, radiusTiles: 0.9, damage: 5500, bossMult: 4.0,
  },
  SKY_NET: {
    name: 'Sky Net', price: 38, color: 0xcfe0ff, spriteKey: 'TRAP_SKY_NET',
    effect: 'FLYER', blurb: 'FLYER SPECIALIST: only fliers trigger it — a big hit plus a heavy SLOW.',
    pulse: true, triggerTiles: 1.0, radiusTiles: 1.4, damage: 3200, slowDuration: 3, slowMag: 0.6, flyerOnly: true,
  },
};

export const TRAP_IDS = Object.keys(TRAP_DEFS);

export interface PlacedTrap {
  id: string;
  type: string;
  x: number; y: number;
  col: number; row: number;
  born: number;          // state.tick when placed (pulse phase)
  color: number;         // stashed from the def so the renderer needs no TrapSystem import
  spriteKey: string;
  pulse: boolean;
}

export function trapOwned(state: GameStateShape, id: string): number {
  return (state.trapInventory ?? {})[id] ?? 0;
}

// Buy `qty` of a trap into inventory. Returns gold spent (0 if unaffordable).
export function buyTraps(state: GameStateShape, id: string, qty: number): number {
  const def = TRAP_DEFS[id];
  if (!def || qty <= 0) return 0;
  const cost = def.price * qty;
  if ((state.gold ?? 0) < cost) return 0;
  state.gold -= cost;
  if (!state.trapInventory) state.trapInventory = {};
  state.trapInventory[id] = (state.trapInventory[id] ?? 0) + qty;
  return cost;
}

// Consume 1 from inventory and drop a placed trap at a tile. Returns false if
// none owned. Traps do NOT block the path (they are an overlay entity).
export function placeTrap(state: GameStateShape, id: string, col: number, row: number): boolean {
  const def = TRAP_DEFS[id];
  if (!def || trapOwned(state, id) <= 0) return false;
  state.trapInventory![id] -= 1;
  if (!state.placedTraps) state.placedTraps = [];
  state.placedTraps.push({
    id: `trap_${id}_${state.tick.toFixed(3)}_${Math.random().toString(36).slice(2, 7)}`,
    type: id,
    x: col * GRID.TILE + GRID.TILE / 2,
    y: row * GRID.TILE + GRID.TILE / 2,
    col, row,
    born: state.tick,
    color: def.color,
    spriteKey: def.spriteKey,
    pulse: def.pulse,
  });
  return true;
}

// Per-frame: detect enemies on traps, fire the effect, remove spent traps.
// Returns the world positions + colors of traps that fired this tick so the
// renderer can flash an impact ring (no damage-number floaters by design).
export function tickTraps(
  state: GameStateShape,
  enemies: any[],
  _dt: number,
  onDamage?: (x: number, y: number, dmg: number, color: number) => void,
  onStatus?: (x: number, y: number, kind: string) => void,
): Array<{ x: number; y: number; color: number; radius: number }> {
  const fired: Array<{ x: number; y: number; color: number; radius: number }> = [];
  const traps = state.placedTraps;
  if (!traps || traps.length === 0) return fired;
  const survivors: PlacedTrap[] = [];
  for (const trap of traps) {
    const def = TRAP_DEFS[trap.type];
    if (!def) continue;
    const trigPx = def.triggerTiles * GRID.TILE;
    // Find a valid trigger: an enemy alive within trigger range that the trap
    // can affect (flyer traps only fire on fliers; ground traps ignore fliers).
    let triggered = false;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (def.flyerOnly && !e.isFlyer) continue;
      if (!def.flyerOnly && e.isFlyer) continue;   // ground traps don't catch fliers
      if (Math.hypot(e.x - trap.x, e.y - trap.y) <= trigPx) { triggered = true; break; }
    }
    if (!triggered) { survivors.push(trap); continue; }
    // FIRE: apply the effect to everything in the AoE that the trap can hit.
    const aoePx = def.radiusTiles * GRID.TILE;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (def.flyerOnly && !e.isFlyer) continue;
      if (!def.flyerOnly && e.isFlyer) continue;
      if (Math.hypot(e.x - trap.x, e.y - trap.y) > aoePx) continue;
      if (def.damage) {
        let dmg = def.damage;
        if (def.bossMult && e.isBoss) dmg *= def.bossMult;
        e.hp -= dmg;
        onDamage?.(e.x, e.y, dmg, def.color);          // show the damage-number popup
      }
      if (def.effect === 'POISON' && def.dotDuration) { pushStatus(e, StatusEffectKind.POISON, def.dotDuration, def.dotMag ?? 0.05, 3); onStatus?.(e.x, e.y, 'POISON'); }
      if (def.effect === 'BURN' && def.dotDuration)   { pushStatus(e, StatusEffectKind.BURN, def.dotDuration, def.dotMag ?? 0.05, 3); onStatus?.(e.x, e.y, 'BURN'); }
      if (def.slowDuration)                            { pushStatus(e, StatusEffectKind.SLOW, def.slowDuration, def.slowMag ?? 0.5, 3); onStatus?.(e.x, e.y, 'FREEZE'); }
    }
    fired.push({ x: trap.x, y: trap.y, color: def.color, radius: aoePx });
    // trap is consumed (not pushed to survivors)
  }
  state.placedTraps = survivors;
  return fired;
}

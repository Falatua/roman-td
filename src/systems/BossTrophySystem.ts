import { DamageType, GamePhase, Tower } from '../types';
import { GameStateShape } from '../GameState';
import { WAVE } from '../constants';
import { canReceiveRunReward, isMajorBossRewardEnemy } from './RewardEligibility';
import towersData from '../data/towers.json';

export type BossTrophyId =
  | 'EXECUTIONERS_LAUREL'
  | 'FIELD_ENGINEERS'
  | 'AUXILIA_DRILL'
  | 'SKYWARD_AQUILA'
  | 'SIEGEBREAKER_TABLETS'
  | 'HARBOR_CHARTS'
  | 'COHORT_STANDARD'
  | 'VESTAL_INCENSE'
  | 'PAYMASTER_SIGIL'
  | 'WATCHTOWER_SURVEYORS';

export interface BossTrophyDef {
  id: BossTrophyId;
  name: string;
  eyebrow: string;
  blurb: string;
  effects: string[];
}

export const BOSS_TROPHIES: BossTrophyDef[] = [
  {
    id: 'EXECUTIONERS_LAUREL',
    name: "Executioner's Laurel",
    eyebrow: 'BOSS TROPHY',
    blurb: 'The next tyrant dies under a public sentence, not a duel.',
    effects: ['All towers deal +15% damage to bosses.', 'Commander enemies take +10% extra damage.']
  },
  {
    id: 'FIELD_ENGINEERS',
    name: 'Field Engineers',
    eyebrow: 'BOSS TROPHY',
    blurb: 'The corpse teaches the engineers where armor buckles and where roads collapse.',
    effects: ['Traps deal +25% damage.', 'Trap trigger and blast radius are +15%.']
  },
  {
    id: 'AUXILIA_DRILL',
    name: 'Auxilia Drill',
    eyebrow: 'BOSS TROPHY',
    blurb: 'The line troops learn to reload while marching and strike while braced.',
    effects: ['Base towers gain +10% attack speed.', 'Melee towers gain +8% direct damage.']
  },
  {
    id: 'SKYWARD_AQUILA',
    name: 'Skyward Aquila',
    eyebrow: 'AIR TROPHY',
    blurb: 'The fallen boss leaves a warning: the sky is now part of the battlefield.',
    effects: ['All towers deal +22% damage to flyers.', 'Ranged and siege towers gain +0.35 range.']
  },
  {
    id: 'SIEGEBREAKER_TABLETS',
    name: 'Siegebreaker Tablets',
    eyebrow: 'ELITE TROPHY',
    blurb: 'Engineers copy the fractures in monster bone, elephant hide, and command armor.',
    effects: ['Siege towers deal +18% damage to bosses, elites, and commanders.', 'Siege towers gain +6% attack speed.']
  },
  {
    id: 'HARBOR_CHARTS',
    name: 'Harbor Charts',
    eyebrow: 'NAVAL TROPHY',
    blurb: 'Salt-stained maps show where sea-things surface and where naval fire should land.',
    effects: ['Harbor and Tideforged towers gain +12% damage.', 'They gain +0.5 range and +25% damage to ocean enemies.']
  },
  {
    id: 'COHORT_STANDARD',
    name: 'Cohort Standard',
    eyebrow: 'COMBO TROPHY',
    blurb: 'A captured banner is nailed to the recipe board. Combined towers fight harder.',
    effects: ['Combo, Supercombo, and Omega towers gain +10% damage.', 'Base towers are unchanged.']
  },
  {
    id: 'VESTAL_INCENSE',
    name: 'Vestal Incense',
    eyebrow: 'SACRED TROPHY',
    blurb: 'The priests burn what the boss feared most. Holy and flame towers answer faster.',
    effects: ['Divine and Fire towers gain +8% attack speed.', 'Divine towers deal +12% damage to demons, undead, and mythic enemies.']
  },
  {
    id: 'PAYMASTER_SIGIL',
    name: 'Paymaster Sigil',
    eyebrow: 'ECONOMY TROPHY',
    blurb: 'The quartermaster finds a terrifying use for trophies: receipts.',
    effects: ['Boss, elite, and commander kills pay +8 gold.', 'Regular kills are unchanged.']
  },
  {
    id: 'WATCHTOWER_SURVEYORS',
    name: 'Watchtower Surveyors',
    eyebrow: 'RANGE TROPHY',
    blurb: 'Surveyors mark the boss trail and quietly move every sightline half a tile forward.',
    effects: ['Non-melee towers gain +0.5 range.', 'Boss and commander targets take +6% damage from ranged towers.']
  }
];

export function bossTrophyById(id: BossTrophyId | string | null | undefined): BossTrophyDef | null {
  return BOSS_TROPHIES.find(t => t.id === id) ?? null;
}

export function hasBossTrophy(state: GameStateShape, id: BossTrophyId): boolean {
  return !!state.bossTrophies?.includes(id);
}

export function unclaimedBossTrophies(state: GameStateShape): BossTrophyDef[] {
  const claimed = new Set(state.bossTrophies ?? []);
  return BOSS_TROPHIES.filter(t => !claimed.has(t.id));
}

export function bossTrophyOffers(state: GameStateShape, count = 3, random = Math.random): BossTrophyDef[] {
  const pool = unclaimedBossTrophies(state).slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count));
}

export function applyBossTrophy(state: GameStateShape, id: BossTrophyId): void {
  const def = bossTrophyById(id);
  if (!def) return;
  if (!state.bossTrophies) state.bossTrophies = [];
  if (!state.bossTrophies.includes(id)) state.bossTrophies.push(id);
  state.hint = `${def.name} claimed. Boss trophies now shape the whole run.`;
}

export function shouldOfferBossTrophy(state: GameStateShape, enemy: any): boolean {
  if (!canReceiveRunReward(state)) return false;
  if (!state.endlessMode && state.wave >= WAVE.TOTAL) return false;
  if (!isMajorBossRewardEnemy(enemy)) return false;
  const claimedWaves = state.bossTrophyWavesClaimed ?? [];
  if (claimedWaves.includes(state.wave)) return false;
  return unclaimedBossTrophies(state).length > 0;
}

export function markBossTrophyOfferedForWave(state: GameStateShape): void {
  if (!state.bossTrophyWavesClaimed) state.bossTrophyWavesClaimed = [];
  if (!state.bossTrophyWavesClaimed.includes(state.wave)) state.bossTrophyWavesClaimed.push(state.wave);
}

export function queueBossTrophyOfferForWave(state: GameStateShape, enemy: any, bossName: string): boolean {
  if (!shouldOfferBossTrophy(state, enemy)) return false;
  markBossTrophyOfferedForWave(state);
  state.pendingBossTrophyOffer = { wave: state.wave, bossName };
  return true;
}

export function bossTrophyWaveHasEnded(state: GameStateShape): boolean {
  if (state.phase === GamePhase.WAVE_PHASE) return false;
  if ((state.spawnQueue ?? []).length > 0) return false;
  for (const enemy of state.enemies.values()) {
    if ((enemy as any).isDpsCheck) continue;
    if ((enemy.hp ?? 1) > 0) return false;
  }
  return true;
}

export function consumePendingBossTrophyOffer(state: GameStateShape): { wave: number; bossName: string } | null {
  const pending = state.pendingBossTrophyOffer ?? null;
  if (!pending) return null;
  if (pending.wave !== state.wave || !canReceiveRunReward(state) || unclaimedBossTrophies(state).length === 0) {
    state.pendingBossTrophyOffer = null;
    return null;
  }
  // A boss kill only queues the reward. Preserve that queue until the wave
  // has actually transitioned out of combat with no remaining spawns or
  // living enemies, so multi-boss and boss-plus-escort waves are never
  // interrupted by the trophy modal.
  if (!bossTrophyWaveHasEnded(state)) return null;
  state.pendingBossTrophyOffer = null;
  return pending;
}

export function bossTrophyDamageMult(state: GameStateShape, tower: Tower, target: any): number {
  let mult = 1;
  const def: any = (towersData as any)[tower.type];
  const kind = String(def?.kind ?? '');
  const targetType = String(target?.type ?? '');
  const isCommander = !!target?.isCommander || targetType.includes('COMMANDER');
  const isElite = !!target?.isElite || target?.archetype === 'ELITE'
    || targetType.includes('ELEPHANT')
    || targetType.includes('FIRE_GIANT')
    || targetType.includes('SEA_GIANT')
    || targetType.includes('AMPHIBIOUS_GIANT');
  const isOceanThreat = !!target?.__oceanSpawn
    || targetType.includes('OCEAN')
    || targetType.includes('SEA_')
    || targetType.includes('TIDE')
    || targetType.includes('AMPHIBIOUS');
  if (hasBossTrophy(state, 'EXECUTIONERS_LAUREL')) {
    if (target?.isBoss) mult *= 1.15;
    if (isCommander) mult *= 1.10;
  }
  if (hasBossTrophy(state, 'AUXILIA_DRILL') && tower.damageType === DamageType.PHYS_MELEE) {
    mult *= 1.08;
  }
  if (hasBossTrophy(state, 'SKYWARD_AQUILA') && (target?.isFlyer || target?.isFlying || target?.flying)) {
    mult *= 1.22;
  }
  if (hasBossTrophy(state, 'SIEGEBREAKER_TABLETS') && tower.damageType === DamageType.SIEGE && (target?.isBoss || isCommander || isElite)) {
    mult *= 1.18;
  }
  if (hasBossTrophy(state, 'HARBOR_CHARTS') && (def?.waterOnly || def?.amphibious) && isOceanThreat) {
    mult *= 1.25;
  }
  if (hasBossTrophy(state, 'COHORT_STANDARD') && kind && kind !== 'BASE') {
    mult *= 1.10;
  }
  if (hasBossTrophy(state, 'VESTAL_INCENSE') && tower.damageType === DamageType.DIVINE) {
    const faction = String(target?.faction ?? '');
    if (faction.includes('UNDEAD') || faction.includes('DEMON') || faction.includes('MYTH')
      || targetType.includes('UNDEAD') || targetType.includes('DEMON') || targetType.includes('GHOST') || targetType.includes('SPECTRAL')) mult *= 1.12;
  }
  if (hasBossTrophy(state, 'WATCHTOWER_SURVEYORS') && tower.damageType === DamageType.PHYS_RANGED && (target?.isBoss || isCommander)) {
    mult *= 1.06;
  }
  return mult;
}

export function bossTrophyTowerDpsMult(state: GameStateShape, tower: Tower): number {
  let mult = 1;
  const def: any = (towersData as any)[tower.type];
  if (hasBossTrophy(state, 'HARBOR_CHARTS') && (def?.waterOnly || def?.amphibious)) mult *= 1.12;
  return mult;
}

export function bossTrophyTowerSpeedMult(state: GameStateShape, tower: Tower): number {
  let mult = 1;
  if (hasBossTrophy(state, 'SIEGEBREAKER_TABLETS') && tower.damageType === DamageType.SIEGE) mult *= 1.06;
  if (hasBossTrophy(state, 'VESTAL_INCENSE') && (tower.damageType === DamageType.DIVINE || tower.damageType === DamageType.ELEMENTAL_FIRE)) mult *= 1.08;
  return mult;
}

export function bossTrophyTowerRangeBonus(state: GameStateShape, tower: Tower): number {
  let bonus = 0;
  const def: any = (towersData as any)[tower.type];
  if (hasBossTrophy(state, 'SKYWARD_AQUILA') && (tower.damageType === DamageType.PHYS_RANGED || tower.damageType === DamageType.SIEGE)) bonus += 0.35;
  if (hasBossTrophy(state, 'HARBOR_CHARTS') && (def?.waterOnly || def?.amphibious)) bonus += 0.5;
  if (hasBossTrophy(state, 'WATCHTOWER_SURVEYORS') && def?.melee !== true && tower.damageType !== DamageType.PHYS_MELEE) bonus += 0.5;
  return bonus;
}

export function bossTrophyKillGoldBonus(state: GameStateShape, enemy: any): number {
  if (!hasBossTrophy(state, 'PAYMASTER_SIGIL')) return 0;
  const type = String(enemy?.type ?? '');
  const isElite = !!enemy?.isElite || enemy?.archetype === 'ELITE'
    || type.includes('ELEPHANT')
    || type.includes('FIRE_GIANT')
    || type.includes('SEA_GIANT')
    || type.includes('AMPHIBIOUS_GIANT');
  const isCommander = !!enemy?.isCommander || type.includes('COMMANDER');
  return enemy?.isBoss || isElite || isCommander ? 8 : 0;
}

export function bossTrophyTrapDamageMult(state: GameStateShape): number {
  return hasBossTrophy(state, 'FIELD_ENGINEERS') ? 1.25 : 1;
}

export function bossTrophyTrapRadiusMult(state: GameStateShape): number {
  return hasBossTrophy(state, 'FIELD_ENGINEERS') ? 1.15 : 1;
}

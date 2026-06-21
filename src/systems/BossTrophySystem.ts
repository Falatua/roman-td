import { DamageType, Tower } from '../types';
import { GameStateShape } from '../GameState';

export type BossTrophyId = 'EXECUTIONERS_LAUREL' | 'FIELD_ENGINEERS' | 'AUXILIA_DRILL';

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

export function applyBossTrophy(state: GameStateShape, id: BossTrophyId): void {
  const def = bossTrophyById(id);
  if (!def) return;
  if (!state.bossTrophies) state.bossTrophies = [];
  if (!state.bossTrophies.includes(id)) state.bossTrophies.push(id);
  state.hint = `${def.name} claimed. Boss trophies now shape the whole run.`;
}

export function shouldOfferBossTrophy(state: GameStateShape, enemy: any): boolean {
  if (!enemy?.isBoss || enemy?.isBonusBoss) return false;
  if (!enemy?.isScheduledBoss) return false;
  if (enemy.type === 'WAR_ELEPHANT' || enemy.type === 'UNDEAD_WAR_ELEPHANT') return false;
  const claimedWaves = state.bossTrophyWavesClaimed ?? [];
  if (claimedWaves.includes(state.wave)) return false;
  return unclaimedBossTrophies(state).length > 0;
}

export function markBossTrophyOfferedForWave(state: GameStateShape): void {
  if (!state.bossTrophyWavesClaimed) state.bossTrophyWavesClaimed = [];
  if (!state.bossTrophyWavesClaimed.includes(state.wave)) state.bossTrophyWavesClaimed.push(state.wave);
}

export function bossTrophyDamageMult(state: GameStateShape, tower: Tower, target: any): number {
  let mult = 1;
  if (hasBossTrophy(state, 'EXECUTIONERS_LAUREL')) {
    if (target?.isBoss) mult *= 1.15;
    if (target?.isCommander) mult *= 1.10;
  }
  if (hasBossTrophy(state, 'AUXILIA_DRILL') && tower.damageType === DamageType.PHYS_MELEE) {
    mult *= 1.08;
  }
  return mult;
}

export function bossTrophyTrapDamageMult(state: GameStateShape): number {
  return hasBossTrophy(state, 'FIELD_ENGINEERS') ? 1.25 : 1;
}

export function bossTrophyTrapRadiusMult(state: GameStateShape): number {
  return hasBossTrophy(state, 'FIELD_ENGINEERS') ? 1.15 : 1;
}

import { EnemyType, TileType, TowerType } from '../types';
import { GameStateShape } from '../GameState';
import { canAfford, spendGold } from './EconomySystem';
import { canBuildWaterTowerAt, isBuildable, isWaterZoneTile, restoreNaturalBuildTile, setTowerTile } from './GridManager';
import towersData from '../data/towers.json';
import wavesData from '../data/waves.json';

export interface HarborDraftOffer {
  type: TowerType;
  tier: 1 | 2 | 3 | 4 | 5;
  price: number;
}

export const NAVAL_TOWER_TYPES: TowerType[] = [
  TowerType.TRIREME_BALLISTA,
  TowerType.CORVUS_BOARDING_SHIP,
  TowerType.RAMMING_QUINQUEREME,
  TowerType.CHARYBDIS_VORTEX,
  TowerType.NEREID_ORACLE,
  TowerType.HYDRA_OF_LERNA
];

export const TIDEFORGED_TOWER_TYPES: TowerType[] = [
  TowerType.PRAETORIAN_FLEET,
  TowerType.CORVUS_LEGION_DOCK,
  TowerType.ORACLE_LIGHTHOUSE,
  TowerType.ABYSSAL_ONAGER,
  TowerType.HYDRA_BEAST_PIT,
  TowerType.MARS_TIDAL_BASTION,
  TowerType.NEPTUNES_LEVIATHAN
];

export function isNavalTowerType(type: TowerType | string): boolean {
  return !!(towersData as any)[type]?.waterOnly || NAVAL_TOWER_TYPES.includes(type as TowerType);
}

export function isTideforgedTowerType(type: TowerType | string): boolean {
  return !!(towersData as any)[type]?.amphibious || TIDEFORGED_TOWER_TYPES.includes(type as TowerType);
}

export function isHarborTowerType(type: TowerType | string): boolean {
  return isNavalTowerType(type) || isTideforgedTowerType(type);
}

const OCEAN_THREAT_ENEMY_TYPES = new Set<string>([
  EnemyType.OCEAN_FISHLING,
  EnemyType.SEA_GIANT,
  EnemyType.SEA_GIANT_WARBRINGER,
  EnemyType.NETHER_AMPHIBIOUS_GIANT,
  EnemyType.TIDECALLER_COMMANDER,
  EnemyType.STORMTIDE_WYVERN_COMMANDER
]);

export function isOceanThreatEnemy(enemyOrType: EnemyType | string | { type?: EnemyType | string; __oceanSpawn?: boolean } | null | undefined): boolean {
  if (!enemyOrType) return false;
  if (typeof enemyOrType === 'object') {
    return !!enemyOrType.__oceanSpawn || OCEAN_THREAT_ENEMY_TYPES.has(String(enemyOrType.type ?? ''));
  }
  return OCEAN_THREAT_ENEMY_TYPES.has(String(enemyOrType));
}

export function harborTowerCanUseTile(state: GameStateShape, type: TowerType | string, col: number, row: number): boolean {
  const tile = state.tiles[row]?.[col];
  if (isNavalTowerType(type)) return tile === TileType.WATER && canBuildWaterTowerAt(state, col, row);
  if (isTideforgedTowerType(type)) {
    if (tile === TileType.WATER) return canBuildWaterTowerAt(state, col, row);
    return isBuildable(state, col, row);
  }
  return isBuildable(state, col, row);
}

export function placeTowerTileForType(state: GameStateShape, type: TowerType | string, col: number, row: number): boolean {
  if (!harborTowerCanUseTile(state, type, col, row)) return false;
  return setTowerTile(state, col, row);
}

export function restoreTowerTileForType(state: GameStateShape, col: number, row: number): void {
  restoreNaturalBuildTile(state, col, row);
}

export function shouldUnlockHarborFromKill(state: GameStateShape, enemyType: EnemyType | string): boolean {
  if ((state as any).harborUnlocked) return false;
  return enemyType === EnemyType.SEA_GIANT || enemyType === EnemyType.SEA_GIANT_WARBRINGER || enemyType === EnemyType.NETHER_AMPHIBIOUS_GIANT;
}

export function markHarborUnlocked(state: GameStateShape): boolean {
  if ((state as any).harborUnlocked) return false;
  (state as any).harborUnlocked = true;
  (state as any).harborUnlockWave = state.wave;
  (state as any).__pendingHarborWaveDraft = state.wave;
  (state as any).__harborDraftOffers = undefined;
  (state as any).__harborDraftWave = undefined;
  state.hint = 'A Sea Giant has fallen. The Harbor quartermaster will offer naval contracts after this ocean wave.';
  return true;
}

export function waveHasOceanThreats(wave: number): boolean {
  const w = (wavesData as any)[wave - 1];
  if (!w || !Array.isArray(w.spawns)) return false;
  return w.spawns.some((grp: any) => !!grp?.ocean && Number(grp.count ?? 0) > 0);
}

export function queueHarborDraftForClearedOceanWave(state: GameStateShape): boolean {
  if (state.lives <= 0 || !waveHasOceanThreats(state.wave)) return false;
  const firstOpen = !(state as any).harborUnlocked;
  (state as any).harborUnlocked = true;
  if ((state as any).harborUnlockWave === undefined) (state as any).harborUnlockWave = state.wave;
  (state as any).__pendingHarborWaveDraft = state.wave;
  (state as any).__pendingHarborUnlockNotice = false;
  buildHarborDraftOffers(state, true);
  state.hint = firstOpen
    ? `Ocean threat wave ${state.wave} cleared. The Harbor will offer naval contracts now.`
    : `Ocean threat wave ${state.wave} cleared. The Harbor quartermaster has fresh naval contracts.`;
  return true;
}

export function harborDraftTierForWave(wave: number): 1 | 2 | 3 | 4 | 5 {
  if (wave >= 27) return 5;
  if (wave >= 21) return 4;
  if (wave >= 16) return 3;
  if (wave >= 12) return 2;
  return 1;
}

export function harborDraftPrice(tier: number, type: TowerType | string): number {
  const base = [0, 95, 155, 245, 375, 560][Math.max(1, Math.min(5, tier))] ?? 155;
  const def: any = (towersData as any)[type] ?? {};
  const controlPremium = /VORTEX|ORACLE|HYDRA/.test(String(type)) ? 45 : 0;
  const burstPremium = /RAMMING|TRIREME/.test(String(type)) ? 30 : 0;
  return base + controlPremium + burstPremium;
}

export function buildHarborDraftOffers(state: GameStateShape, forceRefresh = false): HarborDraftOffer[] {
  const scratch = state as any;
  const refreshDue = forceRefresh
    || !Array.isArray(scratch.__harborDraftOffers)
    || scratch.__harborDraftWave === undefined
    || scratch.__harborDraftWave !== state.wave;
  if (!refreshDue) return scratch.__harborDraftOffers;
  const tier = harborDraftTierForWave(state.wave);
  const pool = NAVAL_TOWER_TYPES.slice();
  const offers: HarborDraftOffer[] = [];
  while (pool.length > 0 && offers.length < 3) {
    const idx = Math.floor(Math.random() * pool.length);
    const type = pool.splice(idx, 1)[0];
    offers.push({ type, tier, price: harborDraftPrice(tier, type) });
  }
  scratch.__harborDraftOffers = offers;
  scratch.__harborDraftWave = state.wave;
  return offers;
}

export function queueHarborDraftPurchase(state: GameStateShape, offer: HarborDraftOffer): boolean {
  if (!canAfford(state, offer.price)) {
    state.hint = `The Harbor wants ${offer.price}g. You have ${state.gold}g.`;
    return false;
  }
  if (!spendGold(state, offer.price)) return false;
  state.pendingPurchasedTowers = state.pendingPurchasedTowers ?? [];
  state.pendingPurchasedTowers.push({ type: offer.type, tier: offer.tier, source: 'harbor' });
  (state as any).__harborDraftOffers = (state as any).__harborDraftOffers?.filter?.((o: HarborDraftOffer) => o.type !== offer.type) ?? undefined;
  state.hint = `Harbor contract purchased: ${(towersData as any)[offer.type]?.name ?? offer.type}. Click an ocean tile to place it.`;
  return true;
}

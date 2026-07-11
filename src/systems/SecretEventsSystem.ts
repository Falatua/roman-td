import { GameStateShape } from '../GameState';
import { GamePhase, ItemId, TowerType } from '../types';
import towersData from '../data/towers.json';
import itemsData from '../data/items_permanent.json';
import { ECONOMY } from '../constants';
import { clampQualityTierForTower } from './TowerSystem';
import { eligibleBaseTowerTypesAtTier } from './BaseTowerRoster';
import { itemBuyPrice, Rarity } from './LootSystem';

export const MERCATOR_BACKROOM_MIN_WAVE = 9;
export const MERCATOR_BACKROOM_PURCHASE_TRIGGER = 3;
export const MERCATOR_BACKROOM_SPEND_TRIGGER = 1500;

export type MercatorBackRoomOfferKind = 'ITEM' | 'TOWER' | 'SUPPLIES';

export interface MercatorBackRoomOffer {
  id: string;
  kind: MercatorBackRoomOfferKind;
  title: string;
  eyebrow: string;
  description: string;
  price: number;
  itemId?: ItemId;
  rarity?: Rarity;
  towerType?: TowerType;
  tier?: 1 | 2 | 3 | 4 | 5;
  lifeBonus?: number;
}

export type MercatorBackRoomClaimResult =
  | { ok: true; offer: MercatorBackRoomOffer }
  | { ok: false; reason: 'already_claimed' | 'missing_offer' | 'not_enough_gold' | 'inventory_full' | 'grant_failed' };

function runIsAlive(state: GameStateShape): boolean {
  return state.lives > 0
    && state.gameOverAt < 0
    && state.victoryAt < 0
    && state.phase !== GamePhase.GAME_OVER
    && state.phase !== GamePhase.VICTORY;
}

function isPreWave(state: GameStateShape): boolean {
  return state.phase === GamePhase.BUILD_PHASE
    || state.phase === GamePhase.PROSPECT_PLACEMENT
    || state.phase === GamePhase.PICK_KEEPER;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function towerDisplayName(type: TowerType | string): string {
  const def: any = (towersData as any)[type];
  return String(def?.name ?? String(type).replace(/_/g, ' '));
}

function itemDisplayName(itemId: ItemId | string): string {
  const def: any = (itemsData as any)[itemId];
  return String(def?.name ?? String(itemId).replace(/_/g, ' '));
}

export function recordMercatorBackRoomPurchase(state: GameStateShape, goldSpent: number): void {
  const spent = Math.max(0, Math.round(goldSpent));
  if (spent <= 0) return;
  state.mercatorPurchaseCount = (state.mercatorPurchaseCount ?? 0) + 1;
  state.mercatorGoldSpent = (state.mercatorGoldSpent ?? 0) + spent;
  state.mercatorPurchaseWaves = state.mercatorPurchaseWaves ?? [];
  if (!state.mercatorPurchaseWaves.includes(state.wave)) {
    state.mercatorPurchaseWaves.push(state.wave);
  }
}

export function shouldOfferMercatorBackRoom(state: GameStateShape): boolean {
  if (!runIsAlive(state) || !isPreWave(state)) return false;
  if (state.endlessMode || state.sandboxMode) return false;
  if ((state.wave ?? 0) < MERCATOR_BACKROOM_MIN_WAVE) return false;
  if (state.mercatorBackRoomOffered || state.mercatorBackRoomClaimed || state.mercatorBackRoomDeclined) return false;
  const purchases = state.mercatorPurchaseCount ?? 0;
  const spent = state.mercatorGoldSpent ?? 0;
  const visits = state.mercatorPurchaseWaves?.length ?? 0;
  return purchases >= MERCATOR_BACKROOM_PURCHASE_TRIGGER
    || spent >= MERCATOR_BACKROOM_SPEND_TRIGGER
    || (visits >= 2 && spent >= 1000);
}

export function markMercatorBackRoomOffered(state: GameStateShape): void {
  state.mercatorBackRoomOffered = true;
}

export function declineMercatorBackRoom(state: GameStateShape): void {
  state.mercatorBackRoomDeclined = true;
}

const BACKROOM_LEGENDARIES: ItemId[] = [
  'SPEAR_OF_MARS' as ItemId,
  'JUPITERS_WRATH' as ItemId,
  'CAPITOLINE_AEGIS' as ItemId,
  'DAMNATIO_MEMORIAE' as ItemId,
  'JUPITERS_SKYFIRE' as ItemId,
  'STORM_AQUILA_TALONS' as ItemId,
  'EXECUTIONERS_FALX' as ItemId,
  'CONCUSSIVE_WARHEAD' as ItemId
].filter(id => !!(itemsData as any)[id]);

export function buildMercatorBackRoomOffers(state: GameStateShape): MercatorBackRoomOffer[] {
  if (state.mercatorBackRoomOffers && state.mercatorBackRoomOffers.length > 0) {
    return state.mercatorBackRoomOffers as MercatorBackRoomOffer[];
  }
  const legendary = pick(BACKROOM_LEGENDARIES);
  const legendaryPrice = Math.max(1, Math.round(itemBuyPrice(legendary) * 0.65));
  const tower = pick(eligibleBaseTowerTypesAtTier(5));
  const towerName = towerDisplayName(tower);
  const itemName = itemDisplayName(legendary);
  const offers: MercatorBackRoomOffer[] = [
    {
      id: 'under-table-legendary',
      kind: 'ITEM',
      title: itemName,
      eyebrow: 'UNDER-TABLE LEGENDARY',
      description: `Mercator found ${itemName} in a crate he claims was "definitely not stolen from a triumph parade." Discounted hard, one item only.`,
      price: legendaryPrice,
      itemId: legendary,
      rarity: 'LEGENDARY'
    },
    {
      id: 'armory-chit-t5',
      kind: 'TOWER',
      title: `${towerName} T5`,
      eyebrow: 'STAMPED ARMORY CHIT',
      description: `A secret stamped chit for one Tier V ${towerName}. Cheaper than the front counter, because the front counter has witnesses.`,
      price: 225,
      towerType: tower,
      tier: 5
    },
    {
      id: 'vestal-ration-chits',
      kind: 'SUPPLIES',
      title: 'Vestal Ration Chits',
      eyebrow: 'SEALED MERCY TOKENS',
      description: 'Three emergency life chits from a temple ledger Mercator absolutely did not forge. No traps, no ramparts, just breathing room.',
      price: 160,
      lifeBonus: 3
    }
  ];
  state.mercatorBackRoomOffers = offers;
  return offers;
}

export function claimMercatorBackRoomOffer(
  state: GameStateShape,
  offerId: string,
  handlers: {
    addItem?: (itemId: ItemId, rarity: Rarity, price: number) => boolean;
  } = {}
): MercatorBackRoomClaimResult {
  if (state.mercatorBackRoomClaimed) return { ok: false, reason: 'already_claimed' };
  const offer = buildMercatorBackRoomOffers(state).find(o => o.id === offerId);
  if (!offer) return { ok: false, reason: 'missing_offer' };
  if ((state.gold ?? 0) < offer.price) return { ok: false, reason: 'not_enough_gold' };

  if (offer.kind === 'ITEM') {
    if (!offer.itemId || !offer.rarity || !handlers.addItem) return { ok: false, reason: 'grant_failed' };
    const added = handlers.addItem(offer.itemId, offer.rarity, offer.price);
    if (!added) return { ok: false, reason: 'inventory_full' };
  }

  state.gold = (state.gold ?? 0) - offer.price;

  if (offer.kind === 'TOWER') {
    if (!offer.towerType || !offer.tier) return { ok: false, reason: 'grant_failed' };
    state.pendingPurchasedTowers = state.pendingPurchasedTowers ?? [];
    state.pendingPurchasedTowers.push({
      type: offer.towerType,
      tier: clampQualityTierForTower(offer.towerType, offer.tier),
      source: 'backroom'
    });
  } else if (offer.kind === 'SUPPLIES') {
    state.lives = Math.min(ECONOMY.MAX_LIVES, (state.lives ?? 0) + Math.max(0, Math.floor(offer.lifeBonus ?? 0)));
  }

  state.mercatorBackRoomClaimed = true;
  return { ok: true, offer };
}

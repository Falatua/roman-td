// QuestSystem — goal-oriented run challenges with tiered rewards.
//
// Quests are defined statically. Each carries:
//   - id: stable identifier (used as key in state.questProgress)
//   - tier: 'EARLY' | 'MID' | 'LATE' — drives reward magnitude AND ordering
//           in the HUD panel.
//   - title / blurb: copy shown to the player.
//   - condition: pure function (state) -> current progress number.
//   - target: numeric threshold; quest completes when progress >= target.
//   - reward: { kind, amount?, item?, towerType?, tier? } payload that
//             grantQuestReward dispatches into earnGold / inventory / draw.
//
// The tracking model is dirt simple: every frame, main.ts calls tickQuests()
// which iterates quests, recomputes progress, and grants rewards exactly
// once per quest. Idempotent and side-effect free aside from completion.

import { GameStateShape } from '../GameState';
import { TowerType } from '../types';
import { isHarborTowerType, isTideforgedTowerType } from './HarborSystem';

export type QuestTier = 'EARLY' | 'MID' | 'LATE';
export type QuestRewardKind = 'GOLD' | 'ITEM' | 'TOWER' | 'LIFE';

export interface QuestRewardPayload {
  kind: QuestRewardKind;
  amount?: number;          // gold / lives count
  item?: string;            // item id for inventory grant
  towerType?: TowerType;    // tower granted directly (placed via prospect-style queue)
  towerTier?: 1 | 2 | 3 | 4 | 5;
}

export interface QuestDef {
  id: string;
  tier: QuestTier;
  title: string;
  blurb: string;
  condition: (state: GameStateShape) => number;
  target: number;
  reward: QuestRewardPayload;
}

// All quests in the game — tuned for the 30-wave Solo
// campaign and its roughly 1,600 authored kills. Kill/boss targets land near
// the ends of each campaign third instead of completing in the first 7 waves.
// Non-kill goals remain action-based so the larger spawn counts do not
// accidentally force wasteful walls or repetitive combo crafting.
//
// Helper: highest single-tower kill count anywhere on the board.
const bestSingleTowerKills = (s: GameStateShape): number => {
  let best = 0;
  for (const t of s.towers.values()) if (t.killCount > best) best = t.killCount;
  return best;
};
// Helper: count of towers currently at or above a quality tier.
const countTowersAtTier = (s: GameStateShape, tier: number): number => {
  let n = 0;
  for (const t of s.towers.values()) if (t.qualityTier >= tier && !t.pending) n++;
  return n;
};
// Helper: count of all fielded, non-pending towers on the board.
const countFieldedTowers = (s: GameStateShape): number => {
  let n = 0;
  for (const t of s.towers.values()) if (!t.pending) n++;
  return n;
};
// Helper: count of DISTINCT tower types currently fielded (pending towers
// and same-type duplicates don't add). Powers the roster-variety quests.
const countDistinctTowerTypes = (s: GameStateShape): number => {
  const seen = new Set<string>();
  for (const t of s.towers.values()) if (!t.pending) seen.add(t.type);
  return seen.size;
};
// Helper: count of DISTINCT damageTypes across fielded towers.
const countDistinctDamageTypes = (s: GameStateShape): number => {
  const seen = new Set<number>();
  for (const t of s.towers.values()) if (!t.pending) seen.add(t.damageType);
  return seen.size;
};
// Helper: most items equipped on any single tower.
const bestSingleTowerItems = (s: GameStateShape): number => {
  let best = 0;
  for (const t of s.towers.values()) {
    const itemCount = Array.isArray(t.equippedItems) ? t.equippedItems.length : 0;
    if (itemCount > best) best = itemCount;
  }
  return best;
};
// Helper: Harbor-family towers currently committed to ocean tiles.
const countHarborTowersOnWater = (s: GameStateShape): number => {
  let n = 0;
  for (const t of s.towers.values()) if (!t.pending && (t as any).placedOnWater && isHarborTowerType(t.type)) n++;
  return n;
};
// Helper: Tideforged combo towers built on ocean tiles.
const countTideforgedTowersOnWater = (s: GameStateShape): number => {
  let n = 0;
  for (const t of s.towers.values()) if (!t.pending && (t as any).placedOnWater && isTideforgedTowerType(t.type)) n++;
  return n;
};
const hasNeptunesLeviathan = (s: GameStateShape): number => {
  if ((s.combosBuiltUniqueTypes ?? []).includes('NEPTUNES_LEVIATHAN')) return 1;
  for (const t of s.towers.values()) if (!t.pending && t.type === TowerType.NEPTUNES_LEVIATHAN) return 1;
  return 0;
};
// Cross/super-combo type ids — owning any of these completes the apex quest.
const APEX_COMBO_TYPES = new Set<string>([
  'TURMA_LANCERS','AURORA_LEGION','STORM_VEXILLATION',
  'IMPERIUM_ETERNUM','CARTHAGE_SCOURGE','TRIUMVIRATE',
  'TRIPLEX_ACIES','LEGION_PRIME','CONSULAR_FATEBINDER'
]);

const SUPER_COMBO_TYPES = new Set<string>([
  ...APEX_COMBO_TYPES,
  'JULIUS_CAESAR','HANNIBALS_NIGHTMARE','GOD_OF_WAR',
  'NEMESIS_ENGINE','TRIUMPHATOR','PONTIFEX_MAXIMUS',
  'VANGUARD_WING','VULCAN_COLOSSUS',
  'SKY_DOMINION','AUREATE_TRIBUNAL','GLACIAL_PALISADE','INFERNAL_COLOSSUS',
  'MARS_VICTOR'
]);

const OMEGA_COMBO_TYPES = new Set<string>([
  'ROMAN_TRANSFORMER',
  'NEPTUNES_LEVIATHAN'
]);

export const QUESTS: QuestDef[] = [
  // ─── EARLY (still hard — gateway feel, not freebies) ───────────────────
  {
    id: 'first_blood', tier: 'EARLY',
    title: 'First Blood',
    blurb: 'Kill any enemy. The campaign starts here.',
    condition: s => Math.min(1, s.totalKills),
    target: 1,
    reward: { kind: 'GOLD', amount: 5 }
  },
  {
    id: 'bloodline', tier: 'EARLY',
    title: 'Bloodline',
    blurb: 'Total 340 enemy kills across the field. Hold through the first campaign act.',
    condition: s => s.totalKills,
    target: 340,
    reward: { kind: 'GOLD', amount: 25 }
  },
  {
    id: 'maze_architect', tier: 'EARLY',
    title: 'Maze Architect',
    blurb: 'Buy and place 20 STONE walls. Force the path to twist.',
    condition: s => s.stonesPlaced ?? 0,
    target: 20,
    reward: { kind: 'GOLD', amount: 10 }
  },
  {
    id: 'trap_initiate', tier: 'EARLY',
    title: 'Trap Initiate',
    blurb: 'Purchase any trap, then deploy one from your inventory.',
    condition: s => (s.trapsPurchased ?? 0) >= 1 && (s.trapsPlaced ?? 0) >= 1 ? 1 : 0,
    target: 1,
    reward: { kind: 'GOLD', amount: 25 }
  },
  {
    id: 'shipwreck_omen', tier: 'EARLY',
    title: 'Shipwreck Omen',
    blurb: 'Kill 6 ocean-born enemies. The wreck is not just scenery.',
    condition: s => s.oceanEnemiesKilled ?? 0,
    target: 6,
    reward: { kind: 'GOLD', amount: 20 }
  },
  {
    id: 'first_forge', tier: 'EARLY',
    title: "Smith's First Forge",
    blurb: 'Build 3 different combo TYPES. Same combo three times does not count.',
    condition: s => (s.combosBuiltUniqueTypes ?? []).length,
    target: 3,
    reward: { kind: 'GOLD', amount: 15 }
  },
  {
    id: 'iron_discipline', tier: 'EARLY',
    title: 'Iron Discipline',
    blurb: 'A single tower lands 100 kills. Keep your veterans alive.',
    condition: bestSingleTowerKills,
    target: 100,
    reward: { kind: 'ITEM', item: 'TRAINING_SCROLL' }
  },
  {
    id: 'beast_slayer', tier: 'EARLY',
    title: 'Beast Slayer',
    blurb: 'Kill 2 wave bosses. The hunt has only just begun.',
    condition: s => s.bossesKilled ?? 0,
    target: 2,
    reward: { kind: 'GOLD', amount: 25 }
  },
  // 2026-07-02 — playstyle-flavored quests (variety, gear, hero growth)
  // so the early board isn't purely kill-count checkboxes.
  {
    id: 'recruiter', tier: 'EARLY',
    title: 'The Recruiter',
    blurb: 'Field 5 DIFFERENT tower types at the same time. Rome hires broadly.',
    condition: countDistinctTowerTypes,
    target: 5,
    reward: { kind: 'GOLD', amount: 20 }
  },
  {
    id: 'quartermaster', tier: 'EARLY',
    title: 'Quartermaster',
    blurb: 'Equip an item on any tower. Gear wins wars — here is a lens for your trouble.',
    condition: s => Math.min(1, bestSingleTowerItems(s)),
    target: 1,
    reward: { kind: 'ITEM', item: 'WATCHTOWER_LENS' }
  },
  {
    id: 'first_stripe', tier: 'EARLY',
    title: 'First Stripe',
    blurb: 'Your hero reaches Tier I. Blood the commander early.',
    condition: s => s.heroTier ?? 0,
    target: 1,
    reward: { kind: 'GOLD', amount: 20 }
  },
  // ─── MID (commitment-tier — meaningful run investment) ─────────────────
  {
    id: 'butcher', tier: 'MID',
    title: 'Butcher of Rome',
    blurb: 'Total 900 enemy kills. Break the campaign midpoint.',
    condition: s => s.totalKills,
    target: 900,
    reward: { kind: 'GOLD', amount: 75 }
  },
  {
    id: 'champion_tower', tier: 'MID',
    title: 'Champion of the Cohort',
    blurb: 'A single tower reaches 200 kills. Claim the Silver badge.',
    condition: bestSingleTowerKills,
    target: 200,
    reward: { kind: 'ITEM', item: 'BATTLE_STANDARD' }
  },
  {
    id: 'master_smith', tier: 'MID',
    title: 'Master Smith',
    blurb: 'Build 8 combo towers total (any type, repeats count).',
    condition: s => s.combosBuilt ?? 0,
    target: 8,
    reward: { kind: 'GOLD', amount: 40 }
  },
  {
    id: 'field_engineer', tier: 'MID',
    title: 'Field Engineer',
    blurb: 'Purchase 8 traps across the campaign. Stockpile them or commit them when the road turns ugly.',
    condition: s => s.trapsPurchased ?? 0,
    target: 8,
    reward: { kind: 'GOLD', amount: 60 }
  },
  {
    id: 'rampart_mason', tier: 'MID',
    title: 'Rampart Mason',
    blurb: 'Place 2 Stone Ramparts. Turn purchased architecture into a real maze.',
    condition: s => (s.placedRamparts ?? []).length,
    target: 2,
    reward: { kind: 'GOLD', amount: 55 }
  },
  {
    id: 'diverse_legions', tier: 'MID',
    title: 'Diverse Legions',
    blurb: 'Build 5 DIFFERENT combo types. Variety, not volume.',
    condition: s => (s.combosBuiltUniqueTypes ?? []).length,
    target: 5,
    reward: { kind: 'TOWER', towerType: TowerType.SAGITTARIUS, towerTier: 3 }
  },
  {
    id: 'tier_4_threat', tier: 'MID',
    title: 'Tier IV Triple Threat',
    blurb: 'Own 3 Tier 4+ towers simultaneously on the field.',
    condition: s => countTowersAtTier(s, 4),
    target: 3,
    reward: { kind: 'GOLD', amount: 45 }
  },
  {
    id: 'battle_line', tier: 'MID',
    title: 'Battle Line',
    blurb: 'Field 12 towers at the same time. A real legion needs depth, not one champion.',
    condition: countFieldedTowers,
    target: 12,
    reward: { kind: 'GOLD', amount: 80 }
  },
  {
    id: 'boss_hunter', tier: 'MID',
    title: 'Boss Hunter',
    blurb: 'Kill 12 boss-class enemies. Survive the campaign midpoint.',
    condition: s => s.bossesKilled ?? 0,
    target: 12,
    reward: { kind: 'TOWER', towerType: TowerType.CENTURION, towerTier: 4 }
  },
  {
    id: 'full_spectrum', tier: 'MID',
    title: 'Full Spectrum Doctrine',
    blurb: 'Field towers of 4 different damage types at once — melee, ranged, siege, fire, or divine.',
    condition: countDistinctDamageTypes,
    target: 4,
    reward: { kind: 'GOLD', amount: 60 }
  },
  {
    id: 'kitted_veteran', tier: 'MID',
    title: 'Kitted Veteran',
    blurb: 'Load 3 items onto one tower. Build a named soldier, not a statue.',
    condition: bestSingleTowerItems,
    target: 3,
    reward: { kind: 'GOLD', amount: 50 }
  },
  {
    id: 'oathbound', tier: 'MID',
    title: 'Oathbound',
    blurb: 'Claim 2 campaign relics. Rome rewards those who bargain with fate.',
    condition: s => (s.campaignRelicIds ?? []).length,
    target: 2,
    reward: { kind: 'GOLD', amount: 75 }
  },
  {
    id: 'harbor_charter', tier: 'MID',
    title: 'Harbor Charter',
    blurb: 'Kill a Sea Giant and unlock the Harbor. Rome opens the docks.',
    condition: s => (s as any).harborUnlocked ? 1 : 0,
    target: 1,
    reward: { kind: 'GOLD', amount: 50 }
  },
  {
    id: 'dockside_battery', tier: 'MID',
    title: 'Dockside Battery',
    blurb: 'Place 2 Harbor towers on ocean tiles. Turn the cove into artillery.',
    condition: countHarborTowersOnWater,
    target: 2,
    reward: { kind: 'GOLD', amount: 85 }
  },
  // ─── LATE (campaign-defining — only the prepared finish these) ─────────
  {
    id: 'destroyer', tier: 'LATE',
    title: 'Destroyer of Legions',
    blurb: 'Total 2,000 enemy kills. Break the late-campaign armies.',
    condition: s => s.totalKills,
    target: 2000,
    reward: { kind: 'GOLD', amount: 180 }
  },
  {
    id: 'legend_tower', tier: 'LATE',
    title: 'Tower of Legend',
    blurb: 'A single tower reaches 500 kills. Claim the Gold badge.',
    condition: bestSingleTowerKills,
    target: 500,
    reward: { kind: 'GOLD', amount: 200 }
  },
  {
    id: 'apex_forger', tier: 'LATE',
    title: 'Apex Forger',
    blurb: 'Build at least ONE cross-combo or super-combo (combos-of-combos / 5-base recipes).',
    condition: s => {
      const seen = s.combosBuiltUniqueTypes ?? [];
      for (const k of seen) if (APEX_COMBO_TYPES.has(k)) return 1;
      return 0;
    },
    target: 1,
    reward: { kind: 'GOLD', amount: 110 }
  },
  {
    id: 'super_combo_commission', tier: 'LATE',
    title: 'Super Combo Commission',
    blurb: 'Forge any super-combo tower. Rome pays for real escalation.',
    condition: s => {
      const seen = s.combosBuiltUniqueTypes ?? [];
      for (const k of seen) if (SUPER_COMBO_TYPES.has(k)) return 1;
      return 0;
    },
    target: 1,
    reward: { kind: 'GOLD', amount: 500 }
  },
  {
    id: 'omega_foundry', tier: 'LATE',
    title: 'Omega Foundry',
    blurb: 'Forge an Omega Combo Tower. The treasury empties the vault for a miracle.',
    condition: s => {
      const seen = s.combosBuiltUniqueTypes ?? [];
      for (const k of seen) if (OMEGA_COMBO_TYPES.has(k)) return 1;
      return 0;
    },
    target: 1,
    reward: { kind: 'GOLD', amount: 1000 }
  },
  {
    id: 'tideforged_doctrine', tier: 'LATE',
    title: 'Tideforged Doctrine',
    blurb: 'Forge any Tideforged combo tower on an ocean tile. Land and sea agree to be violent.',
    condition: countTideforgedTowersOnWater,
    target: 1,
    reward: { kind: 'GOLD', amount: 150 }
  },
  {
    id: 'leviathan_pact', tier: 'LATE',
    title: "Leviathan's Pact",
    blurb: "Forge Neptune's Leviathan. The sea signs Rome's final contract.",
    condition: hasNeptunesLeviathan,
    target: 1,
    reward: { kind: 'GOLD', amount: 220 }
  },
  {
    id: 'combo_dynasty', tier: 'LATE',
    title: 'Combo Dynasty',
    blurb: 'Build 15 combo towers total across the run. Repeats count.',
    condition: s => s.combosBuilt ?? 0,
    target: 15,
    reward: { kind: 'GOLD', amount: 1000 }
  },
  {
    id: 'ten_million_dps', tier: 'LATE',
    title: 'Ten Million DPS',
    blurb: 'Use DPS Check and break 10,000,000 effective DPS.',
    condition: s => s.bestDpsCheck ?? 0,
    target: 10000000,
    reward: { kind: 'GOLD', amount: 500 }
  },
  {
    id: 'imperial_standard', tier: 'LATE',
    title: 'Imperial Standard',
    blurb: 'Own 2 Tier 5 towers simultaneously on the field.',
    condition: s => countTowersAtTier(s, 5),
    target: 2,
    reward: { kind: 'GOLD', amount: 110 }
  },
  {
    id: 'boss_slayer_supreme', tier: 'LATE',
    title: 'Boss Slayer Supreme',
    blurb: 'Kill 20 boss-class enemies across the full campaign.',
    condition: s => s.bossesKilled ?? 0,
    target: 20,
    reward: { kind: 'GOLD', amount: 200 }
  },
  {
    id: 'eternal_bulwark', tier: 'LATE',
    title: 'Eternal Bulwark',
    blurb: 'Reach wave 27. Stand through the mythic gauntlet.',
    condition: s => s.wave,
    target: 27,
    reward: { kind: 'GOLD', amount: 250 }
  },
  {
    id: 'untouched_walls', tier: 'LATE',
    title: 'Untouched Walls',
    blurb: 'Reach wave 25 with 25+ lives — lose no more than 5 all campaign. Purchased lives do not launder the record.',
    condition: s => (s.wave >= 25 && s.lives >= 25 && (s.livesBoughtThisRun ?? 0) === 0) ? 1 : 0,
    target: 1,
    reward: { kind: 'GOLD', amount: 300 }
  },
  {
    id: 'legion_without_end', tier: 'LATE',
    title: 'Legion Without End',
    blurb: 'Field 20 towers at the same time. Wall-to-wall Rome.',
    condition: countFieldedTowers,
    target: 20,
    reward: { kind: 'GOLD', amount: 150 }
  },
  {
    id: 'croesus_of_rome', tier: 'LATE',
    title: 'Croesus of Rome',
    blurb: 'Hold 2,000 gold at one moment. The Senate audits — and applauds.',
    condition: s => s.gold >= 2000 ? 1 : 0,
    target: 1,
    reward: { kind: 'LIFE', amount: 5 }
  }
];

export function ensureQuestState(s: GameStateShape) {
  if (!s.questProgress) s.questProgress = {};
  if (!s.completedQuests) s.completedQuests = [];
  if (!s.questTierBonusGranted) s.questTierBonusGranted = [];
  if (s.bossesKilled === undefined) s.bossesKilled = 0;
  if (s.combosBuilt === undefined) s.combosBuilt = 0;
  if (!s.combosBuiltUniqueTypes) s.combosBuiltUniqueTypes = [];
  if (s.oceanEnemiesKilled === undefined) s.oceanEnemiesKilled = 0;
  if (s.stonesPlaced === undefined) s.stonesPlaced = 0;
  if (s.trapsPurchased === undefined) s.trapsPurchased = 0;
  if (s.trapsPlaced === undefined) s.trapsPlaced = 0;
  if (s.bestDpsCheck === undefined) s.bestDpsCheck = 0;
}

// 2026-05-17 — Quest tier-completion bonuses.
//   EARLY tier cleared → +50g
//   MID   tier cleared → +100g
//   LATE  tier cleared → +200g
//   ALL quests cleared → +500g capstone (in addition to the LATE bonus)
// Each bonus fires exactly once. The grant set lives on GameState so it
// survives save/load.
export const QUEST_TIER_BONUS: Record<'EARLY' | 'MID' | 'LATE' | 'ALL', number> = {
  EARLY: 50,
  MID:   100,
  LATE:  200,
  ALL:   500
};

// Returns any tier flags that just became eligible this frame. Caller
// (main.ts) is responsible for paying gold and showing the banner. Order
// guaranteed: tier flags first (EARLY → MID → LATE), then 'ALL' last so
// the grand-completion banner shows after its companion LATE banner.
export function evaluateQuestTierBonuses(s: GameStateShape): ('EARLY' | 'MID' | 'LATE' | 'ALL')[] {
  ensureQuestState(s);
  const granted = new Set(s.questTierBonusGranted!);
  const completed = new Set(s.completedQuests!);
  // Group quests by tier so we know which set is fully done.
  const tiers: ('EARLY' | 'MID' | 'LATE')[] = ['EARLY', 'MID', 'LATE'];
  const newly: ('EARLY' | 'MID' | 'LATE' | 'ALL')[] = [];
  for (const tier of tiers) {
    if (granted.has(tier)) continue;
    const tierQuests = QUESTS.filter(q => q.tier === tier);
    if (tierQuests.length === 0) continue;
    if (tierQuests.every(q => completed.has(q.id))) {
      s.questTierBonusGranted!.push(tier);
      newly.push(tier);
    }
  }
  // Grand completion — every quest done.
  if (!granted.has('ALL') && QUESTS.every(q => completed.has(q.id))) {
    s.questTierBonusGranted!.push('ALL');
    newly.push('ALL');
  }
  return newly;
}

// Recompute progress on every quest. Returns the list of quest defs whose
// reward should be granted this frame (newly completed). main.ts dispatches
// the actual reward (gold/item/tower) using its own helpers.
export function evaluateQuests(s: GameStateShape): QuestDef[] {
  ensureQuestState(s);
  const newly: QuestDef[] = [];
  for (const q of QUESTS) {
    const prog = q.condition(s);
    s.questProgress![q.id] = prog;
    if (prog >= q.target && !s.completedQuests!.includes(q.id)) {
      s.completedQuests!.push(q.id);
      newly.push(q);
    }
  }
  return newly;
}

export function activeQuestsByTier(s: GameStateShape): Record<QuestTier, QuestDef[]> {
  ensureQuestState(s);
  const out: Record<QuestTier, QuestDef[]> = { EARLY: [], MID: [], LATE: [] };
  for (const q of QUESTS) {
    if (s.completedQuests!.includes(q.id)) continue;
    out[q.tier].push(q);
  }
  return out;
}

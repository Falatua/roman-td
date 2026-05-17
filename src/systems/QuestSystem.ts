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

// All quests in the game — 18 across 3 tiers, every one tuned to require
// genuine work and to feel mechanically distinct from its peers. Rewards
// scale with tier difficulty:
//   EARLY  — gold 25-50 OR a common item (gateway feel, but real targets)
//   MID    — gold 100-150 OR a rare item OR a mid-tier tower
//   LATE   — gold 350+ (enough to fund a Mercator T5)
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
// Cross/super-combo type ids — owning any of these completes the apex quest.
const APEX_COMBO_TYPES = new Set<string>([
  'TURMA_LANCERS','AURORA_LEGION','STORM_VEXILLATION',
  'IMPERIUM_ETERNUM','CARTHAGE_SCOURGE','TRIUMVIRATE',
  'TRIPLEX_ACIES','LEGION_PRIME','CONSULAR_FATEBINDER'
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
    blurb: 'Total 150 enemy kills across the field. No shortcuts.',
    condition: s => s.totalKills,
    target: 150,
    reward: { kind: 'GOLD', amount: 12 }
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
    blurb: 'A single tower lands 60 kills. Keep your veterans alive.',
    condition: bestSingleTowerKills,
    target: 60,
    reward: { kind: 'ITEM', item: 'TRAINING_SCROLL' }
  },
  {
    id: 'beast_slayer', tier: 'EARLY',
    title: 'Beast Slayer',
    blurb: 'Kill 2 wave bosses. The hunt has only just begun.',
    condition: s => s.bossesKilled ?? 0,
    target: 2,
    reward: { kind: 'GOLD', amount: 18 }
  },
  // ─── MID (commitment-tier — meaningful run investment) ─────────────────
  {
    id: 'butcher', tier: 'MID',
    title: 'Butcher of Rome',
    blurb: 'Total 320 enemy kills. The legions remember every cut.',
    condition: s => s.totalKills,
    target: 320,
    reward: { kind: 'GOLD', amount: 35 }
  },
  {
    id: 'champion_tower', tier: 'MID',
    title: 'Champion of the Cohort',
    blurb: 'A single tower passes 120 kills. The Silver-badge milestone.',
    condition: bestSingleTowerKills,
    target: 120,
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
    id: 'boss_hunter', tier: 'MID',
    title: 'Boss Hunter',
    blurb: 'Kill 5 wave bosses. The Decade weighs heavy.',
    condition: s => s.bossesKilled ?? 0,
    target: 5,
    reward: { kind: 'TOWER', towerType: TowerType.CENTURION, towerTier: 4 }
  },
  // ─── LATE (campaign-defining — only the prepared finish these) ─────────
  {
    id: 'destroyer', tier: 'LATE',
    title: 'Destroyer of Legions',
    blurb: 'Total 400 enemy kills. Survive long enough to clear nearly every spawn.',
    condition: s => s.totalKills,
    target: 400,
    reward: { kind: 'GOLD', amount: 100 }
  },
  {
    id: 'legend_tower', tier: 'LATE',
    title: 'Tower of Legend',
    blurb: 'A single tower passes 200 kills. The Gold-badge ceiling.',
    condition: bestSingleTowerKills,
    target: 200,
    reward: { kind: 'GOLD', amount: 120 }
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
    blurb: 'Kill 8 wave bosses across the campaign — clear champions and twin spawns too.',
    condition: s => s.bossesKilled ?? 0,
    target: 8,
    reward: { kind: 'GOLD', amount: 120 }
  },
  {
    id: 'eternal_bulwark', tier: 'LATE',
    title: 'Eternal Bulwark',
    blurb: 'Survive to wave 18. Few legions reach this far.',
    condition: s => s.wave,
    target: 18,
    reward: { kind: 'GOLD', amount: 150 }
  }
];

export function ensureQuestState(s: GameStateShape) {
  if (!s.questProgress) s.questProgress = {};
  if (!s.completedQuests) s.completedQuests = [];
  if (!s.questTierBonusGranted) s.questTierBonusGranted = [];
  if (s.bossesKilled === undefined) s.bossesKilled = 0;
  if (s.combosBuilt === undefined) s.combosBuilt = 0;
  if (!s.combosBuiltUniqueTypes) s.combosBuiltUniqueTypes = [];
  if (s.stonesPlaced === undefined) s.stonesPlaced = 0;
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

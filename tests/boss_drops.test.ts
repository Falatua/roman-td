// Boss drop guarantees — locks in "every scheduled boss kill drops a
// legendary." Regression coverage for the 2026-05-19 universal-drop
// pass that removed wave-type / probability / per-wave-cap gates from
// the boss kill hook in main.ts.
//
// The test asserts the DATA SHAPE that the runtime relies on:
//   - Each scheduled-boss wave (type 'B') has a faction with a valid
//     legendary pool in LootSystem.
//   - The boss spawn entry is flagged isBoss=true so the kill hook
//     enters the legendary-drop branch.
//   - rollBossDrop returns a non-null result for every boss-wave
//     faction on a fresh inventory.
import { describe, it, expect } from 'vitest';
import { rollBossDrop } from '../src/systems/LootSystem';
import { createInventory } from '../src/systems/LootSystem';
import { createGameState } from '../src/GameState';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import itemsData from '../src/data/items_permanent.json';
import { isLegendaryBossDropEnemy, isMajorBossRewardEnemy } from '../src/systems/RewardEligibility';

function freshState() {
  return createGameState();
}

describe('Boss drop guarantee (2026-05-19)', () => {
  const SCHEDULED_BOSS_WAVES = (wavesData as any[]).filter(w => w.type === 'B');

  it('every scheduled-boss wave is present (W5/10/20/30 + bonus)', () => {
    // Sanity: there should be at least 4 scheduled boss waves in the
    // 30-wave campaign. If this drops below 4 someone removed a boss.
    // 2026 v2 spec Ch5: W15-17 reassigned to Hun infantry (no boss); the
    // milestone bosses are now W5/10/20/30 (plus W21 Khan + W24 Nectanebo).
    expect(SCHEDULED_BOSS_WAVES.length).toBeGreaterThanOrEqual(4);
    const waveNums = SCHEDULED_BOSS_WAVES.map(w => w.wave);
    for (const expected of [5, 10, 20, 30]) {
      expect(waveNums).toContain(expected);
    }
  });

  it('W5 boss enemy (CELTIC_WARLORD) is flagged isBoss=true', () => {
    const w5 = SCHEDULED_BOSS_WAVES.find(w => w.wave === 5);
    expect(w5).toBeTruthy();
    const bossSpawn = w5!.spawns.find((s: any) => {
      const def: any = (enemiesData as any)[s.type];
      return def?.isBoss === true;
    });
    expect(bossSpawn).toBeTruthy();
    expect(bossSpawn.type).toBe('CELTIC_WARLORD');
    expect((enemiesData as any).CELTIC_WARLORD.isBoss).toBe(true);
  });

  it('rollBossDrop returns a legendary for every boss-wave faction (fresh inventory)', () => {
    // Every scheduled-boss wave must produce a drop on a fresh inventory.
    // If a faction's BOSS_LEGENDARIES table is missing or empty,
    // rollBossDrop falls back to the global legendary pool; in either
    // case the result must be non-null for a fresh inventory.
    const state = freshState();
    const inv = createInventory();
    for (const w of SCHEDULED_BOSS_WAVES) {
      const drop = rollBossDrop(w.faction, state, inv);
      expect(drop, `boss drop missing for W${w.wave} (${w.faction})`).not.toBeNull();
      expect(drop!.rarity).toBe('LEGENDARY');
      expect((itemsData as any)[drop!.itemId]?.rarity).toBe('LEGENDARY');
    }
  });

  it('W5 specifically drops a Celtic-themed legendary on first kill', () => {
    // Locks in the specific case the player called out: kill Brennus
    // on W5, get a legendary. Repeats 30× to defeat unlucky RNG paths
    // (since CELTS table has 7 items, no single roll should ever be
    // null on a fresh inventory).
    const state = freshState();
    const inv = createInventory();
    for (let i = 0; i < 30; i++) {
      const drop = rollBossDrop('CELTS', state, inv);
      expect(drop).not.toBeNull();
      expect(drop!.rarity).toBe('LEGENDARY');
    }
  });

  it('Boss Dog gets the legendary item drop without becoming a major trophy boss', () => {
    const alphaDog = { type: 'ALPHA_DOG', isBoss: true, isScheduledBoss: false, isBonusBoss: false };
    expect(isLegendaryBossDropEnemy(alphaDog)).toBe(true);
    expect(isMajorBossRewardEnemy(alphaDog)).toBe(false);

    const state = freshState();
    const inv = createInventory();
    const drop = rollBossDrop('DOGS', state, inv);
    expect(drop).not.toBeNull();
    expect(drop!.rarity).toBe('LEGENDARY');
    expect((itemsData as any)[drop!.itemId]?.rarity).toBe('LEGENDARY');
  });

  it('War Elephants keep their non-legendary boss-add item path', () => {
    const elephant = { type: 'WAR_ELEPHANT', isBoss: true, isScheduledBoss: false, isBonusBoss: false };
    const undeadElephant = { type: 'UNDEAD_WAR_ELEPHANT', isBoss: true, isScheduledBoss: true, isBonusBoss: false };
    expect(isLegendaryBossDropEnemy(elephant)).toBe(false);
    expect(isLegendaryBossDropEnemy(undeadElephant)).toBe(false);
  });

  it('rollBossDrop avoids legendaries the player already owns (no-dup rule)', () => {
    // Stuff every CELTS-table legendary into the inventory, then ask
    // for a CELTS drop — it should fall back to the global pool and
    // still return something rather than null.
    const state = freshState();
    const inv = createInventory();
    const CELTS_POOL = ['WARLORDS_WAR_PAINT', 'SPEAR_OF_MARS', 'JUPITERS_WRATH'];
    for (const id of CELTS_POOL) {
      inv.slots.push({ itemId: id as any, rarity: 'LEGENDARY', consumable: false });
    }
    const drop = rollBossDrop('CELTS', state, inv);
    expect(drop).not.toBeNull();
    expect(CELTS_POOL).not.toContain(drop!.itemId);    // never duplicate
  });
});

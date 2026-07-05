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
import { BOSS_SIGNATURE_LEGENDARIES, rollBossDrop, signatureLegendaryForBoss } from '../src/systems/LootSystem';
import { createInventory } from '../src/systems/LootSystem';
import { createGameState } from '../src/GameState';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import itemsData from '../src/data/items_permanent.json';
import { isLegendaryBossDropEnemy, isMajorBossRewardEnemy, isRareOnlyBossDropEnemy } from '../src/systems/RewardEligibility';

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

  it('every boss enemy has a valid signature legendary', () => {
    for (const [type, def] of Object.entries(enemiesData as any)) {
      if (!def.isBoss) continue;
      const signature = signatureLegendaryForBoss(type);
      expect(signature, `${type} signature`).toBeTruthy();
      expect((itemsData as any)[signature!]?.rarity, `${type} signature rarity`).toBe('LEGENDARY');
    }
  });

  it('rollBossDrop returns each scheduled boss signature on fresh inventory', () => {
    // Every scheduled-boss wave must produce the specific boss trophy
    // first, before falling back to broader faction pools for no-duplicate
    // repeated kills.
    const state = freshState();
    const inv = createInventory();
    for (const w of SCHEDULED_BOSS_WAVES) {
      const bossSpawn = w.spawns.find((s: any) => (enemiesData as any)[s.type]?.isBoss);
      expect(bossSpawn, `W${w.wave} boss spawn`).toBeTruthy();
      const drop = rollBossDrop(w.faction, state, inv, bossSpawn!.type);
      expect(drop, `boss drop missing for W${w.wave} (${bossSpawn!.type})`).not.toBeNull();
      expect(drop!.rarity).toBe('LEGENDARY');
      expect((itemsData as any)[drop!.itemId]?.rarity).toBe('LEGENDARY');
      expect(drop!.itemId).toBe(BOSS_SIGNATURE_LEGENDARIES[bossSpawn!.type]);
    }
  });

  it('W5 specifically drops Brennus signature legendary on first kill', () => {
    // Locks in the specific case the player called out: kill Brennus
    // on W5, get Warlord's War Paint.
    const state = freshState();
    const inv = createInventory();
    for (let i = 0; i < 30; i++) {
      const drop = rollBossDrop('CELTS', state, inv, 'CELTIC_WARLORD');
      expect(drop).not.toBeNull();
      expect(drop!.rarity).toBe('LEGENDARY');
      expect(drop!.itemId).toBe('WARLORDS_WAR_PAINT');
    }
  });

  it('Boss Dog gets the legendary item drop without becoming a major trophy boss', () => {
    const alphaDog = { type: 'ALPHA_DOG', isBoss: true, isScheduledBoss: false, isBonusBoss: false };
    expect(isLegendaryBossDropEnemy(alphaDog)).toBe(true);
    expect(isMajorBossRewardEnemy(alphaDog)).toBe(false);

    const state = freshState();
    const inv = createInventory();
    const drop = rollBossDrop('DOGS', state, inv, 'ALPHA_DOG');
    expect(drop).not.toBeNull();
    expect(drop!.rarity).toBe('LEGENDARY');
    expect(drop!.itemId).toBe('ALPHA_PACK_FANG');
    expect((itemsData as any)[drop!.itemId]?.rarity).toBe('LEGENDARY');
  });

  it('War Elephants now use the boss signature legendary path', () => {
    const elephant = { type: 'WAR_ELEPHANT', isBoss: true, isScheduledBoss: false, isBonusBoss: false };
    const undeadElephant = { type: 'UNDEAD_WAR_ELEPHANT', isBoss: true, isScheduledBoss: true, isBonusBoss: false };
    expect(isLegendaryBossDropEnemy(elephant)).toBe(true);
    expect(isLegendaryBossDropEnemy(undeadElephant)).toBe(true);
    expect(rollBossDrop('CARTHAGE', freshState(), createInventory(), 'WAR_ELEPHANT')?.itemId).toBe('ELEPHANT_TUSK');
    expect(rollBossDrop('UNDEAD_CARTHAGE', freshState(), createInventory(), 'UNDEAD_WAR_ELEPHANT')?.itemId).toBe('UNDEAD_ELEPHANT_BONE');
  });

  it('Wave 9 teaching elephants bypass legendary boss drops for Rare loot', () => {
    const wave9Elephant = { type: 'WAR_ELEPHANT', isBoss: true, isScheduledBoss: false, isBonusBoss: false, rareDropOnly: true };
    expect(isRareOnlyBossDropEnemy(wave9Elephant)).toBe(true);
    expect(isLegendaryBossDropEnemy(wave9Elephant)).toBe(false);
  });

  it('rollBossDrop avoids owned or pending signature legendaries (no-dup rule)', () => {
    const state = freshState();
    const inv = createInventory();
    state.lootOrbs.push({ id: 'pending-signature', itemId: 'WARLORDS_WAR_PAINT' as any, rarity: 'LEGENDARY', x: 0, y: 0 });
    const drop = rollBossDrop('CELTS', state, inv, 'CELTIC_WARLORD');
    expect(drop).not.toBeNull();
    expect(drop!.itemId).not.toBe('WARLORDS_WAR_PAINT');
    expect(drop!.rarity).toBe('LEGENDARY');
  });
});

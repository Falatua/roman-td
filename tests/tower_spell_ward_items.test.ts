import { describe, expect, it } from 'vitest';
import itemsData from '../src/data/items_permanent.json';
import { TowerType } from '../src/types';
import {
  canEquipItemFamily,
  itemFamily,
  towerHasEnemySpellWard
} from '../src/systems/ItemRules';
import { itemLootPoolCoverage } from '../src/systems/LootSystem';
import { GATE_EPIC, MERCATOR_EPIC } from '../src/systems/MerchantSystem';
import {
  applyTowerAtkSpeedDebuff,
  applyTowerAuraSpeedDebuff,
  applyTowerCooldownDisruption,
  applyTowerCritChancePenalty,
  applyTowerSilence,
  applyTowerSleep
} from '../src/systems/TowerDebuffSystem';
import { createTower, towerEffectiveStats } from '../src/systems/TowerSystem';

const WARD_ITEMS = ['JANUS_MIRROR', 'SIBYLLINE_WARD', 'HELLGATE_BRAND'] as const;

function towerWith(itemId?: string) {
  const tower = createTower(TowerType.MILITES, 3, 10, 10, 1);
  if (itemId) tower.equippedItems.push(itemId);
  return tower;
}

describe('Epic enemy-spell wards', () => {
  it('defines two Epic defensive wards in ordinary drops and both shop rotations', () => {
    const coverage = itemLootPoolCoverage();
    for (const itemId of ['JANUS_MIRROR', 'SIBYLLINE_WARD']) {
      expect((itemsData as any)[itemId].rarity).toBe('EPIC');
      expect((itemsData as any)[itemId].effect).toContain('Enemy-spell ward');
      expect(coverage.ordinary.EPIC).toContain(itemId);
      expect(GATE_EPIC).toContain(itemId);
      expect(MERCATOR_EPIC).toContain(itemId);
      expect(itemFamily(itemId)).toBe('DEFENSE');
    }
  });

  it('prevents stacking either ward with another defensive item', () => {
    expect(canEquipItemFamily(['JANUS_MIRROR'], 'SIBYLLINE_WARD').ok).toBe(false);
    expect(canEquipItemFamily(['GILDED_SCALE_ARMOR'], 'JANUS_MIRROR').ok).toBe(false);
  });

  it('recognizes both Epic wards and the Hellgate Brand legacy ward', () => {
    for (const itemId of WARD_ITEMS) expect(towerHasEnemySpellWard(towerWith(itemId))).toBe(true);
    expect(towerHasEnemySpellWard(towerWith())).toBe(false);
  });

  it('blocks every enemy-authored tower impairment without changing combat state', () => {
    const tower = towerWith('JANUS_MIRROR');
    tower.attackCooldown = 0.2;

    expect(applyTowerAtkSpeedDebuff(tower, 0.5, 4, 10)).toBe(false);
    expect(applyTowerAuraSpeedDebuff(tower, 0.4, 10)).toBe(false);
    expect(applyTowerCritChancePenalty(tower, 0.3, 'Tomb Omen', 10)).toBe(false);
    expect(applyTowerSilence(tower, 3, 10)).toBe(false);
    expect(applyTowerSleep(tower, 3, 10)).toBe(false);
    expect(applyTowerCooldownDisruption(tower, 5, 10, 'ADD')).toBe(false);

    expect(tower.__atkSpeedDebuffPct).toBeUndefined();
    expect(tower.__atkSpeedDebuffUntil).toBeUndefined();
    expect(tower.__auraSpeedDebuff).toBeUndefined();
    expect(tower.__critChancePenalty).toBeUndefined();
    expect(tower.silencedUntil).toBeUndefined();
    expect(tower.asleepUntil).toBeUndefined();
    expect(tower.attackCooldown).toBeCloseTo(0.2);
    expect(tower.__spellWardBlockedUntil).toBeCloseTo(10.45);
  });

  it('still applies the same impairments to an unwarded tower', () => {
    const tower = towerWith();
    tower.attackCooldown = 0.2;

    expect(applyTowerAtkSpeedDebuff(tower, 0.5, 4, 10)).toBe(true);
    expect(applyTowerAuraSpeedDebuff(tower, 0.4, 10)).toBe(true);
    expect(applyTowerCritChancePenalty(tower, 0.3, 'Tomb Omen', 10)).toBe(true);
    expect(applyTowerSilence(tower, 3, 10)).toBe(true);
    expect(applyTowerSleep(tower, 3, 10)).toBe(true);
    expect(applyTowerCooldownDisruption(tower, 5, 10, 'ADD')).toBe(true);

    expect(tower.__atkSpeedDebuffPct).toBeCloseTo(0.5);
    expect(tower.__atkSpeedDebuffUntil).toBeCloseTo(14);
    expect(tower.__auraSpeedDebuff).toBeCloseTo(0.4);
    expect(tower.__critChancePenalty).toBeCloseTo(0.3);
    expect(tower.silencedUntil).toBeCloseTo(13);
    expect(tower.asleepUntil).toBeCloseTo(13);
    expect(tower.attackCooldown).toBeCloseTo(8);
    expect(tower.__spellWardBlockedUntil).toBeUndefined();
  });

  it('keeps the two Epic wards mechanically distinct beyond their immunity', () => {
    const bare = towerEffectiveStats(towerWith());
    const mirror = towerEffectiveStats(towerWith('JANUS_MIRROR'));
    const sibylline = towerEffectiveStats(towerWith('SIBYLLINE_WARD'));

    expect(mirror.attackSpeed / bare.attackSpeed).toBeCloseTo(1.12, 6);
    expect(mirror.range).toBeCloseTo(bare.range, 6);
    expect(sibylline.attackSpeed).toBeCloseTo(bare.attackSpeed, 6);
    expect(sibylline.range - bare.range).toBeCloseTo(0.75, 6);
  });
});

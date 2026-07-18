import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { createTower, towerStatBreakdown } from '../src/systems/TowerSystem';
import { towerDamageProfile, renderTowerDamageProfileHtml } from '../src/render/TowerDamageProfile';
import { AURA_TILES } from '../src/constants';
import { TowerType } from '../src/types';

describe('tower damage profile UI helper', () => {
  it('shows a tower native direct damage type', () => {
    const state = createGameState();
    const tower = createTower(TowerType.VELITES, 1, 5, 5, 1);
    const profile = towerDamageProfile(tower, state, towerStatBreakdown(tower, state));
    expect(profile.summary).toContain('Ranged');
    expect(profile.rows).toContainEqual(expect.objectContaining({
      kind: 'PRIMARY',
      label: 'Physical Ranged'
    }));
  });

  it('shows Capitoline Aegis as additional divine damage instead of replacing native damage', () => {
    const state = createGameState();
    const tower = createTower(TowerType.MILITES, 1, 5, 5, 1);
    tower.equippedItems.push('CAPITOLINE_AEGIS');
    const profile = towerDamageProfile(tower, state, towerStatBreakdown(tower, state));
    expect(profile.summary).toContain('Melee');
    expect(profile.summary).toContain('Divine');
    expect(profile.rows).toContainEqual(expect.objectContaining({
      kind: 'EXTRA',
      label: 'Divine',
      detail: expect.stringContaining('separate Divine damage')
    }));
  });

  it('shows Sulla aura as separate fire damage', () => {
    const state = createGameState();
    const tower = createTower(TowerType.VELITES, 1, 5, 5, 1);
    const sulla = createTower(TowerType.HERO_SULLA, 5, 6, 5, 1);
    state.towers.set(tower.id, tower);
    state.towers.set(sulla.id, sulla);
    state.activeHeroTowerId = sulla.id;
    const breakdown = towerStatBreakdown(tower, state);
    const profile = towerDamageProfile(tower, state, breakdown);
    expect(profile.summary).toContain('Fire');
    expect(profile.rows).toContainEqual(expect.objectContaining({
      kind: 'EXTRA',
      label: 'Elemental Fire',
      detail: expect.stringContaining('Sulla aura')
    }));
  });

  it('shows Mars Victor inherited Sulla fire as separate fire damage', () => {
    const state = createGameState();
    const tower = createTower(TowerType.VELITES, 1, 5, 5, 1);
    const mars = createTower(TowerType.MARS_VICTOR, 5, 1, 1, 1);
    state.towers.set(tower.id, tower);
    state.towers.set(mars.id, mars);
    const breakdown = towerStatBreakdown(tower, state);
    const profile = towerDamageProfile(tower, state, breakdown);
    expect(profile.summary).toContain('Fire');
    expect(profile.rows).toContainEqual(expect.objectContaining({
      kind: 'EXTRA',
      label: 'Elemental Fire',
      detail: expect.stringContaining("Mars Victor's fused Sulla passive")
    }));
  });

  it('shows Divine Tile as added damage while keeping the native type primary', () => {
    const state = createGameState();
    const ivory = AURA_TILES.find(tile => tile.kind === 'IVORY')!;
    const tower = createTower(TowerType.SCORPIO, 1, ivory.col, ivory.row, 1);
    const profile = towerDamageProfile(tower, state, towerStatBreakdown(tower, state));
    expect(profile.summary).toContain('Siege');
    expect(profile.summary).toContain('Divine');
    expect(profile.rows).toContainEqual(expect.objectContaining({
      kind: 'PRIMARY',
      label: 'Siege'
    }));
    expect(profile.rows).toContainEqual(expect.objectContaining({
      kind: 'EXTRA',
      label: 'Divine',
      detail: expect.stringContaining('separate Divine damage')
    }));
  });

  it('shows on-hit item effects and renders usable HTML', () => {
    const state = createGameState();
    const tower = createTower(TowerType.VELITES, 1, 5, 5, 1);
    tower.equippedItems.push('FIRE_OIL_FLASK', 'GALLIC_SHIELD_BOSS');
    const profile = towerDamageProfile(tower, state, towerStatBreakdown(tower, state));
    expect(profile.summary).toContain('Burn');
    expect(profile.rows).toContainEqual(expect.objectContaining({
      kind: 'ON-HIT',
      label: 'Burn'
    }));
    expect(profile.rows).toContainEqual(expect.objectContaining({
      kind: 'ON-HIT',
      label: 'Stun'
    }));
    const html = renderTowerDamageProfileHtml(profile);
    expect(html).toContain('Damage Profile');
    expect(html).toContain('Fire Oil Flask');
    expect(html).toContain('Gallic Shield Boss');
  });
});

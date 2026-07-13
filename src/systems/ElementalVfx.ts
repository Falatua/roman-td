import towersData from '../data/towers.json';
import { DamageType, Tower, TowerType } from '../types';

export type ElementalVfxFamily = 'LIGHTNING' | 'FIRE' | 'POISON' | 'WATER' | 'ICE' | 'BLEED';

export const ELEMENTAL_VFX_ASSET: Record<ElementalVfxFamily, string> = {
  LIGHTNING: 'VFX_ELEMENT_LIGHTNING',
  FIRE: 'VFX_ELEMENT_FIRE',
  POISON: 'VFX_ELEMENT_POISON',
  WATER: 'VFX_ELEMENT_WATER',
  ICE: 'VFX_ELEMENT_ICE',
  BLEED: 'VFX_ELEMENT_BLEED'
};

const LIGHTNING_TOWERS = new Set<TowerType>([
  TowerType.STORMCALLER, TowerType.STORM_VEXILLATION, TowerType.STORM_BALLISTA,
  TowerType.SKY_DOMINION, TowerType.JOVIAN_SKY_HUNTER
]);
const WATER_MAGIC_TOWERS = new Set<TowerType>([
  TowerType.RAMMING_QUINQUEREME, TowerType.CHARYBDIS_VORTEX,
  TowerType.NEREID_ORACLE, TowerType.ORACLE_LIGHTHOUSE, TowerType.MARS_TIDAL_BASTION
]);

const FIRE_ITEMS = ['FIRE_OIL_FLASK', 'VESTAL_PYRE', 'SOULFIRE_BRAND', 'INFERNO_STANDARD'];
const POISON_ITEMS = ['POISONED_BLADE', 'VENOM_TIPPED_ARROWS', 'SERPENT_AMULET', 'WITCHS_VENOM'];
const BLEED_ITEMS = ['BARBED_GLADIUS', 'FALCATA_BLADE', 'ALPHA_PACK_FANG'];
const LIGHTNING_ITEMS = ['JUPITERS_WRATH', 'STORM_JAVELIN', 'JUPITERS_SKYFIRE', 'STORM_AQUILA_TALONS'];
const WATER_ITEMS = ['BRINEHOOK_ROPE', 'TIDEPIERCER_HARPOON', 'AEGEAN_PEARL', 'STORMGLASS_AMPHORA', 'NEPTUNES_TRIDENT'];

function hasAnyItem(tower: Tower, ids: readonly string[]): boolean {
  return ids.some(id => tower.equippedItems.includes(id));
}

export function elementalVfxFamiliesForTower(tower: Tower): ElementalVfxFamily[] {
  const def: any = (towersData as any)[tower.type] ?? {};
  const ability = String(def.ability ?? '').toUpperCase();
  const out: ElementalVfxFamily[] = [];
  const add = (family: ElementalVfxFamily) => { if (!out.includes(family)) out.push(family); };

  if (LIGHTNING_TOWERS.has(tower.type) || hasAnyItem(tower, LIGHTNING_ITEMS)) add('LIGHTNING');
  if (tower.damageType === DamageType.ELEMENTAL_FIRE || def.burnsGround || hasAnyItem(tower, FIRE_ITEMS)
      || (tower as any).__infernoStandardAura || (tower as any).__sullaFireVfx
      || ability.includes('BURN') || ability.includes('HELLFIRE')) add('FIRE');
  if (hasAnyItem(tower, POISON_ITEMS) || ability.includes('POISON') || ability.includes('TOXIN') || ability.includes('PLAGUE')) add('POISON');
  if (def.kind === 'NAVAL' || def.waterOnly || def.amphibious || hasAnyItem(tower, WATER_ITEMS)
      || ability.includes('TIDEFORGED') || ability.includes('WATER-ONLY')) add('WATER');
  if (ability.includes('FREEZE') || ability.includes('FROST') || ability.includes('GLACIAL') || ability.includes('BLIZZARD')) add('ICE');
  if (hasAnyItem(tower, BLEED_ITEMS) || ability.includes('BLEED')) add('BLEED');
  return out;
}

export function elementalProjectileSpriteKey(tower: Tower, nativeKey: string): string {
  const families = elementalVfxFamiliesForTower(tower);
  if (families.includes('LIGHTNING') && nativeKey !== 'PROJ_JOVIAN_HARPOON') return ELEMENTAL_VFX_ASSET.LIGHTNING;
  if (families.includes('ICE')) return ELEMENTAL_VFX_ASSET.ICE;
  if (families.includes('POISON') && !families.includes('FIRE') && nativeKey !== 'PROJ_MEFITIS_AMPHORA') return ELEMENTAL_VFX_ASSET.POISON;
  if (families.includes('FIRE') && nativeKey !== 'HERO_PROJ_SULLA_METEOR' && nativeKey !== 'PROJ_HELLFIRE_BOLT') return ELEMENTAL_VFX_ASSET.FIRE;
  if (families.includes('WATER') && (WATER_MAGIC_TOWERS.has(tower.type) || hasAnyItem(tower, WATER_ITEMS))) return ELEMENTAL_VFX_ASSET.WATER;
  return nativeKey;
}

export function triggerElementalHitVfx(tower: Tower, x: number, y: number, tick: number): void {
  const renderer: any = typeof globalThis !== 'undefined' ? (globalThis as any).__renderer : undefined;
  if (!renderer) return;
  const families = elementalVfxFamiliesForTower(tower).slice(0, 2);
  if (renderer.triggerSpriteImpact) {
    for (let i = 0; i < families.length; i++) {
      const family = families[i];
      const size = family === 'WATER' || family === 'FIRE' ? 1.55 : family === 'BLEED' ? 1.15 : 1.35;
      renderer.triggerSpriteImpact(x, y, tick + i * 0.025, ELEMENTAL_VFX_ASSET[family], size, 0.34, 128, 128, 6, 3, 3);
    }
  }
  if ((tower as any).__divineRiderVfx && renderer.triggerImpactRing) {
    renderer.triggerImpactRing(x, y, tick, 22, 0xffe066);
    renderer.triggerImpactRing(x, y, tick + 0.05, 36, 0xfff4a8);
  }
}

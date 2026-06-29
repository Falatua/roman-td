import towersData from '../data/towers.json';

const DEFAULT_FLASH_WINDOW = 0.18;

export function isBaseTowerAttackAnimated(type: string): boolean {
  const def: any = (towersData as any)[type];
  return def?.kind === 'BASE' && !def?.isHero;
}

export function baseTowerAttackFlashWindow(type: string): number {
  const def: any = (towersData as any)[type];
  if (!def || def.kind !== 'BASE' || def.isHero) return DEFAULT_FLASH_WINDOW;
  const speed = Number(def.attackSpeed ?? 1);
  if (def.damageType === 'DIVINE' || def.damageType === 'ELEMENTAL_FIRE') return 0.34;
  if (def.damageType === 'SIEGE' || speed <= 0.45) return 0.36;
  if (def.melee && speed >= 2.2) return 0.22;
  if (speed >= 2.0) return 0.24;
  if (def.melee) return 0.26;
  return 0.28;
}

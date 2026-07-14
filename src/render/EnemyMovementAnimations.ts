import { EnemyType } from '../types';

export interface EnemyMovementAnimationSpec {
  sheetKey: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  runFrames: number;
  referenceSpeed: number;
  referenceFps: number;
  minFps: number;
  maxFps: number;
  visualWidthMult: number;
  visualHeightMult: number;
  replacesProceduralStride: boolean;
}

export const ENEMY_MOVEMENT_ANIMATIONS: Partial<Record<EnemyType, EnemyMovementAnimationSpec>> = {
  [EnemyType.ALPHA_DOG]: {
    sheetKey: 'ALPHA_DOG_RUN_SHEET',
    frameWidth: 256,
    frameHeight: 256,
    columns: 3,
    // Frames 1-8 form the run cycle. Frame 9 is an authored settle pose;
    // runtime returns to the original idle sprite whenever movement stops.
    runFrames: 8,
    referenceSpeed: 2,
    referenceFps: 10,
    minFps: 6,
    maxFps: 14,
    // The generated cells are square while the legacy idle source is wider
    // than tall. These multipliers preserve the boss's existing map presence.
    visualWidthMult: 1.10,
    visualHeightMult: 1.45,
    replacesProceduralStride: true
  }
};

export function enemyMovementAnimation(type: EnemyType | string): EnemyMovementAnimationSpec | null {
  return ENEMY_MOVEMENT_ANIMATIONS[type as EnemyType] ?? null;
}

export function enemyMovementFps(spec: EnemyMovementAnimationSpec, currentSpeed: number): number {
  if (currentSpeed <= 0) return 0;
  const scaled = spec.referenceFps * (currentSpeed / spec.referenceSpeed);
  return Math.max(spec.minFps, Math.min(spec.maxFps, scaled));
}

export function advanceEnemyMovementPhase(
  spec: EnemyMovementAnimationSpec,
  phase: number,
  dt: number,
  currentSpeed: number
): number {
  if (currentSpeed <= 0 || dt <= 0) return 0;
  const next = phase + dt * enemyMovementFps(spec, currentSpeed);
  return next % spec.runFrames;
}

export function enemyMovementFrame(spec: EnemyMovementAnimationSpec, phase: number): number {
  return Math.max(0, Math.min(spec.runFrames - 1, Math.floor(phase)));
}

export const ELEPHANT_SPAWN_GAP_SECONDS = 2;

const ELEPHANT_TYPES = new Set<string>([
  'WAR_ELEPHANT',
  'UNDEAD_WAR_ELEPHANT'
]);

type TimedSpawn = {
  type: string;
  spawnAt: number;
  caveB?: boolean;
};

export function isElephantSpawn(type: string): boolean {
  return ELEPHANT_TYPES.has(String(type));
}

// Apply this after every queue transformation. Events and the second gate can
// collapse timestamps after authored group spacing has already been applied.
export function staggerElephantSpawns<T extends TimedSpawn>(queue: T[]): void {
  queue.sort((a, b) => (a.spawnAt - b.spawnAt) || (Number(!!a.caveB) - Number(!!b.caveB)));
  let nextElephantAt = -Infinity;
  for (const spawn of queue) {
    if (!isElephantSpawn(spawn.type)) continue;
    spawn.spawnAt = Math.max(spawn.spawnAt, nextElephantAt);
    nextElephantAt = spawn.spawnAt + ELEPHANT_SPAWN_GAP_SECONDS;
  }
  queue.sort((a, b) => (a.spawnAt - b.spawnAt) || (Number(!!a.caveB) - Number(!!b.caveB)));
}

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('first-run Forge Your Legion guidance', () => {
  const main = fs.readFileSync('src/main.ts', 'utf8');
  const codex = fs.readFileSync('src/render/Codex.ts', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');

  it('teaches the seven-checkpoint maze, ten prospects, two keeps, and combinations', () => {
    expect(main).toContain('all seven checkpoints');
    expect(main).toContain('10 prospects per wave');
    expect(main).toContain('Only <b style="color:#ffd34d">2 prospects</b>');
    expect(main).toContain('Combination towers are your greatest strength jumps');
    expect(main).toContain('longest legal maze possible');
  });

  it('keeps mobile and Codex beginner rules aligned with the live ten-prospect cap', () => {
    expect(main).not.toContain('roll up to 5 towers each round');
    expect(codex).not.toContain('5 random prospects');
    expect(codex).not.toContain('5 rolled prospects');
    expect(html).not.toContain('Each round gives you 5 prospects');
    expect(main).toContain('place up to 10 each wave');
    expect(codex).toContain('10 random prospects');
  });
});

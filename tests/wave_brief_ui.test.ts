import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('Wave brief HUD ergonomics', () => {
  const mainSource = fs.readFileSync('src/main.ts', 'utf8');

  it('keeps the bottom-left wave brief collapsible from the whole header', () => {
    expect(mainSource).toContain("localStorage.getItem('roman_td_wave_brief_collapsed')");
    expect(mainSource).toContain('data-wave-brief-toggle');
    expect(mainSource).toContain("aria-label=\"Collapse wave brief\"");
    expect(mainSource).toContain("aria-label=\"Expand wave brief\"");
  });

  it('shrinks the collapsed wave brief into a compact build-safe tab', () => {
    expect(mainSource).toContain("brief.style.padding = '0'");
    expect(mainSource).toContain("brief.style.minWidth = '0'");
    expect(mainSource).toContain("brief.style.maxWidth = '148px'");
    expect(mainSource).toContain('BRIEF');
  });
});

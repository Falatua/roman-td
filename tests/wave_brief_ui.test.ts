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

describe('Next-wave preview chip ergonomics', () => {
  const mainSource = fs.readFileSync('src/main.ts', 'utf8');

  it('lets players collapse the sprite preview away from build tiles', () => {
    expect(mainSource).toContain("localStorage.getItem(WAVE_PREVIEW_COLLAPSED_KEY)");
    expect(mainSource).toContain('data-wave-preview-toggle');
    expect(mainSource).toContain('aria-label="Collapse next wave preview"');
    expect(mainSource).toContain('aria-label="Expand next wave preview"');
  });

  it('shrinks the collapsed next-wave preview into a compact tab', () => {
    expect(mainSource).toContain('max-width:210px;min-width:0;padding:5px 7px');
    expect(mainSource).toContain('Collapse next wave preview so build tiles are reachable');
    expect(mainSource).toContain("setWavePreviewCollapsed(!collapsed)");
  });
});

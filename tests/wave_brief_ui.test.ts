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

describe('Build overlay ergonomics', () => {
  const mainSource = fs.readFileSync('src/main.ts', 'utf8');

  it('lets players collapse the Stone Rampart placement tray away from build tiles', () => {
    expect(mainSource).toContain("const RAMPART_TRAY_COLLAPSED_KEY = 'roman_td_rampart_tray_collapsed'");
    expect(mainSource).toContain('aria-label="Collapse rampart controls"');
    expect(mainSource).toContain('aria-label="Expand rampart controls"');
    expect(mainSource).toContain('aria-label="Close rampart controls"');
    expect(mainSource).toContain('Collapse this tray if it covers a build tile.');
    expect(mainSource).toContain('right:8px;bottom:86px');
    expect(mainSource).toContain('z-index:75;pointer-events:auto;');
    expect(mainSource).toContain('chip.dataset.rampartTraySig');
    expect(mainSource).toContain('setRampartTrayCollapsed(true)');
    expect(mainSource).toContain('setRampartTrayCollapsed(false)');
    expect(mainSource).toContain('closeRampartPlacementTray()');
    expect(mainSource).toContain('Stone Rampart placement cancelled');
  });

  it('keeps transient placement text boxes from stealing map clicks', () => {
    expect(mainSource).toContain("toast.id = 'block-alert'");
    expect(mainSource).toContain('z-index:80;pointer-events:none;animation:blockAlertFade');
    expect(mainSource).toContain("toast.id = 'insuff-gold-toast'");
    expect(mainSource).toContain('z-index:80;pointer-events:none;animation:insuffGoldFade');
    expect(mainSource).toContain("bar.id = 'hero-placement-banner'");
    expect(mainSource).toContain('pointer-events:none;');
  });

  it('lets players collapse persistent weather text while keeping the control clickable', () => {
    expect(mainSource).toContain("const collapseKey = 'roman_td_weather_chip_collapsed'");
    expect(mainSource).toContain('aria-label="Collapse weather effects"');
    expect(mainSource).toContain('aria-label="Expand weather effects"');
    expect(mainSource).toContain('Collapse weather effects so build tiles are reachable');
    expect(mainSource).toContain("chip.querySelector<HTMLButtonElement>('#weather-chip-toggle')");
  });
});

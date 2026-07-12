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

describe('Left HUD space allocation', () => {
  const uiSource = fs.readFileSync('src/render/UIManager.ts', 'utf8');

  it('removes the score chip from Solo while preserving opt-in shared HUD behavior', () => {
    expect(uiSource).toContain('private showScore: boolean;');
    expect(uiSource).toContain('this.showScore = opts?.showScore ?? sharedHudDefault;');
    expect(uiSource).toContain("${this.showScore ? `<span class=\"hud-icon\" data-stat=\"score\"");
  });

  it('removes the tier percentage strip from Solo while keeping the Pool level', () => {
    expect(uiSource).toContain('private showTierOdds: boolean;');
    expect(uiSource).toContain('this.showTierOdds = opts?.showTierOdds ?? sharedHudDefault;');
    expect(uiSource).toContain('<b>POOL</b> ${state.poolLevel}/${ECONOMY.POOL_MAX_LEVEL}');
    expect(uiSource).toContain('${this.showTierOdds ? `<span class="hud-icon" data-stat="probs"');
  });

  it('caps the left next-wave briefing and scrolls only its roster body', () => {
    expect(uiSource).toContain('max-height:clamp(96px,18vh,150px);overflow:hidden;flex:0 0 auto');
    expect(uiSource).toContain('class="next-wave-preview-title"');
    expect(uiSource).toContain('class="next-wave-preview-scroll"');
    expect(uiSource).toContain('aria-label="Upcoming wave enemies and threats"');
    expect(uiSource).toContain('min-height:0;overflow-y:auto;overflow-x:hidden');
    expect(uiSource).toContain("preview.style.display = 'flex';");
  });
});

describe('Build overlay ergonomics', () => {
  const mainSource = fs.readFileSync('src/main.ts', 'utf8');

  it('lets players collapse the Stone Rampart placement tray away from build tiles', () => {
    expect(mainSource).toContain("const RAMPART_TRAY_COLLAPSED_KEY = 'roman_td_rampart_tray_collapsed'");
    expect(mainSource).toContain('aria-label="Collapse rampart controls"');
    expect(mainSource).toContain('aria-label="Expand rampart controls"');
    expect(mainSource).toContain('aria-label="Close rampart controls"');
    expect(mainSource).toContain('collapse it if it covers a build tile.');
    expect(mainSource).toContain('right:8px;bottom:86px');
    expect(mainSource).toContain('z-index:75;pointer-events:auto;');
    expect(mainSource).toContain('chip.dataset.rampartTraySig');
    expect(mainSource).toContain('setRampartTrayCollapsed(true)');
    expect(mainSource).toContain('setRampartTrayCollapsed(false)');
    expect(mainSource).toContain('closeRampartPlacementTray()');
    expect(mainSource).toContain('Stone Rampart placement cancelled');
  });

  it('lets players drag the Stone Rampart placement tray and remembers the position', () => {
    expect(mainSource).toContain("const RAMPART_TRAY_POSITION_KEY = 'roman_td_rampart_tray_position'");
    expect(mainSource).toContain('aria-label="Move rampart controls"');
    expect(mainSource).toContain('title="Drag to move rampart controls"');
    expect(mainSource).toContain("chip.querySelector<HTMLButtonElement>('#rampart-tray-move')");
    expect(mainSource).toContain('setRampartTrayPosition(nextLeft, nextTop)');
    expect(mainSource).toContain('localStorage.setItem(RAMPART_TRAY_POSITION_KEY');
    expect(mainSource).toContain('clampRampartTrayToStage(chip, true)');
    expect(mainSource).toContain('touch-action:none');
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

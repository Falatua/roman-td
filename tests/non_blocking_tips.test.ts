import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainSource = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');
const waveTipsSource = fs.readFileSync(path.join(root, 'src/render/WaveTips.ts'), 'utf8');

describe('non-blocking teaching tips', () => {
  it('lets battlefield clicks pass through wave lessons while keeping their controls usable', () => {
    expect(waveTipsSource).toMatch(/#\$\{TIP_ID\}\s*\{[\s\S]*?pointer-events:\s*none;/);
    expect(waveTipsSource).toMatch(/#\$\{TIP_ID\} \.wt-controls\s*\{[\s\S]*?pointer-events:\s*auto;/);
  });

  it('keeps transient banners click-through and reserves full pointer capture for modals', () => {
    expect(mainSource).toContain("const isModal = next.opts.modal === true;");
    expect(mainSource).toContain("next.node.style.pointerEvents = isModal ? 'auto' : 'none';");
    expect(mainSource).toContain("close.style.cssText = `position:absolute;");
    expect(mainSource).toContain('pointer-events:auto;z-index:2;');
  });

  it('shows contextual pre-wave advice without gating preparation', () => {
    expect(mainSource).toContain('[ keep building while this notice is open ]');
    expect(mainSource).toContain('pushBanner(b, 12000, { modal: false, clickDismiss: true });');
  });

  it('keeps direct inspect and prospect reminders click-through except for close controls', () => {
    expect(mainSource).toMatch(/banner\.style\.cssText = `[^`]*pointer-events:none;animation:inspectTipFade/);
    expect(mainSource).toContain('class="prospect-reminder-close"');
    expect(mainSource).toMatch(/bar\.style\.cssText = `[^`]*pointer-events:none;/);
    expect(mainSource).toContain('cursor:pointer;pointer-events:auto');
  });

  it('does not weaken real placement decisions', () => {
    expect(mainSource).toContain("next.node.style.pointerEvents = isModal ? 'auto' : 'none';");
    expect(mainSource).toContain('pushBanner(b, 0, { modal: true, clickDismiss: false });');
  });
});

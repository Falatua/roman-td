import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { extractAppVersion } from '../src/render/UpdateNotice';

describe('live update notice', () => {
  const source = fs.readFileSync('src/render/UpdateNotice.ts', 'utf8');
  const main = fs.readFileSync('src/main.ts', 'utf8');

  it('extracts the baked app version from deployed index.html', () => {
    const html = '<div id="loading-version">v0.7.0 · abc1234 · 2026-07-05</div>';
    expect(extractAppVersion(html)).toBe('v0.7.0 · abc1234 · 2026-07-05');
  });

  it('ignores unreplaced dev/template placeholders', () => {
    expect(extractAppVersion('<div id="loading-version">%APP_VERSION%</div>')).toBeNull();
    expect(extractAppVersion('<html></html>')).toBeNull();
  });

  it('polls without cache and presents a dismissible optional refresh notice', () => {
    expect(main).toContain('startLiveUpdateWatcher()');
    expect(source).toContain("cache: 'no-store'");
    expect(source).toContain("'Cache-Control': 'no-cache'");
    expect(source).toContain('New Roman TD Build Available');
    expect(source).toContain('You can keep playing this run');
    expect(source).toContain('REFRESH NOW');
    expect(source).toContain('KEEP PLAYING');
    expect(source).toContain('aria-label="Close update notice"');
    expect(source).toContain('sessionStorage.setItem(DISMISSED_KEY, version)');
  });
});

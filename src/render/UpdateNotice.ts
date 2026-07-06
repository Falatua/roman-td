const NOTICE_ID = 'rtd-update-notice';
const DISMISSED_KEY = 'roman_td_dismissed_update_version';

export function extractAppVersion(html: string): string | null {
  const match = html.match(/id=["']loading-version["'][^>]*>([^<]+)</i);
  const value = match?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!value || value.includes('%APP_VERSION%')) return null;
  return value;
}

function currentLoadedVersion(): string | null {
  const value = document.getElementById('loading-version')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!value || value.includes('%APP_VERSION%')) return null;
  return value;
}

function updateCheckUrl(): string {
  const base = new URL('index.html', window.location.href);
  base.searchParams.set('rtd_update_check', String(Date.now()));
  return base.toString();
}

function dismissedVersion(): string {
  try { return sessionStorage.getItem(DISMISSED_KEY) ?? ''; }
  catch { return ''; }
}

function rememberDismissedVersion(version: string): void {
  try { sessionStorage.setItem(DISMISSED_KEY, version); }
  catch { /* private mode / storage blocked: the close button still works */ }
}

function showUpdateNotice(currentVersion: string, latestVersion: string): void {
  if (document.getElementById(NOTICE_ID)) return;
  const current = escapeHtml(currentVersion);
  const latest = escapeHtml(latestVersion);

  const overlay = document.createElement('div');
  overlay.id = NOTICE_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', 'Roman TD update available');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:100000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'pointer-events:none',
    'font-family:"Courier New",monospace'
  ].join(';');

  overlay.innerHTML = `
    <div style="position:relative;width:min(520px,92vw);padding:20px 20px 18px;background:linear-gradient(180deg,#21160b,#090605);border:3px solid #ffd34d;box-shadow:0 0 32px rgba(255,211,77,0.38),0 0 0 9999px rgba(0,0,0,0.18);color:#fff8e0;text-align:center;pointer-events:auto">
      <button id="rtd-update-close" type="button" aria-label="Close update notice" title="Close" style="position:absolute;top:8px;right:8px;width:30px;height:30px;border:1px solid #8a6622;background:#120c05;color:#ffd34d;font-family:'Courier New',monospace;font-size:18px;font-weight:bold;cursor:pointer">×</button>
      <div style="font-size:12px;letter-spacing:2.6px;color:#ffd34d;font-weight:bold;text-transform:uppercase">New Roman TD Build Available</div>
      <div style="margin-top:10px;font-size:18px;letter-spacing:1.4px;font-weight:bold;text-shadow:2px 2px 0 #000">The empire has been updated.</div>
      <div style="margin-top:12px;font-size:12px;line-height:1.55;color:#e8d6a8">
        You can keep playing this run. To play the newest balance and fixes, refresh the page when you are ready.
      </div>
      <div style="margin-top:14px;display:grid;grid-template-columns:1fr;gap:4px;font-size:10px;color:#aa9a4a;letter-spacing:0.8px">
        <div>Current: <b style="color:#cdb98a">${current}</b></div>
        <div>Newest: <b style="color:#ffd34d">${latest}</b></div>
      </div>
      <div style="margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap">
        <button id="rtd-update-refresh" type="button" style="background:#ffd34d;color:#170e04;border:2px solid #fff1aa;padding:9px 14px;cursor:pointer;font-family:'Courier New',monospace;font-size:12px;font-weight:bold;letter-spacing:1.5px">REFRESH NOW</button>
        <button id="rtd-update-later" type="button" style="background:#181008;color:#e8d6a8;border:2px solid #7a5a1a;padding:9px 14px;cursor:pointer;font-family:'Courier New',monospace;font-size:12px;font-weight:bold;letter-spacing:1.5px">KEEP PLAYING</button>
      </div>
    </div>
  `;

  const dismiss = () => {
    rememberDismissedVersion(latestVersion);
    overlay.remove();
  };
  overlay.querySelector<HTMLButtonElement>('#rtd-update-close')?.addEventListener('click', dismiss);
  overlay.querySelector<HTMLButtonElement>('#rtd-update-later')?.addEventListener('click', dismiss);
  overlay.querySelector<HTMLButtonElement>('#rtd-update-refresh')?.addEventListener('click', () => {
    rememberDismissedVersion(latestVersion);
    window.location.reload();
  });
  document.body.appendChild(overlay);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function startLiveUpdateWatcher(opts?: { intervalMs?: number; initialDelayMs?: number; currentVersion?: string }): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof fetch === 'undefined') return () => {};

  const currentVersion = opts?.currentVersion ?? currentLoadedVersion();
  if (!currentVersion) return () => {};

  const intervalMs = Math.max(15_000, opts?.intervalMs ?? 60_000);
  const initialDelayMs = Math.max(5_000, opts?.initialDelayMs ?? 75_000);
  let stopped = false;
  let timer: number | undefined;
  let inFlight = false;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = window.setTimeout(check, delay);
  };

  const check = async () => {
    if (stopped) return;
    if (document.hidden || inFlight || document.getElementById(NOTICE_ID)) {
      schedule(intervalMs);
      return;
    }
    inFlight = true;
    try {
      const res = await fetch(updateCheckUrl(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) return;
      const latestVersion = extractAppVersion(await res.text());
      if (!latestVersion || latestVersion === currentVersion || latestVersion === dismissedVersion()) return;
      showUpdateNotice(currentVersion, latestVersion);
    } catch {
      // Silent by design: update checks must never disturb a run.
    } finally {
      inFlight = false;
      schedule(intervalMs);
    }
  };

  schedule(initialDelayMs);
  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

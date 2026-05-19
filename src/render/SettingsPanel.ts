// SettingsPanel — 2026-05 v11 tabbed layout.
//
// The standalone HUD SOUND button was removed; sound controls now live
// inside this panel under the SOUND tab. The panel is tab-aware so future
// settings groups (gameplay, controls, etc.) can slot in without another
// modal redesign.

import {
  getMasterVolume, getMusicVolume, getSfxVolume,
  setMasterVolume, setMusicVolume, setSfxVolume,
  isMuted, setMuted,
  SFX,
} from './AudioManager';
import { closeGameModals } from './ModalManager';

type SettingsTab = 'SOUND';

export function showSettingsPanel(parent: HTMLElement) {
  closeGameModals();

  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  // 2026-05-19 — Responsive clamping (Codex pattern).
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.55);z-index:60;padding:16px 8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace;`;

  const panel = document.createElement('div');
  panel.style.cssText = `width:min(460px,94vw);background:linear-gradient(180deg,#241a12,#0c0a08);border:3px solid #d4af37;color:#e8d6a8;box-shadow:0 0 28px #000;padding:0;display:flex;flex-direction:column;`;

  // Header (no padding here so the tab strip can run flush against it)
  const header = document.createElement('div');
  header.style.cssText = `padding:18px 18px 12px;display:flex;justify-content:space-between;align-items:center`;
  header.innerHTML = `
    <div>
      <div style="font-size:18px;color:#d4af37;font-weight:bold;letter-spacing:3px">SETTINGS</div>
      <div style="font-size:11px;color:#aa9a4a;letter-spacing:1px">Preferences persist between sessions</div>
    </div>
    <div style="font-size:10px;color:#cdb98a;text-align:right;line-height:1.4">Press ESC to close</div>
  `;
  panel.appendChild(header);

  // Tab strip — currently single tab (SOUND); easy to add more later.
  const tabs: SettingsTab[] = ['SOUND'];
  let activeTab: SettingsTab = 'SOUND';
  const tabStrip = document.createElement('div');
  tabStrip.style.cssText = `display:flex;border-bottom:2px solid #d4af37;background:#1a1208`;
  panel.appendChild(tabStrip);

  // Body container that re-renders per active tab.
  const body = document.createElement('div');
  body.style.cssText = `padding:14px 18px;background:#0c0a08;flex:1;`;
  panel.appendChild(body);

  // Footer / close button
  const footer = document.createElement('div');
  footer.style.cssText = `display:flex;justify-content:flex-end;align-items:center;padding:12px 18px;background:#120c08;border-top:1px solid #3a3025`;
  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  close.style.cssText = `background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:7px 16px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px;`;
  footer.appendChild(close);
  panel.appendChild(footer);

  modal.appendChild(panel);

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onKey);
  };
  close.onclick = closeModal;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', onKey);

  // Helper to build a slider row.
  const buildSlider = (
    label: string,
    initial: number,
    onChange: (v: number) => void,
    sampleSfx?: () => void
  ) => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:10px;margin:10px 0;padding:6px 0;`;
    const lbl = document.createElement('div');
    lbl.style.cssText = `width:84px;font-size:12px;color:#cdb98a;letter-spacing:2px;font-weight:bold`;
    lbl.textContent = label;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = String(Math.round(initial * 100));
    range.style.cssText = `flex:1;accent-color:#d4af37;cursor:pointer`;
    const val = document.createElement('div');
    val.style.cssText = `width:42px;font-size:12px;color:#ffd34d;text-align:right;font-weight:bold`;
    val.textContent = `${range.value}%`;
    range.oninput = () => {
      const v = Math.max(0, Math.min(1, Number(range.value) / 100));
      val.textContent = `${range.value}%`;
      onChange(v);
    };
    if (sampleSfx) {
      range.onchange = () => sampleSfx();
    }
    row.appendChild(lbl);
    row.appendChild(range);
    row.appendChild(val);
    return row;
  };

  // Render the SOUND tab body.
  function renderSoundTab() {
    body.innerHTML = '';
    const sec = document.createElement('div');
    sec.style.cssText = `background:#120c08;border:2px solid #3a3025;padding:14px 16px;`;
    const secTitle = document.createElement('div');
    secTitle.style.cssText = `font-size:13px;color:#d4af37;letter-spacing:3px;font-weight:bold;margin-bottom:8px`;
    secTitle.textContent = 'VOLUME';
    sec.appendChild(secTitle);
    sec.appendChild(buildSlider('MASTER', getMasterVolume(), (v) => setMasterVolume(v), () => SFX.buy()));
    sec.appendChild(buildSlider('MUSIC',  getMusicVolume(),  (v) => setMusicVolume(v)));
    sec.appendChild(buildSlider('SFX',    getSfxVolume(),    (v) => setSfxVolume(v),    () => SFX.meleeSwordLight()));

    // Prominent mute toggle (replaces the old HUD button — 2026-05 v11).
    const muteRow = document.createElement('div');
    muteRow.style.cssText = `display:flex;align-items:center;gap:12px;margin-top:14px;padding:10px 12px;background:#1a1208;border:1px solid #5a4a30`;
    const muteBox = document.createElement('input');
    muteBox.type = 'checkbox';
    muteBox.id = 'settings-mute-cb';
    muteBox.checked = isMuted();
    muteBox.style.cssText = `transform:scale(1.4);accent-color:#d4af37;cursor:pointer`;
    muteBox.onchange = () => setMuted(muteBox.checked);
    const muteLbl = document.createElement('label');
    muteLbl.htmlFor = 'settings-mute-cb';
    muteLbl.style.cssText = `font-size:13px;color:#ffd34d;letter-spacing:2px;font-weight:bold;cursor:pointer`;
    muteLbl.textContent = '🔇  MUTE ALL SOUND';
    muteRow.appendChild(muteBox);
    muteRow.appendChild(muteLbl);
    sec.appendChild(muteRow);
    body.appendChild(sec);

    const note = document.createElement('div');
    note.style.cssText = `font-size:10px;color:#aa9a4a;letter-spacing:1px;line-height:1.5;margin-top:10px;text-align:center;font-style:italic`;
    note.innerHTML = `Volumes apply live as you drag. Master multiplies music + SFX.<br/>The MUTE checkbox silences everything regardless of slider levels.`;
    body.appendChild(note);
  }

  function renderTabStrip() {
    tabStrip.innerHTML = '';
    // 2026-05-15 polish: only render the tab strip when there's more than
    // one tab — a single-button strip is visual chrome with no purpose.
    // When a second tab is added later, the strip surfaces automatically.
    if (tabs.length < 2) {
      tabStrip.style.display = 'none';
      return;
    }
    tabStrip.style.display = 'flex';
    for (const t of tabs) {
      const tab = document.createElement('button');
      tab.textContent = t;
      tab.style.cssText = `background:${t === activeTab ? '#d4af37' : '#3a2a14'};color:${t === activeTab ? '#1a1410' : '#e8d6a8'};border:none;border-right:1px solid #5a4a30;padding:10px 22px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:3px;font-weight:bold`;
      tab.onclick = () => { activeTab = t; renderTabStrip(); renderActive(); };
      tabStrip.appendChild(tab);
    }
  }
  function renderActive() {
    if (activeTab === 'SOUND') renderSoundTab();
  }
  renderTabStrip();
  renderActive();

  parent.appendChild(modal);
}

// TowerLeaderboard — 2026-05 v11 refocused to be WAVE-SPECIFIC. The
// leaderboard now ranks towers by their contribution to the CURRENT wave
// (or the last completed wave during build phase) rather than lifetime
// stats. The purpose is to help the player understand which towers are
// carrying / underperforming so they can adjust the maze before the next
// wave starts.
//
// Columns: rank, sprite, name+type, WAVE DMG (primary), % OF WAVE,
// WAVE KILLS, lifetime mini-summary (smaller), tier.
// Sort options: WAVE DMG, % OF WAVE, WAVE KILLS, TIER.
// Footer: per-wave aggregates + which tower was the MVP this wave.

import { Tower } from '../types';
import { GameStateShape } from '../GameState';
import { closeGameModals } from './ModalManager';
import { markScrollable } from './ScrollCues';
import { tex } from './Assets';
import { damageTypeLabel } from '../format';
import towersData from '../data/towers.json';
import { TIER_COLORS } from '../constants';
import { displayWaveNumber } from '../systems/TestYourMightLabels';

function spriteSrc(towerType: string): string | null {
  const t = tex(towerType);
  if (!t) return null;
  const res: any = t.baseTexture?.resource;
  return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
}

type SortKey = 'waveDmg' | 'sharePct' | 'waveKills' | 'tier';

export interface LeaderboardHooks {
  onClose: () => void;
  onSelectTower: (tw: Tower) => void;
}

export function showTowerLeaderboard(parent: HTMLElement, state: GameStateShape, hooks: LeaderboardHooks) {
  closeGameModals();

  // Sort state — primary sort is wave damage by default.
  let sortKey: SortKey = 'waveDmg';

  const modal = document.createElement('div');
  modal.id = 'tower-leaderboard';
  // 2026-05-19 — Responsive clamping. The panel keeps its flex-column
  // structure (sticky header + scrollable body + footer); the modal
  // anchors flex-start so the header is always reachable.
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.65);z-index:58;padding:12px 8px;box-sizing:border-box;font-family:'Courier New',monospace;`;
  modal.addEventListener('click', (e) => { if (e.target === modal) hooks.onClose(); });

  const panel = document.createElement('div');
  panel.style.cssText = `width:min(920px,94vw);max-height:96%;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid #d4af37;box-shadow:0 0 0 2px #120d0a,0 0 36px rgba(212,175,55,0.4),inset 0 0 60px rgba(0,0,0,0.6);display:flex;flex-direction:column;`;
  modal.appendChild(panel);
  parent.appendChild(modal);

  // Header bar — title + wave number + close button
  const waveDisplay = state.wave > 0 ? `WAVE ${displayWaveNumber(state)}` : 'PRE-WAVE 1';
  const header = document.createElement('div');
  header.style.cssText = `padding:14px 18px;background:linear-gradient(90deg,#3a2a14,#1a1410,#3a2a14);border-bottom:2px solid #d4af37;display:flex;justify-content:space-between;align-items:center`;
  header.innerHTML = `
    <div>
      <div style="font-size:18px;font-weight:bold;letter-spacing:4px;color:#ffd34d;text-shadow:2px 2px 0 #000">⚔ WAVE BREAKDOWN — <span style="color:#9be0ff">${waveDisplay}</span></div>
      <div style="font-size:11px;color:#cdb98a;letter-spacing:1px;margin-top:2px">Per-tower contribution to this wave only — totals reset between waves. Click any row to inspect the tower.</div>
    </div>`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `background:#3a1606;color:#ffd34d;border:2px solid #d4af37;padding:6px 12px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:bold;`;
  closeBtn.onclick = () => hooks.onClose();
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Column header / sort controls
  const colHeader = document.createElement('div');
  // grid: # | sprite | name | wave dmg | share% | wave kills | lifetime mini | tier
  colHeader.style.cssText = `display:grid;grid-template-columns:42px 56px 1fr 100px 80px 70px 110px 50px;gap:10px;padding:10px 18px;background:#120d0a;border-bottom:1px solid #5a4a30;font-size:10px;letter-spacing:2px;color:#aa9a4a;font-weight:bold`;
  const colHTML = (label: string, key: SortKey | null, alignRight = false) => {
    if (!key) return `<div style="text-align:${alignRight ? 'right' : 'left'}">${label}</div>`;
    const isActive = sortKey === key;
    return `<div data-sort="${key}" style="text-align:${alignRight ? 'right' : 'left'};cursor:pointer;color:${isActive ? '#ffd34d' : '#aa9a4a'};text-decoration:${isActive ? 'underline' : 'none'}">${label}${isActive ? ' ▼' : ''}</div>`;
  };
  function paintColHeader() {
    colHeader.innerHTML = `
      ${colHTML('#', null)}
      ${colHTML('SPRITE', null)}
      ${colHTML('TOWER', null)}
      ${colHTML('WAVE DMG', 'waveDmg', true)}
      ${colHTML('% OF WAVE', 'sharePct', true)}
      ${colHTML('KILLS', 'waveKills', true)}
      ${colHTML('LIFETIME', null, true)}
      ${colHTML('TIER', 'tier', true)}`;
    colHeader.querySelectorAll('[data-sort]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        sortKey = (el as HTMLElement).getAttribute('data-sort') as SortKey;
        paintColHeader();
        paintRows();
      };
    });
  }
  paintColHeader();
  panel.appendChild(colHeader);

  // Scrollable rows container
  const rowsWrap = document.createElement('div');
  rowsWrap.style.cssText = `overflow-y:auto;flex:1;background:#0c0a08;padding:6px 8px`;
  panel.appendChild(rowsWrap);
  markScrollable(rowsWrap);

  // Footer summary (per-wave aggregates + MVP)
  const footer = document.createElement('div');
  footer.style.cssText = `padding:12px 18px;background:#120d0a;border-top:1px solid #5a4a30;font-size:11px;color:#cdb98a;letter-spacing:1px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px`;
  panel.appendChild(footer);

  function fmtNum(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'k';
    return Math.round(n).toString();
  }

  function paintRows() {
    const towers = Array.from(state.towers.values()).filter((t) => !t.pending);
    const waveDmgSum = towers.reduce((s, t) => s + (t.damageThisWave ?? 0), 0);
    const waveKillSum = towers.reduce((s, t) => s + (t.killsThisWave ?? 0), 0);
    const lifetimeDmgSum = towers.reduce((s, t) => s + (t.totalDamageDealt ?? 0), 0);

    // Compute share% per tower (against current wave's total damage).
    const share = (t: Tower): number =>
      waveDmgSum > 0 ? ((t.damageThisWave ?? 0) / waveDmgSum) * 100 : 0;

    const sortVal = (t: Tower): number => {
      switch (sortKey) {
        case 'waveDmg':   return t.damageThisWave ?? 0;
        case 'sharePct':  return share(t);
        case 'waveKills': return t.killsThisWave ?? 0;
        case 'tier':      return t.qualityTier ?? 0;
      }
    };

    const sorted = towers.slice().sort((a, b) => sortVal(b) - sortVal(a));

    if (sorted.length === 0) {
      rowsWrap.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#aa9a4a;font-size:13px;letter-spacing:1px">No committed towers yet. Place and KEEP some prospects, then come back to see the wave breakdown.</div>`;
      footer.innerHTML = `<span>0 towers · 0 wave damage · 0 wave kills</span>`;
      return;
    }

    // Footer aggregates + MVP callout
    const mvpTower = sorted[0];
    const mvpDef: any = (towersData as any)[mvpTower.type] ?? {};
    const mvpName = mvpDef.name ?? mvpTower.type.replace(/_/g, ' ');
    const mvpShare = waveDmgSum > 0 ? ((mvpTower.damageThisWave ?? 0) / waveDmgSum * 100).toFixed(1) : '0.0';
    footer.innerHTML = `
      <span><b style="color:#fff8e0">${sorted.length}</b> tower${sorted.length === 1 ? '' : 's'} · <b style="color:#ff7733">${fmtNum(waveDmgSum)}</b> wave dmg · <b style="color:#88ff88">${waveKillSum}</b> wave kills · <span style="color:#aa9a4a">(${fmtNum(lifetimeDmgSum)} lifetime)</span></span>
      <span style="color:#ffd34d">★ WAVE MVP: <b>${mvpName} T${mvpTower.qualityTier}</b> — ${mvpShare}% of wave damage</span>`;

    rowsWrap.innerHTML = '';
    sorted.forEach((tw, idx) => {
      const def: any = (towersData as any)[tw.type] ?? {};
      const tierCol = '#' + (TIER_COLORS[tw.qualityTier] ?? 0xaaaaaa).toString(16).padStart(6, '0');
      const src = spriteSrc(tw.type);
      const portrait = src
        ? `<img src="${src}" style="width:44px;height:44px;image-rendering:pixelated;display:block">`
        : `<div style="width:44px;height:44px;background:#1a1410;color:${tierCol};font-size:11px;letter-spacing:1px;display:flex;align-items:center;justify-content:center">${tw.type.slice(0, 3)}</div>`;
      const niceName = def.name ?? tw.type.replace(/_/g, ' ');
      const isCombo = def.kind === 'COMBO';
      const isMvp   = (tw.mvpAwards ?? 0) > 0;
      const sharePct = share(tw);

      // Color the share bar by dominance — green if carrying the wave,
      // amber if pulling weight, red-ish if low contribution.
      const shareColor = sharePct >= 30 ? '#88ff88'
                       : sharePct >= 15 ? '#ffd34d'
                       : sharePct >=  5 ? '#ffaa55'
                                         : '#aa6666';

      // Lifetime mini-summary: total dmg + lifetime kills, smaller font
      const lifetimeMini = `<div style="text-align:right;font-size:10px;color:#aa9a4a;line-height:1.3">${fmtNum(tw.totalDamageDealt ?? 0)}<br/><span style="color:#5a4a30">${tw.killCount ?? 0} k</span></div>`;

      const row = document.createElement('div');
      row.style.cssText = `display:grid;grid-template-columns:42px 56px 1fr 100px 80px 70px 110px 50px;gap:10px;padding:9px 10px;background:${idx % 2 === 0 ? '#100c09' : '#0c0a08'};border-left:3px solid ${tierCol};margin-bottom:2px;align-items:center;cursor:pointer;transition:background 0.12s`;
      row.onmouseenter = () => { row.style.background = '#2a1f12'; };
      row.onmouseleave = () => { row.style.background = idx % 2 === 0 ? '#100c09' : '#0c0a08'; };
      row.onclick = () => hooks.onSelectTower(tw);

      const rankBadge = idx < 3
        ? `<span style="color:${idx === 0 ? '#ffd34d' : idx === 1 ? '#c0c0c0' : '#b87333'};font-weight:bold">${idx + 1}</span>`
        : `<span style="color:#5a4a30">${idx + 1}</span>`;

      row.innerHTML = `
        <div style="text-align:center;font-size:14px;letter-spacing:1px">${rankBadge}</div>
        <div style="width:48px;height:48px;border:1px solid ${tierCol};background:#0c0a08;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 6px ${tierCol}55">${portrait}</div>
        <div style="min-width:0">
          <div style="color:${tierCol};font-weight:bold;font-size:13px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${niceName}${isMvp ? ' <span style="color:#ffd34d;font-size:10px">★</span>' : ''}</div>
          <div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-top:2px">
            ${isCombo ? '<span style="color:#ffd34d">COMBO</span> · ' : ''}${damageTypeLabel(def.damageType)} · ${def.melee ? 'Melee' : 'Ranged'}
          </div>
        </div>
        <div style="text-align:right;color:#ff7733;font-weight:bold;font-size:14px">${fmtNum(tw.damageThisWave ?? 0)}</div>
        <div style="text-align:right;color:${shareColor};font-weight:bold;font-size:13px">${sharePct.toFixed(1)}%</div>
        <div style="text-align:right;color:#fff8e0;font-size:13px">${tw.killsThisWave ?? 0}</div>
        ${lifetimeMini}
        <div style="text-align:right;color:${tierCol};font-weight:bold;font-size:13px">T${tw.qualityTier}</div>`;

      rowsWrap.appendChild(row);
    });
  }
  paintRows();

  // 2026-05-18 — LIVE UPDATE during the wave. Refresh the rows every
  // 600ms while the modal is open so the player can watch their
  // towers' wave damage / kill counts climb in real time. Auto-clears
  // on close (modal removal + ESC + outside-click all route through
  // hooks.onClose, which triggers the same cleanup path).
  const liveTimer = window.setInterval(() => {
    if (!document.body.contains(modal)) {
      window.clearInterval(liveTimer);
      return;
    }
    paintRows();
  }, 600);
  // ESC closes modal
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      hooks.onClose();
      document.removeEventListener('keydown', onKey);
      window.clearInterval(liveTimer);
    }
  };
  document.addEventListener('keydown', onKey);
  // Headline updates with the current wave number too (in case the
  // wave advances while the modal is open).
  const headerTitleEl = panel.querySelector('div:first-child > div:first-child > div:first-child') as HTMLElement | null;
  if (headerTitleEl) {
    // Re-paint header text each tick too so "WAVE N" stays in sync.
    const headerTimer = window.setInterval(() => {
      if (!document.body.contains(modal)) { window.clearInterval(headerTimer); return; }
      const waveDisplayNow = state.wave > 0 ? `WAVE ${displayWaveNumber(state)}` : 'PRE-WAVE 1';
      headerTitleEl.innerHTML = `⚔ WAVE BREAKDOWN — <span style="color:#9be0ff">${waveDisplayNow}</span><span style="font-size:9px;color:#88ff88;margin-left:8px;letter-spacing:2px">● LIVE</span>`;
    }, 1000);
  }
}

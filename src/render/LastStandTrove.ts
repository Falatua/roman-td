import towersData from '../data/towers.json';
import { TowerType } from '../types';
import { GameStateShape } from '../GameState';
import { texUrl } from './Assets';
import { closeGameModals } from './ModalManager';
import {
  lastStandTroveChoices,
  lastStandTroveRecipeHints,
  LAST_STAND_TROVE_TIER
} from '../systems/LastStandTroveSystem';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function towerCardHtml(state: GameStateShape, type: TowerType): string {
  const def: any = (towersData as any)[type] ?? {};
  const name = String(def.name ?? String(type).replace(/_/g, ' '));
  const src = texUrl(type);
  const dps = def.baseDps != null ? Math.round(Number(def.baseDps)) : '?';
  const range = def.range != null ? Number(def.range).toFixed(1) : '?';
  const rate = def.attackSpeed != null ? Number(def.attackSpeed).toFixed(2) : '?';
  const damage = String(def.damageType ?? 'DAMAGE').replace('PHYS_', '').replace('ELEMENTAL_', '').replace(/_/g, ' ');
  const sprite = src
    ? `<img src="${src}" alt="${escapeHtml(name)}" style="width:64px;height:64px;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 2px 0 #000)"/>`
    : `<div style="width:64px;height:64px;display:grid;place-items:center;color:#cdb98a;background:#120d08;border:1px solid #7a5a1a;font-size:10px">NO IMG</div>`;
  const recipeHints = lastStandTroveRecipeHints(state, type, 3);
  const recipeTip = recipeHints.length > 0
    ? `<div style="background:#102014;border:1px solid #4a8a4a;padding:6px;color:#b8ffb8;font-size:9px;line-height:1.35;min-height:38px">
        <b style="color:#88ff88;letter-spacing:1px">RECIPE TIP</b><br/>
        Completes ${recipeHints.map(hint => `<b>${escapeHtml(hint.name)}</b>`).join(', ')}
      </div>`
    : `<div style="background:#120d08;border:1px solid #3a3025;padding:6px;color:#aa9a4a;font-size:9px;line-height:1.35;min-height:38px">
        <b style="color:#d4af37;letter-spacing:1px">RECIPE TIP</b><br/>
        No instant recipe completion yet.
      </div>`;
  return `
    <button class="last-stand-choice" data-tower="${escapeHtml(type)}" title="Claim ${escapeHtml(name)} as a free Tier ${LAST_STAND_TROVE_TIER} tower" style="appearance:none;text-align:left;cursor:pointer;border:2px solid #7a5a1a;background:linear-gradient(180deg,#20160d,#080604);color:#fff8e0;padding:10px;min-height:204px;display:grid;grid-template-rows:auto 1fr auto auto;gap:8px;font-family:'Courier New',monospace;box-shadow:inset 0 0 14px rgba(0,0,0,0.62);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="color:#ff5050;font-size:10px;font-weight:bold;letter-spacing:2px">TIER V</span>
        <span style="color:#ffd34d;font-size:9px;font-weight:bold;letter-spacing:1px">${escapeHtml(damage)}</span>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <div style="width:72px;height:72px;display:grid;place-items:center;background:radial-gradient(circle,#3a2412 0%,#0c0805 72%);border:1px solid #ffd34d55;box-shadow:0 0 12px rgba(255,211,77,0.22)">${sprite}</div>
        <div style="min-width:0">
          <div style="color:#fff8e0;font-size:12px;font-weight:bold;line-height:1.2;word-break:break-word">${escapeHtml(name)}</div>
          <div style="margin-top:5px;color:#aa9a4a;font-size:9px;line-height:1.45">The Senate insists this was always in inventory.</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;color:#cdb98a;font-size:9px">
        <span style="background:#120d08;border:1px solid #3a3025;padding:4px;text-align:center"><b style="color:#ffd34d">DPS</b><br/>${dps}</span>
        <span style="background:#120d08;border:1px solid #3a3025;padding:4px;text-align:center"><b style="color:#ffd34d">RNG</b><br/>${range}</span>
        <span style="background:#120d08;border:1px solid #3a3025;padding:4px;text-align:center"><b style="color:#ffd34d">SPD</b><br/>${rate}/s</span>
      </div>
      ${recipeTip}
    </button>`;
}

export function showLastStandTrove(state: GameStateShape, onChoose: (towerType: TowerType) => void): void {
  closeGameModals();
  document.getElementById('onboarding-overlay')?.remove();
  document.getElementById('first-round-banner')?.remove();
  document.getElementById('pick-keeper-guide')?.remove();
  document.getElementById('last-stand-trove-modal')?.remove();
  if (!document.getElementById('last-stand-trove-style')) {
    const st = document.createElement('style');
    st.id = 'last-stand-trove-style';
    st.textContent = `
      @keyframes lastStandDrop {
        from { opacity:0; transform:translate(-50%, -48%) scale(0.96); }
        to { opacity:1; transform:translate(-50%, -50%) scale(1); }
      }
      .last-stand-choice:hover {
        border-color:#ffd34d !important;
        box-shadow:0 0 18px rgba(255,211,77,0.45), inset 0 0 18px rgba(255,211,77,0.1) !important;
        transform:translateY(-1px);
      }
      .last-stand-choice:focus-visible {
        outline:3px solid #88ddff;
        outline-offset:2px;
      }
      @media (max-width: 760px) {
        #last-stand-trove-grid { grid-template-columns:1fr !important; }
        #last-stand-trove-panel { width:94vw !important; max-height:90vh !important; }
      }
    `;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.id = 'last-stand-trove-modal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.style.cssText = `position:fixed;inset:0;z-index:10000;background:radial-gradient(circle at 50% 35%,rgba(255,211,77,0.18),rgba(0,0,0,0.86) 56%,rgba(0,0,0,0.94));font-family:'Courier New',monospace;color:#fff8e0;`;
  const choices = lastStandTroveChoices();
  root.innerHTML = `
    <div id="last-stand-trove-panel" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(980px,92vw);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#2a1708,#0c0805 44%,#080604);border:4px double #ffd34d;box-shadow:0 0 54px rgba(255,211,77,0.45),inset 0 0 28px rgba(0,0,0,0.8);animation:lastStandDrop 0.22s ease-out;">
      <div style="padding:18px 22px 14px;border-bottom:2px solid #7a5a1a;background:linear-gradient(90deg,#120905,#3a210d,#120905);text-align:center">
        <div style="font-size:11px;letter-spacing:5px;color:#ffcc66;font-weight:bold">CLASSIFIED SENATE NONSENSE</div>
        <div style="margin-top:6px;font-size:25px;line-height:1.15;font-weight:bold;letter-spacing:3px;color:#fff8e0;text-shadow:2px 2px 0 #000,0 0 16px #ffd34d">THE LAST-LIFE TROVE HAS BEEN FOUND</div>
        <div style="margin:10px auto 0;max-width:760px;color:#d8c79a;font-size:12px;line-height:1.55">
          Rome has exactly <b style="color:#ff7766">one life</b>, so a panicked quartermaster has unlocked the emergency broom closet.
          Choose <b style="color:#ffd34d">one free Tier V base tower</b>. It will enter your placement queue. No receipt. No witnesses.
        </div>
      </div>
      <div style="padding:14px 18px;overflow:auto;min-height:0">
        <div id="last-stand-trove-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
          ${choices.map(choice => towerCardHtml(state, choice)).join('')}
        </div>
      </div>
      <div style="padding:10px 16px;border-top:1px solid #5a3a14;color:#aa9a4a;font-size:10px;line-height:1.45;text-align:center;background:#080604">
        Pick carefully: this hidden mercy happens once per run, then the closet returns to pretending it never existed.
      </div>
    </div>`;
  document.body.appendChild(root);
  root.querySelectorAll<HTMLButtonElement>('.last-stand-choice').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const type = btn.dataset.tower as TowerType | undefined;
      if (!type) return;
      root.remove();
      onChoose(type);
    });
  });
}

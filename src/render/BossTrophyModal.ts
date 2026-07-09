import { GameStateShape } from '../GameState';
import { applyBossTrophy, BossTrophyId, bossTrophyOffers } from '../systems/BossTrophySystem';
import { closeGameModals } from './ModalManager';
import { SFX } from './AudioManager';
import { canReceiveRunReward } from '../systems/RewardEligibility';
import { enhanceModalErgonomics } from './ModalErgonomics';

export function showBossTrophyModal(
  parent: HTMLElement,
  state: GameStateShape,
  bossName: string,
  onChoose: (id: BossTrophyId | null) => void
): void {
  if (!canReceiveRunReward(state)) return;
  const offers = bossTrophyOffers(state, 3);
  if (offers.length === 0) return;
  closeGameModals();
  (state as any).__bossTrophyOpen = true;

  const modal = document.createElement('div');
  modal.id = 'boss-trophy-modal';
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.72);z-index:79;padding:16px 8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace;`;
  modal.addEventListener('rtd:modal-force-close', () => {
    (state as any).__bossTrophyOpen = false;
  });

  const panel = document.createElement('div');
  panel.style.cssText = `width:min(820px,95vw);background:linear-gradient(180deg,#25120e,#090706);border:3px solid #ff9c3d;color:#e8d6a8;box-shadow:0 0 38px rgba(255,120,42,0.45);padding:22px;`;
  panel.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;padding-right:76px">
      <div style="font-size:11px;font-weight:bold;letter-spacing:5px;color:#ff9c3d;text-shadow:1px 1px 0 #000">BOSS TROPHY</div>
      <div style="font-size:22px;font-weight:bold;letter-spacing:4px;color:#ffd0a0;text-shadow:2px 2px 0 #000;margin-top:6px">${bossName.toUpperCase()} HAS FALLEN</div>
      <div style="font-size:12px;color:#cdb98a;line-height:1.45;margin-top:8px;letter-spacing:1px">Take one trophy. Collapse or move this panel if you want to see the field first.</div>
    </div>
    <div id="boss-trophy-body" style="overflow:auto;min-height:0">
      <div id="boss-trophy-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px"></div>
    </div>
  `;
  const row = panel.querySelector('#boss-trophy-cards') as HTMLElement;
  const closeWith = (id: BossTrophyId) => {
    applyBossTrophy(state, id);
    modal.remove();
    (state as any).__bossTrophyOpen = false;
    SFX.itemPickup('LEGENDARY');
    onChoose(id);
  };
  const skipTrophy = () => {
    modal.remove();
    (state as any).__bossTrophyOpen = false;
    onChoose(null);
  };
  modal.appendChild(panel);
  enhanceModalErgonomics(modal, panel, {
    bodySelector: '#boss-trophy-body',
    title: 'Boss trophy choice',
    onClose: skipTrophy
  });

  for (const trophy of offers) {
    const card = document.createElement('button');
    card.style.cssText = `display:flex;flex-direction:column;gap:8px;min-height:218px;padding:14px 12px;background:#0c0a08;border:2px solid #ff9c3d;color:#e8d6a8;cursor:pointer;font-family:inherit;text-align:left;transition:transform .08s,filter .1s,box-shadow .12s;`;
    card.innerHTML = `
      <div style="font-size:9px;color:#ffb56b;font-weight:bold;letter-spacing:2px;text-align:center">${trophy.eyebrow}</div>
      <div style="font-size:15px;color:#ffd0a0;font-weight:bold;letter-spacing:1px;line-height:1.15;text-align:center">${trophy.name}</div>
      <div style="font-size:11px;color:#cdb98a;line-height:1.45;text-align:center;min-height:44px">${trophy.blurb}</div>
      <div style="height:1px;background:#5a3422;margin:2px 0"></div>
      ${trophy.effects.map(e => `<div style="font-size:10.5px;color:#fff0b8;line-height:1.35">• ${e}</div>`).join('')}
      <div style="margin-top:auto;text-align:center;font-size:10px;color:#120806;background:#ff9c3d;padding:6px 8px;font-weight:bold;letter-spacing:2px">TAKE TROPHY</div>
    `;
    card.onmouseenter = () => {
      card.style.filter = 'brightness(1.2)';
      card.style.boxShadow = '0 0 20px rgba(255,156,61,0.55)';
      card.style.transform = 'translateY(-2px)';
    };
    card.onmouseleave = () => {
      card.style.filter = 'brightness(1)';
      card.style.boxShadow = '';
      card.style.transform = '';
    };
    card.onclick = () => closeWith(trophy.id);
    row.appendChild(card);
  }

  parent.appendChild(modal);
}

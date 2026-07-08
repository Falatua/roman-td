import { GameStateShape } from '../GameState';
import {
  CampaignRelicId,
  applyCampaignRelic,
  campaignRelicAffordability,
  campaignRelicOffersForWave,
  markCampaignRelicOffered,
  skipCampaignRelic
} from '../systems/CampaignRelicSystem';
import { closeGameModals } from './ModalManager';
import { SFX } from './AudioManager';
import { canReceiveRunReward } from '../systems/RewardEligibility';
import { enhanceModalErgonomics } from './ModalErgonomics';

export function showCampaignRelicModal(
  parent: HTMLElement,
  state: GameStateShape,
  onChoose: (id: CampaignRelicId | null) => void
): void {
  if (!canReceiveRunReward(state)) return;
  closeGameModals();
  (state as any).__campaignRelicOpen = true;
  markCampaignRelicOffered(state);
  const offers = campaignRelicOffersForWave(state);

  const modal = document.createElement('div');
  modal.id = 'campaign-relic-modal';
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.74);z-index:78;padding:16px 8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace;`;
  modal.addEventListener('rtd:modal-force-close', () => {
    (state as any).__campaignRelicOpen = false;
  });

  const panel = document.createElement('div');
  panel.style.cssText = `width:min(980px,96vw);background:linear-gradient(180deg,#241a12,#0b0907);border:3px solid #ffd34d;color:#e8d6a8;box-shadow:0 0 38px rgba(255,211,77,0.42);padding:22px;`;
  panel.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;padding-right:76px">
      <div style="font-size:11px;font-weight:bold;letter-spacing:5px;color:#ffd34d;text-shadow:1px 1px 0 #000">CAMPAIGN RELIC</div>
      <div style="font-size:23px;font-weight:bold;letter-spacing:4px;color:#fff0b8;text-shadow:2px 2px 0 #000;margin-top:6px">THE CAMPAIGN OFFERS A BARGAIN</div>
      <div style="font-size:12px;color:#cdb98a;line-height:1.45;margin-top:8px;letter-spacing:1px">Choose one relic or reject all four. Use the corner controls to collapse or move this panel while you inspect the map.</div>
    </div>
    <div id="campaign-relic-body" style="overflow:auto;min-height:0">
      <div id="campaign-relic-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px"></div>
    </div>
    <div id="campaign-relic-footer" style="display:flex;justify-content:center;margin-top:14px">
      <button id="campaign-relic-skip" style="font-family:inherit;background:#1b1713;border:2px solid #5a4a30;color:#cdb98a;padding:9px 14px;cursor:pointer;font-size:11px;font-weight:bold;letter-spacing:2px">REJECT ALL RELICS</button>
    </div>
  `;
  modal.appendChild(panel);
  enhanceModalErgonomics(modal, panel, {
    bodySelector: '#campaign-relic-body',
    footerSelector: '#campaign-relic-footer',
    title: 'Campaign relic choice'
  });

  const row = panel.querySelector('#campaign-relic-cards') as HTMLElement;
  const closeWith = (id: CampaignRelicId) => {
    if (!applyCampaignRelic(state, id)) return;
    modal.remove();
    (state as any).__campaignRelicOpen = false;
    SFX.combo();
    onChoose(id);
  };
  const reject = panel.querySelector('#campaign-relic-skip') as HTMLButtonElement | null;
  if (reject) {
    reject.onclick = () => {
      skipCampaignRelic(state);
      modal.remove();
      (state as any).__campaignRelicOpen = false;
      SFX.prospectKeep();
      onChoose(null);
    };
  }

  for (const relic of offers) {
    const affordability = campaignRelicAffordability(state, relic.id);
    const card = document.createElement('button');
    card.disabled = !affordability.canAfford;
    card.style.cssText = `display:flex;flex-direction:column;gap:8px;min-height:236px;padding:14px 12px;background:#0c0a08;border:2px solid ${affordability.canAfford ? '#b8943d' : '#5b4030'};color:#e8d6a8;cursor:${affordability.canAfford ? 'pointer' : 'not-allowed'};font-family:inherit;text-align:left;transition:transform .08s,filter .1s,box-shadow .12s;opacity:${affordability.canAfford ? '1' : '0.58'};`;
    const claimText = affordability.canAfford
      ? 'CLAIM'
      : affordability.goldCost > 0
        ? `NEED ${affordability.goldCost} GOLD`
        : `NEED ${affordability.lifeCost + 1} LIVES`;
    card.innerHTML = `
      <div style="font-size:9px;color:#d4af37;font-weight:bold;letter-spacing:2px;text-align:center">${relic.eyebrow}</div>
      <div style="font-size:16px;color:#ffd34d;font-weight:bold;letter-spacing:1px;line-height:1.15;text-align:center">${relic.name}</div>
      <div style="font-size:11px;color:#cdb98a;line-height:1.45;text-align:center;min-height:48px">${relic.blurb}</div>
      <div style="height:1px;background:#5a4a30;margin:2px 0"></div>
      <div style="font-size:10.5px;color:#bbffcc;line-height:1.35"><b>GAIN:</b> ${relic.upside}</div>
      <div style="font-size:10.5px;color:#ffb08a;line-height:1.35"><b>COST:</b> ${relic.caveat}</div>
      <div style="margin-top:auto;text-align:center;font-size:10px;color:#0c0a08;background:${affordability.canAfford ? '#d4af37' : '#9b6d48'};padding:6px 8px;font-weight:bold;letter-spacing:2px">${claimText}</div>
    `;
    card.onmouseenter = () => {
      if (!affordability.canAfford) return;
      card.style.filter = 'brightness(1.2)';
      card.style.boxShadow = '0 0 20px rgba(255,211,77,0.55)';
      card.style.transform = 'translateY(-2px)';
    };
    card.onmouseleave = () => {
      if (!affordability.canAfford) return;
      card.style.filter = 'brightness(1)';
      card.style.boxShadow = '';
      card.style.transform = '';
    };
    card.onclick = () => {
      if (campaignRelicAffordability(state, relic.id).canAfford) closeWith(relic.id);
    };
    row.appendChild(card);
  }

  parent.appendChild(modal);
}

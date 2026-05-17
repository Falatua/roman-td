// SurpriseReward — 2026-05-16 player-choice modal for Invasion + Uprising.
//
// Fires when the last surprise-event enemy resolves (kill or leak).
// Player picks ONE of three offered items from the EXISTING item pool
// (no new content). If their inventory is full, the click awards nothing
// and the modal closes silently — per the design lock ("If their
// inventory is full, they just don't get the item").
//
// Game is paused while this modal is open. main.ts honors
// (state as any).__surpriseRewardOpen and zeroes dt in the tick loop.

import { InventoryState, inventoryAdd } from '../systems/LootSystem';
import { itemIconSvg } from './ItemIcon';
import itemsData from '../data/items_permanent.json';
import { closeGameModals } from './ModalManager';
import { SFX } from './AudioManager';
import { GameStateShape } from '../GameState';

const RARITY_COLOR: Record<string, string> = {
  COMMON: '#cdb98a',
  UNCOMMON: '#7ee07e',
  RARE: '#7ec3ff',
  LEGENDARY: '#ffd34d',
  UNIQUE: '#ff7ee0'
};

// Items eligible to be offered by surprise-event rewards.
// Design lock: REWARDS COME FROM EXISTING ITEMS — no new items invented.
// DoT items remain excluded (Mercator-only, matches grantBonusItem rule).
const DOT_ITEMS = new Set([
  'BARBED_GLADIUS', 'FIRE_OIL_FLASK', 'POISONED_BLADE',
  'FALCATA_BLADE', 'ALPHA_PACK_FANG'
]);

// Build the candidate pool. Surprise events reward RARE-tier or
// UNCOMMON-tier items (no commons — events are too dramatic for a
// junk reward; no legendaries — those stay reserved for boss kills).
function buildRewardPool(): { id: string; rarity: string; def: any }[] {
  const out: { id: string; rarity: string; def: any }[] = [];
  for (const [id, def] of Object.entries(itemsData as any)) {
    const d = def as any;
    if (!d?.rarity) continue;
    if (DOT_ITEMS.has(id)) continue;
    if (d.rarity !== 'RARE' && d.rarity !== 'UNCOMMON') continue;
    out.push({ id, rarity: d.rarity, def: d });
  }
  return out;
}

// Pick 3 distinct items, weighted ~70% RARE / 30% UNCOMMON for a feel
// of "this event paid out something meaningful most of the time."
function pickThreeOffers(): { id: string; rarity: string; def: any }[] {
  const pool = buildRewardPool();
  const rares = pool.filter(p => p.rarity === 'RARE');
  const uncommons = pool.filter(p => p.rarity === 'UNCOMMON');
  const picks: { id: string; rarity: string; def: any }[] = [];
  const seen = new Set<string>();
  while (picks.length < 3) {
    const wantRare = Math.random() < 0.7;
    const src = (wantRare && rares.length > 0) ? rares : (uncommons.length > 0 ? uncommons : rares);
    if (src.length === 0) break;
    const cand = src[Math.floor(Math.random() * src.length)];
    if (seen.has(cand.id)) continue;
    seen.add(cand.id);
    picks.push(cand);
  }
  return picks;
}

export function showSurpriseRewardModal(
  parent: HTMLElement,
  kind: 'INVASION' | 'UPRISING',
  inventory: InventoryState,
  state: GameStateShape,
  onClose: () => void
): void {
  closeGameModals();

  // Pause the game by flipping the shared state flag main.ts watches.
  // Cleared by closeModal() below — guarantees we never leave a stuck pause.
  (state as any).__surpriseRewardOpen = true;

  const offers = pickThreeOffers();
  if (offers.length === 0) {
    // Pool empty for some reason — fail safe, just close and skip reward.
    (state as any).__surpriseRewardOpen = false;
    onClose();
    return;
  }

  const accent = kind === 'INVASION' ? '#ff7733' : '#a050ff';
  const headline = kind === 'INVASION'
    ? 'THE BREACH IS SEALED'
    : 'THE DEAD ARE BANISHED';
  const subline = kind === 'INVASION'
    ? 'Smoke clears over the fallen invaders. Salvage one trophy from the wreckage.'
    : 'The urns crumble back into dust. Claim one relic from the ritual circle.';
  const eyebrow = kind === 'INVASION' ? '⚔ INVASION REPELLED' : '☠ UPRISING QUELLED';

  const modal = document.createElement('div');
  modal.id = 'surprise-reward-modal';
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);z-index:75;font-family:'Courier New',monospace;`;

  const panel = document.createElement('div');
  panel.style.cssText = `width:min(660px,92%);background:linear-gradient(180deg,#241a12,#0c0a08);border:3px solid ${accent};color:#e8d6a8;box-shadow:0 0 36px ${accent}80;padding:22px;`;
  panel.innerHTML = `
    <div style="text-align:center;margin-bottom:14px">
      <div style="font-size:11px;font-weight:bold;letter-spacing:5px;color:${accent};text-shadow:1px 1px 0 #000">${eyebrow}</div>
      <div style="font-size:22px;font-weight:bold;letter-spacing:4px;color:${accent};text-shadow:2px 2px 0 #000;margin-top:6px">${headline}</div>
      <div style="font-size:12px;color:#e8d6a8;line-height:1.5;margin-top:8px;letter-spacing:1px">${subline}</div>
      <div style="font-size:10px;color:#aa9a4a;margin-top:4px;letter-spacing:2px">CHOOSE ONE</div>
    </div>
    <div id="surprise-reward-cards" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div>
    <div style="margin-top:14px;text-align:center;font-size:10px;color:#aa9a4a;letter-spacing:1px;font-style:italic">
      The game is paused. The Senate will wait.
    </div>
  `;
  modal.appendChild(panel);

  const cardsRow = panel.querySelector('#surprise-reward-cards')! as HTMLElement;

  const closeModal = (chosenId: string | null) => {
    modal.remove();
    (state as any).__surpriseRewardOpen = false;
    if (chosenId) {
      const def: any = (itemsData as any)[chosenId];
      const ok = inventoryAdd(inventory, chosenId as any, def?.rarity ?? 'RARE', false);
      if (ok) {
        state.hint = `🎁 ${def?.name ?? chosenId} added to your inventory.`;
        SFX.itemPickup(def?.rarity ?? 'RARE');
      } else {
        // Inventory full — per the design lock, no item granted, no nag.
        state.hint = '⚠ INVENTORY FULL — the reward was forfeited. Sell something first.';
      }
    }
    onClose();
  };

  for (const offer of offers) {
    const card = document.createElement('button');
    const color = RARITY_COLOR[offer.rarity] ?? '#cdb98a';
    card.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 10px;background:#0c0a08;border:2px solid ${color};color:#e8d6a8;cursor:pointer;font-family:inherit;text-align:center;transition:transform 0.08s,filter 0.1s,box-shadow 0.12s;`;
    card.innerHTML = `
      <div>${itemIconSvg(offer.id, offer.rarity, 56)}</div>
      <div style="font-size:13px;font-weight:bold;color:${color};letter-spacing:1px;line-height:1.2">${offer.def.name ?? offer.id}</div>
      <div style="font-size:9px;color:${color};letter-spacing:2px">${offer.rarity}</div>
      <div style="font-size:10.5px;color:#cdb98a;line-height:1.45;min-height:48px">${offer.def.effect ?? ''}</div>
    `;
    card.onmouseenter = () => {
      card.style.filter = 'brightness(1.25)';
      card.style.boxShadow = `0 0 18px ${color}aa`;
      card.style.transform = 'translateY(-2px)';
    };
    card.onmouseleave = () => {
      card.style.filter = 'brightness(1)';
      card.style.boxShadow = '';
      card.style.transform = '';
    };
    card.onclick = () => closeModal(offer.id);
    cardsRow.appendChild(card);
  }

  parent.appendChild(modal);
}

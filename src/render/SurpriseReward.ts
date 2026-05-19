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

// 2026-05-18 — EVENT-EXCLUSIVE REWARD POOLS. Each of the three surprise
// events has its own pool of 3 LEGENDARY items that ONLY drop from
// that event. The player picks one of the three at the end-of-event
// reward modal. Items are tagged with `eventExclusive` in
// items_permanent.json so the shop / Mercator / generic free-grant
// pools all skip them (kept exclusive to event rewards).
const EVENT_REWARD_POOL: Record<'INVASION' | 'UPRISING' | 'GATES_OF_HELL', string[]> = {
  INVASION:      ['VANGUARD_PILUM', 'AQUILA_RAMPART', 'PERIMETER_TORCH'],
  UPRISING:      ['GRAVEKEEPERS_SCYTHE', 'SOULFIRE_BRAND', 'NECROMANCERS_LANTERN'],
  GATES_OF_HELL: ['HELLGATE_BRAND', 'DEMONSWORN_CROWN', 'INFERNO_STANDARD'],
};

// Build the 3-item offer for a given event kind. Always returns 3
// distinct legendaries from that event's exclusive pool (each pool
// has exactly 3 entries, so no random rolling — the player sees the
// same three picks every time, but choosing ONE makes the run feel
// shaped by which legendary they took for that event).
function pickEventOffers(kind: 'INVASION' | 'UPRISING' | 'GATES_OF_HELL'): { id: string; rarity: string; def: any }[] {
  const ids = EVENT_REWARD_POOL[kind] ?? [];
  const out: { id: string; rarity: string; def: any }[] = [];
  for (const id of ids) {
    const def: any = (itemsData as any)[id];
    if (!def) continue;
    out.push({ id, rarity: def.rarity ?? 'LEGENDARY', def });
  }
  return out;
}

export function showSurpriseRewardModal(
  parent: HTMLElement,
  kind: 'INVASION' | 'UPRISING' | 'GATES_OF_HELL',
  inventory: InventoryState,
  state: GameStateShape,
  onClose: () => void
): void {
  closeGameModals();

  // Pause the game by flipping the shared state flag main.ts watches.
  // Cleared by closeModal() below — guarantees we never leave a stuck pause.
  (state as any).__surpriseRewardOpen = true;

  // 2026-05-18 — Every event offers a 3-card pick from its own
  // event-exclusive legendary pool. Items in the pool can ONLY be
  // obtained from this event — they're locked out of the shop, the
  // Mercator, free-grants, and boss drops by the `eventExclusive`
  // flag in items_permanent.json. Player chooses ONE; the other two
  // are dropped (can come back next time this event fires in
  // endless mode, but only one copy per event resolution).
  const offers = pickEventOffers(kind);
  if (offers.length === 0) {
    // Pool empty for some reason — fail safe, just close and skip reward.
    (state as any).__surpriseRewardOpen = false;
    onClose();
    return;
  }

  // 2026-05-17 — Accomplishment-flavored copy. The reward fires AFTER the
  // entire wave is over (all enemies killed or leaked, player still alive),
  // so the framing leans into "you survived a true ordeal" rather than the
  // older "the breach is sealed mid-wave." Style matches the rest of the
  // game's voice (Roman, slightly grim, the Senate is watching).
  const accent = kind === 'INVASION' ? '#ff7733'
               : kind === 'UPRISING' ? '#a050ff'
               : '#ff4422';                          // GATES_OF_HELL hellfire red
  const headline = kind === 'INVASION'
    ? 'YOU SURVIVED THE INVASION'
    : kind === 'UPRISING'
      ? 'YOU SURVIVED THE UPRISING'
      : 'YOU SHUT THE GATES OF HELL';
  const subline = kind === 'INVASION'
    ? 'The perimeter held. Three legendaries recovered from the wreckage — only one can be carried. The other two stay buried under the breach. Choose carefully.'
    : kind === 'UPRISING'
      ? 'The ground falls silent. Three relics surface from the ritual circle — only one will come with you. Necromancy made these; turn them on what made them.'
      : 'The fires die down. Three trophies forged in the gates themselves — only one fits the player who survived this. The others sink back into the pit.';
  const eyebrow = kind === 'INVASION'
    ? '⚔ ACCOMPLISHMENT — INVASION REPELLED'
    : kind === 'UPRISING'
      ? '☠ ACCOMPLISHMENT — UPRISING QUELLED'
      : '🔥 ACCOMPLISHMENT — GATES SEALED';

  const modal = document.createElement('div');
  modal.id = 'surprise-reward-modal';
  // 2026-05-19 — Responsive clamping (Codex pattern).
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.7);z-index:75;padding:16px 8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace;`;

  const panel = document.createElement('div');
  panel.style.cssText = `width:min(660px,94vw);background:linear-gradient(180deg,#241a12,#0c0a08);border:3px solid ${accent};color:#e8d6a8;box-shadow:0 0 36px ${accent}80;padding:22px;`;
  panel.innerHTML = `
    <div style="text-align:center;margin-bottom:14px">
      <div style="font-size:11px;font-weight:bold;letter-spacing:5px;color:${accent};text-shadow:1px 1px 0 #000">${eyebrow}</div>
      <div style="font-size:22px;font-weight:bold;letter-spacing:4px;color:${accent};text-shadow:2px 2px 0 #000;margin-top:6px">${headline}</div>
      <div style="font-size:12px;color:#e8d6a8;line-height:1.5;margin-top:8px;letter-spacing:1px">${subline}</div>
      <div style="font-size:10px;color:#aa9a4a;margin-top:4px;letter-spacing:2px">CHOOSE ONE LEGENDARY</div>
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

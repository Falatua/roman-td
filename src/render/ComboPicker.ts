import { AvailableCombo, comboResultLocationChoices } from '../systems/CombinationEngine';
import { GameStateShape } from '../GameState';
import towersData from '../data/towers.json';
import { TIER_COLORS } from '../constants';
import { closeGameModals } from './ModalManager';
import { markScrollable } from './ScrollCues';
import { enhanceModalErgonomics } from './ModalErgonomics';

export interface ComboPickerHooks {
  onPick: (combo: AvailableCombo, resultTileTowerId: string) => void;
  onClose: () => void;
}

// Player-facing combination chooser. Replaces the old auto-execute behavior.
// Shows every available recipe (including same-tier merges) as a card; player
// clicks the card they want and we run that specific combo.
export function showComboPicker(parent: HTMLElement, combos: AvailableCombo[], state: GameStateShape, hooks: ComboPickerHooks) {
  closeGameModals();
  const modal = document.createElement('div');
  modal.id = 'combo-picker';
  // 2026-05-19 — Responsive clamping (Codex pattern). Modal scrolls
  // top-anchored; panel has no max-height so all combo rows stay
  // reachable regardless of viewport height.
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.55);z-index:50;padding:16px 8px;box-sizing:border-box;overflow:auto;`;
  const panel = document.createElement('div');
  panel.style.cssText = `background:#1a1410;border:3px solid #d4af37;color:#e8d6a8;padding:14px;width:min(560px,96vw);font-family:'Courier New',monospace;`;
  panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <h2 style="margin:0;color:#d4af37;letter-spacing:2px">⚔ COMBINATIONS AVAILABLE</h2>
    <button id="combo-close" style="background:#3a1a1a;color:#e8d6a8;border:1px solid #5a3a30;padding:4px 10px;cursor:pointer;font-family:inherit">CLOSE</button>
  </div>
  <div style="font-size:11px;opacity:0.75;margin-bottom:10px">Pick a recipe, then choose which valid ingredient tile becomes the new tower. The other required ingredient tiles become wall stones (your maze stays intact).</div>`;

  const list = document.createElement('div');
  list.id = 'combo-picker-list';
  list.style.cssText = `display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0;`;

  // Sort: recipe combos first by result tier desc, then same-tier merges
  const sorted = [...combos].sort((a, b) => {
    if (!!a.isSameTierMerge !== !!b.isSameTierMerge) return a.isSameTierMerge ? 1 : -1;
    return b.resultTier - a.resultTier;
  });

  for (const cb of sorted) {
    const resultDef: any = (towersData as any)[cb.result];
    const card = document.createElement('div');
    const tierColor = '#' + ((TIER_COLORS[cb.resultTier] ?? 0xffffff)).toString(16).padStart(6, '0');
    const isMerge = !!cb.isSameTierMerge;
    card.style.cssText = `border:2px solid ${tierColor};padding:8px 10px;background:#0c0a08;cursor:pointer;display:flex;flex-direction:column;gap:4px;transition:background 0.1s;`;
    card.onmouseenter = () => { card.style.background = '#1d1714'; };
    card.onmouseleave = () => { card.style.background = '#0c0a08'; };

    const headLabel = isMerge
      ? `MERGE → ${resultDef?.name ?? cb.result} <span style="color:${tierColor}">T${cb.resultTier}</span>`
      : `${resultDef?.name ?? cb.result} <span style="color:${tierColor}">T${cb.resultTier}</span>`;
    const head = document.createElement('div');
    head.style.cssText = `display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:bold;`;
    head.innerHTML = `<span>${headLabel}</span><span style="color:#f0c040">${cb.cost}g</span>`;
    card.appendChild(head);

    if (resultDef?.ability) {
      const abil = document.createElement('div');
      abil.style.cssText = `font-size:11px;opacity:0.85;color:#cdb887`;
      abil.textContent = resultDef.ability;
      card.appendChild(abil);
    }

    const canAfford = state.gold >= cb.cost;

    const ingredientsHint = document.createElement('div');
    ingredientsHint.style.cssText = `font-size:10px;opacity:0.7;margin-top:2px;color:#cdb887`;
    ingredientsHint.textContent = `Result location — choose which valid ingredient tile becomes the new tower:`;
    card.appendChild(ingredientsHint);

    const ingredients = document.createElement('div');
    ingredients.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;margin-top:4px`;
    const locationChoices = comboResultLocationChoices(state, cb).filter(t => !t.pending);
    const chips = locationChoices.length > 0 ? locationChoices : cb.ingredients;
    for (const ing of chips) {
      const def: any = (towersData as any)[ing.type];
      const chip = document.createElement('button');
      const ingTierColor = '#' + ((TIER_COLORS[ing.qualityTier] ?? 0xffffff)).toString(16).padStart(6, '0');
      chip.style.cssText = `font-family:'Courier New',monospace;font-size:10px;border:1px solid ${ingTierColor};padding:4px 8px;background:#1a1410;color:${ingTierColor};cursor:${canAfford ? 'pointer' : 'not-allowed'};transition:background 0.1s`;
      chip.innerHTML = `${def?.name ?? ing.type} T${ing.qualityTier} <span style="opacity:0.7">@ (${ing.tileX},${ing.tileY})</span>`;
      chip.onmouseenter = () => { if (canAfford) chip.style.background = '#2a1f12'; };
      chip.onmouseleave = () => { chip.style.background = '#1a1410'; };
      chip.onclick = (e) => {
        e.stopPropagation();
        if (!canAfford) {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
          const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
          const ay = stageRect ? r.top - stageRect.top : undefined;
          (window as any).__showInsufficientGoldToast?.(cb.cost, ax, ay);
          return;
        }
        hooks.onPick(cb, ing.id);
        modal.remove();
      };
      ingredients.appendChild(chip);
    }
    card.appendChild(ingredients);

    if (!canAfford) {
      card.style.opacity = '0.45';
      const warn = document.createElement('div');
      warn.style.cssText = `font-size:10px;color:#cc6666;font-weight:bold`;
      warn.textContent = `NEED ${cb.cost - state.gold}g MORE`;
      card.appendChild(warn);
    }
    list.appendChild(card);
  }

  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = `padding:18px;text-align:center;opacity:0.65;font-size:12px`;
    empty.textContent = 'No combinations available right now. Roll more towers, merge same-tier triples, or build the missing ingredient.';
    list.appendChild(empty);
  }

  panel.appendChild(list);
  modal.appendChild(panel);
  parent.appendChild(modal);
  enhanceModalErgonomics(modal, panel, {
    bodySelector: '#combo-picker-list',
    title: 'Combination picker'
  });
  // Scroll cues on the modal (the actual scroll container).
  markScrollable(modal);

  panel.querySelector<HTMLButtonElement>('#combo-close')!.onclick = () => { modal.remove(); hooks.onClose(); };
  modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); hooks.onClose(); } });
}

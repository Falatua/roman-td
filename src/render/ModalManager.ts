const GAME_MODAL_IDS = [
  'shop-modal',
  'inventory-modal',
  'codex-modal',
  'tower-menu',
  'stone-menu',
  'enemy-inspect',
  'combo-picker',
  'tower-leaderboard',
  // 2026-05-15: settings + DPS summary were added recently but weren't
  // tracked here, so opening another modal while either was visible left
  // them stacked. Register both so closeGameModals() sweeps them out
  // uniformly with every other game modal.
  'settings-modal',
  'dps-check-summary'
];

export function closeGameModals() {
  for (const id of GAME_MODAL_IDS) document.getElementById(id)?.remove();
}

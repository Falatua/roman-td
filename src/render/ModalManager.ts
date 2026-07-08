const GAME_MODAL_IDS = [
  'shop-modal',
  'inventory-modal',
  'codex-modal',
  'tower-menu',
  'stone-menu',
  'enemy-inspect',
  'combo-picker',
  'combo-info-modal',
  'tower-leaderboard',
  'quests-modal',
  // 2026-05-15: settings + DPS summary were added recently but weren't
  // tracked here, so opening another modal while either was visible left
  // them stacked. Register both so closeGameModals() sweeps them out
  // uniformly with every other game modal.
  'settings-modal',
  'dps-check-summary',
  'campaign-relic-modal',
  'boss-trophy-modal',
  'test-your-might-modal',
  'mercator-backroom-modal',
  'last-stand-trove-modal',
  'harbor-unlock-modal',
  'harbor-draft-modal',
  'surprise-reward-modal',
  'sandbox-wave-picker',
  'sandbox-tower-picker',
  'sandbox-password-modal'
];

export function closeGameModals() {
  for (const id of GAME_MODAL_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.dispatchEvent(new CustomEvent('rtd:modal-force-close'));
    el.remove();
  }
}

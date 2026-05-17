# Relevant Files Map

This map is ordered for a new Claude Code session: start at the top, then move downward as needed.

## 1. Start Here

- `CLAUDE_CODE_HANDOFF.md` - current product/design/engineering context.
- `HANDOFF_FILE_INDEX_NEWEST_TO_OLDEST.md` - exact file modification order, newest first.
- `package.json` - scripts and dependencies.
- `index.html` - page shell, loading screen, frame layout.
- `src/main.ts` - boot, game loop, input handling, UI callback wiring.

## 2. Current Gameplay Logic

- `src/systems/WaveManager.ts` - wave start/end, spawn queue, HP scaling.
- `src/systems/EnemySystem.ts` - enemy movement, leaks, status ticking.
- `src/systems/CombatResolver.ts` - target selection, damage, on-hit effects, item combat effects.
- `src/systems/ProjectileSystem.ts` - projectile profiles and impact routing.
- `src/systems/CombinationEngine.ts` - same-tier merges and named tower combinations.
- `src/systems/TowerSystem.ts` - tower creation, draw pool, effective stats.
- `src/systems/PathFinder.ts` - checkpoint pathing and build validation.
- `src/systems/GridManager.ts` - tile initialization and tile helpers.

## 3. Recent Strategy Systems

- `src/systems/EnemyResistances.ts` - enemy-specific melee/ranged/slow/burn/bleed/poison resistance.
- `src/systems/ItemRules.ts` - item family exclusivity per tower.
- `src/systems/LootSystem.ts` - item drops, inventory, boss drops.
- `src/systems/MerchantSystem.ts` - gate shop and Mercator item tables.
- `src/systems/DamageTypeSystem.ts` - faction resistance table lookup.
- `src/systems/EconomySystem.ts` - gold, pool upgrade costs, hero/effective pool.

## 4. UI To Know

- `src/render/UIManager.ts` - HUD, bottom buttons, next-wave preview.
- `src/render/TowerMenu.ts` - tower inspect/sell/target/equip/recipe UI.
- `src/render/Codex.ts` - detailed manual tabs, including the updated combinations section.
- `src/render/ShopUI.ts` - shop and 5x5 inventory modal.
- `src/render/ModalManager.ts` - one-window-at-a-time modal behavior.
- `src/render/EnemyInspect.ts` - enemy inspection, traits, resistances.
- `src/render/StoneMenu.ts` - maze stone inspect/sell UI.
- `src/render/RenderEngine.ts` - Pixi rendering for map, towers, enemies, VFX, range rings.
- `src/render/Assets.ts` - sprite key map.

## 5. Data Files

- `src/data/towerCombinations.json` - named combo recipes and required tiers.
- `src/data/towers.json` - all tower stats and descriptions.
- `src/data/enemies.json` - enemy definitions and traits.
- `src/data/waves.json` - 50-wave schedule.
- `src/data/items_permanent.json` - permanent item definitions.
- `src/data/items_consumable.json` - consumable item definitions.
- `src/data/factionResistances.json` - faction-level damage modifiers.
- `src/data/waypoints.json` - square Gem TD-style map checkpoints.

## 6. Assets

- `public/assets/sprites/` - all tower, enemy, item, UI, projectile, status, map sprites.
- `public/assets/loading/roman-loading-room.svg` - loading screen art.
- `scripts/slice-sprites.mjs` - sprite sheet helper.

## 7. Files Usually Safe To Ignore First

- `dist/` - generated build output, not included in the organized transfer archive.
- `node_modules/` - dependencies, not included in the organized transfer archive.
- `.DS_Store` - ignored/excluded from the transfer archive.

## 8. Most Recent Development Areas

Newest work has mostly touched:

- Codex clarity, especially combination recipe display.
- Combination recipe tier requirements.
- Modal/window stacking behavior.
- Tower inventory slot presentation.
- Wave-end rule.
- Square Gem TD-style map/checkpoint layout.
- Enemy resistances and item family restrictions.

When continuing development, begin with `CLAUDE_CODE_HANDOFF.md`, then inspect `src/main.ts`, `src/render/Codex.ts`, `src/data/towerCombinations.json`, and whichever system matches the requested change.

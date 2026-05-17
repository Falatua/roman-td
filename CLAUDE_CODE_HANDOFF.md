# Roman TD / Gem TD Handoff For Claude Code

## Project

Project folder:

`/Users/redsky/Desktop/Rome TD VF/roman-td`

Local browser URL:

`http://127.0.0.1:5175/`

Stack:

- Vite
- TypeScript
- PixiJS 7
- Howler
- Static JSON data files for towers, enemies, waves, recipes, items, and map checkpoints

Commands:

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5175
npm run build
```

The production build currently passes with `npm run build`.

## High-Level Game

This is a Roman-themed Gem TD-style browser tower defense game.

Core loop:

1. Player reveals up to 5 prospect towers during pre-wave placement.
2. Player keeps one prospect; unkept prospects become maze stones.
3. Player can build stones, buy/equip items, upgrade pool, inspect towers, inspect stones, open Codex, and combine towers before waves.
4. Player can start a wave early during the prospect/pre-wave stage.
5. A wave does not resolve until all spawned mobs are either killed or reach the gate of Rome.
6. After the wave resolves, build/prospect phase resumes.

Important design direction from the user:

- The game should feel closer to Warcraft 3 / Blizzard Gem TD.
- The map should use a square arena with checkpoints.
- Player should have freedom to spend starting gold on pool upgrades, stones, items, or towers.
- Tower and item identity should be strategic and legible.
- UI should give clear information without stacking multiple windows.

## Recent User-Facing Changes Already Implemented

### Wave and Enemy Rules

- Waves have 30 regular enemies, bosses are additional.
- Enemies spawn at 1-second intervals.
- Mobs become considerably harder after wave 5.
- Additional HP scaling happens every 10 waves.
- The wave now only ends when the spawn queue is empty and `state.enemies.size === 0`.
- Melee towers cannot hit flyers, even with items.
- Flyers, boss waves, and the final boss have warning banners before the next wave.
- Wave 50 final boss warning is more dramatic.

### Enemy Resistances

Specific enemy/boss resistances live in:

`src/systems/EnemyResistances.ts`

Supported resistance categories:

- melee
- ranged
- slow
- burn
- bleed
- poison

These are layered on top of faction-level damage modifiers in:

`src/data/factionResistances.json`

Damage integration:

- `src/systems/CombatResolver.ts`
- `enemyDamageMultiplier(...)`

Status integration:

- `src/systems/EnemySystem.ts`
- `statusEffectiveness(...)`

Bleed is now a real status:

- enum in `src/types.ts`
- ticking in `src/systems/EnemySystem.ts`
- on-hit item application in `src/systems/CombatResolver.ts`
- VFX/status color in `src/systems/GoreSystem.ts` and `src/render/RenderEngine.ts`

### Items and Inventory

Inventory:

- Bottom inventory button opens a 5x5 item grid.
- Inventory size is `25` in `src/constants.ts`.
- Drops visually flash the inventory button.

Item mutual exclusivity:

- Implemented in `src/systems/ItemRules.ts`.
- Towers cannot equip the same item twice.
- Towers cannot equip more than one non-special item from the same item family.
- Families include `DAMAGE`, `SPEED`, `RANGE`, `DOT`, `AURA`, `ECONOMY`, `DEFENSE`, and `SPECIAL`.

Tower menu item UI:

- `src/render/TowerMenu.ts`
- Equipped tower items now display as square inventory-style slots.
- Equip-from-inventory also uses compact square cells.
- Pending prospect towers cannot equip items until the player keeps them.

Loot and shop tables:

- Random drops: `src/systems/LootSystem.ts`
- Gate/Mercator shop tables: `src/systems/MerchantSystem.ts`
- Permanent item definitions: `src/data/items_permanent.json`
- Consumables: `src/data/items_consumable.json`

### Map / Gem TD Shape

Map data lives in:

`src/data/waypoints.json`

Current board:

- Square `22 x 22` grid.
- Spawn at top-left.
- Gate at bottom-right.
- 5 checkpoints in a Gem TD-inspired route.

Grid constants:

`src/constants.ts`

```ts
GRID.COLS = 22
GRID.ROWS = 22
GRID.TILE = 32
```

Pathfinding:

- `src/systems/PathFinder.ts`
- A* routes spawn -> checkpoint 1 -> ... -> checkpoint 5 -> gate.
- Stones and towers can reshape the ground path but cannot fully block checkpoint reachability.

Rendering:

- `src/render/RenderEngine.ts`
- Cave, gate, checkpoint effects are data-driven from `waypoints.json`.

### Tower Combinations

Recipe data:

`src/data/towerCombinations.json`

Combination logic:

`src/systems/CombinationEngine.ts`

Codex combination display:

`src/render/Codex.ts`

Recent correction:

- Late-game recipes no longer use misleading Tier 1+ combo tower requirements.
- Example: God of War now requires:
  - Julius Caesar Tier 5+
  - Cohort Guard Tier 4+
  - Inferno Cart Tier 4+

Codex combination cards now show:

- ingredient tower sprite
- ingredient name
- required tier in plain text
- ingredient damage type/kind
- result tower sprite
- result name
- result tier
- gold cost
- result ability

### Codex

Codex file:

`src/render/Codex.ts`

Current tabs:

- SYSTEMS
- POOL
- LEGIONS
- COMBINATIONS
- ENEMIES
- ITEMS
- WAVES

The Codex is intended to be a strategy manual, not just a database dump.

### Modal / UI Window Handling

Only one modal/window should be open at a time.

Central helper:

`src/render/ModalManager.ts`

Used by:

- `ShopUI.ts`
- `TowerMenu.ts`
- `Codex.ts`
- `StoneMenu.ts`
- `EnemyInspect.ts`

Removed:

- Redo button from bottom UI.

Undo still exists for build/pre-wave actions.

## Key Files

Core:

- `src/main.ts` - app boot, game loop, input handling, UI callbacks.
- `src/types.ts` - shared enums/interfaces.
- `src/constants.ts` - all main tunable values.
- `src/GameState.ts` - game state shape and initialization.

Systems:

- `src/systems/WaveManager.ts` - wave start, spawn schedule, HP scaling, wave-end condition.
- `src/systems/EnemySystem.ts` - spawn/move/tick enemies.
- `src/systems/CombatResolver.ts` - tower targeting, damage, on-hit status, kill bonus.
- `src/systems/ProjectileSystem.ts` - projectile profiles and movement.
- `src/systems/TowerSystem.ts` - tower creation, draw pool, effective stats.
- `src/systems/CombinationEngine.ts` - same-tier merge and recipe combos.
- `src/systems/LootSystem.ts` - inventory, loot rolls, boss drops.
- `src/systems/MerchantSystem.ts` - gate shop and Mercator shop.
- `src/systems/ItemRules.ts` - item family exclusivity.
- `src/systems/EnemyResistances.ts` - enemy-specific resist profiles.
- `src/systems/PathFinder.ts` - A* and route validation.
- `src/systems/GridManager.ts` - tile setup and helpers.
- `src/systems/BossScripts.ts` - special boss behavior.
- `src/systems/DamageTypeSystem.ts` - faction resist modifiers.
- `src/systems/DowngradeSystem.ts` - tower downgrade.
- `src/systems/EconomySystem.ts` - gold/pool/hero economy.
- `src/systems/GoreSystem.ts` - hit/death/status visual particles.

Rendering/UI:

- `src/render/RenderEngine.ts` - Pixi rendering.
- `src/render/UIManager.ts` - HUD and bottom controls.
- `src/render/TowerMenu.ts` - tower detail/sell/target/equip menu.
- `src/render/ShopUI.ts` - shop + inventory modal.
- `src/render/Codex.ts` - detailed manual.
- `src/render/EnemyInspect.ts` - enemy stat/resistance inspect.
- `src/render/StoneMenu.ts` - stone sell/detail UI.
- `src/render/EndScreens.ts` - victory/defeat screens.
- `src/render/Assets.ts` - asset keys.
- `src/render/AudioManager.ts` - sound.
- `src/render/ModalManager.ts` - closes existing modals before opening another.

Data:

- `src/data/towers.json`
- `src/data/enemies.json`
- `src/data/waves.json`
- `src/data/towerCombinations.json`
- `src/data/items_permanent.json`
- `src/data/items_consumable.json`
- `src/data/factionResistances.json`
- `src/data/waypoints.json`

Assets:

- `public/assets/sprites/*`
- `public/assets/loading/roman-loading-room.svg`

## Current Known Design Decisions

- Tower tier roll probabilities are controlled by `POOL_PROBABILITIES`.
- Pool upgrade costs double: `[3, 6, 12, 24, 48]`.
- Effective pool level is `max(poolLevel, heroLevel)`.
- Kill bonus grows very slowly and caps at +10%.
- T5 remains rare: max pool still only gives 8% T5 chance.
- Same-tier merge: 3 identical towers of same tier become next tier.
- Cross-unit recipe combos use `minTier` requirements in `towerCombinations.json`.
- Pending prospects are intentionally non-combat and cannot equip items.
- Starting Denarii is set to 4 in `src/main.ts`, overriding `ECONOMY.STARTING_DENARII`.

## Important Current Behavior To Preserve

- Start wave button is allowed before all prospects are placed.
- If wave starts with pending prospects, they are crystallized/converted by existing flow.
- Next build phase should not begin while enemies are still walking.
- Melee towers must never target flyers.
- Only one modal window should be open at once.
- Sell buttons belong inside tower/stone UI, not bottom UI.
- Cycle target is inside tower UI, not bottom UI.
- Crystallize button has been removed.
- Redo button has been removed.

## Good Next Improvements

Potential next steps the user may ask for:

- Better visual clarity for route/checkpoint path in the square Gem TD map.
- More tutorialization inside Codex for same-tier merge vs named combinations.
- Balance pass on the stricter late-game combination recipes.
- More item icons in tower inventory cells instead of initials.
- Save/load progression.
- More specific enemy warning panels before resist-heavy waves.
- Better support for choosing which available combination to execute, instead of auto-combining the highest-tier available recipe.

## Verification

Last verified:

```bash
npm run build
```

The build passed.

Browser smoke checks were done against:

`http://127.0.0.1:5175/`

No console errors were observed after the latest Codex combination changes.

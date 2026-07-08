import towers from '../data/towers.json';
import enemies from '../data/enemies.json';
import combos from '../data/towerCombinations.json';
// 2026-05-19 — Hero definitions for the HEROES Codex tab.
import heroDefs from '../data/herodefs.json';
import { QUESTS } from '../systems/QuestSystem';
import permItems from '../data/items_permanent.json';
import consumables from '../data/items_consumable.json';
import waves from '../data/waves.json';
import factionRes from '../data/factionResistances.json';
import { POOL_PROBABILITIES, ECONOMY, HERO_XP_THRESHOLDS } from '../constants';
import { tex } from './Assets';
import { closeGameModals } from './ModalManager';
import { itemFamily } from '../systems/ItemRules';
import { resistanceSummary, armorProfile, armorDamageTypeShortLabel } from '../systems/EnemyResistances';
import { markScrollable } from './ScrollCues';
import { enhanceModalErgonomics } from './ModalErgonomics';
import { togglePinnedRecipe, getPinnedRecipes, MAX_PINNED_RECIPES } from './PinnedRecipe';
import { damageTypeLabel, factionName, pretty } from '../format';
import { previewSpawnHp } from '../systems/WaveManager';
import { itemBuyPrice, signatureLegendaryForBoss } from '../systems/LootSystem';
import { FORTUNA_GAMBLE_COST } from '../systems/MerchantSystem';

function spriteImg(key: string, size = 28): string {
  const t = tex(key);
  // Pixi exposes the image URL under different fields depending on the
  // loader path (`resource.src`, `resource.url`, or the `__srcPath` stash
  // Assets.ts attaches at load time). Check all three so newly-added
  // sprites render here the same way they do in the Mercator / shop UI.
  const res: any = t?.baseTexture?.resource;
  const src = res?.src ?? res?.url ?? (t as any)?.__srcPath ?? null;
  if (src) return `<img src="${src}" style="width:${size}px;height:${size}px;image-rendering:pixelated;vertical-align:middle">`;
  // Fallback: tier-colored monogram badge for any tower whose sprite isn't
  // yet wired into the manifest. Every shipped tower currently has art —
  // this stays as a safety net for future additions.
  const def: any = (towers as any)[key];
  if (def) {
    const tier = def.tierBand ?? (def.kind === 'COMBO' ? 5 : 1);
    const TIER_HEX = ['#aaaaaa','#b87333','#c0c0c0','#ffd34d','#ff5050'];
    const color = TIER_HEX[Math.max(0, Math.min(4, tier - 1))];
    const letter = (def.name ?? key).split(/[\s_]/)[0].charAt(0).toUpperCase();
    const fontSize = Math.max(10, Math.floor(size * 0.55));
    return `<span style="display:inline-flex;width:${size}px;height:${size}px;align-items:center;justify-content:center;background:#1a1410;border:2px solid ${color};color:${color};font-weight:bold;font-size:${fontSize}px;font-family:'Courier New',monospace;vertical-align:middle">${letter}</span>`;
  }
  return `<span style="display:inline-block;width:${size}px;height:${size}px"></span>`;
}

const RAR: Record<string, string> = { COMMON: '#cccccc', UNCOMMON: '#5cd05c', RARE: '#5ca0ff', EPIC: '#a060ff', LEGENDARY: '#ff9933', UNIQUE: '#ffd34d' };

interface CodexCtx {
  poolLevel: number; heroLevel: number; totalKills: number;
  // Live tower inventory snapshot — used by COMBINATIONS tab to color-code
  // each recipe by readiness (green = can build now, yellow = partial,
  // gray = no ingredients owned). Optional so the codex still renders if
  // the caller doesn't pass it.
  towers?: Array<{ type: string; qualityTier: number; pending: boolean }>;
  // Completed quest ids from state.completedQuests. Used by the QUESTS tab
  // to stamp a green ✓ next to finished objectives so players can see
  // their progress at a glance without leaving the codex.
  completedQuests?: string[];
}
let lastCtx: CodexCtx = { poolLevel: 0, heroLevel: 0, totalKills: 0 };

// 2026-05-24 — Module-scoped active-tab memory so reopening the Codex
// drops the player back onto the tab they were last reading instead of
// resetting to SYSTEMS every time.
type CodexTab = 'SYSTEMS' | 'MECHANICS' | 'QUESTS' | 'POOL' | 'LEGIONS' | 'COMBINATIONS' | 'ENEMIES' | 'ITEMS' | 'HEROES';
let lastActiveCodexTab: CodexTab = 'SYSTEMS';

export function showCodex(parent: HTMLElement, ctx?: CodexCtx) {
  if (ctx) lastCtx = ctx;
  closeGameModals();
  const modal = document.createElement('div');
  modal.id = 'codex-modal';
  // 2026-05-18 v2 — RESPONSIVE CLAMPING. The modal scrolls vertically
  // and aligns from the top of the viewport so an enlarged panel can
  // never push its tabs / close button above the top edge regardless
  // of viewport height (fullscreen vs windowed, mobile orientation
  // changes, devtools open, etc.). align-items:flex-start anchors
  // the top; padding clamps a small breathing strip from the top
  // edge; overflow:auto on the modal lets the user scroll the
  // whole modal if the panel is taller than the viewport — even
  // when the panel itself has overflow set.
  modal.style.cssText = `position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.6);z-index:100000;pointer-events:auto;padding:16px 8px;box-sizing:border-box;overflow:auto;`;
  const panel = document.createElement('div');
  // 2026-05-18 — Codex window enlarged so the dense per-tab tables
  // (Items, Enemies, Combinations) have more horizontal breathing room
  // and the player can scan rows without horizontal cramping. Width
  // bumped from 720px → 1040px (clamped to 96vw). max-height removed
  // in favor of letting the MODAL scroll (responsive clamping above)
  // — that way the codex top tabs are always reachable even when
  // the viewport is very short.
  panel.style.cssText = `background:#1a1410;border:3px solid #d4af37;color:#e8d6a8;padding:18px;width:min(1040px,96vw);font-family:'Courier New',monospace;font-size:12px;box-shadow:0 0 28px rgba(212,175,55,0.35);`;
  panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <h2 style="margin:0;color:#d4af37;letter-spacing:3px">LEGION CODEX</h2>
    <button id="codex-close" style="background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:6px 12px;cursor:pointer;font-family:inherit">CLOSE</button>
  </div>
  <div id="codex-tabs" style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;position:sticky;top:0;background:#1a1410;padding:4px 0;z-index:5;border-bottom:1px solid #3a3025"></div>
  <input id="codex-search" type="text" placeholder="🔍 Filter cards in this tab..." style="width:100%;box-sizing:border-box;padding:6px 10px;margin-bottom:8px;background:#0c0a08;border:1px solid #5a4a30;color:#e8d6a8;font-family:'Courier New',monospace;font-size:11px;letter-spacing:1px;outline:none;"/>
  <div id="codex-body" style="padding-top:6px"></div>
  <div id="codex-footer" style="display:flex;justify-content:center;margin-top:12px;padding-top:10px;border-top:1px solid #3a3025">
    <button id="codex-close-bottom" style="background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:8px 18px;cursor:pointer;font-family:inherit;letter-spacing:2px">CLOSE</button>
  </div>`;
  modal.appendChild(panel);
  (document.body ?? parent).appendChild(modal);

  // 2026-05-17 — WAVES tab removed per design feedback. The per-wave
  // spawn table duplicated info already in the pre-wave brief + ENEMIES
  // tab without adding actionable detail, and it spoiled the upcoming
  // wave composition that the pre-wave tip is calibrated to reveal in
  // a more readable form. The renderTab('WAVES') branch below is now
  // dead code; leaving it in place rather than scrubbing keeps the diff
  // minimal in case a future "Codex Pro" mode wants it back.
  const tabs = ['SYSTEMS', 'MECHANICS', 'QUESTS', 'POOL', 'LEGIONS', 'COMBINATIONS', 'ENEMIES', 'ITEMS', 'HEROES'] as const;
  const tabsEl = panel.querySelector('#codex-tabs')!;
  const bodyEl = panel.querySelector('#codex-body')! as HTMLElement;
  // 2026-05-24 — Codex active tab persists across reopens via
  // module-scoped state. Previously reset to SYSTEMS every showCodex()
  // call, dumping a player who'd just read ENEMIES back to the
  // beginning the next time they opened the codex.
  let active: typeof tabs[number] = lastActiveCodexTab;
  function render() {
    tabsEl.innerHTML = '';
    for (const t of tabs) {
      const b = document.createElement('button');
      b.textContent = t;
      b.style.cssText = `background:${active === t ? '#d4af37' : '#3a3025'};color:${active === t ? '#1a1410' : '#e8d6a8'};border:1px solid #5a4a30;padding:6px 10px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px;`;
      b.onclick = () => { active = t; lastActiveCodexTab = t; (searchEl as HTMLInputElement).value = ''; render(); };
      tabsEl.appendChild(b);
    }
    bodyEl.innerHTML = renderTab(active);
    applySearchFilter();
  }
  // 2026-05 v11 (B6 Codex search): hide whole filterable units whose text
  // content doesn't contain the (case-insensitive) substring. Each unit is
  // marked with `data-codex-row` so the filter operates at the card level
  // — never at sub-pieces. That prevents partial hides like the combo
  // card's ingredient panel disappearing while the result panel stays,
  // which was breaking sprite visibility in the COMBINATIONS tab.
  const searchEl = panel.querySelector('#codex-search')! as HTMLInputElement;
  function applySearchFilter() {
    const q = searchEl.value.trim().toLowerCase();
    const targets = bodyEl.querySelectorAll<HTMLElement>('[data-codex-row], tbody tr, ul > li');
    if (!q) {
      targets.forEach(el => { el.style.removeProperty('display'); });
      return;
    }
    targets.forEach(el => {
      const txt = (el.textContent || '').toLowerCase();
      el.style.display = txt.includes(q) ? '' : 'none';
    });
  }
  searchEl.addEventListener('input', applySearchFilter);
  // 2026-05 v11: prominent gold scrollbar + "▼ SCROLL FOR MORE" hint so
  // long codex sections never feel like dead ends.
  markScrollable(panel);
  // 2026-05 v11 (Pin Recipe QoL): delegated click handler for the PIN
  // buttons on every combo card. Each click toggles this recipe in/out of
  // the capped array with FIFO eviction.
  // Re-renders the current tab so every PIN button reflects new state.
  bodyEl.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const btn = target.closest('.codex-pin-btn') as HTMLElement | null;
    if (!btn) return;
    ev.stopPropagation();
    const result = btn.dataset.pinResult;
    if (!result) return;
    togglePinnedRecipe(result);
    render();      // refresh so all PIN buttons reflect new state
  });
  render();
  // 2026-05 v11: bind the body-portal hover handler so combo-sprite tooltips
  // escape the codex modal's overflow boundary and never clip again.
  bindComboTooltipPortal(modal);
  const closeCodex = () => {
    modal.remove();
    document.getElementById('combo-tooltip-portal')?.remove();
    document.removeEventListener('keydown', escClose);
  };
  enhanceModalErgonomics(modal, panel, {
    bodySelector: '#codex-tabs, #codex-search, #codex-body',
    footerSelector: '#codex-footer',
    title: 'Codex',
    closeButton: true,
    closeButtonId: 'codex-modal-x',
    onClose: closeCodex
  });
  document.getElementById('codex-close')!.onclick = closeCodex;
  document.getElementById('codex-close-bottom')!.onclick = closeCodex;
  // 2026-05-19 — ESC closes the codex (universal-escape behavior).
  function escClose(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); closeCodex(); }
  }
  document.addEventListener('keydown', escClose);
}

function renderTab(tab: string): string {
  if (tab === 'SYSTEMS') {
    return `
      ${foldSection('NEW HERE? READ THIS BEFORE ROME FALLS', `
        <div style="font-size:11.5px;color:#cdb98a;line-height:1.65;background:#0c0a08;padding:10px 14px;border-left:3px solid #d4af37">
          <b style="color:#ffd34d">Tower defense in 30 seconds:</b> enemies walk from the cave to your gate. If they reach the gate, you lose lives. If you run out of lives, Rome falls and the leaderboard remembers your name. Build towers to make them not get there.
          <br/><br/>
          <b style="color:#ffd34d">The twist that breaks new players:</b> you don't pick which tower you place. Every round rolls <b>5 random prospects</b> (each placement costs <b>1g</b>). Then you KEEP up to <b>two</b>. Everything else turns to stone. The maze you accidentally build is the maze your enemies must walk.
          <br/><br/>
          <b style="color:#ffd34d">The big idea:</b> long twisty mazes = more time in your towers' range = more shots = more dead enemies. <b>Your maze matters at least as much as your towers.</b> Players who don't believe this lose around wave 5.
          <br/><br/>
          <b style="color:#ffd34d">Things you'll wish someone told you:</b>
          <ul style="margin:4px 0 0 14px;padding:0">
            <li>Spam prospect clicks even if you don't want them — unkept ones become free wall stones. The 1g you "wasted" became part of the maze.</li>
            <li>A tower with a <span style="color:#ee5555">pulsing red ring AND glittery sparkles</span> can combine into something nasty. Click it.</li>
            <li>Click any tower to see its full <b style="color:#88ff88">stat breakdown</b> — base damage, every modifier, the actual final number. No hidden math.</li>
            <li>Click any enemy on the field to see exactly what it resists and why your shots aren't landing.</li>
            <li class="desktop-hotkey-hint">Hotkeys: <b>C</b> opens this Codex, <b>B</b>/<b>G</b> opens the gate shop, <b>M</b> opens the Mercator (when he's in town), and <b>P</b> toggles pause. (No SPACE-to-start anymore — use the START WAVE button.)</li>
            <li>You can press START WAVE whenever you want. Leftover prospects auto-convert to walls. The game won't wait for you to be ready; it'll just punish you faster.</li>
            <li>The <b style="color:#88ff88">QUEST panel</b> bottom-right gives away free gold, items, and towers. Pretending it's not there is a choice.</li>
            <li><b style="color:#ffd34d">Mercator</b> sells real T5 towers at 325g. Use him to fill a critical recipe gap, not to trivialize the tower ladder.</li>
            <li><b style="color:#aa55ff">Necromancy waves (W11 + W13):</b> killed grunts spit a purple portal and <b>6-9 reanimated undead</b> rise at the death tile (85-100% HP each, beefier than the originals). Plan on 7-8× the kills, not 2. They don't chain — the risen form stays dead the second time. <b>Undead-faction waves</b> (W12, W14-W16) also reanimate on every kill regardless of the necromancy tag.</li>
            <li><b style="color:#66ff88">Checkpoint heal:</b> Celtic Berserkers, Sacred Band, Undead Celts, Undead Berserkers, and Undead Spearmen regain 15% HP the first time they cross each of the 7 waypoint coins. Pinch the path right BEFORE coins so the kill window stays narrow. W11 has the heal suppressed (Undead Celt intro is already a slog).</li>
            <li>Recipe wants T3 but your tower is T4? <b style="color:#ffd34d">DOWNGRADE</b> (2g, in the tower menu) drops it one tier. Pride loses runs.</li>
            <li>This is a 30-wave run. Every leaked enemy hurts. <b style="color:#ff5050">Boss leaks cost 10 lives</b>. <b style="color:#ffd34d">Elite and commander leaks cost 5 lives</b>. Bosses also REBORN ON THE NEXT WAVE at the HP they had when they reached Rome (chip damage carries over — small consolation). The math is still not on your side.</li>
            <li><b style="color:#ffd34d">THE LATE GAME (W21-30, v2):</b> Endless mode was <b>removed</b> — clearing <b>W30</b> with the gate intact is now the win. The campaign extends through a brutal new gauntlet: <b>W21</b> Khan boss, <b>W22-24</b> Mongol + Egyptian push (W24 Anubis King), then <b>W25-29</b> the ROMAN-MYTH gauntlet (Chimera, Cerberus, Typhon, Giants, Cyclopes — tough vs steel/fire but <b style="color:#fff4a8">weak to DIVINE</b>), before the <b style="color:#ff5050">W30 Daemon Imperator</b> finale. From W21 a second cave (CAVE B) erupts open on the left and mirrors every ground non-boss spawn, so each ground group hits from both lanes.</li>
          </ul>
        </div>
      `, true)}
      ${foldSection('GLOSSARY — KNOW THE WORDS, WIN THE WARS', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:#cdb98a">
          ${noteCard('Prospect', 'A pending tower waiting for your verdict. Glows gold. Cannot fight, cannot equip, cannot combine. Promise the legionnaire a future or melt him into a wall.')}
          ${noteCard('Keeper', 'The tower you chose to live. Everyone else gets turned to stone. The Senate approves.')}
          ${noteCard('Maze For Time', 'The dark art of forcing enemies to walk further. Every extra tile is another shot fired. A short path is a losing path.')}
          ${noteCard('Tier (T1-T5)', 'How seriously a tower takes itself. T5 hits ~3.5x harder than T1 of the same type. Aim higher.')}
          ${noteCard('Faction', 'The army of the moment — Dogs, Celts, Carthage, Undead Celts, Undead Carthage, Super Demons. Each resists different damage. Read the wave brief or learn the hard way.')}
          ${noteCard('Archetype', 'How an enemy fights — SWARM, RUNNER, ARMORED, RESISTANT, BULKY, ELITE, BOSS. The tag above their head is a warning, not a label.')}
          ${noteCard('Aura', 'A passive ring effect — yours buff, theirs debuff. The translucent circles on the field are real, not decoration.')}
          ${noteCard('DoT', 'Damage Over Time — burn, poison, bleed, hellfire. Ticks while you sleep. Also reduces enemy regen by 50% (was 100% pre-2026-05-21). Aggregate DoT is capped at 4% maxHP/sec per enemy (hellfire 1%/sec sub-cap).')}
          ${noteCard('Splash / AoE', 'Damage that ignores how many enemies are nearby. Swarm waves dissolve under this. T1 spam fights it.')}
          ${noteCard('Leak', 'When an enemy reaches Rome. You lose lives equal to their cost. Bosses cost 10. Elites and commanders cost 5. Regular units are cheaper, but they still add up. The gate is not soundproof.')}
        </div>
      `)}
      ${foldSection('THE LOOP — DO THIS OR LOSE', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('1. Spend Coins, Roll Prospects', 'Each round rolls 5 random prospects. Click empty tiles to place them (1g each). Pending prospects glow gold — they cannot fight yet, but they already shape the maze.')}
          ${noteCard('2. Pick Two Survivors', 'You promote TWO prospects per round. Everyone else gets cemented into the wall. Choose like the gate depends on it. It does.')}
          ${noteCard('3. Build The Maze Of Suffering', 'Walls and towers bend the path between 7 checkpoints. Long, twisty, single-tile pinches are the goal. A short path is a losing path.')}
          ${noteCard('4. Press START. Brace.', 'The wave does not pause for second thoughts. Unkept prospects auto-convert. Build phase returns only after every enemy is dead or has walked into Rome.')}
        </div>
      `)}
      ${foldSection('🧱 MAZING — THE WEAPON BEFORE THE WEAPONS', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.6;margin-bottom:8px">
          Almost every defeat is a short-path defeat dressed up in different excuses. The route runs <b>spawn → 7 checkpoints → gate</b>. Every empty grass tile you fill forces enemies to walk further. Longer path = more shots fired = more bodies in the dirt.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Spam clicks like you mean it', 'Every empty-tile click places one of the 5 rolled prospects for 1g. <b style="color:#88ff88">Place all of them, even the ones you don\'t intend to keep.</b> Unkept prospects cement into walls. You also start with Cavalry Spur (+25% attack speed and +0.5 range) and Barbed Gladius (a modest Common bleed) to establish the early item ladder.')}
          ${noteCard('S-curves, never straight lines', 'The A* pathfinder picks the shortest legal route. Close one shortcut, it finds the next. Drop stones one tile at a time and watch the dotted path update. Make it embarrassing for the enemy.')}
          ${noteCard('Pinch the checkpoints', 'Squeeze the path into a single tile near every checkpoint. AoE/cleave towers (Hastati, Plague Cart, War Chariot, Triumphator) eat single-tile chokes alive.')}
          ${noteCard("You can't fully wall it off", "The game refuses any placement that would orphan spawn, gate, or a checkpoint — you can't grief yourself into a perfect maze. Rejected click? Try one tile over.")}
          ${noteCard('Every tower is also a wall', 'A placed tower occupies its tile. Plan kept towers as path-benders AND damage sources. The best tiles are the ones enemies pass twice.')}
          ${noteCard('Slow towers want long lanes', 'Scorpio (0.35/s), Vulcan Engineer (0.20/s), Colossus Onager (0.15/s) reload like Roman engineering: slowly and on purpose. Park them along straight runs so they never miss their one shot. Every siege tower fires SLOWER and shoots FARTHER than non-siege — per-hit damage scales up to keep effective DPS competitive, but the play pattern is "big slow hits at long range."')}
          ${noteCard('Fast towers want tight turns', "Velites, Eques, Pugio Assassin, Stormcaller fire constantly — corner-park them where every enemy steps within 1-2 tiles. Every shot lands.")}
          ${noteCard('W17 — Iron Phalanx will humble you', 'Melee-immune AND phase the first 2 ranged hits AND regen 4.2%/s out of combat. If your last leg is a single ranged tower with no DoT, the wave is going to walk straight to Rome.')}
        </div>
      `, true)}
      ${foldSection('PROGRESSION — HOW YOU GROW (OR DO NOT)', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Pool Upgrades (cost 15-624g, 8 levels)', 'Each level shifts your prospect rolls toward higher tiers. <b>L1 is the entry tier and grants no damage bonus</b> — starting at L2, every level adds <b style="color:#88ff88">+3% global tower damage</b> (max +21% at L8). Apex level (L8) total is <b>1,697g</b> across all 8 steps.')}
          ${noteCard('Hero Kill XP', 'Cumulative kills raise hero level. Effective pool = max(gold-purchased pool, hero level). Caps at 5 from kills alone — pool L6+ requires gold purchases.')}
          ${noteCard('Per-Tower Crit Chance', 'Every tower has its own crit profile. Fast attackers (Pugio Assassin 28%, Eques signature 30%) crit often for modest bonuses. Heavy siege (Colossus Onager 6%, Vulcan Engineer 6%) crit rarely for huge multipliers (×3.0–×3.5).')}
          ${noteCard('Same-Tier Merging', '3 identical towers of the same tier merge into the next tier — automatic recipe, no special button. <b style="color:#88ff88">Works for combo towers too</b>: stack 3× Horseman T2 to merge into Horseman T3, all the way up. The survivor gets <b style="color:#88ff88">+15% damage</b> (stacking on each merge). Cheapest path to T5 for any unit.')}
          ${noteCard(`Combination Recipes (${(combos as any[]).length} total)`, 'Cross-unit recipes turn ingredient towers into a named combo tower. Three classes: <b>single combos</b> (2-3 ingredients), <b>cross-combos</b> (combos as ingredients), and <b>super / omega combos</b> (multi-combo apex recipes — hardest in the game). <b style="color:#88ff88">Combine in ANY pre-wave phase</b> — execute recipes the moment they\'re completed, even while prospects are still pending placement. Full sortable list in the COMBINATIONS tab.')}
          ${noteCard('🔥 Standout Towers (full stats in LEGIONS tab)', '<b style="color:#ffd34d">🐲 Draconarius (T4):</b> 60° fire-breath cone + DRAGON MARK stacking debuff. <b style="color:#ffd34d">🦁 Bestiarius (T4):</b> rage gauge — every 8th hit on the same target is a 6× FRENZY + stun (8× on bosses). <b style="color:#ffd34d">🛡 Murmillo (T4):</b> anti-Carthage specialist (+75%/+50% vs Carthage/Undead Carthage) + 1.2s stun + 0.8-tile knockback every 4th swing. <b style="color:#ffd34d">🐺 Beast Hunter (T1) + Beast Slayer (T1-T3 multi-tier):</b> +200% vs animal enemies (dogs, hellhound, war elephants). Open the LEGIONS tab for full DPS / attack speed / range numbers and the COMBINATIONS tab for the recipe ingredients.')}
          ${noteCard('Kill Bonus', 'Veteran towers earn a slow flat-DPS bonus per kill, capped at +10% of base T1 DPS. Bronze (50 kills), Silver (200), Gold (500) badges mark milestones.')}
          ${noteCard('Aura Rings — color = role', 'Every local aura on the field draws a visible ring:<br/>• <b style="color:#c070ff">VIOLET</b> — ally buff (damage / speed / range)<br/>• <b style="color:#ff5566">DASHED CRIMSON</b> — enemy debuff (+taken% / slow / mark)<br/>• <b style="color:#ffd34d">GOLD</b> — tower attack range (kept distinct so the three layers never confuse)<br/><br/><b>Native aura towers:</b> Eagle Standard, Praetorian Wall, Cohort Guard, Triplex Acies, Legion Prime, Aquilifer, Vestalis. <b>Aura items:</b> Centurion\'s Trumpet, Battle Standard, War Hound Collar, Druid\'s Torc, Barca War Horn, Lich General\'s Seal, Aquilifer\'s Banner, Cursed Torc. <b>Global auras</b> (Triarius +12%, Caesar +55%, Triumvirate, Imperium, Consular) cover the whole map and don\'t draw rings.<br/><br/><b style="color:#ff9933">STACKING CAP:</b> auras compound multiplicatively but combined damage AND speed per tower cap at <b>2.00× each (max +100%)</b>. Past 5 sources you\'re at the ceiling — diversify into items, pool damage, marks, or enemy-vulnerability auras.<br/><br/><b style="color:#aaccff">Sleep vs Nullification (different scope):</b> a tower ASLEEP (druid dart) drops BOTH its aura contributions AND its periodic abilities (Caesar stun pulse, Hannibal\'s Nightmare freeze) — fully inert until it wakes. A tower inside an Architectus 2-tile NULLIFIER bubble only drops its AURAS — periodic abilities still fire because they\'re triggered, not continuous. The aura ring dims in either case.<br/><br/><b style="color:#cdb98a">Enemy auras:</b> druids + Demon Legate emit a tower-slow aura (2-3 tile, 20-30%); war elephants emit a dust shield (4 tiles, ranged-immunity to nearby ground allies). Kill the source, the aura drops.')}
          ${noteCard('🎨 Projectile Visual Code', 'Glance at the field and you can tell what kind of damage is in flight: <b style="color:#ffe066">GOLD HALO + rotating sun rays</b> = DIVINE damage (Flamen, Augur, Haruspex, Solar Priest, Pontifex, Imperium Eternum, Fatebinder). <b style="color:#ff8a22">PULSING OUTER RING</b> around a projectile = SPLASH on impact (Vulcan Engineer, Colossus Onager, Siege Onager, Carroballista, Inferno Cart, Plague Cart, Solar Priest, etc.) — the ring shows the splash radius before the hit lands. On hit, splash projectiles drop a tan/cream shockwave ring at the impact point. <b style="color:#88ddff">CLEAVER MELEE</b> (Hastati, Triarius, Cohort Guard, Praetorian Wall, Imperator Guard, Vexillation, Triumphator, Triplex Acies, or anyone with Falx Blade equipped) draws a WIDER primary slash + a trailing echo-arc + a faint tan ring on every swing, so a cleaver reads as a cleaver even hitting a single target.')}
          ${noteCard('⚖ Tower Balance Scalars', 'Three class-wide scalars sit on top of the codex base DPS so the strongest tower lanes can\'t outrun the rest of the roster. Your TOWER MENU stat breakdown lists them as discrete lines so the math reconciles:<br/>• <b style="color:#cc6666">−8%</b> ranged COMBO towers (anything <b>melee:false</b> with <b>kind:COMBO</b>)<br/>• <b style="color:#cc6666">−10%</b> T5 base towers (Praefectus, Vulcan, Imperator, Solar Priest, Colossus, Aquila Venator)<br/>• <b style="color:#cc6666">−12%</b> apex super-combos (Imperium Eternum, Carthage Scourge, Triumvirate, Legion Prime, Fatebinder)<br/><br/>Categories don\'t compound — a tower in two buckets takes the smallest (most-forgiving) scalar.')}
          ${noteCard('⚔ Combo-Tower Melee Notice', 'Three former-ranged COMBO towers are now <b style="color:#88ddff">MELEE</b> — they need a path-adjacent tile to fire their primary strike:<br/><br/>• <b style="color:#ffd34d">Julius Caesar</b> — range 5.5 → 1.5, damage type DIVINE → Physical Melee. <b>+55% global damage aura still works.</b> The 3s magisterial stun PULSE is now hardcoded to its old 5.5-tile reach so the command-presence ability doesn\'t shrink to the sword\'s reach. <b style="color:#ff8866">IMPERIAL EXECUTE 10%</b> — any enemy at or below 10% HP after Caesar\'s swing dies instantly, bosses included. Flyers qualify only if Caesar is equipped with AQUILA TALONS (or sits on the CYAN aura tile / under Agricola\'s anti-air passive) so he can reach them in the first place.<br/>• <b style="color:#ffd34d">God of War</b> — range 5 → 1.5, DIVINE → Physical Melee. Keeps HELLFIRE stamp + DIVINE EXECUTE 12% (true-damage mechanics are hardcoded per tower type so they survive the conversion).<br/>• <b style="color:#ffd34d">Fatebinder</b> — range 6.5 → 1.5, DIVINE → Physical Melee. Primary strike still TRUE damage; map-wide 40% splash echo still fires every hit; +22%/+22% global aura unchanged.<br/><br/>If you have one of these towers from a saved run, place it on or beside the path — they need to physically touch the line now.')}
          ${noteCard('🏹 Siege Tower Identity', 'Every siege tower fires <b style="color:#cc6666">slower</b> and shoots <b style="color:#88ff88">farther</b>. Per-hit damage scales up to keep effective DPS similar — they now play like proper siege (big slow hits at long range). Concrete changes:<br/>• <b>Librator</b> 0.78→0.63/s, 4.4→5.5 tiles<br/>• <b>Turris</b> 0.42→0.34/s, 6→7 tiles<br/>• <b>Carroballista</b> 0.38→0.30/s, 6.1→7.1 tiles<br/>• <b>Vulcan Engineer</b> 0.24→0.20/s, 6.4→7.5 tiles<br/>• <b>Colossus Onager</b> 0.18→0.15/s, 7→8 tiles (slowest in the game, biggest splash)<br/>• <b>War Chariot</b> 1.0→0.8/s, 3→4 tiles<br/>• <b>Siege Onager</b> 0.2→0.16/s, 7→8 tiles<br/>• <b>Nemesis Engine</b> 0.15→0.12/s, extreme 12-tile reach<br/><br/>Park siege towers on long straight runs so they never miss their reload window.<br/><br/><b style="color:#66ccff">2026-05-19 — Flyers take +20% siege damage globally.</b> Heavy bolts and stones punch flying targets harder than arrows. Stacks multiplicatively with each flyer\'s per-enemy siege profile (Celtic Scout 0.7×1.2=0.84, Numidian Rider 1.15×1.2=1.38, baseline flyers 1.0×1.2=1.20).')}
          ${noteCard(`Quest System (${QUESTS.length} quests + tier bonuses)`, `Run-long objectives with tiered per-quest rewards (gold / items / free towers). Tracked in the bottom-right HUD panel; full list in the QUESTS tab. Clearing every quest in a tier banks an extra gold bonus. Major scheduled bosses pay <b>22 + round(wave × 3.5) gold</b>; boss-class adds no longer multiply that bounty.`)}
        </div>
      `)}
      ${foldSection('⚖ CAMPAIGN RELICS — BARGAINS WITH FATE', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.6;margin-bottom:8px;background:#0c0a08;padding:10px 14px;border-left:3px solid #ffd34d">
          After clearing <b style="color:#ffd34d">every 5th wave (W5 / W10 / W15 / W20 / W25)</b>, Rome offers <b>4 random Campaign Relics</b> from a 68-relic pool. Every relic is a pact: a real upside bound to a real price. Claim ONE per offer — or <b style="color:#88ddff">reject all four</b> and stay unbound. Claimed relics are <b>permanent for the rest of the run</b> and stack with each other; a claimed relic never re-appears in later offers.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Two families of bargains', '<b style="color:#ff7733">Run-shapers</b> trade a big permanent buff for a big permanent cost (e.g. Divine towers +80% damage, but all enemies +25% speed — forever). <b style="color:#88ff88">Small trades</b> are immediate one-time swaps: a Tier-3 tower for 5 lives, +150 gold for 3 lives, +4 lives for 125 gold. Read the UPSIDE and the CAVEAT lines on each card — both always apply.')}
          ${noteCard('Claim costs are gated', 'Relics that cost gold or lives up-front are <b>unclaimable</b> when you can\'t pay: you need the full gold amount, and at least ONE more life than the life cost (a relic can never kill you). Greyed-out card = you can\'t afford its price right now.')}
          ${noteCard('Instant grants', 'Tower-granting relics queue a free placement (same flow as a Mercator tower buy — click a tile to drop it). Item-granting relics deliver straight to inventory; <b style="color:#ff7733">a full inventory forfeits the item</b>, so keep a slot open before claiming.')}
          ${noteCard('Permanent means permanent', 'There is no way to remove a claimed relic. A +25% enemy-speed caveat claimed at W5 is still pushing enemies at W30. Weigh late-game consequences, not just the immediate gift — and remember skipping is always free.')}
        </div>
      `)}
      ${foldSection('TOWER ROLES — KNOW WHO DOES WHAT', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Melee Swings At Air', 'Melee cannot reach flyers by default — plan ranged coverage before the flyer wave laughs at your sword wall. The lone exception is the legendary <b style="color:#ffd34d">Aquila Talons</b> item, which unlocks anti-air for one melee tower at a time.')}
          ${noteCard('Anti-Air Specialists', 'Sagittarius, Aquila Venator, and Skyreaper Battery ONLY target flyers. Dead weight on ground waves, devastating on flyer waves. Choose your slot.')}
          ${noteCard('🪙 Flyer Wave Payout Bonus', 'Surviving a flyer wave (W6 / W12 / W18) pays a <b style="color:#88ff88">+50% gold bonus</b> on top of the normal wave reward (rounded, min +5g). Flyers bypass your maze entirely, so dedicated anti-air investment (Storm Javelin, Flyer Bane, Aquila Talons, ranged pool depth) actually gets compensated. Plan to spend the bonus on the next round\'s build.')}
          ${noteCard('Tier Pips Do Not Lie', 'Every tower wears its tier — pip dots above, colored ring at its base. T5 = red ring. If you do not see red rings late game, that is the problem.')}
          ${noteCard('One Item Per Family (DoT exempt)', 'DAMAGE, SPEED, RANGE, AURA, ECONOMY, DEFENSE — one each per tower. SPECIAL trophies AND every DoT item (burn / poison / bleed / hellfire) stack freely. Build a dedicated DoT specialist tower with multiple DoTs ticking at once.')}
          ${noteCard('Attack-class Item Gates', 'Every class-restricted item opens its effect with <b>MELEE ONLY</b> or <b>RANGED ONLY</b> in CAPS.<br/><b style="color:#88ddff">MELEE ONLY:</b> Barbed Gladius, Berserker\'s Muzzle, Aquila Talons, Spear of Mars, Poisoned Blade, Iron Tip, Celtic Longsword, Necrotic Longsword, Cavalry Spur<br/><b style="color:#ff7733">RANGED ONLY:</b> Storm Javelin, Flyer Bane, Fire Oil Flask, Numidian Saddle<br/>The inventory grid greys out incompatible items with the matching <b>ONLY</b> tag so you can\'t mis-equip.')}
        </div>
      `)}
      ${foldSection('DIFFICULTY CURVE — WHEN THE PAIN ARRIVES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Wave 1 (calibration)', 'Every spawn on W1 is hard-pinned to <b>350 HP</b> (300 if no hero drafted). The fixed pin keeps the opening wave deterministic so we can tune FERAL_DOG baseHp without W1 jumping around. Bumped from 100 HP on 2026-05-23 — the original was too soft.')}
          ${noteCard('Wave 2-4', 'Enemy HP climbs steadily over the early waves. Most prospects roll T1; this stretch teaches mazing. <b style="color:#ffe066">W4 introduces the Shield mechanic early</b>: 4 Gallic Druids carry sacred wards (ranged towers cannot target them until melee bashes the shield). Pair a melee tower with your starting <b>Barbed Gladius</b> (you begin every run holding one; it is otherwise Mercator-only) + starting Cavalry Spur and the Shield Bash (+50% melee damage on first hit) shreds them.')}
          ${noteCard('Linear Per-Wave (+10% HP)', 'Baseline climb: HP grows roughly <b>+10% per wave</b>. <b style="color:#ff7766">From W11</b> an extra +10% per wave stacks on top; <b style="color:#ff5050">from W12</b> another +15% per wave joins in. The late game ramps faster than the early game on purpose. Linear means smooth — no off-feeling spike except the boss-clear bump (next card).')}
          ${noteCard('Per Cleared Boss (×2.00, basics only)', 'Each cleared 5-wave boss <b>DOUBLES</b> the HP of every BASIC enemy for the rest of the run. After 3 cleared bosses (entering W16), basic enemies take ×2³ = ×8.0 on top of the linear step. <b style="color:#ffd34d">Bosses themselves are exempt</b> — they scale linearly only so each boss feels like a clean step heavier than the last, not an exponential wall.')}
          ${noteCard('Late-Wave Damage Buff (+50% per boss cleared)', 'Towers get <b>+50% damage per cleared 5-wave boss</b> to partly keep pace. Enemies scale faster than towers (basics ×2.00 vs towers ×1.50 per cleared boss) — that gap is the design pressure. Combo damage, true damage, and aura stacking are how you close it.')}
          ${noteCard('🛡 Late-Game Resistance Cascade', 'Every newly-spawned <b style="color:#ff9933">ground non-flyer</b> takes incrementally less damage as the campaign progresses:<br/>• <b>W6:</b> -4% damage (×0.96)<br/>• <b>W7:</b> -8% (×0.92)<br/>• <b>W11:</b> -15% (×0.85)<br/>• <b>W16:</b> -16% (×0.84)<br/>• <b>W18:</b> -20% (×0.80)<br/>• <b style="color:#ff5050">Bosses absorb another -10%</b> on top (floor: ×0.50)<br/><br/>Applies uniformly across every damage type (Melee, Ranged, Siege, Fire, Divine) AND DoTs (Burn, Poison, Bleed, Hellfire). <b style="color:#88ddff">Flyers are unaffected</b> — they\'re already balanced against ranged-only counterplay. Stacks multiplicatively on top of the per-enemy / per-faction resists shown in the ENEMIES tab. Counter by diversifying damage types, stacking tier-ups, layering aura buffs, or leaning on TRUE-damage divine / hellfire sources.<br/><br/><b style="color:#ff9933">Extra layers stacking on top of the cascade above:</b><br/>• <b style="color:#ff9933">Ground ranged shield (W8+):</b> from W8 on, every ground non-flyer takes <b>25% less</b> from PHYS_RANGED and SIEGE (damage ×0.75). Bosses and flyers are exempt. Diversify into melee or divine past W7 or your ranged backbone hits a wall.<br/>• <b style="color:#ff9933">Per-wave direct-damage reduction:</b> specific waves shrug off a flat % of <b>direct-hit</b> damage (DoTs unaffected): <b>W12 −15%</b>.<br/>• <b style="color:#ff9933">Per-wave DoT resistance:</b> specific waves resist <b>damage-over-time</b> (direct hits unaffected): <b>W13 −30%</b>. Lean on direct damage on those waves.<br/>• <b style="color:#66ff88">W8 resistance RELIEF (player-favorable):</b> on W8, resistant enemies are dragged <b>15% closer to neutral</b>, so resistances soften (weaknesses are left alone) and a slightly-wrong damage type is less punished that one wave.')}
          ${noteCard('Iron Phalanx (W17)', 'Melee-immune armored group joins the W17 spawn. Only RANGED damage can hurt them. Plan a ranged backbone before W17.')}
          ${noteCard('Boss Waves', 'Early scheduled bosses arrive <b style="color:#ff5050">ALONE with 2× HP</b> as focused teaching fights. After W15, boss waves keep their escort groups so the campaign keeps climbing instead of dipping into one-unit relief waves. Faction weather intensifies ×1.5.')}
          ${noteCard('Leak Toll Tiers', '<b style="color:#ff5050">Every boss costs 10 lives when it reaches Rome</b>. The boss dies at the gate but is <b>REBORN ON THE NEXT WAVE with the HP he had at the gate</b> — chip damage carries over (Hannibal leaks at 5% HP, returns at 5% HP). <b style="color:#ffd34d">Elites and commanders cost 5 lives</b>. Regular units use their smaller listed cost.')}
        </div>
      `)}
      ${foldSection('✨ AURA BUFF TILES — NINE GLOWING SPOTS ON THE MAP', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.6;margin-bottom:10px;background:#0c0a08;padding:10px 14px;border-left:3px solid #a060ff">
          Nine glowing tiles sit at fixed positions across the map. A tower placed on one inherits the tile's bonus — auras stack multiplicatively with items and other buffs, so a Tempo Tile + Cavalry Spur combo lands at <b>1.30 × 1.22 ≈ 1.59× attack speed</b>. Tile positions never change between runs so every player has the same strategic anchors to plan around. <b>Hover</b> any tile to see its full effect; the glowing ring brightens when a tower is sitting on top. Stone walls placed on an aura tile do nothing — the bonus only fires for actual towers.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${noteCard('🟣 TEMPO TILE (Purple)', '<b style="color:#a060ff">+30% attack speed</b> for any tower placed on it. Best for fast-firing towers (Velites, Eques, Pugio Assassin) and DoT carriers that want more tick applications.')}
          ${noteCard('🔵 WAR TILE (Blue)', '<b style="color:#66aaff">+30% damage</b> for any tower placed on it. Universal stat boost — flatter than the tempo tile but works on every tower role from siege to melee.')}
          ${noteCard('🔴 TYRANT TILE (Red)', '<b style="color:#ff5050">+50% damage vs Bosses</b>. Specialized — a boss-killer tower (Pontifex, Scorpio, Triumphator) here becomes legitimately scary on W5/10/20/24/30.')}
          ${noteCard('🩵 AETHER TILE (Cyan)', '<b style="color:#66ffdd">Any tower on this tile can target FLYERS</b>, including melee towers without Aquila Talons. A cheaper alternative to the legendary item — but only one tower at a time benefits.')}
          ${noteCard('🟡 TREASURY TILE (Gold)', '<b style="color:#ffd34d">+2 Gold per kill</b> on top of any other gold sources. A high-traffic tower placed here pays for itself in 2-3 waves.')}
          ${noteCard('🟢 WATCHTOWER TILE (Emerald)', '<b style="color:#66ff88">+2 tiles of range</b> for any tower placed on it. Turns a Scorpio (5.0) into a 7.0-range cannon that covers nearly half the map width. Stacks additively with the Watchtower Lens trophy (+1) — three-deep range stacks are real. Sits in the upper-middle of the map so a tower on it commands a wide central sight-line over the path.')}
          ${noteCard('⚪ DIVINE TILE (Ivory)', '<b style="color:#fff2cc">Any tower on this tile strikes as DIVINE damage</b> — keeps its own stats and abilities, but its hits bypass most resistances. Park a high-DPS tower here to crack armored ground that walls physical/siege. Sits on the WP3↔WP4 gauntlet (near the 4th checkpoint).')}
          ${noteCard('🟠 BLAST TILE (Amber)', '<b style="color:#ff8a3c">Any tower on this tile gains a 1.2-tile splash blast</b> — every hit also damages enemies around the target, even single-target towers like Scorpio or Sagittarius. Turns a sniper into an AoE clearer on the dense WP3↔WP4 lane (near the 3rd checkpoint).')}
          ${noteCard('🌊 TIDE TILE (Ocean)', '<b style="color:#26f6e2">Any tower on this ocean tile slows damaged enemies by 30%</b>. The tower keeps its normal damage type, targeting, items, splash, and abilities; the tile simply adds control to enemies it actually hurts. Strong with high-rate towers, splash towers, and shoreline plans that drag enemies near the water.')}
        </div>
      `)}
      ${foldSection('🌀 SURPRISE EVENTS — INVASION, UPRISING, GATES OF HELL', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.6;margin-bottom:10px;background:#0c0a08;padding:10px 14px;border-left:3px solid #ff7733">
          Three scripted "events" disrupt the normal wave flow on specific 30-wave campaign waves. Each one changes WHERE enemies enter the path and adds dramatic VFX. Surviving an event opens a reward modal — <b style="color:#ff9933">choose 1 of 3 LEGENDARY trophies</b> drawn exclusively from that event's pool (these items are obtainable nowhere else: not the shop, not the Mercator, not boss drops). All event-spawned enemies skip waypoints 1 and 2 but must still walk waypoints 3 → 4 → 5 → 6 → 7 in linear order before they reach the gate — no shortcuts to Rome regardless of where the fire/urn/gate appears on the map. <b style="color:#ffd34d">Survival also banks a gold bonus</b>: <b style="color:#ffd34d">+30g</b> for Invasion, <b style="color:#ffd34d">+40g</b> for Uprising, <b style="color:#ffd34d">+50g</b> for Gates of Hell. The bonus pays out the moment the reward modal opens, on top of the legendary you pick.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${noteCard('⚔ INVASION (W7, W18, W29)', '<b style="color:#ff7733">The empire is besieged on every side at once.</b> A perimeter fire lights up on the outer edge of the map for <b style="color:#ff7733">EVERY single enemy in the wave</b>, and the ground enemies ALL emerge simultaneously the moment the fires finish rising (~0.3s after the event triggers). <span style="color:#88ddff">Flyers don\'t redirect — they keep spawning from the cave normally; only the ground enemies emerge from the perimeter.</span> Invaders run at <b style="color:#ff7733">+25% base speed</b>, rising to <b style="color:#ff7733">+35%</b> on late-campaign invasions. W21+ invasion enemies also gain extra sustain and status resistance. <b style="color:#ffd34d">Skips the first 2 checkpoints</b> — invaders enter the path at WP3, so early-path-only tower setups get punished. <br/><br/><b style="color:#ff9933">Reward pool (Legendary, pick one of 3):</b><br/>• <b>Vanguard Pilum</b> — any tower +35% damage, +1 range<br/>• <b>Aquila Rampart</b> — +50% damage vs enemies above 70% HP (execute role)<br/>• <b>Perimeter Torch</b> — +25% damage AND +25% attack speed')}
          ${noteCard('☠ DEATH UPRISING (W11, W14, W23)', '<b style="color:#a050ff">The dead rise.</b> A single mass-grave urn pulls itself up near the center of the map, relocating to the nearest open ground if that tile is occupied. Enemies <b>pour out of the urn</b> in <b style="color:#a050ff">bursts of four</b>, then walk straight to the nearest path tile to join the maze. <b style="color:#ffd34d">Skips the first 2 checkpoints</b> — risers enter the path past WP2. W23 is the late-campaign crypt check: uprising enemies gain stronger sustain, checkpoint healing, status resistance, and direct resistance on top of the normal wave rules. <br/><br/><b style="color:#a050ff">Reward pool (Legendary, pick one of 3):</b><br/>• <b>Gravekeeper\'s Scythe</b> — +60% damage vs undead-faction enemies<br/>• <b>Soulfire Brand</b> — applies HELLFIRE on hit (true damage, bypasses every resist)<br/>• <b>Necromancer\'s Lantern</b> — aura 3 tiles: enemies take +25% damage from all sources AND can\'t regen')}
          ${noteCard('🔥 GATES OF HELL (W16, W27)', '<b style="color:#ff4422">The underworld breaks open in four places.</b> <b>FOUR</b> destructible <b>Hell Gate</b> structures rise — <b>two flanking WP3</b> and <b>two flanking WP4</b>. They contribute to a round-robin <b>Fire Giant</b> spawn schedule: one giant emerges every ~1.5 seconds from a different gate. About <b>8 giants</b> total over the 12-second window. <b style="color:#ffd34d">Giants skip the first 2 checkpoints</b> — they spawn AT WP3/WP4 and walk forward. Hell Gates and Fire Giants have <b>at least 2,000,000 final HP</b> after event scaling. W27 fire giants are faster, tougher, more status-resistant, and regenerate if pressure drops. Destroy gates early to cut their contribution. Fire giants are immune to fire and bleed, vulnerable to divine and siege.<br/><br/><b style="color:#a060ff">Every Fire Giant kill drops a guaranteed EPIC item.</b><br/><br/><b style="color:#ff4422">Reward pool (Legendary, pick one of 3):</b><br/>• <b>Hellgate Brand</b> — +50% damage, +25% attack speed, silence-immune<br/>• <b>Demonsworn Crown</b> — +100% damage vs demons AND +50% vs bosses<br/>• <b>Inferno Standard</b> — aura: +25% damage, applies BURN on hit')}
        </div>
        <div style="font-size:11px;color:#cdb98a;line-height:1.6;margin-top:10px;background:#0c0a08;padding:10px 14px;border-left:3px solid #ffd34d">
          <b style="color:#ffd34d">Endless mode chaos:</b> In Endless, events can STACK. Once the primary event fires there\'s a 40% chance to add a second event of a different kind 0.6s later, and (if a second fired) a 25% chance to add a third 1.2s after that. A triple-stack Endless wave can have invasion fires across every edge, uprising urns in the center, AND hell gates at WP3/WP4 — all firing at once. Each stacked event still drops its own reward modal queued back-to-back.
        </div>
      `)}
      ${foldSection('ECONOMY & VENDORS — WHERE THE GOLD GOES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Gate Shop', 'Refreshes every 4 waves with a freshly randomized lineup (4 Common + 2 Uncommon + 2 Epic items, no Rare and no duplicates within a visit, 8 offers total). Always available between waves via the <b>SHOP</b> button, the <b>B</b>/<b>G</b> hotkey, or clicking the gate tile. Lives also purchasable here (55g/+1 life, capped per visit). <b style="color:#ffe066">Barbed Gladius</b> (MELEE-only bleed) is <b>NOT</b> a gate-shop item; it is Mercator-only. You already start every run holding one, so a basic melee-bleed option is reachable from W1 regardless.')}
          ${noteCard('Mercator (W4 / 9 / 14 / 19 / 23 / 27)', 'Traveling merchant. Stocks a freshly randomized item shelf: 4 LEGENDARY trophies at <b style="color:#f0c040">666g</b> each, 2 Rares, 2 Epics, 3 mid items, and guaranteed Truesight. His armory also carries recruitable Champions of Rome at 1000g and 10 random Tier 5 base towers at <b style="color:#f0c040">325g</b>. Bought Champions start as fresh level-0 recruits and level from future kills, so these are campaign investments now, not impulse purchases.')}
          ${noteCard('☠ Consumable Traps (Gate Shop only)', 'Buy traps from the <b>Gate Shop</b>, stockpile them, then SELECT one and click an empty tile near the path to lay it. Mercator does not sell traps. Each trap type is capped at <b style="color:#ffd34d">5 per campaign</b>. Deployed traps re-arm during the wave, then expire when the wave ends. They are drawn bright + pulsing so they are easy to spot, do NOT block the path, and pop a damage number on every hit. Six types: <b style="color:#c0c0c0">Iron Spike</b> (heavy hit), <b style="color:#66dd44">Venom</b> (hit + POISON), <b style="color:#ff7722">Tar Fire</b> (hit + BURN), <b style="color:#88ddff">Frost Snare</b> (wide SLOW), the BOSS-specialist <b style="color:#ffcc44">Ballista Snare</b> (3.5x vs bosses), and the FLYER-specialist <b style="color:#cfe0ff">Sky Net</b> (the only trap fliers can trip).')}
          ${noteCard('🎰 Fortuna\'s Wheel — Combo Tower Gamble', `Mercator-only mechanic. Pay <b style="color:#f0c040">${FORTUNA_GAMBLE_COST}g</b> for a <b>RANDOM REGULAR COMBO TOWER</b>. Supercombo, Omega, Champion, and combo-of-combo towers are EXCLUDED and must be crafted, not bought. <b style="color:#ff5050">Tier rarity is linear:</b> per-spin tier odds are <b style="color:#b87333">T2 40%</b> · <b style="color:#c0c0c0">T3 30%</b> · <b style="color:#ffd34d">T4 20%</b> · <b style="color:#ff5050">T5 10%</b> (weighted 4/3/2/1, then uniform within tier). <b style="color:#ff5050">Pure RNG, no pity, no per-visit cap.</b> The spin animation cycles through random portraits before landing on the winner; the tower joins your placement queue exactly like a Mercator T5 buy. Spin counter on the section header tracks how many times you've tempted the goddess this visit.`)}
          ${noteCard('Gold Per Kill (Baseline)', 'Every enemy kill pays <b style="color:#f0c040">+1 Gold</b> instantly, regardless of which tower lands the blow. Stacks on top of Aerarium, GOLD_PURSE, Praetorian Coin, Hannibal\'s Strategy Scroll, and the Treasury Tile.')}
          ${noteCard('Boss-Kill Gold Bonus', 'Every boss kill pays <b>22 + round(wave × 3.5) gold</b> on top of wave-end gold AND on top of the baseline +1g. W30 final boss ≈ +127g + 1g. Stack with Aerarium kills for spikes.')}
          ${noteCard('Aerarium Income (treasury combo, T3)', 'Aerarium pays <b style="color:#f0c040">+4 Gold on every kill it personally lands</b> — NOT a passive tick. Cap of <b>3 Aerariums</b> on the map at once. <b style="color:#88ddff">38 baseDps × 2.0 atk speed</b> at 4.2 tile range — fast-cycling so it racks up kills at a chokepoint. A modest run snipes <b style="color:#88ff88">~20-40g per wave</b>; placing one Aerarium at every chokepoint stacks the income.')}
          ${noteCard('🎯 DPS CHECK', 'Right-panel button between LEADERBOARD and SETTINGS. Spawns a harmless <b>Training Dummy</b> (<b style="color:#88ff88">unkillable — infinite regen</b>) that walks the standard path. Costs nothing, deals 0 damage on leak, doesn\'t block wave-end. The dummy regenerates every tick so it always finishes the walk regardless of how much DPS the maze pumps — measurement stays valid for endgame builds that would one-shot a fixed-HP dummy. Use it between waves to gauge maze throughput before committing to the next wave\'s START. When it reaches Rome the summary popup shows total damage, time on field, effective DPS, and a button to jump to the Tower Leaderboard for per-tower breakdown. Button rearms after the dummy finishes its run.')}
          ${noteCard('Gate Shop Stock & Refresh', 'The gate shop carries <b>NO legendaries</b>. Its lineup is the standard 4 commons + 2 uncommons (6 offers total), no rares either. <b style="color:#ffd34d">Legendary trophies are Mercator-only</b> (W4/9/14/19: 4 legendaries + exclusive rare + T5 armory). The gate stock refreshes every 4 waves; the SHOP button glows gold + pulses with <b>★ NEW · SHOP</b> when it does, cleared by opening the shop. The gate slot is steady-state filler between Mercator stops, not a legendary source.')}
          ${noteCard('Sell Prices', 'Selling an item refunds half its purchase cost. Rarity values are COMMON 37g, UNCOMMON 83g, RARE 185g, EPIC 390g, LEGENDARY 740g, and UNIQUE 925g.')}
          ${noteCard('▦ Stone Ramparts (Gate Shop only)', 'A Gate Shop mazing aid: <b style="color:#f0c040">30g</b> buys a straight line of <b style="color:#ffcc44">5 wall stones</b>, centered on the tile you click after preview + confirmation. Mercator does not sell Stone Ramparts. <b style="color:#ff7733">Hard cap: 5 shop purchases per campaign.</b> Flow: BUY → the rampart goes to your <b style="color:#ffd34d">Armarium inventory</b> → click the Stone Rampart shelf to arm it → a floating placement tray appears → press <b style="color:#ffe066">R</b>, tap ROTATE, or click one of the four orientation buttons: horizontal, vertical, diagonal ↘, diagonal ↗ → hover to preview the exact five tiles → click a valid tile or road/trail → confirm. The shop PLACE button is a shortcut for the same inventory arming step. <b style="color:#88ddff">Diagonal walls are fully solid:</b> enemies path 4-directionally and cannot squeeze through corner gaps. Placed tiles are ordinary stones — they block the path, sell back for 1g each, and towers can replace them. Build phase only; checkpoints, occupied tiles, cave/gate anchors, and placements that seal Rome are refused without consuming the rampart.')}
          ${noteCard('Maze tiles', 'You don\'t buy single stones directly. Every empty-tile click during prospect phase costs 1g and drops a prospect; the unkept ones cement into stone walls automatically (the <b style="color:#ffcc44">Stone Rampart</b> above is the one exception — a purchasable 5-stone line). Click any stone wall later to SELL it back for 1g if the maze needs a redraw.')}
          ${noteCard('🖱 Inspect Any Tower (map OR sidebar)', 'Click any placed tower for its full panel: <b style="color:#88ff88">damage / atk-speed / range breakdown</b> (base + every active modifier + final stacked total), equipped items, kill count, and every <b style="color:#88ff88">combo recipe</b> that uses this tower. <b style="color:#88ddff">The same panel opens from two places:</b> clicking the tower on the field, OR clicking its thumbnail in the prospect sidebar on the left. The sidebar route lets you compare prospect stats side-by-side without losing your cursor position on the map.')}
        </div>
      `)}
      ${foldSection('DAMAGE TYPE READ — KNOW WHAT YOU HIT WITH', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55">
          <b style="color:#9be0ff">Physical melee</b> dominates chokepoints — and swings at empty air vs flyers. Iron Phalanx laughs at it.
          <b style="color:#9be0ff">Physical ranged</b> handles flyers, phalanxes, long lanes. The bread and butter of every legion.
          <b style="color:#9be0ff">Siege</b> clears clusters in one shot. Slow reloads — give it a sight line worth its time.
          <b style="color:#9be0ff">Fire, poison, bleed, slow</b> win when the enemy lets you. <b style="color:#ee5555">EVERY undead enemy burns hard</b> — minions and bosses alike take +15-25% extra damage from FIRE and BURN sources on top of the +25-30% faction baseline. But undead are <b style="color:#5ca0ff">fully immune to BLEED and POISON</b> (no flesh to rot, no veins to cut) — pure DoT builds need fire as the carrier. <b>Super Demons are fully fire-immune</b> — bring divine or physical, not a barrel of burning oil. <b style="color:#ffd34d">Demons take BONUS divine damage</b> — lesser demons stack <b>×1.20 per-enemy</b> with the faction's +100% divine row → <b>~2.4× final divine</b>. The W30 Daemon Imperator boss carries a <b>0.70 per-enemy damper</b> → <b>~1.40× final divine</b> (still vulnerable, just less). Flamen, Augur, Haruspex, Solar Priest, and Pontifex are the dedicated demon-busters.
          <b style="color:#9be0ff">Divine</b> is the cheat code into heavy resistance. Solar Priest ignores faction resists entirely. Build one. The empire will thank you.
        </div>
      `)}
      ${foldSection('📊 SCORE — HOW THE LEADERBOARD MEASURES YOU', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Base Score', `The HUD score now mirrors the Hall of Glory formula: <b>${(2000).toLocaleString()}</b> per wave cleared, <b>500</b> per combo tower forged, and <b>400</b> per completed quest. Kills, gold, speed, perfect-wave bonuses, and old event points do <b>not</b> inflate the campaign leaderboard score.`)}
          ${noteCard('Current Wave Rule', 'During a wave, the score assumes you have cleared through the previous wave. Between waves, it counts the wave you just cleared. This keeps the in-game score and leaderboard score aligned instead of showing two different totals.')}
          ${noteCard('Victory Bonus', 'Only a true <b style="color:#ffd34d">W30 campaign clear</b> awards the flat <b style="color:#ffd34d">+40,000</b> victory bonus. Old W20 rows may keep their W badge for history, but they no longer receive the old 20-wave win factor.')}
          ${noteCard('Latin Rank', 'TIRO < MILES (W8+) < CENTURIO (W14+) < LEGATUS (won) < IMPERATOR (won + ≥10 lives) < <b style="color:#ff5050">DIVINUS</b> (won with both Julius Caesar AND God of War on the field).')}
        </div>
      `)}
      ${foldSection('⚡ TIPS & TRICKS — UNCOMFORTABLE TRUTHS', `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px">
          ${noteCard('SHORT PATH = SHORT GAME', 'Every twist you force is another shot fired. Mazing > towers.')}
          ${noteCard('SPAM PROSPECTS', 'Every click costs 1g and shapes the maze. Unkept ones become walls — the "wasted" gold paid for engineering.')}
          ${noteCard('PLACEMENT > QUANTITY', 'Fewer towers in smart spots beats more towers in dumb ones.')}
          ${noteCard('COMBINE OR LOSE', 'Combo towers carry the mid + late game. Refuse to combine and the wave does it for you.')}
          ${noteCard('CHECK RESISTANCES', 'Read the enemy tab before placing. Wrong damage type = enemies walk past unbothered.')}
          ${noteCard('DOT HALVES REGEN', 'Burn / poison / bleed / hellfire counts as damage. Any DoT on a Hannibal / Daemon Imperator / hellhound cuts its heal in HALF (not zero — they still trickle back ~50% of base rate). Net rule: DoT + direct damage breaks regen bosses; DoT alone no longer does.')}
          ${noteCard('DOWNGRADE FOR RECIPES', 'A T4 → T3 for 2g slots into the recipe you were hoarding for. Pride loses runs.')}
          ${noteCard('FLYERS ARRIVE W6 / W12 / W18', 'W6 teaches air. W12-W14 warns with light COMBO-AA plating. After W15, flyers get heavy plating and extra HP, so combo anti-air becomes the primary answer.')}
          ${noteCard('BOSSES REBORN ON LEAK', '10 lives per leak. Boss returns next wave at the HP he had at the gate. Chip damage carries.')}
          ${noteCard('POOL L2 = FIRST DAMAGE', 'L1 only shifts probabilities. +3% damage / level starts at L2 and stacks. Get there fast.')}
          ${noteCard('EMPTY ROUND = +12g', 'Press START WAVE with nothing placed → +12g for strategic patience.')}
          ${noteCard('MERCATOR = T5 ONLY', 'Stocks 10 random Tier 5 base towers at 325g each. Buy missing recipe pieces when they are worth a real campaign investment.')}
          ${noteCard('AURAS ARE NOT DECORATION', 'Violet rings = ally buffs (stand inside). Crimson rings = enemy debuffs (force enemies to cross).')}
          ${noteCard('BOSS-KILL BOUNTY', '+22 + round(wave × 3.5)g per boss kill. W30 ≈ +127g on top of wave gold.')}
          ${noteCard('QUEST TIER BONUS', `+50 / +100 / +200g per cleared tier, +500g for all ${QUESTS.length}. Quest progress = real money.`)}
        </div>
      `)}
      ${foldSection('📜 ROMAN MILITARY HISTORY — LATIN ETYMOLOGY GLOSSARY', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55">
          <p style="margin-bottom:10px;color:#e8d6a8">Every tower name in the roster is a real Latin term from the late-Republic / early-Empire Roman army (with a handful of fantasy hybrids for the apex super-combos). Knowing what each one originally <em>was</em> in history sometimes explains why it fights the way it does in the game — and sometimes the sprite leans into the historical role, sometimes into a more cinematic interpretation. The notes below tag each unit as <b style="color:#88ff88">HISTORICAL</b> (sprite + name + role all match the source-of-truth) or <b style="color:#ffaa55">CINEMATIC</b> (artistic license, name kept for atmosphere).</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            ${noteCard('MILES (Milites)', '<b style="color:#88ff88">HISTORICAL.</b> "Soldier." The generic Roman legionary. Lorica hamata mail, scutum, gladius, red crest. The backbone of every legion from Marius onward.')}
            ${noteCard('VELES (Velites)', '<b style="color:#88ff88">HISTORICAL.</b> Light skirmisher of the manipular legion (pre-Marian Reform, ~3rd-2nd c. BC). Famous for the <b>wolfskin cap</b> the sprite faithfully depicts — they were the legion\'s youngest, threw javelins, and ran back behind the heavy lines once their darts were spent.')}
            ${noteCard('HASTATUS (Hastati)', '<b style="color:#88ff88">HISTORICAL.</b> Front line of the manipular legion. Despite the name (from <i>hasta</i> = spear, a holdover from the early-Republic hoplite phase), classical hastati actually fought with the pilum (javelin) + scutum + gladius the sprite shows.')}
            ${noteCard('TRIARIUS (Triarii)', '<b style="color:#88ff88">HISTORICAL.</b> Third line — the oldest veterans, still kept the long <b>hasta</b> spear after the front lines switched to the pilum. "Things have come to the triarii" became Roman slang for "the situation is desperate." Sprite\'s grey beard + spear + clipeus = period-correct.')}
            ${noteCard('SAGITTARIUS', '<b style="color:#ffaa55">CINEMATIC.</b> "Archer." Real Roman sagittarii were auxilia from Crete, Syria, or Numidia with composite recurve bows and Eastern dress. The sprite leans fantasy-ranger (longbow + hood) but the function is right.')}
            ${noteCard('SCORPIO', '<b style="color:#88ff88">HISTORICAL.</b> Small torsion bolt-throwing artillery piece — each legion fielded ~60 of them. Crewed by two men, accurate enough to pick off named targets at 300m. Sprite shows the two-man crew + frame perfectly.')}
            ${noteCard('DECURION', '<b style="color:#88ff88">HISTORICAL.</b> Commander of a <i>turma</i> (cavalry squadron of ~30 men). In-game he now fights as a close-order melee officer with a one-tile reach.')}
            ${noteCard('CENTURION', '<b style="color:#88ff88">HISTORICAL.</b> Commander of a century (~80 men). The <b>vitis</b> (vine staff) the sprite carries was the centurion\'s badge of office <em>and</em> his beating-stick for disobedient legionaries. Real centurions wore a <em>transverse</em> crest to be distinguished in battle — our sprite has a longitudinal crest, minor artistic license.')}
            ${noteCard('PRIMUS PILUS', '<b style="color:#88ff88">HISTORICAL.</b> "First spear." The most senior centurion in a legion (commanded the First Cohort\'s First Century). Sprite\'s grizzled face + vitis + heavy decoration matches the rank — many primi pili retired to wealthy private estates.')}
            ${noteCard('LEGATUS (Legate)', '<b style="color:#88ff88">HISTORICAL.</b> Senatorial-rank legion commander or imperial deputy. Laurel crown + ornate gold cuirass + eagle-staff in the sprite = textbook Augustan / Antonine era depiction.')}
            ${noteCard('OPTIO', '<b style="color:#88ff88">HISTORICAL.</b> Centurion\'s second-in-command (literally "chosen one"). Carried a hastile staff to keep formation straight from the rear.')}
            ${noteCard('CATAPHRACTUS', '<b style="color:#88ff88">HISTORICAL.</b> Fully armored heavy cavalry, rider AND horse in scale or mail. Eastern (Sarmatian / Parthian) influence — Rome adopted them in the late Empire.')}
            ${noteCard('CLIBANARIUS', '<b style="color:#88ff88">HISTORICAL.</b> Even heavier than the cataphract — sealed in scale armor head-to-toe. The name comes from <i>clibanus</i> (oven) — these knights cooked inside their kit. Late Roman / Byzantine.')}
            ${noteCard('EVOCATUS', '<b style="color:#88ff88">HISTORICAL.</b> "Recalled one." A retired legionary voluntarily re-enlisted under his old general (especially common for Caesar\'s veterans). Bypassed the regular ranks, often given specialist or guard duties.')}
            ${noteCard('PUGIO ASSASSIN', '<b style="color:#88ff88">HISTORICAL.</b> The <b>pugio</b> was the short Roman dagger every legionary carried as a sidearm. Famously the murder weapon of the conspirators against Caesar — 23 pugiones, 23 stab wounds.')}
            ${noteCard('SPECULATOR', '<b style="color:#88ff88">HISTORICAL.</b> Imperial military scout and intelligence officer. Often operated in plainclothes behind enemy lines; later <em>speculatores</em> evolved into the emperor\'s secret police.')}
            ${noteCard('FUNDIBULUS (Funditor)', '<b style="color:#88ff88">HISTORICAL.</b> Slinger auxiliary, usually from the Balearic Islands (Mediterranean Spain) — said to have practiced from childhood by knocking food off poles. Used lead bullets that hit harder than arrows at point-blank. Sprite\'s leather sling + lead shot = perfect.')}
          ${noteCard('EQUES', '<b style="color:#88ff88">HISTORICAL.</b> The Roman <b>eques</b> (plural <b>equites</b>) was both a social class and a gladiator type. The gladiator <i>eques</i> fought on horseback, opening the arena program with a thrown spear from the saddle, then dismounting to finish with a short sword and small round shield. Our sprite reads as a Roman Eques gladiator pressed into legion auxiliary service — the saddle javelin (anti-air sky volley) and short sword (signature 25% triple crit) match the historical fighting style.')}
            ${noteCard('SKIZZER', '<b style="color:#88ff88">HISTORICAL.</b> The sprite shows a Roman <b>Scissor</b> (Latin <i>scissor</i>, "cutter") — one of the rarest gladiator classes, armed with a curved arm-blade strapped onto the forearm in place of a shield-hand. The half-moon weapon was used in slicing strokes rather than thrusts, and the Scissor was traditionally paired against the Retiarius in the arena, the heavy arm-blade designed to chop through the net. The class is attested from late-Republican gladiator schools (Capua, Pompeii) and survived into the early Empire; surviving epitaphs and reliefs depict the same crested helmet + curved chopper this sprite carries.')}
            ${noteCard('LIBRATOR', '<b style="color:#88ff88">HISTORICAL.</b> A <b>librator</b> was an army surveyor who measured ground level for camps + siegeworks (from <i>libra</i>, the balance scale). Our sprite — apron, tablet, weighing rod — is exactly that role. The tower\'s siege output represents the structures these surveyor-engineers built (ramparts, ballistae platforms, breaching ramps).')}
            ${noteCard('TURRIS', '<b style="color:#88ff88">HISTORICAL.</b> Short for <i>turris ambulatoria</i> — the mobile siege tower with archers on the parapet that Romans rolled up to enemy walls. Heavy-siege role fits the visual perfectly. Base DPS <b>75</b> on a slow 0.34/sec reload — each bolt lands roughly <b>220 damage</b> on a clean target, the largest single-shot in the early-game siege roster. Slow but devastating; reward for the long reload. 1.1-tile splash + every-3rd-shot knockback.')}
            ${noteCard('EQUITES', '<b style="color:#88ff88">HISTORICAL.</b> Roman cavalry of the late Republic / early Empire (literally "horsemen"). Our sprite is clearly a mounted skirmisher with cape, crest, and javelin quiver — a textbook eques.')}
            ${noteCard('AQUILA VENATOR', '<b style="color:#ffaa55">CINEMATIC.</b> "Eagle Hunter" — a fantasy coinage for the anti-air specialist. The sprite is a mail-armored Roman auxiliary archer (the closest the real legions had to a dedicated anti-flyer role) so the visual reads correctly. Real Romans had no actual anti-flyer doctrine — the Empire never met a dragon — but the auxilia sagittarii were the unit that <em>would</em> have been retasked if eagles started attacking the gate.')}
            ${noteCard('VENATOR', '<b style="color:#88ff88">HISTORICAL-ish.</b> "Hunter." Auxiliary scout-archer drawn from frontier provinces (Pannonia, Britannia). Our sprite shows a buckskin-armored barbarian hunter — close to the historical type.')}
            ${noteCard('IGNIFER', '<b style="color:#ffaa55">CINEMATIC.</b> "Fire-bearer." Not a real Roman rank — coined for the fire-themed siege tower. Likely inspired by <i>incendiarii</i> (Roman incendiary troops) who used pitch-arrows and fire-bundles.')}
            ${noteCard('FLAMEN', '<b style="color:#88ff88">HISTORICAL.</b> A flamen was a state priest dedicated to ONE god (Flamen Dialis for Jupiter, Flamen Martialis for Mars, Flamen Quirinalis for Quirinus). They were forbidden from touching iron — every detail of their daily life was ritualized.')}
            ${noteCard('AUGUR', '<b style="color:#88ff88">HISTORICAL.</b> Priest who divined the will of the gods by watching bird flight (literally <i>auspicia</i> = "bird-watching"). Caesar served as augur. The college of augurs had veto power over public business.')}
            ${noteCard('HARUSPEX', '<b style="color:#88ff88">HISTORICAL.</b> Etruscan-style diviner who read the gods\' will in animal entrails — specifically the liver. The most senior haruspices advised generals before battle.')}
            ${noteCard('PONTIFEX', '<b style="color:#88ff88">HISTORICAL.</b> Short for <i>Pontifex Maximus</i> — chief priest of the Roman state religion. Caesar held the office. The emperors later absorbed it permanently; the title was eventually inherited by the Pope.')}
            ${noteCard('VESTALIS', '<b style="color:#88ff88">HISTORICAL.</b> A <i>Vestalis</i> (the Vestal Virgins) kept the sacred fire of Vesta — the hearth of Rome itself. Six women, sworn to chastity for 30 years; the only women in Rome who could own property in their own name.')}
            ${noteCard('DRACONARIUS', '<b style="color:#88ff88">HISTORICAL.</b> Late-Empire bearer of a dragon-headed wind-sock banner (the <i>draco</i>), copied from the Sarmatians and adopted around the 4th century AD. The banner howled when wind passed through it — a psychological weapon as much as a unit marker.')}
            ${noteCard('AQUILIFER', '<b style="color:#88ff88">HISTORICAL.</b> Bearer of the legion\'s <b>aquila</b> (eagle standard). Losing the aquila was the worst dishonor a legion could suffer — Augustus spent years recovering the eagles lost at the Teutoburg disaster.')}
            ${noteCard('TESSERARIUS', '<b style="color:#88ff88">HISTORICAL.</b> Third-ranking centurion deputy. Held the <b>tessera</b> — a small wooden tablet with the day\'s watchword. Without it, sentries killed you.')}
            ${noteCard('VEXILLATION / SCOUT VEXILLUM', '<b style="color:#88ff88">HISTORICAL.</b> A <i>vexillum</i> was a square flag; a <i>vexillatio</i> was a detachment pulled out of a legion under that flag for a temporary mission.')}
            ${noteCard('COHORT GUARD', '<b style="color:#88ff88">HISTORICAL.</b> A cohort was 480 men (six centuries) — ten cohorts made a legion. "Cohort guard" reads as a detachment standing watch.')}
            ${noteCard('PRAETORIAN WALL', '<b style="color:#88ff88">HISTORICAL.</b> The Praetorian Guard was the emperor\'s personal guard cohort. They also famously made and unmade emperors — at one point auctioning the throne.')}
            ${noteCard('TURMA LANCERS', '<b style="color:#88ff88">HISTORICAL.</b> A <i>turma</i> was a 30-man cavalry squadron, commanded by a decurion. Three turmae per cohort of cavalry.')}
            ${noteCard('TRIBUNUS', '<b style="color:#88ff88">HISTORICAL.</b> Short for <i>Tribunus</i> — "tribune with the broad stripe." Senatorial-rank young officer (≥18 years old), second-in-command of a legion. The purple <i>latus clavus</i> stripe on his tunic marked his class — a step on the senatorial career ladder.')}
            ${noteCard('TRIPLEX ACIES', '<b style="color:#88ff88">HISTORICAL.</b> The triple battle line. Caesar\'s favorite formation: hastati / principes / triarii in three staggered ranks, with the third reserved for emergencies. "Inde res ad triarios rediit" — "now it falls to the triarii."')}
            ${noteCard('IMPERIUM AETERNUM', '<b style="color:#88ff88">HISTORICAL phrase.</b> "Eternal empire." Roman propaganda for what they believed (and the Senate decreed) was an empire blessed by the gods to never fall. They were wrong by ~1000 years.')}
            ${noteCard('FATEBINDER', '<b style="color:#ffaa55">CINEMATIC.</b> Originally "Consular Fatebinder." A <b>consul</b> was the highest elected magistrate of the Republic — two were elected each year. "Fatebinder" is fantasy. The apex tier nudge: this is the consul who has stopped pretending the gods choose. Display name shortened to just "Fatebinder" for HUD clarity.')}
            ${noteCard('ONAGER / COLOSSUS ONAGER', '<b style="color:#88ff88">HISTORICAL.</b> Literally "wild ass" — the late-Roman / Byzantine torsion catapult that "kicked" violently on release. Crewed by 2-3 men. "Colossus" was a Greek superlative the Romans inherited.')}
            ${noteCard('NEMESIS / NEMESIS ENGINE', '<b style="color:#88ff88">HISTORICAL-ish.</b> Nemesis = Greek goddess of just retribution, adopted into Roman state religion. "Engine" added for the combo-tower flavor.')}
            ${noteCard('JULIUS CAESAR', '<b style="color:#88ff88">HISTORICAL.</b> 100-44 BC. Conquered Gaul. Crossed the Rubicon. Became dictator perpetuo. Got stabbed 23 times by the Senate on the Ides of March. Adopted his great-nephew Octavian who became Augustus and the first emperor.')}
            ${noteCard('HANNIBAL\'S NIGHTMARE', '<b style="color:#88ff88">HISTORICAL reference.</b> Hannibal Barca (247-183 BC) — Carthaginian general who crossed the Alps with elephants and crushed Rome at Cannae. He was Rome\'s greatest opponent. The tower\'s name is what the Romans would have named anti-elephant artillery in their dreams.')}
            ${noteCard('TRIUMVIRATE', '<b style="color:#88ff88">HISTORICAL.</b> Three-man political coalition. First Triumvirate: Caesar + Pompey + Crassus. Second Triumvirate: Octavian + Antony + Lepidus. Both ended in civil war.')}
            ${noteCard('TRIUMPHATOR', '<b style="color:#88ff88">HISTORICAL.</b> A general who had been awarded a <i>triumphus</i> — a victory parade through Rome to the Capitoline. He rode in a chariot painted gold, with a slave behind him whispering "remember you are mortal."')}
            ${noteCard('CORNICEN / CORNU', '<b style="color:#88ff88">HISTORICAL.</b> The cornicen was a Roman military horn-player. Played a curved brass <i>cornu</i> to signal commands across the battlefield — different rhythms = different orders. (Not a tower in this game — referenced in the artwork as a unit-archetype.)')}
            ${noteCard('SIGNIFER (standalone)', '<b style="color:#88ff88">HISTORICAL.</b> Standard-bearer who carried the cohort\'s signum (a pole topped with disks, wreaths, and the open hand for a "manipulus"). Wore an animal skin (bear, wolf, or lion) over his helmet.')}
            ${noteCard('PRAEFECTUS FABRUM', '<b style="color:#88ff88">HISTORICAL.</b> "Prefect of the craftsmen." The legion\'s chief engineer — oversaw the <i>fabri</i> (military craftsmen) who built siege engines, bridges, fortifications. Reported directly to the legate.')}
            ${noteCard('LIBRARIUS', '<b style="color:#88ff88">HISTORICAL.</b> Military clerk (from <i>liber</i> = book). Kept the legion\'s pay rolls, supply records, and casualty lists. A literate soldier — rare and valued.')}
            ${noteCard('VETERANUS', '<b style="color:#88ff88">HISTORICAL.</b> A legionary who had served his full enlistment (25 years under Augustus, 16-20 in the Republic). Veterani received land grants and tax exemption — they were the backbone of imperial colonies founded across the provinces.')}
          </div>
          <p style="margin-top:14px;font-size:10.5px;color:#aa9a4a;font-style:italic;line-height:1.6">The reason any of this matters: when you see a tower\'s name in the codex, you can guess what it does without reading the stats. <b>Hastati</b> = front-line infantry. <b>Speculator</b> = scout / lone hunter. <b>Pontifex</b> = state religion = divine damage. <b>Cataphract</b> = heavy cavalry = melee + speed. The names are mnemonic — use them.</p>
        </div>
      `)}
    `;
  }
  if (tab === 'QUESTS') {
    // Show all quests grouped by tier with reward labels. Completed quests
    // (ids present in state.completedQuests) get a green ✓ stamp + a green
    // border and faded body so the player can see progress at a glance.
    const TIER_COL: Record<string,string> = { EARLY:'#88ddff', MID:'#ffd34d', LATE:'#ff5050' };
    const completedSet = new Set(lastCtx.completedQuests ?? []);
    const totalDone = completedSet.size;
    const rewardLabel = (q: any) => {
      const r = q.reward;
      if (r.kind === 'GOLD') return `+${r.amount}g`;
      if (r.kind === 'ITEM') return `Item: ${(r.item ?? '').replace(/_/g,' ')}`;
      if (r.kind === 'TOWER') return `Tower: ${r.towerType} T${r.towerTier}`;
      if (r.kind === 'LIFE') return `+${r.amount} life`;
      return '';
    };
    const groupHtml = (label: string, list: any[]) => {
      const doneInGroup = list.filter((q: any) => completedSet.has(q.id)).length;
      return `
      <div style="margin-top:10px">
        <div style="color:${TIER_COL[label]};font-weight:bold;letter-spacing:2px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:baseline">
          <span>▸ ${label} GAME</span>
          <span style="color:#88ff88;font-size:10px;letter-spacing:1px;font-weight:normal">${doneInGroup}/${list.length} CLEARED</span>
        </div>
      ${list.map((q: any) => {
        const done = completedSet.has(q.id);
        const borderCol = done ? '#88ff88' : TIER_COL[label];
        const bg = done ? '#0a1208' : '#0c0a08';
        const titleCol = done ? '#88ff88' : TIER_COL[label];
        const blurbCol = done ? '#7a9970' : '#cdb98a';
        const check = done ? '<span style="color:#88ff88;font-weight:bold;margin-right:6px">✓</span>' : '';
        const status = done ? '<span style="color:#88ff88;font-size:10px;letter-spacing:1px;margin-left:6px">[CLEARED]</span>' : '';
        return `<div style="background:${bg};border-left:3px solid ${borderCol};padding:6px 10px;margin-bottom:4px${done ? ';opacity:0.92' : ''}">
        <div style="color:${titleCol};font-weight:bold;font-size:12px">${check}${q.title}${status}</div>
        <div style="color:${blurbCol};font-size:10px;line-height:1.4;margin-top:2px">${q.blurb}</div>
        <div style="color:#88ff88;font-size:10px;margin-top:2px">→ ${rewardLabel(q)}</div>
      </div>`;
      }).join('')}
      </div>`;
    };
    const early = QUESTS.filter((q: any) => q.tier === 'EARLY');
    const mid   = QUESTS.filter((q: any) => q.tier === 'MID');
    const late  = QUESTS.filter((q: any) => q.tier === 'LATE');
    return `
      ${section('QUESTS — RUN-LONG OBJECTIVES', `
        <p style="color:#cdb98a;line-height:1.55;margin:4px 0">
          Goals you complete during a run grant gold, items, or even free tower placements. Quests track automatically — your active progress is shown in the bottom-right HUD panel. Rewards scale with the tier (early/mid/late game).
        </p>
        <div style="background:#0a1208;border:1px solid #2a4a20;padding:6px 10px;margin:6px 0;color:#88ff88;font-size:11px;letter-spacing:1px">✓ ${totalDone} / ${QUESTS.length} QUESTS COMPLETED THIS RUN</div>
        <div style="background:#1a1410;border:2px solid #d4af37;padding:10px 12px;margin:8px 0;font-size:11.5px;color:#cdb98a;line-height:1.55">
          <div style="color:#ffd34d;font-weight:bold;letter-spacing:2px;margin-bottom:5px">🏆 TIER COMPLETION BONUSES</div>
          On top of each quest\'s individual reward, you bank a one-time gold bonus for clearing a whole tier:<br/>
          • All ${early.length} <span style="color:#88ddff;font-weight:bold">EARLY</span> quests → <b style="color:#88ff88">+50g</b><br/>
          • All ${mid.length} <span style="color:#ffd34d;font-weight:bold">MID</span> quests → <b style="color:#88ff88">+100g</b><br/>
          • All ${late.length} <span style="color:#ff5050;font-weight:bold">LATE</span> quests → <b style="color:#88ff88">+200g</b><br/>
          • <b style="color:#ffd34d">Clear all ${QUESTS.length}</b> → an additional <b style="color:#88ff88">+500g grand-completion capstone</b> on top of the LATE bonus.
        </div>
        ${groupHtml('EARLY', early)}
        ${groupHtml('MID',   mid)}
        ${groupHtml('LATE',  late)}
      `)}`;
  }
  if (tab === 'MECHANICS') {
    return `
      ${foldSection('WAVE-LEVEL MECHANICS', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('🌫 Faction Weather', 'Each faction brings an environmental effect that visually transforms the map AND mechanically pressures towers. Boss waves intensify by ×1.5. Read the chip in the top-left of the play area for the active penalty.')}
          ${noteCard('Druidic Mist (Celts)', '20% miss chance + −0.5 tile range. Towers will whiff a real chunk of shots. Plan extra DPS or melee.')}
          ${noteCard('Saharan Sandstorm (Carthage)', '−1 tile range + 5% miss chance. Long-range siege engines (Scorpio, Carroballista) feel the bite the most.')}
          ${noteCard('Necrotic Miasma (Undead Celts)', '−15% attack speed. Fast units (Pugio Assassin, Eques) lose more output proportionally.')}
          ${noteCard('Cursed Wind (Undead Carthage)', '−35% status duration. Slow/freeze/burn builds weaken. Lean on raw damage instead.')}
          ${noteCard('Hellscape (Super Demons)', 'Combo penalty: 8% miss, −0.5 range, −10% atk speed, −20% status. Plus a final-fight ember overlay.')}
          ${noteCard('Pack Dust (Dogs)', 'Light haze, 3% miss only. Cosmetic for early-game.')}
        </div>
      `, true)}
      ${foldSection('WAVE MODIFIERS (CUT — Endless removed in v2)', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.6;margin-bottom:8px;background:#0c0a08;padding:10px 14px;border-left:3px solid #a060ff">
          <b style="color:#a060ff">Endless-mode mechanic.</b> Wave modifiers do <b>NOT</b> roll during the 30-wave campaign, which is fully deterministic. These mutations only appear in Endless, where the procedural generator rolls 1-3 of them per wave (stacking more as you climb). Listed here so you know what Endless can throw at you.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('🔴 Blood Moon', 'Every enemy in the wave has +25% HP and a crimson tint. A pure stat wall.')}
          ${noteCard('⚡ Storm Surge', 'Every 8s a random enemy is struck by lightning, gaining +50% speed for 3s. A blue impact ring marks the target.')}
          ${noteCard('🟣 Death Pact', 'Each kill heals every other surviving enemy 4% HP. Trade kills late = enemies regen most of it back. Burst hard.')}
          ${noteCard('🌫 Veil', 'Every 6s, all enemies become untargetable for 0.8s — they fade to 40% alpha. DoTs keep ticking, but new shots cannot acquire them. Time your big shots for the gaps.')}
          ${noteCard('👻 Revenant', 'Every dead enemy silences the nearest tower for 1.5s as a ghost. A pink X-mark flashes on silenced towers.')}
          ${noteCard('🟠 Group March', 'Bunched enemies (3+ within 2 tiles) gain +20% speed. Maze-induced clustering is now risky.')}
        </div>
      `)}
      ${foldSection('⚠ SURPRISE EVENTS — scheduled chaos', `
        <div style="margin-bottom:8px;padding:10px 12px;background:#2a0c08;border:2px solid #ff7733;color:#ffd1cc;font-size:12px;line-height:1.5">
          <b style="color:#ff7733">Fixed campaign schedule.</b> Invasion on W7, W18, and W29; Uprising on W11, W14, and W23; Gates of Hell on W16 and W27. Late versions add sustain, status resistance, checkpoint pressure, and stronger commander-era pacing. Endless mode rolls one on ~75% of waves (2-wave cooldown). Each event pays a 3-card LEGENDARY reward on clear.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('⚔ Invasion (W7, W18, W29)', 'Perimeter fires light up around the entire map — one per ground enemy in the wave queue. Each invader walks in from its own edge tile toward the path, converging on the middle. Cave spawn is disabled for the ground wave; flyers still use the flyer path. Late invasion enemies move faster and bring sustain/status pressure.')}
          ${noteCard('☠ Skeletal Uprising (W11, W14, W23)', 'A single skull urn rises from the dead center tile of the map. Enemies pour from that one point in bursts of four. Screen washes purple, dissonant organ stab plays. W23 is the late crypt check: stronger sustain, checkpoint healing, and status resistance.')}
          ${noteCard('🔥 Gates of Hell (W16, W27)', 'FOUR destructible Hell Gates rise — two flanking WP3, two flanking WP4 — and round-robin Fire Giants every ~1.5 seconds for 12 seconds (~8 giants total). Hell Gates and Fire Giants have at least 2,000,000 final HP after event scaling. Destroy gates early to cut their contribution to the rotation. W27 giants are faster and tougher. <b style="color:#a060ff">Every Fire Giant kill drops a guaranteed EPIC item.</b>')}
          ${noteCard('🎁 Reward', 'Each event opens a 3-card LEGENDARY choice modal on clear (Hellgate Brand / Demonsworn Crown / Inferno Standard for Gates of Hell; Invasion + Uprising have their own thematic pools). Inventory must have room — full inventory at pick time forfeits the reward.')}
          ${noteCard('🛡 Portals are cosmetic', 'Fires and urns can\'t be destroyed — they light up, deliver their enemies, and fade. The exception is Gates of Hell, where the gates themselves ARE targetable. Focus fire on the spawned enemies otherwise.')}
          ${noteCard('🎵 Audio cues', 'Invasion: heavy low-brass descending triad. Uprising: church-organ stab + bone rattle. Gates of Hell: cavernous hiss + fire-pit crackle. Each event is identifiable by sound alone.')}
        </div>
      `)}
      ${foldSection('WAVE STRUCTURE', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Boss Crescendo (v2: W5/10/20/24/30)', 'Milestone bosses: <b>W5</b> Brennus, <b>W10</b> Hannibal, <b>W20</b> Vulture Imperator (flyer), <b>W21</b> Khan, <b>W24</b> Anubis King, and the <b>W30</b> Daemon Imperator finale. <b>Basic-enemy HP doubles</b> each cleared milestone boss; <b>bosses scale linearly</b> so each is a real step, not a wall. <b>Tower damage gains +50% per cleared boss</b> to partly keep pace. Late boss waves keep escorts so W20/W21/W24 are real campaign steps.')}
          ${noteCard('⚔ TEST YOUR MIGHT (Wave 10.5 — optional, ALL OR NOTHING)', 'After clearing W10, Rome offers an OPTIONAL bonus gauntlet — a separate <b>Wave 10.5</b>, not the start of W11. Difficulty sits around the <b style="color:#ff7733">W15/W16 band</b>: ground-heavy boss pressure, commander auras, and challenge-only resistances — deliberately above your pay grade at that point. Accepting gives you a <b style="color:#88ff88">full prep window</b> (build, shop, combine) before you press START. Clear it with <b>zero leaks</b> and the payout is huge: <b style="color:#ffd34d">+3,000 gold, a free Tier-5 Scorpio to place, and a random LEGENDARY item</b> from its boss. But understand the wager: <b style="color:#ff5050">if even ONE enemy reaches Rome during the challenge, the run ENDS immediately — instant game over, no lives math.</b> Declining is completely free and the campaign continues to W11 as normal. Accept only when your maze is already overbuilt.')}
          ${noteCard('Iron Phalanx (W17)', 'Melee-immune and SIEGE-immune Iron Phalanx that also phase the first 2 ranged hits. Bring sustained ranged DPS, fire, and DoT to break through.')}
          ${noteCard('Bonus / Twin Bosses (CUT — Endless removed in v2)', 'Twin and bonus bosses are an <b style="color:#a060ff">Endless-mode</b> feature. The 30-wave campaign spawns <b>NO</b> extra bosses (its boss schedule is fully deterministic; the old W15 25% twin-boss roll was removed). In Endless, a wave can roll an extra boss alongside the authored one. Kill him: <b style="color:#88ff88">2.5× wave gold +50g flat, +2 lives restored, +1 free RARE item, +3000 score</b>. Let him leak: 10 lives AND he returns next wave at the HP he leaked at (chip damage carries). Banner: 🎲 TWIN BOSSES.')}
          ${noteCard('Ambush Bosses (CUT — Endless removed in v2)', 'Also an <b style="color:#a060ff">Endless-mode</b> mechanic. The campaign never ambushes you with a surprise boss (the old W17-W19 15% roll was removed). In Endless, a non-boss wave can ambush you with an extra boss. Same payout: <b style="color:#88ff88">2.5× wave gold +50g +2 lives +1 RARE item +3000 score</b> if killed, 10 lives per leak otherwise. Banner: 🎲 AMBUSH BOSS. A free UNCOMMON item drops on ARRIVAL as a consolation, whether you finish him or not.')}
          ${noteCard('Wave Modifier (CUT — Endless removed in v2)', 'Random mutations (Blood Moon / Storm Surge / Death Pact / Veil / Revenant / Group March) are an <b style="color:#a060ff">Endless-mode</b> mechanic; they do <b>NOT</b> roll in the 30-wave campaign, which is fully deterministic. In Endless, 1-3 stack per wave: the gods drop a <b>free Uncommon item</b> on arrival, and surviving pays an extra <b style="color:#88ff88">+60g RNG bonus + 4000 score</b>. The modifier rolls AFTER you press START, so build resiliently. The TOP-RIGHT chip pulses while an RNG wave is active; tap or hover the <b>"RNG WAVE"</b> tag for the exact mechanic + survival reward.')}
          ${noteCard('Empty Round Bonus', 'If you press START WAVE without placing anything (no prospects revealed, no items bought, no pool upgrades, no combos), you earn +12g for strategic patience.')}
          ${noteCard('Perfect Wave Bonus', 'Clear a wave with <b style="color:#88ff88">zero leaks</b> — every enemy killed before reaching Rome — and you earn staged bonus gold on top of the wave reward: <b style="color:#ffd34d">+10g W1-5</b>, <b style="color:#ffd34d">+20g W6-10</b>, <b style="color:#ffd34d">+35g W11-20</b>, <b style="color:#ffd34d">+50g W21-30</b>. A gold ring flashes at the gate to mark the clean defense.')}
          ${noteCard('30-Wave HP Curve', 'BASIC enemies: HP climbs <b>+10% per wave linearly</b>, plus an extra <b>+10% per wave from W11</b>, plus another <b>+15% per wave from W12</b>, all multiplied by <b>2.00× per cleared milestone boss</b>. BOSSES: linear-only progression — they ignore the per-5-wave doubling and only ride the linear stack. Each boss feels like a real step heavier than the last, not a brick wall.')}
        </div>
      `)}
      ${foldSection('ENEMY SIGNATURES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Out-of-Combat Regen', 'Ghost Rider, Hannibal, and Daemon Imperator regen X% HP/s after 1.0s without taking <b>direct</b> damage. <b style="color:#ff7733">Active DoTs (burn / poison / bleed / hellfire) now reduce regen by 50%</b> (was 100% — they used to shut it off completely). Hannibal still heals at ~0.84%/s and Daemon Imperator at ~1.4%/s while burning, so you need <b style="color:#88ff88">DoT AND direct damage</b> to actually break a regen boss; a single Poisoned Blade alone is no longer enough. (<b style="color:#88ddff">Note:</b> Both druids — Gallic Druid AND Zombie Druid — no longer regenerate. Druid pressure is now strictly the shield/sleep curse/heal-aura layer, not a per-druid HP timer.)')}
          ${noteCard('Phoenix Rebirth', 'Spectral Scout, Celtic Fire Demon, and Undead Celt burst into <b style="color:#ffaa66">3 reduced-HP minions</b> on death — each at 40% / 35% / 25% HP respectively. The original kill still counts; the minions cannot chain-phoenix when killed. Orange impact ring marks the burst. Plan on roughly 3× the kill budget for these enemies and stack DoTs that tick through respawns.')}
          ${noteCard('Phase-Through Hits', 'Spectral Scout (2), Iron Phalanx (2), Celtic Berserker (1), Undead Berserker (1), Undead Spearman (1), Carthage Spearman (1) ignore the first N hits taken — a "MISS" floater pops on each phased shot.')}
          ${noteCard('Dodge (ranged)', 'Gallic Druid (30%), Numidian Rider (20%), Ghost Rider (15%), Shadow Cavalry (25%) have a chance to dodge incoming ranged / siege attacks. Melee always lands.')}
          ${noteCard('Stealth Cycle', 'Ghost Rider (~0.8s every 5s) and Shadow Cavalry (~1.0s every 6s) fade to untargetable on a regular pulse — towers cannot acquire them while stealthed.')}
          ${noteCard('🥷 Ambush Stealth', '<b style="color:#a078d0">Carthage Spearman (W7-W10) and Undead Berserker (W13/W15)</b> emerge from cover during the opening seconds of their wave. For the <b>first 10 seconds</b> of each wave, any alive instance of these enemies is UNTARGETABLE — towers visually see the silhouette at 40% opacity but cannot acquire. When the 10-second window expires, EVERY alive instance becomes targetable simultaneously (a coordinated "the line emerges" beat). Spawns AFTER the 10s window are normally targetable from spawn. <b style="color:#88ff88">Counters:</b> melee blockers + cleave towers can soak the emergence wave; AURA towers (Triarius +12%, Caesar +10%) make the post-emergence kill window sharper.')}
          ${noteCard('Healer Enemies', 'Zombie Druid (1.8% HP/s) and Demon Legate (1.5% HP/s) emit a 1.8-tile heal ring that restores HP to nearby allies (NOT bosses). <b style="color:#88ddff">Heal does NOT stack</b> — multiple healers on the same target apply the highest rate (1.8% / 1.5%), not the sum. Kill the healers first; the cluster regen pressure ends with the last healer down. (<b style="color:#88ddff">Gallic Druid no longer heals</b> — its W4 role is the sacred-ward shield + the tower-slow aura.)')}
          ${noteCard('Split-on-Death', 'Demon Hellhound splits into 2x Feral Dogs (35% HP each). Celtic Fire Demon splits into 1x Demon Hellhound (50% HP). Spawned children continue the path from where the parent fell.')}
          ${noteCard('Low-HP Speed Burst', 'Rabid Dog, Celtic Berserker, Demon Hellhound surge +50–60% speed when below 30% HP. Finish them or they leak.')}
          ${noteCard('Tower Silence', 'Spectral Scout / Ghost Rider passing within 1 tile of a tower silences it for 0.6s. Pink X-mark icon. Position power towers off the path.')}
          ${noteCard('🤫 Silence Aura (NEW 2026-05-21)', '<b style="color:#a078d0">Zombie Druid (W11+) and Architectus (W17+)</b> project a sustained <b>1.5-tile silence aura</b> while alive. Any tower inside the radius gets a refreshing pink X-mark and cannot fire. The silence expires ~0.6s after the enemy walks out of range, so towers wake up cleanly when the threat moves on. Distinct from the pass-by silence above (one-shot 0.6s pulse) — this is a sustained denial-while-near. Zombie Druid stacks this with its sleep curse + tower-slow aura for triple-disruption identity. <b style="color:#88ff88">Counters:</b> deep ranged stations off the path stay untouched; bash the druid\'s shield to break it before it reaches your kill funnel.')}
          ${noteCard('Checkpoint Heal', 'Celtic Berserker, Sacred Band (Carthage Elite Guard), Undead Celt, Undead Berserker, and Undead Spearman regain <b style="color:#66ff88">15% maxHP</b> the first time they cross each of the 7 waypoint coins. Each checkpoint pays out once per enemy. A green ✚ plus-pulse marks the heal. Bosses and flyers are exempt — kill the stubborn grunts BEFORE the next coin or they walk back to full. <b style="color:#aaffaa">W11 exception:</b> the checkpoint heal is suppressed on the W11 undead intro so the 42x Undead Celt + necromancy reanimation wave doesn\'t stack three slog mechanics at once. W14 + W15 keep the heal active on the same enemy.')}
          ${noteCard('Necromancy', '<b style="color:#ff9933">Two trigger paths:</b><br/>• <b>Tagged necromancy waves (W11 + W13):</b> every Celtic Footman, Celtic Berserker, Gallic Druid, Carthage Spearman, Undead Celt, Zombie Druid, or Undead Berserker you kill spits a purple portal and reanimates undead at the death tile.<br/>• <b>Always-on for undead factions:</b> every Undead Celts / Undead Carthage minion (Undead Celt, Zombie Druid, Undead Berserker, Spectral Scout, Undead Spearman, Ghost Rider, Architectus) reanimates on death regardless of the wave tag. Bosses + flyers are exempt, and risen units don\'t chain (a reanimation flag stops the loop). Plan on 7-8× the kills on any late-wave undead lineup.<br/><br/><b style="color:#ff7733">Per-kill count:</b> <b>6-9 risen</b> (distribution 45% / 35% / 15% / 5%), each at 85-100% HP. Skeleton-axe for berserker types, blue zombie for footman / spearman types, hooded green-flame lich for druid types.')}
          ${noteCard('Gold Theft (Ghost Rider)', 'On leak, Ghost Rider also steals 5g + floor(wave/10)g from your treasury. A W18 ghost steals 6g per leak.')}
          ${noteCard('🛡 Shielded Units', '<b style="color:#9be0ff">Gallic Druid (W4 sacred ward)</b>, <b style="color:#9be0ff">Carthage Elite Guard (W8)</b>, <b style="color:#9be0ff">Undead Spearman (W16+)</b>, and <b style="color:#9be0ff">Architectus (W18+)</b> cannot be targeted by ranged towers until a melee tower hits them. <b style="color:#ffe066">SHIELD BASH:</b> the first melee hit on a still-shielded enemy deals <b style="color:#ffe066">+50% damage</b> — the legionary slams his pommel into the scutum before the shield gives way. Applies to both single-target swings AND cleave secondaries; stacks multiplicatively with armor shred, faction resist, and item bonuses. A golden impact ring marks the bash that breaks the shield. The W4 druid intro is a clean teaching wave — no regen, no heal aura, just shields + tower-slow aura, so the player can focus on learning the melee-bash flow.')}
          ${noteCard('Tower-Slow Aura', 'Gallic Druid, Zombie Druid, Demon Legate emit a 2-3 tile aura that slows tower attack speed by 20–30%. Kill these support units fast.')}
          ${noteCard('💤 Sleep Curse', '<b style="color:#aaccff">Druids and Naga casters can sleep towers</b>. They root in place for a short telegraphed channel, then launch a slow cyan/purple homing orb at the nearest awake tower in range. On hit, that tower is <b style="color:#aaccff">fully inert</b> — no targeting, no shots, ZZZ animation overhead. <b style="color:#88ddff">Naga sleep magic only targets LAND towers; ocean towers are safe.</b> Counters: kill the caster before the dart lands, or STUN/FREEZE the caster mid-channel.')}
          ${noteCard('🛡 Elephant Dust Shield', '<b style="color:#cdb98a">War Elephants and Undead War Elephants project a 4-tile dust dome</b> that makes every NEARBY GROUND enemy untargetable by ranged towers until the elephant dies. Visual: dust-brown rotating dome around the elephant + small gold sparkle over each protected ally. The elephant itself stays ranged-targetable, but it is now a heavy-hide tank. <b style="color:#88ddff">Melee towers ignore the dust</b> — they hit allies inside the dome normally. Best counter: <b style="color:#ff9933">siege towers</b>, though living elephants only take +25% and undead elephants only +5% from siege.')}
          ${noteCard('Status Immunities', 'Rabid Dog (slow), Celtic Berserker (slow), Undead Berserker (freeze/poison/stun), Undead Celt (poison), Zombie Druid (poison), Undead Spearman (poison), Reanimated Skeleton (freeze/poison), Reanimated Zombie (poison), Reanimated Lich (poison). Inspect enemies to see exact resists.')}
        </div>
      `)}
      ${foldSection('BOSS SIGNATURES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('🐺 Alpha Dog (W3 champion)', 'Frenzy at 30% HP doubles speed. Pack Howl every 8s grants +50% speed to nearby Feral Dogs. Death spawns 3 Feral Dogs. <b style="color:#ff9933">Always drops a LEGENDARY on kill</b> — the first guaranteed marquee reward of the run.')}
          ${noteCard('⚔ Brennus (W5)', 'The Celtic chieftain who sacked Rome in 387 BC, named for the Senonian war-king. War Cry at 70% HP grants +30% speed to all Celts for 8s. Otherwise a clean straight-up fight to the death — no rebirth, no surge, no necromancy on his wave. <b style="color:#ff9933">Always drops a LEGENDARY on kill</b> — the first scheduled marquee boss reward of the run.')}
          ${noteCard('🐘 War Elephant (W9 + W10 boss adds)', 'STAMPEDE at 50% HP: status-immune + 75% speed for 4s; strips slow/freeze/stun. Permanently <b style="color:#88ddff">SLOW + FREEZE IMMUNE</b>. <b style="color:#ff7733">Tower-Slow Aura</b>: every tower within 2 tiles fires 20% slower. <b style="color:#ff5050">TUSK QUAKE</b>: every 6s silences every tower within 2 tiles for 0.6s (a dust-brown ring marks the pulse). The Undead variant cranks the aura to 25%. <b style="color:#cdb98a">DUST-SHIELD AURA</b>: a 4-tile dome around the elephant makes nearby GROUND allies untargetable by ranged towers until the elephant dies. Melee + the elephant itself stay targetable. <b style="color:#ff9933">HEAVY HIDE:</b> much higher HP, light sustain, and only +25% damage from SIEGE. Poison and bleed barely matter. <b style="color:#5ca0ff">W9/W10 elephant kills have an 80% chance to drop a RARE item.</b>')}
          ${noteCard('⚔ Hannibal Barca (W10)', 'Heals 0.4%/s while War Elephants live (only when not taking DIRECT damage). Out-of-combat regen 1.7%/s. <b style="color:#ff7733">DoT (burn / poison / bleed / hellfire) reduces both heals to 50% (was 100% block).</b> A single Poisoned Blade alone is no longer enough — you need DoT + direct damage to actually break him. REBIRTH at 55% HP: heals to 65% HP, +60% speed, status-immune, summons 2 War Elephants. <b style="color:#ff5050">TELEGRAPH:</b> a shrinking red lock-on ring + crosshairs appear on him 1 second before rebirth fires — use that window to burst him into a different timeline.')}
          ${noteCard('🐘💀 Undead War Elephant (W14 champion)', 'Stampede at 50% HP. REBIRTH at 40% HP: summons 2 Ghost Riders. Heavy regen. <b style="color:#cdb98a">DUST-SHIELD AURA</b>: a 4-tile dome around the elephant blocks ranged shots on nearby ground allies until it dies. Tower-slow aura cranked to 25% (vs 20% on the living variant). <b style="color:#ff9933">DENSE BONE HIDE:</b> higher HP and only +5% damage from SIEGE. Fire still helps; bleed and poison do nothing.')}
          ${noteCard('💀 Undead Warlords ×5 (W15)', '<b style="color:#ff5050">W15 now spawns FIVE Undead Warlords.</b> 5s after spawn each warlord triggers its own AMBUSH — <b>10 Undead Berserkers</b> rise at mid-path (50 berserkers total if all five fire). Each warlord also triggers NECROMANCY at 40% HP (6 Undead Celts at his position) and FINAL UPRISING at 15% HP (5 more Undead Celts). <b style="color:#ff5050">DEATH RATTLE:</b> the killing blow spits out <b>20 more undead</b> at the warlord\'s death tile (6 Undead Berserkers + 14 Undead Celts, each at 30% HP) — so a clean kill chain can summon <b>75+ risen units</b> per warlord. Plan a path-segregating maze and stagger the warlord kills — letting them all crater at once will flood the field. Heavy AoE / siege builds with Scipio active eat them; otherwise focus-fire one warlord clean before the next dips low.')}
          ${noteCard('😈 Daemon Imperator (W30 — final boss)', 'Base speed 0.85 tiles/sec. HELLSCAPE every 12s stuns nearby tower cooldowns (towers within 5 tiles take a 1.5s cooldown stamp on each pulse). Out-of-combat regen 2.8%/sec. <b style="color:#aaffaa">DOT-RESISTANT:</b> poison and bleed both tick at 30% effectiveness (fire is fully immune). Direct damage + DIVINE (~1.40× final after faction × per-enemy damper) carry the fight, not chip ticks. <b style="color:#88ddff">W30 brings elite escorts, air pressure, and mythic bruisers.</b> <b style="color:#ff5050">The Daemon himself cannot breach Rome; escorts use normal leak costs.</b>')}
        </div>
      `)}
      ${foldSection('⚔ v2 LATE-GAME GAUNTLET (W21-30) — NEW UNITS', `
        <div style="font-size:11px;color:#cdb98a;margin-bottom:6px">The campaign now runs to <b>W30</b>. A second cave (<b>CAVE B</b>) erupts open on the left at W21 and mirrors every ground non-boss spawn from the main gate — hold both lanes because both gates send the same ground count.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('🦅 Vulture Imperator (W20 boss flyer)', 'Egyptian undead vulture. <b>DIVE BOMB</b> every 8s: -40% attack speed for 4s on your highest-kill tower. <b>FLOCK CALL</b> at 50% HP: summons 3 escort Sphinx flyers. Melee-untargetable + fire-immune + ranged-resistant + <b style="color:#ff5050">SIEGE-IMMUNE</b> — answer it with anti-air DIVINE, storm, marks, and non-siege flyer killers.')}
          ${noteCard('🗿 ROMAN-MYTH faction (W25-29)', 'The old monsters of legend. <b style="color:#cdb98a">Tough vs steel / fire / siege</b> but <b style="color:#fff4a8">+40% WEAK to DIVINE</b> — the gods smite them. Bring Solar Priest, Augur, Pontifex, or Mars Victor.')}
          ${noteCard('🦁 Chimera + 🐺 Cerberus', 'Chimera <b>FIRE BREATH</b>: every 3s, -30% atk speed for 2s on towers within ~2 tiles. Cerberus <b>TRIPLE HOWL</b>: a one-time +25% speed surge to nearby myth allies.')}
          ${noteCard('🐍 Typhon + 👁 Cyclops', 'Typhon <b>SERPENT STORM</b>: every 5s, silences towers within ~3 tiles for 1.5s — the W29 capstone. Cyclops <b>EYE BLAST</b>: every 6s, fully blinds the single nearest tower for 2s.')}
          ${noteCard('🪨 Giant + COLOSSUS MERGE (W28)', 'Giant <b>GROUND SLAM</b>: a -35% atk-speed aura. <b style="color:#ff5050">MERGE</b>: two Giants within 1.5 tiles past Checkpoint 2 fuse over 1.5s into <b>COLOSSUS GIGAS</b> (sumHP×1.3 + Titan Stomp + Colossal Regen). Kill the Giants apart, or DIVINE them down before they meet.')}
          ${noteCard('☠ Plague Bearer + 🛡 Medjay', 'Plague Bearer: a continuous <b>PLAGUE AURA</b> (-25% tower atk speed) plus a <b>PLAGUE BURST</b> at ≤20% HP (-40% atk speed for 5s, ~2.5 tiles); poison-immune. Medjay Soldier: a shield-block tank that needs a melee break.')}
          ${noteCard('🏛 Mars Victor (Siege+Divine apex — fuses all 6 heroes)', 'Recruit the <b>6 CHAMPIONS OF ROME</b> at Mercator (1000g each: Marius, Agrippa, Agricola, Scipio, Caesar, Sulla) and combine all six → <b>MARS VICTOR</b>. <b style="color:#ffd34d">2400 DPS</b> (far more than the six heroes combined after a 6000g recruitment path), range 9, crit 35% × 3.6, wide-splash Wrath that lands as <b style="color:#fff4a8">BOTH Siege and Divine</b> (resolves against whichever the target resists less). <b style="color:#fff4a8">FUSES EVERY HERO PASSIVE into one army-wide aura while it stands:</b> +35% damage AND +20% attack speed to EVERY tower, <b>ALL towers may strike flyers</b> (Agricola), and +25% damage vs bosses and commanders (Scipio). <b style="color:#ff8844">TRIUMPH OF MARS:</b> every 3rd hit unleashes a divine shockwave that smites everything within 3.5 tiles for TRIPLE damage. Never gambled or bought, only forged from the six Champions. The single biggest power spike in the game.')}
        </div>
      `)}
      ${foldSection('ELITE MUTATIONS (4-20% chance, mid-late game)', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('🛡 Veteran (bronze ring)', '+50% HP. Pure tank — sponges your kill window.')}
          ${noteCard('💨 Swift (green ring)', '+50% speed. Outruns slow towers, leaks fast.')}
          ${noteCard('💥 Bloated (purple ring)', '+120% HP. On death, splits into 3 minions at its location. Kill mid-path with caution.')}
          ${noteCard('✨ Warded (blue ring)', 'All status effects are 30% as effective. Slow/freeze barely register.')}
          ${noteCard('⭐ Aura-Star (gold ring)', 'Allies within 3 tiles get +30% speed. Kill the star first.')}
        </div>
      `)}
      ${foldSection('TOWER SIGNATURES', `
        <div style="font-size:11px;color:#cdb98a;margin-bottom:6px;line-height:1.45">Per-tower mechanics that aren\'t obvious from the stat line. Click any tower on the field for its full breakdown — these are just the unusual ones worth memorizing.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${noteCard('Cleave Melee', 'Hits ALL enemies in melee range, secondaries take 70%. Towers: Hastati, Triarius, Cohort Guard, Praetorian Wall, Imperator Guard, Vexillation, Triumphator, Triplex Acies.')}
          ${noteCard('Multi-Shot Ranged', 'Multiple bolts per attack. Decurion (2), Carroballista (2), Eques (3), Hannibal\'s Nightmare (2), Scorpion Bolt (3), Aurora Legion (4 piercing), Carthage Scourge (6).')}
          ${noteCard('Anti-Air Only', 'Sagittarius, Aquila Venator, and Skyreaper Battery ignore ground entirely. Dead weight on ground waves, devastating on flyers.')}
          ${noteCard('Aerial Plating (W12+)', 'Later flyer waves can carry <b style="color:#88ddff">COMBO-AA</b> plating. W12-W14 is the warning. W18+ is the wall: non-combo towers lose heavy direct damage into flyers, while combo anti-air pierces it: Scorpion Bolt, Eques, Nemesis Engine, Beastlord Champion, Storm Ballista, Skyreaper Battery, Sky Dominion, and higher apex towers.')}
          ${noteCard('Trident & Net (Retiarius)', 'First hit on a new target = 2× damage. Armor Shred every strike.')}
          ${noteCard('Brutal Opener (Accensus)', '+75% damage above 85% HP. Front-load damage on fresh enemies.')}
          ${noteCard('Backstab (Pugio Assassin)', '+50% vs Runner archetype.')}
          ${noteCard('Marked Prey (Venator)', 'Hits on flyers Mark them for +25% damage from any source.')}
          ${noteCard('Spotter (Speculator)', 'Applies Mark (+15%) AND Armor Shred together.')}
          ${noteCard('Tactical Stacks (Evocatus)', '+5% damage per kill, capped at +50%. Kept Evocati get terrifying.')}
          ${noteCard('Foresight (Haruspex)', '20% chance to double-strike.')}
          ${noteCard('Solar Flare (Solar Priest)', 'Damage IGNORES faction resists. The endgame answer to Undead / Demons.')}
          ${noteCard('Earthshatter (Colossus Onager)', 'Every hit knocks target back along the path.')}
          ${noteCard('Siege Kickback (Turris)', 'Every 3rd shot knocks target back.')}
          ${noteCard('Charge + Venom (Horseman)', 'Every hit MARKS (+20%) AND applies POISON (5% maxHp/sec, 4s).')}
          ${noteCard('Trample (War Chariot)', 'Every 4th attack stuns + knocks back ground. +50% vs bosses.')}
          ${noteCard('Damage-Type vs Archetype', '<b>Bosses:</b> Scorpio +40, Pontifex +200, Carthage Scourge +320. <b>Flyers:</b> Sagittarius / Venator +45, Aquila Venator +75, Scorpion Bolt +65, Storm Ballista +70, Beastlord +100, Eques +110, Skyreaper +140, Nemesis +160, Sky Dominion +220. <b>Ground:</b> Horseman +20, Turma Lancers +45. <b>Elephants:</b> Hannibal\'s Nightmare +200, Beast Hunter/Slayer +200. All values % bonus damage.')}
          ${noteCard('Native Auras', 'Triarius +12% global · Cohort Guard 3-tile +15% local · Eagle Standard / Praetorian Wall / Aquilifer / Vestalis / Triplex Acies / Legion Prime / Fatebinder all draw violet rings — stand inside.')}
          ${noteCard('Frozen Legion (deep dive)', 'Two layered freeze mechanics: <b style="color:#88ddff">(1)</b> every attack freezes its target for 2.5s — locked in place, no movement, no knockback displacement · <b style="color:#88ddff">(2)</b> every 10 seconds, a <b>GLACIAL PULSE</b> freezes EVERY enemy on the map (no range cap) for 2.5s. The pulse turns each 10s window into a battlefield-wide hard-stop window so your damage towers can finish kills uncontested.')}
          ${noteCard('Periodic AoE Freeze', '<b style="color:#88ddff">Frozen Legion</b> — every 10s, freezes EVERY enemy on the map (no range cap) for 2.5s. <b>Hannibal\'s Nightmare</b> — every 10s, freezes everything in its 6.5-tile range for 1.5s. <b>Carthage Scourge</b> — every 5s, freezes everything in its 7-tile range for 1.8s.')}
        </div>
      `)}
      ${foldSection('STATUS GLOSSARY', `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:10px">
          ${noteCard('SLOW', 'Reduces enemy speed by magnitude%.')}
          ${noteCard('FREEZE', 'Enemy is fully locked in place for the duration — zero movement, and knockback cannot displace them either. Bosses take half-duration freezes. <b style="color:#88ddff">+10% direct damage taken</b> while frozen (DoT ticks unaffected) — see HARD-CC DAMAGE AMP below.')}
          ${noteCard('STUN', 'Brief halt — same as freeze but shorter. <b style="color:#ff7766">Bosses are fully stun-immune</b>; their boss scripts have to be allowed to fire. Freeze on bosses lands at half duration. <b style="color:#88ddff">+10% direct damage taken</b> while stunned (DoT ticks unaffected) — see HARD-CC DAMAGE AMP below.')}
          ${noteCard('Stun / Freeze Diminishing Returns', 'After a STUN or FREEZE expires on an enemy, that enemy gains a brief immunity to new stuns/freezes — duration equal to the just-expired lockdown (capped 1.5s). Stops multi-tower stun chains from locking enemies in place permanently. Tower mechanics still fire and damage normally; only the lockdown itself caps out at ~50% uptime when multiple lockdown towers stack on the same target.')}
          ${noteCard('BURN / BURNING GROUND', 'Fire towers (Ignifer, Inferno Cart, Vulcan Engineer, Siege Onager, etc.) deal their base damage + a SINGLE DoT — the burning-ground patch they stamp on impact. The patch ticks <b style="color:#ff8833">4%–7% maxHP/sec for 4s</b> (scaled by tower tier: T1 4.0% · T5 7.0%) and bypasses faction resists. Boss DoT reduction (×0.18) applies. One DoT, not two.')}
          ${noteCard('POISON (burst)', 'High-DPS short DoT. <b>6% maxHp/s</b> over short durations. The Poisoned Blade item applies it on hit.')}
          ${noteCard('BLEED (sustained DoT)', 'Long-duration DoT. <b>2.0-3.0% maxHp/s</b> over 8-14s. Differentiated from poison: bleed is sustained, poison is burst. Tiers: Barbed Gladius (COMMON, 2.0%/10s = 20% maxHP total) · Alpha Pack Fang (LEG, 2.4%/14s = 33.6% maxHP, longest envelope) · Falcata Blade (LEG, 3.0%/8s = 24% maxHP, hottest tick, front-loaded).')}
          ${noteCard('HELLFIRE', 'Permanent true-damage DoT (lasts until target dies). <b>Magnitude varies by source:</b> <b style="color:#ffaa66">God of War 1% maxHp/s</b> (stamped on every hit), <b style="color:#ffaa66">Pontifex 1-5% maxHp/s on bosses</b> (scales with tier — T1=1%, T5=5%). Stacks indefinitely on the same target, but capped by the AGGREGATE DOT CAP below.')}
          ${noteCard('AGGREGATE DOT CAP (4% maxHp/sec)', 'Total per-tick damage from all DoTs (burn + poison + bleed + hellfire) on a single enemy is clamped to <b style="color:#88ff88">4% maxHp/sec</b>. Below the cap, sources stack additively; above the cap, additional sources have no extra effect. <b style="color:#ffaa66">HELLFIRE carves out a tighter 1%/sec sub-cap</b> inside the aggregate (it\'s permanent + bypasses resists, so it earns the tighter leash). Applies universally from W1. Boss DoT reduction (×0.18) already shrinks per-source damage on bosses, so the cap mostly bites on regular waves where DoT stacking used to hit 14–15%/sec.')}
          ${noteCard('HARD-CC DAMAGE AMP', 'Enemies under <b style="color:#88ddff">FREEZE</b> take <b>+10% direct damage</b>. Enemies under <b style="color:#88ddff">STUN</b> take <b>+10% direct damage</b>. Stacks additively — a frozen + stunned enemy takes <b>+20%</b>. <b style="color:#ffaa66">Applies only to direct hits</b> resolved by towers; DoT ticks (burn / poison / bleed / hellfire) do NOT benefit. Designed so status-control builds (Frozen Legion, Augur, Stormcaller, Imperator Guard, Librator, Naval Bombardment, etc.) compete with DoT builds as a viable late-game carry.')}
          ${noteCard('Armor Shred', 'Reduces enemy faction resistance for the duration.')}
          ${noteCard('FEAR', 'Enemy walks AWAY from gate briefly.')}
          ${noteCard('KNOCKBACK', 'One-shot path-progress reversal. Bosses 25% effectiveness.')}
          ${noteCard('MARK', 'Target takes +X% damage from any source. Stacks with itself only as max(magnitude). <b style="color:#88ddff">Affects DIRECT tower hits only — DoT ticks ignore MARK.</b>')}
          ${noteCard('DoTs are unaffected by tower auras', 'All DoT tick damage (BURN / POISON / BLEED / HELLFIRE / burning ground) is computed purely from <b>enemy maxHp × magnitude × status resistance × boss-mod (×0.18)</b>. Tower damage auras (Triarius +12% global, Cohort Guard +15% local, Caesar +55% global, etc.) and MARK debuffs DO NOT amplify DoT ticks — they only boost the tower\'s DIRECT instant strikes. Stacking damage auras to chain-melt a poisoned enemy doesn\'t work; the DoT bleeds at its own fixed % maxHp/sec. Use DoTs to apply pressure / counter regen; use direct damage to actually finish enemies.')}
          ${noteCard('DOT items: Mercator-only + attack-class gated', '<b style="color:#ff9933">DOT items no longer appear in random drops or the gate shop</b> — your only path to them is the Mercator (W4/9/14/19) and boss legendary tables. Attack-class twins: <b style="color:#88ddff">Poisoned Blade</b> is <b>MELEE-ONLY</b> (single-target 6%/s poison, 4s), <b style="color:#ff7733">Fire Oil Flask</b> is <b>RANGED-ONLY</b> (4%/s burn for 3s + 1-tile splash). Barbed Gladius (melee, light bleed), Falcata Blade / Alpha Pack Fang (any tower, heavy bleed legendaries) round out the family.')}
        </div>
      `)}
      ${foldSection('CRIT CHANCE (per tower)', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:6px">
          Every tower has its own crit profile (<b>chance</b> + <b>multiplier</b>) baked into <b>towers.json</b>. Click a tower to see its values. Combos crit harder than their base counterparts; cross-combos crit hardest of all.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Fast attackers', 'Pugio Assassin 28% × 2.2, Velites 22% × 1.9, Rorarius 24% × 1.8, Triumphator 20% × 2.5. High volume, modest spike.')}
          ${noteCard('Heavy siege', 'Colossus Onager 6% × 3.5, Vulcan Engineer 6% × 3.0, Scorpio (signature 5th-hit ×3, no universal crit). Rare hits, huge spike.')}
          ${noteCard('Signature-crit towers', 'Decurion (every 5th hit ×3, plus EXECUTE: +250% damage vs non-boss enemies under 15% HP), Scorpio (every 5th hit ×3), Eques (25% chance ×3), Haruspex (20% double-strike) carry signature crit mechanics. They do NOT roll the universal crit on top.')}
          ${noteCard('Apex crits', 'Imperium Eternum 25% × 3.0, Carthage Scourge 22% × 3.0. Cross-combos own the high-end crit lane.')}
        </div>
      `)}
      ${foldSection('SUPER COMBOS (5-base recipes)', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:6px">
          Recipe-heavy apex towers are the hardest crafts in the game. Some consume several base towers, some consume combo towers, and the Omega tier consumes super-combos. Hard to assemble; extremely rewarding.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${noteCard('TRIPLEX ACIES (early, 30g)', 'Cleaves 2-tile radius melee. +25% atk-speed aura to towers within 3 tiles. Recipe: Milites + Hastati + Triarius + Centurion + Skizzer (all T2+).')}
          ${noteCard('LEGION PRIME (mid, 100g)', 'Heavy AoE divine. Slow + Armor Shred on every hit. +25% damage aura within 3 tiles. Recipe: Ignifer + Flamen + Carroballista (all T3+).')}
          ${noteCard('FATEBINDER (apex, 250g)', 'Every strike echoes onto EVERY enemy on the map at 40% splash. TRUE damage. +22% global damage + atk speed aura. Recipe: Praefectus + Vulcan Engineer + Solar Priest (all T4+).')}
        </div>
      `)}
      ${foldSection('CROSS-COMBOS (combos-of-combos)', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:6px">
          Six recipes that take existing combo towers as ingredients. The hardest paths in the game; the most powerful identities.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Turma Lancers (T3, 25g)', '2× Horseman T3 → twin cavalry, heavier double-stack Mark, +45% vs ground.')}
          ${noteCard('Aurora Legion (T4, 60g)', 'Eagle Standard T4 + Praetorian Wall T4. baseDps 116.5, pierces 4 in line, +50% vs elites. PROVIDENCE BLAST: every 4th attack fires a divine nova in 1.8 tiles around the primary for 2.5× damage to all inside.')}
          ${noteCard('Storm Vexilla (T4, 60g)', 'Stormcaller T4 + Eagle Standard T4. Wide 6-jump chain lightning.')}
          ${noteCard('Imperium Eternum (T5 APEX, 150g)', '3 ingredients: Julius Caesar T5 + Aquilifer T5 + Pontifex T4+. 3-tile TRUE-damage quake on every hit at 75%. +25% global atk speed.')}
          ${noteCard('Carthage Scourge (T5, 120g)', `Hannibal's Nightmare T5 + Nemesis Engine T5. 6-bolt volley, +320% vs bosses, AoE freeze every 5s.`)}
          ${noteCard('Triumvirate (T5 SUPPORT, 100g)', 'Julius Caesar + Aquilifer + Eagle Standard. No direct damage. +40% global dmg, +30% global atk speed, +30% enemy taken globally.')}
        </div>
      `)}
      ${foldSection('BOSS WAVE — NEW RULES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Solo Arrival', "Authored mob hordes are stripped. The boss arrives ALONE. Boss scripts can still summon helpers (e.g. Hannibal's elephants) — those are part of the boss's mechanics.")}
          ${noteCard('+100% Boss HP', 'To compensate for the missing chip damage from cleared mobs. Bosses are tankier when alone.')}
          ${noteCard('No Atmospheric VFX', 'Boss waves stay visually clean — no surprise events, no wave modifiers, no twin/ambush boss rolls on W30. The play area is reserved for the boss fight so you can focus on positioning.')}
          ${noteCard('Stuck Arrows', 'Bosses retain up to 5 embedded projectile shafts visually for the rest of the wave. Arrows / javelins / pilums / staves / ballista bolts all stick. Pure visual flavor.')}
          ${noteCard('Boss-Kill Bonus', 'Every boss kill pays 22 + round(wave × 3.5) gold. W30 final boss ≈ +127g. Plus quest progress on "Beast Slayer" / "Boss Hunter" / "Boss Slayer Supreme".')}
          ${noteCard('Pre-Wave Tip', "Before every wave, a modal pops to explain that wave's mechanics — flyers, shielded, ghosts, druids, phoenix, runners, regen, decade-of-doom. Click to dismiss.")}
        </div>
      `)}
      ${foldSection('VISUAL CUES — WHAT THEY MEAN', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px">
          ${noteCard('Chips around the play area', '<b>Top-left:</b> active faction weather + penalty. <b>Top-right:</b> active wave modifier (when one is rolled). <b>Lower-left:</b> Wave Brief — consolidated special-mechanics summary for the current wave.')}
          ${noteCard('Tower indicators', '<b>Pulsing red ring:</b> eligible to combine — click for options. <b>Gold ring + dots above tower:</b> tier (1-5, color-keyed). <b>Pink X:</b> silenced. <b>Pulsing colored dot:</b> weather is slowing attack speed.')}
          ${noteCard('Aura rings (colored circles)', '<b style="color:#c070ff">VIOLET</b> = ally buff (damage/speed/range). <b style="color:#ff5566">DASHED CRIMSON</b> = enemy debuff (+taken%/slow). <b style="color:#ffd34d">GOLD</b> = tower attack range. Three distinct colors so the layers never confuse.')}
          ${noteCard('Enemy indicators', '<b>Bronze shield:</b> needs melee hit before ranged can target. <b>Colored ring around enemy:</b> elite mutation (color = mutation type). <b>Status badges above:</b> active status effects.')}
        </div>
      `)}
    `;
  }
  if (tab === 'POOL') {
    const eff = Math.max(lastCtx.poolLevel, lastCtx.heroLevel);
    const TIER_COL = ['#cccccc','#b87333','#c0c0c0','#ffd34d','#ff5050'];
    const cumCosts = ECONOMY.POOL_UPGRADE_COSTS as readonly number[];
    let header = `
      <div style="display:flex;justify-content:space-between;align-items:center;background:#0c0a08;border:1px solid #5a4a30;padding:10px 14px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;color:#aa9a4a;letter-spacing:1px">CURRENT EFFECTIVE LEVEL</div>
          <div style="font-size:24px;color:#ffd34d;font-weight:bold">${eff}/${ECONOMY.POOL_MAX_LEVEL}</div>
        </div>
        <div style="font-size:11px;color:#cdb98a;text-align:right">
          <div>POOL (gold-purchased): <b>${lastCtx.poolLevel}</b></div>
          <div>HERO (kill-XP): <b>${lastCtx.heroLevel}</b> <span style="opacity:0.7">(${lastCtx.totalKills} kills)</span></div>
          <div style="opacity:0.6;font-size:10px;margin-top:4px">Effective level = max(pool, hero)</div>
        </div>
      </div>`;
    const rows = POOL_PROBABILITIES.map((row, lvl) => {
      const isCurrent = lvl === eff;
      const isUnlocked = lvl <= eff;
      const cost = lvl === 0 ? 0 : (cumCosts[lvl - 1] ?? 0);
      const heroNeed = lvl === 0 ? 0 : (HERO_XP_THRESHOLDS[lvl - 1] ?? 0);
      const bars = row.map((p, t) => `
        <div style="display:flex;align-items:center;gap:4px;font-size:10px">
          <span style="display:inline-block;width:14px;height:14px;background:${TIER_COL[t]};border:1px solid #000;text-align:center;line-height:14px;color:#000;font-weight:bold;font-size:9px">${t+1}</span>
          <span style="display:inline-block;width:80px;height:8px;background:#1a1410;border:1px solid #3a3025">
            <span style="display:block;height:100%;width:${p}%;background:${TIER_COL[t]}"></span>
          </span>
          <span style="color:${TIER_COL[t]};min-width:32px;text-align:right">${p}%</span>
        </div>`).join('');
      const bg = isCurrent ? '#3a2a14' : (isUnlocked ? '#1a1410' : '#0a0806');
      const border = isCurrent ? '2px solid #ffd34d' : '1px solid #3a3025';
      return `
        <div style="background:${bg};border:${border};padding:10px 14px;margin-bottom:6px;${isCurrent ? 'box-shadow:0 0 12px #ffd34d44' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-size:13px;font-weight:bold;color:${isCurrent ? '#ffd34d' : (isUnlocked ? '#cdb98a' : '#666')};letter-spacing:2px">
              LEVEL ${lvl} ${isCurrent ? '— ACTIVE' : (isUnlocked ? '— unlocked' : '')}
            </div>
            <div style="font-size:10px;color:#aa9a4a">
              ${lvl === 0 ? '(starting)' : `Upgrade Pool: <b style="color:#f0c040">${cost}g</b> · or kill <b>${heroNeed}</b> enemies`}
            </div>
          </div>
          <div style="display:flex;gap:14px;flex-wrap:wrap">${bars}</div>
        </div>`;
    }).join('');
    const footer = `
      <div style="margin-top:10px;padding:8px 12px;background:#0c0a08;border:1px dashed #5a4a30;font-size:11px;color:#cdb98a;line-height:1.55">
        <b style="color:#9be0ff">Strategy (30-wave campaign):</b> 95% T1 at start. 8-level curve costs <b>7 / 15 / 31 / 53 / 83 / 127 / 193 / 297g</b> per step (806g apex total). T4+T5 chance climbs to <b>76% at L8</b>. <b>L1 grants no damage bonus</b> (only the probability shift). Starting at L2, every level adds a permanent <b style="color:#88ff88">+3% global tower damage</b> (max +21% at L8). No rebate — you pay full price each step.<br/><br/>
        <b style="color:#9be0ff">What tier actually buys:</b> higher tiers stack two things — <b>raw damage</b> (T1=×1.0, T2=×1.25, T3=×1.55, T4=×1.95, T5=×2.50) and <b>attack speed</b> (T1=×1.00 up to T5=×1.42). A T5 same-type tower fires ~3.55× the raw output of its T1 cousin before any items or pool bonuses. <b style="color:#fff8e0">Item slots are fixed at 3 for every tower and hero, T1 through T5</b> — tier no longer changes slot count, so roll T5 purely for damage and speed.<br/><br/>
        <b style="color:#9be0ff">Hero substitute:</b> kills passively raise hero level (caps at 5). Effective pool = max(gold-purchased pool, hero level). Pool L6-L8 only comes from gold investment.
      </div>`;
    return header + rows + footer;
  }
  if (tab === 'LEGIONS') {
    // 2026-05-15 v12: reorganized into THREE explicit game-stage sections
    // (EARLY / MID / LATE) per user feedback. The previous "tier band"
    // grouping didn't match how players actually progress — a T2 base
    // and a T3 base are both effectively early-game maze pieces, while
    // a T2 result-tier super-combo (Triplex Acies: 5 ingredients) is
    // clearly mid-game because you need 5 specific T2 towers staged
    // simultaneously. Stage = "when does this tower show up in a real
    // run" rather than what tierBand the JSON happens to say.
    //
    // Within a stage: BASE units first (sorted by tierBand asc), then
    // COMBO units (sorted by result tier asc), then alphabetical.
    const TOWER_STAGE: Record<string, 'EARLY' | 'MID' | 'LATE'> = {
      // ─── EARLY GAME ───────────────────────────────────────────────
      // All BASE towers T1-T4 (you can roll these straight from the
      // prospect pool with normal pool upgrades) plus simple combos
      // that take only 2-3 ingredients you naturally collect early.
      MILITES: 'EARLY', VELITES: 'EARLY', HASTATI: 'EARLY', SAGITTARIUS: 'EARLY',
      SCORPIO: 'EARLY', TRIARIUS: 'EARLY', DECURION: 'EARLY', CENTURION: 'EARLY',
      PRIMUS_PILUS: 'EARLY', LEGATE: 'EARLY',
      RETIARIUS: 'EARLY', BALLISTARIUS: 'EARLY', OPTIO: 'EARLY',
      PUGIO_ASSASSIN: 'EARLY', ARCUBALLISTA: 'EARLY',
      VENATOR: 'EARLY', IGNIFER: 'EARLY', SPECULATOR: 'EARLY', FLAMEN: 'EARLY',
      CARROBALLISTA: 'EARLY', AQUILA_VENATOR: 'EARLY',
      AUXILIA: 'EARLY', FUNDIBULUS: 'EARLY', RORARIUS: 'EARLY',
      LIBRITOR: 'EARLY', ACCENSUS: 'EARLY',
      // 2026-05-17 — Beast Hunter (T1) + Beast Slayer: early-game
      // beast-bane standalone towers. Roll in the normal prospect pool
      // at pool levels 0-3; no combo dependencies. Beast Slayer was
      // widened to multi-tier (T1-T3) in 2026-05-21.
      BEAST_HUNTER: 'EARLY', BEAST_SLAYER: 'EARLY',
      CATAPHRACT: 'EARLY', AUGUR: 'EARLY', EVOCATUS: 'EARLY',
      HARUSPEX: 'EARLY',
      // CLIBANARIUS — moved to MID stage in 2026-05-15 v13 (now a combo).
      // Simple combos players see in their first few rounds
      HORSEMAN: 'EARLY', SCORPION_BOLT: 'EARLY', COHORT_GUARD: 'EARLY',
      WAR_CHARIOT: 'EARLY', EAGLE_STANDARD: 'EARLY',
      NUMIDIAN_CAVALRY: 'EARLY', PRAETORIAN_WALL: 'EARLY', AERARIUM: 'EARLY',
      TESSERARIUS: 'EARLY', SCOUT_VEXILLUM: 'EARLY',
      STORMCALLER: 'EARLY', SACER_VESTAL: 'EARLY', TURMA_LANCERS: 'EARLY',
      // ─── MID GAME ─────────────────────────────────────────────────
      // T5 BASE towers (apex base units, need pool L7-L8 or Mercator)
      // and the powerful named combos players plan around mid-run.
      PRAEFECTUS: 'MID', VULCAN_ENGINEER: 'MID', IMPERATOR_GUARD: 'MID',
      SOLAR_PRIEST: 'MID', COLOSSUS_ONAGER: 'MID',
      SIEGE_ONAGER: 'MID', INFERNO_CART: 'MID',
      SIGNIFERS_DRACONARIUS: 'MID', BESTIARIUS: 'MID',
      TRIBUNUS_LATICLAVIUS: 'MID', AURORA_LEGION: 'MID', STORM_VEXILLATION: 'MID',
      AQUILIFER_TITAN: 'MID', FROZEN_LEGION: 'MID',
      GOD_OF_WAR: 'MID', HANNIBALS_NIGHTMARE: 'MID', JULIUS_CAESAR: 'MID',
      PLAGUE_CART: 'MID', VEXILLATION: 'MID',
      // 2026-05-15 v13 — dedicated boss-hunter combo (Pugio + Cataphract).
      CLIBANARIUS: 'MID',
      // 2026-05-17 — Murmillo combo (Beast Hunter + Turris + Arcuballista).
      // Anti-Carthage specialist with heavy single-shot CC (Scutum Bash).
      MURMILLO: 'MID',
      // 2026-06-28 — 10 new combos featuring under-represented base towers.
      PRAETORIAN_EXECUTIONER: 'MID', SACRED_BAND: 'MID', BEASTLORD_CHAMPION: 'MID',
      MIRMILLO_REAVER: 'MID', TRIBUNE_AVENGER: 'MID', CATAPHRACT_LANCER: 'MID',
      STORM_BALLISTA: 'MID', SKYREAPER_BATTERY: 'MID', PLAGUE_LOBBER: 'MID', AUGURS_WRATH: 'MID',
      // 5-ingredient super-combos at lower result tiers — they require
      // 5 simultaneous towers but unlock at mid-pool levels.
      TRIPLEX_ACIES: 'MID',
      NEMESIS_ENGINE: 'MID', TRIUMPHATOR: 'MID', PONTIFEX_MAXIMUS: 'MID',
      // ─── LATE GAME (APEX) ────────────────────────────────────────
      // Apex super-combos: 5-ingredient T5 recipes that ladder cross-
      // combos (a combo whose ingredients are themselves combos). These
      // are the win-condition towers of a high-end run.
      IMPERIUM_ETERNUM: 'LATE', CARTHAGE_SCOURGE: 'LATE',
      TRIUMVIRATE: 'LATE', LEGION_PRIME: 'LATE',
      CONSULAR_FATEBINDER: 'LATE', MARS_VICTOR: 'LATE',
      SKY_DOMINION: 'LATE', AUREATE_TRIBUNAL: 'LATE',
      GLACIAL_PALISADE: 'LATE', INFERNAL_COLOSSUS: 'LATE',
      ROMAN_TRANSFORMER: 'LATE'
    };
    const STAGE_ORDER: Record<string, number> = { EARLY: 0, MID: 1, LATE: 2 };
    const STAGE_LABEL: Record<string, string> = {
      EARLY: '🌱 EARLY GAME — base towers + simple combos (pool L0-L4)',
      MID:   '⚔ MID GAME — T5 base + powerful named combos (pool L5-L8, Mercator)',
      LATE:  '👑 LATE GAME (APEX) — 5-ingredient super-combos, win-condition towers'
    };

    // 2026-05-24 — Filter out hero entries. The 6 HERO_* towers have
    // their own HEROES tab and shouldn't double-list in LEGIONS. Pre-fix
    // they all sank into "LATE GAME APEX" because TOWER_STAGE didn't
    // map them. Heroes still appear in the HEROES tab as expected.
    const entries = Object.entries(towers)
      .filter(([_, def]: any) => !def?.isHero)
      .map(([id, def]: any) => ({ id, def }));
    entries.sort((a, b) => {
      const sa = STAGE_ORDER[TOWER_STAGE[a.id] ?? 'LATE'] ?? 99;
      const sb = STAGE_ORDER[TOWER_STAGE[b.id] ?? 'LATE'] ?? 99;
      if (sa !== sb) return sa - sb;
      // BASE before COMBO inside a stage
      const ka = a.def.kind === 'COMBO' ? 1 : 0;
      const kb = b.def.kind === 'COMBO' ? 1 : 0;
      if (ka !== kb) return ka - kb;
      // Inside (stage, kind) sort by tier band ascending
      const ba = a.def.tierBand ?? 1;
      const bb = b.def.tierBand ?? 1;
      if (ba !== bb) return ba - bb;
      // Alphabetical fallback
      return (a.def.name ?? a.id).localeCompare(b.def.name ?? b.id);
    });
    let lastStage = '';
    const rows = entries.map(({ id, def }) => {
      const stage = TOWER_STAGE[id] ?? 'LATE';
      let header = '';
      if (stage !== lastStage) {
        lastStage = stage;
        header = `<tr><td colspan="9" style="background:#2a1f12;color:#ffd34d;font-weight:bold;letter-spacing:2px;padding:10px 12px;border-top:3px solid #5a4a30;border-bottom:1px solid #5a4a30;font-size:12px">${STAGE_LABEL[stage]}</td></tr>`;
      }
      return `${header}<tr><td>${spriteImg(id, 36)}</td>
      <td><b style="color:#d4af37">${def.name}</b></td>
      <td>${def.kind === 'COMBO' ? '<span style="color:#ffd34d">COMBO</span>' : (def.tierBandRange ? `T${def.tierBandRange}` : `T${def.tierBand ?? '1-5'}`)}</td>
      <td style="color:#9be0ff">${damageTypeLabel(def.damageType)}</td>
      <td>${def.baseDps} DPS</td>
      <td>${def.attackSpeed.toFixed(2)}/s</td>
      <td>${def.range}t</td>
      <td>${def.melee ? 'Melee' : 'Ranged'}</td>
      <td style="opacity:0.85">${def.ability ?? ''}</td></tr>`;
    }).join('');
    return `${section('LEGION REFERENCE', '<div style="font-size:11px;color:#cdb98a">Towers grouped by <b style="color:#ffd34d">game stage</b> — when you naturally encounter them in a run. <b style="color:#88ff88">EARLY</b> covers everything you can build with pool L0-L4 (all BASE T1-T4 plus simple 2-3 ingredient combos). <b style="color:#ffaa55">MID</b> brings the T5 BASE apex units (pool L5+/Mercator) and the powerful named combos (Hannibal\'s Nightmare, God of War, Vexillation, Triplex Acies, etc.). <b style="color:#ff5050">LATE (APEX)</b> is reserved for the 5-ingredient cross-combo super-units that need other combos as ingredients — the win-condition towers of a high-end run. Within each stage: BASE units first, then COMBO units, sorted by tier band ascending. Melee entries cannot hit flyers unless their implementation is explicitly ranged.</div>')}
      <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="color:#aa9a4a"><th></th><th style="text-align:left">Name</th><th>Band</th><th>Type</th><th>DPS</th><th>Speed</th><th>Range</th><th>Mode</th><th style="text-align:left">Ability</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }
  if (tab === 'COMBINATIONS') {
    // Build TWO multi-sets:
    //   owned    — committed (non-pending) towers — counts as GREEN match
    //   prospect — pending prospects on the field — counts as ORANGE match
    //              (player must KEEP the prospect first to actually combo it)
    const owned = new Map<string, number[]>();
    const prospect = new Map<string, number[]>();
    for (const tw of (lastCtx.towers ?? [])) {
      const target = tw.pending ? prospect : owned;
      const arr = target.get(tw.type) ?? [];
      arr.push(tw.qualityTier);
      target.set(tw.type, arr);
    }
    for (const arr of owned.values()) arr.sort((a, b) => b - a);
    for (const arr of prospect.values()) arr.sort((a, b) => b - a);
    // Per-ingredient match: returns 'owned' (already a permanent tower that
    // fits the recipe), 'prospect' (a pending prospect would fit if kept),
    // or 'missing' (no tower of any state would fit).
    type IngMatch = 'owned' | 'prospect' | 'missing';
    const matchIngredients = (recipe: any): IngMatch[] => {
      const ownedClone = new Map<string, number[]>();
      const prospClone = new Map<string, number[]>();
      for (const [k, v] of owned) ownedClone.set(k, [...v]);
      for (const [k, v] of prospect) prospClone.set(k, [...v]);
      const out: IngMatch[] = [];
      for (const ing of recipe.ingredients) {
        const ownPool = ownedClone.get(ing.type) ?? [];
        const ownIdx = ownPool.findIndex((q: number) => q >= ing.minTier);
        if (ownIdx >= 0) { ownPool.splice(ownIdx, 1); out.push('owned'); continue; }
        const prosPool = prospClone.get(ing.type) ?? [];
        const prosIdx = prosPool.findIndex((q: number) => q >= ing.minTier);
        if (prosIdx >= 0) { prosPool.splice(prosIdx, 1); out.push('prospect'); continue; }
        out.push('missing');
      }
      return out;
    };
    // Card-level state:
    //   'ready'    — every ingredient is OWNED. Build now (green border).
    //   'prospect' — every ingredient is met, but at least one comes from a
    //                pending prospect. Keep that prospect and you can build.
    //                Orange border.
    //   'partial'  — at least one ingredient owned, but at least one missing.
    //                Yellow border.
    //   'none'     — nothing matches. Gray.
    const cardState = (recipe: any): { state: 'ready'|'prospect'|'partial'|'none'; matches: IngMatch[]; matched: number; total: number } => {
      const matches = matchIngredients(recipe);
      const matched = matches.filter(m => m !== 'missing').length;
      const total = matches.length;
      let state: 'ready'|'prospect'|'partial'|'none';
      if (matched === 0) state = 'none';
      else if (matched < total) state = 'partial';
      else if (matches.every(m => m === 'owned')) state = 'ready';
      else state = 'prospect';      // every ingredient met, ≥1 via prospect
      return { state, matches, matched, total };
    };
    // 2026-05 v6: sort by DIFFICULTY (easiest → hardest) so the codex
    // reads as a linear progression ladder. Difficulty score composites:
    //   1. Cross-combo flag — recipes whose ingredients are themselves
    //      combo towers cost a chain of prior crafts. +100 if any
    //      ingredient is a combo, +200 if any ingredient is itself a
    //      cross-combo (combo-of-combo).
    //   2. Result tier — T2 ≪ T5. Multiplied ×20.
    //   3. Ingredient count — fewer pieces is faster to assemble. ×8.
    //   4. Sum of minTier requirements — picking T2 from the pool is
    //      easier than picking T5. ×5.
    //   5. Cost — gold investment. ÷5 (smaller weight).
    // Lower total = easier. Stable for visually consistent ordering.
    function difficultyScore(c: any): number {
      let s = 0;
      // Whether any ingredient is a combo result (i.e., this recipe
      // requires building another combo first).
      const comboResults = new Set((combos as any[]).map((r: any) => r.result));
      // Cross-combo-of-combo: ingredient is itself a combo that uses
      // OTHER combos. Two-layer dependency = significantly harder.
      let hasComboIng = false;
      let hasCrossComboIng = false;
      for (const ing of c.ingredients) {
        if (comboResults.has(ing.type)) {
          hasComboIng = true;
          const ingRecipe = (combos as any[]).find((r: any) => r.result === ing.type);
          if (ingRecipe && ingRecipe.ingredients.some((sub: any) => comboResults.has(sub.type))) {
            hasCrossComboIng = true;
          }
        }
      }
      if (hasCrossComboIng) s += 200;
      else if (hasComboIng) s += 100;
      s += (c.tier ?? 2) * 20;
      s += c.ingredients.length * 8;
      s += c.ingredients.reduce((acc: number, ing: any) => acc + (ing.minTier ?? 1) * 5, 0);
      s += Math.floor((c.cost ?? 10) / 5);
      return s;
    }
    const sorted = [...combos].sort((a, b) => difficultyScore(a) - difficultyScore(b));
    // 2026-05-15: emit a difficulty-band header above each group of
    // recipes so the player can visually scan "what comes next" without
    // counting cards. The bands are coarse buckets of the difficulty
    // score (the same score that drives the sort), so a card always
    // appears under its tier-difficulty heading.
    //
    // Bucketing (matches the score formula in difficultyScore):
    //   < 100   — T2 single-step combos, the literal first crafts
    //   100-160 — T3 single-step combos, mid-game opener crafts
    //   160-220 — T4 single-step combos (Hannibal's Nightmare,
    //             Draconarius, Bestiarius, Siege Onager, etc.)
    //   220-260 — T4-T5 cross-combos (recipes whose ingredients are
    //             themselves combo towers — at least one craft chain)
    //   ≥ 260   — Super combos (5-ingredient apex recipes, multi-
    //             layer cross-combos)
    const bandFor = (score: number): { idx: number; label: string } => {
      if (score < 100)  return { idx: 0, label: '★ TIER 2 · EASIEST CRAFTS — 2-3 BASE ingredients, 10g, your first combos' };
      if (score < 160)  return { idx: 1, label: '★★ TIER 3 · MID-EARLY — still BASE ingredients, slightly larger pieces' };
      if (score < 220)  return { idx: 2, label: '★★★ TIER 4 · MID-LATE — endgame-grade pieces, 50g per craft' };
      if (score < 260)  return { idx: 3, label: '★★★★ CROSS-COMBOS — ingredients are themselves combo towers, chain craft required' };
      return { idx: 4, label: '★★★★★ SUPER COMBOS · APEX — 4-5 ingredients or stacked cross-combos, hardest in the game' };
    };
    let lastBandIdx = -1;
    const cards = sorted.map(c => {
      const cs = cardState(c);
      const band = bandFor(difficultyScore(c));
      let header = '';
      if (band.idx !== lastBandIdx) {
        lastBandIdx = band.idx;
        header = `<div style="background:linear-gradient(180deg,#2a1f12,#1a1410);color:#ffd34d;font-weight:bold;letter-spacing:2px;padding:8px 10px;border:1px solid #5a4a30;border-left:4px solid #d4af37;margin-top:8px;font-size:11px">${band.label}</div>`;
      }
      return header + renderComboCard(c, cs);
    }).join('');
    // 2026-05-19 — Legend bumped to a proper section block above the
    // ingredient list. Player feedback: the previous inline strip
    // was easy to miss + the color meanings weren't being noticed.
    // Now it's a fixed banner stacked at the top of the tab with
    // bigger color chips and one-word labels.
    const legend = `
      <div style="display:flex;gap:14px;margin:8px 0 12px;padding:10px 14px;background:#0c0a08;border:2px solid #5a4a30;font-size:11px;color:#cdb98a;flex-wrap:wrap;align-items:center">
        <span style="font-size:10px;letter-spacing:3px;color:#ffd34d;font-weight:bold">INGREDIENT COLORS:</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:14px;background:#88ff88;display:inline-block;border:1px solid #000;border-radius:2px"></span><b style="color:#88ff88">GREEN</b> — owned (kept tower fits)</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:14px;background:#ff9933;display:inline-block;border:1px solid #000;border-radius:2px"></span><b style="color:#ff9933">ORANGE</b> — pending prospect (keep it first)</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="width:14px;height:14px;background:#5a4a30;display:inline-block;border:1px solid #000;border-radius:2px"></span><b style="color:#aa9a4a">GRAY</b> — missing (roll, buy, or combine)</span>
      </div>
      <div style="display:flex;gap:12px;margin-top:-4px;margin-bottom:8px;font-size:10px;color:#cdb98a;flex-wrap:wrap;padding-left:6px">
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#88ff88;display:inline-block;border:1px solid #000"></span> READY — all ingredients owned, build now</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#ff9933;display:inline-block;border:1px solid #000"></span> NEEDS PROSPECT — keep a prospect to unlock</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#ffd34d;display:inline-block;border:1px solid #000"></span> PARTIAL — have some, missing some</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#5a4a30;display:inline-block;border:1px solid #000"></span> LOCKED — none owned</span>
      </div>`;
    return `${section('COMBINATION LOGIC',
      `<div style="font-size:11px;color:#cdb98a;line-height:1.5">Recipes listed in DIFFICULTY ORDER — easiest single-step builds first, cross-combos and super combos at the bottom. Color-coded against the towers you have: <b style="color:#88ff88">Green</b> = committed towers, <b style="color:#ff9933">orange</b> = pending prospects (you'll have to KEEP them first). Each result card carries a <b style="color:#c4731a">DAMAGE-TYPE</b> chip (Melee / Ranged / Siege / Fire / Divine) and a <b style="color:#5aa6d4">MODE</b> chip (Melee swing vs Projectile) so you can spot a combo's role at a glance before reading the ability.</div>${legend}
      <div style="margin-top:8px;background:#0c1418;border:1px solid #4a6a88;padding:8px 10px;font-size:11px;color:#cdb98a;line-height:1.5">
        <span style="color:#88ddff;font-weight:bold;letter-spacing:1.5px">❄ FROZEN LEGION SPOTLIGHT</span> — Pure hard-stop crowd-control combo. Every attack freezes its target for <b>2.5s</b> — fully locked in place, no movement, no knockback displacement. Every <b>10 seconds</b> it releases a <b>GLACIAL PULSE</b> that freezes EVERY enemy on the map for 2.5s (no range cap). Pairs with high-DPS towers that want stationary targets — Aurora Legion piercing lines, Scorpio bolts, Colossus Onager splash — anything that benefits from the target staying exactly where it is.
      </div>`)}
      <div style="display:grid;grid-template-columns:1fr;gap:8px">${cards}</div>`;
  }
  if (tab === 'ENEMIES') {
    // Show the ACTUAL on-spawn HP each enemy will have. We delegate to
    // `previewSpawnHp` (the canonical helper in WaveManager.ts that the
    // in-game spawn loop also uses) so the Codex column and the real
    // spawn HP can never drift apart. Previous versions had a local
    // copy of the formula that fell out of sync when the W11+ creative
    // ramp was added — never again.
    // Build "first wave appearance" map from waves.json. Two passes:
    //   1) viable spawns (mob on non-boss wave OR boss on any wave)
    //   2) stripped spawns (non-boss mob on boss wave — would-be HP shown
    //      with a "stripped" tag so the player knows the data is on the
    //      books but the runtime never spawns them)
    const firstWaveByEnemy = new Map<string, any>();
    const strippedFirstWave = new Map<string, any>();
    // 2026-05-17 — Track EVERY wave each enemy is authored into so the
    // Codex Enemies tab can show the full appearance list ("W1, W2, W3")
    // instead of just the first wave. Player feedback: consistency
    // across all enemies and visibility of recurring spawns.
    const allWavesByEnemy = new Map<string, number[]>();
    for (const w of waves as any[]) {
      const isBossWave = w.type === 'B';
      for (const grp of w.spawns) {
        const grpDef: any = (enemies as any)[grp.type];
        if (!grpDef) continue;
        if (isBossWave && !grpDef.isBoss) {
          if (!strippedFirstWave.has(grp.type)) strippedFirstWave.set(grp.type, w);
          continue;
        }
        if (!firstWaveByEnemy.has(grp.type)) firstWaveByEnemy.set(grp.type, w);
        // Also append to the full waves list (every authored appearance).
        const list = allWavesByEnemy.get(grp.type) ?? [];
        list.push(w.wave);
        allWavesByEnemy.set(grp.type, list);
      }
    }
    // Find the earliest necromancy wave where ANY enemy that reanimates
    // into `targetId` is authored. Returns the wave + the source enemy.
    function findReanimContext(targetId: string): { wave: any; source: string } | null {
      const sources = Object.entries(enemies as any)
        .filter(([_, d]: any) => d.reanimateAs === targetId)
        .map(([id]) => id);
      let best: { wave: any; source: string } | null = null;
      for (const src of sources) {
        for (const w of waves as any[]) {
          if (!w.necromancy) continue;
          const isBossWave = w.type === 'B';
          const srcDef: any = (enemies as any)[src];
          if (isBossWave && !srcDef?.isBoss) continue;
          if (!w.spawns.some((s: any) => s.type === src)) continue;
          if (!best || w.wave < best.wave.wave) best = { wave: w, source: src };
        }
      }
      return best;
    }
    // Find the earliest splitOnDeath context for an enemy that only
    // appears via another enemy's death (parent spawns N at hpFraction).
    function findSplitContext(targetId: string): { wave: any; source: string; hpFraction: number } | null {
      for (const [id, def] of Object.entries(enemies as any) as any[]) {
        if (def?.splitOnDeath?.type !== targetId) continue;
        const w = firstWaveByEnemy.get(id);
        if (w) return { wave: w, source: id, hpFraction: def.splitOnDeath.hpFraction ?? 0.4 };
      }
      return null;
    }
    // 2026-05-19 — Codex HP previews must factor in the +15% hero-comp
    // multiplier when the player has drafted a hero, so the Codex never
    // disagrees with the wave-preview chip or the W30 banner. Read off
    // globalThis.__game (set on every state mutation in main.ts); falls
    // back to false in unit-test contexts where __game isn't wired.
    const codexHeroActive = !!(((globalThis as any).__game)?.activeHeroId);
    // Compute runtime HP for any enemy on a given wave + hp-fraction.
    // Delegates to `previewSpawnHp` (single source of truth shared with
    // spawnEnemy in EnemySystem.ts). The hpFrac multiplier handles
    // reanim (~92%) and split children (their splitOnDeath.hpFraction).
    function computeHp(def: any, w: any, hpFrac = 1.0): number {
      return Math.round(previewSpawnHp(def, w.wave, w.type, w.hpMult, codexHeroActive) * hpFrac);
    }
    function spawnHpForEnemy(id: string, def: any): { hp: number; wave: number | null; explain: string; note?: string } {
      // 1. Direct authored spawn — preferred path. computeHp delegates
      // to previewSpawnHp so the column tracks the game's actual spawn
      // formula automatically.
      const w = firstWaveByEnemy.get(id);
      if (w) {
        if (w.wave === 1) {
          // 2026-05-23 — W1 pin bumped from 100/115 HP to 350/300 HP per
          // user request: "Increase the health of the wave one enemies to
          // 300" then "give Feral Dog enemies 350 health." The pin is set
          // in WaveManager.previewSpawnHp + the spawn loop so it overrides
          // baseHp × hpMult × moonBoost × basicHpBuff × heroComp entirely.
          // Hero-active spawns get the extra 50 to keep the hero-vs-no-hero
          // chip in lockstep with the runtime.
          const w1 = codexHeroActive ? 350 : 300;
          const w1Note = codexHeroActive ? ' Hero-active runs add +50.' : '';
          return { hp: w1, wave: 1, explain: `Wave 1 (introductory wave — pinned to ${w1} HP).${w1Note}` };
        }
        const hp = computeHp(def, w);
        return { hp, wave: w.wave, explain: `Final HP on its first wave (W${w.wave}).` };
      }
      // 2. Reanimation target — show HP on the earliest necromancy wave at
      // ~92% of the risen-HP range, tagged accordingly.
      const reanim = findReanimContext(id);
      if (reanim) {
        const midFrac = 0.925;
        const hp = computeHp(def, reanim.wave, midFrac);
        const srcName = (enemies as any)[reanim.source]?.name ?? reanim.source;
        return {
          hp,
          wave: reanim.wave.wave,
          explain: `Final HP when raised on a necromancy wave (W${reanim.wave.wave}).`,
          note: `rises from ${srcName} kills on necromancy W${reanim.wave.wave}`
        };
      }
      // 3. Split-on-death target — show HP on the earliest wave the parent
      // appears, scaled by the split's hpFraction.
      const split = findSplitContext(id);
      if (split) {
        const hp = computeHp(def, split.wave, split.hpFraction);
        const srcName = (enemies as any)[split.source]?.name ?? split.source;
        return {
          hp,
          wave: split.wave.wave,
          explain: `Final HP when split from a parent (W${split.wave.wave}).`,
          note: `splits from ${srcName} on W${split.wave.wave}`
        };
      }
      // 4. Stripped on boss wave — authored into a wave's spawn list but
      // the runtime strips non-boss mobs on boss waves.
      const stripped = strippedFirstWave.get(id);
      if (stripped) {
        const hp = computeHp(def, stripped);
        return {
          hp,
          wave: stripped.wave,
          explain: `Would-be HP on W${stripped.wave} (stripped at runtime).`,
          note: `listed on W${stripped.wave} but stripped at runtime (boss waves carry only the boss)`
        };
      }
      // 4b. SURPRISE-EVENT SPAWNS (2026-05-20). Hell Gate + Fire Giant are
      // both spawned procedurally by the W16 GATES OF HELL event — not
      // authored into any wave's spawns list, so the earlier branches all
      // miss them. Without this branch they'd land in step 5 ("not authored")
      // and the filter at line ~1141 would hide them from the Codex Enemies
      // tab entirely. Hard-coded W16 reference because that's where the
      // event fires (see SURPRISE_EVENT_SCHEDULE).
      const SURPRISE_W16 = new Set(['HELL_GATE', 'FIRE_GIANT']);
      if (SURPRISE_W16.has(id)) {
        // Use stored baseHp for the Codex baseline. Gates of Hell spawns
        // then receive the event HP multiplier in SurpriseEvents.
        return {
          hp: def.baseHp,
          wave: 16,
          explain: `Spawned by the W16 Gates of Hell surprise event before the event HP modifier.`,
          note: 'spawned by the W16 Gates of Hell surprise event'
        };
      }
      // 5. True orphan (no wave, no reanim source, no split parent, not
      // even stripped, not a known surprise-event spawn). These rows get
      // filtered out of the table — the value here is just for
      // consistency. Use the raw stored baseHp since there's no real
      // wave context to scale against.
      const floor = def.baseHp;
      return {
        hp: floor,
        wave: null,
        explain: 'Not authored into any wave in this campaign.',
        note: 'not authored into any wave in this campaign'
      };
    }
    const rows = Object.entries(enemies)
      .map(([id, def]: any) => {
        const ctx = spawnHpForEnemy(id, def);
        return { id, def, ctx };
      })
      // 2026-05 v6: hide enemies that never actually reach the field in
      // the current campaign — true orphans (not in any wave's spawn list,
      // no reanim/split source) AND entries that are listed on a boss wave
      // but stripped at runtime (boss waves carry only the boss). Players
      // shouldn't see Codex entries for enemies they'll never fight.
      .filter(({ ctx }) =>
        !(ctx.note && (ctx.note.startsWith('listed on W') || ctx.note.startsWith('not authored')))
      )
      // Sort by first-appearance wave (W1 → W30). Bosses sort AFTER basics
      // on the same wave so each wave reads "mobs then boss". Within a
      // wave, basics ordered by baseHp ascending (squishiest first).
      .sort((a, b) => {
        const wa = a.ctx.wave ?? 99;
        const wb = b.ctx.wave ?? 99;
        if (wa !== wb) return wa - wb;
        if (a.def.isBoss !== b.def.isBoss) return a.def.isBoss ? 1 : -1;
        return a.def.baseHp - b.def.baseHp;
      })
      .map(({ id, def, ctx }) => {
        return renderEnemyCard(id, def, ctx, allWavesByEnemy.get(id) ?? []);
      }).join('');
    // Simple, honest framing — no internal-multiplier math jargon.
    const scaleNote = `<div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:10px;background:#0c0a08;border-left:3px solid #ff9933;padding:8px 12px">
      <b style="color:#ff9933">HP column:</b> the actual on-spawn HP an enemy will have when it appears on the wave listed beside it. What you see is what you fight.<br/>
      ★ Wave 1 is the introductory wave — every spawn is pinned to <b>350 HP</b> (300 without a hero).<br/>
      ★ Enemies that only appear via splits or necromancy waves show their HP on the earliest wave that summons them.<br/>
      ★ The random <b>BLOOD MOON</b> wave modifier adds +25% HP on top when it rolls (rare).
    </div>`;
    // 2026-05-18 — Surprise-event enemies (Hell Gate + Fire Giant) and
    // the events themselves get a top-of-tab summary so the player
    // sees what to expect on W7 / W11 / W14 / W16 / W18 before they
    // scan the main table. The HELL_GATE + FIRE_GIANT rows still
    // appear in the main table below — this block is a heads-up
    // companion, not a replacement.
    const surpriseSummary = `<div data-codex-row style="background:#0c0a08;border:1px solid #3a3025;padding:10px 12px;margin-bottom:10px">
      <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px;margin-bottom:6px">🌀 SURPRISE EVENTS — INVASION / UPRISING / GATES OF HELL</div>
      <div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:8px">
        Three scripted events disrupt the normal spawn flow on specific campaign waves. Enemies enter the path AFTER waypoint 2 but still walk WP3→4→5→6→7 in linear order — no shortcuts. Surviving each event opens a 3-card Legendary reward modal drawn from a pool exclusive to that event.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        ${noteCard('⚔ INVASION · W7 + W18 + W29', 'A perimeter fire lights up for every ground enemy in the wave queue along every edge. The wave\'s enemies spawn from the fires (not the cave) at <b style="color:#ff7733">+25% speed</b>, rising to +35% in the late campaign, all emerging at once. <b style="color:#ffd34d">Skips the first 2 checkpoints</b> — every invader joins the path at WP3.')}
        ${noteCard('☠ DEATH UPRISING · W11 + W14 + W23', 'A single skull urn rises near the center of the map, relocating to the nearest open ground if that tile is occupied. Enemies <b>pour out of the urn</b> in bursts of four, then walk to the nearest path tile to join the maze. W23 adds late sustain, checkpoint healing, and status resistance. <b style="color:#ffd34d">Skips the first 2 checkpoints</b> — risers enter past WP2.')}
        ${noteCard('🔥 GATES OF HELL · W16 + W27', 'FOUR destructible <b style="color:#ff4422">Hell Gates</b> rise — two flanking WP3, two flanking WP4. They round-robin <b style="color:#ff4422">Fire Giants</b> every ~1.5s for 12s (~8 giants total). Hell Gates and Fire Giants have at least 2,000,000 final HP after event scaling. Destroy the gates early to cut their contribution to the rotation. W27 giants are faster and tougher. <b style="color:#a060ff">Every Fire Giant drops a guaranteed EPIC item on kill.</b>')}
      </div>
    </div>`;
    // 2026-05-19 — Card-based per-enemy layout (replaces the 9-column
    // table). Source of truth: every property in enemies.json + every
    // hardcoded behavior surfaced in EnemyInspect.ts is reflected here,
    // so the Codex Enemies tab matches what the player sees when they
    // click an enemy on the field. Sorted by first-wave appearance.
    return `${renderFactionResistances()}
      ${scaleNote}
      ${surpriseSummary}
      <div style="font-size:11px;color:#aa9a4a;letter-spacing:1px;margin-bottom:6px">Every enemy in the campaign, in first-appearance order. Each card mirrors what you see when you click an enemy on the field.</div>
      <div style="display:flex;flex-direction:column;gap:8px">${rows}</div>`;
  }
  if (tab === 'ITEMS') {
    // 2026-05-17 — Sort items by rarity color (White → Green → Blue →
    // Orange) so the page reads top-to-bottom from cheap commons to apex
    // legendaries. Each tier gets a colored section header so the visual
    // grouping is obvious even before the player reads the Rarity column.
    const RARITY_ORDER: Array<'COMMON'|'UNCOMMON'|'RARE'|'EPIC'|'LEGENDARY'> = ['COMMON','UNCOMMON','RARE','EPIC','LEGENDARY'];
    const RARITY_LABEL: Record<string, string> = {
      COMMON:    '⚪ COMMON — White tier',
      UNCOMMON:  '🟢 UNCOMMON — Green tier',
      RARE:      '🔵 RARE — Blue tier',
      EPIC:      '🟣 EPIC — Purple tier',         // 2026-05-18 — new tier
      LEGENDARY: '🟠 LEGENDARY — Orange tier'
    };
    const itemRows: string[] = [];
    for (const rarity of RARITY_ORDER) {
      const inTier = Object.entries(permItems).filter(([, def]: any) => def.rarity === rarity);
      if (inTier.length === 0) continue;
      // Within a tier, sort by buy price ascending so cheaper picks lead.
      inTier.sort((a, b) => itemBuyPrice(a[0]) - itemBuyPrice(b[0]));
      itemRows.push(`<tr><td colspan="5" style="background:#1a1410;color:${RAR[rarity]};font-weight:bold;letter-spacing:2px;padding:8px 10px;border-top:2px solid ${RAR[rarity]};border-bottom:1px solid #5a4a30;font-size:11px">${RARITY_LABEL[rarity]} · ${inTier.length} item${inTier.length === 1 ? '' : 's'}</td></tr>`);
      for (const [id, def] of inTier) {
        const d: any = def;
        // 2026-05-18 — Event-exclusive legendaries don't have a buy
        // price (you can't purchase them), so the cost column shows
        // their source event instead. The full reward badge color-
        // matches the event (orange invasion / purple uprising /
        // hellfire-red gates) for at-a-glance recognition.
        const evx = d.eventExclusive as string | undefined;
        const costCell = evx
          ? (evx === 'INVASION' ? '<span style="color:#ff7733">⚔ INVASION</span>'
            : evx === 'UPRISING' ? '<span style="color:#a050ff">☠ UPRISING</span>'
            : '<span style="color:#ff4422">🔥 GATES</span>')
          : `${itemBuyPrice(id)}g`;
        itemRows.push(`<tr>
          <td><b style="color:${RAR[d.rarity]}">${d.name}</b></td>
          <td style="color:#9be0ff">${itemFamily(id)}</td>
          <td style="color:${RAR[d.rarity]}">${pretty(d.rarity)}</td>
          <td>${costCell}</td>
          <td style="opacity:0.85">${d.effect}</td></tr>`);
      }
    }
    const perm = itemRows.join('');
    // Consumables removed 2026-05 — every item is permanent now, so the
    // codex only shows the permanent table.
    void consumables;
    return `${section('ITEM EQUIP RULES', '<div style="font-size:11px;color:#cdb98a">Same item stacking is blocked. Family-restricted items are mutually exclusive per tower: a tower cannot carry two speed items, two damage items, two range items, etc. <b style="color:#88ff88">Exception: DoT items (burn / poison / bleed) and SPECIAL trophies stack freely.</b> Every item is permanent.<br/><br/><b style="color:#ff9933">Attack-class gates:</b> every restricted item opens its effect with <b style="color:#88ddff">MELEE ONLY</b> or <b style="color:#ff7733">RANGED ONLY</b> in CAPS. The inventory grid greys out incompatible items at equip time.<br/><br/><b style="color:#ff9933">Legendary uniqueness:</b> you can only hold ONE of each legendary at a time. Mercator and boss drops automatically rotate to a different legendary you don\'t already own.</div>')}
      ${section('🟣 EPIC TIER & 🌀 EVENT-EXCLUSIVE LEGENDARIES', `<div style="font-size:11px;color:#cdb98a;line-height:1.55">
        <b style="color:#a060ff">EPIC (purple) tier:</b> 210g buy / 105g sell. <b style="color:#a060ff">Mercator-exclusive</b> — gate shop never stocks them; Mercator carries 2 random Epic slots per visit.
        <br/><br/><b style="color:#ff9933">Event-exclusive Legendaries</b> drop only from their event's reward modal. The cost column shows the source event:
        <br/>• <b style="color:#ff7733">⚔ INVASION</b>: Vanguard Pilum, Aquila Rampart, Perimeter Torch
        <br/>• <b style="color:#a050ff">☠ UPRISING</b>: Gravekeeper's Scythe, Soulfire Brand, Necromancer's Lantern
        <br/>• <b style="color:#ff4422">🔥 GATES OF HELL</b>: Hellgate Brand, Demonsworn Crown, Inferno Standard
      </div>`)}
      <h3 style="margin:8px 0 4px;color:#d4af37">PERMANENT ITEMS — sorted by rarity, cheapest first within each tier</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="color:#aa9a4a"><th style="text-align:left">Name</th><th>Family</th><th>Rarity</th><th>Cost</th><th style="text-align:left">Effect</th></tr></thead>
      <tbody>${perm}</tbody></table>`;
  }
  // ── HEROES TAB (2026-05-19) ──────────────────────────────────────
  // Shows all 6 heroes regardless of which 3 the current run drafted.
  // Source-of-truth read from herodefs.json; the inspect panel and
  // draft modal use the same data, so this stays in sync automatically.
  if (tab === 'HEROES') {
    const HERO_POOL_IDS = ['HERO_MARIUS', 'HERO_AGRIPPA', 'HERO_AGRICOLA', 'HERO_SCIPIO', 'HERO_CAESAR', 'HERO_SULLA'];
    // 2026-05-19 — Defensive passive lookup matches the helper in
    // ChooseHeroModal. Agricola declares passive.kind='DUAL' with
    // nested global+local descriptions; this fallback assembles a
    // combined string so the PASSIVE row never renders empty here.
    const passiveText = (p: any): string => {
      if (!p) return '';
      if (p.description) return p.description;
      const bits: string[] = [];
      if (p.global?.description) bits.push(`Global: ${p.global.description}`);
      if (p.local?.description)  bits.push(`Local: ${p.local.description}`);
      return bits.join(' ');
    };
    const cards = HERO_POOL_IDS.map(id => {
      const def: any = (heroDefs as any)[id];
      if (!def) return '';
      const tint = def.visual?.tierUpColor ?? '#ffd34d';
      const tierTitles: string[] = def.tierTitles ?? ['TIRO','LEGATUS','CONSUL','IMPERATOR','DIVUS'];
      const xpThr: number[] = def.xpThresholds ?? [0,75,280,650,1300];
      const abilities = (def.abilities ?? []).map((a: any) => `
        <div style="margin-bottom:6px;padding:6px 10px;background:rgba(0,0,0,0.3);border-left:3px solid ${tint}88">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <div style="font-size:11px;color:${tint};font-weight:bold;letter-spacing:1px">${a.name ?? a.id}</div>
            <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px">${tierTitles[a.level] ?? `T${a.level}`} · ⏱ ${a.cooldownSec ?? 0}s</div>
          </div>
          <div style="font-size:10.5px;color:#cdb98a;line-height:1.5;margin-top:3px">${a.description ?? ''}</div>
        </div>`).join('');
      return `
        <div style="background:linear-gradient(180deg,#1a1410,#0c0a08);border:2px solid ${tint};margin-bottom:12px;overflow:hidden">
          <div style="background:${tint};color:#1a1410;padding:6px 12px;display:flex;justify-content:space-between;font-weight:bold;letter-spacing:2px;font-size:12px">
            <span>⚔ ${(def.name ?? id).toUpperCase()}</span>
            <span>${def.specialty ?? ''}</span>
          </div>
          <div style="padding:10px 14px;border-bottom:1px solid #3a3025">
            <div style="font-size:11px;color:#cdb98a;letter-spacing:2px;margin-bottom:6px">${def.title ?? ''}</div>
            <div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-bottom:3px">BUILT FOR</div>
            <div style="font-size:11px;color:#e8d6a8;line-height:1.5;font-style:italic;padding-left:10px;border-left:3px solid ${tint}">${def.playerProblemSolved ?? ''}</div>
          </div>
          <div style="padding:10px 14px;border-bottom:1px solid #3a3025">
            <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px;margin-bottom:4px">⚜ PASSIVE</div>
            <div style="font-size:11px;color:#cdb98a;line-height:1.5">${passiveText(def.passive)}</div>
          </div>
          <div style="padding:10px 14px;border-bottom:1px solid #3a3025">
            <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px;margin-bottom:4px">⚔ ABILITIES</div>
            ${abilities}
          </div>
          <div style="padding:8px 14px;font-size:10px;color:#aa9a4a;letter-spacing:1px">
            XP THRESHOLDS &nbsp;${xpThr.map((x: number, i: number) => `<span style="color:#cdb98a">${tierTitles[i]}</span>:${x}`).join(' &nbsp;·&nbsp; ')}
          </div>
          <div style="padding:10px 14px;font-size:10px;color:#aa9a4a;font-style:italic;line-height:1.5;background:#0c0a08">"${def.biography ?? ''}"</div>
        </div>`;
    }).join('');
    // 2026-05-20 v2 — HERO FORGE documentation. Pay-gold upgrade
    // system that runs alongside the natural XP/tier ladder. Three
    // independent paths the player can tap at the gate shop.
    const forgeSection = section('⚒ HERO FORGE — paid upgrade paths', `
      <div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:10px">
        A separate progression axis from XP/tier. Whenever your hero is on the field, the gate shop shows three upgrade buttons. Each path is independent — tapping one only ramps that path's price, the other two stay cheap. Stacks at 5 per path, no total cap.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="padding:10px 12px;background:#1a0e0a;border:2px solid #ff5a4a">
          <div style="font-size:13px;color:#ff5a4a;font-weight:bold;letter-spacing:2px;margin-bottom:4px">⚔ SHARPEN</div>
          <div style="font-size:10.5px;color:#cdb98a;line-height:1.5">+6% basic-attack damage per tap. 5 taps = +30% hero DPS. Applies to starter heroes and Mercator Champions, including abilities that deal a percent of hero basic damage.</div>
        </div>
        <div style="padding:10px 12px;background:#0a0e1a;border:2px solid #5a9fff">
          <div style="font-size:13px;color:#5a9fff;font-weight:bold;letter-spacing:2px;margin-bottom:4px">⏱ HASTEN</div>
          <div style="font-size:10.5px;color:#cdb98a;line-height:1.5">−5% ability cooldown per tap (compounding). 5 taps ≈ 0.77× cooldown ≈ 23% faster ability cycles. The path for caster heroes — Marius's Capite Censi or Caesar's Pax Romana cycle down to a regular event instead of a once-a-fight beat.</div>
        </div>
        <div style="padding:10px 12px;background:#1a1410;border:2px solid #ffd34d">
          <div style="font-size:13px;color:#ffd34d;font-weight:bold;letter-spacing:2px;margin-bottom:4px">✨ EMPOWER</div>
          <div style="font-size:10.5px;color:#cdb98a;line-height:1.5">+5% to every numeric magnitude inside every hero ability or passive aura per tap. 5 taps = +25%. Damage multipliers, slow %, stun durations, mark strength, splash radius, and hero aura strength all scale. Counts (javelin/shell numbers) and binary flags don't change.</div>
        </div>
      </div>
      <div style="font-size:11px;color:#cdb98a;line-height:1.55;background:#0c0a08;border-left:3px solid #d4af37;padding:8px 12px;margin-bottom:8px">
        <b style="color:#d4af37">Cost ramp (per path):</b> 40g → 80g → 160g → 320g → 640g per tap (doubles each step). A single path maxed = <b style="color:#88ff88">1,240g</b>. All three paths maxed = <b style="color:#88ff88">3,720g</b>. Cheap to sample, steep to max — the first tap on any path is still under one wave's gold, so trying out a new path is never a big commitment.
      </div>
      <div style="font-size:11px;color:#cdb98a;line-height:1.55;background:#0c0a08;border-left:3px solid #ff7733;padding:8px 12px">
        <b style="color:#ff7733">Persistence + refund:</b> Forge stacks reset to 0/0/0 when you draft a fresh hero (after destruction). You get <b style="color:#88ff88">50% of the gold spent</b> refunded on the re-draft so the investment isn't a total loss. Forge progression does <b>not</b> affect XP, tier, or natural ability unlocks — it's a separate axis on top.
      </div>
    `);
    return `${section('THE ROSTER', '<div style="font-size:11px;color:#cdb98a;line-height:1.5">Six historical Roman generals stand in the hero pool. Every run shows <b style="color:#fff8e0">all six in a horizontal-scroll picker</b> — only one champion serves you per campaign. Each hero unlocks <b style="color:#fff8e0">2 abilities</b> (one at LEGATUS, one at CONSUL) and carries up to <b style="color:#fff8e0">3 equipped items</b> — gear is the primary expression lever. Heroes earn XP from every kill on the field (+1 non-boss / +20 boss) and tier up through five ranks as they grow stronger. Heroes occupy a single tile and cannot be sold, moved, or downgraded. Their one combination exception is <b style="color:#ffd34d">MARS VICTOR</b>: starter hero plus the five other Mercator Champions.</div>')}
      ${forgeSection}
      ${cards}`;
  }
  if (tab === 'WAVES') {
    const rows = (waves as any[]).map(w => {
      const spawns = w.spawns.map((s: any) => `${s.count}x ${s.type}`).join(', ');
      const flag = w.type === 'B' ? '<span style="color:#ee5555;font-weight:bold">BOSS</span>' : w.type === 'F' ? '<span style="color:#66ccff;font-weight:bold">FLYERS</span>' : w.type === 'M' ? '<span style="color:#ffd34d">MIXED</span>' : 'GROUND';
      // Append a necromancy tag so the wave table flags reanimation-active rounds at a glance.
      const necroTag = (w as any).necromancy ? ' <span style="color:#aa55ff;font-weight:bold;font-size:10px;letter-spacing:1px;background:#1a0a2a;border:1px solid #aa55ff;padding:1px 4px">💀 NECRO</span>' : '';
      // 2026-05-20 — Resistance-relief tag. Surfaces the per-wave
      // `resistReduction` so players can see at a glance which waves
      // are tuned a notch easier than the faction's baseline. Wave 8
      // currently sits at 0.15 (15% magnitude reduction on resists).
      const relief = (w as any).resistReduction;
      const reliefTag = (typeof relief === 'number' && relief > 0)
        ? ` <span style="color:#88ff88;font-weight:bold;font-size:10px;letter-spacing:1px;background:#0a1a0a;border:1px solid #88ff88;padding:1px 4px" title="Effective resistance reduced ${Math.round(relief * 100)}% across the board on this wave.">🛡 −${Math.round(relief * 100)}% RESIST</span>`
        : '';
      // 2026-05-20 — Checkpoint-heal disable tag. Surfaces waves
      // that suppress the standard checkpoint-touch heal. Wave 11
      // currently carries this so the player can see the Undead
      // Celt intro doesn't stack heal-at-coin on top of reanim.
      const healDisabled = !!(w as any).disableCheckpointHeal;
      const healDisabledTag = healDisabled
        ? ` <span style="color:#aaffaa;font-weight:bold;font-size:10px;letter-spacing:1px;background:#0a1a0a;border:1px solid #66cc88;padding:1px 4px" title="Standard checkpoint heal is suppressed on this wave — enemies do not regain HP at waypoint coins.">✚ NO HEAL</span>`
        : '';
      const speed = (w as any).enemySpeedBoostPct;
      const dmgReduct = (w as any).enemyDamageReductPct;
      const comboAir = (w as any).comboAntiAirArmorPct;
      const dotReduct = (w as any).enemyDotResistPct;
      const regen = (w as any).enemyRegenPctPerSec;
      const speedTag = (typeof speed === 'number' && speed > 0)
        ? ` <span style="color:#ffb366;font-weight:bold;font-size:10px;letter-spacing:1px;background:#1a0e06;border:1px solid #ff8844;padding:1px 4px" title="All enemies on this wave move ${Math.round(speed * 100)}% faster.">⚡ +${Math.round(speed * 100)}% SPD</span>`
        : '';
      const dmgTag = (typeof dmgReduct === 'number' && dmgReduct > 0)
        ? ` <span style="color:#ff7777;font-weight:bold;font-size:10px;letter-spacing:1px;background:#1a0707;border:1px solid #cc5555;padding:1px 4px" title="Direct tower hits are reduced ${Math.round(dmgReduct * 100)}% on this wave.">🛡 −${Math.round(dmgReduct * 100)}% HIT</span>`
        : '';
      const comboAirTag = (typeof comboAir === 'number' && comboAir > 0)
        ? ` <span style="color:#88ddff;font-weight:bold;font-size:10px;letter-spacing:1px;background:#06141a;border:1px solid #55bbdd;padding:1px 4px" title="Flyers reduce non-combo tower direct damage ${Math.round(comboAir * 100)}%. Combo anti-air towers pierce this plating.">COMBO-AA</span>`
        : '';
      const dotTag = (typeof dotReduct === 'number' && dotReduct > 0)
        ? ` <span style="color:#bb88ff;font-weight:bold;font-size:10px;letter-spacing:1px;background:#10071a;border:1px solid #8855cc;padding:1px 4px" title="Damage-over-time ticks are reduced ${Math.round(dotReduct * 100)}% on this wave.">☠ −${Math.round(dotReduct * 100)}% DOT</span>`
        : '';
      const regenTag = (typeof regen === 'number' && regen > 0)
        ? ` <span style="color:#88ff88;font-weight:bold;font-size:10px;letter-spacing:1px;background:#061a08;border:1px solid #55aa55;padding:1px 4px" title="Enemies regenerate ${Math.round(regen * 1000) / 10}% max HP per second on this wave.">✚ REGEN</span>`
        : '';
      // No HP-multiplier column — the value was an internal scaling
      // factor (1.0×, 2.5×, etc.) that confused players. Final on-spawn
      // HP for each enemy lives in the ENEMIES tab where it's surfaced
      // as a concrete number per wave.
      return `<tr><td style="color:#d4af37;font-weight:bold">${w.wave}</td><td>${flag}${necroTag}${reliefTag}${healDisabledTag}${speedTag}${dmgTag}${comboAirTag}${dotTag}${regenTag}</td><td style="color:#9be0ff">${w.faction}</td><td>${w.gold}g</td><td style="opacity:0.85">${spawns}</td></tr>`;
    }).join('');
    return `${section('WAVE SCOUTING', '<div style="font-size:11px;color:#cdb98a">Use this table to plan flyer coverage, boss-killer investment, and item purchases before the warning banner appears. Rows tagged <span style="color:#aa55ff">💀 NECRO</span> reanimate slain grunts as undead — budget for roughly 2× the usual kills. <b style="color:#88ddff">For actual enemy HP at each wave, see the ENEMIES tab.</b></div>')}
      <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="color:#aa9a4a"><th>Wave</th><th>Kind</th><th>Faction</th><th>Reward</th><th style="text-align:left">Spawns</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }
  return '';
}

function section(title: string, body: string): string {
  return `<div data-codex-row style="background:#0c0a08;border:1px solid #3a3025;padding:10px 12px;margin-bottom:10px">
    <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px;margin-bottom:6px">${title}</div>${body}</div>`;
}
// Collapsible variant — used in SYSTEMS / MECHANICS so the long text walls
// don't dominate the codex. Default state is collapsed; click the header to
// expand. Native <details> handles state for free.
function foldSection(title: string, body: string, openByDefault = false): string {
  return `<details ${openByDefault ? 'open' : ''} style="background:#0c0a08;border:1px solid #3a3025;margin-bottom:8px">
    <summary style="font-size:11px;color:#ffd34d;letter-spacing:2px;padding:10px 12px;cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;font-weight:bold">
      <span>${title}</span>
      <span class="fold-caret" style="color:#88ff88;font-size:11px;transition:transform 0.18s">▼</span>
    </summary>
    <div style="padding:0 12px 12px">${body}</div>
  </details>`;
}

function noteCard(title: string, body: string): string {
  return `<div data-codex-row style="background:#1a1410;border-left:3px solid #d4af37;padding:8px 10px">
    <div style="color:#ffd34d;font-weight:bold;font-size:12px">${title}</div>
    <div style="font-size:11px;color:#cdb98a;line-height:1.4;margin-top:3px">${body}</div>
  </div>`;
}

// 2026-05-19 — Boss script table mirrored from EnemyInspect.ts. The
// inspector reads this same table; keeping them in sync (or unified
// into a shared module) is important for the Codex-as-source-of-truth
// guarantee. If you edit the inspector's bossScripts table, mirror
// the edits here.
const BOSS_SCRIPTS_FOR_CODEX: Record<string, string[]> = {
  ALPHA_DOG: [
    'CHAMPION — boss-tier HP',
    'FRENZY — at 30% HP, permanently doubles speed for the rest of the fight (no slow immunity, no timer)',
    'PACK HOWL — every 8s, gives nearby Feral Dogs +50% speed for 3s',
    'DEATH SPAWNS 3 FERAL DOGS at the boss\'s tile'
  ],
  CELTIC_WARLORD: [
    'WAR CRY — at 70% HP, gives all Celts +30% speed for 8s'
  ],
  WAR_ELEPHANT: [
    'STAMPEDE — at 50% HP, status-immune + +75% speed for 4s; strips slow/freeze/stun',
    'IMMUNE TO SLOW & FREEZE',
    'TUSK QUAKE — every 6s, silences every tower within 2 tiles for 0.6s',
    'DUST-SHIELD AURA — protects nearby ground allies from ranged attacks while alive',
    'HEAVY HIDE: higher HP, light sustain, and only +25% damage from SIEGE'
  ],
  UNDEAD_WAR_ELEPHANT: [
    'STAMPEDE at 50% HP (status-immune + 75% speed for 4s)',
    'REBIRTH at 40% HP — heals to 55% HP and summons 2 Ghost Riders',
    'IMMUNE TO SLOW & FREEZE',
    'TUSK QUAKE every 6s — silences nearby towers for 0.6s (25% stronger tower-slow aura than the living elephant)',
    'DUST-SHIELD AURA — protects nearby ground allies from ranged attacks while alive',
    'DENSE BONE HIDE: higher HP and only +5% damage from SIEGE; fire still helps'
  ],
  HANNIBAL_BARCA: [
    'ELEPHANT HEAL — while any War Elephant is alive AND Hannibal hasn\'t been hit by DIRECT damage in 1.0s, heals 0.4% maxHP/sec (active DoT softens to 0.2%/sec)',
    'OUT-OF-COMBAT REGEN — 1.7%/sec after 1.0s without DIRECT damage (active DoT softens to 0.85%/sec, was full block)',
    'TELEGRAPHED REBIRTH at 55% HP — 1s red lock-on warning, then heals to 65% HP, status-immune, +60% speed for 10s, summons 2 War Elephants'
  ],
  BOSS_FLYER_VULTURE: [
    'DIVE BOMB — every 8s, stamps -40% attack speed for 4s on your highest-kill tower',
    'FLOCK CALL — at 50% HP, summons 3 escort Sphinx flyers',
    'SIEGE-IMMUNE — siege damage deals 0. Bring anti-air DIVINE, storm, marks, and non-siege flyer killers.'
  ],
  UNDEAD_WARLORD: [
    'AMBUSH — 5s after spawn, 10 Undead Berserkers rise mid-path',
    'NECROMANCY at 40% HP — raises 6 Undead Celts at his position',
    'FINAL UPRISING at 15% HP — 5 more Undead Celts erupt at the Warlord',
    'DEATH RATTLE — killing blow spawns 20 more undead at the death tile (6 Undead Berserkers + 14 Undead Celts, each at 30% HP). They cannot chain-reanimate.',
    'MID-FIGHT REGEN — 1.0% maxHP/sec while alive (active DoT halves to 0.5%/sec; fire / burn the clean counter at 1.25× damage)'
  ],
  DAEMON_IMPERATOR: [
    'HELLSCAPE — every 12s, stuns the attack cooldown of every tower within ~5 tiles for 1.5s',
    'OUT-OF-COMBAT REGEN — 2.8% maxHP/sec while not taking DIRECT damage (active DoT halves to 1.4%/sec)',
    'DOT-RESISTANT — takes only 30% poison and 30% bleed damage; fire-immune. Direct damage + DIVINE (~1.40× final after faction × per-enemy damper) carry this fight.',
    'W30 FINAL BOSS — Daemon breach ends the run; escorts use normal leak costs'
  ]
};

const ARCH_FOR_CODEX: Record<string, string> = {
  FERAL_DOG: 'SWARM', RABID_DOG: 'RUNNER', ALPHA_DOG: 'BOSS',
  CELTIC_FOOTMAN: 'SWARM', CELTIC_BERSERKER: 'RUNNER', GALLIC_DRUID: 'ELITE',
  CELTIC_SCOUT: 'RUNNER', CELTIC_WARLORD: 'BOSS',
  CARTHAGE_SPEARMAN: 'ARMORED', NUMIDIAN_RIDER: 'RUNNER',
  CARTHAGE_ELITE_GUARD: 'ARMORED', WAR_ELEPHANT: 'BULKY', HANNIBAL_BARCA: 'BOSS',
  UNDEAD_CELT: 'SWARM', ZOMBIE_DRUID: 'ELITE', UNDEAD_BERSERKER: 'RESISTANT',
  SPECTRAL_SCOUT: 'RUNNER', UNDEAD_WARLORD: 'BOSS',
  UNDEAD_SPEARMAN: 'RESISTANT', GHOST_RIDER: 'RUNNER',
  UNDEAD_WAR_ELEPHANT: 'BULKY',
  DEMON_HELLHOUND: 'RUNNER', CELTIC_FIRE_DEMON: 'RESISTANT',
  SHADOW_CAVALRY: 'RUNNER', DEMON_LEGATE: 'ELITE', DAEMON_IMPERATOR: 'BOSS',
  IRON_PHALANX: 'RESISTANT', ARCHITECTUS: 'ARMORED',
  REANIMATED_SKELETON: 'RUNNER', REANIMATED_ZOMBIE: 'SWARM', REANIMATED_LICH: 'ELITE',
  NAGA_ADEPT: 'ELITE', NAGA_SLEEPWEAVER: 'ELITE', NAGA_ORACLE: 'ELITE',
  HELL_GATE: 'ELITE', FIRE_GIANT: 'BULKY', MUMMY_WARRIOR: 'ARMORED',
  MONGOL_HORSE_ARCHER: 'RUNNER', MONGOL_SPEAR_RIDER: 'ARMORED', SPHINX: 'BOSS'
};

const ARCH_COLOR_FOR_CODEX: Record<string, string> = {
  SWARM: '#888', RUNNER: '#88dd88', ARMORED: '#b88a4a',
  RESISTANT: '#a078d0', BULKY: '#cc6644', ELITE: '#ffd34d', BOSS: '#ee2a2a'
};

// 2026-05-19 — Renders one Codex Enemies card. Mirrors EnemyInspect's
// content blocks (banner / head / armor / specific resist / traits /
// boss mechanics) so a player can use the Codex as a reference
// without having to scroll the field for a live enemy click.
function renderEnemyCard(id: string, def: any, ctx: any, allWaves: number[]): string {
  const arch = ARCH_FOR_CODEX[id] ?? 'SWARM';
  const acColor = ARCH_COLOR_FOR_CODEX[arch] ?? '#cdb98a';
  // Wave appearance tag
  let waveTag: string;
  if (ctx.note) {
    waveTag = `<span style="color:#aa55ff;font-size:10px">on W${ctx.wave} (${ctx.note})</span>`;
  } else {
    const waveListStr = allWaves.length > 0
      ? allWaves.map(w => `W${w}`).join(', ')
      : (ctx.wave != null ? `W${ctx.wave}` : '?');
    waveTag = `<span style="color:#9be0ff;font-size:10px">${waveListStr}</span>`;
  }
  const headStats = [
    `<span><span style="color:#aa9a4a;font-size:9px;letter-spacing:1px">HP</span> <b>${ctx.hp.toLocaleString()}</b></span>`,
    `<span><span style="color:#aa9a4a;font-size:9px;letter-spacing:1px">SPEED</span> <b>${def.speed.toFixed(1)}t/s</b></span>`,
    `<span><span style="color:#aa9a4a;font-size:9px;letter-spacing:1px">LEAK</span> <b style="color:#ee5555">${def.livesCost ?? 1} ${(def.livesCost ?? 1) === 1 ? 'life' : 'lives'}</b></span>`,
    def.isBoss ? `<span><span style="color:#aa9a4a;font-size:9px;letter-spacing:1px">BOUNTY</span> <b style="color:#ffd34d">scales with wave</b></span>` : '',
    signatureLegendaryForBoss(id)
      ? id === 'DAEMON_IMPERATOR'
        ? `<span style="color:#ff9933;font-size:10px;font-weight:bold">★ FINAL ARMAMENT AFTER W29</span>`
        : `<span style="color:#ff9933;font-size:10px;font-weight:bold">★ SIGNATURE LEGENDARY DROP</span>`
      : ''
  ].filter(Boolean).join('<span style="color:#3a3025;margin:0 6px">|</span>');

  // Trait list — exact mirror of EnemyInspect's traits[] construction.
  const traits: string[] = [];
  // Combat / damage
  if (def.meleeImmune) traits.push('MELEE-IMMUNE — physical melee deals 0 damage');
  if (def.requiresMeleeBreak) traits.push('SHIELD — ranged & siege ignored until a melee tower cracks the shield');
  if (def.shieldBlockChance) traits.push(`SHIELD BLOCK — ${Math.round(def.shieldBlockChance*100)}% chance to fully block ranged/siege hits (until shield breaks)`);
  if (def.allAttackBlockChance) traits.push(`ALL-ATTACK BLOCK — ${Math.round(def.allAttackBlockChance*100)}% chance per hit to deflect ANY incoming damage (melee, ranged, siege, fire, divine). Never expires, independent of shield state.`);
  if (def.phaseHits) traits.push(`PHASE — ignores the first ${def.phaseHits} hit${def.phaseHits === 1 ? '' : 's'} (MISS floater appears)`);
  if (def.dodgeChance) traits.push(`DODGE — ${Math.round(def.dodgeChance*100)}% chance to evade ranged & siege attacks (melee always lands)`);
  // Status immunities
  if (def.immuneSlow) traits.push('IMMUNE TO SLOW');
  if (def.immuneFreeze) traits.push('IMMUNE TO FREEZE');
  if (def.immuneStun) traits.push('IMMUNE TO STUN');
  if (def.immunePoison) traits.push('IMMUNE TO POISON');
  if (def.immuneFire) traits.push(def.immuneHellfire ? 'IMMUNE TO FIRE + HELLFIRE — direct fire, BURN, and HELLFIRE all deal 0' : 'IMMUNE TO FIRE — direct fire and BURN DoT both 0 (HELLFIRE divine-fire still applies)');
  // Healing / regen
  if (def.regenPctPerSec) traits.push(`REGEN — ${(def.regenPctPerSec*100).toFixed(2)}% maxHP/sec always-on (reduced 50% by any active DoT, was 100% block pre-2026-05-21)`);
  if (def.outOfCombatRegen) traits.push(`OUT-OF-COMBAT REGEN — ${(def.outOfCombatRegen*100).toFixed(1)}% maxHP/sec after 1.0s without DIRECT damage (active DoT softens to ${(def.outOfCombatRegen*50).toFixed(2)}%/sec, was full block pre-2026-05-21)`);
  if (def.checkpointHealPct) traits.push(`CHECKPOINT HEAL — restores ${Math.round(def.checkpointHealPct*100)}% maxHP first time it crosses each of the 7 waypoint coins`);
  if (def.healAllyPctPerSec) traits.push(`HEALER — pulses ${(def.healAllyPctPerSec*100).toFixed(2)}% maxHP/sec to allies within 1.8 tiles (does NOT heal bosses, does NOT stack — multiple healers on the same target apply the highest rate, not the sum)`);
  // Movement modifiers
  if (def.lowHpSpeedBoost) traits.push(`LOW-HP SURGE — when below 30% HP, gains +${Math.round((def.lowHpSpeedBoost - 1) * 100)}% movement speed`);
  if (def.stealthInterval) traits.push(`STEALTH CYCLE — fades to untargetable for ${def.stealthInterval.duration.toFixed(1)}s every ${def.stealthInterval.period}s`);
  if (def.ambushStealth) traits.push(`AMBUSH STEALTH — untargetable for the first ${def.ambushStealthSec ?? 10}s of each wave (visual: alpha 40%). When the window expires, every alive instance becomes targetable at once. Spawns AFTER the window are visible from the start.`);
  // Tower disruption
  if (def.auraTowerSlow) traits.push(`TOWER-SLOW AURA — every tower within ~2 tiles fires ${Math.round(def.auraTowerSlow*100)}% slower while this enemy is in range`);
  if (def.silenceAuraRadiusTiles) traits.push(`SILENCE AURA — every tower within ${def.silenceAuraRadiusTiles} tiles is SILENCED while this enemy is in range (pink X-mark). Expires ~0.6s after the enemy leaves. Distinct from the pass-by silence — this is sustained denial-while-near.`);
  if (def.auraNullifier) traits.push('AURA NULLIFIER — silences every tower aura within 2 tiles (damage/atk-speed/debuff/item auras all drop out). Periodic abilities like Caesar stun pulse and freeze cycles are NOT auras and still fire.');
  const sleepRange = typeof def.sleepDartRangeTiles === 'number'
    ? def.sleepDartRangeTiles
    : (id === 'GALLIC_DRUID' || id === 'ZOMBIE_DRUID' ? 3 : 0);
  if (sleepRange > 0) {
    const sleepDuration = def.sleepDartDurationSec ?? 3;
    const landNote = def.sleepDartLandOnly ? ' Naga sleep magic only targets LAND towers; ocean towers are safe.' : '';
    traits.push(`SLEEP CURSE — channels a slow dart at the nearest awake tower within ${sleepRange} tiles every ~${def.sleepDartCooldownSec ?? 5}s. On hit, that tower is fully inert for ${sleepDuration} seconds.${landNote} STUN or FREEZE cancels the channel.`);
  }
  // Elephant dust-shield (hardcoded by type)
  if (id === 'WAR_ELEPHANT' || id === 'UNDEAD_WAR_ELEPHANT') {
    traits.push('DUST-SHIELD AURA — projects a 4-tile dust dome that makes every NEARBY GROUND enemy untargetable by ranged towers until the elephant dies. The elephant itself is still targetable. Melee towers ignore the dust.');
  }
  // Demon divine resist profile (hardcoded by type set). 2026-05-24
  // corrected per EnemyResistances.ts: regular demons carry per-enemy
  // divine 1.20 (faction +100% × per-enemy 1.20 = ~2.40× combined);
  // Daemon Imperator has a per-enemy divine 0.70 DAMPER (faction
  // +100% × 0.70 = 1.40× final). The card was over-promising the
  // multipliers in both directions.
  const DEMON_SET = new Set(['DEMON_HELLHOUND','CELTIC_FIRE_DEMON','SHADOW_CAVALRY','DEMON_LEGATE','DAEMON_IMPERATOR']);
  if (DEMON_SET.has(id)) {
    if (id === 'DAEMON_IMPERATOR') {
      traits.push("DIVINE PROFILE — per-enemy DIVINE 0.70 (damper) stacks with the SUPER_DEMONS faction +100% divine row → ~1.40× final divine taken. Less divine-vulnerable than lesser demons; lean on DoT-resistant builds + direct DPS.");
    } else {
      traits.push("DIVINE WEAKNESS — per-enemy DIVINE 1.20 stacks with the SUPER_DEMONS faction +100% divine row → ~2.40× final divine taken. Solar Priest, Flamen, Augur, Haruspex are the dedicated demon counters.");
    }
  }
  // Death / multiplication
  if (def.splitOnDeath) {
    const s = def.splitOnDeath;
    const childDef: any = (enemies as any)[s.type];
    const childName = childDef?.name ?? String(s.type).replace(/_/g, ' ');
    traits.push(`SPLIT ON DEATH — spawns ${s.count} × ${childName} at ${Math.round((s.hpFraction ?? 0.4) * 100)}% HP at the death tile`);
  }
  if (def.rebirthAtPct) {
    traits.push(`PHOENIX REBIRTH — on death, bursts into 3 minions of the same type at ${Math.round(def.rebirthAtPct*100)}% HP each (kill still counts; minions can't chain-phoenix)`);
  }
  if (def.deathBurst) {
    const b = def.deathBurst;
    const burstTypes = Array.isArray(b.types) ? b.types : b.type ? [b.type] : [];
    const burstName = burstTypes.map((type: string) => {
      const burstDef: any = (enemies as any)[type];
      return burstDef?.name ?? String(type).replace(/_/g, ' ');
    }).join(' / ');
    const label = b.groundFromFlyer ? 'AIR TRANSPORT' : 'SIEGE CARRIER';
    const landing = b.groundFromFlyer ? 'onto the road at matching route progress' : 'from the death tile';
    traits.push(`${label} — when destroyed, pours out ${b.count} × ${burstName} at ${Math.round((b.hpFrac ?? 0.5) * 100)}% HP, scattering ${landing} (the burst can't chain)`);
  }
  if (def.reanimateAs) {
    const reanimDef: any = (enemies as any)[def.reanimateAs];
    const reanimName = reanimDef?.name ?? String(def.reanimateAs).replace(/_/g, ' ');
    const alwaysReanim = def.faction === 'UNDEAD_CELTS' || def.faction === 'UNDEAD_CARTHAGE';
    const isDruidClass = def.reanimateAs === 'REANIMATED_LICH';
    const isSelfReanim = def.reanimateAs === id;
    if (alwaysReanim) {
      traits.push(`NECROMANCY · ACTIVE — undead faction, every kill spawns 6-9 × ${reanimName} at 85-100% HP at the death tile (risen units can't chain)`);
    } else if (isDruidClass || isSelfReanim) {
      traits.push(`NECROMANCY · dormant trait — fires on W11 + W13 (necromancy-flagged waves per waves.json) → spawns 6-9 × ${reanimName} per kill when active. Distinct from the Skeletal Uprising surprise event on W11 + W14 + W23.`);
    }
  }
  // Gold theft
  if (id === 'GHOST_RIDER') traits.push('GOLD THEFT — on leak, steals 5g + floor(wave/10)g from your treasury');
  // Boss mechanics
  const signature = signatureLegendaryForBoss(id);
  const signatureName = signature ? ((permItems as any)[signature]?.name ?? pretty(signature)) : null;
  const signatureLine = signatureName
    ? id === 'DAEMON_IMPERATOR'
      ? `FINAL ARMAMENT — ${signatureName} is awarded after surviving Wave 29, before the W30 fight. The final boss itself drops no item because victory ends the run.`
      : `SIGNATURE LEGENDARY — drops ${signatureName} on kill. If already claimed, rotates to another unowned legendary.`
    : null;
  const bossLines = [
    ...(signatureLine ? [signatureLine] : []),
    ...(BOSS_SCRIPTS_FOR_CODEX[id] ?? [])
  ];
  // Build the card.
  const armorHtml = renderArmorChips(id);
  const specificResHtml = renderSpecificRes(id);
  const traitHtml = traits.length > 0
    ? `<div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;margin:8px 0 4px">⚠ SPECIAL TRAITS</div>` +
      traits.map(t => `<div style="color:#ff9966;font-size:11px;line-height:1.4;margin-bottom:2px">▸ ${t}</div>`).join('')
    : '';
  const bossHtml = bossLines.length > 0
    ? `<div style="font-size:10px;color:#ee5555;letter-spacing:2px;margin:8px 0 4px">⚔ BOSS MECHANICS</div>` +
      bossLines.map(t => `<div style="color:#ff8866;font-size:11px;line-height:1.4;margin-bottom:2px">▸ ${t}</div>`).join('')
    : '';
  return `<div style="border:2px solid ${acColor};background:linear-gradient(180deg,#1a1410,#0c0a08);overflow:hidden">
    <div style="background:${acColor};color:#1a1410;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;font-weight:bold;letter-spacing:2px;font-size:11px">
      <span>${arch}${def.isBoss ? ' · BOSS' : ''}${def.isFlyer ? ' · FLYER' : ''}</span>
      <span style="font-size:10px;opacity:0.85">${def.faction.replace('_',' ')}</span>
    </div>
    <div style="padding:10px 12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        ${spriteImg(id, 40)}
        <div style="flex:1">
          <div style="font-size:14px;color:${acColor};font-weight:bold;letter-spacing:1px">${def.name}</div>
          <div style="font-size:10px;margin-top:2px">${waveTag}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;font-size:11px;padding-bottom:8px;border-bottom:1px solid #3a3025">${headStats}</div>
      <div style="margin-top:8px;font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-bottom:3px">🛡 ARMOR (faction × per-enemy combined)</div>
      <div style="line-height:1.5">${armorHtml}</div>
      ${(specificResHtml && specificResHtml !== '<span style="opacity:0.45">none</span>') ? `<div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-top:6px;margin-bottom:3px">SPECIFIC RESISTANCES (per-enemy overrides)</div><div>${specificResHtml}</div>` : ''}
      ${traitHtml}
      ${bossHtml}
    </div>
  </div>`;
}

function renderSpecificRes(id: string): string {
  const rows = resistanceSummary(id as any);
  if (rows.length === 0) return '<span style="opacity:0.45">none</span>';
  return rows.map(r => {
    const txt = r.value <= 0 ? 'immune' : `${Math.round((1 - r.value) * 100)}%`;
    return `<span style="display:inline-block;margin:0 3px 3px 0;color:${r.value <= 0 ? '#ee5555' : '#7896c8'}">${r.label} ${txt}</span>`;
  }).join('');
}

// 2026-05-15 v9 ARMOR COLUMN — compact, color-coded chips for the
// LEGIONS tab table. Combines faction + per-enemy resistance into one
// armor % per damage type (same math as EnemyInspect's ARMOR row), so
// players can scan a wave's threat shape without opening each enemy.
function renderArmorChips(id: string): string {
  const rows = armorProfile(id as any);
  if (rows.length === 0) return '<span style="opacity:0.45">—</span>';
  return rows.map(r => {
    let display: string;
    let color: string;
    // 2026-05-18 — Defense-stat sign convention. "+" = positive defense
    // (resists), "−" = less defense (vulnerable). Color also differs:
    // warm = resist, blue = vulnerable.
    if (r.immune)              { display = 'IMM';                          color = '#ee2a2a'; }
    else if (r.armorPct >= 70) { display = `+${r.armorPct}%`;              color = '#ff6b3a'; }
    else if (r.armorPct >= 30) { display = `+${r.armorPct}%`;              color = '#ffaa55'; }
    else if (r.armorPct > 0)   { display = `+${r.armorPct}%`;              color = '#ffd34d'; }
    else if (r.armorPct === 0) { display = '0%';                           color = '#cdb98a'; }
    else                       { display = `−${Math.abs(r.armorPct)}%`;    color = '#7896c8'; }
    return `<span title="${armorDamageTypeShortLabel(r.damageType)}" style="display:inline-block;margin:0 2px 2px 0;padding:1px 4px;background:#0c0a08;border:1px solid #3a3025;color:${color};font-size:9.5px;line-height:1.2"><b style="color:#aa9a4a;font-size:8px;letter-spacing:0.5px">${armorDamageTypeShortLabel(r.damageType).slice(0,3).toUpperCase()}</b> ${display}</span>`;
  }).join('');
}

// 2026-05 v11 (TOOLTIP CLIPPING FIX): the in-card tooltip was rendered as
// a child of the sprite-wrap with `position: absolute`, which meant the
// codex modal's `overflow:auto` (scrolling container) clipped it the moment
// the tooltip extended past the panel's boundary — exactly what the user
// reported. The fix portals tooltip rendering to document.body via JS,
// with computed coordinates each hover and a flip-direction guard so the
// tooltip stays visible regardless of which edge of the panel the hovered
// sprite sits near.
//
// CSS now only defines the visual style; positioning is JS-driven.
function ensureComboTooltipStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('combo-tooltip-style')) return;
  const st = document.createElement('style');
  st.id = 'combo-tooltip-style';
  st.textContent = `
    .combo-sprite-wrap {
      position: relative;
      cursor: help;
    }
    /* Embedded tooltip kept in DOM for fallback / templating — actual
       display is via the body-portal #combo-tooltip-portal element. */
    .combo-sprite-wrap .combo-tooltip { display: none; }
    #combo-tooltip-portal {
      position: fixed;
      background: linear-gradient(180deg, #1a1410, #0c0a08);
      border: 2px solid #d4af37;
      color: #fff8e0;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.45;
      padding: 8px 12px;
      width: 240px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.7);
      pointer-events: none;
      z-index: 10000;
      text-align: left;
      opacity: 0;
      transition: opacity 0.12s ease-out;
    }
    #combo-tooltip-portal.visible { opacity: 1; }
    #combo-tooltip-portal .ct-title {
      font-size: 13px;
      font-weight: bold;
      color: #ffd34d;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    #combo-tooltip-portal .ct-row {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #cdb98a;
      margin-bottom: 2px;
    }
    #combo-tooltip-portal .ct-row b { color: #9be0ff; }
    #combo-tooltip-portal .ct-ability {
      font-size: 10px;
      color: #e8d6a8;
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px dashed #5a4a30;
      line-height: 1.45;
    }
  `;
  document.head.appendChild(st);
}

// Bind a single delegated hover handler to the codex modal that pops a
// tooltip into a fixed-position portal at document.body level. Survives
// codex scrolling because the portal is detached from the modal tree.
function bindComboTooltipPortal(modalRoot: HTMLElement) {
  let portal = document.getElementById('combo-tooltip-portal') as HTMLElement | null;
  if (!portal) {
    portal = document.createElement('div');
    portal.id = 'combo-tooltip-portal';
    document.body.appendChild(portal);
  }
  const hide = () => { portal!.classList.remove('visible'); portal!.style.left = '-9999px'; };
  const show = (wrap: HTMLElement) => {
    const inner = wrap.querySelector('.combo-tooltip');
    if (!inner) return hide();
    portal!.innerHTML = inner.innerHTML;
    // Measure tooltip to flip direction if it would overflow the viewport.
    portal!.style.left = '0px';
    portal!.style.top = '0px';
    portal!.classList.add('visible');
    const tipRect = portal!.getBoundingClientRect();
    const spriteRect = wrap.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Default: place above the sprite, centered. Flip below if it would
    // clip the top of the viewport.
    let x = spriteRect.left + spriteRect.width / 2 - tipRect.width / 2;
    let y = spriteRect.top - tipRect.height - 8;
    if (y < 8) y = spriteRect.bottom + 8;          // flip below
    // Clamp horizontally so tooltip stays inside viewport.
    x = Math.max(8, Math.min(vw - tipRect.width - 8, x));
    // Clamp vertically.
    y = Math.max(8, Math.min(vh - tipRect.height - 8, y));
    portal!.style.left = `${x}px`;
    portal!.style.top  = `${y}px`;
  };
  // Mouseenter / mouseleave with delegation.
  modalRoot.addEventListener('mouseover', (ev) => {
    const target = ev.target as HTMLElement;
    const wrap = target.closest('.combo-sprite-wrap') as HTMLElement | null;
    if (wrap) show(wrap);
  });
  modalRoot.addEventListener('mouseout', (ev) => {
    const target = ev.target as HTMLElement;
    const wrap = target.closest('.combo-sprite-wrap') as HTMLElement | null;
    if (wrap) {
      // Hide only if we actually left the wrap (not jumping to a child).
      const next = ev.relatedTarget as HTMLElement | null;
      if (!next || !wrap.contains(next)) hide();
    }
  });
  // Scrolling the codex body should reposition or hide the tooltip; just hide
  // to keep things simple (next hover repositions correctly).
  modalRoot.addEventListener('scroll', hide, true);
}

function comboTooltipHtml(def: any): string {
  if (!def) return '';
  const tt = def.melee ? 'MELEE' : 'RANGED';
  const dps = def.baseDps ?? 0;
  const aspd = (def.attackSpeed ?? 0).toFixed(2);
  const rng = def.range ?? 0;
  const dmgType = damageTypeLabel(def.damageType);
  const tierBand = def.tierBand ?? def.tier ?? '?';
  // 2026-05-21 — Multi-tier towers (Beast Slayer at T1-T3) carry a
  // `tierBandRange` string; honor it so the tooltip shows the actual
  // rolling range instead of a single-tier anchor.
  const tierLabel = def.tierBandRange ? `T${def.tierBandRange}` : `T${tierBand}`;
  const cc = def.critChance ? `${Math.round(def.critChance * 100)}%` : '—';
  const cm = def.critMult ? `${def.critMult.toFixed(1)}×` : '—';
  return `<div class="combo-tooltip">
    <div class="ct-title">${def.name ?? ''}</div>
    <div class="ct-row"><span>Tier</span><span><b>${tierLabel}</b> · ${tt}</span></div>
    <div class="ct-row"><span>Damage</span><span><b>${dmgType}</b></span></div>
    <div class="ct-row"><span>Base DPS</span><span><b>${dps}</b></span></div>
    <div class="ct-row"><span>Attack Speed</span><span><b>${aspd}/s</b></span></div>
    <div class="ct-row"><span>Range</span><span><b>${rng} tile${rng === 1 ? '' : 's'}</b></span></div>
    <div class="ct-row"><span>Crit</span><span><b>${cc}</b> × <b>${cm}</b></span></div>
    ${def.ability ? `<div class="ct-ability">${def.ability}</div>` : ''}
  </div>`;
}

// 2026-05-17 — Damage-type + mode chip row used by the combo cards.
// Pulls the damageType + melee flag straight off towers.json so the
// COMBINATIONS tab visibly tells the player what attack class each
// combo tower lands as (Melee / Ranged / Siege / Fire / Divine), and
// whether it physically swings or fires a projectile. The chip color
// matches the damage-type ink used in tooltips so nothing reads as a
// new visual language.
function damageTypeChips(def: any): string {
  const dt: string | undefined = def?.damageType;
  const chipFor: Record<string, { bg: string; fg: string; label: string }> = {
    PHYS_MELEE:     { bg: '#c4731a', fg: '#1a1410', label: '⚔ MELEE' },
    PHYS_RANGED:    { bg: '#5aa6d4', fg: '#0c1a22', label: '🏹 RANGED' },
    SIEGE:          { bg: '#8a6a3a', fg: '#1a1410', label: '🏰 SIEGE' },
    ELEMENTAL_FIRE: { bg: '#d4521a', fg: '#1a1410', label: '🔥 FIRE' },
    DIVINE:         { bg: '#e8d070', fg: '#1a1410', label: '✨ DIVINE' }
  };
  const c = (dt && chipFor[dt]) || { bg: '#5a4a30', fg: '#cdb98a', label: 'PHYSICAL' };
  const modeLabel = def?.melee ? '⚔ Melee swing' : '🏹 Projectile';
  const modeBg = def?.melee ? '#2a1f12' : '#0c1a22';
  const modeBd = def?.melee ? '#c4731a' : '#5aa6d4';
  return `<div style="display:flex;justify-content:center;gap:4px;margin-top:4px;flex-wrap:wrap">
      <span style="font-size:9px;background:${c.bg};color:${c.fg};padding:2px 7px;letter-spacing:1.5px;font-weight:bold;border:1px solid #1a1410">${c.label}</span>
      <span style="font-size:9px;background:${modeBg};color:#cdb98a;padding:2px 7px;letter-spacing:1px;font-weight:bold;border:1px solid ${modeBd}">${modeLabel}</span>
    </div>`;
}

function renderComboCard(c: any, cs?: { state: 'ready'|'prospect'|'partial'|'none'; matches: ('owned'|'prospect'|'missing')[]; matched: number; total: number }): string {
  ensureComboTooltipStyle();
  const resultDef: any = (towers as any)[c.result] ?? {};
  const stateColor: Record<string, string> = { ready: '#88ff88', prospect: '#ff9933', partial: '#ffd34d', none: '#5a4a30' };
  const stateLabel: Record<string, string> = { ready: '✓ READY', prospect: '◐ PROSPECT', partial: '◐ PARTIAL', none: '✗ LOCKED' };
  const borderCol = cs ? stateColor[cs.state] : '#3a3025';
  const badgeHtml = cs
    ? `<div style="display:inline-block;background:${stateColor[cs.state]};color:#1a1410;font-size:10px;font-weight:bold;letter-spacing:2px;padding:2px 8px;margin-bottom:6px">${stateLabel[cs.state]} ${cs.matched}/${cs.total}</div>`
    : '';
  // CROSS-COMBO BADGE — if this recipe's result is itself used as an
  // ingredient in another recipe, mark it visually so the player knows
  // it's a stepping-stone tower (e.g. Horseman → War Chariot, Eagle
  // Standard → Aurora Legion). Purple to stand apart from readiness colors.
  const usedInRecipes: string[] = [];
  for (const other of (combos as any[])) {
    if (other.result === c.result) continue;
    if (other.ingredients.some((ing: any) => ing.type === c.result)) {
      const otherDef: any = (towers as any)[other.result];
      usedInRecipes.push(otherDef?.name ?? other.result);
    }
  }
  const usedInBadge = usedInRecipes.length > 0
    ? `<div style="display:inline-block;background:#7733aa;color:#fff8e0;font-size:10px;font-weight:bold;letter-spacing:1px;padding:2px 8px;margin-bottom:6px;margin-left:6px">⚙ STEPPING STONE → ${usedInRecipes.length === 1 ? usedInRecipes[0].toUpperCase() : usedInRecipes.length + ' RECIPES'}</div>`
    : '';
  // Per-ingredient color: green = owned committed tower, orange = pending
  // prospect needs to be kept first, gray = missing entirely.
  const ingMatchColor: Record<string, string> = { owned: '#88ff88', prospect: '#ff9933', missing: '#5a4a30' };
  const ingMatchLabel: Record<string, string> = { owned: '✓ owned', prospect: '◐ prospect', missing: '' };
  const ingredients = c.ingredients.map((ing: any, i: number) => {
    const def: any = (towers as any)[ing.type] ?? {};
    const m = cs ? cs.matches[i] : 'missing';
    const ingBorder = ingMatchColor[m] ?? '#5a4a30';
    const ingText = ingMatchLabel[m];
    return `<div style="display:grid;grid-template-columns:42px 1fr;gap:8px;align-items:center;background:#0c0a08;border:1px solid ${ingBorder};padding:6px">
      <div class="combo-sprite-wrap" tabindex="0" style="width:42px;height:42px;border:2px solid ${ingBorder};background:#100c09;display:flex;align-items:center;justify-content:center">
        ${spriteImg(ing.type, 36)}
        ${comboTooltipHtml(def)}
      </div>
      <div>
        <div style="color:#d4af37;font-weight:bold;font-size:12px">${def.name ?? ing.type}</div>
        <div style="font-size:10px;color:#9be0ff;letter-spacing:1px">Required: Tier ${ing.minTier} or higher ${ingText ? `<span style="color:${ingBorder};margin-left:4px">${ingText}</span>` : ''}</div>
        <div style="font-size:9px;color:#aa9a4a">${damageTypeLabel(def.damageType)}${def.kind ? ` · ${pretty(def.kind)}` : ''}</div>
      </div>
    </div>`;
  }).join('');
  // 2026-05 v11 (Pin Recipe QoL): every combo card carries a PIN button
  // that pins this recipe to the HUD. The button toggles in/out of the
  // array (capped with FIFO eviction).
  // Reads the array on render so the currently-pinned cards show an
  // active state (gold border + "📌 PINNED" label). When all slots are
  // already pinned, the next PIN click drops the oldest recipe.
  const pinnedArr = getPinnedRecipes();
  const pinnedNow = pinnedArr.includes(c.result);
  const pinFull = !pinnedNow && pinnedArr.length >= MAX_PINNED_RECIPES;
  const pinLabel = pinnedNow ? 'PINNED' : (pinFull ? 'PIN (REPLACES OLDEST)' : 'PIN');
  const pinBtnHtml = `<button class="codex-pin-btn" data-pin-result="${c.result}"
    style="background:${pinnedNow ? '#5a3a14' : '#1a1410'};border:2px solid ${pinnedNow ? '#ffd34d' : '#5a4a30'};color:${pinnedNow ? '#ffd34d' : '#cdb98a'};font-family:'Courier New',monospace;font-size:10px;font-weight:bold;padding:4px 10px;cursor:pointer;letter-spacing:1.5px;margin-top:6px;transition:background 0.1s,border-color 0.1s,color 0.1s"
    >📌 ${pinLabel}</button>`;
  return `<div data-codex-row style="background:#1a1410;border:2px solid ${borderCol};padding:10px">
    ${badgeHtml}${usedInBadge}
    <div style="display:grid;grid-template-columns:1fr 92px 1fr;gap:10px;align-items:center">
      <div>
        <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px;margin-bottom:6px">INGREDIENTS</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px">${ingredients}</div>
      </div>
      <div style="text-align:center;color:#aa9a4a;font-weight:bold;font-size:20px">BECOMES</div>
      <div style="background:#0c0a08;border:2px solid #d4af37;padding:8px;text-align:center">
        <div class="combo-sprite-wrap" tabindex="0" style="width:58px;height:58px;margin:0 auto 6px;border:2px solid #5a4a30;background:#100c09;display:flex;align-items:center;justify-content:center">
          ${spriteImg(c.result, 50)}
          ${comboTooltipHtml(resultDef)}
        </div>
        <div style="color:#ffd34d;font-weight:bold;font-size:14px">${resultDef.name ?? c.result}</div>
        <div style="font-size:11px;color:#9be0ff">Result: Tier ${c.tier}</div>
        ${damageTypeChips(resultDef)}
        <div style="font-size:10px;color:#88ff88;margin-top:3px;letter-spacing:1px">DPS: <b>${typeof resultDef.baseDps === 'number' ? Math.round(resultDef.baseDps) : '—'}</b> · Range: <b>${resultDef.range ?? '—'}</b> · Atk/s: <b>${resultDef.attackSpeed ?? '—'}</b></div>
        <div style="font-size:10px;color:#f0c040;margin-top:3px">Cost: ${c.cost}g</div>
        <div style="font-size:10px;color:#cdb98a;margin-top:5px;line-height:1.35">${resultDef.ability ?? ''}</div>
        ${pinBtnHtml}
      </div>
    </div>
  </div>`;
}

function renderFactionResistances(): string {
  const rows = Object.entries(factionRes as any).map(([faction, row]: any) => {
    const vals = ['PHYS_MELEE','PHYS_RANGED','SIEGE','ELEMENTAL_FIRE','DIVINE']
      .map(k => `<td>${row[k] === 'IMMUNE' ? '<span style="color:#ee5555">IMMUNE</span>' : `${Math.round(row[k] * 100)}%`}</td>`).join('');
    const prettyFaction = faction.split('_').map((w: string) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    return `<tr><td style="color:#9be0ff">${prettyFaction}</td>${vals}</tr>`;
  }).join('');
  return `${section('FACTION RESISTANCE MODIFIERS', `<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="color:#aa9a4a"><th style="text-align:left">Faction</th><th>Melee</th><th>Ranged</th><th>Siege</th><th>Fire</th><th>Divine</th></tr></thead><tbody>${rows}</tbody></table>`)}
  `;
}

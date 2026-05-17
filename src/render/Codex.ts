import towers from '../data/towers.json';
import enemies from '../data/enemies.json';
import combos from '../data/towerCombinations.json';
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
import { togglePinnedRecipe, getPinnedRecipes } from './PinnedRecipe';
import { damageTypeLabel, factionName, pretty } from '../format';
import { previewSpawnHp } from '../systems/WaveManager';

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

const RAR: Record<string, string> = { COMMON: '#cccccc', UNCOMMON: '#5cd05c', RARE: '#5ca0ff', LEGENDARY: '#ff9933', UNIQUE: '#ffd34d' };

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

export function showCodex(parent: HTMLElement, ctx?: CodexCtx) {
  if (ctx) lastCtx = ctx;
  closeGameModals();
  const modal = document.createElement('div');
  modal.id = 'codex-modal';
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:60;`;
  const panel = document.createElement('div');
  panel.style.cssText = `background:#1a1410;border:3px solid #d4af37;color:#e8d6a8;padding:14px;width:min(720px,96vw);max-height:90vh;overflow:auto;font-family:'Courier New',monospace;font-size:12px;box-shadow:0 0 28px rgba(212,175,55,0.35);`;
  panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <h2 style="margin:0;color:#d4af37;letter-spacing:3px">LEGION CODEX</h2>
    <button id="codex-close" style="background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:6px 12px;cursor:pointer;font-family:inherit">CLOSE</button>
  </div>
  <div id="codex-tabs" style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;position:sticky;top:0;background:#1a1410;padding:4px 0;z-index:5;border-bottom:1px solid #3a3025"></div>
  <input id="codex-search" type="text" placeholder="🔍 Filter cards in this tab..." style="width:100%;box-sizing:border-box;padding:6px 10px;margin-bottom:8px;background:#0c0a08;border:1px solid #5a4a30;color:#e8d6a8;font-family:'Courier New',monospace;font-size:11px;letter-spacing:1px;outline:none;"/>
  <div id="codex-body" style="padding-top:6px"></div>`;
  modal.appendChild(panel);
  parent.appendChild(modal);

  // 2026-05-17 — WAVES tab removed per design feedback. The per-wave
  // spawn table duplicated info already in the pre-wave brief + ENEMIES
  // tab without adding actionable detail, and it spoiled the upcoming
  // wave composition that the pre-wave tip is calibrated to reveal in
  // a more readable form. The renderTab('WAVES') branch below is now
  // dead code; leaving it in place rather than scrubbing keeps the diff
  // minimal in case a future "Codex Pro" mode wants it back.
  const tabs = ['SYSTEMS', 'MECHANICS', 'QUESTS', 'POOL', 'LEGIONS', 'COMBINATIONS', 'ENEMIES', 'ITEMS'] as const;
  const tabsEl = panel.querySelector('#codex-tabs')!;
  const bodyEl = panel.querySelector('#codex-body')! as HTMLElement;
  let active: typeof tabs[number] = 'SYSTEMS';
  function render() {
    tabsEl.innerHTML = '';
    for (const t of tabs) {
      const b = document.createElement('button');
      b.textContent = t;
      b.style.cssText = `background:${active === t ? '#d4af37' : '#3a3025'};color:${active === t ? '#1a1410' : '#e8d6a8'};border:1px solid #5a4a30;padding:6px 10px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px;`;
      b.onclick = () => { active = t; (searchEl as HTMLInputElement).value = ''; render(); };
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
  // buttons on every combo card. 2026-05-15 v6 — two-pin support: each
  // click toggles this recipe in/out of the array (cap 2, FIFO eviction).
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
  document.getElementById('codex-close')!.onclick = () => {
    modal.remove();
    document.getElementById('combo-tooltip-portal')?.remove();
  };
}

function renderTab(tab: string): string {
  if (tab === 'SYSTEMS') {
    return `
      ${foldSection('NEW HERE? READ THIS BEFORE ROME FALLS', `
        <div style="font-size:11.5px;color:#cdb98a;line-height:1.65;background:#0c0a08;padding:10px 14px;border-left:3px solid #d4af37">
          <b style="color:#ffd34d">Tower defense in 30 seconds:</b> enemies walk from the cave to your gate. If they reach the gate, you lose lives. If you run out of lives, Rome falls and the leaderboard remembers your name. Build towers to make them not get there.
          <br/><br/>
          <b style="color:#ffd34d">The twist that breaks new players:</b> you don't pick which tower you place. Every empty-tile click costs <b style="color:#ffd34d">1g</b> and rolls a random "prospect" tower (max <b>10 per round</b>). Then you KEEP up to <b>two</b>. Everything else turns to stone. The maze you accidentally build is the maze your enemies must walk.
          <br/><br/>
          <b style="color:#ffd34d">The big idea:</b> long twisty mazes = more time in your towers' range = more shots = more dead enemies. <b>Your maze matters at least as much as your towers.</b> Players who don't believe this lose around wave 5.
          <br/><br/>
          <b style="color:#ffd34d">Things you'll wish someone told you:</b>
          <ul style="margin:4px 0 0 14px;padding:0">
            <li>Spam prospect clicks even if you don't want them — unkept ones become free wall stones. The 1g you "wasted" became part of the maze.</li>
            <li>A tower with a <span style="color:#ee5555">pulsing red ring AND glittery sparkles</span> can combine into something nasty. Click it.</li>
            <li>Click any tower to see its full <b style="color:#88ff88">stat breakdown</b> — base damage, every modifier, the actual final number. No hidden math.</li>
            <li>Click any enemy on the field to see exactly what it resists and why your shots aren't landing.</li>
            <li>Hotkeys: <b>SPACE</b> starts a wave, <b>C</b> opens this Codex, <b>B</b>/<b>G</b> opens the gate shop, <b>M</b> opens the Mercator (when he's in town), <b>ESC</b> closes anything.</li>
            <li>You can press START WAVE whenever you want. Leftover prospects auto-convert to walls. The game won't wait for you to be ready; it'll just punish you faster.</li>
            <li>The <b style="color:#88ff88">QUEST panel</b> bottom-right gives away free gold, items, and towers. Pretending it's not there is a choice.</li>
            <li><b style="color:#ffd34d">Mercator</b> (W4/9/14/19) sells real T5 towers at flat 50g — that's how you fill a recipe gap you can't roll. He has his own <b>★ MERCATOR</b> button in the HUD; the regular SHOP button still works for the gate at the same time.</li>
            <li><b style="color:#aa55ff">Necromancy waves (W5/11/13):</b> killed grunts spit a purple portal and <b>6-9 reanimated undead</b> rise at the death tile (85-100% HP each, beefier than the originals). Plan on 7-8× the kills, not 2. They don't chain — the risen form stays dead the second time.</li>
            <li><b style="color:#66ff88">Checkpoint heal:</b> Celtic Berserkers, Sacred Band, Undead Celts, Undead Berserkers, and Undead Spearmen regain 20% HP every time they cross a waypoint coin. Pinch the path right BEFORE coins so the kill window stays narrow.</li>
            <li>Recipe wants T3 but your tower is T4? <b style="color:#ffd34d">DOWNGRADE</b> (2g, in the tower menu) drops it one tier. Pride loses runs.</li>
            <li>This is a 20-wave run. Every leaked enemy hurts. Every BOSS leak costs <b style="color:#ff5050">10 lives</b> AND the boss is REBORN ON THE NEXT WAVE at the HP he had when he reached Rome (chip damage carries over — small consolation). The math is still not on your side.</li>
            <li><b style="color:#ff5050">ENDLESS MODE (post-game):</b> clearing W20 with the gate intact unlocks Endless. After you submit your name to the Hall of Glory, the game transitions to a procedural chaos mode — <b>Mongols and Egyptians attack with returning W1-W20 enemies mixed in</b>, mechanics stack freely (necromancy + dust shield + sleep curse all at once is legal), and each wave clear adds to a separate <b style="color:#ff5050">Endless leaderboard</b>. Difficulty scales aggressively (HP × 1.5 + 0.45 per Endless wave, compounding past E5; +6% tower damage / +4% atk speed / +1 tile range per Endless wave to fight back; tower class-balance nerfs lifted). The run ends when your last life drops.</li>
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
          ${noteCard('DoT', 'Damage Over Time — burn, poison, bleed. Ticks while you sleep. Also shuts off enemy regen, which is why you should care.')}
          ${noteCard('Splash / AoE', 'Damage that ignores how many enemies are nearby. Swarm waves dissolve under this. T1 spam fights it.')}
          ${noteCard('Leak', 'When an enemy reaches Rome. You lose lives equal to their cost. Bosses cost 10 each AND keep walking back for more. The gate is not soundproof.')}
        </div>
      `)}
      ${foldSection('THE LOOP — DO THIS OR LOSE', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('1. Spend Coins, Roll Prospects', 'Click empty tiles. Each click costs 1g and reveals a random tower (max 10 per round). Pending prospects glow gold — they cannot fight yet, but they shape the maze.')}
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
          ${noteCard('Spam clicks like you mean it', 'Every empty-tile click rolls a prospect for 1g (max 10/round). <b style="color:#88ff88">Click more than you intend to keep.</b> The losers cement into walls — that 1g paid for tile-engineering, not just a tower. <b style="color:#ffd34d">100g start gold</b> buys all 10 prospects (10g) AND the first pool upgrade (7g) with <b>83g still left</b> for items + more prospects on round 2. You also start with two free melee items in inventory: <b style="color:#88ddff">Cavalry Spur</b> (+30% atk speed + 0.5 tile range) and <b style="color:#88ddff">Barbed Gladius</b> (Bleed: 2% maxHP/sec for 10s on hit). Equip them on any melee tower to spike opening DPS.')}
          ${noteCard('S-curves, never straight lines', 'The A* pathfinder picks the shortest legal route. Close one shortcut, it finds the next. Drop stones one tile at a time and watch the dotted path update. Make it embarrassing for the enemy.')}
          ${noteCard('Pinch the checkpoints', 'Squeeze the path into a single tile near every checkpoint. AoE/cleave towers (Hastati, Plague Cart, War Chariot, Triumphator) eat single-tile chokes alive.')}
          ${noteCard("You can't fully wall it off", "The game refuses any placement that would orphan spawn, gate, or a checkpoint — you can't grief yourself into a perfect maze. Rejected click? Try one tile over.")}
          ${noteCard('Every tower is also a wall', 'A placed tower occupies its tile. Plan kept towers as path-benders AND damage sources. The best tiles are the ones enemies pass twice.')}
          ${noteCard('Slow towers want long lanes', 'Scorpio (0.35/s), Vulcan Engineer (0.20/s), Colossus Onager (0.15/s) reload like Roman engineering: slowly and on purpose. Park them along straight runs so they never miss their one shot. Every siege tower fires SLOWER and shoots FARTHER than non-siege — per-hit damage scales up to keep effective DPS competitive, but the play pattern is "big slow hits at long range."')}
          ${noteCard('Fast towers want tight turns', "Velites, Numidian Cavalry, Pugio Assassin, Stormcaller fire constantly — corner-park them where every enemy steps within 1-2 tiles. Every shot lands.")}
          ${noteCard('W17 — Iron Phalanx will humble you', 'Melee-immune AND phase the first 2 ranged hits AND regen 4.2%/s out of combat. If your last leg is a single ranged tower with no DoT, the wave is going to walk straight to Rome.')}
        </div>
      `, true)}
      ${foldSection('PROGRESSION — HOW YOU GROW (OR DO NOT)', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Pool Upgrades (cost 7-297g, 8 levels)', 'Each level shifts your prospect rolls toward higher tiers. <b>L1 is the entry tier and grants no damage bonus</b> — starting at L2, every level adds <b style="color:#88ff88">+3% global tower damage</b> (max +21% at L8). Apex level (L8) total is <b>806g</b> across all 8 steps.')}
          ${noteCard('Hero Kill XP', 'Cumulative kills raise hero level. Effective pool = max(gold-purchased pool, hero level). Caps at 5 from kills alone — pool L6+ requires gold purchases.')}
          ${noteCard('Per-Tower Crit Chance', 'Every tower has its own crit profile. Fast attackers (Pugio Assassin 25%, Numidian Cavalry signature 15%) crit often for modest bonuses. Heavy siege (Colossus Onager 6%, Vulcan Engineer 8%) crits rarely for huge multipliers (×3.0–×3.5).')}
          ${noteCard('Same-Tier Merging', '3 identical towers of the same tier merge into the next tier — automatic recipe, no special button. <b style="color:#88ff88">Works for combo towers too</b>: stack 3× Horseman T2 to merge into Horseman T3, all the way up. The survivor gets <b style="color:#88ff88">+15% damage</b> (stacking on each merge). Cheapest path to T5 for any unit.')}
          ${noteCard('Combination Recipes (40 total)', 'Cross-unit recipes turn ingredient towers into a named combo tower. Three classes: <b>single combos</b> (2-3 ingredients), <b>cross-combos</b> (combos as ingredients), and <b>super combos</b> (5 base towers — hardest in the game). <b style="color:#88ff88">Combine in ANY pre-wave phase</b> — execute recipes the moment they\'re completed, even while prospects are still pending placement. Full sortable list in the COMBINATIONS tab.')}
          ${noteCard('🐲 Draconarius (T4)', 'Mid-game combo, the FIRST tower with a <b style="color:#ff7733">CONE FIRE-BREATH</b> in the game. Each shot is a 60° forward fire CONE at <b style="color:#ff7733">MELEE range 2.0</b> (it throws fire, not projectiles at distance — get it close to the path) that hits <b>every enemy in the arc for FULL damage</b> — not splash-decayed — with a visible flame projectile. Every hit stacks <b style="color:#ffd34d">DRAGON MARK</b>: +25% damage taken per stack (cap 3 = <b>+75%</b>), 3 s / <b>5 s on Bosses</b>. The mark amps damage from <b>every tower</b> on the marked enemy. <b style="color:#ff5050">PROXIMITY BURN passive</b>: any enemy within the 2-tile fire-radius is auto-ignited (BURN, 6% maxHP/sec) every half-second, even with zero attacks — walking past it is enough. <b style="color:#ff5050">+60% base damage vs Bosses.</b> Burns ground on cone impact. No ally aura. Recipe: <b>Ignifer T3 + Triarius T3 + Sagittarius T3 — 50g</b>.')}
          ${noteCard('🦁 Bestiarius (T4)', 'Mid-game melee with the FIRST <b style="color:#ffd34d">RAGE GAUGE</b> mechanic. Each consecutive attack on the SAME enemy builds 1 fury stack (cap 8). At 8 stacks the next strike is a <b style="color:#ff7733">FRENZY</b>: <b>6× damage + 1 s STUN</b>, then gauge resets to 0. Vs Bosses, the gauge fills <b>2× faster</b> and FRENZY becomes <b>8× damage</b>. Stacks reset when the target dies, the Bestiarius re-targets, or 4 s pass without a hit — pick chokepoints with sustained bosses to milk the payoff. Polearm reach 2.0. No aura. Recipe: <b>Venator T3 + Auxilia T3 + Hastati T3 — 50g</b>.')}
          ${noteCard('Kill Bonus', 'Veteran towers earn a slow flat-DPS bonus per kill, capped at +10% of base T1 DPS. Bronze (50 kills), Silver (200), Gold (500) badges mark milestones.')}
          ${noteCard('Aura Rings', 'Every local aura on the field draws a visible ring in a consistent color: <b style="color:#c070ff">VIOLET</b> for ally-buff auras (damage / speed / range) and <b style="color:#ff5566">DASHED CRIMSON</b> for enemy-debuff auras (+taken% / slow / mark). Towers with native auras: Eagle Standard, Praetorian Wall, Cohort Guard, Triplex Acies, Legion Prime, Aquilifer, Vestalis. Aura items: Centurion\'s Trumpet, Battle Standard, War Hound Collar, Druid\'s Torc, Barca War Horn, Lich General\'s Seal, Aquilifer\'s Banner, Cursed Torc. Tower attack range stays GOLD so the three layers never confuse. Global auras (Triarius +12%, Caesar +45%, Triumvirate, Imperium, Consular) cover the whole map and don\'t draw rings. <b style="color:#ff9933">STACKING CAP:</b> auras stack multiplicatively (multiple sources compound) but the combined damage AND speed multipliers per tower cap at <b>2.00× each (max +100%)</b>. Stacking 5+ sources hits the ceiling and further auras are wasted — diversify into other multipliers (items, pool damage, marks, vulnerability auras on enemies) past that point. <b style="color:#aaccff">SLEEP/NULLIFICATION:</b> a tower currently asleep (druid dart) or inside an aura-nullifier\'s 2-tile bubble (Architectus) silently DROPS its aura contributions this tick — its aura ring dims to indicate the suspension. Same goes for periodic abilities (Caesar stun pulse, Hannibal\'s Nightmare freeze) which can\'t fire while the tower is asleep. <b style="color:#cdb98a">ENEMY AURAS:</b> Druids + Demon Legate emit a tower-slow aura (2-3 tile, 20-30%); war elephants emit a dust shield (2 tiles, ranged-immunity to nearby ground allies). Both are tied to the enemy being alive — kill the source, the aura drops.')}
          ${noteCard('🎨 Projectile Visual Code', 'Glance at the field and you can tell what kind of damage is in flight: <b style="color:#ffe066">GOLD HALO + rotating sun rays</b> = DIVINE damage (Flamen, Augur, Haruspex, Solar Priest, Pontifex, Imperium Eternum, Fatebinder). <b style="color:#ff8a22">PULSING OUTER RING</b> around a projectile = SPLASH on impact (Vulcan Engineer, Colossus Onager, Siege Onager, Carroballista, Inferno Cart, Plague Cart, Solar Priest, etc.) — the ring shows the splash radius before the hit lands. On hit, splash projectiles drop a tan/cream shockwave ring at the impact point. <b style="color:#88ddff">CLEAVER MELEE</b> (Hastati, Triarius, Cohort Guard, Praetorian Wall, Imperator Guard, Vexillation, Triumphator, Triplex Acies, or anyone with FALX_BLADE equipped) draws a WIDER primary slash + a trailing echo-arc + a faint tan ring on every swing, so a cleaver reads as a cleaver even hitting a single target.')}
          ${noteCard('⚖ Tower Balance Scalars', 'Three hidden class scalars now sit on top of the codex baseDps numbers — your TOWER MENU stat breakdown shows them as discrete lines so the math reconciles:<br/><br/><b style="color:#cc6666">−8% RANGED COMBO BALANCE</b>: every COMBO-kind tower with <b>melee:false</b> (Scorpion Bolt, Numidian Cavalry, Hannibal\'s Nightmare, Frozen Legion, Tribunus, Storm Vexilla, Aurora Legion, Stormcaller, Tesserarius, Vestalis, Pontifex, Nemesis Engine, Plague Cart, Inferno Cart, Aquilifer, Triumphator, Eagle Standard, Draconarius, Aerarium, Scout Vexillum) has its base DPS multiplied ×0.92.<br/><br/><b style="color:#cc6666">−12% APEX BALANCE</b>: the 5 LATE-game super-combos (Imperium Eternum, Carthage Scourge, Triumvirate, Legion Prime, Fatebinder) get ×0.88.<br/><br/><b style="color:#cc6666">−10% T5 BASE BALANCE</b>: the six T5 base towers (Praefectus, Vulcan Engineer, Imperator Guard, Solar Priest, Colossus Onager, Aquila Venator) get ×0.90.<br/><br/>Categories don\'t compound — a tower in two buckets takes the smallest scalar.')}
          ${noteCard('⚔ Combo-Tower Melee Notice', 'Three former-ranged COMBO towers are now <b style="color:#88ddff">MELEE</b> — they need a path-adjacent tile to fire their primary strike:<br/><br/>• <b style="color:#ffd34d">Julius Caesar</b> — range 5.5 → 1.5, damageType DIVINE → PHYS_MELEE. <b>+45% global damage aura still works.</b> The 3s magisterial stun PULSE is now hardcoded to its old 5.5-tile reach so the command-presence ability doesn\'t shrink to the sword\'s reach.<br/>• <b style="color:#ffd34d">God of War</b> — range 5 → 1.5, DIVINE → PHYS_MELEE. Keeps HELLFIRE stamp + DIVINE EXECUTE 10% (true-damage mechanics are hardcoded per tower type so they survive the conversion).<br/>• <b style="color:#ffd34d">Fatebinder</b> — range 6.5 → 1.5, DIVINE → PHYS_MELEE. Primary strike still TRUE damage; map-wide 60% splash echo still fires every hit; +30%/+30% global aura unchanged.<br/><br/>If you have one of these towers from a saved run, place it on or beside the path — they need to physically touch the line now.')}
          ${noteCard('🏹 Siege Tower Identity', 'Every siege tower fires <b style="color:#cc6666">slower</b> and shoots <b style="color:#88ff88">farther</b>. Per-hit damage scales up to keep effective DPS similar — they now play like proper siege (big slow hits at long range). Concrete changes:<br/>• <b>Libritor</b> 0.78→0.63/s, 4.4→5.5 tiles<br/>• <b>Ballistarius</b> 0.42→0.34/s, 6→7 tiles<br/>• <b>Carroballista</b> 0.38→0.30/s, 6.1→7.1 tiles<br/>• <b>Vulcan Engineer</b> 0.24→0.20/s, 6.4→7.5 tiles<br/>• <b>Colossus Onager</b> 0.18→0.15/s, 7→8 tiles (slowest in the game, biggest splash)<br/>• <b>War Chariot</b> 1.0→0.8/s, 3→4 tiles<br/>• <b>Siege Onager</b> 0.2→0.16/s, 7→8 tiles<br/>• <b>Nemesis Engine</b> 0.15→0.12/s (range 50 already map-wide)<br/><br/>Park siege towers on long straight runs so they never miss their reload window.')}
          ${noteCard('Quest System (18 quests)', 'Run-long objectives with tiered rewards (gold / items / free towers). Tracked in the bottom-right HUD panel; full list in the QUESTS tab. Killing bosses also pays a flat bonus of <b>22 + round(wave × 3.5) gold</b>.')}
        </div>
      `)}
      ${foldSection('TOWER ROLES — KNOW WHO DOES WHAT', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Melee Swings At Air', 'Melee cannot reach flyers by default — plan ranged coverage before the flyer wave laughs at your sword wall. The lone exception is the legendary <b style="color:#ffd34d">Aquila Talons</b> item, which unlocks anti-air for one melee tower at a time.')}
          ${noteCard('Anti-Air Specialists', 'Aquila Venator (T3) ONLY targets flyers. Dead weight on ground waves, devastating on flyer waves. Choose your slot.')}
          ${noteCard('Tier Pips Do Not Lie', 'Every tower wears its tier — pip dots above, colored ring at its base. T5 = red ring. If you do not see red rings late game, that is the problem.')}
          ${noteCard('One Item Per Family', 'DAMAGE, SPEED, RANGE, DOT, AURA, ECONOMY, DEFENSE — one each per tower. SPECIAL trophies stack freely. The Senate wrote these rules; do not fight them.')}
          ${noteCard('Attack-class Item Gates', 'Every class-restricted item opens its effect with <b>MELEE ONLY</b> or <b>RANGED ONLY</b> in CAPS.<br/><b style="color:#88ddff">MELEE ONLY:</b> Barbed Gladius, Berserker\'s Muzzle, Aquila Talons, Spear of Mars, Poisoned Blade, Iron Tip, Celtic Longsword, Necrotic Longsword, Cavalry Spur<br/><b style="color:#ff7733">RANGED ONLY:</b> Storm Javelin, Flyer Bane, Fire Oil Flask, Numidian Saddle<br/>The inventory grid greys out incompatible items with the matching <b>ONLY</b> tag so you can\'t mis-equip.')}
        </div>
      `)}
      ${foldSection('DIFFICULTY CURVE — WHEN THE PAIN ARRIVES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Wave 1 (calibration)', 'Every spawn on W1 is hard-pinned to exactly <b>100 HP</b>. The introductory wave should feel like an introduction, not a Feral-Dog math problem.')}
          ${noteCard('Wave 2-4', 'Enemy HP climbs steadily over the early waves. Most prospects roll T1; this stretch teaches mazing. <b style="color:#ffe066">W4 introduces the Shield mechanic early</b>: 2 Gallic Druids carry sacred wards (ranged towers cannot target them until melee bashes the shield). Pair a melee tower with the <b>Barbed Gladius</b> (gate-shop staple, 10g) + starting Cavalry Spur and the Shield Bash (+50% melee damage on first hit) shreds them.')}
          ${noteCard('Linear Per-Wave (+10% HP)', 'Smooth climb every wave — W1 ×1.10, W10 ×2.00, W20 ×4.00 (linear stack). Each wave noticeably tougher than the previous; no off-feeling spike except the boss-clear bump (next card). An extra <b style="color:#ff7766">+10% per wave from W11 onward</b> stacks on top so every mid-late wave is a real step heavier than the one before — not just a +10% absolute creep.')}
          ${noteCard('Per Cleared Boss (×2.00, basics only)', 'Each cleared 5-wave boss <b>DOUBLES</b> the HP of every BASIC enemy for the rest of the run. After 3 cleared bosses (entering W16), every minion takes ×2³ = ×8.0 on top of the linear step. <b style="color:#ffd34d">Bosses themselves are exempt</b> — they scale linearly so each boss feels like a clean step heavier than the last, not an exponential wall.')}
          ${noteCard('Late-Wave Damage Buff', 'Towers get +50% damage per cleared boss to partly keep pace, but enemies scale faster (×2.00 vs ×1.50). Late game is intentionally harder than mid: combo damage, true damage, and aura stacking are how you cover the gap.')}
          ${noteCard('🛡 W11+ Resistance Ramp', 'From <b>Wave 11 onward</b>, every newly-spawned <b style="color:#ff9933">ground non-flyer</b> takes <b>15% less damage</b> across every damage type (Melee, Ranged, Siege, Fire, Divine) AND resists DoTs (Burn, Poison, Bleed, Hellfire) 15% harder. <b style="color:#ff5050">Bosses absorb 25%</b> on both axes. <b style="color:#88ddff">Flyers are unaffected</b> — they\'re already balanced against ranged-only counterplay. Stacks multiplicatively on top of the per-enemy / per-faction resists shown in the ENEMIES tab. Counter by diversifying damage types, stacking tier-ups, layering aura buffs, or leaning on TRUE-damage divine / hellfire sources.')}
          ${noteCard('Iron Phalanx (W17)', 'Melee-immune armored group joins the W17 spawn. Only RANGED damage can hurt them. Plan a ranged backbone before W17.')}
          ${noteCard('Boss Waves (solo, +HP)', 'Scheduled bosses arrive <b style="color:#ff5050">ALONE with 2× HP</b> — no mob horde. The wave is one focused fight. Faction weather intensifies ×1.5. No more atmospheric hazards (lightning / meteors / earthquakes were removed) — the play area stays clean.')}
          ${noteCard('Boss Leak Toll', '<b style="color:#ff5050">Every boss costs 10 lives when it reaches Rome</b>. The boss dies at the gate but is <b>REBORN ON THE NEXT WAVE with the HP he had at the gate</b> — chip damage carries over (Hannibal leaks at 5% HP, returns at 5% HP). The 10 lives is the real toll; the rebirth is a second swing for you to finish him.')}
        </div>
      `)}
      ${foldSection('ECONOMY & VENDORS — WHERE THE GOLD GOES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Gate Shop', 'Refreshes every 4 waves with a freshly randomized lineup (3 Common + 3 Uncommon + 2 Rare items, no duplicates within a visit). Always available between waves via the <b>SHOP</b> button, the <b>B</b>/<b>G</b> hotkey, or clicking the gate tile. Lives also purchasable here (5g/+1 life, capped per visit). <b style="color:#ffe066">Barbed Gladius</b> (MELEE-only bleed, 10g) is a <b>guaranteed staple</b> — one common slot is reserved for it every visit, so a basic melee-bleed option is always reachable from W1.')}
          ${noteCard('Mercator (W4 / 9 / 14 / 19)', 'Traveling merchant. Stocks 4 LEGENDARY trophies (flat 75g each) + 1 Rare + 1 <b style="color:#ff9933">MERCATOR-EXCLUSIVE Rare</b> (Scipio\'s Playbook / Aquilifer\'s Banner / Punic Ledger — never sold at the gate) + 3 mid items (one of which is the exclusive Tyrian Dye). <b style="color:#ffd34d">Traveling Armory</b> offers 5 random <b style="color:#ff5050">TIER 5</b> tower-purchases per visit at a flat <b style="color:#f0c040">50g each</b>. He gets his own gold-bordered <b>★ MERCATOR</b> button in the HUD (or press <b>M</b>) so the gate shop stays usable beside him — both vendors are open the round he visits. He leaves when you press START WAVE.')}
          ${noteCard('🎰 Fortuna\'s Wheel — Combo Tower Gamble', 'Mercator-only mechanic. Pay <b style="color:#f0c040">500g</b> for a <b>RANDOM COMBO TOWER</b> drawn from the full pool of 34 — every combo in the recipe book is on the wheel, T2 through apex T5. <b style="color:#ff5050">Tier rarity is linear:</b> per-spin tier odds are <b style="color:#b87333">T2 40%</b> · <b style="color:#c0c0c0">T3 30%</b> · <b style="color:#ffd34d">T4 20%</b> · <b style="color:#ff5050">T5 10%</b> (weighted 4/3/2/1, then uniform within tier). A specific T5 averages ~230 spins (~115k gold); landing ANY T5 averages ~10 spins. <b style="color:#ff5050">Pure RNG, no pity, no per-visit cap.</b> The spin animation cycles through random portraits before landing on the winner; the tower joins your placement queue exactly like a Mercator T5 buy. Spin counter on the section header tracks how many times you\'ve tempted the goddess this visit.')}
          ${noteCard('Boss-Kill Gold Bonus', 'Every boss kill pays <b>22 + round(wave × 3.5) gold</b> on top of wave-end gold. W20 final boss ≈ +92g. Stack with Aerarium kills for spikes.')}
          ${noteCard('Aerarium Income (treasury combo, T3)', 'Aerarium pays <b style="color:#f0c040">+4 Denarii on every kill it personally lands</b> — NOT a passive tick. Cap of <b>3 Aerariums</b> on the map at once. With 22.4 baseDps + 3.8 tile range it pulls its own weight at a chokepoint. A modest run snipes <b style="color:#88ff88">~20-40g per wave</b>; placing one Aerarium at every chokepoint stacks the income.')}
          ${noteCard('🎯 DPS CHECK', 'Right-panel button between LEADERBOARD and SETTINGS. Spawns a harmless <b>Training Dummy</b> (<b style="color:#88ff88">unkillable — infinite regen</b>) that walks the standard path. Costs nothing, deals 0 damage on leak, doesn\'t block wave-end. The dummy regenerates every tick so it always finishes the walk regardless of how much DPS the maze pumps — measurement stays valid for endgame builds that would one-shot a fixed-HP dummy. Use it between waves to gauge maze throughput before committing to the next wave\'s START. When it reaches Rome the summary popup shows total damage, time on field, effective DPS, and a button to jump to the Tower Leaderboard for per-tower breakdown. Button rearms after the dummy finishes its run.')}
          ${noteCard('Gate Shop Legendaries', 'Every gate-shop refresh includes <b>ONE rotating LEGENDARY</b> on top of the standard 3 commons + 3 uncommons + 2 rares (9 offers total). The legendary changes every 4 waves. Filters against owned legendaries so you never see a duplicate. The SHOP button glows gold + pulses with <b>★ NEW · SHOP</b> when stock refreshes; clear by opening the shop. Mercator (W4/9/14/19) still carries its 4 legendaries + exclusive rare + T5 armory — the gate slot is a steady-state path, not a replacement.')}
          ${noteCard('Sell Prices', 'Selling an item refunds <b style="color:#88ff88">half of its purchase cost</b>. Shop-bought items use the tracked buyPrice; loot-drop items fall back to the item catalog buy field. Rarity-flat fallbacks (COMMON 4g · UNCOMMON 9g · RARE 18g · LEGENDARY 65g · UNIQUE 75g) only fire for items with no buy-price metadata.')}
          ${noteCard('Maze tiles', 'You no longer buy stones directly. Every empty-tile click during prospect phase costs 1g and drops a prospect; the unkept ones cement into stone walls automatically. Click any stone wall later to SELL it back for 1g if the maze needs a redraw.')}
          ${noteCard('Tower Stat Breakdown', 'Click any placed tower to see its full damage / atk-speed / range breakdown — base value, every active modifier (item, aura, pool level), and the final stacked total.')}
        </div>
      `)}
      ${foldSection('DAMAGE TYPE READ — KNOW WHAT YOU HIT WITH', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55">
          <b style="color:#9be0ff">Physical melee</b> dominates chokepoints — and swings at empty air vs flyers. Iron Phalanx laughs at it.
          <b style="color:#9be0ff">Physical ranged</b> handles flyers, phalanxes, long lanes. The bread and butter of every legion.
          <b style="color:#9be0ff">Siege</b> clears clusters in one shot. Slow reloads — give it a sight line worth its time.
          <b style="color:#9be0ff">Fire, poison, bleed, slow</b> win when the enemy lets you. Most undead are poison-immune (and Undead-Carthage is fire-immune too). <b>Super Demons are fully fire-immune</b> — bring divine or physical, not a barrel of burning oil. Read the room. <b style="color:#ffd34d">Demons take BONUS divine damage</b> (×1.5 minion / ×1.3 boss on top of the faction's +100% divine row) — Flamen, Augur, Haruspex, and Solar Priest are the dedicated demon-busters.
          <b style="color:#9be0ff">Divine</b> is the cheat code into heavy resistance. Solar Priest ignores faction resists entirely. Build one. The empire will thank you.
        </div>
      `)}
      ${foldSection('📊 SCORE — HOW THE LEADERBOARD MEASURES YOU', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Base Score', 'Live counter — every kill, boss bonus, perfect-wave clear, modifier survive, twin-boss kill, and quest reward stamps points onto state.score during the run. Watch the HUD; this is the running total.')}
          ${noteCard('Lives + Denarii (end of run)', 'At end-of-run: <b style="color:#88ff88">+100 per surviving life</b> and <b style="color:#f0c040">+10 per unspent denarii</b>. Cushion = points. Hoarding pays in two ways.')}
          ${noteCard('🏆 Speed Bonus', 'Every wave you clear in under <b style="color:#88ff88">60 seconds</b> earns score equal to <b style="color:#88ff88">(60 − actualSeconds) × 25</b>, capped at <b>+1,200 per wave</b>. A 40-second clear = +500 score. A 15-second early-wave blowout = capped 1,200. Run-long total typically lands 4-15k for aggressive play, ~0 for pure-defense slow-clears. End-screen shows a per-wave breakdown and an avg-seconds tag.')}
          ${noteCard('Victory Bonus', 'Clearing W20 awards a flat <b style="color:#ffd34d">+10,000</b> score. Survival is the main score lever; victory is the crown.')}
          ${noteCard('Latin Rank', 'TIRO < MILES (W8+) < CENTURIO (W14+) < LEGATUS (won) < IMPERATOR (won + ≥10 lives) < <b style="color:#ff5050">DIVINUS</b> (won with both Julius Caesar AND God of War on the field).')}
        </div>
      `)}
      ${foldSection('⚡ TIPS & TRICKS — UNCOMFORTABLE TRUTHS', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('COMBINE OR DIE', 'Combine your towers. Or refuse. The enemy prefers you refuse.')}
          ${noteCard('CHECK RESISTANCES FIRST', 'Look at enemy resistances before placing towers. Unless you enjoy watching them stroll past unbothered.')}
          ${noteCard('HOARD A LITTLE GOLD', 'Save some denarii. You will need it when everything goes wrong. And it will go wrong.')}
          ${noteCard('QUESTS PAY REAL GOLD', 'Complete quests. The rewards are real. Your excuses for skipping them are not.')}
          ${noteCard('PLACEMENT > QUANTITY', 'Fewer towers in smarter spots beats more towers in worse spots. The enemy does not care how many you built. Only where.')}
          ${noteCard('SPAM PROSPECTS', 'Every click costs 1g and shapes the maze. The unkept ones become walls. The "wasted" gold paid for engineering.')}
          ${noteCard('DOT BREAKS REGEN', 'Burn, poison, and bleed count as damage. Apply one to anything that regenerates and watch it scream into a wall instead.')}
          ${noteCard('DOWNGRADE FOR RECIPES', 'A T4 tower can drop to T3 for 2g and slot into the recipe you were hoarding for. Pride loses runs.')}
          ${noteCard('AURAS ARE NOT DECORATIVE', 'Every local aura now draws a ring — VIOLET for ally buffs (Eagle Standard, Praetorian Wall, Cohort Guard, Triplex Acies, Legion Prime, Vestalis, plus Centurion\'s Trumpet / Battle Standard / War Hound Collar / Druid\'s Torc / Barca War Horn / Lich General\'s Seal / Aquilifer\'s Banner items) and CRIMSON for enemy debuffs (Aquilifer — solid bright ring at 5 tiles for the +20% damage zone; Cursed Torc item — dashed crimson). Stand inside the violet rings, force enemies to cross the crimson ones.')}
          ${noteCard('MERCATOR SELLS T5 ONLY', 'Mercator only stocks Tier 5 towers, flat 50g each. If a recipe is missing one ingredient, this is where you buy it.')}
          ${noteCard('EMPTY ROUND = +12G', 'Press START WAVE without doing anything and the Senate rewards your patience with 12g. Use the lull to think before you spend.')}
          ${noteCard('SHORT PATH = SHORT GAME', 'If the enemy walks straight to Rome, you lose. Every twist you force is another shot fired. Mazing is the difference.')}
          ${noteCard('KEEP TWO PROSPECTS', 'Two keeps per round. Forever. Pick the ones that fit your build, not the ones that look impressive standalone.')}
          ${noteCard('BOSSES REBORN ON LEAK', '10 lives per leak. The boss dies at the gate, then comes back on the next wave AT THE HP HE HAD WHEN HE LEAKED. Chip damage carries over — so a leak at 20% HP means an easier finish next round, just 10 lives more expensive than killing him on the spot.')}
          ${noteCard('FLYER WAVES ARRIVE FAST', 'Flyer waves arrive at W6, W12, W18 — every 6 waves. If your last leg has no ranged tower, you are sponsoring their parade.')}
          ${noteCard('POOL L2 IS THE FIRST DAMAGE', 'L1 only shifts roll probabilities. The +3% global damage starts at L2 and stacks every level after. Get to L2 fast.')}
          ${noteCard('BOSS-KILL = +22+round(wave×3.5) GOLD', 'Killing a boss pays a flat bounty on top of wave-end gold. W20 final boss ≈ +92g. Loot the corpse — the Senate is generous when it works out.')}
          ${noteCard('THE CODEX IS NOT OPTIONAL', 'You are reading it now. You should read it more. Every recipe, every resistance, every regret avoided lives here.')}
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
            ${noteCard('DECURION', '<b style="color:#88ff88">HISTORICAL.</b> Commander of a <i>turma</i> (cavalry squadron of ~30 men). Sprite is mounted with cape + javelin quiver = correct role.')}
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
            ${noteCard('SKIZZER', '<b style="color:#88ff88">HISTORICAL.</b> The sprite shows a Roman <b>Scissor</b> (Latin <i>scissor</i>, "cutter") — one of the rarest gladiator classes, armed with a curved arm-blade strapped onto the forearm in place of a shield-hand. The half-moon weapon was used in slicing strokes rather than thrusts, and the Scissor was traditionally paired against the Retiarius in the arena, the heavy arm-blade designed to chop through the net. The class is attested from late-Republican gladiator schools (Capua, Pompeii) and survived into the early Empire; surviving epitaphs and reliefs depict the same crested helmet + curved chopper this sprite carries. Internal type id <code>AUXILIA</code> kept for save-game compatibility.')}
            ${noteCard('LIBRATOR', '<b style="color:#88ff88">HISTORICAL.</b> A <b>librator</b> was an army surveyor who measured ground level for camps + siegeworks (from <i>libra</i>, the balance scale). Our sprite — apron, tablet, weighing rod — is exactly that role. The tower\'s siege output represents the structures these surveyor-engineers built (ramparts, ballistae platforms, breaching ramps). Display name shortened from "Librator Fabri" → "Librator" — the sprite already reads as a single-figure surveyor, no need for the longer compound.')}
            ${noteCard('TURRIS', '<b style="color:#88ff88">HISTORICAL.</b> Short for <i>turris ambulatoria</i> — the mobile siege tower with archers on the parapet that Romans rolled up to enemy walls. Our sprite shows exactly that. Heavy-siege role fits the visual perfectly. Display name shortened from "Turris Ambulatoria" → "Turris" for HUD clarity.')}
            ${noteCard('EQUITES', '<b style="color:#88ff88">HISTORICAL.</b> Roman cavalry of the late Republic / early Empire (literally "horsemen"). Our sprite is clearly a mounted skirmisher with cape, crest, and javelin quiver — a textbook eques. Internal enum-name <i>RORARIUS</i> kept for backward-compatibility, but the display now reads simply "Equites" to match the visual. (The pre-Marian rorarii were actually INFANTRY light skirmishers — the original sprite mismatch is what forced the rename.)')}
            ${noteCard('AQUILA VENATOR', '<b style="color:#ffaa55">CINEMATIC.</b> "Eagle Hunter" — a fantasy coinage for the anti-air specialist. The sprite is a mail-armored Roman auxiliary archer (the closest the real legions had to a dedicated anti-flyer role) so the visual reads correctly. Real Romans had no actual anti-flyer doctrine — the Empire never met a dragon — but the auxilia sagittarii were the unit that <em>would</em> have been retasked if eagles started attacking the gate.')}
            ${noteCard('VENATOR', '<b style="color:#88ff88">HISTORICAL-ish.</b> "Hunter." Auxiliary scout-archer drawn from frontier provinces (Pannonia, Britannia). Our sprite shows a buckskin-armored barbarian hunter — close to the historical type.')}
            ${noteCard('IGNIFER', '<b style="color:#ffaa55">CINEMATIC.</b> "Fire-bearer." Not a real Roman rank — coined for the fire-themed siege tower. Likely inspired by <i>incendiarii</i> (Roman incendiary troops) who used pitch-arrows and fire-bundles.')}
            ${noteCard('FLAMEN', '<b style="color:#88ff88">HISTORICAL.</b> A flamen was a state priest dedicated to ONE god (Flamen Dialis for Jupiter, Flamen Martialis for Mars, Flamen Quirinalis for Quirinus). They were forbidden from touching iron — every detail of their daily life was ritualized.')}
            ${noteCard('AUGUR', '<b style="color:#88ff88">HISTORICAL.</b> Priest who divined the will of the gods by watching bird flight (literally <i>auspicia</i> = "bird-watching"). Caesar served as augur. The college of augurs had veto power over public business.')}
            ${noteCard('HARUSPEX', '<b style="color:#88ff88">HISTORICAL.</b> Etruscan-style diviner who read the gods\' will in animal entrails — specifically the liver. The most senior haruspices advised generals before battle.')}
            ${noteCard('PONTIFEX', '<b style="color:#88ff88">HISTORICAL.</b> Short for <i>Pontifex Maximus</i> — chief priest of the Roman state religion. Caesar held the office. The emperors later absorbed it permanently; the title was eventually inherited by the Pope. Display name shortened for HUD clarity.')}
            ${noteCard('VESTALIS', '<b style="color:#88ff88">HISTORICAL.</b> A <i>Vestalis</i> (the Vestal Virgins) kept the sacred fire of Vesta — the hearth of Rome itself. Six women, sworn to chastity for 30 years; the only women in Rome who could own property in their own name. Display name shortened from "Vestalis" → "Vestalis" (the proper Latin singular).')}
            ${noteCard('DRACONARIUS', '<b style="color:#88ff88">HISTORICAL.</b> Late-Empire bearer of a dragon-headed wind-sock banner (the <i>draco</i>), copied from the Sarmatians and adopted around the 4th century AD. The banner howled when wind passed through it — a psychological weapon as much as a unit marker. Display name shortened from "Draconarius" → "Draconarius" (the signifer + draconarius were originally two roles; the tower depicts the latter).')}
            ${noteCard('AQUILIFER', '<b style="color:#88ff88">HISTORICAL.</b> Bearer of the legion\'s <b>aquila</b> (eagle standard). Losing the aquila was the worst dishonor a legion could suffer — Augustus spent years recovering the eagles lost at the Teutoburg disaster. Display name shortened from "Aquilifer" → "Aquilifer" (the "Titan" fantasy suffix was the cinematic part).')}
            ${noteCard('TESSERARIUS', '<b style="color:#88ff88">HISTORICAL.</b> Third-ranking centurion deputy. Held the <b>tessera</b> — a small wooden tablet with the day\'s watchword. Without it, sentries killed you.')}
            ${noteCard('VEXILLATION / SCOUT VEXILLUM', '<b style="color:#88ff88">HISTORICAL.</b> A <i>vexillum</i> was a square flag; a <i>vexillatio</i> was a detachment pulled out of a legion under that flag for a temporary mission.')}
            ${noteCard('COHORT GUARD', '<b style="color:#88ff88">HISTORICAL.</b> A cohort was 480 men (six centuries) — ten cohorts made a legion. "Cohort guard" reads as a detachment standing watch.')}
            ${noteCard('PRAETORIAN WALL', '<b style="color:#88ff88">HISTORICAL.</b> The Praetorian Guard was the emperor\'s personal guard cohort. They also famously made and unmade emperors — at one point auctioning the throne.')}
            ${noteCard('TURMA LANCERS', '<b style="color:#88ff88">HISTORICAL.</b> A <i>turma</i> was a 30-man cavalry squadron, commanded by a decurion. Three turmae per cohort of cavalry.')}
            ${noteCard('TRIBUNUS', '<b style="color:#88ff88">HISTORICAL.</b> Short for <i>Tribunus</i> — "tribune with the broad stripe." Senatorial-rank young officer (≥18 years old), second-in-command of a legion. The purple <i>latus clavus</i> stripe on his tunic marked his class — a step on the senatorial career ladder. Display name shortened for HUD clarity.')}
            ${noteCard('TRIPLEX ACIES', '<b style="color:#88ff88">HISTORICAL.</b> The triple battle line. Caesar\'s favorite formation: hastati / principes / triarii in three staggered ranks, with the third reserved for emergencies. "Inde res ad triarios rediit" — "now it falls to the triarii."')}
            ${noteCard('IMPERIUM AETERNUM', '<b style="color:#88ff88">HISTORICAL phrase.</b> "Eternal empire." Roman propaganda for what they believed (and the Senate decreed) was an empire blessed by the gods to never fall. They were wrong by ~1000 years.')}
            ${noteCard('FATEBINDER', '<b style="color:#ffaa55">CINEMATIC.</b> Originally "Fatebinder." A <b>consul</b> was the highest elected magistrate of the Republic — two were elected each year. "Fatebinder" is fantasy. The apex tier nudge: this is the consul who has stopped pretending the gods choose. Display name shortened to just "Fatebinder" for HUD clarity.')}
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
          ${noteCard('Necrotic Miasma (Undead Celts)', '−15% attack speed. Fast units (Pugio Assassin, Numidian Cavalry) lose more output proportionally.')}
          ${noteCard('Cursed Wind (Undead Carthage)', '−35% status duration. Slow/freeze/burn builds weaken. Lean on raw damage instead.')}
          ${noteCard('Hellscape (Super Demons)', 'Combo penalty: 8% miss, −0.5 range, −10% atk speed, −20% status. Plus a final-fight ember overlay.')}
          ${noteCard('Pack Dust (Dogs)', 'Light haze, 3% miss only. Cosmetic for early-game.')}
        </div>
      `, true)}
      ${foldSection('WAVE MODIFIERS (random ~30% from W3+)', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('🔴 Blood Moon', 'Every enemy in the wave has +25% HP and a crimson tint. A pure stat wall.')}
          ${noteCard('⚡ Storm Surge', 'Every 8s a random enemy is struck by lightning, gaining +50% speed for 3s. A blue impact ring marks the target.')}
          ${noteCard('🟣 Death Pact', 'Each kill heals every other surviving enemy 4% HP. Trade kills late = enemies regen most of it back. Burst hard.')}
          ${noteCard('🌫 Veil', 'Every 6s, all enemies become untargetable for 0.8s — they fade to 40% alpha. DoTs keep ticking, but new shots cannot acquire them. Time your big shots for the gaps.')}
          ${noteCard('👻 Revenant', 'Every dead enemy silences the nearest tower for 1.5s as a ghost. A pink X-mark flashes on silenced towers.')}
          ${noteCard('🟠 Group March', 'Bunched enemies (3+ within 2 tiles) gain +20% speed. Maze-induced clustering is now risky.')}
        </div>
      `)}
      ${foldSection('⚠ SURPRISE EVENTS — mid-wave ambushes', `
        <div style="margin-bottom:8px;padding:8px 10px;background:#2a0c08;border:1px solid #ff7733;color:#ffd1cc;font-size:11px;line-height:1.5">
          <b style="color:#ff7733">Spoiler.</b> The campaign hides two ambient events behind a no-warning trigger so the first encounter lands as a real <i>"what just happened?"</i> moment. Read on only if you want to know the schedule and the rules before you see it in play.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('⚔ Invasion (W7 and W18)', 'Eight seconds into the wave, <b style="color:#ff7733">FOUR FIRE BREACHES</b> erupt around the map perimeter (N, S, E, W edges). One barbarian crawls out of each fire, staggered ~1.2s apart, for <b style="color:#ff7733">4 surprise enemies total</b>. Each enemy snaps onto the nearest path tile and joins the standard route. The screen flashes warm red and a low-brass sting plays the moment the first fire ignites. Burn-zone scars persist for the rest of the wave so you remember where the breach happened.')}
          ${noteCard('☠ Skeletal Uprising (W11 and W14)', 'Only fires during <b style="color:#aa66ff">undead waves</b>. A diamond of <b style="color:#aa66ff">FOUR SKULL URNS</b> erupts from the ground in the map center (5×5 randomized zone) with a ground-crack particle and a discordant organ sting. One undead emerges from each urn — again 4 surprise enemies, staggered. The screen washes sickly purple. After the event ends, urn silhouettes remain as visual scars. Enemies that spawn from urns may overlap your towers (the towers stay; the urn just rises through them — they look like the dead are crawling out from under your defenses).')}
          ${noteCard('🛡 Indestructible Portals', 'Fires and urns are <b>cosmetic only</b>. You cannot kill them, push them, or extinguish a breach. They light up, deliver their enemies, then fade. Focus your fire on the spawned enemies instead.')}
          ${noteCard('🎁 Reward — your pick', 'After the last surprise enemy dies (or leaks), the game pauses and a 3-card choice modal opens. Pick ONE <b style="color:#7ec3ff">RARE</b> or <b style="color:#7ee07e">UNCOMMON</b> item from the existing pool — no new items invented, no DoT rolls (those stay Mercator-exclusive). If your inventory is full at pick time, the reward is forfeited (clear a slot before the event if you can predict one is coming).')}
          ${noteCard('⏱ Cooldown', 'Minimum <b>3 waves</b> between any two events, regardless of type. Boss waves (5/10/15/20) and flyer waves are exempt — events never fire on them. The fixed campaign schedule (W7 → W11 → W14 → W18) already respects all rules; in Endless mode each wave rolls a 25% chance with the same cooldown.')}
          ${noteCard('🎵 Audio identity', '<b style="color:#ff7733">Invasion:</b> heavy low-brass descending triad + crackling fire hiss + low impact thud. <b style="color:#aa66ff">Uprising:</b> dissonant minor-second church-organ stab + bone-rattle clicks + deep dirge note. The two are deliberately tuned to be IDENTIFIABLE by sound alone — close your eyes and you can name the event.')}
        </div>
      `)}
      ${foldSection('WAVE STRUCTURE', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Boss Crescendo (W5/10/15/20)', 'A boss anchors every 5th wave. Basic-enemy HP doubles each cleared boss; bosses themselves scale linearly so they\'re a real step but not a wall. Tower damage scales +50% per cleared boss to partly keep pace. Final wave 20 is the climactic battle.')}
          ${noteCard('Iron Phalanx (W17)', 'Melee-immune Iron Phalanx that also phase the first 2 ranged hits. Bring sustained ranged DPS + DoT to break through.')}
          ${noteCard('Bonus Bosses (after W11, 25%)', 'Scheduled boss waves (W15 / W20) can spawn a SECOND boss. Kill him: <b style="color:#88ff88">2.5× wave gold +50g flat, +2 lives restored, +1 free RARE item, +3000 score</b>. Let him leak: 10 lives AND he returns next wave at the HP he leaked at (chip damage carries). Banner: 🎲 TWIN BOSSES.')}
          ${noteCard('Surprise Bosses (after W16, 15%)', 'Any wave after W16 can ambush you with an extra boss (W17–W20). Same deal: <b style="color:#88ff88">2.5× wave gold +50g +2 lives +1 RARE item +3000 score</b> if killed, 10 lives per leak otherwise. Banner: 🎲 AMBUSH BOSS. A free UNCOMMON item drops on ARRIVAL as a consolation, whether you finish him or not.')}
          ${noteCard('Wave Modifier (30% from W3)', 'A random mutation (Blood Moon / Storm Surge / Death Pact / Veil / Revenant / Group March) lands on the wave. The gods drop a <b>free Uncommon item</b> on arrival, and surviving pays an extra <b style="color:#88ff88">+40g RNG bonus + 1500 score</b>. The modifier rolls AFTER you press START — you cannot prepare specifically, only build resilient.')}
          ${noteCard('Empty Round Bonus', 'If you press START WAVE without placing anything (no prospects revealed, no items bought, no pool upgrades, no combos), you earn +12g for strategic patience.')}
          ${noteCard('Perfect Wave Bonus', 'Clear a wave with <b style="color:#88ff88">zero leaks</b> — every enemy killed before reaching Rome — and you earn <b style="color:#ffd34d">+50g bonus</b> on top of the wave reward + 200 score. A gold ring flashes at the gate to mark the clean defense.')}
          ${noteCard('20-Wave Curve', 'BASIC enemies: HP climbs +10% per wave linearly, with an <b>extra +10% per wave from W11 onward</b>, all multiplied by <b>2.00× per cleared boss</b>. BOSSES: linear-only progression — they ignore the per-5-wave doubling and ride just the linear stack (W5 ×1.5, W10 ×2.0, W15 ×3.0, W20 ×4.0). Each boss feels like a real step heavier than the last, not a brick wall.')}
        </div>
      `)}
      ${foldSection('ENEMY SIGNATURES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Out-of-Combat Regen', 'Zombie Druid, Ghost Rider, Hannibal, Daemon Imperator regen X% HP/s after 0.5s without taking damage. <b style="color:#ff7733">DoT (burn / poison / bleed) ticks count as damage</b> — keeping any DoT active completely shuts off regen. (<b style="color:#88ddff">Note:</b> Gallic Druid no longer regenerates — W4 is a clean intro to the shield mechanic without DoT pressure.)')}
          ${noteCard('Phoenix Rebirth', 'Spectral Scout, Celtic Fire Demon, and Undead Celt burst into <b style="color:#ffaa66">3 reduced-HP minions</b> on death — each at 40% / 35% / 25% HP respectively. The original kill still counts; the minions cannot chain-phoenix when killed. Orange impact ring marks the burst. Plan on roughly 3× the kill budget for these enemies and stack DoTs that tick through respawns.')}
          ${noteCard('Phase-Through Hits', 'Spectral Scout (2), Iron Phalanx (2), Celtic Berserker (1), Undead Berserker (1), Undead Spearman (1), Carthage Spearman (1) ignore the first N hits taken — a "MISS" floater pops on each phased shot.')}
          ${noteCard('Dodge (ranged)', 'Numidian Rider (20%), Ghost Rider (15%), Shadow Cavalry (25%) have a chance to dodge incoming ranged / siege attacks. Melee always lands.')}
          ${noteCard('Stealth Cycle', 'Celtic Scout (~1.2s untargetable every 7s), Ghost Rider (~0.8s every 5s), Shadow Cavalry (~1.0s every 6s). Towers cannot acquire them while stealthed — they fade out briefly.')}
          ${noteCard('Healer Enemies', 'Zombie Druid (1.8% HP/s) and Demon Legate (1.5% HP/s) emit a 1.8-tile heal ring that restores HP to nearby allies (NOT bosses). Kill the healers first. (<b style="color:#88ddff">Gallic Druid no longer heals</b> — its W4 role is the sacred-ward shield + the tower-slow aura.)')}
          ${noteCard('Split-on-Death', 'Demon Hellhound splits into 2x Feral Dogs (35% HP each). Celtic Fire Demon splits into 1x Demon Hellhound (50% HP). Spawned children continue the path from where the parent fell.')}
          ${noteCard('Low-HP Speed Burst', 'Rabid Dog, Celtic Berserker, Demon Hellhound surge +50–60% speed when below 30% HP. Finish them or they leak.')}
          ${noteCard('Tower Silence', 'Spectral Scout / Ghost Rider passing within 1.2 tiles of a tower silences it for 0.6s. Pink X-mark icon. Position power towers off the path.')}
          ${noteCard('Checkpoint Heal', 'Celtic Berserker, Sacred Band (Carthage Elite Guard), Undead Celt, Undead Berserker, and Undead Spearman regain <b style="color:#66ff88">20% maxHP</b> the first time they cross each of the 7 waypoint coins. Each checkpoint pays out once per enemy. A green ✚ plus-pulse marks the heal. Bosses and flyers are exempt — kill the stubborn grunts BEFORE the next coin or they walk back to full.')}
          ${noteCard('Necromancy', '<b style="color:#ff9933">Two trigger paths:</b><br/><br/><b>1. Tagged necromancy waves (W11 / W13)</b>: every Celtic Footman, Celtic Berserker, Gallic Druid, Carthage Spearman, Undead Celt, Zombie Druid, or Undead Berserker you kill spits a purple portal and <b style="color:#aaffcc">6-9 reanimated undead</b> rise at the death tile.<br/><br/><b>2. Always-on for undead factions</b>: every UNDEAD CELTS or UNDEAD CARTHAGE minion (Undead Celt, Zombie Druid, Undead Berserker, Spectral Scout, Undead Spearman, Ghost Rider, Architectus) reanimates on death <b>regardless of wave</b>. Bosses + flyers are exempt, and risen units don\'t chain (the <b>__reanimated</b> flag stops the loop). Plan on 7-8× the kills on any late-wave undead lineup.<br/><br/><b style="color:#ff7733">Per-kill count:</b> <b>6-9 risen</b>. Distribution: 45% / 35% / 15% / 5% for 6 / 7 / 8 / 9 risen, each at 85-100% HP. Skeleton-axe for berserker types, blue zombie for footman / spearman types, hooded green-flame lich for druid types.')}
          ${noteCard('Gold Theft (Ghost Rider)', 'On leak, Ghost Rider also steals 5g + floor(wave/10)g from your treasury. A W18 ghost steals 6g per leak.')}
          ${noteCard('🛡 Shielded Units', '<b style="color:#9be0ff">Gallic Druid (W4 sacred ward)</b>, <b style="color:#9be0ff">Carthage Elite Guard (W8)</b>, <b style="color:#9be0ff">Undead Spearman (W16+)</b>, and <b style="color:#9be0ff">Architectus (W18+)</b> cannot be targeted by ranged towers until a melee tower hits them. <b style="color:#ffe066">SHIELD BASH:</b> the first melee hit on a still-shielded enemy deals <b style="color:#ffe066">+50% damage</b> — the legionary slams his pommel into the scutum before the shield gives way. Applies to both single-target swings AND cleave secondaries; stacks multiplicatively with armor shred, faction resist, and item bonuses. A golden impact ring marks the bash that breaks the shield. The W4 druid intro is a clean teaching wave — no regen, no heal aura, just shields + tower-slow aura, so the player can focus on learning the melee-bash flow.')}
          ${noteCard('Tower-Slow Aura', 'Gallic Druid, Zombie Druid, Demon Legate emit a 2-3 tile aura that slows tower attack speed by 20–30%. Kill these support units fast.')}
          ${noteCard('💤 Druid Sleep Curse', '<b style="color:#aaccff">Both druids now cast an active sleep dart</b> in addition to their passive tower-slow aura. Every ~5 seconds, the druid roots in place for a 0.5s telegraphed channel (the player\'s window to interrupt) then launches a slow cyan/purple homing orb at the nearest awake tower within 3 tiles. On hit, that tower is <b style="color:#aaccff">fully inert for 3 seconds</b> — no targeting, no shots, ZZZ animation overhead. Counters: kill the druid before the dart lands, STUN/FREEZE the druid mid-channel, or use a melee bash on the druid (it has a sacred-ward shield until cracked).')}
          ${noteCard('🛡 Elephant Dust Shield', '<b style="color:#cdb98a">War Elephants and Undead War Elephants project a 2-tile dust dome</b> that makes every NEARBY GROUND enemy untargetable by ranged towers until the elephant dies. Visual: dust-brown rotating dome around the elephant + small gold sparkle over each protected ally. The elephant itself stays ranged-targetable (you can still chip it down). <b style="color:#88ddff">Melee towers ignore the dust</b> — they hit allies inside the dome normally. Best counter: <b style="color:#ff9933">siege towers</b> (elephants take +45% from siege).')}
          ${noteCard('Status Immunities', 'Rabid Dog (slow), Celtic Berserker (slow), Undead Berserker (freeze/poison/stun), Undead Celt (poison), Zombie Druid (poison), Undead Spearman (poison), Reanimated Skeleton (freeze/poison), Reanimated Zombie (poison), Reanimated Lich (poison). Inspect enemies to see exact resists.')}
        </div>
      `)}
      ${foldSection('BOSS SIGNATURES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('🐺 Alpha Dog (W3 champion)', 'Frenzy at 30% HP doubles speed. Pack Howl every 8s grants +50% speed to nearby Feral Dogs. Death spawns 3 Feral Dogs. <b style="color:#ff9933">Always drops a LEGENDARY on kill</b> — the first guaranteed marquee reward of the run.')}
          ${noteCard('⚔ Brennus (W5)', 'The Celtic chieftain who sacked Rome in 387 BC, named for the Senonian war-king. War Cry at 70% HP grants +30% speed to all Celts for 8s. Otherwise a clean straight-up fight to the death — no rebirth, no surge, no necromancy on his wave.')}
          ${noteCard('🐘 War Elephant (W9 + W10 boss adds)', 'STAMPEDE at 50% HP: status-immune + 75% speed for 4s; strips slow/freeze/stun. Permanently <b style="color:#88ddff">SLOW + FREEZE IMMUNE</b>. <b style="color:#ff7733">Tower-Slow Aura</b>: every tower within 2 tiles fires 20% slower. <b style="color:#ff5050">TUSK QUAKE</b>: every 6s silences every tower within 2 tiles for 0.6s (a dust-brown ring marks the pulse). The Undead variant cranks the aura to 25%. <b style="color:#cdb98a">DUST-SHIELD AURA</b>: a 2-tile dome around the elephant makes nearby GROUND allies untargetable by ranged towers until the elephant dies. Melee + the elephant itself stay targetable. <b style="color:#ff9933">WEAKNESS: +45% damage from SIEGE</b> — heavy stones crush elephant hide.')}
          ${noteCard('⚔ Hannibal Barca (W10)', 'Heals 0.4%/s while War Elephants live (only when not taking damage). Out-of-combat regen 1.7%/s. <b style="color:#ff7733">DoT (burn / poison / bleed) counts as damage and suppresses both heals.</b> REBIRTH at 50% HP: +60% speed, status-immune, summons 2 War Elephants. <b style="color:#ff5050">TELEGRAPH:</b> a shrinking red lock-on ring + crosshairs appear on him 1 second before rebirth fires — use that window to burst him into a different timeline.')}
          ${noteCard('🐘💀 Undead War Elephant (W14 champion)', 'Stampede at 50% HP. REBIRTH at 40% HP: summons 2 Ghost Riders. Heavy regen. <b style="color:#cdb98a">DUST-SHIELD AURA</b>: a 2-tile dome around the elephant blocks ranged shots on nearby ground allies until it dies. Tower-slow aura cranked to 25% (vs 20% on the living variant). <b style="color:#ff9933">WEAKNESS: +40% damage from SIEGE</b>.')}
          ${noteCard('💀 Undead Warlord (W15)', 'After 5s: AMBUSH 8 Undead Berserkers mid-path. NECROMANCY at 40% HP: raises 4 Undead Celts at his position.')}
          ${noteCard('😈 Daemon Imperator (W20 — final boss)', 'Base speed 0.85 tiles/sec. HELLSCAPE every 12s stuns nearby tower cooldowns. REBIRTH at 60% HP into Wrathful: +90% speed (still slower than most bosses), status-immune for 6s. <b style="color:#88ddff">W20 is a TRUE solo encounter — no mobs, no helpers, just you vs the Daemon.</b> <b style="color:#ff5050">W20 LOCKDOWN: a single leak ends the run — Rome falls if you cannot hold the gate.</b>')}
        </div>
      `)}
      ${foldSection('ELITE MUTATIONS (4-20% chance, mid-late game)', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('🛡 Veteran (bronze ring)', '+50% HP. Pure tank — sponges your kill window.')}
          ${noteCard('💨 Swift (green ring)', '+50% speed. Outruns slow towers, leaks fast.')}
          ${noteCard('💥 Bloated (purple ring)', '+120% HP. On death, splits into 3 minions at his location. Kill mid-path with caution.')}
          ${noteCard('✨ Warded (blue ring)', 'All status effects 30% as effective. Slow/freeze barely register.')}
          ${noteCard('⭐ Aura-Star (gold ring)', 'Allies within 3 tiles get +30% speed. Kill the star first.')}
        </div>
      `)}
      ${foldSection('TOWER SIGNATURES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Cleave Melee', 'Hastati, Triarius, Cohort Guard, Praetorian Wall, Imperator Guard, Vexillation, Triumphator, Triplex Acies hit ALL enemies in melee range. Secondaries take 70%.')}
          ${noteCard('Multi-Shot Ranged', 'Decurion (2), Carroballista (2), Numidian Cavalry (2), Hannibals Nightmare (2), Scorpion Bolt (3), Aurora Legion (4 piercing line), Carthage Scourge (6) fire multiple shots per attack.')}
          ${noteCard('Anti-Air Only', 'Aquila Venator only targets flyers. Useless on ground waves but devastating on flyer waves.')}
          ${noteCard('Trident & Net (Retiarius)', 'First hit on a NEW target deals 2× — the net pins them, the trident drives home. Applies Armor Shred on every strike.')}
          ${noteCard('Brutal Opener (Accensus)', '+60% damage on enemies above 85% HP.')}
          ${noteCard('Backstab (Pugio Assassin)', '+50% damage vs Runner archetype.')}
          ${noteCard('Marked Prey (Venator)', 'Hits on flyers Mark them for +25% damage from all sources.')}
          ${noteCard('Spotter (Speculator)', 'Applies Mark (+15%) AND Armor Shred together.')}
          ${noteCard('Tactical Stacks (Evocatus)', '+5% damage per kill, capped at +50%. Kept Evocati get terrifying.')}
          ${noteCard('Foresight (Haruspex)', '20% chance to double-strike.')}
          ${noteCard('Solar Flare (Solar Priest)', 'Damage IGNORES all faction resistances. The endgame answer to Undead/Demon.')}
          ${noteCard('Earthshatter (Colossus Onager)', 'Every hit knocks the target backward along the path.')}
          ${noteCard('Siege Kickback (Ballistarius)', 'Every 3rd shot knocks the target back.')}
          ${noteCard('Charge (Horseman combo)', 'Every hit Marks target +20% next-damage from anyone.')}
          ${noteCard('Trample (War Chariot combo)', 'Every 4th attack stuns AND knocks back ground enemies. +50% vs bosses.')}
          ${noteCard('Damage-Type Identity', 'Scorpio +40% vs Bosses · Sagittarius +45% vs Flyers · Venator +45% vs Flyers · Aquila Venator +75% vs Flyers · Horseman +20% vs ground · Turma Lancers +30% vs ground · Scorpion Bolt +12% vs Flyers/Bosses · Nemesis Engine +200% vs Flyers · Pontifex +200% vs Bosses · Carthage Scourge +250% vs Bosses · Hannibal\'s Nightmare +200% vs War Elephants.')}
          ${noteCard('Triarius Global Aura', '+12% global damage to every other tower while a Triarius is on the field.')}
          ${noteCard('Cohort Guard Aura', 'Projects a 3-tile +15% damage aura to nearby towers in addition to its cleave + slow.')}
          ${noteCard('Frozen Synergy', 'Any enemy currently FROZEN takes <b style="color:#88ddff">+50% damage from every source</b>. Frozen Legion + a single freeze proc makes the whole battlefield squishier.')}
          ${noteCard('Periodic AoE Freeze', 'Hannibal\'s Nightmare freezes everything in range every 10s. Carthage Scourge does the same every 8s.')}
        </div>
      `)}
      ${foldSection('STATUS GLOSSARY', `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:10px">
          ${noteCard('SLOW', 'Reduces enemy speed by magnitude%.')}
          ${noteCard('FREEZE', 'Enemy stops moving entirely for the duration. Bosses take half-duration freezes.')}
          ${noteCard('STUN', 'Brief halt — same as freeze but shorter. <b style="color:#ff7766">Bosses are fully stun-immune</b>; their boss scripts have to be allowed to fire. Freeze on bosses lands at half duration.')}
          ${noteCard('Stun / Freeze Diminishing Returns', 'After a STUN or FREEZE expires on an enemy, that enemy gains a brief immunity to new stuns/freezes — duration equal to the just-expired lockdown (capped 1.5s). Stops multi-tower stun chains from locking enemies in place permanently. Tower mechanics still fire and damage normally; only the lockdown itself caps out at ~50% uptime when multiple lockdown towers stack on the same target.')}
          ${noteCard('BURN / BURNING GROUND', 'Fire towers (Ignifer, Inferno Cart, Vulcan Engineer, Siege Onager, etc.) deal their base damage + a SINGLE DoT — the burning-ground patch they stamp on impact. The patch ticks <b style="color:#ff8833">5%–8% maxHP/sec for 4s</b> (scaled by tower tier: T1 5.0% · T5 8.0%) and bypasses faction resists. Boss DoT reduction (×0.18) applies. One DoT, not two.')}
          ${noteCard('POISON (burst)', 'High-DPS short DoT. <b>6% maxHp/s</b> over short durations. The Poisoned Blade item applies it on hit.')}
          ${noteCard('BLEED (sustained DoT)', 'Long-duration DoT. <b>2.0-3.0% maxHp/s</b> over 8-14s. Differentiated from poison: bleed is sustained, poison is burst. Tiers: Barbed Gladius (COMMON, 2.0%/10s = 20% maxHP total) · Alpha Pack Fang (LEG, 2.4%/14s = 33.6% maxHP, longest envelope) · Falcata Blade (LEG, 3.0%/8s = 24% maxHP, hottest tick, front-loaded).')}
          ${noteCard('HELLFIRE', 'Permanent true-damage DoT (lasts until target dies). <b>Magnitude varies by source:</b> <b style="color:#ffaa66">God of War 1% maxHp/s</b> (stamped on every hit), <b style="color:#ffaa66">Pontifex 1-5% maxHp/s on bosses</b> (scales with tier — T1=1%, T5=5%). Stacks indefinitely on the same target.')}
          ${noteCard('Armor Shred', 'Reduces enemy faction resistance for the duration.')}
          ${noteCard('FEAR', 'Enemy walks AWAY from gate briefly.')}
          ${noteCard('KNOCKBACK', 'One-shot path-progress reversal. Bosses 25% effectiveness.')}
          ${noteCard('MARK', 'Target takes +X% damage from any source. Stacks with itself only as max(magnitude).')}
          ${noteCard('DOT items: Mercator-only + attack-class gated', '<b style="color:#ff9933">DOT items no longer appear in random drops or the gate shop</b> — your only path to them is the Mercator (W4/9/14/19) and boss legendary tables. Attack-class twins: <b style="color:#88ddff">Poisoned Blade</b> is <b>MELEE-ONLY</b> (single-target 6%/s poison, 4s), <b style="color:#ff7733">Fire Oil Flask</b> is <b>RANGED-ONLY</b> (4%/s burn for 3s + 1-tile splash). Barbed Gladius (melee, light bleed), Falcata Blade / Alpha Pack Fang (any tower, heavy bleed legendaries) round out the family.')}
        </div>
      `)}
      ${foldSection('CRIT CHANCE (per tower)', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:6px">
          Every tower has its own crit profile (<b>chance</b> + <b>multiplier</b>) baked into <b>towers.json</b>. Click a tower to see its values. Combos crit harder than their base counterparts; cross-combos crit hardest of all.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Fast attackers', 'Pugio Assassin 25% × 2.0, Velites 18% × 1.7, Rorarius 22% × 1.6, Triumphator 20% × 2.5. High volume, modest spike.')}
          ${noteCard('Heavy siege', 'Colossus Onager 6% × 3.5, Vulcan Engineer 8% × 3.0, Scorpio (signature 5th-hit ×3, no universal crit). Rare hits, huge spike.')}
          ${noteCard('Signature-crit towers', 'Decurion (every 5th hit ×3, plus EXECUTE: +250% damage vs non-boss enemies under 15% HP), Scorpio (every 5th hit ×3), Numidian Cavalry (25% chance ×3), Haruspex (20% double-strike) carry signature crit mechanics. They do NOT roll the universal crit on top.')}
          ${noteCard('Apex crits', 'Imperium Eternum 25% × 3.0, Carthage Scourge 22% × 3.0. Cross-combos own the high-end crit lane.')}
        </div>
      `)}
      ${foldSection('SUPER COMBOS (5-base recipes)', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:6px">
          Three of the strongest towers in the game. Each requires <b>5 base towers</b> as ingredients. Hard to assemble; extremely rewarding.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${noteCard('TRIPLEX ACIES (early, 30g)', 'Cleaves 2-tile radius melee. +20% atk-speed aura to towers within 3 tiles. Recipe: Milites + Hastati + Triarius + Centurion + Auxilia (all T2+).')}
          ${noteCard('LEGION PRIME (mid, 100g)', 'Heavy AoE divine. Slow + Armor Shred on every hit. +25% damage aura within 3 tiles. Recipe: Venator + Ignifer + Speculator + Flamen + Carroballista (all T3+).')}
          ${noteCard('CONSULAR FATEBINDER (apex, 250g)', 'Every shot strikes EVERY enemy on the map at 60% splash. TRUE damage. +30% global damage + atk speed aura. Recipe: 5× T5 base towers (Praefectus, Vulcan, Imperator, Solar Priest, Colossus).')}
        </div>
      `)}
      ${foldSection('CROSS-COMBOS (combos-of-combos)', `
        <div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:6px">
          Six recipes that take existing combo towers as ingredients. The hardest paths in the game; the most powerful identities.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Turma Lancers (T3, 25g)', '2× Horseman T3 → twin cavalry, double-strike, +30% vs ground.')}
          ${noteCard('Aurora Legion (T4, 60g)', 'Eagle Standard T4 + Praetorian Wall T4. baseDps 70, pierces 4 in line, +50% vs elites. PROVIDENCE BLAST: every 4th attack fires a divine nova in 1.8 tiles around the primary for 2.5× damage to all inside.')}
          ${noteCard('Storm Vexilla (T4, 60g)', 'Stormcaller T4 + Eagle Standard T4. Wide 6-jump chain lightning.')}
          ${noteCard('Imperium Eternum (T5 APEX, 150g)', '4× T5+ ingredients including Pontifex. 3-tile TRUE-damage quake on every hit. +20% global atk speed.')}
          ${noteCard('Carthage Scourge (T5, 120g)', 'Hannibals Nightmare + Nemesis Engine + Scorpion Bolt. 6-bolt volley, +250% vs bosses.')}
          ${noteCard('Triumvirate (T5 SUPPORT, 100g)', 'Julius Caesar + Aquilifer + Eagle Standard. No direct damage. +35% global dmg, +25% global atk speed, +25% enemy taken globally.')}
        </div>
      `)}
      ${foldSection('BOSS WAVE — NEW RULES', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${noteCard('Solo Arrival', "Authored mob hordes are stripped. The boss arrives ALONE. Boss scripts can still summon helpers (e.g. Hannibal's elephants) — those are part of the boss's mechanics.")}
          ${noteCard('+100% Boss HP', 'To compensate for the missing chip damage from cleared mobs. Bosses are tankier when alone.')}
          ${noteCard('No Hazards', 'Boss waves do not spawn atmospheric VFX (lightning, meteors, earthquake). The play area stays clean during boss fights so you can focus on positioning.')}
          ${noteCard('Stuck Arrows', 'Bosses retain up to 5 embedded projectile shafts visually for the rest of the wave. Arrows / javelins / pilums / staves / ballista bolts all stick. Pure visual flavor.')}
          ${noteCard('Boss-Kill Bonus', 'Every boss kill pays 22 + round(wave × 3.5) gold. W20 final boss ≈ +92g. Plus quest progress on "Beast Slayer" / "Boss Hunter" / "Boss Slayer Supreme".')}
          ${noteCard('Pre-Wave Tip', "Before every wave, a modal pops to explain that wave's mechanics — flyers, shielded, ghosts, druids, phoenix, runners, regen, decade-of-doom. Click to dismiss.")}
        </div>
      `)}
      ${foldSection('VISUAL CUES — WHAT THEY MEAN', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px">
          ${noteCard('Top-left chip', 'Active faction weather + penalties.')}
          ${noteCard('Top-right chip', 'Active wave modifier (when one is rolled).')}
          ${noteCard('Lower-left chip (new)', 'Wave Brief — consolidated special-mechanics summary for the current wave.')}
          ${noteCard('Pulsing red ring on tower', 'Eligible to combine. Click to see options inside the tower menu.')}
          ${noteCard('Gold ring + dots above tower', 'Tower tier (1-5 dots, color-keyed).')}
          ${noteCard('Translucent colored circle', "Aura range. <b style=\"color:#c070ff\">VIOLET</b> = ally buff (damage/speed/range). <b style=\"color:#ff5566\">DASHED CRIMSON</b> = enemy debuff (+taken%/slow). Stays distinct from the <b style=\"color:#ffd34d\">GOLD</b> tower-attack-range circle. Every local aura source — tower native or aura item — draws its ring consistently.")}
          ${noteCard('Pink X over tower', "Silenced — won't fire for the duration.")}
          ${noteCard('Pulsing colored dot on tower', "Weather is reducing this tower's attack speed.")}
          ${noteCard('Bronze shield over enemy', 'Shielded — needs melee hit before ranged can target.')}
          ${noteCard('Colored ring around enemy', 'Elite mutation (color = mutation type).')}
          ${noteCard('Status badges above enemy', 'Active status effects with sliced-sprite icons.')}
          ${noteCard('Pulsing red border on play area', "You're below 10 lives — danger.")}
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
        <b style="color:#9be0ff">Strategy (20-wave campaign):</b> 95% T1 at start. 8-level curve costs <b>6 / 14 / 28 / 48 / 75 / 115 / 175 / 270g</b> per step. T4+T5 chance climbs to <b>76% at L8</b>. <b>L1 grants no damage bonus</b> (only the probability shift). Starting at L2, every level adds a permanent <b style="color:#88ff88">+3% global tower damage</b> (max +21% at L8). No rebate — you pay full price each step.<br/><br/>
        <b style="color:#9be0ff">What tier actually buys:</b> higher tiers stack three things — <b>raw damage</b> (T1=×1.0, T2=×1.25, T3=×1.55, T4=×1.95, T5=×2.50), <b>attack speed</b> (T1=×1.00 up to T5=×1.42), and <b>item slots</b> (1 at T1, 5 at T5). A T5 same-type tower fires ~3.55× the raw output of its T1 cousin before any items or pool bonuses. Roll T5 for the full stack — damage, speed, and slot count all climb.<br/><br/>
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
      CONSULAR_FATEBINDER: 'LATE'
    };
    const STAGE_ORDER: Record<string, number> = { EARLY: 0, MID: 1, LATE: 2 };
    const STAGE_LABEL: Record<string, string> = {
      EARLY: '🌱 EARLY GAME — base towers + simple combos (pool L0-L4)',
      MID:   '⚔ MID GAME — T5 base + powerful named combos (pool L5-L8, Mercator)',
      LATE:  '👑 LATE GAME (APEX) — 5-ingredient super-combos, win-condition towers'
    };

    const entries = Object.entries(towers).map(([id, def]: any) => ({ id, def }));
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
      <td>${def.kind === 'COMBO' ? '<span style="color:#ffd34d">COMBO</span>' : `T${def.tierBand ?? '1-5'}`}</td>
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
      return { idx: 4, label: '★★★★★ SUPER COMBOS · APEX — 5+ ingredients or stacked cross-combos, hardest in the game' };
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
    const legend = `
      <div style="display:flex;gap:12px;margin-top:6px;font-size:10px;color:#cdb98a;flex-wrap:wrap">
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#88ff88;display:inline-block;border:1px solid #000"></span> READY — kept towers fit, build now</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#ff9933;display:inline-block;border:1px solid #000"></span> PROSPECT — needs a pending prospect kept</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#ffd34d;display:inline-block;border:1px solid #000"></span> PARTIAL — have some ingredients</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#5a4a30;display:inline-block;border:1px solid #000"></span> LOCKED — none owned</span>
      </div>`;
    return `${section('COMBINATION LOGIC',
      `<div style="font-size:11px;color:#cdb98a;line-height:1.5">Recipes listed in DIFFICULTY ORDER — easiest single-step builds first, cross-combos and super combos at the bottom. Color-coded against the towers you have: <b style="color:#88ff88">Green</b> = committed towers, <b style="color:#ff9933">orange</b> = pending prospects (you'll have to KEEP them first).</div>${legend}`)}
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
    // Compute runtime HP for any enemy on a given wave + hp-fraction.
    // Delegates to `previewSpawnHp` (single source of truth shared with
    // spawnEnemy in EnemySystem.ts). The hpFrac multiplier handles
    // reanim (~92%) and split children (their splitOnDeath.hpFraction).
    function computeHp(def: any, w: any, hpFrac = 1.0): number {
      return Math.round(previewSpawnHp(def, w.wave, w.type, w.hpMult) * hpFrac);
    }
    function spawnHpForEnemy(id: string, def: any): { hp: number; wave: number | null; explain: string; note?: string } {
      // 1. Direct authored spawn — preferred path. computeHp delegates
      // to previewSpawnHp so the column tracks the game's actual spawn
      // formula automatically.
      const w = firstWaveByEnemy.get(id);
      if (w) {
        if (w.wave === 1) return { hp: 100, wave: 1, explain: 'Wave 1 (introductory wave — every spawn pinned to 100 HP).' };
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
      // 5. True orphan (no wave, no reanim source, no split parent, not
      // even stripped). These rows get filtered out of the table — the
      // value here is just for consistency. Use the raw stored baseHp
      // since there's no real wave context to scale against.
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
      // Sort by first-appearance wave (W1 → W20). Bosses sort AFTER basics
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
        const { hp, wave, explain, note } = ctx;
        const waveTag = note
          ? `<span style="color:#aa55ff;font-size:9px">on W${wave} (${note})</span>`
          : `<span style="color:#9be0ff;font-size:9px">on W${wave}</span>`;
        const hpLabel = `${hp.toLocaleString()} HP <br/>${waveTag} <span style="opacity:0.55;font-size:9px" title="${explain}">ⓘ</span>`;
      return `
      <tr><td>${spriteImg(id, 36)}</td>
      <td><b style="color:${def.isBoss ? '#ee5555' : '#d4af37'}">${def.name}</b></td>
      <td style="color:#9be0ff">${def.faction}</td>
      <td>${hpLabel}</td>
      <td>${def.speed.toFixed(1)}t/s</td>
      <td>${def.isFlyer ? 'FLYER' : 'GROUND'}${def.isBoss ? ' BOSS' : ''}</td>
      <td style="line-height:1.35">${renderArmorChips(id)}</td>
      <td>${renderSpecificRes(id)}</td>
      <td style="opacity:0.85">${[
        def.immuneSlow && 'slow-immune',
        def.immunePoison && 'poison-immune',
        def.immuneFreeze && 'freeze-immune',
        def.immuneStun && 'stun-immune',
        def.regenPctPerSec && `${(def.regenPctPerSec*100).toFixed(1)}%/s regen`,
        def.outOfCombatRegen && `${(def.outOfCombatRegen*100).toFixed(1)}%/s OOC regen`,
        def.auraTowerSlow && `tower aura -${(def.auraTowerSlow*100)}% atk speed`,
        def.auraNullifier && `nullifies all tower auras within 2 tiles`,
        def.phaseHits && `phases ${def.phaseHits} hits`,
        def.dodgeChance && `${Math.round(def.dodgeChance*100)}% dodge (ranged)`,
        def.shieldBlockChance && `${Math.round(def.shieldBlockChance*100)}% shield block (ranged)`,
        def.checkpointHealPct && `+${Math.round(def.checkpointHealPct*100)}% HP at each checkpoint`,
        def.reanimateAs && (def.faction === 'UNDEAD_CELTS' || def.faction === 'UNDEAD_CARTHAGE'
          ? `rises as ${def.reanimateAs.replace(/_/g,' ').toLowerCase()} on every death`
          : `rises as ${def.reanimateAs.replace(/_/g,' ').toLowerCase()} on necromancy waves`),
        def.rebirthAtPct && `phoenix: bursts into 3 minions at ${Math.round(def.rebirthAtPct*100)}% HP`
      ].filter(Boolean).join(', ') || ''}</td></tr>`;
    }).join('');
    // Simple, honest framing — no internal-multiplier math jargon.
    const scaleNote = `<div style="font-size:11px;color:#cdb98a;line-height:1.55;margin-bottom:10px;background:#0c0a08;border-left:3px solid #ff9933;padding:8px 12px">
      <b style="color:#ff9933">HP column:</b> the actual on-spawn HP an enemy will have when it appears on the wave listed beside it. What you see is what you fight.<br/>
      ★ Wave 1 is the introductory wave — every spawn is pinned to <b>100 HP</b>.<br/>
      ★ Enemies that only appear via splits or necromancy waves show their HP on the earliest wave that summons them.<br/>
      ★ The random <b>BLOOD MOON</b> wave modifier adds +25% HP on top when it rolls (rare).
    </div>`;
    return `${renderFactionResistances()}
      ${scaleNote}
      <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="color:#aa9a4a"><th></th><th style="text-align:left">Name</th><th>Faction</th><th>Spawn HP</th><th>Speed</th><th>Type</th><th style="text-align:left">🛡 Armor</th><th style="text-align:left">Specific Resist</th><th style="text-align:left">Traits</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }
  if (tab === 'ITEMS') {
    const perm = Object.entries(permItems).map(([id, def]: any) => `<tr>
      <td><b style="color:${RAR[def.rarity]}">${def.name}</b></td>
      <td style="color:#9be0ff">${itemFamily(id)}</td>
      <td>${def.rarity}</td>
      <td>${def.buy}g</td>
      <td style="opacity:0.85">${def.effect}</td></tr>`).join('');
    // Consumables removed 2026-05 — every item is permanent now, so the
    // codex only shows the permanent table.
    void consumables;
    return `${section('ITEM EQUIP RULES', '<div style="font-size:11px;color:#cdb98a">Same item stacking is blocked. Item families are also mutually exclusive per tower, so a tower cannot carry two speed items, two damage items, or two dot items at once. Every item is permanent — there are no one-use items.<br/><br/><b style="color:#ff9933">Attack-class gates:</b> every restricted item opens its effect with <b style="color:#88ddff">MELEE ONLY</b> or <b style="color:#ff7733">RANGED ONLY</b> in CAPS. The inventory grid greys out incompatible items with the matching <b>ONLY</b> tag at equip time.<br/><br/><b style="color:#ff9933">Legendary uniqueness:</b> you can only hold ONE of each legendary at a time. The Mercator and boss drops automatically rotate to a different legendary you don\'t already own. Sell one and it cycles back into the pool.<br/><br/><b style="color:#66ccff">Projectile-sprite swaps:</b> equip <b>STORM JAVELIN</b> or <b>JUPITER\'S WRATH</b> and your ranged tower throws a crackling thunder-bolt instead of its usual pilum or arrow. <b>FIRE OIL FLASK</b> turns physical-projectile units (pilum / arrow / javelin / hasta) into oil-barrel lobs that splash and burn on impact. <b>SPEAR OF MARS</b> turns a melee tower into a thrown-spear unit — you see the cast every swing.</div>')}
      <h3 style="margin:8px 0 4px;color:#d4af37">PERMANENT ITEMS</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="color:#aa9a4a"><th style="text-align:left">Name</th><th>Family</th><th>Rarity</th><th>Cost</th><th style="text-align:left">Effect</th></tr></thead>
      <tbody>${perm}</tbody></table>`;
  }
  if (tab === 'WAVES') {
    const rows = (waves as any[]).map(w => {
      const spawns = w.spawns.map((s: any) => `${s.count}x ${s.type}`).join(', ');
      const flag = w.type === 'B' ? '<span style="color:#ee5555;font-weight:bold">BOSS</span>' : w.type === 'F' ? '<span style="color:#66ccff;font-weight:bold">FLYERS</span>' : w.type === 'M' ? '<span style="color:#ffd34d">MIXED</span>' : 'GROUND';
      // Append a necromancy tag so the wave table flags reanimation-active rounds at a glance.
      const necroTag = (w as any).necromancy ? ' <span style="color:#aa55ff;font-weight:bold;font-size:10px;letter-spacing:1px;background:#1a0a2a;border:1px solid #aa55ff;padding:1px 4px">💀 NECRO</span>' : '';
      // No HP-multiplier column — the value was an internal scaling
      // factor (1.0×, 2.5×, etc.) that confused players. Final on-spawn
      // HP for each enemy lives in the ENEMIES tab where it's surfaced
      // as a concrete number per wave.
      return `<tr><td style="color:#d4af37;font-weight:bold">${w.wave}</td><td>${flag}${necroTag}</td><td style="color:#9be0ff">${w.faction}</td><td>${w.gold}g</td><td style="opacity:0.85">${spawns}</td></tr>`;
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
    if (r.immune)              { display = 'IMM';                          color = '#ee2a2a'; }
    else if (r.armorPct >= 70) { display = `${r.armorPct}%`;               color = '#ff6b3a'; }
    else if (r.armorPct >= 30) { display = `${r.armorPct}%`;               color = '#ffaa55'; }
    else if (r.armorPct > 0)   { display = `${r.armorPct}%`;               color = '#ffd34d'; }
    else if (r.armorPct === 0) { display = '0';                            color = '#cdb98a'; }
    else                       { display = `+${Math.abs(r.armorPct)}`;     color = '#7896c8'; }
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
  const cc = def.critChance ? `${Math.round(def.critChance * 100)}%` : '—';
  const cm = def.critMult ? `${def.critMult.toFixed(1)}×` : '—';
  return `<div class="combo-tooltip">
    <div class="ct-title">${def.name ?? ''}</div>
    <div class="ct-row"><span>Tier</span><span><b>T${tierBand}</b> · ${tt}</span></div>
    <div class="ct-row"><span>Damage</span><span><b>${dmgType}</b></span></div>
    <div class="ct-row"><span>Base DPS</span><span><b>${dps}</b></span></div>
    <div class="ct-row"><span>Attack Speed</span><span><b>${aspd}/s</b></span></div>
    <div class="ct-row"><span>Range</span><span><b>${rng} tile${rng === 1 ? '' : 's'}</b></span></div>
    <div class="ct-row"><span>Crit</span><span><b>${cc}</b> × <b>${cm}</b></span></div>
    ${def.ability ? `<div class="ct-ability">${def.ability}</div>` : ''}
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
  // that pins this recipe to the HUD. 2026-05-15 v6 — TWO pin slots now;
  // the button toggles in/out of the array (cap 2, FIFO eviction).
  // Reads the array on render so the currently-pinned cards show an
  // active state (gold border + "📌 PINNED" label). When two recipes
  // are already pinned, the third PIN click drops the oldest — the label
  // signals "PIN (FULL)" so the player knows an eviction will happen.
  const pinnedArr = getPinnedRecipes();
  const pinnedNow = pinnedArr.includes(c.result);
  const pinFull = !pinnedNow && pinnedArr.length >= 2;
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

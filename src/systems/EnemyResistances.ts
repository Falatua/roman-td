import { DamageType, Enemy, EnemyType, StatusEffectKind } from '../types';
import enemiesData from '../data/enemies.json';
import factionRes from '../data/factionResistances.json';

export interface EnemyResistProfile {
  melee?: number;
  ranged?: number;
  slow?: number;
  burn?: number;
  bleed?: number;
  poison?: number;
  // 2026-05 v9 — per-enemy elemental/specialty resists. Faction rows in
  // factionResistances.json still apply; these stack multiplicatively on
  // top so a specific unit can be more resistant to siege / fire /
  // divine than its faction baseline. Added so mid-game enemies (W6-W9
  // CARTHAGE / CELTIC tribes) can resist the universal answer-key damage
  // types instead of taking flat 100% from siege / fire / divine.
  siege?: number;
  fire?: number;
  divine?: number;
}

// Values are effectiveness multipliers: 0.65 means the enemy takes 65% of that
// damage/status. This sits on top of the broader faction resistance table.
// HARDENED PASS: every profile got tougher. The "best mazes and combinations
// survive" — pure DPS spam without damage-type diversity will fail.
const RESIST: Record<EnemyType, EnemyResistProfile> = {
  [EnemyType.FERAL_DOG]: { poison: 0.85 },
  [EnemyType.RABID_DOG]: { slow: 0.25, poison: 0.7, bleed: 0.7 },
  [EnemyType.ALPHA_DOG]: { melee: 0.6, slow: 0.35, bleed: 0.5, poison: 0.7 },

  // W4 footman — armored linen kit. Range tightened from 0.7 → 0.55 and
  // melee added so the wave is a real test of damage diversity, not a
  // walkover for spammed Sagittarius. HP bumped to 165 in enemies.json
  // alongside this resist pass.
  [EnemyType.CELTIC_FOOTMAN]: { melee: 0.85, ranged: 0.55, poison: 0.85, bleed: 0.85 },
  [EnemyType.CELTIC_BERSERKER]: { melee: 0.55, slow: 0.4, bleed: 0.35, burn: 0.85 },
  // 2026-05-15 GALLIC_DRUID buff pass: harder for ranged to chip down
  // (ranged resist 0.85 → 0.55, 45% reduction) on top of the new 30%
  // ranged dodge chance and the +60 HP bump (180 → 240). Melee still
  // hits at full damage — break the shield with melee first, then any
  // remaining ranged is mostly chip-resistance vs dodge.
  // 2026-05-17 — melee vulnerability bump (+25%). Druids are robed casters
  // with no real armor; pure melee burst should punch through their shield
  // and finish them noticeably faster. The 0.55 ranged resist + 30% dodge
  // chance still make ranged spam ineffective — the answer is to bring a
  // melee bruiser into the front line.
  [EnemyType.GALLIC_DRUID]: { melee: 1.25, poison: 0.3, burn: 0.6, slow: 0.5, ranged: 0.55 },
  // W6 — Celtic Scout: woad-painted runner, dodges divine smites and
  // weaves through siege bombardment. Takes full fire (no insulation).
  [EnemyType.CELTIC_SCOUT]: { ranged: 0.65, slow: 0.3, bleed: 0.7, siege: 0.7, divine: 0.65 },
  [EnemyType.CELTIC_WARLORD]: { melee: 0.5, ranged: 0.85, slow: 0.3, poison: 0.5, bleed: 0.6 },

  // W7-W9 CARTHAGE ROSTER — strategic mid-game resist pass (2026-05 v9).
  // Before this, every CARTHAGE unit took flat 100% siege / fire / divine
  // because the faction baseline is 0.0 across those three types. That
  // made siege / fire / divine a universal answer-key for waves 7-9.
  // Per-unit resists below cover the gap so players have to think about
  // damage-type matchups instead of spamming one element.
  //
  // CARTHAGE_SPEARMAN: linen-padded armor pre-treated with Carthaginian
  //   pitch — drilled to handle fire arrows. Modest divine resist (Baal
  //   worship). 2026-05-17 — bumped siege to 1.30× (+30%): heavy stones
  //   pulverize lightly-armored line infantry; siege is now the clean
  //   answer for the W7-W8 Spearman wall.
  [EnemyType.CARTHAGE_SPEARMAN]: { ranged: 0.55, melee: 0.75, bleed: 0.65, fire: 0.65, divine: 0.75, siege: 1.30 },
  // NUMIDIAN_RIDER: light cavalry skirmisher. 2026-05-17 — flipped from
  //   siege-resistant (0.55) to siege-vulnerable (1.15). A bouncing
  //   ballista shot through a packed cavalry line ruins horses, not just
  //   riders. Faction-wide siege weakness applies here too.
  [EnemyType.NUMIDIAN_RIDER]: { ranged: 0.7, slow: 0.35, bleed: 0.7, siege: 1.15 },
  // CARTHAGE_ELITE_GUARD: bronze cuirass + ritual blessing. 2026-05-17 —
  //   siege bumped from default 1.0 to 1.40× (+40%). Bronze armor cracks
  //   under crushing stone; this is the unit's hardest counter now.
  [EnemyType.CARTHAGE_ELITE_GUARD]: { melee: 0.6, ranged: 0.45, bleed: 0.5, fire: 0.6, divine: 0.55, siege: 1.40 },
  // WAR ELEPHANT — melee resist buffed 0.40 → 0.25 (hide is much tougher
  // to crack with swords now) and bleed dropped 0.35 → 0.20 (elephants
  // don't bleed easily — thick hide). Combined effect: melee + bleed
  // combos that used to chip them down quickly now require ranged /
  // siege / fire damage to do real work.
  // 2026-05 v10 — WAR_ELEPHANT siege change: per design feedback,
  // elephants now take EXTRA siege damage (1.45×) — the heavy stones
  // crush hide that arrows can't pierce. Combined with their poor
  // bleed and existing tough melee profile, siege becomes the
  // dedicated answer for elephant waves. The previous 0.55 (siege-
  // resistant) reading was inverted on purpose.
  // 2026-05-17 — Poison resistance bumped 0.30 → 0.10 (90% reduction).
  // Thick elephant hide and the mass of the animal shrug off poison
  // procs that would melt a footman. Bleed already at 0.20 (80% resist)
  // for the same anatomical reason.
  [EnemyType.WAR_ELEPHANT]: { melee: 0.25, ranged: 0.6, slow: 0.25, burn: 0.6, poison: 0.10, bleed: 0.20, siege: 1.45 },
  // HANNIBAL_BARCA: 2026-05-17 — siege bumped from default 1.0 to 1.25×
  // (+25%). The whole Carthaginian roster is now siege-soft, the boss
  // included. Siege towers (Onager, Ballistarius, Carroballista, Vulcan
  // Engineer, Colossus Onager) are the clean carry for W10.
  // 2026-05-17 — Hannibal rides an elephant; poison resist bumped
  // 0.40 → 0.15 (85% reduction). Same elephant-hide reasoning as
  // WAR_ELEPHANT — Hannibal's poison vulnerability shouldn't be a
  // soft underbelly for elephant counterplay.
  [EnemyType.HANNIBAL_BARCA]: { melee: 0.65, ranged: 0.5, slow: 0.2, poison: 0.15, bleed: 0.55, burn: 0.85, siege: 1.25 },

  // LATE-WAVE RANGED RESISTANCE PASS (2026-05): every non-boss enemy
  // that shows up after W10 had its `ranged` multiplier tightened so
  // pure ranged spam stops being the universal answer. Splash, melee
  // cleave, DoT, and divine become legitimately necessary in the
  // back half of the run. Numbers are takes-X%-of-damage multipliers
  // (0.55 = takes 55% of the incoming ranged damage).
  // 2026-05-18 v2 — ALL UNDEAD ARE FIRE-VULNERABLE, BLEED-IMMUNE,
  // POISON-IMMUNE. Player rule: undead burn. The faction-level row
  // sets the baseline (+25% fire on UNDEAD_CELTS, +30% on UNDEAD_
  // CARTHAGE after the fix below); per-enemy entries layer extra
  // vulnerability on top for the most flammable units. Boss undead
  // (Undead Warlord, Undead War Elephant) NO LONGER have immuneFire
  // and follow the same burn-vulnerable rule as their minions.
  [EnemyType.UNDEAD_CELT]: { melee: 0.7, ranged: 0.55, poison: 0, bleed: 0, fire: 1.25, burn: 1.25 },
  // 2026-05-19 v3 — `melee: 1.25` removed. ZOMBIE_DRUID carries
  // `meleeImmune: true` in enemies.json, which short-circuits any
  // PHYS_MELEE damage to zero regardless of the resistance row. The
  // 1.25 was dead data that misled the codex / inspect tooltips.
  // DIVINE melee + FIRE melee + SIEGE melee towers now bypass the
  // immune flag (see meleeImmuneBlocksTower in CombatResolver) — and
  // those route through their own resistance rows (divine / fire /
  // siege), not melee.
  [EnemyType.ZOMBIE_DRUID]: { slow: 0.55, fire: 1.20, burn: 1.20, poison: 0, bleed: 0, ranged: 0.55 },
  [EnemyType.UNDEAD_BERSERKER]: { melee: 0.5, ranged: 0.6, slow: 0.5, fire: 1.20, burn: 1.20, poison: 0, bleed: 0 },
  [EnemyType.SPECTRAL_SCOUT]: { melee: 0.25, ranged: 0.55, slow: 0.2, fire: 1.20, burn: 1.20, poison: 0, bleed: 0 },
  [EnemyType.UNDEAD_WARLORD]: { melee: 0.45, ranged: 0.55, slow: 0.25, fire: 1.25, burn: 1.25, poison: 0, bleed: 0 },
  // 2026-05-19 v3 — UNDEAD_SPEARMAN + GHOST_RIDER fire/burn bumped
  // 1.15 → 1.40 per user direction. These two anchor the W16-W18
  // undead-carthage trio (Spearman on W16+W17, Ghost Rider on
  // W16+W17+W18). With the UNDEAD_CARTHAGE faction baseline of
  // +30% fire, the final multiplier lands at 1.82× — fire/burn
  // becomes a real payoff angle through the late mid-game.
  [EnemyType.UNDEAD_SPEARMAN]: { ranged: 0.45, melee: 0.85, fire: 1.40, burn: 1.40, poison: 0, bleed: 0 },
  [EnemyType.GHOST_RIDER]: { melee: 0.2, ranged: 0.55, slow: 0.15, fire: 1.40, burn: 1.40, poison: 0, bleed: 0 },
  // UNDEAD WAR ELEPHANT — bone hide still cracks; siege + fire are
  // both real angles. Boss-tier so burn vulnerability is slightly
  // lower than minions' (1.20 vs 1.25).
  [EnemyType.UNDEAD_WAR_ELEPHANT]: { melee: 0.20, ranged: 0.45, slow: 0.2, fire: 1.20, burn: 1.20, poison: 0, bleed: 0, siege: 1.40 },

  // SUPER DEMONS — fire-immune across the board (lore: born from
  // hellfire). Poison and bleed land HARDER on demons (×1.30 / ×1.25)
  // to compensate — the player is forced into non-fire DoT to wear
  // them down. Slow effectiveness stays low since they're hot-blooded.
  // 2026-05 v10 — DIVINE VULNERABILITY: demons take 1.50× damage from
  // divine sources (was neutral 1.0). Faction row already gives them
  // +100% (DIVINE: 1.0 in factionResistances.json), so the per-enemy
  // 1.50 stacks multiplicatively on top — final divine takes is 3.0×.
  // Divine becomes the dedicated demon counter, on top of poison/bleed.
  [EnemyType.DEMON_HELLHOUND]: { ranged: 0.65, slow: 0.4, burn: 0, poison: 1.30, bleed: 1.25, divine: 1.50 },
  [EnemyType.CELTIC_FIRE_DEMON]: { melee: 0.65, ranged: 0.55, burn: 0, poison: 1.30, bleed: 1.25, slow: 0.5, divine: 1.50 },
  [EnemyType.SHADOW_CAVALRY]: { melee: 0.35, ranged: 0.55, slow: 0.15, burn: 0, poison: 1.30, bleed: 1.25, divine: 1.50 },
  [EnemyType.DEMON_LEGATE]: { ranged: 0.5, slow: 0.25, burn: 0, poison: 1.30, bleed: 1.25, melee: 0.85, divine: 1.50 },
  // DAEMON IMPERATOR (W20 final boss) — ranged 0.40 → 0.20 (much
  // tougher to chip down with arrows / javelins / ballistae). Still
  // fire-immune.
  // 2026-05-20 — poison + bleed dialed back from 1.0 → 0.5 each.
  // Previous tuning sat both at neutral 1.0 to make DoT viable on the
  // huge HP pool, but DoT had become the default solve for the W20
  // wall and overshadowed direct-damage builds. Half-effective DoT
  // keeps it relevant as a chip layer while making direct damage
  // (melee crit / siege bolts / divine bypass) the load-bearing
  // approach again.
  // 2026-05 v10 — boss also takes 1.30× divine. Slightly less than the
  // 1.50 on minion demons (he's the apex, you still have to work for it)
  // but the angelic-judgment counter still applies.
  [EnemyType.DAEMON_IMPERATOR]: { melee: 0.4, ranged: 0.20, slow: 0.15, burn: 0, poison: 0.5, bleed: 0.5, divine: 1.30 },
  // 2026-05 v11 DPS CHECK: training dummy takes full damage from every
  // source. It's a measurement tool — no resistances should muddy the
  // reading.
  [EnemyType.TRAINING_DUMMY]: {},

  // 2026-05-17 — GATES OF HELL surprise event (W16). Fire Giant: tanky
  // semi-boss. Heavy melee + moderate ranged resistance, fire-immune
  // (bone + magma body), SIEGE and DIVINE both ~+50% damage taken
  // (siege cracks magma stone, divine punishes hellspawn). Poison and
  // bleed still land at modest effectiveness — DoT is a real angle.
  [EnemyType.FIRE_GIANT]: {
    melee: 0.20,         // 80% reduction — basic infantry chip but don't crack
    ranged: 0.40,        // 60% reduction — moderate, ballistae/scorpio chip slowly
    siege: 1.50,         // +50% — siege onagers and ballistas crush this thing
    fire: 0,             // immune (also covered by immuneFire JSON flag)
    divine: 1.50,        // +50% — divine answers hellspawn
    burn: 0,             // immune to BURN DoT (matches fire immunity)
    slow: 0.50,          // partial slow effectiveness — slow it more, buy more time
    poison: 0.85,        // mild resistance
    bleed: 0.70          // mild resistance
  },
  // Hell Gate: stationary structure. No movement, no behavior. Takes
  // full damage from melee / ranged / siege (no faction baseline
  // either — see below for the per-enemy ELEMENTAL_FIRE override that
  // makes it fire-immune for thematic reasons). Divine +50% so divine
  // towers are the cleanest crack-and-shut answer.
  [EnemyType.HELL_GATE]: {
    fire: 0,             // immune (gates of HELL don't burn)
    burn: 0,
    divine: 1.50,        // +50% — divine vs gates of hell tracks lore-cleanly
    siege: 1.25          // +25% — siege also useful, but divine is the cleanest answer
  },

  // Iron Phalanx — totally immune to melee. Ranged armor tightened too.
  // 2026-05-19 v4 — IRON_PHALANX fire/burn pushed to 2.00× per user
  // direction. The "iron melts" lore beats the conservative +35%
  // tuning: this is the heaviest-armored unit on the field and the
  // armor is its ENTIRE defense. Fire heats iron, iron loses
  // structural integrity, the unit becomes a kiln-trapped soldier.
  // CARTHAGE faction baseline is 1.0× fire (no faction modifier), so
  // the per-enemy 2.0 is the full multiplier — Iron Phalanx now takes
  // DOUBLE damage from any fire/burn source, making it the most
  // fire-vulnerable enemy in the game (Undead Spearman + Ghost Rider
  // sit at 1.82× from the UNDEAD_CARTHAGE faction × 1.40 per-enemy
  // stack). Fire/burn is decisively THE counter to the W17 phalanx.
  [EnemyType.IRON_PHALANX]: { melee: 0, ranged: 0.5, slow: 0.55, bleed: 0.45, poison: 0.55, fire: 2.00, burn: 2.00 },
  // Architectus — heavy plate, shrugs off ranged hits until the shield is
  // broken. Bleed-immune as an undead minion.
  // 2026-05-18 v2 — Architectus is an UNDEAD_CARTHAGE engineer. By the
  // "all undead are bleed/poison-immune AND fire-vulnerable" rule:
  // poison 0.5 → 0 (immune), burn 0.6 → 1.20 (vulnerable).
  [EnemyType.ARCHITECTUS]: { melee: 0.65, ranged: 0.45, slow: 0.35, fire: 1.20, burn: 1.20, poison: 0, bleed: 0 },
  // NECROMANCY-RISEN UNDEAD — they came back wrong. Bone bodies shrug
  // off poison AND bleed (no flesh to rot), drink fire (dry kindling),
  // and are slowed less than the living. Skeleton/zombie variants still
  // take a real melee hit; the lich is a fragile caster. Bleed locked
  // to 0 across all three risen forms — undead don't bleed.
  // 2026-05-18 v2 — Reanimated forms inherit the "undead burn" rule.
  // Lich's burn flipped from 0.8 (resist) to 1.15 (vulnerable) to
  // match the rule that ALL undead are fire-vulnerable.
  [EnemyType.REANIMATED_SKELETON]: { ranged: 0.85, slow: 0.5, poison: 0, bleed: 0, fire: 1.20, burn: 1.20 },
  [EnemyType.REANIMATED_ZOMBIE]:   { ranged: 0.9, slow: 0.55, poison: 0, bleed: 0, fire: 1.15, burn: 1.15 },
  [EnemyType.REANIMATED_LICH]:     { melee: 0.85, slow: 0.45, poison: 0, bleed: 0, fire: 1.15, burn: 1.15 },
  // ─── ENDLESS MODE (2026-05 v10) ──────────────────────────────────────
  // Empty defaults — faction row carries the base resistances, and the
  // Endless wave generator stamps a per-spawn __lateResistMult on top
  // for the steepening damage-reduction curve. Per-enemy entries left
  // open so future tuning can specialize without re-wiring the type
  // system.
  [EnemyType.EGYPTIAN_ARCHER]:   { ranged: 0.85, slow: 0.4 },
  [EnemyType.EGYPTIAN_SPEARMAN]: { melee: 0.8, ranged: 0.6 },
  [EnemyType.EGYPTIAN_CHARIOT]:  { ranged: 0.5, slow: 0.35, bleed: 0.6 },
  [EnemyType.PHARAOH_GUARD]:     { melee: 0.55, ranged: 0.4, burn: 0.55, divine: 0.7 },
  [EnemyType.ANUBIS_PRIEST]:     { ranged: 0.5, slow: 0.3, poison: 0 },
  [EnemyType.SOBEK_WARRIOR]:     { melee: 0.45, ranged: 0.5, slow: 0.3, burn: 0.5 },
  [EnemyType.MUMMY_WARRIOR]:     { ranged: 0.65, slow: 0.5, poison: 0, bleed: 0.4, burn: 1.30 },
  [EnemyType.SPHINX]:            { ranged: 0.55, slow: 0.25, divine: 1.30 },
  [EnemyType.ANUBIS_KING]:       { melee: 0.35, ranged: 0.25, slow: 0.15, burn: 0.5, poison: 0.7, divine: 1.40 },
  [EnemyType.MONGOL_HORSE_ARCHER]: { ranged: 0.6, slow: 0.3, bleed: 0.7 },
  [EnemyType.MONGOL_SPEAR_RIDER]:  { ranged: 0.55, slow: 0.3, bleed: 0.7 },
  [EnemyType.KHAN_RIDER]:        { melee: 0.55, ranged: 0.4, slow: 0.25, bleed: 0.5 },
  [EnemyType.MONGOL_FOOTMAN]:    { ranged: 0.8, melee: 0.9 },
  [EnemyType.MONGOL_SPEARMAN]:   { melee: 0.85, ranged: 0.6 },
  [EnemyType.MONGOL_BERSERKER]:  { melee: 0.55, slow: 0.35, bleed: 0.4 },
  [EnemyType.MONGOL_SCOUT]:      { ranged: 0.7, slow: 0.3, burn: 0.8 },
  [EnemyType.MONGOL_SHAMAN]:     { ranged: 0.55, slow: 0.4, burn: 0.6 },
  [EnemyType.MONGOL_CAPTAIN]:    { melee: 0.6, ranged: 0.5, slow: 0.3 }
};

export function enemyResistanceProfile(type: EnemyType): EnemyResistProfile {
  return RESIST[type] ?? {};
}

export function enemyDamageMultiplier(enemy: Enemy, damageType: DamageType): number {
  // 2026-05-17 — `immuneFire` JSON flag is a hard short-circuit for
  // ELEMENTAL_FIRE damage. The 6 undead types (Undead Celt, Undead
  // Berserker, Reanimated Berserker, Undead Spearman, Undead Warlord,
  // Undead War Elephant) all carry this flag — they walk through fire
  // unharmed (lore: bone bodies, no flesh to ignite). Direct fire
  // damage (Vulcan Engineer, Sagittarius Ignis, Ignifer, Inferno Cart,
  // Plague Cart, etc.) returns 0. Burn DoT is short-circuited in
  // statusEffectiveness below. HELLFIRE is a divine-fire stamp and is
  // NOT covered — angels still get to punish the dead.
  const def: any = (enemiesData as any)[enemy.type];
  if (def?.immuneFire && damageType === DamageType.ELEMENTAL_FIRE) return 0;
  const r = enemyResistanceProfile(enemy.type);
  let base = 1;
  if (damageType === DamageType.PHYS_MELEE) base = r.melee ?? 1;
  else if (damageType === DamageType.PHYS_RANGED) base = r.ranged ?? 1;
  // 2026-05 v9 — per-enemy SIEGE / FIRE / DIVINE multipliers. Used by
  // the W6-W9 resist pass to break the "siege+fire+divine is a universal
  // answer key" feel of the mid game. Multiplies BEFORE the late-game
  // __lateResistMult stamp below so both stack.
  else if (damageType === DamageType.SIEGE) {
    base = r.siege ?? 1;
    // 2026-05-19 — Flyers take +20% siege damage globally. Heavy
    // ballista bolts and onager stones punch flying targets harder
    // than ranged arrows. Multiplies on top of the per-enemy siege
    // multiplier so the existing nuance survives (Celtic Scout
    // siege:0.7 × 1.20 = 0.84 — still nimbler than baseline ground;
    // Numidian Rider siege:1.15 × 1.20 = 1.38 — fragile rider takes
    // real punishment). Flyers without a per-enemy siege entry pick
    // up the flat +20% (Spectral Scout, Sphinx, Shadow Cavalry,
    // Hun riders, etc.).
    if (enemy.isFlyer) base *= 1.20;
  }
  else if (damageType === DamageType.ELEMENTAL_FIRE) base = r.fire ?? 1;
  else if (damageType === DamageType.DIVINE) base = r.divine ?? 1;
  // Late-stage W11+ resistance buff (set by spawnEnemy on ground / boss
  // non-flyers). Stamps `__lateResistMult` on the enemy at spawn time,
  // typically 0.85 (ground) or 0.75 (boss). Multiplies through every
  // damage type uniformly, including siege / fire / divine that have
  // no per-enemy melee/ranged entry. Flyers don't get this stamp so
  // late-game flyer waves are untouched.
  const lateMult = (enemy as any).__lateResistMult;
  if (typeof lateMult === 'number') base *= lateMult;
  return base;
}

export function statusEffectiveness(enemy: Enemy, kind: StatusEffectKind): number {
  // 2026-05-15 v3: DPS-check dummies are immune to EVERY status effect
  // (slow, freeze, stun, poison, burn, bleed, armor shred, hellfire,
  // fear, knockback, mark). A measurement tool that can be slowed or
  // DoT'd would skew the reading — towers that apply heavy DoT would
  // look stronger than they should because the dummy keeps walking
  // through the burn ticks while a real enemy might die or escape
  // sooner. Single short-circuit at the top of the function makes the
  // dummy a true control variable regardless of which tower hits it.
  if ((enemy as any).isDpsCheck) return 0;
  // 2026-05 v6 audit fix: wire the immuneSlow/Freeze/Stun/Poison JSON
  // flags into runtime. Previously these were dead data — the codex /
  // tooltip read them, but `statusEffectiveness` ignored them, so an
  // "immuneSlow" Berserker still got slowed at 100% of magnitude (with
  // only the partial RESIST profile cutting it). Now any `immune*` flag
  // returns 0 effectiveness for that kind, making the JSON the single
  // source of truth for hard immunity.
  const def: any = (enemiesData as any)[enemy.type];
  if (def?.immuneSlow && kind === StatusEffectKind.SLOW) return 0;
  if (def?.immuneFreeze && kind === StatusEffectKind.FREEZE) return 0;
  if (def?.immuneStun && kind === StatusEffectKind.STUN) return 0;
  if (def?.immunePoison && kind === StatusEffectKind.POISON) return 0;
  // 2026-05-17 — immuneFire covers BURN DoT too (oil flasks, ignis
  // arrows, inferno cart, etc. all apply BURN). Bone bodies don't
  // smolder. HELLFIRE intentionally NOT covered — it's divine-fire,
  // bypasses statusEffectiveness anyway via a separate code path.
  if (def?.immuneFire && kind === StatusEffectKind.BURN) return 0;
  const r = enemyResistanceProfile(enemy.type);
  let base = 1;
  if (kind === StatusEffectKind.SLOW) base = r.slow ?? 1;
  else if (kind === StatusEffectKind.BURN) base = r.burn ?? 1;
  else if (kind === StatusEffectKind.BLEED) base = r.bleed ?? 1;
  else if (kind === StatusEffectKind.POISON) base = r.poison ?? 1;
  // WARDED elite mutation: cuts all status effectiveness to 30% of normal,
  // making slow/freeze/stun much weaker. Combined with the existing immune
  // flags on certain enemies, this adds tactical bite.
  if (enemy.mutation === 'WARDED') base *= 0.30;
  // Late-stage W11+ resistance buff: same stamp the damage-mult helper
  // reads. Drops DoT effectiveness 15-25% on ground/boss enemies so
  // sustained-DoT builds need more sources or higher tiers to overcome
  // the late-game wall.
  const lateMult = (enemy as any).__lateResistMult;
  if (typeof lateMult === 'number') base *= lateMult;
  return base;
}

export function resistanceSummary(type: EnemyType): Array<{ label: string; value: number }> {
  const r = enemyResistanceProfile(type);
  return [
    ['Melee', r.melee],
    ['Ranged', r.ranged],
    // 2026-05 v9: include the three new per-enemy elemental resists so
    // Codex / EnemyInspect lists them alongside melee/ranged when set.
    ['Siege', r.siege],
    ['Fire', r.fire],
    ['Divine', r.divine],
    ['Slow', r.slow],
    ['Burn', r.burn],
    ['Bleed', r.bleed],
    ['Poison', r.poison]
  ]
    .filter(([, value]) => typeof value === 'number' && value < 1)
    .map(([label, value]) => ({ label: label as string, value: value as number }));
}

// 2026-05-15 v9: ARMOR DISPLAY HELPERS.
//
// "Armor" in this game is the COMBINED damage reduction an enemy gets
// from (1) its faction's resistance row in factionResistances.json AND
// (2) its per-type resist multiplier in the local RESIST table above.
// Both stack multiplicatively in the real damage path
// (`resistanceModifier(...) * enemyDamageMultiplier(...)`) — this helper
// mirrors that math exactly so UI labels never drift from real combat.
//
// Returns one entry per damage type with:
//   • finalMult — the literal damage multiplier (0 = immune, 1 = full,
//                 1.3 = 30% vulnerable)
//   • armorPct  — derived display %, capped to [-100, 100]:
//                 100 % = IMMUNE, 0 % = no armor, negative = vulnerable
//
// Used by EnemyInspect, Codex enemy detail, and the wave brief armor
// strip so the player always sees one consistent number.
const DAMAGE_KEY_FOR_ARMOR: Record<string, string> = {
  PHYS_MELEE: 'PHYS_MELEE',
  PHYS_RANGED: 'PHYS_RANGED',
  SIEGE: 'SIEGE',
  ELEMENTAL_FIRE: 'ELEMENTAL_FIRE',
  DIVINE: 'DIVINE'
};

export interface ArmorRow {
  damageType: string;     // 'PHYS_MELEE' | 'PHYS_RANGED' | 'SIEGE' | 'ELEMENTAL_FIRE' | 'DIVINE'
  finalMult: number;      // 0 = immune, 1 = full damage, 1.25 = +25% vulnerable
  armorPct: number;       // 100 = immune, 0 = no armor, -25 = takes +25% (vulnerable)
  immune: boolean;
}

// Compute the armor profile for a given enemy type. Falls back to its
// faction row when no per-type entry exists. Both inputs are optional
// at the type level — pass a type that exists in enemies.json.
export function armorProfile(type: EnemyType): ArmorRow[] {
  const enemyDef: any = (enemiesData as any)[type];
  if (!enemyDef) return [];
  // Faction key lookup. enemies.json stores the faction as a string
  // ('DOGS', 'CELTS', etc.) so we use that directly — no need to round-
  // trip through the EnemyFaction enum.
  const factionRow: any = (factionRes as any)[enemyDef.faction] ?? {};
  const specific = enemyResistanceProfile(type);
  const damageTypes = ['PHYS_MELEE', 'PHYS_RANGED', 'SIEGE', 'ELEMENTAL_FIRE', 'DIVINE'];
  return damageTypes.map(dt => {
    const factionVal = factionRow[DAMAGE_KEY_FOR_ARMOR[dt] ?? dt];
    let factionMult: number;
    let factionImmune = false;
    if (factionVal === 'IMMUNE') { factionMult = 0; factionImmune = true; }
    else if (typeof factionVal === 'number') factionMult = 1 + factionVal;
    else factionMult = 1.0;
    // 2026-05 v9: per-enemy multipliers now cover melee + ranged AND
    // siege / fire / divine. Used by the W6-W9 resist pass so the
    // armor strip / Codex / inspect panel all reflect the new
    // per-unit elemental resists, not just the faction baseline.
    let specificMult = 1.0;
    if (dt === 'PHYS_MELEE' && typeof specific.melee === 'number') specificMult = specific.melee;
    else if (dt === 'PHYS_RANGED' && typeof specific.ranged === 'number') specificMult = specific.ranged;
    else if (dt === 'SIEGE' && typeof specific.siege === 'number') specificMult = specific.siege;
    else if (dt === 'ELEMENTAL_FIRE' && typeof specific.fire === 'number') specificMult = specific.fire;
    else if (dt === 'DIVINE' && typeof specific.divine === 'number') specificMult = specific.divine;
    // 2026-05-17 — JSON `immuneFire` flag forces FIRE row to IMMUNE in
    // every UI surface (Codex chips, wave armor strip, EnemyInspect armor
    // cells). Faction + per-enemy multipliers above are bypassed because
    // the flag is a hard short-circuit in enemyDamageMultiplier too.
    const fireImmune = dt === 'ELEMENTAL_FIRE' && !!enemyDef.immuneFire;
    const finalMult = fireImmune ? 0 : factionMult * specificMult;
    const immune = factionImmune || fireImmune || finalMult <= 0;
    const armorPct = immune ? 100 : Math.round((1 - finalMult) * 100);
    return { damageType: dt, finalMult, armorPct, immune };
  });
}

// Aggregate armor across a SET of enemy types (e.g. all the types in a
// wave) by taking the average finalMult per damage type, then deriving
// armorPct from that. Used by the wave-preview armor strip so the
// player gets a single "this wave's armor profile" line.
export function armorProfileForGroup(types: EnemyType[]): ArmorRow[] {
  if (types.length === 0) return [];
  const damageTypes = ['PHYS_MELEE', 'PHYS_RANGED', 'SIEGE', 'ELEMENTAL_FIRE', 'DIVINE'];
  return damageTypes.map(dt => {
    let sum = 0;
    let count = 0;
    let allImmune = true;
    for (const t of types) {
      const row = armorProfile(t).find(r => r.damageType === dt);
      if (!row) continue;
      sum += row.finalMult;
      count++;
      if (!row.immune) allImmune = false;
    }
    const finalMult = count === 0 ? 1.0 : sum / count;
    const immune = allImmune && count > 0;
    const armorPct = immune ? 100 : Math.round((1 - finalMult) * 100);
    return { damageType: dt, finalMult, armorPct, immune };
  });
}

// Compact pretty-name lookup for armor display chips.
export function armorDamageTypeShortLabel(dt: string): string {
  switch (dt) {
    case 'PHYS_MELEE': return 'Melee';
    case 'PHYS_RANGED': return 'Ranged';
    case 'SIEGE': return 'Siege';
    case 'ELEMENTAL_FIRE': return 'Fire';
    case 'DIVINE': return 'Divine';
    default: return dt;
  }
}

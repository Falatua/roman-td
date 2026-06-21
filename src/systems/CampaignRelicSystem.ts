import { DamageType, Tower } from '../types';
import { GameStateShape } from '../GameState';
import { WAVE } from '../constants';

export const CAMPAIGN_RELIC_IDS = [
  'JUPITERS_MANDATE',
  'MARS_TAX',
  'SATURNS_DEBT',
  'VULCANS_FORGE',
  'MERCURYS_ROADS',
  'CERES_TITHE',
  'PLUTOS_PACT',
  'MINERVAS_DOCTRINE',
  'NEPTUNES_SURGE',
  'VESTAL_FLAME',
  'FORTUNAS_DICE',
  'JANUS_GATE',
  'AEGIS_WALL',
  'LAUREL_CENSUS',
  'BLOOD_STANDARD',
  'EAGLE_OMEN',
  'ENGINEERS_CHARTER',
  'GLADIATOR_OATH',
  'TEMPLE_LOAN',
  'ROME_BURNS',
  'IRON_DISCIPLINE',
  'RAPID_MUSTER',
  'SCOUT_MAPS',
  'BLACK_OIL',
  'SENATE_AUDIT',
  'HARUSPEX_WARNING',
  'IMPERIAL_GRANARIES',
  'BLESSING_OF_MARS',
  'FROST_TITHE',
  'LAST_EAGLE'
] as const;

export type CampaignRelicId = typeof CAMPAIGN_RELIC_IDS[number];

export interface CampaignRelicDef {
  id: CampaignRelicId;
  name: string;
  eyebrow: string;
  blurb: string;
  upside: string;
  caveat: string;
  effects: string[];
}

export const CAMPAIGN_RELICS: CampaignRelicDef[] = [
  {
    id: 'JUPITERS_MANDATE',
    name: "Jupiter's Mandate",
    eyebrow: 'DIVINE CAMPAIGN LAW',
    blurb: 'The gods demand spectacle. Holy engines become executioners, but the enemy marches under storm winds.',
    upside: 'Divine towers +80% damage and commanders take +50% damage.',
    caveat: 'All enemies move +18% faster.',
    effects: ['DIVINE +80% damage.', 'Commander enemies take +50% damage.', 'Enemies move +18% faster.']
  },
  {
    id: 'MARS_TAX',
    name: 'Mars Tax',
    eyebrow: 'WAR FUND DECREE',
    blurb: 'Mars pays for steel in advance. Traps become brutally efficient, but the enemy answers with speed.',
    upside: 'Trap prices -75%, trap damage +80%, trap radius +60%.',
    caveat: 'All enemies move +25% faster.',
    effects: ['Trap prices cut by 75%.', 'Trap damage +80% and radius +60%.', 'Enemies move +25% faster.']
  },
  {
    id: 'SATURNS_DEBT',
    name: "Saturn's Debt",
    eyebrow: 'BORROWED TIME',
    blurb: 'The treasury opens now. Rome will collect interest when the final daemon arrives.',
    upside: 'Gain 900 gold immediately.',
    caveat: 'At W30, Daemon Imperator takes up to 60% less direct damage based on banked gold.',
    effects: ['Gain 900 gold now.', 'W30 Daemon direct-damage reduction scales with your banked gold.']
  },
  {
    id: 'VULCANS_FORGE',
    name: "Vulcan's Forge",
    eyebrow: 'SIEGE BARGAIN',
    blurb: 'The forges burn white-hot for siege crews. Flyers use the smoke to attack faster.',
    upside: 'Siege towers +70% damage; traps +35% damage.',
    caveat: 'Flyers move +45% faster.',
    effects: ['SIEGE +70% damage.', 'Trap damage +35%.', 'Flyers move +45% faster.']
  },
  {
    id: 'MERCURYS_ROADS',
    name: "Mercury's Roads",
    eyebrow: 'SPEED DECREE',
    blurb: 'Every tower crew moves on courier timing. So does the invasion.',
    upside: 'All towers +35% attack speed.',
    caveat: 'All enemies move +25% faster.',
    effects: ['Tower attack speed +35%.', 'Enemies move +25% faster.']
  },
  {
    id: 'CERES_TITHE',
    name: "Ceres' Tithe",
    eyebrow: 'HARVEST LAW',
    blurb: 'The fields pay generously after each battle, but base garrisons are pulled into tax duty.',
    upside: 'Wave-clear gold +75%.',
    caveat: 'Base towers deal -30% damage.',
    effects: ['Wave gold +75%.', 'BASE tower damage -30%.']
  },
  {
    id: 'PLUTOS_PACT',
    name: "Pluto's Pact",
    eyebrow: 'UNDERWORLD WRIT',
    blurb: 'Bosses are marked for death. Their followers arrive swollen with grave-strength.',
    upside: 'Bosses take +60% damage.',
    caveat: 'Non-boss enemies spawn with +25% HP.',
    effects: ['Bosses take +60% damage.', 'Non-boss enemy HP +25%.']
  },
  {
    id: 'MINERVAS_DOCTRINE',
    name: "Minerva's Doctrine",
    eyebrow: 'DRILL MANUAL',
    blurb: 'Line troops learn perfect timing. Complex war machines lose some improvisational edge.',
    upside: 'Base towers +45% attack speed.',
    caveat: 'Combo towers deal -25% damage.',
    effects: ['BASE attack speed +45%.', 'COMBO damage -25%.']
  },
  {
    id: 'NEPTUNES_SURGE',
    name: "Neptune's Surge",
    eyebrow: 'RANGED TIDE',
    blurb: 'Ballista strings and bow arms snap like surf. Ground troops ride the same current.',
    upside: 'Physical ranged towers +55% damage.',
    caveat: 'Ground enemies move +22% faster.',
    effects: ['PHYS_RANGED +55% damage.', 'Ground enemies move +22% faster.']
  },
  {
    id: 'VESTAL_FLAME',
    name: 'Vestal Flame',
    eyebrow: 'SACRED FIRE',
    blurb: 'Fire and divine rites burn brighter. The enemy brings heavier shields against the omen.',
    upside: 'Fire and Divine towers +55% damage.',
    caveat: 'Enemy HP +22%.',
    effects: ['FIRE and DIVINE +55% damage.', 'Enemy HP +22%.']
  },
  {
    id: 'FORTUNAS_DICE',
    name: "Fortuna's Dice",
    eyebrow: 'LUCK CONTRACT',
    blurb: 'Fortuna spills gold on the floor and laughs while the road gets faster.',
    upside: 'Gain 500 gold immediately.',
    caveat: 'All enemies move +18% faster.',
    effects: ['Gain 500 gold now.', 'Enemies move +18% faster.']
  },
  {
    id: 'JANUS_GATE',
    name: "Janus' Gate",
    eyebrow: 'TWO-FACED MAP',
    blurb: 'Every tower sees farther through one door and strikes softer through the other.',
    upside: 'All towers +2 range.',
    caveat: 'All tower damage -28%.',
    effects: ['Tower range +2 tiles.', 'Tower damage -28%.']
  },
  {
    id: 'AEGIS_WALL',
    name: 'Aegis Wall',
    eyebrow: 'SURVIVAL BARGAIN',
    blurb: 'Rome receives new shields at the gate. The invading line receives heavier armor.',
    upside: 'Gain 15 lives immediately.',
    caveat: 'Enemy HP +35%.',
    effects: ['Gain 15 lives now.', 'Enemy HP +35%.']
  },
  {
    id: 'LAUREL_CENSUS',
    name: 'Laurel Census',
    eyebrow: 'KILL LEDGER',
    blurb: 'Every fallen enemy is counted and paid. Bosses hire better guards.',
    upside: 'Every kill pays +3 gold.',
    caveat: 'Boss HP +35%.',
    effects: ['Kills pay +3 gold.', 'Boss HP +35%.']
  },
  {
    id: 'BLOOD_STANDARD',
    name: 'Blood Standard',
    eyebrow: 'MELEE OATH',
    blurb: 'The front line fights like a legend and sacrifices the clean geometry of range.',
    upside: 'Melee towers +80% damage.',
    caveat: 'All towers lose 1.5 range.',
    effects: ['PHYS_MELEE +80% damage.', 'Tower range -1.5 tiles.']
  },
  {
    id: 'EAGLE_OMEN',
    name: 'Eagle Omen',
    eyebrow: 'ANTI-AIR SIGN',
    blurb: 'The sky becomes readable. The ground war gets thicker.',
    upside: 'Flyers take +100% damage.',
    caveat: 'Ground enemies spawn with +30% HP.',
    effects: ['Flyers take +100% damage.', 'Ground enemy HP +30%.']
  },
  {
    id: 'ENGINEERS_CHARTER',
    name: "Engineers' Charter",
    eyebrow: 'MACHINE LAW',
    blurb: 'Siege crews and trapwrights share plans. The invoice arrives immediately.',
    upside: 'Siege and traps deal +50% damage.',
    caveat: 'Trap prices +100%.',
    effects: ['SIEGE +50% damage.', 'Trap damage +50%.', 'Trap prices +100%.']
  },
  {
    id: 'GLADIATOR_OATH',
    name: 'Gladiator Oath',
    eyebrow: 'ARENA DOCTRINE',
    blurb: 'Elites and commanders are hunted like arena champions. Bosses prepare for the spectacle.',
    upside: 'Elites and commanders take +75% damage.',
    caveat: 'Boss HP +35%.',
    effects: ['ELITE and commander enemies take +75% damage.', 'Boss HP +35%.']
  },
  {
    id: 'TEMPLE_LOAN',
    name: 'Temple Loan',
    eyebrow: 'PRIESTLY CREDIT',
    blurb: 'The temples front the war chest. Every later purchase carries a little guilt.',
    upside: 'Gain 700 gold immediately.',
    caveat: 'Trap prices +75% and enemies move +15% faster.',
    effects: ['Gain 700 gold now.', 'Trap prices +75%.', 'Enemies move +15% faster.']
  },
  {
    id: 'ROME_BURNS',
    name: 'Rome Burns',
    eyebrow: 'DESPERATE FLAME',
    blurb: 'Fire and divine wrath surge while the enemy hardens against panic.',
    upside: 'Fire and Divine towers +75% damage.',
    caveat: 'Enemy HP +30%.',
    effects: ['FIRE and DIVINE +75% damage.', 'Enemy HP +30%.']
  },
  {
    id: 'IRON_DISCIPLINE',
    name: 'Iron Discipline',
    eyebrow: 'HEAVY DRILL',
    blurb: 'Every strike lands harder. Every crew reloads with ceremony.',
    upside: 'All towers +35% damage.',
    caveat: 'All towers -30% attack speed.',
    effects: ['Tower damage +35%.', 'Tower attack speed -30%.']
  },
  {
    id: 'RAPID_MUSTER',
    name: 'Rapid Muster',
    eyebrow: 'HASTE ORDER',
    blurb: 'Crews fire before fear can settle. Accuracy and force suffer.',
    upside: 'All towers +55% attack speed.',
    caveat: 'All towers -35% damage.',
    effects: ['Tower attack speed +55%.', 'Tower damage -35%.']
  },
  {
    id: 'SCOUT_MAPS',
    name: 'Scout Maps',
    eyebrow: 'LONG VIEW',
    blurb: 'The route is measured in advance. The enemy also finds the cleanest road.',
    upside: 'All towers +2 range.',
    caveat: 'All enemies move +25% faster.',
    effects: ['Tower range +2 tiles.', 'Enemies move +25% faster.']
  },
  {
    id: 'BLACK_OIL',
    name: 'Black Oil',
    eyebrow: 'TRAPWRIGHT SIN',
    blurb: 'The ground becomes murderous. Flyers waste no time above it.',
    upside: 'Traps deal +125% damage.',
    caveat: 'Flyers move +55% faster.',
    effects: ['Trap damage +125%.', 'Flyers move +55% faster.']
  },
  {
    id: 'SENATE_AUDIT',
    name: 'Senate Audit',
    eyebrow: 'PUBLIC ACCOUNTING',
    blurb: 'The books become healthier after each wave. Bosses receive better stipends.',
    upside: 'Wave-clear gold +45% and kills pay +2 gold.',
    caveat: 'Boss HP +30%.',
    effects: ['Wave gold +45%.', 'Kills pay +2 gold.', 'Boss HP +30%.']
  },
  {
    id: 'HARUSPEX_WARNING',
    name: 'Haruspex Warning',
    eyebrow: 'COMMANDER OMEN',
    blurb: 'The priests read the enemy officers in the entrails. The rank and file are harder to break.',
    upside: 'Commanders take +125% damage.',
    caveat: 'Non-boss enemy HP +20%.',
    effects: ['Commanders take +125% damage.', 'Non-boss enemy HP +20%.']
  },
  {
    id: 'IMPERIAL_GRANARIES',
    name: 'Imperial Granaries',
    eyebrow: 'SUPPLY FLOOD',
    blurb: 'Rome eats well and pays well. The invasion fattens too.',
    upside: 'Gain 500 gold and wave-clear gold +40%.',
    caveat: 'Enemy HP +30%.',
    effects: ['Gain 500 gold now.', 'Wave gold +40%.', 'Enemy HP +30%.']
  },
  {
    id: 'BLESSING_OF_MARS',
    name: 'Blessing of Mars',
    eyebrow: 'STEEL PRAYER',
    blurb: 'Mars favors steel and stone over miracles.',
    upside: 'Melee and Siege towers +55% damage.',
    caveat: 'Divine towers -35% damage.',
    effects: ['MELEE and SIEGE +55% damage.', 'DIVINE -35% damage.']
  },
  {
    id: 'FROST_TITHE',
    name: 'Frost Tithe',
    eyebrow: 'COLD BARGAIN',
    blurb: 'The road slows under impossible frost, and so do Roman hands.',
    upside: 'All enemies move -18% slower.',
    caveat: 'All towers deal -35% damage.',
    effects: ['Enemies move -18% slower.', 'Tower damage -35%.']
  },
  {
    id: 'LAST_EAGLE',
    name: 'The Last Eagle',
    eyebrow: 'FINAL STANDARD',
    blurb: 'The final act belongs to Rome. The final act also hits back.',
    upside: 'From W25 onward, towers deal +70% damage.',
    caveat: 'From W25 onward, enemy HP +45%.',
    effects: ['W25+ tower damage +70%.', 'W25+ enemy HP +45%.']
  }
];

const RELIC_BY_ID: Record<string, CampaignRelicDef> = Object.fromEntries(CAMPAIGN_RELICS.map(r => [r.id, r]));

export function campaignRelicById(id: CampaignRelicId | string | null | undefined): CampaignRelicDef | null {
  return id ? RELIC_BY_ID[id] ?? null : null;
}

export function activeCampaignRelicIds(state: GameStateShape): CampaignRelicId[] {
  const ids = new Set<string>();
  if (state.campaignRelicIds) for (const id of state.campaignRelicIds) ids.add(id);
  if (state.campaignRelicId) ids.add(state.campaignRelicId);
  return [...ids].filter(id => !!RELIC_BY_ID[id]) as CampaignRelicId[];
}

export function hasCampaignRelic(state: GameStateShape, id: CampaignRelicId): boolean {
  return activeCampaignRelicIds(state).includes(id);
}

function relicMilestoneWave(wave: number): boolean {
  return wave > 0 && wave < WAVE.TOTAL && wave % 5 === 0;
}

export function shouldOfferCampaignRelics(state: GameStateShape): boolean {
  if (state.endlessMode || !relicMilestoneWave(state.wave)) return false;
  if ((state as any).__campaignRelicOpen) return false;
  const offered = state.campaignRelicOfferWaves ?? [];
  const skipped = state.campaignRelicSkippedWaves ?? [];
  return !offered.includes(state.wave) && !skipped.includes(state.wave);
}

export function campaignRelicOffersForWave(state: GameStateShape, wave = state.wave, count = 3): CampaignRelicDef[] {
  if (!state.campaignRelicOffers) state.campaignRelicOffers = {};
  const key = String(wave);
  const existing = state.campaignRelicOffers[key];
  if (existing?.length) {
    return existing.map(id => campaignRelicById(id)).filter(Boolean) as CampaignRelicDef[];
  }
  const claimed = new Set(activeCampaignRelicIds(state));
  const pool = CAMPAIGN_RELICS.filter(r => !claimed.has(r.id));
  const bag = [...pool];
  const picked: CampaignRelicDef[] = [];
  while (picked.length < count && bag.length > 0) {
    const idx = Math.floor(Math.random() * bag.length);
    picked.push(bag.splice(idx, 1)[0]);
  }
  state.campaignRelicOffers[key] = picked.map(r => r.id);
  return picked;
}

export function markCampaignRelicOffered(state: GameStateShape, wave = state.wave): void {
  if (!state.campaignRelicOfferWaves) state.campaignRelicOfferWaves = [];
  if (!state.campaignRelicOfferWaves.includes(wave)) state.campaignRelicOfferWaves.push(wave);
  state.campaignRelicOffered = true;
}

export function skipCampaignRelic(state: GameStateShape, wave = state.wave): void {
  markCampaignRelicOffered(state, wave);
  if (!state.campaignRelicSkippedWaves) state.campaignRelicSkippedWaves = [];
  if (!state.campaignRelicSkippedWaves.includes(wave)) state.campaignRelicSkippedWaves.push(wave);
  state.hint = `No campaign relic chosen after wave ${wave}. Rome stays unbound.`;
}

export function applyCampaignRelic(state: GameStateShape, id: CampaignRelicId): void {
  const def = campaignRelicById(id);
  if (!def) return;
  if (!state.campaignRelicIds) state.campaignRelicIds = [];
  if (!state.campaignRelicIds.includes(id)) state.campaignRelicIds.push(id);
  state.campaignRelicId = id;
  markCampaignRelicOffered(state);
  if (id === 'SATURNS_DEBT') state.gold += 900;
  if (id === 'FORTUNAS_DICE') state.gold += 500;
  if (id === 'TEMPLE_LOAN') state.gold += 700;
  if (id === 'IMPERIAL_GRANARIES') state.gold += 500;
  if (id === 'AEGIS_WALL') state.lives += 15;
  state.hint = `${def.name} claimed. ${def.upside} Caveat: ${def.caveat}`;
}

export function campaignRelicTowerDpsMult(state: GameStateShape, tower: Tower, towerKind?: string): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    switch (id) {
      case 'CERES_TITHE': if (towerKind === 'BASE') mult *= 0.70; break;
      case 'MINERVAS_DOCTRINE': if (towerKind === 'COMBO') mult *= 0.75; break;
      case 'JANUS_GATE': mult *= 0.72; break;
      case 'IRON_DISCIPLINE': mult *= 1.35; break;
      case 'RAPID_MUSTER': mult *= 0.65; break;
      case 'BLESSING_OF_MARS': if (tower.damageType === DamageType.DIVINE) mult *= 0.65; break;
      case 'FROST_TITHE': mult *= 0.65; break;
      case 'LAST_EAGLE': if ((state.wave ?? 1) >= 25) mult *= 1.70; break;
    }
  }
  return mult;
}

export function campaignRelicTowerSpeedMult(state: GameStateShape, _tower: Tower, towerKind?: string): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    switch (id) {
      case 'MERCURYS_ROADS': mult *= 1.35; break;
      case 'MINERVAS_DOCTRINE': if (towerKind === 'BASE') mult *= 1.45; break;
      case 'IRON_DISCIPLINE': mult *= 0.70; break;
      case 'RAPID_MUSTER': mult *= 1.55; break;
    }
  }
  return mult;
}

export function campaignRelicTowerRangeBonus(state: GameStateShape, _tower: Tower): number {
  let bonus = 0;
  for (const id of activeCampaignRelicIds(state)) {
    if (id === 'JANUS_GATE' || id === 'SCOUT_MAPS') bonus += 2;
    if (id === 'BLOOD_STANDARD') bonus -= 1.5;
  }
  return bonus;
}

export function campaignRelicDamageMult(state: GameStateShape, tower: Tower, target: any): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    switch (id) {
      case 'JUPITERS_MANDATE':
        if (tower.damageType === DamageType.DIVINE) mult *= 1.80;
        if (target?.isCommander) mult *= 1.50;
        break;
      case 'SATURNS_DEBT':
        if (state.wave >= 30 && target?.type === 'DAEMON_IMPERATOR') {
          const banked = Math.max(0, state.gold ?? 0);
          const reduction = Math.min(0.60, Math.floor(banked / 100) * 0.10);
          mult *= (1 - reduction);
        }
        break;
      case 'VULCANS_FORGE':
        if (tower.damageType === DamageType.SIEGE) mult *= 1.70;
        break;
      case 'NEPTUNES_SURGE':
        if (tower.damageType === DamageType.PHYS_RANGED) mult *= 1.55;
        break;
      case 'VESTAL_FLAME':
        if (tower.damageType === DamageType.ELEMENTAL_FIRE || tower.damageType === DamageType.DIVINE) mult *= 1.55;
        break;
      case 'PLUTOS_PACT':
        if (target?.isBoss) mult *= 1.60;
        break;
      case 'BLOOD_STANDARD':
        if (tower.damageType === DamageType.PHYS_MELEE) mult *= 1.80;
        break;
      case 'EAGLE_OMEN':
        if (target?.isFlyer) mult *= 2.00;
        break;
      case 'ENGINEERS_CHARTER':
        if (tower.damageType === DamageType.SIEGE) mult *= 1.50;
        break;
      case 'GLADIATOR_OATH':
        if (target?.isCommander || target?.archetype === 'ELITE') mult *= 1.75;
        break;
      case 'ROME_BURNS':
        if (tower.damageType === DamageType.ELEMENTAL_FIRE || tower.damageType === DamageType.DIVINE) mult *= 1.75;
        break;
      case 'HARUSPEX_WARNING':
        if (target?.isCommander) mult *= 2.25;
        break;
      case 'BLESSING_OF_MARS':
        if (tower.damageType === DamageType.PHYS_MELEE || tower.damageType === DamageType.SIEGE) mult *= 1.55;
        break;
    }
  }
  return mult;
}

export function campaignRelicEnemySpeedMult(state: GameStateShape, enemy?: any): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    switch (id) {
      case 'JUPITERS_MANDATE': mult *= 1.18; break;
      case 'MARS_TAX': mult *= 1.25; break;
      case 'MERCURYS_ROADS': mult *= 1.25; break;
      case 'NEPTUNES_SURGE': if (!enemy?.isFlyer) mult *= 1.22; break;
      case 'FORTUNAS_DICE': mult *= 1.18; break;
      case 'TEMPLE_LOAN': mult *= 1.15; break;
      case 'SCOUT_MAPS': mult *= 1.25; break;
      case 'VULCANS_FORGE': if (enemy?.isFlyer) mult *= 1.45; break;
      case 'BLACK_OIL': if (enemy?.isFlyer) mult *= 1.55; break;
      case 'FROST_TITHE': mult *= 0.82; break;
    }
  }
  return mult;
}

export function campaignRelicEnemyHpMult(state: GameStateShape, enemyDef: any): number {
  let mult = 1;
  const isBoss = !!enemyDef?.isBoss;
  const isFlyer = !!enemyDef?.isFlyer;
  for (const id of activeCampaignRelicIds(state)) {
    switch (id) {
      case 'PLUTOS_PACT': if (!isBoss) mult *= 1.25; break;
      case 'VESTAL_FLAME': mult *= 1.22; break;
      case 'AEGIS_WALL': mult *= 1.35; break;
      case 'LAUREL_CENSUS': if (isBoss) mult *= 1.35; break;
      case 'EAGLE_OMEN': if (!isFlyer) mult *= 1.30; break;
      case 'GLADIATOR_OATH': if (isBoss) mult *= 1.35; break;
      case 'ROME_BURNS': mult *= 1.30; break;
      case 'SENATE_AUDIT': if (isBoss) mult *= 1.30; break;
      case 'HARUSPEX_WARNING': if (!isBoss) mult *= 1.20; break;
      case 'IMPERIAL_GRANARIES': mult *= 1.30; break;
      case 'LAST_EAGLE': if ((state.wave ?? 1) >= 25) mult *= 1.45; break;
    }
  }
  return mult;
}

export function campaignRelicTrapPriceMult(state: GameStateShape): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    if (id === 'MARS_TAX') mult *= 0.25;
    if (id === 'ENGINEERS_CHARTER') mult *= 2.00;
    if (id === 'TEMPLE_LOAN') mult *= 1.75;
  }
  return mult;
}

export function campaignRelicTrapDamageMult(state: GameStateShape): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    if (id === 'MARS_TAX') mult *= 1.80;
    if (id === 'VULCANS_FORGE') mult *= 1.35;
    if (id === 'ENGINEERS_CHARTER') mult *= 1.50;
    if (id === 'BLACK_OIL') mult *= 2.25;
  }
  return mult;
}

export function campaignRelicTrapRadiusMult(state: GameStateShape): number {
  return hasCampaignRelic(state, 'MARS_TAX') ? 1.60 : 1;
}

export function campaignRelicWaveGoldMult(state: GameStateShape): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    if (id === 'CERES_TITHE') mult *= 1.75;
    if (id === 'SENATE_AUDIT') mult *= 1.45;
    if (id === 'IMPERIAL_GRANARIES') mult *= 1.40;
  }
  return mult;
}

export function campaignRelicKillGoldBonus(state: GameStateShape): number {
  let bonus = 0;
  if (hasCampaignRelic(state, 'LAUREL_CENSUS')) bonus += 3;
  if (hasCampaignRelic(state, 'SENATE_AUDIT')) bonus += 2;
  return bonus;
}

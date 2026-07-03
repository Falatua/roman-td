import { DamageType, Tower, TowerType } from '../types';
import { GameStateShape } from '../GameState';
import { WAVE } from '../constants';
import { canReceiveRunReward } from './RewardEligibility';

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
  'LAST_EAGLE',
  'TRIUMPHAL_SPOILS',
  'SEALED_RELIQUARY',
  'CONSCRIPTS_WAGER',
  'ARMORY_BARGAIN',
  'PATRICIAN_LOCKBOX',
  'VETERAN_DRAFT',
  'QUARTERMASTER_LEDGER',
  'FORTUNA_PURSE',
  'ARCHITECTS_PERMIT',
  'FRONTIER_RECRUITS',
  'LEGATE_CONTRACT',
  'AGRICOLA_LEVY',
  'EPIC_AUCTION',
  'RELIQUARY_RANSOM',
  'ONAGER_INDENTURE',
  'PRAETORIAN_STIPEND',
  'VESTAL_ORPHANS',
  'DOUBLE_EPIC_FUNERAL',
  'SKY_TOLL',
  'SPECULATOR_BRIBE',
  'PILUS_PLEDGE',
  'CENTURION_LOAN',
  'SAGITTARIUS_PACT',
  'COPPER_TITHE',
  'WATCHMANS_DUE',
  'SCRAP_REQUISITION',
  'MASONS_CHARTER',
  'VULCANS_CACHE',
  'PUBLICANS_CONTRACT',
  'SATURNALIA_EDICT',
  'COLOSSEUM_WAGER',
  'VESTAL_COVENANT'
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

export interface CampaignRelicAffordability {
  canAfford: boolean;
  goldCost: number;
  lifeCost: number;
  reason?: string;
}

export const CAMPAIGN_RELICS: CampaignRelicDef[] = [
  {
    id: 'JUPITERS_MANDATE',
    name: "Jupiter's Mandate",
    eyebrow: 'DIVINE CAMPAIGN LAW',
    blurb: 'The gods demand spectacle. Holy engines become executioners, but the enemy marches under storm winds.',
    upside: 'Divine towers +80% damage and commanders take +50% damage.',
    caveat: 'All enemies move +25% faster.',
    effects: ['DIVINE +80% damage.', 'Commander enemies take +50% damage.', 'Enemies move +25% faster.']
  },
  {
    id: 'MARS_TAX',
    name: 'Mars Tax',
    eyebrow: 'WAR FUND DECREE',
    blurb: 'Mars pays for steel in advance. Traps become brutally efficient, but the enemy answers with speed.',
    upside: 'Trap prices -75%, trap damage +80%, trap radius +60%.',
    caveat: 'All enemies move +30% faster.',
    effects: ['Trap prices cut by 75%.', 'Trap damage +80% and radius +60%.', 'Enemies move +30% faster.']
  },
  {
    id: 'SATURNS_DEBT',
    name: "Saturn's Debt",
    eyebrow: 'BORROWED TIME',
    blurb: 'The treasury opens now. Rome will collect interest when the final daemon arrives.',
    upside: 'Gain 900 gold immediately.',
    caveat: 'At W30, Daemon Imperator takes up to 60% less direct damage based on banked gold.',
    effects: ['Gain 900 gold now.', 'W30 Daemon direct-damage reduction scales up to 60% with banked gold.']
  },
  {
    id: 'VULCANS_FORGE',
    name: "Vulcan's Forge",
    eyebrow: 'SIEGE BARGAIN',
    blurb: 'The forges burn white-hot for siege crews. Flyers use the smoke to attack faster.',
    upside: 'Siege towers +70% damage; traps +35% damage.',
    caveat: 'Flyers move +50% faster.',
    effects: ['SIEGE +70% damage.', 'Trap damage +35%.', 'Flyers move +50% faster.']
  },
  {
    id: 'MERCURYS_ROADS',
    name: "Mercury's Roads",
    eyebrow: 'SPEED DECREE',
    blurb: 'Every tower crew moves on courier timing. So does the invasion.',
    upside: 'All towers +35% attack speed.',
    caveat: 'All enemies move +30% faster.',
    effects: ['Tower attack speed +35%.', 'Enemies move +30% faster.']
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
    caveat: 'Non-boss enemies spawn with +35% HP.',
    effects: ['Bosses take +60% damage.', 'Non-boss enemy HP +35%.']
  },
  {
    id: 'MINERVAS_DOCTRINE',
    name: "Minerva's Doctrine",
    eyebrow: 'DRILL MANUAL',
    blurb: 'Line troops learn perfect timing. Complex war machines lose some improvisational edge.',
    upside: 'Base towers +45% attack speed.',
    caveat: 'Combo towers deal -30% damage.',
    effects: ['BASE attack speed +45%.', 'COMBO damage -30%.']
  },
  {
    id: 'NEPTUNES_SURGE',
    name: "Neptune's Surge",
    eyebrow: 'RANGED TIDE',
    blurb: 'Ballista strings and bow arms snap like surf. Ground troops ride the same current.',
    upside: 'Physical ranged towers +55% damage.',
    caveat: 'Ground enemies move +25% faster.',
    effects: ['PHYS_RANGED +55% damage.', 'Ground enemies move +25% faster.']
  },
  {
    id: 'VESTAL_FLAME',
    name: 'Vestal Flame',
    eyebrow: 'SACRED FIRE',
    blurb: 'Fire and divine rites burn brighter. The enemy brings heavier shields against the omen.',
    upside: 'Fire and Divine towers +55% damage.',
    caveat: 'Enemy HP +30%.',
    effects: ['FIRE and DIVINE +55% damage.', 'Enemy HP +30%.']
  },
  {
    id: 'FORTUNAS_DICE',
    name: "Fortuna's Dice",
    eyebrow: 'LUCK CONTRACT',
    blurb: 'Fortuna spills gold on the floor and laughs while the road gets faster.',
    upside: 'Gain 500 gold immediately.',
    caveat: 'All enemies move +25% faster.',
    effects: ['Gain 500 gold now.', 'Enemies move +25% faster.']
  },
  {
    id: 'JANUS_GATE',
    name: "Janus' Gate",
    eyebrow: 'TWO-FACED MAP',
    blurb: 'Every tower sees farther through one door and strikes softer through the other.',
    upside: 'All towers +2 range.',
    caveat: 'All tower damage -30%.',
    effects: ['Tower range +2 tiles.', 'Tower damage -30%.']
  },
  {
    id: 'AEGIS_WALL',
    name: 'Aegis Wall',
    eyebrow: 'SURVIVAL BARGAIN',
    blurb: 'Rome receives new shields at the gate. The invading line receives heavier armor.',
    upside: 'Gain 15 lives immediately.',
    caveat: 'Enemy HP +45%.',
    effects: ['Gain 15 lives now.', 'Enemy HP +45%.']
  },
  {
    id: 'LAUREL_CENSUS',
    name: 'Laurel Census',
    eyebrow: 'KILL LEDGER',
    blurb: 'Every fallen enemy is counted and paid. Bosses hire better guards.',
    upside: 'Every kill pays +3 gold.',
    caveat: 'Boss HP +70%.',
    effects: ['Kills pay +3 gold.', 'Boss HP +70%.']
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
    caveat: 'Ground enemies spawn with +35% HP.',
    effects: ['Flyers take +100% damage.', 'Ground enemy HP +35%.']
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
    caveat: 'Boss HP +45%.',
    effects: ['ELITE and commander enemies take +75% damage.', 'Boss HP +45%.']
  },
  {
    id: 'TEMPLE_LOAN',
    name: 'Temple Loan',
    eyebrow: 'PRIESTLY CREDIT',
    blurb: 'The temples front the war chest. Every later purchase carries a little guilt.',
    upside: 'Gain 700 gold immediately.',
    caveat: 'Trap prices +90% and enemies move +20% faster.',
    effects: ['Gain 700 gold now.', 'Trap prices +90%.', 'Enemies move +20% faster.']
  },
  {
    id: 'ROME_BURNS',
    name: 'Rome Burns',
    eyebrow: 'DESPERATE FLAME',
    blurb: 'Fire and divine wrath surge while the enemy hardens against panic.',
    upside: 'Fire and Divine towers +75% damage.',
    caveat: 'Enemy HP +35%.',
    effects: ['FIRE and DIVINE +75% damage.', 'Enemy HP +35%.']
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
    caveat: 'All enemies move +30% faster.',
    effects: ['Tower range +2 tiles.', 'Enemies move +30% faster.']
  },
  {
    id: 'BLACK_OIL',
    name: 'Black Oil',
    eyebrow: 'TRAPWRIGHT SIN',
    blurb: 'The ground becomes murderous. Flyers waste no time above it.',
    upside: 'Traps deal +125% damage.',
    caveat: 'Flyers move +60% faster.',
    effects: ['Trap damage +125%.', 'Flyers move +60% faster.']
  },
  {
    id: 'SENATE_AUDIT',
    name: 'Senate Audit',
    eyebrow: 'PUBLIC ACCOUNTING',
    blurb: 'The books become healthier after each wave. Bosses receive better stipends.',
    upside: 'Wave-clear gold +45% and kills pay +2 gold.',
    caveat: 'Boss HP +55%.',
    effects: ['Wave gold +45%.', 'Kills pay +2 gold.', 'Boss HP +55%.']
  },
  {
    id: 'HARUSPEX_WARNING',
    name: 'Haruspex Warning',
    eyebrow: 'COMMANDER OMEN',
    blurb: 'The priests read the enemy officers in the entrails. The rank and file are harder to break.',
    upside: 'Commanders take +125% damage.',
    caveat: 'Non-boss enemy HP +30%.',
    effects: ['Commanders take +125% damage.', 'Non-boss enemy HP +30%.']
  },
  {
    id: 'IMPERIAL_GRANARIES',
    name: 'Imperial Granaries',
    eyebrow: 'SUPPLY FLOOD',
    blurb: 'Rome eats well and pays well. The invasion fattens too.',
    upside: 'Gain 500 gold and wave-clear gold +40%.',
    caveat: 'Enemy HP +40%.',
    effects: ['Gain 500 gold now.', 'Wave gold +40%.', 'Enemy HP +40%.']
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
    upside: 'All enemies move -22% slower.',
    caveat: 'All towers deal -35% damage.',
    effects: ['Enemies move -22% slower.', 'Tower damage -35%.']
  },
  {
    id: 'LAST_EAGLE',
    name: 'The Last Eagle',
    eyebrow: 'FINAL STANDARD',
    blurb: 'The final act belongs to Rome. The final act also hits back.',
    upside: 'From W25 onward, towers deal +70% damage.',
    caveat: 'From W25 onward, enemy HP +45%.',
    effects: ['W25+ tower damage +70%.', 'W25+ enemy HP +45%.']
  },
  {
    id: 'TRIUMPHAL_SPOILS',
    name: 'Triumphal Spoils',
    eyebrow: 'WAR-BOOTY GRANT',
    blurb: 'The triumph parades a captured siege engine into your service. The enemy quickens to take it back.',
    upside: 'Immediately gain a free Tier-5 Scorpio to place.',
    caveat: 'All enemies move +25% faster for the rest of the run.',
    effects: ['Gain a free Tier-5 SCORPIO now.', 'Enemies move +25% faster all run.']
  },
  {
    id: 'SEALED_RELIQUARY',
    name: 'Sealed Reliquary',
    eyebrow: 'CONSECRATED HOARD',
    blurb: 'A sealed reliquary yields a legendary relic of war. Its theft from the gods swells the horde with borrowed strength.',
    upside: 'Immediately gain a random Legendary item.',
    caveat: 'All enemies gain +20% HP for the rest of the run.',
    effects: ['Gain a random Legendary item now.', 'Enemy HP +20% all run.']
  },
  {
    id: 'CONSCRIPTS_WAGER',
    name: "Conscript's Wager",
    eyebrow: 'BLOOD FOR STEEL',
    blurb: 'A full veteran tower crew marches in under emergency oath. Rome pays with bodies at the gate.',
    upside: 'Immediately gain one random Tier-5 base tower to place.',
    caveat: 'Lose 14 lives immediately.',
    effects: ['Gain a random Tier-5 BASE tower now.', 'Lose 14 lives now.']
  },
  {
    id: 'ARMORY_BARGAIN',
    name: 'Armory Bargain',
    eyebrow: 'CHEAP STEEL',
    blurb: 'A quartermaster opens the locked shelf and pretends not to see the missing names on the casualty roll.',
    upside: 'Immediately gain a random Rare item.',
    caveat: 'Lose 7 lives immediately.',
    effects: ['Gain a random Rare item now.', 'Lose 7 lives now.']
  },
  {
    id: 'PATRICIAN_LOCKBOX',
    name: 'Patrician Lockbox',
    eyebrow: 'PRIVATE WAR CHEST',
    blurb: 'A senator offers one excellent piece of equipment with a smile that makes the legions nervous.',
    upside: 'Immediately gain a random Epic item.',
    caveat: 'Lose 10 lives immediately.',
    effects: ['Gain a random Epic item now.', 'Lose 10 lives now.']
  },
  {
    id: 'VETERAN_DRAFT',
    name: 'Veteran Draft',
    eyebrow: 'REASSIGNED CENTURIES',
    blurb: 'Two seasoned detachments are pulled from the reserves. The city walls feel the absence.',
    upside: 'Immediately gain two random Tier-3 base towers to place.',
    caveat: 'Lose 8 lives immediately.',
    effects: ['Gain two random Tier-3 BASE towers now.', 'Lose 8 lives now.']
  },
  {
    id: 'QUARTERMASTER_LEDGER',
    name: 'Quartermaster Ledger',
    eyebrow: 'CLEANER BOOKS',
    blurb: 'The numbers suddenly favor Rome. The gate guards suddenly look thinner.',
    upside: 'Gain 300 gold immediately.',
    caveat: 'Lose 5 lives immediately.',
    effects: ['Gain 300 gold now.', 'Lose 5 lives now.']
  },
  {
    id: 'FORTUNA_PURSE',
    name: "Fortuna's Purse",
    eyebrow: 'SMALL LUCK',
    blurb: 'Fortuna drops a useful trinket, then asks whether Rome really needed all those sentries.',
    upside: 'Gain 180 gold and a random Rare item immediately.',
    caveat: 'Lose 8 lives immediately.',
    effects: ['Gain 180 gold now.', 'Gain a random Rare item now.', 'Lose 8 lives now.']
  },
  {
    id: 'ARCHITECTS_PERMIT',
    name: "Architect's Permit",
    eyebrow: 'FAST FOUNDATION',
    blurb: 'The builders approve one serious emplacement without paperwork. The evacuation lanes get narrower.',
    upside: 'Immediately gain one random Tier-4 base tower to place.',
    caveat: 'Lose 7 lives immediately.',
    effects: ['Gain a random Tier-4 BASE tower now.', 'Lose 7 lives now.']
  },
  {
    id: 'FRONTIER_RECRUITS',
    name: 'Frontier Recruits',
    eyebrow: 'BORDER LEVY',
    blurb: 'Two frontier crews arrive with rough accents and practical weapons. Rome spends the last quiet watch to get them here.',
    upside: 'Immediately gain one Tier-4 melee base tower and one Tier-4 ranged base tower.',
    caveat: 'Lose 12 lives immediately.',
    effects: ['Gain one Tier-4 MELEE BASE tower now.', 'Gain one Tier-4 RANGED BASE tower now.', 'Lose 12 lives now.']
  },
  {
    id: 'LEGATE_CONTRACT',
    name: 'Legate Contract',
    eyebrow: 'GOLD FOR COMMAND',
    blurb: 'A proven Legate sells his whole command staff to Rome. His invoice is aggressively unpatriotic.',
    upside: 'Immediately gain a Tier-5 Legate to place.',
    caveat: 'Lose 225 gold immediately.',
    effects: ['Gain a Tier-5 LEGATE now.', 'Lose 225 gold now.']
  },
  {
    id: 'AGRICOLA_LEVY',
    name: "Agricola's Levy",
    eyebrow: 'LIVES FOR A HERO',
    blurb: 'Agricola arrives from the frontier with maps, scouts, and a hard look at the casualty rolls.',
    upside: 'Immediately gain Champion Agricola to place.',
    caveat: 'Lose 20 lives immediately.',
    effects: ['Gain CHAMPION AGRICOLA now.', 'Lose 20 lives now.']
  },
  {
    id: 'EPIC_AUCTION',
    name: 'Epic Auction',
    eyebrow: 'PUBLIC TREASURY SALE',
    blurb: 'The auctioneer opens one velvet case. Every senator suddenly remembers your name.',
    upside: 'Immediately gain a random Epic item.',
    caveat: 'Lose 325 gold immediately.',
    effects: ['Gain a random Epic item now.', 'Lose 325 gold now.']
  },
  {
    id: 'RELIQUARY_RANSOM',
    name: 'Reliquary Ransom',
    eyebrow: 'GOLD FOR A LEGEND',
    blurb: 'A temple guard looks away for one breath. The reliquary changes hands before anyone can pray.',
    upside: 'Immediately gain a random Legendary item.',
    caveat: 'Lose 500 gold immediately.',
    effects: ['Gain a random Legendary item now.', 'Lose 500 gold now.']
  },
  {
    id: 'ONAGER_INDENTURE',
    name: 'Onager Indenture',
    eyebrow: 'DEBT-FUNDED SIEGE',
    blurb: 'A colossal engine is wheeled out under a contract with very small lettering.',
    upside: 'Immediately gain a Tier-5 Colossus Onager to place.',
    caveat: 'Lose 250 gold immediately.',
    effects: ['Gain a Tier-5 COLOSSUS ONAGER now.', 'Lose 250 gold now.']
  },
  {
    id: 'PRAETORIAN_STIPEND',
    name: 'Praetorian Stipend',
    eyebrow: 'ELITE PAYROLL',
    blurb: 'The guard will stand for Rome. The guard will also be paid before standing for Rome.',
    upside: 'Immediately gain a Tier-5 Imperator Guard to place.',
    caveat: 'Lose 375 gold immediately.',
    effects: ['Gain a Tier-5 IMPERATOR GUARD now.', 'Lose 375 gold now.']
  },
  {
    id: 'VESTAL_ORPHANS',
    name: 'Vestal Orphans',
    eyebrow: 'LIVES FOR AN EPIC',
    blurb: 'The Vestals release one sanctified weapon, and the city quietly empties another street.',
    upside: 'Immediately gain a random Epic item.',
    caveat: 'Lose 10 lives immediately.',
    effects: ['Gain a random Epic item now.', 'Lose 10 lives now.']
  },
  {
    id: 'DOUBLE_EPIC_FUNERAL',
    name: 'Double Epic Funeral',
    eyebrow: 'TWO CASES, ONE COST',
    blurb: 'Two funeral wagons arrive covered in officer cloaks. The equipment inside is excellent. The silence is not.',
    upside: 'Immediately gain two random Epic items.',
    caveat: 'Lose 16 lives immediately.',
    effects: ['Gain two random Epic items now.', 'Lose 16 lives now.']
  },
  {
    id: 'SKY_TOLL',
    name: 'Sky Toll',
    eyebrow: 'ANTI-AIR PURCHASE',
    blurb: 'Aquila hunters rent their talons to the highest bidder and leave no coin on the table.',
    upside: 'Immediately gain a Tier-5 Aquila Venator to place.',
    caveat: 'Lose 240 gold immediately.',
    effects: ['Gain a Tier-5 AQUILA VENATOR now.', 'Lose 240 gold now.']
  },
  {
    id: 'SPECULATOR_BRIBE',
    name: 'Speculator Bribe',
    eyebrow: 'SCOUTING PAYOFF',
    blurb: 'A scout captain sells tomorrow morning early. Rome buys the information and the man carrying it.',
    upside: 'Immediately gain a Tier-5 Speculator to place.',
    caveat: 'Lose 160 gold immediately.',
    effects: ['Gain a Tier-5 SPECULATOR now.', 'Lose 160 gold now.']
  },
  // 2026-07-02 — low-stakes relic family. Small, cheap bargains with modest
  // upsides and modest punishments, so not every relic offer is a
  // run-defining gamble. Same claim-time machinery as the bigger bargains.
  {
    id: 'PILUS_PLEDGE',
    name: 'Pilus Pledge',
    eyebrow: 'SMALL OATH',
    blurb: 'A first spear signs on for one campaign. The gate roster gets five names shorter.',
    upside: 'Immediately gain a Tier-3 Primus Pilus to place.',
    caveat: 'Lose 5 lives immediately.',
    effects: ['Gain a Tier-3 PRIMUS PILUS now.', 'Lose 5 lives now.']
  },
  {
    id: 'CENTURION_LOAN',
    name: 'Centurion Loan',
    eyebrow: 'MODEST HIRE',
    blurb: 'A steady centurion works for steady coin. Nothing dramatic. That is the point.',
    upside: 'Immediately gain a Tier-3 Centurion to place.',
    caveat: 'Lose 120 gold immediately.',
    effects: ['Gain a Tier-3 CENTURION now.', 'Lose 120 gold now.']
  },
  {
    id: 'SAGITTARIUS_PACT',
    name: 'Sagittarius Pact',
    eyebrow: 'SMALL SKY WATCH',
    blurb: 'One archer takes the flyer watch, and one street stops answering the census.',
    upside: 'Immediately gain a Tier-3 Sagittarius to place.',
    caveat: 'Lose 5 lives immediately.',
    effects: ['Gain a Tier-3 SAGITTARIUS now.', 'Lose 5 lives now.']
  },
  {
    id: 'COPPER_TITHE',
    name: 'Copper Tithe',
    eyebrow: 'POCKET CHANGE',
    blurb: 'A minor tax on a minor district. Rome barely notices. The district notices.',
    upside: 'Gain 150 gold immediately.',
    caveat: 'Lose 3 lives immediately.',
    effects: ['Gain 150 gold now.', 'Lose 3 lives now.']
  },
  {
    id: 'WATCHMANS_DUE',
    name: "Watchman's Due",
    eyebrow: 'PAID SENTRIES',
    blurb: 'Four extra watchmen take the wall for honest pay. The treasury sighs and signs.',
    upside: 'Gain 4 lives immediately.',
    caveat: 'Lose 100 gold immediately.',
    effects: ['Gain 4 lives now.', 'Lose 100 gold now.']
  },
  {
    id: 'SCRAP_REQUISITION',
    name: 'Scrap Requisition',
    eyebrow: 'SURPLUS CRATE',
    blurb: 'The armory sells last season\'s surplus. Serviceable, unglamorous, and priced accordingly.',
    upside: 'Immediately gain a random Rare item.',
    caveat: 'Lose 90 gold immediately.',
    effects: ['Gain a random Rare item now.', 'Lose 90 gold now.']
  },
  // 2026-07-03 — mechanic-hook relics. Instead of plain stat trades, each
  // of these six plugs into a distinct game system (ramparts, traps, kill
  // economy, the Saturnalia inversion, boss bounties, a once-per-run
  // rescue) so relic offers read as build-changing choices.
  {
    id: 'MASONS_CHARTER',
    name: "Mason's Charter",
    eyebrow: 'GUILD STONEWORK',
    blurb: 'The masons\' guild donates two finished rampart sections. The workers are conscripted straight off the walls.',
    upside: 'Immediately gain 2 free Stone Ramparts (they do NOT count against the 5-per-campaign shop quota).',
    caveat: 'Lose 6 lives immediately.',
    effects: ['Gain 2 Stone Ramparts now (quota-free).', 'Lose 6 lives now.']
  },
  {
    id: 'VULCANS_CACHE',
    name: "Vulcan's Cache",
    eyebrow: 'FORGE SURPLUS',
    blurb: 'Vulcan\'s apprentices clear the forge floor: spikes, fire, and frost, crated and ready.',
    upside: 'Immediately gain 2 Iron Spike, 2 Tar Fire, and 2 Frost Snare traps.',
    caveat: 'Lose 120 gold immediately.',
    effects: ['Gain 2× Iron Spike + 2× Tar Fire + 2× Frost Snare traps now.', 'Lose 120 gold now.']
  },
  {
    id: 'PUBLICANS_CONTRACT',
    name: "Publican's Contract",
    eyebrow: 'TAX FARMING',
    blurb: 'A publican buys the right to tax every corpse. He pays per head and skims the war chest.',
    upside: 'Every enemy kill pays +2 bonus gold for the rest of the run.',
    caveat: 'Wave-clear gold reduced by 30%.',
    effects: ['+2 gold on every kill.', 'Wave-clear gold −30%.']
  },
  {
    id: 'SATURNALIA_EDICT',
    name: 'Saturnalia Edict',
    eyebrow: 'FESTIVAL LAW',
    blurb: 'The festival slows the whole world — the enemy saunters, and your crews pour wine between shots.',
    upside: 'All enemies move 12% slower for the rest of the run.',
    caveat: 'All towers deal 10% less damage.',
    effects: ['Enemies −12% speed all run.', 'Tower damage −10% all run.']
  },
  {
    id: 'COLOSSEUM_WAGER',
    name: 'Colosseum Wager',
    eyebrow: 'BLOOD SPORT',
    blurb: 'The crowd pays to watch giants fall. Every boss you drop, the editor returns bodies to the walls.',
    upside: 'Every boss kill restores +2 lives (capped at 30).',
    caveat: 'Non-boss enemies spawn with +12% HP.',
    effects: ['+2 lives per boss kill.', 'Non-boss enemy HP +12%.']
  },
  {
    id: 'VESTAL_COVENANT',
    name: 'Vestal Covenant',
    eyebrow: 'SACRED RESCUE',
    blurb: 'The Vestals bank a miracle against Rome\'s darkest hour. Miracles are not cheap.',
    upside: 'ONCE per run: the first time your lives fall below 6, the Vestals restore you to 12.',
    caveat: 'Lose 250 gold immediately.',
    effects: ['One-time rescue: lives < 6 → restored to 12.', 'Lose 250 gold now.']
  }
];

const RELIC_BY_ID: Record<string, CampaignRelicDef> = Object.fromEntries(CAMPAIGN_RELICS.map(r => [r.id, r]));

const CAMPAIGN_RELIC_GOLD_COSTS: Partial<Record<CampaignRelicId, number>> = {
  LEGATE_CONTRACT: 225,
  EPIC_AUCTION: 325,
  RELIQUARY_RANSOM: 500,
  ONAGER_INDENTURE: 250,
  PRAETORIAN_STIPEND: 375,
  SKY_TOLL: 240,
  SPECULATOR_BRIBE: 160,
  CENTURION_LOAN: 120,
  WATCHMANS_DUE: 100,
  SCRAP_REQUISITION: 90,
  VULCANS_CACHE: 120,
  VESTAL_COVENANT: 250
};

const CAMPAIGN_RELIC_LIFE_COSTS: Partial<Record<CampaignRelicId, number>> = {
  CONSCRIPTS_WAGER: 14,
  ARMORY_BARGAIN: 7,
  PATRICIAN_LOCKBOX: 10,
  VETERAN_DRAFT: 8,
  QUARTERMASTER_LEDGER: 5,
  FORTUNA_PURSE: 8,
  ARCHITECTS_PERMIT: 7,
  FRONTIER_RECRUITS: 12,
  AGRICOLA_LEVY: 20,
  VESTAL_ORPHANS: 10,
  DOUBLE_EPIC_FUNERAL: 16,
  PILUS_PLEDGE: 5,
  SAGITTARIUS_PACT: 5,
  COPPER_TITHE: 3,
  MASONS_CHARTER: 6
};

export function campaignRelicById(id: CampaignRelicId | string | null | undefined): CampaignRelicDef | null {
  return id ? RELIC_BY_ID[id] ?? null : null;
}

export function campaignRelicAffordability(state: GameStateShape, id: CampaignRelicId): CampaignRelicAffordability {
  const goldCost = CAMPAIGN_RELIC_GOLD_COSTS[id] ?? 0;
  const lifeCost = CAMPAIGN_RELIC_LIFE_COSTS[id] ?? 0;
  const gold = state.gold ?? 0;
  const lives = state.lives ?? 0;
  if (goldCost > 0 && gold < goldCost) {
    return {
      canAfford: false,
      goldCost,
      lifeCost,
      reason: `Need ${goldCost} gold to claim this relic.`
    };
  }
  if (lifeCost > 0 && lives <= lifeCost) {
    return {
      canAfford: false,
      goldCost,
      lifeCost,
      reason: `Need at least ${lifeCost + 1} lives to survive this relic.`
    };
  }
  return { canAfford: true, goldCost, lifeCost };
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
  if (!canReceiveRunReward(state)) return false;
  if (state.endlessMode || !relicMilestoneWave(state.wave)) return false;
  if ((state as any).__campaignRelicOpen) return false;
  const offered = state.campaignRelicOfferWaves ?? [];
  const skipped = state.campaignRelicSkippedWaves ?? [];
  return !offered.includes(state.wave) && !skipped.includes(state.wave);
}

export function campaignRelicOffersForWave(state: GameStateShape, wave = state.wave, count = 4): CampaignRelicDef[] {
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

const BASE_TOWER_RELIC_POOL = [
  TowerType.MILITES, TowerType.VELITES, TowerType.HASTATI, TowerType.SAGITTARIUS, TowerType.SCORPIO,
  TowerType.TRIARIUS, TowerType.DECURION, TowerType.CENTURION, TowerType.PRIMUS_PILUS, TowerType.LEGATE,
  TowerType.AUXILIA, TowerType.FUNDIBULUS, TowerType.RORARIUS, TowerType.LIBRITOR, TowerType.ACCENSUS,
  TowerType.RETIARIUS, TowerType.BALLISTARIUS, TowerType.OPTIO, TowerType.PUGIO_ASSASSIN, TowerType.ARCUBALLISTA,
  TowerType.VENATOR, TowerType.IGNIFER, TowerType.SPECULATOR, TowerType.FLAMEN, TowerType.CARROBALLISTA,
  TowerType.CATAPHRACT, TowerType.AUGUR, TowerType.EVOCATUS, TowerType.HARUSPEX, TowerType.CLIBANARIUS,
  TowerType.PRAEFECTUS, TowerType.VULCAN_ENGINEER, TowerType.IMPERATOR_GUARD, TowerType.SOLAR_PRIEST,
  TowerType.COLOSSUS_ONAGER, TowerType.AQUILA_VENATOR
] as const;

const MELEE_BASE_TOWER_RELIC_POOL = [
  TowerType.MILITES, TowerType.HASTATI, TowerType.TRIARIUS, TowerType.DECURION, TowerType.CENTURION,
  TowerType.PRIMUS_PILUS, TowerType.AUXILIA, TowerType.ACCENSUS, TowerType.RETIARIUS, TowerType.PUGIO_ASSASSIN,
  TowerType.CATAPHRACT, TowerType.EVOCATUS, TowerType.CLIBANARIUS, TowerType.IMPERATOR_GUARD
] as const;

const RANGED_BASE_TOWER_RELIC_POOL = BASE_TOWER_RELIC_POOL.filter(t => !MELEE_BASE_TOWER_RELIC_POOL.includes(t as any));

function pickRelicTower(pool: readonly TowerType[]): TowerType {
  return pool[Math.floor(Math.random() * pool.length)];
}

function queueRelicTower(state: GameStateShape, type: TowerType, tier: 1 | 2 | 3 | 4 | 5): void {
  if (!state.pendingPurchasedTowers) state.pendingPurchasedTowers = [];
  state.pendingPurchasedTowers.push({ type, tier, source: 'relic' });
}

function queuePendingRelicItem(state: GameStateShape, rarity: 'RARE' | 'EPIC'): void {
  const key = '__pendingRelicItemRarities';
  const arr = (((state as any)[key] ?? []) as string[]);
  arr.push(rarity);
  (state as any)[key] = arr;
}

function sacrificeRelicLives(state: GameStateShape, amount: number): void {
  state.lives = (state.lives ?? 0) - amount;
}

function sacrificeRelicGold(state: GameStateShape, amount: number): void {
  state.gold = (state.gold ?? 0) - amount;
}

export function applyCampaignRelic(state: GameStateShape, id: CampaignRelicId): boolean {
  const def = campaignRelicById(id);
  if (!def) return false;
  const affordability = campaignRelicAffordability(state, id);
  if (!affordability.canAfford) {
    state.hint = affordability.reason ?? `Cannot claim ${def.name}.`;
    return false;
  }
  if (!state.campaignRelicIds) state.campaignRelicIds = [];
  if (!state.campaignRelicIds.includes(id)) state.campaignRelicIds.push(id);
  state.campaignRelicId = id;
  markCampaignRelicOffered(state);
  if (id === 'SATURNS_DEBT') state.gold += 900;
  if (id === 'FORTUNAS_DICE') state.gold += 500;
  if (id === 'TEMPLE_LOAN') state.gold += 700;
  if (id === 'IMPERIAL_GRANARIES') state.gold += 500;
  if (id === 'AEGIS_WALL') state.lives += 15;
  if (id === 'QUARTERMASTER_LEDGER') {
    state.gold += 300;
    sacrificeRelicLives(state, 5);
  }
  if (id === 'FORTUNA_PURSE') {
    state.gold += 180;
    queuePendingRelicItem(state, 'RARE');
    sacrificeRelicLives(state, 8);
  }
  // 2026-06-25 — concrete reward grants. T5 tower is self-contained; the
  // legendary item is granted by main.ts (inventory in scope there) when it
  // sees this flag.
  if (id === 'TRIUMPHAL_SPOILS') {
    if (!state.pendingPurchasedTowers) state.pendingPurchasedTowers = [];
    state.pendingPurchasedTowers.push({ type: 'SCORPIO' as any, tier: 5, source: 'relic' });
  }
  if (id === 'SEALED_RELIQUARY') (state as any).__pendingRelicLegendary = true;
  if (id === 'CONSCRIPTS_WAGER') {
    queueRelicTower(state, pickRelicTower(BASE_TOWER_RELIC_POOL), 5);
    sacrificeRelicLives(state, 14);
  }
  if (id === 'ARMORY_BARGAIN') {
    queuePendingRelicItem(state, 'RARE');
    sacrificeRelicLives(state, 7);
  }
  if (id === 'PATRICIAN_LOCKBOX') {
    queuePendingRelicItem(state, 'EPIC');
    sacrificeRelicLives(state, 10);
  }
  if (id === 'VETERAN_DRAFT') {
    queueRelicTower(state, pickRelicTower(BASE_TOWER_RELIC_POOL), 3);
    queueRelicTower(state, pickRelicTower(BASE_TOWER_RELIC_POOL), 3);
    sacrificeRelicLives(state, 8);
  }
  if (id === 'ARCHITECTS_PERMIT') {
    queueRelicTower(state, pickRelicTower(BASE_TOWER_RELIC_POOL), 4);
    sacrificeRelicLives(state, 7);
  }
  if (id === 'FRONTIER_RECRUITS') {
    queueRelicTower(state, pickRelicTower(MELEE_BASE_TOWER_RELIC_POOL), 4);
    queueRelicTower(state, pickRelicTower(RANGED_BASE_TOWER_RELIC_POOL), 4);
    sacrificeRelicLives(state, 12);
  }
  if (id === 'LEGATE_CONTRACT') {
    queueRelicTower(state, TowerType.LEGATE, 5);
    sacrificeRelicGold(state, 225);
  }
  if (id === 'AGRICOLA_LEVY') {
    queueRelicTower(state, TowerType.CHAMPION_AGRICOLA, 2);
    sacrificeRelicLives(state, 20);
  }
  if (id === 'EPIC_AUCTION') {
    queuePendingRelicItem(state, 'EPIC');
    sacrificeRelicGold(state, 325);
  }
  if (id === 'RELIQUARY_RANSOM') {
    (state as any).__pendingRelicLegendary = true;
    sacrificeRelicGold(state, 500);
  }
  if (id === 'ONAGER_INDENTURE') {
    queueRelicTower(state, TowerType.COLOSSUS_ONAGER, 5);
    sacrificeRelicGold(state, 250);
  }
  if (id === 'PRAETORIAN_STIPEND') {
    queueRelicTower(state, TowerType.IMPERATOR_GUARD, 5);
    sacrificeRelicGold(state, 375);
  }
  if (id === 'VESTAL_ORPHANS') {
    queuePendingRelicItem(state, 'EPIC');
    sacrificeRelicLives(state, 10);
  }
  if (id === 'DOUBLE_EPIC_FUNERAL') {
    queuePendingRelicItem(state, 'EPIC');
    queuePendingRelicItem(state, 'EPIC');
    sacrificeRelicLives(state, 16);
  }
  if (id === 'SKY_TOLL') {
    queueRelicTower(state, TowerType.AQUILA_VENATOR, 5);
    sacrificeRelicGold(state, 240);
  }
  if (id === 'SPECULATOR_BRIBE') {
    queueRelicTower(state, TowerType.SPECULATOR, 5);
    sacrificeRelicGold(state, 160);
  }
  // 2026-07-02 — low-stakes relic family: small trades, small costs.
  if (id === 'PILUS_PLEDGE') {
    queueRelicTower(state, TowerType.PRIMUS_PILUS, 3);
    sacrificeRelicLives(state, 5);
  }
  if (id === 'CENTURION_LOAN') {
    queueRelicTower(state, TowerType.CENTURION, 3);
    sacrificeRelicGold(state, 120);
  }
  if (id === 'SAGITTARIUS_PACT') {
    queueRelicTower(state, TowerType.SAGITTARIUS, 3);
    sacrificeRelicLives(state, 5);
  }
  if (id === 'COPPER_TITHE') {
    state.gold += 150;
    sacrificeRelicLives(state, 3);
  }
  if (id === 'WATCHMANS_DUE') {
    state.lives = (state.lives ?? 0) + 4;
    sacrificeRelicGold(state, 100);
  }
  if (id === 'SCRAP_REQUISITION') {
    queuePendingRelicItem(state, 'RARE');
    sacrificeRelicGold(state, 90);
  }
  // 2026-07-03 — mechanic-hook relics.
  if (id === 'MASONS_CHARTER') {
    // Free ramparts land in inventory WITHOUT touching rampartsPurchased,
    // so the shop's 5-per-campaign quota is unaffected.
    state.rampartsOwned = (state.rampartsOwned ?? 0) + 2;
    sacrificeRelicLives(state, 6);
  }
  if (id === 'VULCANS_CACHE') {
    if (!state.trapInventory) state.trapInventory = {};
    for (const tid of ['IRON_SPIKE_TRAP', 'TAR_FIRE_TRAP', 'FROST_SNARE']) {
      state.trapInventory[tid] = (state.trapInventory[tid] ?? 0) + 2;
    }
    state.trapsPurchased = (state.trapsPurchased ?? 0) + 6;   // quest progress
    sacrificeRelicGold(state, 120);
  }
  if (id === 'VESTAL_COVENANT') {
    sacrificeRelicGold(state, 250);
  }
  // PUBLICANS_CONTRACT / SATURNALIA_EDICT / COLOSSEUM_WAGER are pure
  // hook-based relics (kill gold, speed/damage mults, boss-kill lives) —
  // no claim-time payload.
  state.hint = `${def.name} claimed. ${def.upside} Caveat: ${def.caveat}`;
  return true;
}

export function campaignRelicTowerDpsMult(state: GameStateShape, tower: Tower, towerKind?: string): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    switch (id) {
      case 'CERES_TITHE': if (towerKind === 'BASE') mult *= 0.70; break;
      case 'MINERVAS_DOCTRINE': if (towerKind === 'COMBO') mult *= 0.70; break;
      case 'JANUS_GATE': mult *= 0.70; break;
      case 'IRON_DISCIPLINE': mult *= 1.35; break;
      case 'RAPID_MUSTER': mult *= 0.65; break;
      case 'BLESSING_OF_MARS': if (tower.damageType === DamageType.DIVINE) mult *= 0.65; break;
      case 'FROST_TITHE': mult *= 0.65; break;
      case 'LAST_EAGLE': if ((state.wave ?? 1) >= 25) mult *= 1.70; break;
      case 'SATURNALIA_EDICT': mult *= 0.90; break;
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
      case 'JUPITERS_MANDATE': mult *= 1.25; break;
      case 'MARS_TAX': mult *= 1.30; break;
      case 'MERCURYS_ROADS': mult *= 1.30; break;
      case 'NEPTUNES_SURGE': if (!enemy?.isFlyer) mult *= 1.25; break;
      case 'FORTUNAS_DICE': mult *= 1.25; break;
      case 'TEMPLE_LOAN': mult *= 1.20; break;
      case 'SCOUT_MAPS': mult *= 1.30; break;
      case 'VULCANS_FORGE': if (enemy?.isFlyer) mult *= 1.50; break;
      case 'BLACK_OIL': if (enemy?.isFlyer) mult *= 1.60; break;
      case 'FROST_TITHE': mult *= 0.78; break;
      case 'TRIUMPHAL_SPOILS': mult *= 1.25; break;   // pays for the free T5 Scorpio
      case 'SATURNALIA_EDICT': mult *= 0.88; break;   // festival slows the world
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
      case 'PLUTOS_PACT': if (!isBoss) mult *= 1.35; break;
      case 'COLOSSEUM_WAGER': if (!isBoss) mult *= 1.12; break;
      case 'VESTAL_FLAME': mult *= 1.30; break;
      case 'AEGIS_WALL': mult *= 1.45; break;
      case 'LAUREL_CENSUS': if (isBoss) mult *= 1.70; break;
      case 'EAGLE_OMEN': if (!isFlyer) mult *= 1.35; break;
      case 'GLADIATOR_OATH': if (isBoss) mult *= 1.45; break;
      case 'ROME_BURNS': mult *= 1.35; break;
      case 'SENATE_AUDIT': if (isBoss) mult *= 1.55; break;
      case 'HARUSPEX_WARNING': if (!isBoss) mult *= 1.30; break;
      case 'IMPERIAL_GRANARIES': mult *= 1.40; break;
      case 'LAST_EAGLE': if ((state.wave ?? 1) >= 25) mult *= 1.45; break;
      case 'SEALED_RELIQUARY': mult *= 1.20; break;   // pays for the free Legendary
    }
  }
  return mult;
}

export function campaignRelicTrapPriceMult(state: GameStateShape): number {
  let mult = 1;
  for (const id of activeCampaignRelicIds(state)) {
    if (id === 'MARS_TAX') mult *= 0.25;
    if (id === 'ENGINEERS_CHARTER') mult *= 2.00;
    if (id === 'TEMPLE_LOAN') mult *= 1.90;
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
    if (id === 'PUBLICANS_CONTRACT') mult *= 0.70;   // the publican skims the chest
  }
  return mult;
}

export function campaignRelicKillGoldBonus(state: GameStateShape): number {
  let bonus = 0;
  if (hasCampaignRelic(state, 'LAUREL_CENSUS')) bonus += 3;
  if (hasCampaignRelic(state, 'SENATE_AUDIT')) bonus += 2;
  if (hasCampaignRelic(state, 'PUBLICANS_CONTRACT')) bonus += 2;
  return bonus;
}

// 2026-07-03 — COLOSSEUM_WAGER: lives restored on every boss kill. Caller
// (main.ts boss-death paths) adds the return value, clamped to MAX_LIVES.
export function campaignRelicBossKillLives(state: GameStateShape): number {
  return hasCampaignRelic(state, 'COLOSSEUM_WAGER') ? 2 : 0;
}

// 2026-07-03 — VESTAL_COVENANT: once per run, the first time lives fall
// below 6 (but Rome hasn't already fallen), restore to 12. Called from the
// main loop's periodic tick; returns true on the frame the rescue fires so
// the caller can banner it. Test Your Might's instant defeat (lives = 0 +
// gameOverAt set) is deliberately NOT rescuable.
export function campaignRelicVestalRescue(state: GameStateShape): boolean {
  if (!hasCampaignRelic(state, 'VESTAL_COVENANT')) return false;
  if ((state as any).__vestalCovenantUsed) return false;
  if (state.gameOverAt >= 0) return false;
  const lives = state.lives ?? 0;
  if (lives <= 0 || lives >= 6) return false;
  (state as any).__vestalCovenantUsed = true;
  state.lives = 12;
  state.hint = 'THE VESTALS INTERVENE — the sacred flame restores Rome to 12 lives. The covenant is spent.';
  return true;
}

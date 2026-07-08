// Enemy inspection panel (Enemy Doc §14.1).
// Click an enemy → see its identity, stats, resistances, weaknesses, recommended counter.

import { Enemy, EnemyFaction, DamageType } from '../types';
import enemiesData from '../data/enemies.json';
import factionRes from '../data/factionResistances.json';
import wavesData from '../data/waves.json';
import { tex } from './Assets';
import { resistanceSummary, armorProfile, armorDamageTypeShortLabel } from '../systems/EnemyResistances';
import { damageTypeLabel } from '../format';
import { closeGameModals } from './ModalManager';
import { pretty } from '../format';
import { previewSpawnHp } from '../systems/WaveManager';
import { markScrollable } from './ScrollCues';
import itemsData from '../data/items_permanent.json';
import { signatureLegendaryForBoss } from '../systems/LootSystem';

const FACTION_KEY: Record<number, string> = {
  [EnemyFaction.DOGS]: 'DOGS',
  [EnemyFaction.CELTS]: 'CELTS',
  [EnemyFaction.CARTHAGE]: 'CARTHAGE',
  [EnemyFaction.UNDEAD_CELTS]: 'UNDEAD_CELTS',
  [EnemyFaction.UNDEAD_CARTHAGE]: 'UNDEAD_CARTHAGE',
  [EnemyFaction.SUPER_DEMONS]: 'SUPER_DEMONS',
  // 2026-05 v10 — Endless factions, so the Mongol/Egyptian inspect
  // panel correctly reads its faction-resistance row.
  [EnemyFaction.MONGOLS]: 'MONGOLS',
  [EnemyFaction.EGYPTIANS]: 'EGYPTIANS'
};

// 2026-05 v6: ARCHETYPE_HINT removed along with the "Recommended Counter"
// section — players get raw data now, not strategy nudges. The archetype
// banner color still cues the role at a glance.

function fmtRes(v: number | 'IMMUNE'): { label: string; color: string } {
  // 2026-05-18 — Sign convention inverted to match player intuition
  // ("+" = positive defense, "−" = negative defense):
  //   • "+25%"  → enemy RESISTS this damage type (positive defense,
  //              player should avoid using it).  Color: blue.
  //   • "−25%"  → enemy is VULNERABLE to this type (less defense, takes
  //              extra damage). Color: gold/orange — player's answer.
  //   • IMMUNE  → no damage at all. Color: red.
  //   • normal  → full damage, no modifier. Color: grey.
  // The raw `v` value comes from factionResistances.json where:
  //   v > 0  means takes EXTRA damage (vulnerable) → shows "−X%"
  //   v < 0  means takes LESS damage   (resistant) → shows "+X%"
  if (v === 'IMMUNE') return { label: 'IMMUNE', color: '#aa3a3a' };
  if (v > 0.5)  return { label: '−' + Math.round(v * 100) + '%',          color: '#ffaa33' };
  if (v > 0.10) return { label: '−' + Math.round(v * 100) + '%',          color: '#ffd34d' };
  if (v < -0.10) return { label: '+' + Math.abs(Math.round(v * 100)) + '%', color: '#7896c8' };
  return { label: 'normal', color: '#888' };
}

export function showEnemyInspect(parent: HTMLElement, e: Enemy, hpWaveTag?: number) {
  closeGameModals();
  const def: any = (enemiesData as any)[e.type];
  const fk = FACTION_KEY[e.faction];
  const row: any = (factionRes as any)[fk] ?? {};
  const portrait = (() => {
    const t = tex(e.type);
    if (!t) return null;
    const res: any = t.baseTexture?.resource;
    return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
  })();

  const ARCHETYPE_COLOR: Record<string, string> = {
    SWARM: '#888', RUNNER: '#88dd88', ARMORED: '#b88a4a',
    RESISTANT: '#a078d0', BULKY: '#cc6644', ELITE: '#ffd34d', BOSS: '#ee2a2a'
  };
  const acColor = ARCHETYPE_COLOR[e.archetype];

  const modal = document.createElement('div');
  modal.id = 'enemy-inspect';
  // 2026-05 v6: z-index bumped 55 → 80 so the modal cleanly tops HUD
  // elements like the wave-preview chip (z:40) and prospect sidebar (z:75).
  // closeGameModals() already strips other modals, so a player clicking
  // a sprite to inspect always sees an unobstructed inspect dialog.
  // 2026-05-19 — Responsive clamping (Codex pattern). Modal scrolls
  // top-anchored; panel has no max-height so traits + abilities lists
  // are always reachable regardless of viewport height.
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.5);z-index:80;padding:16px 8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace;`;
  const panel = document.createElement('div');
  panel.style.cssText = `background:linear-gradient(180deg,#221912,#0c0a08);border:3px solid ${acColor};color:#e8d6a8;width:min(480px,96vw);`;

  const banner = document.createElement('div');
  banner.style.cssText = `background:${acColor};color:#1a1410;padding:6px 12px;font-weight:bold;letter-spacing:3px;display:flex;justify-content:space-between;align-items:center`;
  banner.innerHTML = `<span>${e.archetype}</span><span style="font-size:11px;opacity:0.7">${e.isFlyer ? 'FLYER' : 'GROUND'}${e.isBoss ? ' · BOSS' : ''}</span>`;
  panel.appendChild(banner);

  const head = document.createElement('div');
  head.style.cssText = 'display:grid;grid-template-columns:80px 1fr;gap:12px;padding:12px;border-bottom:1px solid #3a3025;background:#1a1410';
  head.innerHTML = `
    ${portrait
      ? `<div style="width:80px;height:80px;border:2px solid ${acColor};background:#0c0a08;display:flex;align-items:center;justify-content:center"><img src="${portrait}" style="width:72px;height:72px;image-rendering:pixelated"/></div>`
      : `<div style="width:80px;height:80px;border:2px solid ${acColor};background:#0c0a08"></div>`}
    <div>
      <div style="font-size:18px;font-weight:bold;color:${acColor};letter-spacing:2px">${def?.name ?? pretty(e.type)}</div>
      <div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-top:2px;text-transform:uppercase">${pretty(fk ?? '')} faction</div>
      <div style="margin-top:8px;display:flex;gap:14px;font-size:11px;flex-wrap:wrap">
        <span><span style="color:#aa9a4a;font-size:9px">HP${hpWaveTag ? ` @ W${hpWaveTag}` : ''}</span> <b>${Math.round(e.hp)}</b><span style="opacity:0.5">/${Math.round(e.maxHp)}</span></span>
        <span><span style="color:#aa9a4a;font-size:9px">SPEED</span> <b>${e.baseSpeed.toFixed(1)} t/s</b></span>
        <span><span style="color:#aa9a4a;font-size:9px">LEAK COST</span> <b style="color:#ee5555">${e.livesCost} ${e.livesCost === 1 ? 'life' : 'lives'}</b></span>
      </div>
    </div>`;
  panel.appendChild(head);

  // 2026-05-15 v9 ARMOR ROW — single, prominent line at the top of the
  // resistance section showing the COMBINED faction × per-enemy armor %
  // per damage type. This is the number that actually matters: it folds
  // both factors into one display so the player doesn't have to multiply
  // them in their head. Color-coded:
  //   • IMMUNE / very high armor (>=70%) — crimson (avoid this damage type)
  //   • medium armor (30-69%)            — orange (mediocre)
  //   • low armor (0-29%)                — gold/cream (acceptable)
  //   • vulnerable (<0%)                 — sky blue (preferred type)
  const armorRows = armorProfile(e.type);
  const armorCells = armorRows.map(r => {
    const label = armorDamageTypeShortLabel(r.damageType);
    let display: string;
    let color: string;
    // 2026-05-18 — Sign convention is the player's defense-stat read:
    //   "+"  = positive defense, enemy RESISTS this type (avoid)
    //   "−"  = less defense,     enemy is VULNERABLE to this type (use)
    // armorPct is positive when the enemy resists (damage reduction) and
    // negative when the enemy takes extra damage. We always display the
    // magnitude with the appropriate sign in front.
    if (r.immune) { display = 'IMMUNE'; color = '#ee2a2a'; }
    else if (r.armorPct >= 70) { display = `+${r.armorPct}% armor`; color = '#ff6b3a'; }
    else if (r.armorPct >= 30) { display = `+${r.armorPct}% armor`; color = '#ffaa55'; }
    else if (r.armorPct > 0)   { display = `+${r.armorPct}% armor`; color = '#ffd34d'; }
    else if (r.armorPct === 0) { display = 'no armor';             color = '#cdb98a'; }
    else                       { display = `−${Math.abs(r.armorPct)}% damage`; color = '#7896c8'; }
    return `<div style="background:#0c0a08;padding:8px 6px;text-align:center;font-size:11px">
      <div style="color:#aa9a4a;letter-spacing:1px;font-size:9px">${label}</div>
      <div style="color:${color};font-size:12px;font-weight:bold;margin-top:3px;letter-spacing:0.5px">${display}</div>
    </div>`;
  }).join('');
  const armorBlock = document.createElement('div');
  armorBlock.style.cssText = 'border-bottom:1px solid #3a3025';
  armorBlock.innerHTML = `
    <div style="padding:8px 12px 4px;font-size:9px;color:#ffd34d;letter-spacing:2px;background:#1a1208">🛡 ARMOR (faction × per-enemy combined)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:1px;background:#3a3025">${armorCells}</div>
  `;
  panel.appendChild(armorBlock);

  // Original per-damage-type faction-only breakdown kept beneath the
  // combined armor row so power players can see WHY the combined number
  // is what it is (faction baseline vs per-enemy-specific tightening).
  const types = ['PHYS_MELEE', 'PHYS_RANGED', 'SIEGE', 'ELEMENTAL_FIRE', 'DIVINE'];
  const resCells = types.map(t => {
    const v = row[t] ?? 0;
    const f = fmtRes(v);
    return `<div style="background:#0c0a08;padding:8px 6px;text-align:center;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;font-size:9px">${damageTypeLabel(t)}</div><div style="color:${f.color};font-size:12px;font-weight:bold;margin-top:3px">${f.label}</div></div>`;
  }).join('');
  const resGrid = document.createElement('div');
  resGrid.style.cssText = 'border-bottom:1px solid #3a3025';
  resGrid.innerHTML = `
    <div style="padding:8px 12px 4px;font-size:9px;color:#aa9a4a;letter-spacing:2px;background:#12100d">FACTION BASELINE</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:1px;background:#3a3025">${resCells}</div>
  `;
  panel.appendChild(resGrid);

  const specificRes = resistanceSummary(e.type);
  if (specificRes.length > 0) {
    const specBox = document.createElement('div');
    specBox.style.cssText = 'padding:10px 12px;border-bottom:1px solid #3a3025;background:#12100d';
    specBox.innerHTML = `<div style="font-size:9px;color:#aa9a4a;letter-spacing:1px;margin-bottom:6px">SPECIFIC RESISTANCES</div>` +
      specificRes.map(r => {
        const label = r.value <= 0 ? 'IMMUNE' : `${Math.round((1 - r.value) * 100)}% resisted`;
        const color = r.value <= 0 ? '#aa3a3a' : '#7896c8';
        return `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 6px;background:#0c0a08;border:1px solid #3a3025;color:${color};font-size:10px"><b>${r.label}</b> ${label}</span>`;
      }).join('');
    panel.appendChild(specBox);
  }

  // 2026-05-20 — FULL DAMAGE-OVER-TIME PROFILE. The SPECIFIC RESISTANCES
  // block above only lists rows where the enemy is resistant or immune,
  // so players had no way to tell whether a missing entry meant "full
  // damage" or "not implemented." This panel shows every DoT slot
  // (Slow / Stun / Freeze / Burn / Bleed / Poison) with explicit
  // status — Full / Resistant X% / IMMUNE — so the player can build a
  // complete picture at a glance. Also surfaces the boolean immune
  // flags from enemies.json (immunePoison / immuneFire / immuneFreeze /
  // immuneStun / immuneSlow) which the per-type multiplier can't carry.
  const fullProfile = (() => {
    const profile: Array<{ label: string; value: number; immune: boolean; note?: string }> = [];
    const dots: Array<{ label: string; field: string; flag?: string }> = [
      { label: 'Slow',   field: 'slow',   flag: 'immuneSlow' },
      { label: 'Stun',   field: 'stun',   flag: 'immuneStun' },
      { label: 'Freeze', field: 'freeze', flag: 'immuneFreeze' },
      { label: 'Burn',   field: 'burn',   flag: 'immuneFire' },
      { label: 'Bleed',  field: 'bleed' },
      { label: 'Poison', field: 'poison', flag: 'immunePoison' }
    ];
    const summaryMap = new Map(specificRes.map(r => [r.label, r.value]));
    for (const d of dots) {
      const flagSet = d.flag ? !!def?.[d.flag] : false;
      const v = summaryMap.get(d.label);
      const immune = flagSet || (typeof v === 'number' && v <= 0);
      const value = typeof v === 'number' ? v : 1;
      profile.push({ label: d.label, value, immune, note: flagSet ? 'data flag' : undefined });
    }
    return profile;
  })();
  const dotBox = document.createElement('div');
  dotBox.style.cssText = 'padding:10px 12px;border-bottom:1px solid #3a3025;background:#0e0c0a';
  const dotCellsHtml = fullProfile.map(p => {
    let status: string; let color: string;
    if (p.immune) { status = 'IMMUNE'; color = '#aa3a3a'; }
    else if (p.value < 1) { status = `${Math.round((1 - p.value) * 100)}% resist`; color = '#7896c8'; }
    else if (p.value > 1) { status = `+${Math.round((p.value - 1) * 100)}% extra`; color = '#ffd34d'; }
    else { status = 'full damage'; color = '#9c9'; }
    return `<div style="background:#0c0a08;padding:6px 6px;text-align:center;font-size:11px;border:1px solid #1f1c18">
      <div style="color:#aa9a4a;letter-spacing:1px;font-size:9px">${p.label.toUpperCase()}</div>
      <div style="color:${color};font-size:11px;font-weight:bold;margin-top:3px">${status}</div>
    </div>`;
  }).join('');
  dotBox.innerHTML = `
    <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px;margin-bottom:6px">DAMAGE-OVER-TIME PROFILE</div>
    <div style="display:grid;grid-template-columns:repeat(6, 1fr);gap:3px">${dotCellsHtml}</div>
    <div style="font-size:9px;color:#5a7a7a;margin-top:6px;line-height:1.4">Slow / Stun / Freeze are STATUS effects. Burn / Bleed / Poison are DAMAGE-OVER-TIME ticks. Full damage = no resist; +N% extra = vulnerable.</div>
  `;
  panel.appendChild(dotBox);

  // 2026-05 v6: greatly expanded trait/mechanic block. Every JSON flag
  // and boss-script behavior we run is documented here, with concrete
  // numbers (X%/sec, N tiles, M seconds) instead of raw field names.
  // No "recommended counter" — the player makes their own call from the
  // data shown. The traits are grouped by category so reading is fast.
  const traits: { label: string; color?: string }[] = [];
  // -- Combat / damage interaction --
  if (def?.meleeImmune) traits.push({ label: 'MELEE-IMMUNE — physical melee deals 0 damage', color: '#ee5555' });
  if (def?.requiresMeleeBreak) traits.push({ label: 'SHIELD — ranged & siege ignored until a melee tower cracks the shield', color: '#ee5555' });
  if (def?.shieldBlockChance) traits.push({ label: `SHIELD BLOCK — ${Math.round(def.shieldBlockChance*100)}% chance to fully block ranged/siege hits (until shield breaks)`, color: '#ee5555' });
  // 2026-05-24 audit fix — surface allAttackBlockChance on the inspect
  // panel so the player sees Undead Spearman / Iron Phalanx's all-type
  // deflect from the unit card, not just from the wave brief callout.
  // Mirrors Codex.ts trait line.
  if (def?.allAttackBlockChance) traits.push({ label: `ALL-ATTACK BLOCK — ${Math.round(def.allAttackBlockChance*100)}% chance per hit to deflect ANY incoming damage (melee, ranged, siege, fire, divine). Never expires, independent of shield state.`, color: '#ee5555' });
  if (def?.phaseHits) traits.push({ label: `PHASE — ignores the first ${def.phaseHits} hit${def.phaseHits === 1 ? '' : 's'} (MISS floater appears)`, color: '#ee5555' });
  if (def?.dodgeChance) traits.push({ label: `DODGE — ${Math.round(def.dodgeChance*100)}% chance to evade ranged & siege attacks (melee always lands)`, color: '#ff8866' });
  // -- Status immunities --
  if (def?.immuneSlow) traits.push({ label: 'IMMUNE TO SLOW' });
  if (def?.immuneFreeze) traits.push({ label: 'IMMUNE TO FREEZE' });
  if (def?.immuneStun) traits.push({ label: 'IMMUNE TO STUN' });
  if (def?.immunePoison) traits.push({ label: 'IMMUNE TO POISON' });
  // 2026-05-17 — fire immunity for undead types (bone bodies don't
  // smolder). Covers direct ELEMENTAL_FIRE damage AND the BURN DoT
  // tick. HELLFIRE divine-fire is separate unless a rare unit declares
  // immuneHellfire as an explicit exception.
  if (def?.immuneFire) traits.push({ label: def?.immuneHellfire ? 'IMMUNE TO FIRE + HELLFIRE — direct fire, BURN, and HELLFIRE all deal 0' : 'IMMUNE TO FIRE — direct fire damage and BURN DoT both deal 0 (HELLFIRE divine-fire still applies)', color: '#ee5555' });
  // -- Healing / regen --
  if (def?.regenPctPerSec) traits.push({ label: `REGEN — ${(def.regenPctPerSec*100).toFixed(2)}% maxHP/sec always-on (reduced 50% by any active DoT, was 100% block pre-2026-05-21)`, color: '#88ff88' });
  if (def?.outOfCombatRegen) traits.push({ label: `OUT-OF-COMBAT REGEN — ${(def.outOfCombatRegen*100).toFixed(1)}% maxHP/sec after 1.0s without DIRECT damage (DoT ticks no longer refresh the quiet-window; active DoT halves the regen rate to ~${(def.outOfCombatRegen*50).toFixed(2)}%/sec)`, color: '#88ff88' });
  if (def?.checkpointHealPct) traits.push({ label: `CHECKPOINT HEAL — restores ${Math.round(def.checkpointHealPct*100)}% maxHP the first time it crosses each of the 7 waypoint coins`, color: '#88ff88' });
  if (def?.healAllyPctPerSec) traits.push({ label: `HEALER — pulses ${(def.healAllyPctPerSec*100).toFixed(2)}% maxHP/sec to allies within 1.8 tiles (does NOT heal bosses, does NOT stack — multiple healers use the highest rate, not the sum)`, color: '#88ff88' });
  // -- Movement modifiers --
  if (def?.lowHpSpeedBoost) traits.push({ label: `LOW-HP SURGE — when below 30% HP, gains +${Math.round((def.lowHpSpeedBoost - 1) * 100)}% movement speed`, color: '#ff8866' });
  if (def?.stealthInterval) traits.push({ label: `STEALTH CYCLE — fades to untargetable for ${def.stealthInterval.duration.toFixed(1)}s every ${def.stealthInterval.period}s (visual: alpha drops, towers can't target)`, color: '#a078d0' });
  if (def?.ambushStealth) traits.push({ label: `AMBUSH STEALTH — untargetable for the first ${def.ambushStealthSec ?? 10}s of the wave (visual: alpha drops to 40%). After the window expires, every alive instance becomes targetable simultaneously. Spawns AFTER the window are visible from the start.`, color: '#a078d0' });
  if (def?.silenceAuraRadiusTiles) traits.push({ label: `SILENCE AURA — every tower within ${def.silenceAuraRadiusTiles} tiles is SILENCED while this enemy is in range. Refreshes each frame in range; expires ~0.6s after the enemy walks out. Pink X-mark icon over silenced towers. Plant power towers OFF the path to avoid the aura.`, color: '#a078d0' });
  // -- Tower disruption --
  if (def?.auraTowerSlow) traits.push({ label: `TOWER-SLOW AURA — every tower within ~2 tiles fires ${Math.round(def.auraTowerSlow*100)}% slower while this enemy is in range`, color: '#a078d0' });
  if (def?.auraNullifier) traits.push({ label: `AURA NULLIFIER — every tower within 2 tiles loses its aura contributions while this enemy is in range. Global damage / atk-speed / enemy-debuff / item auras (Centurion\'s Trumpet, Battle Standard, etc.) all silently drop out. Walks past → auras return. Periodic abilities (Caesar stun pulse, freeze cycles) are NOT auras and still fire.`, color: '#a078d0' });
  const sleepRange = typeof def?.sleepDartRangeTiles === 'number'
    ? def.sleepDartRangeTiles
    : (e.type === 'GALLIC_DRUID' || e.type === 'ZOMBIE_DRUID' ? 3 : 0);
  if (sleepRange > 0) {
    const sleepDuration = def?.sleepDartDurationSec ?? 3;
    const landNote = def?.sleepDartLandOnly ? ' Naga sleep magic only targets LAND towers — ocean towers are safe.' : '';
    traits.push({ label: `SLEEP CURSE — channels a slow cyan/purple dart at the nearest awake tower within ${sleepRange} tiles every ~${def?.sleepDartCooldownSec ?? 5}s. On hit, that tower is fully inert (no targeting, no shots) for ${sleepDuration} seconds — a Z animation floats over the sleeping tower.${landNote} STUN or FREEZE cancels the channel.`, color: '#a078d0' });
  }
  // 2026-05 v10 — WAR ELEPHANT RANGED-PROTECT AURA (also hardcoded).
  if (e.type === 'WAR_ELEPHANT' || e.type === 'UNDEAD_WAR_ELEPHANT') {
    traits.push({ label: 'DUST-SHIELD AURA — projects a 4-tile dust dome that makes every NEARBY GROUND enemy untargetable by ranged towers until the elephant dies. The elephant itself is still targetable (you have to be able to kill it). Melee towers ignore the dust and hit allies inside. Visual: dust-brown rotating dome around the elephant + small gold sparkle over each protected ally.', color: '#a078d0' });
  }
  // 2026-05 v10 — DEMON DIVINE VULNERABILITY. Final divine takes is ~3.0×
  // (1.50 per-enemy × 2.0 faction). Flag it explicitly so players know
  // the answer key for demon waves is divine, not generic damage stacking.
  const DEMON_TYPES = new Set(['DEMON_HELLHOUND','CELTIC_FIRE_DEMON','SHADOW_CAVALRY','DEMON_LEGATE','DAEMON_IMPERATOR']);
  if (DEMON_TYPES.has(e.type)) {
    // 2026-05-22 V36 — Daemon Imperator's per-enemy DIVINE mult dropped
    // 1.30 → 0.70 to halve the DIVINE answer-key. Other minion demons
    // still carry the 1.20 vulnerability from V25. Combined with the
    // faction's +100% divine row, the boss now takes 1.40× divine
    // (was 2.60×) — vulnerable but no auto-win.
    // 2026-05-24 — Split the label so Daemon Imperator reads as a
    // DAMPER (not a weakness) — its 0.70× per-enemy mult is the boss's
    // defensive trait, not a vulnerability. Lesser demons keep the
    // weakness framing.
    if (e.type === 'DAEMON_IMPERATOR') {
      traits.push({ label: "DIVINE PROFILE — per-enemy DIVINE 0.70 (damper) stacks with the SUPER_DEMONS faction +100% divine row → ~1.40× final divine taken. Less divine-vulnerable than lesser demons; lean on DoT-resistant builds + direct DPS.", color: '#ffd34d' });
    } else {
      traits.push({ label: "DIVINE WEAKNESS — per-enemy DIVINE 1.20 stacks with the SUPER_DEMONS faction +100% divine row → ~2.40× final divine taken. Solar Priest, Flamen, Augur, Haruspex are the dedicated demon counters.", color: '#ffd34d' });
    }
  }
  // -- Death / multiplication mechanics --
  if (def?.splitOnDeath) {
    const s = def.splitOnDeath;
    const childDef: any = (enemiesData as any)[s.type];
    const childName = childDef?.name ?? String(s.type).replace(/_/g, ' ');
    traits.push({ label: `SPLIT ON DEATH — spawns ${s.count} × ${childName} at ${Math.round((s.hpFraction ?? 0.4) * 100)}% HP at the death tile`, color: '#ff8866' });
  }
  if (def?.rebirthAtPct) traits.push({ label: `PHOENIX REBIRTH — on death, bursts into 3 minions of the same type at ${Math.round(def.rebirthAtPct*100)}% HP each (kill still counts; minions can't chain-phoenix)`, color: '#ffaa66' });
  if (def?.reanimateAs) {
    const reanimDef: any = (enemiesData as any)[def.reanimateAs];
    const reanimName = reanimDef?.name ?? String(def.reanimateAs).replace(/_/g, ' ');
    const alwaysReanim = def.faction === 'UNDEAD_CELTS' || def.faction === 'UNDEAD_CARTHAGE';
    // 2026-05-19 v2 — Necromancy is conceptually a caster ability, not
    // a property every grunt happens to carry. A player clicking a
    // Celtic Footman on W4 was confused to see "💤 DORMANT TRAIT" on
    // it — they correctly expect that trait to live on Druids, not on
    // foot soldiers who would merely be the VICTIMS of the necromancy
    // if it fired. The trait is now scoped to:
    //   • Druid-class units (reanimateAs === REANIMATED_LICH) — these
    //     are the magic-using enemies the player thinks of as casters.
    //   • Always-reanim undead-faction units (intrinsic to the faction).
    //   • Self-cycling magical undead (reanim target === own type, e.g.
    //     Mummy Warrior).
    // Non-caster grunts (Footman, Berserker, Spearman, Architectus) no
    // longer show the trait at all. The wave-brief explicitly tells the
    // player on W11/W13 that "every Celtic, Carthaginian, or Undead
    // grunt you kill" reanimates, so the global signal isn't lost.
    const isDruidClass = def.reanimateAs === 'REANIMATED_LICH';
    const isSelfReanim = def.reanimateAs === e.type;
    const showTrait = alwaysReanim || isDruidClass || isSelfReanim;
    if (!showTrait) {
      // Skip — foot-soldier types don't carry the necromancy label.
    } else {
      const NECRO_WAVES = new Set([11, 13]);
      const isActive = alwaysReanim || isSelfReanim || (hpWaveTag != null && NECRO_WAVES.has(hpWaveTag));
      if (alwaysReanim) {
        traits.push({ label: `NECROMANCY · ACTIVE — undead faction, every kill spawns 6-9 × ${reanimName} at 85-100% HP at the death tile (risen units can't chain).`, color: '#aa55ff' });
      } else if (isActive) {
        traits.push({ label: `NECROMANCY · ACTIVE THIS WAVE — every kill spawns 6-9 × ${reanimName} at 85-100% HP at the death tile (risen units can't chain).`, color: '#aa55ff' });
      } else {
        traits.push({ label: `💤 DORMANT TRAIT — Druid-class casters carry a latent necromancy curse that only fires on W11 + W13 (necromancy-flagged waves). Not active this wave. Would spawn 6-9 × ${reanimName} per kill when active. (Distinct from the Skeletal Uprising surprise event on W11 + W14.)`, color: '#7a5a8a' });
      }
    }
  }
  // -- Gold theft (Ghost Rider) --
  if (e.type === 'GHOST_RIDER') traits.push({ label: 'GOLD THEFT — on leak, steals 5g + floor(wave/10)g from your treasury', color: '#ffd34d' });
  // -- Boss script behaviors (per BossScripts.ts cases) --
  const bossScripts: Record<string, string[]> = {
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
      'IMMUNE TO SLOW & FREEZE (data flags)',
      'TUSK QUAKE — every 6s, silences every tower within 2 tiles for 0.6s (dust-brown ring + screen shake)',
      'DUST-SHIELD AURA — 4-tile dome protects nearby ground allies from ranged attacks while alive (see SPECIAL TRAITS above)',
      'HEAVY HIDE: higher HP, light sustain, and only +25% damage from SIEGE'
    ],
    UNDEAD_WAR_ELEPHANT: [
      'STAMPEDE at 50% HP (status-immune + 75% speed for 4s)',
      'REBIRTH at 40% HP — heals to 55% HP and summons 2 Ghost Riders',
      'IMMUNE TO SLOW & FREEZE',
      'TUSK QUAKE every 6s — silences nearby towers for 0.6s (25% stronger tower-slow aura than the living elephant)',
      'DUST-SHIELD AURA — 4-tile dome protects nearby ground allies from ranged attacks while alive',
      'DENSE BONE HIDE: higher HP and only +5% damage from SIEGE; fire still helps'
    ],
    HANNIBAL_BARCA: [
      'ELEPHANT HEAL — while any War Elephant is alive AND Hannibal hasn\'t been hit by DIRECT damage in 1.0s, heals 0.4% maxHP/sec (active DoT softens to 0.2%/sec, was 0%)',
      'OUT-OF-COMBAT REGEN — 1.7%/sec after 1.0s without DIRECT damage (active DoT softens to 0.85%/sec, was full block)',
      'TELEGRAPHED REBIRTH at 55% HP — 1-second red lock-on ring warning, then heals to 65% HP, status-immune, +60% speed for 10s, summons 2 War Elephants'
    ],
    UNDEAD_WARLORD: [
      'AMBUSH — 5s after spawn, 10 Undead Berserkers rise mid-path',
      'NECROMANCY at 40% HP — raises 6 Undead Celts at his position',
      'FINAL UPRISING at 15% HP — 5 more Undead Celts erupt at the Warlord',
      'DEATH RATTLE — on kill, 20 more undead rise (6 Berserkers + 14 Celts at 30% HP). Cannot chain-reanimate.',
      'MID-FIGHT REGEN — 1.0% maxHP/sec while alive (active DoT halves to 0.5%/sec; fire / burn the clean counter at 1.25× damage)',
      'W15 spawns FIVE Undead Warlords — every per-warlord effect multiplies'
    ],
    DAEMON_IMPERATOR: [
      'HELLSCAPE — every 12s, stuns the attack cooldown of every tower within ~5 tiles for 1.5s',
      'OUT-OF-COMBAT REGEN — 2.8% maxHP/sec while not taking DIRECT damage (active DoT halves to 1.4%/sec)',
      'DOT-RESISTANT — poison/bleed tick at 30% effectiveness, fire fully immune. Direct damage + DIVINE (~1.40× final after faction × per-enemy 0.70 damper) carry the fight, not chip ticks.',
      'W30 FINAL BOSS — Daemon breach ends the run; escorts use normal leak costs'
    ]
  };
  const signature = signatureLegendaryForBoss(e.type);
  const signatureName = signature ? ((itemsData as any)[signature]?.name ?? pretty(signature)) : null;
  const scriptLines = [
    ...(signatureName ? [`SIGNATURE LEGENDARY — drops ${signatureName} on kill. If already claimed, rotates to another unowned legendary.`] : []),
    ...(bossScripts[e.type] ?? [])
  ];
  if (traits.length > 0) {
    const tBox = document.createElement('div');
    tBox.style.cssText = 'padding:10px 12px;border-bottom:1px solid #3a3025;background:#1a0e08';
    tBox.innerHTML = `<div style="font-size:9px;color:#aa9a4a;letter-spacing:1px;margin-bottom:6px">SPECIAL TRAITS</div>` +
      traits.map(t => `<div style="color:${t.color ?? '#ff8866'};font-size:11px;font-weight:bold;line-height:1.45;margin-bottom:3px">⚠ ${t.label}</div>`).join('');
    panel.appendChild(tBox);
  }
  if (scriptLines.length > 0) {
    const bBox = document.createElement('div');
    bBox.style.cssText = 'padding:10px 12px;border-bottom:1px solid #3a3025;background:#1a0a0a';
    bBox.innerHTML = `<div style="font-size:9px;color:#ee5555;letter-spacing:2px;margin-bottom:6px">⚔ BOSS MECHANICS</div>` +
      scriptLines.map(t => `<div style="color:#ff8866;font-size:11px;font-weight:bold;line-height:1.45;margin-bottom:3px">▸ ${t}</div>`).join('');
    panel.appendChild(bBox);
  }

  // Active status effects (only meaningful when inspecting a LIVE enemy
  // from the field — preview-stubs have an empty statusEffects array).
  if (e.statusEffects.length > 0) {
    const sBox = document.createElement('div');
    sBox.style.cssText = 'padding:8px 12px;border-bottom:1px solid #3a3025';
    sBox.innerHTML = `<div style="font-size:9px;color:#aa9a4a;letter-spacing:1px;margin-bottom:4px">ACTIVE STATUS</div>` +
      e.statusEffects.map(s => `<span style="display:inline-block;margin-right:8px;color:#9be0ff;font-size:11px">${s.kind} (${s.remaining.toFixed(1)}s)</span>`).join('');
    panel.appendChild(sBox);
  }

  // Close
  const close = document.createElement('div');
  close.style.cssText = 'padding:10px;display:flex;justify-content:flex-end;background:#0c0a08';
  const cb = document.createElement('button');
  cb.textContent = 'CLOSE';
  cb.style.cssText = 'background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:6px 16px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px';
  cb.onclick = () => modal.remove();
  close.appendChild(cb);
  panel.appendChild(close);

  modal.appendChild(panel);
  parent.appendChild(modal);
  // Scroll cues on the MODAL (the actual scroll container after the
  // 2026-05-19 responsive-clamping refactor).
  markScrollable(modal);
}

// 2026-05 v6: type-driven wrapper for the wave-preview clickable sprites.
// Builds a minimal stub enemy with the fields showEnemyInspect actually
// reads, then delegates. Used in the bottom-left wave-preview chip so
// players can study upcoming enemies without waiting for them to spawn.
//
// 2026-05 v8 (HP-scaling fix): accept the upcoming wave number so the HP
// shown in the inspect modal matches the actual spawn HP — full wave
// scaling (hpMult × linear × per-5-wave doubling × bossSolo × late-game
// layer × basicBuff) applied via previewSpawnHp. Previously this stub
// showed raw baseHp, which made W15 Undead Warlord look like a 2k-HP
// pushover when he actually spawns at ~121k.
export function showEnemyInspectByType(parent: HTMLElement, type: string, forWave?: number) {
  const def: any = (enemiesData as any)[type];
  if (!def) return;
  // Resolve the wave context used for HP scaling. If a wave was passed in
  // (from the preview chip), use it. Otherwise look up the FIRST wave this
  // enemy is authored into so the displayed HP at least reflects a real
  // spawn rather than the raw data-file baseHp.
  let waveCtx: any = null;
  if (forWave && forWave >= 1 && forWave <= (wavesData as any[]).length) {
    waveCtx = (wavesData as any[])[forWave - 1];
  } else {
    for (const w of wavesData as any[]) {
      if (w.spawns?.some((s: any) => s.type === type)) {
        if (w.type === 'B' && !def.isBoss) continue;   // boss waves strip non-boss mobs
        waveCtx = w;
        break;
      }
    }
  }
  // 2026-05-19 — Read activeHeroId off globalThis.__game so the preview
  // matches the +15% hero-comp HP applied at spawn. Falls back to false
  // when the global isn't wired (test runners, isolated unit harnesses).
  const heroActive = !!(((globalThis as any).__game)?.activeHeroId);
  const scaledHp = waveCtx
    ? previewSpawnHp(def, waveCtx.wave, waveCtx.type, waveCtx.hpMult, heroActive)
    : def.baseHp;
  // ARCHETYPE map — kept in sync with EnemySystem.ts ARCHETYPE. Used here
  // only when the live enemy stub doesn't carry an archetype.
  const ARCH: Record<string, string> = {
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
    NAGA_ADEPT: 'ELITE', NAGA_SLEEPWEAVER: 'ELITE', NAGA_ORACLE: 'ELITE'
  };
  // EnemyFaction enum: DOGS=0, CELTS=1, CARTHAGE=2, UNDEAD_CELTS=3,
  // UNDEAD_CARTHAGE=4, SUPER_DEMONS=5. Resolve from string for the stub.
  const FACTION_ENUM: Record<string, number> = {
    DOGS: 0, CELTS: 1, CARTHAGE: 2, UNDEAD_CELTS: 3,
    UNDEAD_CARTHAGE: 4, SUPER_DEMONS: 5,
    // 2026-05 v10 — Endless factions. Keep in sync with EnemyFaction
    // enum order in types.ts.
    MONGOLS: 6, EGYPTIANS: 7
  };
  // Stub mirrors the fields showEnemyInspect actually reads off Enemy.
  // Missing fields like baseSpeed would silently throw inside the modal
  // builder and never render — found this the hard way. Keep the stub
  // exhaustive enough that the preview modal renders identically to a
  // live enemy click.
  const stub: any = {
    id: `__preview_${type}`,
    type,
    faction: FACTION_ENUM[def.faction] ?? 0,
    archetype: ARCH[type] ?? 'SWARM',
    hp: scaledHp,
    maxHp: scaledHp,
    baseSpeed: def.speed ?? 1.0,
    currentSpeed: def.speed ?? 1.0,
    isFlyer: !!def.isFlyer,
    isBoss: !!def.isBoss,
    statusEffects: [],
    mutation: null,
    livesCost: def.livesCost ?? 1,
    pathIndex: 0,
    pathProgress: 0,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    dirX: 1,
    dirY: 0,
    hpFlashTimer: 0,
    lastDamagedTick: 0,
    shieldBroken: false,
    isBonusBoss: false
  };
  showEnemyInspect(parent, stub, waveCtx?.wave);
}

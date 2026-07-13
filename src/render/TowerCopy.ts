type TowerDefinition = {
  name?: string;
  ability?: string;
  kind?: string;
  damageType?: string;
  melee?: boolean;
  omega?: boolean;
  waterOnly?: boolean;
  amphibious?: boolean;
  isHero?: boolean;
};

const MAX_MECHANICS_WORDS = 48;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function plainText(value: string): string {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, '. ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function sentenceScore(sentence: string, index: number): number {
  let score = index === 0 ? 2 : 0;
  if (/^[A-Z0-9][A-Z0-9 '&+/-]{2,}:/.test(sentence)) score += 5;
  if (/\d/.test(sentence)) score += 4;
  if (/damage|attack|target|splash|cleave|slow|stun|mark|shred|burn|poison|bleed|freeze|aura|heal|knock|summon|pierce|crit|flyer|boss|elite|giant|elephant/i.test(sentence)) score += 5;
  if (/holds? (three|four|\d)|item slot|becomes a|bearing the|transformation|ingredient/i.test(sentence)) score -= 6;
  return score;
}

export function towerMechanicsSummary(_type: string, def: TowerDefinition): string {
  const source = plainText(String(def.ability ?? ''));
  if (!source) return 'No special battlefield mechanic.';
  const sentences = source
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: sentenceScore(sentence, index) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: Array<{ sentence: string; index: number }> = [];
  let count = 0;
  for (const candidate of ranked) {
    const length = words(candidate.sentence).length;
    if (selected.length > 0 && count + length > MAX_MECHANICS_WORDS) continue;
    selected.push(candidate);
    count += length;
    if (count >= 34 || selected.length >= 3) break;
  }
  selected.sort((a, b) => a.index - b.index);
  let summary = selected.map(entry => entry.sentence).join(' ').trim();
  const summaryWords = words(summary);
  if (summaryWords.length > MAX_MECHANICS_WORDS) {
    summary = `${summaryWords.slice(0, MAX_MECHANICS_WORDS).join(' ').replace(/[,:;\-]+$/, '')}.`;
  }
  return summary;
}

function stableIndex(type: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = ((hash * 31) + type.charCodeAt(i)) >>> 0;
  return hash % size;
}

export function towerFlavorLine(type: string, def: TowerDefinition): string {
  let lines: string[];
  if (def.omega) {
    lines = [
      'The engineers lower their voices when this one wakes.',
      'Rome did not build this for an ordinary war.',
      'Some victories require a weapon that feels like a prophecy.'
    ];
  } else if (def.waterOnly || def.amphibious || def.kind === 'NAVAL') {
    lines = [
      'Salt, bronze, and old vows carry this weapon.',
      'The harbor keeps stranger answers than the Senate admits.',
      'Where the road meets the tide, this veteran takes command.'
    ];
  } else if (def.isHero) {
    lines = [
      'A famous name is useful only when the arrows begin.',
      'Rome remembers the title; the battlefield remembers the work.',
      'The banners rise because this commander has arrived.'
    ];
  } else if (def.kind === 'COMBO') {
    lines = [
      'Several Roman doctrines enter the forge; one answer leaves.',
      'The recipe is expensive because hesitation costs more.',
      'This is what happens when the legion stops thinking small.'
    ];
  } else if (def.damageType === 'SIEGE') {
    lines = [
      'Timber, iron, and patience settle the argument.',
      'The crew measures twice; the enemy receives the final number.',
      'Rome brought engineering to a sword fight.'
    ];
  } else if (def.damageType === 'DIVINE') {
    lines = [
      'The gods rarely explain themselves twice.',
      'Incense first, judgment shortly after.',
      'Even armor listens when the omen is clear.'
    ];
  } else if (def.melee) {
    lines = [
      'Rome solves this problem at shield distance.',
      'The formation holds until the other formation does not.',
      'Close enough for courage to become a weapon.'
    ];
  } else {
    lines = [
      'The legion prefers this argument settled at a distance.',
      'A clear sight line is worth a cohort of apologies.',
      'The first warning is usually already in flight.'
    ];
  }
  return lines[stableIndex(type, lines.length)];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char] ?? char));
}

export function towerBriefText(type: string, def: TowerDefinition): string {
  return `${towerFlavorLine(type, def)} ${towerMechanicsSummary(type, def)}`;
}

export function towerBriefHtml(type: string, def: TowerDefinition): string {
  const flavor = escapeHtml(towerFlavorLine(type, def));
  const mechanics = escapeHtml(towerMechanicsSummary(type, def));
  const full = escapeHtml(plainText(String(def.ability ?? '')));
  return `<span class="tower-field-note" title="${full}"><span style="color:#e6c982;font-style:italic">${flavor}</span><br><b style="color:#ffd34d;letter-spacing:1px">FIELD NOTE:</b> ${mechanics}</span>`;
}

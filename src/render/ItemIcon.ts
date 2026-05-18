// Procedurally-rendered item icons. Each item gets a unique-looking SVG glyph
// based on its family + rarity, so the player can read inventory contents at a
// glance without per-item bitmap art. (For final polish, swap these out for a
// Higgsfield sprite sheet — the glyph keys map cleanly to filenames.)

import { itemFamily, ItemFamily } from '../systems/ItemRules';
import { isConsumable } from '../systems/LootSystem';
import { tex } from './Assets';

const RARITY_HEX: Record<string, string> = {
  COMMON: '#cccccc',
  UNCOMMON: '#5cd05c',
  RARE: '#5ca0ff',
  EPIC: '#a060ff',           // 2026-05-18 — purple tier between RARE and LEGENDARY
  LEGENDARY: '#ff9933',
  UNIQUE: '#ffd34d'
};

// SVG path strings for each family glyph. Drawn on a 32×32 viewBox, centered.
const FAMILY_GLYPH: Record<ItemFamily | 'CONSUMABLE', string> = {
  // Sword pointing up
  DAMAGE: 'M16 4 L13 7 L13 22 L19 22 L19 7 Z M11 22 L21 22 L21 25 L11 25 Z M14 25 L18 25 L18 28 L14 28 Z',
  // Wing / feather
  SPEED: 'M5 18 Q10 8 18 6 Q22 8 24 14 Q21 12 17 13 Q21 16 23 21 Q18 19 14 21 Q19 23 21 27 Q14 24 9 25 Q12 22 8 22 Z',
  // Magnifier / scope lens
  RANGE: 'M13 14 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M19 19 L26 26',
  // Vial with bubbles — same glyph for all DoT sub-families (BURN/POISON/
  // BLEED). The hue-rotation hash per item-id gives each item a slightly
  // different tint so they don't all look identical in the inventory.
  DOT_BURN:   'M13 5 L19 5 L19 9 L21 9 L21 11 L19 11 L19 26 Q16 28 13 26 L13 11 L11 11 L11 9 L13 9 Z M14 14 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 M15 19 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0',
  DOT_POISON: 'M13 5 L19 5 L19 9 L21 9 L21 11 L19 11 L19 26 Q16 28 13 26 L13 11 L11 11 L11 9 L13 9 Z M14 14 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 M15 19 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0',
  DOT_BLEED:  'M13 5 L19 5 L19 9 L21 9 L21 11 L19 11 L19 26 Q16 28 13 26 L13 11 L11 11 L11 9 L13 9 Z M14 14 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 M15 19 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0',
  // Standard / banner
  AURA: 'M11 4 L21 4 L21 6 L23 6 L23 22 L18 22 L18 28 L14 28 L14 22 L9 22 L9 6 L11 6 Z M13 9 L19 9 L19 11 L13 11 Z M13 13 L19 13 L19 15 L13 15 Z',
  // Coin with star
  ECONOMY: 'M16 5 a11 11 0 1 0 0 22 a11 11 0 1 0 0 -22 M16 9 L17.5 13 L22 13 L18.3 15.5 L19.8 19.5 L16 17 L12.2 19.5 L13.7 15.5 L10 13 L14.5 13 Z',
  // Shield with cross
  DEFENSE: 'M16 4 L25 8 L25 16 Q25 23 16 28 Q7 23 7 16 L7 8 Z M15 11 L17 11 L17 16 L21 16 L21 18 L17 18 L17 22 L15 22 L15 18 L11 18 L11 16 L15 16 Z',
  // Star (crown / unique trophy)
  SPECIAL: 'M16 4 L19 13 L28 13 L21 18 L24 27 L16 22 L8 27 L11 18 L4 13 L13 13 Z',
  // Potion (consumable override)
  CONSUMABLE: 'M13 4 L19 4 L19 8 L20 9 L20 11 L23 16 Q23 26 16 28 Q9 26 9 16 L12 11 L12 9 L13 8 Z M14 6 L18 6 L18 8 L14 8 Z'
};

export function itemIconSvg(itemId: string, rarity: string, sizePx = 36): string {
  // Prefer the real sliced sprite (Higgsfield art) when available — it's mapped under
  // the ITEM_<ID> key in the Assets manifest. Wrap it in a rarity-colored frame so
  // the rarity tier still reads at a glance.
  const realTex = tex(`ITEM_${itemId}`);
  const realRes: any = realTex?.baseTexture?.resource;
  const realSrc = realRes?.src ?? realRes?.url ?? (realTex as any)?.__srcPath ?? null;
  const color = RARITY_HEX[rarity] ?? '#cccccc';
  if (realSrc) {
    return `
      <span style="position:relative;display:inline-block;width:${sizePx}px;height:${sizePx}px;background:linear-gradient(180deg,#1a1410,#0a0806);border:2px solid ${color};box-shadow:inset 0 0 6px #000;box-sizing:border-box">
        <img src="${realSrc}" alt="" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block"/>
      </span>
    `;
  }
  // Fallback: procedural SVG icon when no art is mapped for this item id.
  const familyKey = isConsumable(itemId) ? 'CONSUMABLE' : itemFamily(itemId) as ItemFamily;
  const glyph = FAMILY_GLYPH[familyKey] ?? FAMILY_GLYPH.SPECIAL;
  // Hash the item id into a small hue rotation per item so different items in the
  // same family don't look identical. Range ±20 degrees from base.
  const hash = simpleHash(itemId);
  const rot = (hash % 41) - 20; // -20..+20
  const accentColor = shiftHue(color, rot);
  // SVG: dark frame, rarity-colored corners, glyph in rarity color, item-specific corner pip.
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${sizePx}" height="${sizePx}" style="display:block;image-rendering:auto">
      <defs>
        <linearGradient id="bg-${itemId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#1a1410"/>
          <stop offset="1" stop-color="#0a0806"/>
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" fill="url(#bg-${itemId})" stroke="${color}" stroke-width="2"/>
      <rect x="3" y="3" width="26" height="26" fill="none" stroke="${accentColor}" stroke-width="0.5" opacity="0.55"/>
      <path d="${glyph}" fill="${color}" stroke="${accentColor}" stroke-width="0.4" stroke-linejoin="round"/>
      <!-- per-item pip in upper-left corner so identical-family items still differ -->
      <circle cx="${4 + (hash % 4)}" cy="${4 + ((hash >> 2) % 4)}" r="1" fill="${accentColor}"/>
      <circle cx="${28 - (hash % 4)}" cy="${4 + ((hash >> 4) % 4)}" r="0.8" fill="${accentColor}" opacity="0.6"/>
    </svg>
  `;
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function shiftHue(hex: string, deg: number): string {
  // Crude HSL hue rotation for the accent color.
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (max === min) h = 0;
  else if (max === r) h = ((g - b) / (max - min)) * 60;
  else if (max === g) h = (((b - r) / (max - min)) + 2) * 60;
  else h = (((r - g) / (max - min)) + 4) * 60;
  h = (h + deg + 360) % 360;
  // back to RGB
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  let rr = 0, gg = 0, bb = 0;
  if (h < 60)      { rr = c; gg = x; bb = 0; }
  else if (h < 120) { rr = x; gg = c; bb = 0; }
  else if (h < 180) { rr = 0; gg = c; bb = x; }
  else if (h < 240) { rr = 0; gg = x; bb = c; }
  else if (h < 300) { rr = x; gg = 0; bb = c; }
  else              { rr = c; gg = 0; bb = x; }
  const tx = (n: number) => Math.round((n + mm) * 255).toString(16).padStart(2, '0');
  return `#${tx(rr)}${tx(gg)}${tx(bb)}`;
}

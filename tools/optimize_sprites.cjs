// V27 — One-time sprite optimization pass. Downsamples PNGs that are
// far larger than their max rendered size, then re-encodes everything
// at max PNG compression with palette mode where applicable.
//
// CONSERVATIVE TARGETS (source = 4× max-render so retina/zoom is safe):
//   heroes/hero_card_*.png       → fit within 768px
//   heroes/hero_<name>.png       → fit within 256px (renders at 64px tower)
//   sprites/m_dark_cave.png      → fit within 256px (renders at 112px)
//   sprites/m_roman_gate*.png    → fit within 256px (renders at 100px)
//   sprites/m_grass_*.png        → fit within 96px  (renders at 32px tile)
//   sprites/m_*.png (biome)      → fit within 96px
//   sprites/tt_*.png             → already 64×64, skip resize
//   sprites/t_*.png (towers)     → fit within 256px (renders at 48-64px)
//   sprites/e1/e2/e3_*.png (enemies) → fit within 192px (renders at 32-48px)
//   sprites/i_*.png + inew_*.png + l_*.png + c_*.png (items) → fit within 128px
//   sprites/w_wp*.png (waypoint emblems) → fit within 128px (renders at 30px)
//   sprites/ab_*.png + ar_*.png (ability icons) → fit within 128px
//   sprites/mb_*.png (modifier icons) → fit within 128px
//   sprites/eb_*.png (banners) → fit within 256px
//   sprites/mu_*.png (modifiers) → fit within 128px
//   sprites/bp_*.png (banners) → fit within 256px
//   sprites/cb_*.png (combat banners) → keep larger, banners read at high res
//   sprites/wx_*.png (weather/wave fx) → fit within 192px
//   sprites/dp_*.png + dbr_*.png (decoration props) → fit within 96px (render at 32px)
//   sprites/u_*.png (UI badges) → fit within 128px
//   sprites/s_*.png (status icons) → fit within 96px
//   sprites/map_overhaul/m_*.png — case-by-case
//   sprites/*.png (everything else) → re-encode without resize
//
// All sharp resizes use LANCZOS3 (default) which is sharper than bicubic
// and preserves edges. PNG output uses compressionLevel: 9 + adaptive
// filtering. Palette mode is auto-applied where the colour count fits
// (sharp's `palette: true` falls back to truecolor automatically).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function targetSizeFor(filePath) {
  const base = path.basename(filePath);
  const dir  = path.relative('public/assets', path.dirname(filePath)).replace(/\\/g, '/');

  // Heroes folder
  if (dir === 'heroes' && /^hero_card_/.test(base))  return 768;
  if (dir === 'heroes' && /^hero_/.test(base))       return 256;

  // Sprites folder — specific patterns
  if (dir === 'sprites' && /^m_dark_cave/.test(base)) return 256;
  if (dir === 'sprites' && /^m_roman_gate/.test(base)) return 256;
  if (dir === 'sprites' && /^m_grass_|^m_blood_grass/.test(base)) return 96;
  if (dir === 'sprites' && /^m_/.test(base))         return 128;
  if (dir === 'sprites' && /^tt_/.test(base))        return null;   // already small
  if (dir === 'sprites' && /^t[0-9]?_|^t_new_/.test(base)) return 256;
  if (dir === 'sprites' && /^e[0-9]?_/.test(base))   return 192;
  if (dir === 'sprites' && /^(i_|inew_|l_|c_)/.test(base)) return 128;
  if (dir === 'sprites' && /^w_wp/.test(base))       return 128;
  if (dir === 'sprites' && /^(ab_|ar_|mu_)/.test(base)) return 128;
  if (dir === 'sprites' && /^mb_/.test(base))        return 128;
  if (dir === 'sprites' && /^(eb_|bp_)/.test(base))  return 256;
  if (dir === 'sprites' && /^cb_/.test(base))        return 256;
  if (dir === 'sprites' && /^wx_/.test(base))        return 192;
  if (dir === 'sprites' && /^(dp_|dbr_)/.test(base)) return 96;
  if (dir === 'sprites' && /^u_/.test(base))         return 128;
  if (dir === 'sprites' && /^s_/.test(base))         return 96;
  if (dir.startsWith('sprites/map_overhaul') && /m_aura_/.test(base)) return 96;     // aura medallions
  if (dir.startsWith('sprites/map_overhaul') && /m_necro_/.test(base)) return 192;   // necro Roman ruins
  if (dir.startsWith('sprites/map_overhaul') && /m_shrine_/.test(base)) return 128;
  if (dir.startsWith('sprites/map_overhaul') && /^m_undead_/.test(base)) return 96;  // undead decor
  if (dir.startsWith('sprites/map_overhaul') && /^m_cave_/.test(base)) return 256;
  if (dir.startsWith('sprites/map_overhaul')) return 128;             // default for map_overhaul

  return null;   // no resize — just re-encode
}

async function optimizeFile(file) {
  const sizeBefore = fs.statSync(file).size;
  let img = sharp(file);
  const meta = await img.metadata();
  const target = targetSizeFor(file);
  if (target && (meta.width > target || meta.height > target)) {
    // Resize so the LARGER dimension hits `target`; keep aspect ratio.
    img = img.resize(target, target, { fit: 'inside', kernel: 'lanczos3' });
  }
  const buf = await img.png({
    compressionLevel: 9,
    adaptiveFiltering: true,
    palette: true              // sharp auto-falls-back to truecolor if too many colors
  }).toBuffer();
  // Only write back if smaller — sometimes already-optimized PNGs grow
  // when re-encoded.
  if (buf.length < sizeBefore) {
    fs.writeFileSync(file, buf);
    return { file, before: sizeBefore, after: buf.length };
  }
  return { file, before: sizeBefore, after: sizeBefore, skipped: true };
}

async function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, out);
    else if (ent.name.endsWith('.png')) out.push(p);
  }
  return out;
}

(async () => {
  const all = await walk('public/assets');
  console.log('Optimizing ' + all.length + ' PNGs...');
  let totalBefore = 0, totalAfter = 0, savedFiles = 0;
  const top = [];
  for (const f of all) {
    const r = await optimizeFile(f);
    totalBefore += r.before;
    totalAfter += r.after;
    if (!r.skipped && r.after < r.before * 0.7) {
      top.push({ ...r, saved: r.before - r.after });
      savedFiles++;
    }
  }
  top.sort((a, b) => b.saved - a.saved);
  console.log('\nTop 15 wins:');
  for (const r of top.slice(0, 15)) {
    const beforeKB = (r.before / 1024).toFixed(0);
    const afterKB = (r.after / 1024).toFixed(0);
    const pct = ((1 - r.after / r.before) * 100).toFixed(0);
    console.log('  ' + beforeKB.padStart(5) + ' → ' + afterKB.padStart(4) + ' KB  -' + pct.padStart(2) + '%  ' + r.file);
  }
  console.log('\n=== TOTAL ===');
  console.log('Before: ' + (totalBefore / 1024 / 1024).toFixed(1) + ' MB');
  console.log('After:  ' + (totalAfter / 1024 / 1024).toFixed(1) + ' MB');
  console.log('Saved:  ' + ((totalBefore - totalAfter) / 1024 / 1024).toFixed(1) + ' MB (' + ((1 - totalAfter / totalBefore) * 100).toFixed(0) + '%)');
  console.log('Files improved >30%: ' + savedFiles);
})();

// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle map prototype (CIRCLE-2, solo render harness)
//
// First in-engine view of the shared circular map. Renders the CircleMap
// geometry (single square-spiral to a center life pool, colored by the 4
// pair-segments) with Pixi so JB can see and react to the real map before
// we wire creeps + towers onto it. Geometry only for now; no combat yet.
// Reachable from the Legion lobby ("GREEN CIRCLE" button).
// ─────────────────────────────────────────────────────────────────────

import { Application } from 'pixi.js';
import { generateCircleMap } from './CircleMap';
import { renderCircleMap } from './CircleRenderer';

const OVERLAY_ID = 'legion-overlay';
const TILE = 18;

export async function startCircleSolo(): Promise<void> {
  document.getElementById(OVERLAY_ID)?.remove();
  const g = generateCircleMap();
  const W = g.size * TILE;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 42%,#16210f,#070a05 85%);' +
    "font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;display:flex;flex-direction:column";

  const top = document.createElement('div');
  top.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:8px 16px;flex-wrap:wrap';
  top.innerHTML =
    '<div style="font-size:15px;font-weight:900;letter-spacing:2px;color:#88ff88;text-shadow:0 0 8px #000">🟢 GREEN CIRCLE — MAP PROTOTYPE</div>' +
    '<div style="font-size:10px;color:#cdb98a">single shared spiral · 4 pairs defend their color · leaks keep spiralling to the next pair · gold center = shared life pool</div>' +
    '<div style="flex:1"></div>' +
    '<button id="cs-leave" style="background:#3a1810;color:#ff8080;border:2px solid #7a2a2a;border-radius:6px;padding:8px 18px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px">◀ LEAVE</button>';

  const host = document.createElement('div');
  host.style.cssText = 'flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;position:relative';
  overlay.append(top, host);
  document.body.appendChild(overlay);

  const app = new Application({ width: W, height: W, backgroundColor: 0x0c1208, antialias: false, autoStart: false });
  const canvas = app.view as HTMLCanvasElement;
  canvas.style.imageRendering = 'pixelated';
  host.appendChild(canvas);

  // Draw the circular map in Roman TD's art (grass, cobblestone spiral, 4
  // corner caves, Rome center, biome tint, faint pair-color territories).
  renderCircleMap(app.stage, g, TILE, 1);

  app.render();

  function fit(): void {
    const availW = window.innerWidth - 32;
    const availH = window.innerHeight - top.offsetHeight - 24;
    const s = Math.max(0.3, Math.min(availW / W, availH / W, 1.4));
    canvas.style.width = Math.round(W * s) + 'px';
    canvas.style.height = Math.round(W * s) + 'px';
  }
  fit();
  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  (overlay.querySelector('#cs-leave') as HTMLElement).onclick = () => {
    window.removeEventListener('resize', onResize);
    try { (app.view as HTMLCanvasElement)?.remove(); } catch { /* ignore */ }
    try { app.destroy(true); } catch { /* ignore */ }
    overlay.remove();
  };

  // expose for tooling/iteration
  (window as any).__circleSolo = { app, geometry: g };
}

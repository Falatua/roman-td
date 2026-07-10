import { markScrollable } from './ScrollCues';

type ModalAction = 'collapse' | 'move' | 'close';

export interface ModalErgonomicsOptions {
  bodySelector?: string;
  footerSelector?: string;
  collapseButtonId?: string;
  moveButtonId?: string;
  closeButton?: boolean;
  closeButtonId?: string;
  closeOnEscape?: boolean;
  onEscape?: () => void;
  onClose?: () => void;
  storageKey?: string;
  rememberCollapsed?: boolean;
  title?: string;
  toolRightPx?: number;
}

const STYLE_ID = 'rtd-modal-ergonomics-style';
const COLLAPSIBLE_ATTR = 'data-rtd-collapsible';

export function ensureModalErgonomicsStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
    .rtd-modal-panel {
      position: relative;
      max-height: min(88vh, 820px);
      max-width: calc(100vw - 16px);
    }
    .rtd-modal-panel.rtd-modal-tools-reserved:not(.is-rtd-collapsed) {
      padding-top: max(var(--rtd-panel-padding-top, 0px), var(--rtd-modal-tools-reserve-top, 54px)) !important;
    }
    .rtd-modal-tools {
      position: absolute;
      right: 8px;
      top: 8px;
      z-index: 8;
      display: flex;
      gap: 6px;
      align-items: center;
      pointer-events: auto;
    }
    .rtd-modal-tool {
      width: 34px;
      height: 34px;
      padding: 0;
      display: inline-grid;
      place-items: center;
      background: linear-gradient(180deg,#2a1a0e,#0c0a08);
      color: #ffd34d;
      border: 2px solid #7a5a1a;
      box-shadow: 0 0 8px rgba(0,0,0,0.45);
      cursor: pointer;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      line-height: 1;
      font-weight: 900;
      text-align: center;
      touch-action: none;
    }
    .rtd-modal-tool:hover { filter: brightness(1.18); border-color: #ffd34d; }
    .rtd-modal-tool:focus-visible { outline: 3px solid #88ddff; outline-offset: 2px; }
    .rtd-modal-panel.is-rtd-collapsed {
      width: min(360px, 84vw) !important;
      max-height: none !important;
      overflow: visible !important;
    }
    .rtd-modal-panel.is-rtd-collapsed.is-rtd-summary-collapse::before {
      content: attr(data-rtd-collapse-title);
      display: block;
      min-height: 28px;
      padding: 8px var(--rtd-modal-tools-reserve-right, 132px) 8px 10px;
      color: #ffd34d;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.25;
      font-weight: 900;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .rtd-modal-panel.is-rtd-collapsed [data-rtd-collapsible="true"] {
      display: none !important;
    }
    .rtd-modal-panel.is-rtd-dragging {
      user-select: none;
      cursor: grabbing;
    }
    @media (max-width: 760px) {
      .rtd-modal-tools { right: 6px; top: 6px; }
      .rtd-modal-tool { width: 34px; height: 34px; }
      .rtd-modal-panel {
        max-height: calc(100vh - 14px);
      }
    }
  `;
  document.head.appendChild(st);
}

function setCollapsed(panel: HTMLElement, collapseBtn: HTMLButtonElement | null, collapsed: boolean, storageKey?: string): void {
  panel.classList.toggle('is-rtd-collapsed', collapsed);
  const keepsVisibleContent = Array.from(panel.children).some(el => (
    el instanceof HTMLElement
    && !el.classList.contains('rtd-modal-tools')
    && el.getAttribute(COLLAPSIBLE_ATTR) !== 'true'
  ));
  panel.classList.toggle('is-rtd-summary-collapse', collapsed && !keepsVisibleContent);
  if (collapseBtn) {
    collapseBtn.textContent = collapsed ? '▸' : '▾';
    collapseBtn.title = collapsed ? 'Expand this panel' : 'Collapse this panel so the map is easier to see';
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  if (storageKey) {
    try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }
}

function collapseTargetsFor(panel: HTMLElement, selectors: Array<string | undefined>): HTMLElement[] {
  const targets: HTMLElement[] = [];
  for (const selector of selectors) {
    if (!selector) continue;
    panel.querySelectorAll<HTMLElement>(selector).forEach(el => {
      if (!targets.includes(el)) targets.push(el);
    });
  }
  if (targets.length > 0) return targets;

  const directChildren = Array.from(panel.children)
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter(el => !el.classList.contains('rtd-modal-tools'));

  if (directChildren.length > 1) return directChildren.slice(1);
  return directChildren;
}

export function makePanelDraggable(root: HTMLElement, panel: HTMLElement, handle: HTMLElement): void {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const clampToViewport = () => {
    if (panel.style.position !== 'fixed') return;
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    const nextLeft = Math.max(8, Math.min(maxLeft, rect.left));
    const nextTop = Math.max(8, Math.min(maxTop, rect.top));
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
  };

  const begin = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement | null;
    if (target !== handle && target?.closest('button,input,select,textarea,a')) return;
    ev.preventDefault();
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
    panel.style.position = 'fixed';
    dragging = true;
    startX = ev.clientX;
    startY = ev.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    panel.classList.add('is-rtd-dragging');
    try { handle.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
  };

  const move = (ev: PointerEvent) => {
    if (!dragging) return;
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    const nextLeft = Math.max(8, Math.min(maxLeft, startLeft + ev.clientX - startX));
    const nextTop = Math.max(8, Math.min(maxTop, startTop + ev.clientY - startY));
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
  };

  const end = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('is-rtd-dragging');
    try { handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
  };

  handle.addEventListener('pointerdown', begin);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  window.addEventListener('resize', clampToViewport);
  window.addEventListener('rtd:viewport-change', clampToViewport as EventListener);
  root.addEventListener('rtd:modal-force-close', () => {
    dragging = false;
    panel.classList.remove('is-rtd-dragging');
    window.removeEventListener('resize', clampToViewport);
    window.removeEventListener('rtd:viewport-change', clampToViewport as EventListener);
  });
}

export function enhanceModalErgonomics(root: HTMLElement, panel: HTMLElement, opts: ModalErgonomicsOptions = {}): void {
  ensureModalErgonomicsStyle();
  panel.classList.add('rtd-modal-panel');
  panel.setAttribute('role', panel.getAttribute('role') ?? 'dialog');
  panel.setAttribute('aria-modal', panel.getAttribute('aria-modal') ?? 'true');
  panel.tabIndex = panel.tabIndex >= 0 ? panel.tabIndex : -1;
  if (opts.title) panel.setAttribute('aria-label', opts.title);
  panel.setAttribute('data-rtd-collapse-title', opts.title ?? panel.getAttribute('aria-label') ?? 'Panel');

  const collapsibles = collapseTargetsFor(panel, [opts.bodySelector, opts.footerSelector]);
  collapsibles.forEach(el => el.setAttribute(COLLAPSIBLE_ATTR, 'true'));
  collapsibles.forEach(el => {
    markScrollable(el);
  });

  const tools = document.createElement('div');
  tools.className = 'rtd-modal-tools';
  tools.setAttribute('aria-label', 'Panel controls');
  if (opts.toolRightPx != null) tools.style.right = `${opts.toolRightPx}px`;

  const actions: ModalAction[] = [];
  if (collapsibles.length > 0) actions.push('collapse');
  actions.push('move');
  if (opts.closeButton !== false) actions.push('close');
  const currentPaddingTop = getComputedStyle(panel).paddingTop || '0px';
  const toolRight = opts.toolRightPx ?? 8;
  const toolRowWidth = actions.length * 34 + Math.max(0, actions.length - 1) * 6;
  panel.style.setProperty('--rtd-panel-padding-top', currentPaddingTop);
  panel.style.setProperty('--rtd-modal-tools-reserve-top', '54px');
  panel.style.setProperty('--rtd-modal-tools-reserve-right', `${toolRight + toolRowWidth + 12}px`);
  panel.classList.add('rtd-modal-tools-reserved');

  const requestClose = () => {
    root.dispatchEvent(new CustomEvent('rtd:modal-force-close'));
    if (opts.onClose) opts.onClose();
    else root.remove();
  };

  let collapseBtn: HTMLButtonElement | null = null;
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rtd-modal-tool';
    if (action === 'collapse') {
      btn.id = opts.collapseButtonId ?? '';
      btn.textContent = '▾';
      btn.title = 'Collapse this panel so the map is easier to see';
      btn.setAttribute('aria-label', 'Collapse this panel');
      btn.setAttribute('aria-expanded', 'true');
      collapseBtn = btn;
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        setCollapsed(panel, collapseBtn, !panel.classList.contains('is-rtd-collapsed'), opts.storageKey);
      });
    } else if (action === 'move') {
      btn.id = opts.moveButtonId ?? '';
      btn.textContent = '↔';
      btn.title = 'Drag this handle to move the panel';
      btn.setAttribute('aria-label', 'Move this panel');
      makePanelDraggable(root, panel, btn);
    } else if (action === 'close') {
      btn.id = opts.closeButtonId ?? '';
      btn.textContent = 'X';
      btn.title = 'Close this panel';
      btn.setAttribute('aria-label', 'Close this panel');
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        requestClose();
      });
    }
    tools.appendChild(btn);
  }
  panel.appendChild(tools);

  const startCollapsed = opts.storageKey ? (() => {
    if (opts.rememberCollapsed === false) return false;
    try { return localStorage.getItem(opts.storageKey) === '1'; } catch { return false; }
  })() : false;
  if (collapsibles.length > 0) setCollapsed(panel, collapseBtn, startCollapsed, opts.storageKey);

  if (opts.closeOnEscape) {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      if (opts.onEscape) opts.onEscape();
      else requestClose();
      document.removeEventListener('keydown', onKey);
    };
    document.addEventListener('keydown', onKey);
    root.addEventListener('rtd:modal-force-close', () => document.removeEventListener('keydown', onKey), { once: true });
  }
}

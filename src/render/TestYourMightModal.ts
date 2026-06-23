import { GameStateShape } from '../GameState';
import { closeGameModals } from './ModalManager';
import { SFX } from './AudioManager';
import { declineTestYourMight, startTestYourMight, TEST_YOUR_MIGHT_REWARD_GOLD } from '../systems/TestYourMightSystem';

export function showTestYourMightModal(
  parent: HTMLElement,
  state: GameStateShape,
  onResolve: (accepted: boolean) => void
): void {
  if (state.lives <= 0 || state.gameOverAt >= 0) return;
  closeGameModals();
  (state as any).__testYourMightOpen = true;

  const modal = document.createElement('div');
  modal.id = 'test-your-might-modal';
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at center,rgba(120,0,0,0.42),rgba(0,0,0,0.82));z-index:82;padding:16px 8px;box-sizing:border-box;font-family:'Courier New',monospace;`;
  modal.addEventListener('rtd:modal-force-close', () => {
    (state as any).__testYourMightOpen = false;
  });

  const panel = document.createElement('div');
  panel.style.cssText = `width:min(760px,94vw);background:linear-gradient(180deg,#3b0b08,#120706 58%,#070504);border:4px solid #ffcc44;color:#f3dfaa;box-shadow:0 0 44px rgba(255,40,20,0.62), inset 0 0 24px rgba(255,204,68,0.12);padding:24px;text-align:center;`;
  panel.innerHTML = `
    <div style="font-size:11px;font-weight:bold;letter-spacing:6px;color:#ffcc44;text-shadow:1px 1px 0 #000">BONUS WAVE UNLOCKED</div>
    <div style="font-size:34px;font-weight:bold;letter-spacing:5px;color:#fff2b8;text-shadow:3px 3px 0 #000,0 0 18px rgba(255,80,40,0.8);margin-top:8px">TEST YOUR MIGHT</div>
    <div style="font-size:13px;color:#ffd0a0;line-height:1.55;margin:12px auto 0;max-width:610px;letter-spacing:1px">
      The arena door creaks open. A clerk whispers, "This is optional," which is exactly how traps talk.
    </div>
    <div style="margin:16px auto 0;display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:650px;text-align:left">
      <div style="background:rgba(0,0,0,0.42);border:2px solid #88ff88;padding:12px">
        <div style="font-size:10px;letter-spacing:3px;color:#88ff88;font-weight:bold;margin-bottom:6px">PERFECT CLEAR</div>
        <div style="font-size:13px;color:#ddffdd;line-height:1.45">Gain <b style="color:#ffcc44">${TEST_YOUR_MIGHT_REWARD_GOLD.toLocaleString()} gold</b>. The accountants faint. You continue to wave 11 with pockets full of poor decisions.</div>
      </div>
      <div style="background:rgba(0,0,0,0.42);border:2px solid #ff6655;padding:12px">
        <div style="font-size:10px;letter-spacing:3px;color:#ff6655;font-weight:bold;margin-bottom:6px">ONE LEAK</div>
        <div style="font-size:13px;color:#ffd0d0;line-height:1.45"><b>Instant defeat.</b> Not "minus lives." Not "we can talk about it." One enemy reaches Rome and the run is over.</div>
      </div>
    </div>
    <div style="margin:14px auto 0;max-width:620px;font-size:11px;color:#cdb98a;line-height:1.5;letter-spacing:1px">
      Expect bosses, flyers, ground swarms, commanders, and weather nonsense. This wave is rude on purpose.
    </div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:20px">
      <button id="tym-accept" style="font-family:inherit;background:#7a120c;border:3px solid #ffcc44;color:#fff2b8;padding:12px 18px;cursor:pointer;font-size:13px;font-weight:bold;letter-spacing:3px;box-shadow:0 0 18px rgba(255,204,68,0.35)">YES, TEST ME</button>
      <button id="tym-decline" style="font-family:inherit;background:#14100c;border:2px solid #5a4a30;color:#cdb98a;padding:12px 18px;cursor:pointer;font-size:13px;font-weight:bold;letter-spacing:3px">NO, I LIKE LIVING</button>
    </div>
  `;
  modal.appendChild(panel);

  const close = () => {
    modal.remove();
    (state as any).__testYourMightOpen = false;
  };

  const accept = panel.querySelector('#tym-accept') as HTMLButtonElement | null;
  if (accept) {
    accept.onclick = () => {
      close();
      SFX.bossArrival();
      startTestYourMight(state);
      onResolve(true);
    };
  }
  const decline = panel.querySelector('#tym-decline') as HTMLButtonElement | null;
  if (decline) {
    decline.onclick = () => {
      declineTestYourMight(state);
      close();
      SFX.prospectKeep();
      onResolve(false);
    };
  }

  parent.appendChild(modal);
}

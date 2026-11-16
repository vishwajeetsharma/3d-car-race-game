// Keyboard + touch. Read `input` each frame.
export const input = { left: false, right: false, brake: false, drift: false, boost: false };

const kb = { ...input }, tp = { ...input };
const sync = () => { for (const k in input) input[k] = kb[k] || tp[k]; };

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'brake', KeyS: 'brake', Space: 'drift', ShiftLeft: 'boost', ShiftRight: 'boost',
};

// Keep receiving a finger's events even if it slides off the control.
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } };

export function initInput(onKey) {
  addEventListener('keydown', (e) => {
    const k = KEYS[e.code];
    if (k) { kb[k] = true; sync(); e.preventDefault(); } else if (!e.repeat) onKey(e.code);
  });
  addEventListener('keyup', (e) => {
    const k = KEYS[e.code];
    if (k) { kb[k] = false; sync(); }
  });
  addEventListener('blur', () => { for (const k in kb) kb[k] = tp[k] = false; sync(); });
  addEventListener('contextmenu', (e) => e.preventDefault());

  // Steering pad: one element, left half / right half, so a thumb can slide across.
  const pad = document.getElementById('steer');
  const [lEl, rEl] = pad.children;
  const ptrs = new Map();
  const side = (e) => {
    const r = pad.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'left' : 'right';
  };
  const apply = () => {
    const v = [...ptrs.values()];
    tp.left = v.includes('left'); tp.right = v.includes('right');
    lEl.classList.toggle('on', tp.left); rEl.classList.toggle('on', tp.right);
    sync();
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capture(pad, e);
    ptrs.set(e.pointerId, side(e)); apply();
  });
  pad.addEventListener('pointermove', (e) => {
    if (ptrs.has(e.pointerId)) { ptrs.set(e.pointerId, side(e)); apply(); }
  });
  for (const t of ['pointerup', 'pointercancel']) {
    pad.addEventListener(t, (e) => { ptrs.delete(e.pointerId); apply(); });
  }

  // Hold buttons.
  for (const [id, k] of [['tDrift', 'drift'], ['tBoost', 'boost']]) {
    const el = document.getElementById(id);
    const set = (v) => (e) => {
      e.preventDefault();
      if (v) capture(el, e);
      tp[k] = v; el.classList.toggle('on', v); sync();
    };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointercancel', set(false));
  }
}

// Synthesised sound: an engine tone that climbs through gears, plus wind/boost noise.
let ctx, master, o1, o2, filt, eng, wind, muted = false;

export function start() {
  if (ctx) { ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);

  filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  eng = ctx.createGain();
  eng.gain.value = 0;
  filt.connect(eng); eng.connect(master);
  o1 = ctx.createOscillator(); o1.type = 'sawtooth';
  o2 = ctx.createOscillator(); o2.type = 'square';
  const g2 = ctx.createGain(); g2.gain.value = 0.4;
  o1.connect(filt); o2.connect(g2); g2.connect(filt);
  o1.start(); o2.start();

  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
  wind = ctx.createGain(); wind.gain.value = 0;
  src.connect(bp); bp.connect(wind); wind.connect(master);
  src.start();
}

export function engine(v, top, boosting, drifting, on) {
  if (!ctx) return;
  const t = ctx.currentTime, span = (top * 1.05) / 7;
  const gear = Math.min(6, Math.floor(v / span));
  const rpm = Math.min(1.4, (v - gear * span) / span);
  const f = 68 + gear * 13 + rpm * 185;
  o1.frequency.setTargetAtTime(f, t, 0.04);
  o2.frequency.setTargetAtTime(f / 2, t, 0.04);
  filt.frequency.setTargetAtTime(500 + rpm * 1700 + (boosting ? 1300 : 0), t, 0.05);
  eng.gain.setTargetAtTime(on ? 0.1 : 0, t, 0.1);
  wind.gain.setTargetAtTime(on ? (boosting ? 0.32 : drifting ? 0.2 : (v / top) * 0.05) : 0, t, 0.08);
}

export function beep(freq, dur = 0.14) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur);
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.6;
  return muted;
}

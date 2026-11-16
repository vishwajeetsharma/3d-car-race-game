// Game loop, state (menu -> countdown -> race -> finish) and HUD.
import * as THREE from 'three';
import { LENGTH, ZONE_NAMES, zoneBlend } from './track.js';
import { CARS, RIVALS, Car, stepPlayer, stepAI } from './cars.js';
import { buildWorld, makeEnv } from './scenery.js';
import { input, initInput } from './input.js';
import { Puffs } from './fx.js';
import { updateCamera } from './camera.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);
const touch = matchMedia('(pointer: coarse)').matches;

// --- renderer --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.15, 1400);
const env = makeEnv(renderer);
const world = buildWorld(scene, renderer, env, touch);
const puffs = new Puffs(scene);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- cars --------------------------------------------------------------------
const player = new Car(scene, CARS[0], env);
const rivals = RIVALS.map((def, i) => {
  const c = new Car(scene, def, env);
  c.top = 86.5 - i * 1.6;               // the front of the grid is the quickest
  c.lane = [-4.4, 4.4, -1.5, 1.5, 0][i];
  c.phase = i * 1.7;
  return c;
});

function resetGrid() {
  rivals.forEach((c, i) => c.reset(-8 - i * 8, i % 2 ? 2.6 : -2.6));
  player.reset(-48, 0); // sixth and last, mid-track so the menu camera can circle it
}

// --- state -------------------------------------------------------------------
let state = 'menu', view = 'tpp', time = 0, raceT = 0, countT = 0, countN = 0, zoneShown = -1, smoke = 0;
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const rank = () => 1 + rivals.filter((r) => r.s > player.s).length;
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const show = (ids, on) => ids.forEach((id) => { $(id).hidden = !on; });

function toMenu() {
  state = 'menu';
  resetGrid();
  show(['menu', 'title'], true);
  show(['hud', 'finish'], false);
}

function startRace() {
  audio.start();
  resetGrid();
  state = 'count'; countT = 3; countN = 4; raceT = 0; zoneShown = -1;
  show(['menu', 'title', 'finish'], false);
  show(['hud'], true);
}

function finishRace() {
  state = 'finish';
  const pos = rank();
  $('fPos').textContent = ORD[pos - 1];
  $('fMsg').textContent = pos === 1 ? 'VICTORY' : pos <= 3 ? 'PODIUM' : 'FINISHED';
  $('fTime').textContent = fmt(raceT);
  show(['hud'], false);
  document.body.classList.remove('boosting');
  setTimeout(() => { if (state === 'finish') show(['finish'], true); }, 1400);
}

function setView(v) {
  view = v;
  for (const b of $('views').children) b.classList.toggle('on', b.dataset.v === v);
}

// --- menu ----------------------------------------------------------------------
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const STATS = [['SPEED', (c) => (c.top - 76) / 16], ['ACCEL', (c) => c.accel / 1.15], ['GRIP', (c) => c.grip / 1.25], ['BOOST', (c) => c.boost / 1.35]];
$('stats').innerHTML = STATS.map(([n]) => `<span>${n}</span><div class="bar"><i></i></div>`).join('');
const statBars = $('stats').querySelectorAll('i');

function pickCar(i) {
  [...$('cars').children].forEach((b, k) => b.classList.toggle('on', k === i));
  STATS.forEach(([, fn], k) => { statBars[k].style.width = `${Math.round(fn(CARS[i]) * 100)}%`; });
  if (player.def !== CARS[i]) player.setDef(CARS[i]);
}
CARS.forEach((c, i) => {
  const b = document.createElement('button');
  b.innerHTML = `<i style="background:linear-gradient(115deg,${hex(c.paint)} 62%,${hex(c.accent)} 62%)"></i><b>${c.name}</b><span>${c.tag}</span>`;
  b.onclick = () => pickCar(i);
  $('cars').append(b);
});

$('views').onclick = (e) => { if (e.target.dataset.v) setView(e.target.dataset.v); };
$('start').onclick = $('again').onclick = startRace;
$('change').onclick = toMenu;
$('camBtn').onclick = () => setView(view === 'tpp' ? 'fpp' : 'tpp');
$('muteBtn').onclick = () => { $('muteBtn').style.opacity = audio.toggleMute() ? 0.45 : 1; };
initInput((code) => {
  if (code === 'KeyC') setView(view === 'tpp' ? 'fpp' : 'tpp');
  else if (code === 'KeyM') $('muteBtn').onclick();
  else if (code === 'Enter' && (state === 'menu' || state === 'finish')) startRace();
});

// --- per-frame pieces ------------------------------------------------------------
function countdown(dt) {
  countT -= dt;
  const n = Math.ceil(countT);
  if (n === countN) return;
  countN = n;
  $('count').textContent = n > 0 ? n : 'GO!';
  audio.beep(n > 0 ? 440 : 880, n > 0 ? 0.14 : 0.45);
  if (n <= 0) {
    state = 'race';
    setTimeout(() => { $('count').textContent = ''; }, 800);
  }
}

// Push cars apart: sideways for a side-swipe, otherwise the car behind is held up.
function collide() {
  for (const r of rivals) {
    const ds = r.s - player.s, dl = r.lat - player.lat;
    const ps = 4.9 - Math.abs(ds), pl = 1.95 - Math.abs(dl);
    if (ps <= 0 || pl <= 0) continue;
    if (pl < ps * 0.5) player.lat -= Math.sign(dl || 1) * pl;
    else if (ds > 0) { player.s = r.s - 4.9; player.v = Math.min(player.v, r.v * 0.92); }
    else { r.s = player.s - 4.9; r.v = Math.min(r.v, player.v * 0.95); }
  }
}

const P = new THREE.Vector3();
function effects(dt) {
  const g = player.model.group;
  g.updateMatrixWorld();
  const vx = player.v * 0.85 * Math.sin(-g.rotation.y), vz = -player.v * 0.85; // puffs trail just behind the car
  if (player.drifting) {
    for (smoke += dt * 60; smoke > 1; smoke--) {
      P.set(Math.random() < 0.5 ? -0.84 : 0.84, 0.15, 1.9).applyMatrix4(g.matrixWorld);
      puffs.emit(P.x, P.y, P.z, vx + Math.random() - 0.5, 1 + Math.random() * 1.5, vz + Math.random() * 6, 0.55, 0.3, 0.3, 0.32);
    }
  }
  if (player.scrape && player.v > 15) {
    P.set(Math.sign(player.lat) * 1.05, 0.35, Math.random() * 3 - 1.5).applyMatrix4(g.matrixWorld);
    puffs.emit(P.x, P.y, P.z, vx, 1 + Math.random() * 3, vz + Math.random() * 10, 0.3, 1.6, 0.7, 0.15);
  }
  puffs.update(dt);
}

const hudCache = {};
function setText(id, v) {
  if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; }
}
function updateHud() {
  setText('spd', Math.round(player.v * 3.6));
  setText('pos', rank());
  setText('time', fmt(raceT));
  $('prog').style.width = `${Math.min(100, Math.max(0, player.s / LENGTH) * 100).toFixed(1)}%`;
  $('boost').style.width = `${(player.boost * 100).toFixed(0)}%`;
  $('boostBar').classList.toggle('ready', player.boost > 0.12 || player.boosting);
  document.body.classList.toggle('boosting', player.boosting);

  const [i, j, t] = zoneBlend(player.s), z = t > 0.5 ? j : i;
  if (z !== zoneShown) {
    zoneShown = z;
    setText('zone', ZONE_NAMES[z]);
    setText('toast', ZONE_NAMES[z]);
    $('toast').classList.add('show');
    setTimeout(() => $('toast').classList.remove('show'), 2200);
  }
}

// Drop resolution a notch if the device can't hold a decent frame rate.
let fpsT = 0, fpsN = 0;
function adaptQuality(raw) {
  if (raw > 0.25) return; // tab was in the background
  fpsT += raw; fpsN++;
  if (fpsT < 2) return;
  if (fpsN / fpsT < 42 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.35);
    renderer.setPixelRatio(pixelRatio);
  }
  fpsT = fpsN = 0;
}

function tick(dt) {
  time += dt;
  if (state === 'count') countdown(dt);
  const racing = state === 'race';
  if (racing) raceT += dt;

  stepPlayer(player, input, dt, racing);
  for (const r of rivals) stepAI(r, player, dt, racing || state === 'finish');
  if (state !== 'menu') collide();
  player.sync(dt);
  for (const r of rivals) r.sync(dt);
  effects(dt);
  if (racing && player.s >= LENGTH) finishRace();

  const driving = state === 'race' || state === 'count';
  const mode = driving ? view : 'orbit';
  updateCamera(camera, player, mode, dt, time);
  world.update(player.s, player.model.group.position, camera, dt, time, !driving);
  if (driving) updateHud();
  audio.engine(player.v, player.def.top, player.boosting, player.drifting, state !== 'menu');
  renderer.render(scene, camera);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  last = now;
  adaptQuality(raw);
  tick(Math.min(0.05, raw));
}

pickCar(0);
toMenu();
$('load').remove();
requestAnimationFrame(frame);

if (import.meta.env.DEV) window.game = { player, rivals, camera, renderer, scene, input, tick, get state() { return state; } };

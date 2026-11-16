// Formula cars: procedural model, the four player cars, player physics and rival AI.
import * as THREE from 'three';
import { part, merge, box } from './geo.js';
import { LENGTH, KERB_HALF, WALL, cx, cy, dcx, dcy, curv, clamp } from './track.js';

export const CARS = [
  { name: 'KAZE R1', tag: 'Balanced', paint: 0xd8102a, accent: 0xf4f4f4, helmet: 0xffd400, top: 86, accel: 1.0, grip: 1.0, boost: 1.0 },
  { name: 'RAIJIN X', tag: 'Top speed', paint: 0x0b3dd9, accent: 0xffd400, helmet: 0xf4f4f4, top: 91, accel: 0.85, grip: 0.9, boost: 0.9 },
  { name: 'SAKURA S', tag: 'Grip', paint: 0xff5fa2, accent: 0x17171c, helmet: 0xf4f4f4, top: 83, accel: 1.1, grip: 1.22, boost: 1.0 },
  { name: 'ONI V', tag: 'Boost', paint: 0x15151a, accent: 0xff7a00, helmet: 0xff7a00, top: 84, accel: 1.0, grip: 0.95, boost: 1.32 },
];

export const RIVALS = [
  { paint: 0x00a79d, accent: 0xf2f2f2, helmet: 0xf2f2f2 },
  { paint: 0x6b2dff, accent: 0xc8ccd4, helmet: 0xffd400 },
  { paint: 0xf4f4f6, accent: 0x1f9d3a, helmet: 0x1f9d3a },
  { paint: 0xff9d00, accent: 0x0b3dd9, helmet: 0x0b3dd9 },
  { paint: 0x7a8794, accent: 0xd8102a, helmet: 0xd8102a },
];

const CARBON = 0x15161a, TYRE = 0x0b0b0d, DARK = 0x050506;
const SPHERE = new THREE.SphereGeometry(1, 18, 12);
// Side profile of the body (radius, distance along the car), spun into a fuselage.
const BODY = new THREE.LatheGeometry(
  [[0, -2.3], [0.2, -2.26], [0.33, -1.7], [0.42, -0.8], [0.43, -0.1], [0.37, 0.5], [0.27, 1.25], [0.17, 2.0], [0.09, 2.5], [0, 2.58]]
    .map(([r, y]) => new THREE.Vector2(r, y)), 20);

let MATS;
function mats(envMap) {
  return (MATS ??= {
    paint: new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.1, envMap, envMapIntensity: 0.5 }),
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.65, envMap, envMapIntensity: 0.5 }),
    light: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.25, 0.15) }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.55, 0.12), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  });
}
const FLAME = new THREE.ConeGeometry(0.15, 1.0, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);

function wheelGeo(r, w, accent) {
  const lie = [0, 0, Math.PI / 2];
  return merge([
    part(new THREE.CylinderGeometry(r, r, w, 22), TYRE, [0, 0, 0], lie),
    part(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 14), 0x2b2d33, [0, 0, 0], lie),
    part(box(w + 0.04, r * 0.2, r * 1.1), 0x9a9da6),
    part(box(w + 0.04, r * 1.1, r * 0.2), 0x9a9da6),
    part(new THREE.TorusGeometry(r * 0.8, 0.014, 5, 22), accent, [w / 2 + 0.002, 0, 0], [0, Math.PI / 2, 0]),
    part(new THREE.TorusGeometry(r * 0.8, 0.014, 5, 22), accent, [-w / 2 - 0.002, 0, 0], [0, Math.PI / 2, 0]),
  ]);
}

// The car faces -Z; origin is on the ground between the axles.
function buildCar(def, envMap) {
  const { paint, accent } = def, m = mats(envMap);
  const P = [], M = []; // glossy parts, matte parts
  const both = (fn) => { fn(-1); fn(1); };

  P.push(part(BODY, paint, [0, 0.44, 0], [-Math.PI / 2, 0, 0], [1, 1, 0.7]));
  P.push(part(SPHERE, paint, [0, 0.64, 0.85], [0, 0, 0], [0.26, 0.36, 1.3]));   // engine cover
  P.push(part(SPHERE, accent, [0, 0.7, 0.85], [0, 0, 0], [0.1, 0.36, 1.24]));  // centre stripe
  P.push(part(box(0.03, 0.34, 1.0), accent, [0, 0.92, 1.5]));                  // shark fin
  M.push(part(SPHERE, DARK, [0, 0.9, -0.04], [0, 0, 0], [0.12, 0.1, 0.12]));   // air intake
  M.push(part(SPHERE, DARK, [0, 0.66, -0.3], [0, 0, 0], [0.25, 0.1, 0.48]));   // cockpit
  M.push(part(box(1.56, 0.05, 3.2), CARBON, [0, 0.1, 0.25]));                  // floor
  M.push(part(box(0.6, 0.05, 1.2), CARBON, [0, 0.1, -1.6]));

  // halo
  M.push(part(new THREE.TorusGeometry(0.31, 0.035, 8, 20, Math.PI), CARBON, [0, 0.87, -0.05], [-Math.PI / 2, 0, 0], [1, 1.5, 1]));
  M.push(part(box(0.04, 0.3, 0.04), CARBON, [0, 0.745, -0.567], [0.4, 0, 0]));

  both((s) => {
    P.push(part(SPHERE, paint, [s * 0.56, 0.33, 0.5], [0, 0, 0], [0.3, 0.17, 1.05]));    // sidepod
    P.push(part(SPHERE, accent, [s * 0.62, 0.26, 0.5], [0, 0, 0], [0.27, 0.09, 0.95]));
    M.push(part(SPHERE, DARK, [s * 0.56, 0.35, -0.42], [0, 0, 0], [0.18, 0.1, 0.12]));
    M.push(part(box(0.05, 0.05, 0.46), CARBON, [s * 0.305, 0.785, 0.15], [0.4, 0, 0])); // halo leg
    // front wing
    P.push(part(box(0.78, 0.03, 0.24), paint, [s * 0.56, 0.21, -2.36], [-0.3, 0, 0]));
    P.push(part(box(0.03, 0.24, 0.5), paint, [s * 0.96, 0.22, -2.45]));
    M.push(part(box(0.03, 0.22, 0.22), CARBON, [s * 0.09, 0.26, -2.42]));
    // rear wing end plates, mirrors, suspension
    P.push(part(box(0.035, 0.62, 0.62), paint, [s * 0.52, 0.84, 2.2]));
    P.push(part(box(0.16, 0.07, 0.06), accent, [s * 0.5, 0.74, -0.62]));
    M.push(part(box(0.2, 0.02, 0.03), CARBON, [s * 0.38, 0.72, -0.62]));
    for (const z of [-1.9, -1.6, 1.5, 1.8]) M.push(part(box(0.62, 0.025, 0.05), CARBON, [s * 0.5, 0.36, z]));
  });
  P.push(part(box(1.92, 0.035, 0.4), accent, [0, 0.13, -2.5]));                 // front wing
  P.push(part(box(1.02, 0.045, 0.36), accent, [0, 0.98, 2.14], [-0.12, 0, 0])); // rear wing
  P.push(part(box(1.02, 0.035, 0.2), paint, [0, 1.1, 2.36], [-0.45, 0, 0]));
  M.push(part(box(1.0, 0.03, 0.2), CARBON, [0, 0.5, 2.3]));
  M.push(part(box(0.05, 0.5, 0.22), CARBON, [0, 0.72, 2.12]));

  P.push(part(new THREE.SphereGeometry(0.15, 16, 12), def.helmet ?? accent, [0, 0.74, -0.2]));
  M.push(part(box(0.22, 0.06, 0.12), DARK, [0, 0.76, -0.3])); // visor

  const group = new THREE.Group();
  const add = (geo, mat, parent = group) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  add(merge(P), m.paint);
  add(merge(M), m.matte);

  add(box(0.14, 0.1, 0.04), m.light).position.set(0, 0.4, 2.32);
  const flame = add(FLAME, m.flame);
  flame.castShadow = false;
  flame.position.set(0, 0.42, 2.3);

  const wheels = [], pivots = [];
  const front = wheelGeo(0.34, 0.36, accent), rear = wheelGeo(0.36, 0.44, accent);
  for (const [x, y, z, geo, steers] of [[-0.83, 0.34, -1.75, front, 1], [0.83, 0.34, -1.75, front, 1], [-0.84, 0.36, 1.65, rear, 0], [0.84, 0.36, 1.65, rear, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    group.add(pivot);
    wheels.push(add(geo, m.matte, pivot));
    if (steers) pivots.push(pivot);
  }
  return { group, wheels, pivots, flame };
}

export class Car {
  constructor(scene, def, envMap) {
    this.scene = scene; this.envMap = envMap;
    this.setDef(def);
    this.reset(0, 0);
  }

  setDef(def) {
    if (this.model) {
      this.scene.remove(this.model.group);
      this.model.group.traverse((o) => { if (o.geometry && o.geometry !== FLAME) o.geometry.dispose(); });
    }
    this.def = def;
    this.model = buildCar(def, this.envMap);
    this.scene.add(this.model.group);
    if (this.s !== undefined) this.sync(0);
  }

  reset(s, lat) {
    Object.assign(this, { s, lat, v: 0, steer: 0, yaw: 0, roll: 0, boost: 0.5, boosting: false, drifting: false, boostK: 0, spin: 0, scrape: false });
    this.sync(0);
  }

  // Move the 3D model to match the simulated state.
  sync(dt) {
    const { group, wheels, pivots, flame } = this.model, s = this.s;
    group.position.set(cx(s) + this.lat, cy(s), -s);
    group.rotation.set(Math.atan(dcy(s)), -Math.atan(dcx(s)) - this.yaw, this.roll, 'YXZ');
    this.spin -= (this.v * dt) / 0.35;
    for (const w of wheels) w.rotation.x = this.spin;
    for (const p of pivots) p.rotation.y = -this.steer * 0.3;
    this.boostK += ((this.boosting ? 1 : 0) - this.boostK) * Math.min(1, dt * 6);
    flame.visible = this.boostK > 0.03;
    flame.scale.set(1, 1, this.boostK * (0.8 + Math.random() * 0.5));
  }
}

// Arcade handling: the car is tracked as (distance, lateral offset, speed).
// Bends push it outward, steering pulls it back; drifting gives more bite and fills the boost meter.
export function stepPlayer(c, inp, dt, racing) {
  const d = c.def;
  const want = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  c.steer += (want - c.steer) * Math.min(1, dt * (want ? 5 : 8));
  const offRoad = Math.abs(c.lat) > KERB_HALF + 0.4;

  c.drifting = racing && inp.drift && Math.abs(c.steer) > 0.25 && c.v > 22 && !offRoad;
  if (c.boosting) c.boosting = racing && inp.boost && c.boost > 0;
  else if (racing && inp.boost && c.boost > 0.12) c.boosting = true;
  if (c.boosting) c.boost = Math.max(0, c.boost - dt / 3.2);
  else if (racing) c.boost = Math.min(1, c.boost + dt * (0.02 + (c.drifting ? 0.3 * d.boost * Math.abs(c.steer) : 0)));

  let vmax = d.top * (c.boosting ? 1.28 : 1) * (c.drifting ? 0.95 : 1) * (offRoad ? 0.5 : 1);
  if (!racing) vmax = 0;
  if (inp.brake || !racing) c.v = Math.max(0, c.v - 55 * dt);
  else if (c.v < vmax) c.v += 30 * d.accel * (c.boosting ? 2.4 : 1) * (1.06 - c.v / vmax) * dt;
  else c.v -= (c.v - vmax) * 1.6 * dt;

  const k = Math.min(1, c.v / 25);
  const latV = c.steer * (8 + 0.07 * c.v) * d.grip * (c.drifting ? 1.5 : 1) * k - curv(c.s) * c.v * c.v * 0.3;
  c.lat += latV * dt;
  const lim = WALL - 1.15;
  c.scrape = Math.abs(c.lat) > lim;
  if (c.scrape) {
    c.lat = Math.sign(c.lat) * lim;
    c.v *= 1 - Math.min(1, 1.2 * dt);
  }
  c.s += (c.v * dt) / Math.hypot(1, dcx(c.s));

  const yaw = c.steer * (c.drifting ? 0.55 : 0.07) * k;
  c.yaw += (yaw - c.yaw) * Math.min(1, dt * (c.drifting ? 4 : 6));
  c.roll = c.steer * 0.03 * k;
}

// Rivals hold a lane, weave a little, and are gently rubber-banded to the player.
export function stepAI(c, player, dt, go) {
  const band = 1 + clamp((player.s - c.s) / 150, -1, 1) * 0.05;
  const vmax = go && c.s < LENGTH + 260 ? c.top * band : 0;
  if (vmax > 0 && c.v < vmax) c.v += 30 * (1.06 - c.v / vmax) * dt;
  else c.v = Math.max(vmax, c.v - (vmax > 0 ? (c.v - vmax) * 1.6 : 40) * dt);

  const prev = c.lat;
  c.lat += (c.lane + 0.6 * Math.sin(c.s / 90 + c.phase) - c.lat) * Math.min(1, dt * 0.8);
  c.steer = clamp(((c.lat - prev) / Math.max(dt, 1e-3)) * 0.3 + curv(c.s) * 60, -1, 1);
  c.s += (c.v * dt) / Math.hypot(1, dcx(c.s));
}

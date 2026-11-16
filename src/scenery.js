// The world: road, terrain, barriers, grandstands + crowd, per-zone props, sky and lights.
// Everything is built once at load in 120 m chunks; chunks out of range are simply hidden.
import * as THREE from 'three';
import { part, merge, box, rng, canvasTex } from './geo.js';
import { Petals } from './fx.js';
import { LENGTH, ZONE_LEN, KERB_HALF, WALL, cx, cy, dcx, dcy, terrainH, zoneBlend, smooth } from './track.js';

const CHUNK = 120, STEP = 4, ROWS = CHUNK / STEP;
const S_MIN = -600, S_MAX = LENGTH + 720;
const col = (h) => new THREE.Color(h);
const WHITE = col(0xffffff);

// Sky, fog and light for each zone; blended as the player crosses between zones.
const LOOK = [
  { top: 0x1a1f52, hor: 0xe98d6b, sun: 0xffa76a, sunI: 2.8, sky: 0x9a8cf0, gnd: 0x4a3a58, hemI: 2.1, fogN: 140, fogF: 800, dir: [-0.32, 0.17, -0.93], cloud: 0xffb39c },
  { top: 0x2f7fd8, hor: 0xcfe6f5, sun: 0xfff2d8, sunI: 3.0, sky: 0xbfe0ff, gnd: 0x4a6a3a, hemI: 1.3, fogN: 120, fogF: 720, dir: [0.45, 0.75, -0.35], cloud: 0xffffff },
  { top: 0x1f5fc0, hor: 0xbcd6ee, sun: 0xffffff, sunI: 3.2, sky: 0xcfe2ff, gnd: 0x5a5f66, hemI: 1.2, fogN: 180, fogF: 900, dir: [-0.5, 0.65, 0.2], cloud: 0xffffff },
  { top: 0x3f8fd0, hor: 0xf3d7a6, sun: 0xffe2b0, sunI: 3.3, sky: 0xffe9c4, gnd: 0xb08a50, hemI: 1.3, fogN: 90, fogF: 680, dir: [0.3, 0.5, -0.8], cloud: 0xfff0d8 },
].map((z) => ({ ...z, top: col(z.top), hor: col(z.hor), sun: col(z.sun), sky: col(z.sky), gnd: col(z.gnd), cloud: col(z.cloud), dir: new THREE.Vector3(...z.dir).normalize() }));

// One-off landmarks along the route.
const FEATURES = [
  { s: 0, type: 'gantry', label: 'START' },
  { s: LENGTH, type: 'gantry', label: 'FINISH' },
  { s: 900, type: 'tower', off: -230 },
  { s: ZONE_LEN + 60, type: 'torii' }, { s: ZONE_LEN + 700, type: 'torii' }, { s: ZONE_LEN + 1330, type: 'torii' },
  { s: ZONE_LEN * 2 + 980, type: 'torii' },
  { s: ZONE_LEN + 420, type: 'pagoda', off: 48 }, { s: ZONE_LEN + 1100, type: 'pagoda', off: -52 },
  { s: ZONE_LEN * 2 + 420, type: 'pagoda', off: -44 }, { s: ZONE_LEN * 2 + 1350, type: 'pagoda', off: 50 },
];

// Grandstands: packed around the start and finish, then at intervals all the way round.
const STANDS = [];
{
  const avoid = FEATURES.filter((f) => f.type === 'gantry' || f.type === 'torii').map((f) => f.s);
  const clear = (s) => avoid.every((a) => Math.abs(a - s) > 26);
  let side = 1;
  for (let s = -150; s < LENGTH - 90; side = -side) {
    if (clear(s)) {
      STANDS.push({ s, side });
      if (s < 500) STANDS.push({ s, side: -side });
    }
    s += s < 500 ? 75 : s < ZONE_LEN - 200 ? 150 : 290;
  }
  for (const s of [LENGTH - 50, LENGTH + 50]) for (const sd of [-1, 1]) STANDS.push({ s, side: sd });
}

const SHIRTS = [0xe63946, 0xf1faee, 0x457b9d, 0xffb703, 0x2a9d8f, 0xff7eb6, 0xffffff, 0x1d3557, 0xfb8500, 0x8ecae6].map(col);
const SKINS = [0xf1c9a5, 0xe0ac86, 0xc68a5f, 0x8d5a3b, 0xf6d7bd].map(col);
const ROOFS = [0xc8343a, 0x2d5fb8, 0xe8e8ee].map(col);
const CONCRETE = [0x8a8f99, 0x9aa0aa, 0x5d626b, 0x23262d].map(col);

// ---------------------------------------------------------------- sky ----

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false,
    uniforms: {
      uTop: { value: col(0x3b86d8) }, uHor: { value: col(0xdfeaf2) }, uGnd: { value: col(0x3a3a3a) },
      uSun: { value: col(0xffffff) }, uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.4).normalize() },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop, uHor, uGnd, uSun, uSunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = mix(uHor, uTop, pow(clamp(d.y, 0.0, 1.0), 0.5));
        c = mix(uGnd, c, smoothstep(-0.08, 0.0, d.y));
        float sd = max(dot(d, uSunDir), 0.0);
        c += uSun * (smoothstep(0.9993, 0.9997, sd) * 4.0 + pow(sd, 48.0) * 0.5 + pow(sd, 6.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// Reflection map for the car paint, rendered once from a plain daytime sky.
export function makeEnv(renderer) {
  const scene = new THREE.Scene();
  scene.add(makeSky());
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02, 0.1, 1000).texture;
  pmrem.dispose();
  return tex;
}

// Snow-capped volcano on the horizon. Drawn right after the sky so the world covers it.
function makeVolcano(uHor) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 12, true);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5, a = Math.atan2(p.getZ(i), p.getX(i));
    const r = 18 + 150 * Math.pow(1 - t, 1.9);
    p.setXYZ(i, Math.cos(a) * r, t * 92, Math.sin(a) * r);
  }
  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, uniforms: { uHor },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uHor; varying vec2 vUv;
      void main() {
        float snow = smoothstep(0.0, 0.03, vUv.y - 0.6 - 0.05 * sin(vUv.x * 56.55) - 0.03 * sin(vUv.x * 131.95));
        vec3 c = mix(mix(vec3(0.13, 0.19, 0.38), vec3(0.25, 0.33, 0.55), vUv.y), vec3(0.95, 0.97, 1.0), snow);
        c *= 0.82 + 0.22 * sin(vUv.x * 6.2832 + 1.0);
        c = mix(uHor, c, smoothstep(0.0, 0.5, vUv.y) * 0.85);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(95, -8, -420);
  mesh.renderOrder = -9;
  mesh.frustumCulled = false;
  return mesh;
}

// ----------------------------------------------------------- textures ----

function makeTextures(aniso) {
  const T = {};
  const text = (g, str, x, y, px, squash = 1) => {
    g.font = `900 ${px}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(x, y); g.scale(squash, 1); g.fillText(str, 0, 0); g.restore();
  };

  // Road: asphalt, rubbered racing line, kerbs, edge lines, centre dashes. Tiles every 12 m.
  T.road = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2a2c31'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = (30 + Math.random() * 45) | 0;
      g.fillStyle = `rgba(${v + 8},${v + 8},${v + 12},.5)`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    const line = g.createLinearGradient(0, 0, w, 0);
    line.addColorStop(0.2, 'rgba(0,0,0,0)'); line.addColorStop(0.5, 'rgba(0,0,0,.3)'); line.addColorStop(0.8, 'rgba(0,0,0,0)');
    g.fillStyle = line; g.fillRect(0, 0, w, h);
    const k = w / 16; // one metre
    for (const x of [0, w - k]) {
      g.fillStyle = '#d4202a'; g.fillRect(x, 0, k, h / 2);
      g.fillStyle = '#f2f2f2'; g.fillRect(x, h / 2, k, h / 2);
    }
    g.fillStyle = '#e9e9e9';
    g.fillRect(k, 0, 5, h); g.fillRect(w - k - 5, 0, 5, h);
    g.fillRect(w / 2 - 2.5, 0, 5, h * 0.4);
  }, { repeat: true, aniso });

  // Barrier: eight 8 m panels of made-up sponsor boards and chevrons.
  T.wall = canvasTex(2048, 64, (g) => {
    const ads = [['KAZE GP', '#d8102a', '#fff'], null, ['サクラ', '#fff', '#e8468a'], ['SPEED', '#101318', '#ffd400'],
      ['TURBO-X', '#0b3dd9', '#fff'], null, ['富士', '#f4f4f4', '#111'], ['NITRO', '#ff7a00', '#111']];
    ads.forEach((a, i) => {
      const x = i * 256;
      g.save(); g.beginPath(); g.rect(x, 0, 256, 64); g.clip();
      g.fillStyle = a ? a[1] : '#f2f2f2'; g.fillRect(x, 0, 256, 64);
      if (a) { g.fillStyle = a[2]; text(g, a[0], x + 128, 32, 46, 0.55); }
      else {
        g.fillStyle = '#d8102a';
        for (let k = -1; k < 8; k++) {
          const c = x + k * 40;
          g.beginPath(); g.moveTo(c, 64); g.lineTo(c + 20, 64); g.lineTo(c + 52, 0); g.lineTo(c + 32, 0); g.fill();
        }
      }
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, 0, 3, 64);
      g.restore();
    });
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 57, 2048, 7);
  }, { repeat: true, aniso });

  // Four vertical neon shop signs side by side.
  T.sign = canvasTex(512, 512, (g) => {
    g.fillStyle = '#07070c'; g.fillRect(0, 0, 512, 512);
    [['カラオケ', '#ff2d78'], ['ホテル', '#19e3ff'], ['やきとり', '#ffd23f'], ['おすし', '#7dff5a']].forEach(([str, c], i) => {
      const x = i * 128, step = 452 / str.length;
      g.shadowColor = c; g.shadowBlur = 14;
      g.strokeStyle = c; g.lineWidth = 6; g.strokeRect(x + 10, 10, 108, 492);
      g.fillStyle = c;
      [...str].forEach((ch, k) => text(g, ch, x + 64, 30 + step * (k + 0.5), 86));
    });
  });

  // Tower blocks: a facade and a matching mask of lit windows (8 x 8 windows per 20 m).
  const cells = (g, fn) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) fn(x * 16 + 3, y * 16 + 3, x, y); };
  T.facade = canvasTex(128, 128, (g) => {
    g.fillStyle = '#9aa0ad'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#343b48'; cells(g, (x, y) => g.fillRect(x, y, 10, 9));
  }, { repeat: true });
  T.windows = canvasTex(128, 128, (g) => {
    const lit = ['#ffd98a', '#ffe9b8', '#ffd98a', '#9fe8ff', '#ffb3d9'], R = rng(7);
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
    cells(g, (x, y) => { if (R() < 0.42) { g.fillStyle = lit[(R() * lit.length) | 0]; g.fillRect(x, y, 10, 9); } });
  }, { repeat: true });

  // Subtle blotchy noise that breaks up the flat ground colours.
  T.noise = canvasTex(128, 128, (g) => {
    const img = g.createImageData(128, 128), R = rng(3);
    for (let i = 0; i < img.data.length; i += 4) { const v = 205 + R() * 50; img.data.set([v, v, v, 255], i); }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},.07)`;
      g.beginPath(); g.arc(R() * 128, R() * 128, 6 + R() * 16, 0, 7); g.fill();
    }
  }, { repeat: true, aniso: Math.min(4, aniso) });

  T.checker = canvasTex(128, 24, (g) => {
    for (let y = 0; y < 3; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 8, y * 8, 8, 8); }
  }, { nearest: true });

  T.banner = (label) => canvasTex(1024, 64, (g) => {
    g.fillStyle = '#d8102a'; g.fillRect(0, 0, 1024, 64);
    for (let i = 0; i < 8; i++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (i + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(i * 16, y * 16, 16, 16); g.fillRect(1024 - (i + 1) * 16, y * 16, 16, 16);
    }
    g.fillStyle = '#fff'; text(g, `${label}  ·  KAZE GP  ·  ${label}`, 512, 34, 44);
  }, { aniso });

  T.cloud = canvasTex(256, 128, (g) => {
    const R = rng(11);
    for (let i = 0; i < 22; i++) {
      const x = 50 + R() * 156, y = 44 + R() * 44, r = 22 + R() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.42)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    }
  });
  return T;
}

// ---------------------------------------------------------- geometries ----

function makeGeos() {
  const G = {};
  const ico = (r, d) => new THREE.IcosahedronGeometry(r, d);

  G.cube = box(1, 1, 1);
  G.block = box(1, 1, 1).translate(0, 0.5, 0); // tower block, sits on its base
  G.body = new THREE.CylinderGeometry(0.19, 0.23, 0.6, 5);
  G.head = ico(0.15, 0);

  G.cedar = merge([
    part(new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6), 0x5a3b24, [0, 1.3, 0]),
    part(new THREE.ConeGeometry(2.3, 4.6, 7), 0x1d5a30, [0, 4.3, 0]),
    part(new THREE.ConeGeometry(1.8, 4.0, 7), 0x25703a, [0, 6.5, 0]),
    part(new THREE.ConeGeometry(1.2, 3.4, 7), 0x2f8546, [0, 8.7, 0]),
  ]);
  G.sakura = merge([
    part(new THREE.CylinderGeometry(0.2, 0.34, 3.2, 6), 0x4a3026, [0, 1.6, 0]),
    part(new THREE.CylinderGeometry(0.1, 0.16, 2, 5), 0x4a3026, [0.7, 3.3, 0.2], [0, 0, -0.7]),
    part(ico(2.2, 1), 0xffb3d1, [0, 5.0, 0], [0, 0, 0], [1, 0.8, 1]),
    part(ico(1.6, 1), 0xff9ec6, [1.7, 4.3, 0.5], [0, 0, 0], [1, 0.8, 1]),
    part(ico(1.7, 1), 0xffcbe0, [-1.5, 4.5, -0.7], [0, 0, 0], [1, 0.8, 1]),
  ]);

  G.rock = ico(1, 1);
  const rp = G.rock.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const k = 1 + 0.25 * Math.sin(x * 5.1 + y * 3.3) * Math.cos(z * 4.7 + x * 2.1);
    rp.setXYZ(i, x * k, y * k, z * k);
  }

  const RED = 0xd23a22, BLK = 0x16161a;
  const post = new THREE.CylinderGeometry(0.5, 0.62, 11.4, 12);
  G.torii = merge([ // spans the whole road
    part(post, RED, [-12.9, 5.7, 0]), part(post, RED, [12.9, 5.7, 0]),
    part(box(1.6, 0.9, 1.6), BLK, [-12.9, 0.45, 0]), part(box(1.6, 0.9, 1.6), BLK, [12.9, 0.45, 0]),
    part(box(28.6, 0.8, 0.9), RED, [0, 9.2, 0]),
    part(box(0.9, 1.6, 0.6), RED, [0, 10.4, 0]),
    part(box(31.5, 1.0, 1.5), RED, [0, 11.7, 0]),
    part(box(33, 0.45, 1.9), BLK, [0, 12.4, 0]),
  ]);

  const pg = [part(box(12, 6, 12), 0x8a8a86, [0, -2, 0])];
  for (let i = 0; i < 5; i++) {
    const w = 8.5 - i * 1.3, y = 1 + i * 4.3;
    pg.push(part(box(w, 3, w), 0xb0352a, [0, y + 1.5, 0]));
    pg.push(part(box(w + 0.2, 0.5, w + 0.2), 0xe9dfca, [0, y + 0.35, 0]));
    pg.push(part(new THREE.ConeGeometry(w * 0.707 + 2.4, 1.7, 4), 0x2c3a3c, [0, y + 3.85, 0], [0, Math.PI / 4, 0]));
  }
  pg.push(part(new THREE.CylinderGeometry(0.1, 0.2, 5, 6), 0xd8b24a, [0, 24.5, 0]));
  G.pagoda = merge(pg);

  G.lamp = merge([part(box(0.2, 9, 0.2), 0x24262c, [0, 4.5, 0]), part(box(2.6, 0.16, 0.16), 0x24262c, [-1.2, 8.9, 0])]);
  G.bulb = box(0.7, 0.14, 0.34).translate(-2.3, 8.78, 0);

  // Red-and-white broadcast tower for the city skyline.
  const shaft = new THREE.CylinderGeometry(1.2, 13, 190, 4, 10, true).toNonIndexed();
  const sp = shaft.attributes.position, sc = new Float32Array(sp.count * 3);
  const bands = [col(0xe8452c), col(0xf4f4f4)];
  for (let i = 0; i < sp.count; i += 3) {
    const band = bands[Math.floor(((sp.getY(i) + sp.getY(i + 1) + sp.getY(i + 2)) / 3 + 95) / 19) % 2];
    for (let k = 0; k < 3; k++) band.toArray(sc, (i + k) * 3);
  }
  shaft.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  shaft.translate(0, 95, 0);
  G.tower = merge([shaft, part(box(13, 4, 13), 0xf4f4f4, [0, 78, 0]), part(box(8, 3, 8), 0xf4f4f4, [0, 128, 0])]);
  return G;
}

// A batch of textured quads (barriers, signs, the start line).
class Quads {
  p = []; u = []; i = [];
  add(a, b, c, d, u0, v0, u1, v1) { // corners: bottom-left, bottom-right, top-right, top-left
    const n = this.p.length / 3;
    this.p.push(...a, ...b, ...c, ...d);
    this.u.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.i.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  mesh(mat) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
}

// ------------------------------------------------------------- ground ----

const GC = {
  pave: col(0x4b4e58), paveD: col(0x2f3239), grassA: col(0x3d7a35), grassB: col(0x6aa646),
  alp: col(0x5f7b4a), stone: col(0x7a726b), snow: col(0xf3f6fb), sandA: col(0xdcb679), sandB: col(0xc59958),
};
const CT = new THREE.Color();
function zoneColor(z, s, off, hr, out) {
  const n = 0.5 + 0.5 * Math.sin(s * 0.11 + off * 0.19) * Math.sin(off * 0.071 - s * 0.043);
  if (z === 0) return out.copy(Math.abs(off) < 20 ? GC.pave : GC.paveD);
  if (z === 1) return out.copy(GC.grassA).lerp(GC.grassB, n);
  if (z === 2) return out.copy(GC.alp).lerp(GC.stone, smooth(4, 30, hr)).lerp(GC.snow, smooth(90, 125, hr + n * 25));
  return out.copy(GC.sandA).lerp(GC.sandB, n);
}
function groundColor(s, off, hr, out) {
  const [i, j, t] = zoneBlend(s);
  zoneColor(i, s, off, hr, out);
  if (t > 0) out.lerp(zoneColor(j, s, off, hr, CT), t);
  return out;
}

function roadGeo(s0) {
  const n = ROWS + 1, pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
  for (let r = 0; r < n; r++) {
    const s = s0 + r * STEP, x = cx(s), y = cy(s), sl = dcy(s), l = Math.hypot(1, sl);
    pos.set([x - KERB_HALF, y, -s, x + KERB_HALF, y, -s], r * 6);
    nor.set([0, 1 / l, sl / l, 0, 1 / l, sl / l], r * 6);
    uv.set([0, (r * STEP) / 12, 1, (r * STEP) / 12], r * 4);
    if (r < ROWS) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  return geo(pos, nor, uv, idx);
}

function geo(pos, nor, uv, idx, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setIndex(idx);
  return g;
}

// Land either side of the road, out to 430 m. Columns get wider with distance.
const OFFS = [8, 12, 20, 32, 50, 75, 110, 160, 230, 320, 430];
const COLS = [...OFFS.map((o) => -o).reverse(), ...OFFS];
function terrainGeo(s0) {
  const nc = COLS.length, half = nc / 2, CC = new THREE.Color();
  // Heights for one extra row at each end, so normals match across chunk seams.
  const P = new Float32Array((ROWS + 3) * nc * 3);
  for (let r = 0; r < ROWS + 3; r++) {
    const s = s0 + (r - 1) * STEP, x0 = cx(s);
    for (let c = 0; c < nc; c++) P.set([x0 + COLS[c], terrainH(s, COLS[c]), -s], (r * nc + c) * 3);
  }
  const n = (ROWS + 1) * nc;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), clr = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  for (let r = 0, v = 0; r <= ROWS; r++) {
    const s = s0 + r * STEP, y0 = cy(s);
    for (let c = 0; c < nc; c++, v++) {
      const o = ((r + 1) * nc + c) * 3;
      pos.set([P[o], P[o + 1], P[o + 2]], v * 3);
      const a = o - (c === 0 || c === half ? 0 : 3), b = o + (c === nc - 1 || c === half - 1 ? 0 : 3);
      const d = o - nc * 3, e = o + nc * 3;
      const tx = P[b] - P[a], ty = P[b + 1] - P[a + 1];           // across the track (+x)
      const ux = P[e] - P[d], uy = P[e + 1] - P[d + 1], uz = P[e + 2] - P[d + 2]; // along it
      const nx = ty * uz, ny = -tx * uz, nz = tx * uy - ty * ux, l = Math.hypot(nx, ny, nz) || 1;
      nor.set([nx / l, ny / l, nz / l], v * 3);
      groundColor(s, COLS[c], P[o + 1] - y0, CC).toArray(clr, v * 3);
      uv.set([P[o] / 20, (r * STEP) / 20], v * 2);
      if (r < ROWS && c < nc - 1 && c !== half - 1) idx.push(v, v + 1, v + nc, v + 1, v + nc + 1, v + nc);
    }
  }
  return geo(pos, nor, uv, idx, clr);
}

function wallQuads(s0) {
  const q = new Quads(), H = 1.1, base = (((s0 % 64) + 64) % 64) / 64;
  for (let r = 0; r < ROWS; r++) {
    const sa = s0 + r * STEP, sb = sa + STEP, ua = base + (r * STEP) / 64, ub = ua + STEP / 64;
    for (const side of [-1, 1]) {
      const xa = cx(sa) + side * WALL, xb = cx(sb) + side * WALL, ya = cy(sa), yb = cy(sb);
      // u runs left-to-right as seen from the road, so the lettering reads correctly on both sides.
      if (side < 0) q.add([xa, ya, -sa], [xb, yb, -sb], [xb, yb + H, -sb], [xa, ya + H, -sa], ua, 0, ub, 1);
      else q.add([xb, yb, -sb], [xa, ya, -sa], [xa, ya + H, -sa], [xb, yb + H, -sb], -ub, 0, -ua, 1);
    }
  }
  return q;
}

// -------------------------------------------------------------- world ----

export function buildWorld(scene, renderer, envMap, lowQ) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const T = makeTextures(aniso), G = makeGeos();
  const crowdTime = { value: 0 };

  const M = {
    road: new THREE.MeshStandardMaterial({ map: T.road, roughness: 0.82, metalness: 0, envMap, envMapIntensity: 0.25 }),
    ground: new THREE.MeshLambertMaterial({ vertexColors: true, map: T.noise }),
    wall: new THREE.MeshLambertMaterial({ map: T.wall, side: THREE.DoubleSide }),
    tinted: new THREE.MeshLambertMaterial({ vertexColors: true }),
    rock: new THREE.MeshLambertMaterial({ flatShading: true }),
    plain: new THREE.MeshLambertMaterial(),
    people: new THREE.MeshLambertMaterial(),
    block: new THREE.MeshLambertMaterial({ map: T.facade, emissiveMap: T.windows, emissive: 0xffffff, emissiveIntensity: 1.6 }),
    sign: new THREE.MeshBasicMaterial({ map: T.sign, side: THREE.DoubleSide, color: new THREE.Color(2.4, 2.4, 2.4) }),
    bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 2.6) }),
    checker: new THREE.MeshLambertMaterial({ map: T.checker, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  // The crowd bobs up and down in a wave, entirely on the GPU.
  M.people.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = crowdTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        transformed.y += max(0.0, sin(uTime * 5.0 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3)) * 0.22;
      #endif`);
  };
  // Tile the window texture by each block's size, so every block has 2.5 m windows.
  M.block.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec2 tile = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz)) / 20.0;
        vMapUv *= tile; vEmissiveMapUv *= tile;
      #endif`);
  };

  // --- placement helpers ---
  const D = new THREE.Object3D(), LM = new THREE.Matrix4(), LP = new THREE.Vector3(), LS = new THREE.Vector3(), IQ = new THREE.Quaternion();
  const mat4 = (x, y, z, yaw, sx, sy = sx, sz = sx, rx = 0, rz = 0) => {
    D.position.set(x, y, z); D.rotation.set(rx, yaw, rz); D.scale.set(sx, sy, sz);
    D.updateMatrix();
    return D.matrix.clone();
  };
  const onLand = (s, off, yaw, sx, sy, sz, sink = 0, rx = 0, rz = 0) => mat4(cx(s) + off, terrainH(s, off) - sink, -s, yaw, sx, sy, sz, rx, rz);
  const heading = (s) => -Math.atan(dcx(s));                               // local -Z along the track
  const outward = (s, side) => (side > 0 ? 0 : Math.PI) - Math.atan(dcx(s)); // local +X away from the track
  const local = (base, x, y, z, sx, sy, sz) => base.clone().multiply(LM.compose(LP.set(x, y, z), IQ, LS.set(sx, sy, sz)));

  function addStand(st, L, R) {
    const len = 32, rows = 7, dp = 1.15, hp = 0.62, top = rows * hp;
    const base = mat4(cx(st.s) + st.side * (WALL + 2.2), cy(st.s), -st.s, outward(st.s, st.side), 1);
    const roof = ROOFS[(R() * ROOFS.length) | 0];
    const cube = (x, y, z, sx, sy, sz, c) => L.cube.push({ m: local(base, x, y, z, sx, sy, sz), c });
    cube((rows * dp) / 2, -2.5, 0, rows * dp + 0.6, 5, len, CONCRETE[2]);
    for (let r = 0; r < rows; r++) cube(r * dp + dp / 2, ((r + 1) * hp) / 2, 0, dp, (r + 1) * hp, len, CONCRETE[r % 2]);
    cube(rows * dp + 0.2, (top + 3.7) / 2, 0, 0.4, top + 3.7, len, CONCRETE[3]);
    cube((rows * dp) / 2 - 0.2, top + 3.8, 0, rows * dp + 2.2, 0.25, len + 1, roof);
    for (let r = 0; r < rows; r++) {
      for (let z = -len / 2 + 0.5; z < len / 2 - 0.3; z += 0.74) {
        if (R() > 0.9) continue; // an empty seat
        const x = r * dp + dp * 0.5, y = (r + 1) * hp, k = 0.9 + R() * 0.25, jz = z + (R() - 0.5) * 0.2;
        L.body.push({ m: local(base, x, y + 0.32 * k, jz, k, k, k), c: SHIRTS[(R() * SHIRTS.length) | 0] });
        L.head.push({ m: local(base, x, y + 0.78 * k, jz, k, k, k), c: SKINS[(R() * SKINS.length) | 0] });
      }
    }
  }

  function addFeature(f, L, grp) {
    const s = f.s;
    if (f.type === 'torii' || f.type === 'pagoda' || f.type === 'tower') {
      const m = new THREE.Mesh(G[f.type], M.tinted);
      if (f.type === 'torii') m.applyMatrix4(mat4(cx(s), cy(s), -s, heading(s), 1));
      else m.applyMatrix4(onLand(s, f.off, heading(s) + 0.5, f.type === 'pagoda' ? 1.3 : 1));
      m.castShadow = f.type === 'torii';
      grp.add(m);
      return;
    }
    // start / finish gantry with a banner and a chequered line
    const base = mat4(cx(s), cy(s), -s, heading(s), 1);
    for (const x of [-12.9, 12.9]) L.cube.push({ m: local(base, x, 4.6, 0, 0.9, 9.2, 0.9), c: CONCRETE[3] });
    L.cube.push({ m: local(base, 0, 9.1, 0, 26.7, 2.0, 0.7), c: CONCRETE[3] });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(25, 1.56), new THREE.MeshBasicMaterial({ map: T.banner(f.label) }));
    banner.position.set(0, 9.1, 0.37);
    banner.applyMatrix4(base);
    grp.add(banner);
    const q = new Quads(), a = s - 1.5, b = s + 1.5;
    q.add([cx(a) - 8, cy(a) + 0.03, -a], [cx(a) + 8, cy(a) + 0.03, -a], [cx(b) + 8, cy(b) + 0.03, -b], [cx(b) - 8, cy(b) + 0.03, -b], 0, 0, 1, 1);
    const line = q.mesh(M.checker);
    line.receiveShadow = true;
    grp.add(line);
  }

  function buildChunk(k, s0) {
    const s1 = s0 + CHUNK, grp = new THREE.Group(), R = rng(k * 7919 + 13);
    const L = { cube: [], block: [], cedar: [], sakura: [], rock: [], lamp: [], body: [], head: [] };
    const signs = new Quads();

    const road = new THREE.Mesh(roadGeo(s0), M.road), land = new THREE.Mesh(terrainGeo(s0), M.ground);
    road.receiveShadow = land.receiveShadow = true;
    grp.add(road, land, wallQuads(s0).mesh(M.wall));

    const near = STANDS.filter((st) => st.s > s0 - 40 && st.s < s1 + 40);
    const blocked = (s, off) => Math.abs(off) < 27 && near.some((st) => Math.abs(st.s - s) < 21 && st.side * off > 0);
    for (const st of STANDS) if (st.s >= s0 && st.s < s1) addStand(st, L, R);
    for (const f of FEATURES) if (f.s >= s0 && f.s < s1) addFeature(f, L, grp);

    const zoneAt = (s) => { const [i, j, t] = zoneBlend(s); return R() < t ? j : i; };
    const shade = (v) => new THREE.Color().setScalar(1 - v + R() * 2 * v);

    // City: tower blocks with neon blade signs, a taller back row, street lamps.
    for (let i = 0; i < 5; i++) {
      const s = s0 + 12 + i * 24;
      for (const side of [-1, 1]) {
        if (zoneAt(s) !== 0) continue;
        const w = 16 + R() * 8, h = 26 + R() * R() * 95, off = side * (38 + w / 2 + R() * 6);
        L.block.push({ m: mat4(cx(s) + off, cy(s) - 3, -s, heading(s), w, h + 3, w), c: new THREE.Color().setHSL(0.58 + R() * 0.1, 0.12 + R() * 0.2, 0.3 + R() * 0.3) });
        if (R() < 0.6) {
          const x = cx(s) + off - side * (w / 2 + 1.5), y = cy(s) + 5 + R() * Math.min(18, h * 0.4), z = -(s - w / 2) + 0.2, n = (R() * 4) | 0;
          signs.add([x - 1.3, y, z], [x + 1.3, y, z], [x + 1.3, y + 10.4, z], [x - 1.3, y + 10.4, z], n / 4, 0, (n + 1) / 4, 1);
        }
        if (i % 2 === 0) {
          const w2 = 26 + R() * 12, h2 = 70 + R() * 130;
          L.block.push({ m: mat4(cx(s) + side * (100 + R() * 70), cy(s) - 3, -s, heading(s), w2, h2, w2), c: new THREE.Color().setHSL(0.6 + R() * 0.08, 0.2, 0.2 + R() * 0.2) });
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      const s = s0 + 20 + i * 40;
      if (zoneAt(s) === 0) for (const side of [-1, 1]) L.lamp.push({ m: mat4(cx(s) + side * (WALL + 0.9), cy(s), -s, outward(s, side), 1) });
    }

    // Forest: an avenue of cherry trees along the road.
    for (let i = 0; i < 11; i++) {
      for (const side of [-1, 1]) {
        const s = s0 + 5 + i * 11 + R() * 3, off = side * (15.5 + R() * 3.5);
        if (zoneAt(s) === 1 && !blocked(s, off)) L.sakura.push({ m: onLand(s, off, R() * 6.3, 0.9 + R() * 0.5, undefined, undefined, 0.2), c: shade(0.12) });
      }
    }
    // Scattered trees, rocks and scrub, by zone.
    for (let i = 0; i < 90; i++) {
      const s = s0 + R() * CHUNK, z = zoneAt(s), side = R() < 0.5 ? -1 : 1, a = R(), b = R(), yaw = R() * 6.3;
      if (z === 1) {
        const off = side * (22 + a * a * 200), k = 0.9 + b * 0.9;
        if (!blocked(s, off)) (R() < 0.12 ? L.sakura : L.cedar).push({ m: onLand(s, off, yaw, k, undefined, undefined, 0.3), c: shade(0.15) });
      } else if (z === 2 && i < 30) {
        const off = side * (16 + a * 120);
        if (!blocked(s, off)) L.cedar.push({ m: onLand(s, off, yaw, 0.8 + b * 0.7, undefined, undefined, 0.5), c: shade(0.15) });
      } else if (z === 2 && i < 64) {
        const off = side * (14 + a * a * 220), k = 0.5 + b * b * 3.2;
        if (!blocked(s, off)) L.rock.push({ m: onLand(s, off, yaw, k, k * (0.6 + R() * 0.5), k, k * 0.3, R() * 3, R() * 3), c: new THREE.Color().setHSL(0.07, 0.06, 0.34 + R() * 0.2) });
      } else if (z === 3 && i < 50) {
        const off = side * (14 + a * 130), scrub = i >= 18, k = scrub ? 0.5 + b * 0.8 : 0.6 + b * b * 2.6;
        if (!blocked(s, off)) L.rock.push({ m: onLand(s, off, yaw, k, k * (scrub ? 0.7 : 0.8), k, k * 0.3, R() * 3, R() * 3), c: scrub ? new THREE.Color().setHSL(0.2 + R() * 0.05, 0.3, 0.3) : new THREE.Color().setHSL(0.09, 0.3, 0.42 + R() * 0.15) });
      }
    }

    const inst = (g, m, list, shadow) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(g, m, list.length);
      list.forEach((it, n) => { im.setMatrixAt(n, it.m); im.setColorAt(n, it.c || WHITE); });
      im.castShadow = !!shadow;
      grp.add(im);
    };
    inst(G.cube, M.plain, L.cube, !lowQ);
    inst(G.block, M.block, L.block);
    inst(G.cedar, M.tinted, L.cedar, !lowQ);
    inst(G.sakura, M.tinted, L.sakura, !lowQ);
    inst(G.rock, M.rock, L.rock);
    inst(G.lamp, M.tinted, L.lamp);
    inst(G.bulb, M.bulb, L.lamp);
    inst(G.body, M.people, L.body);
    inst(G.head, M.people, L.head);
    const sm = signs.mesh(M.sign);
    if (sm) grp.add(sm);

    // Nothing here ever moves again.
    grp.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    return { s0, s1, grp };
  }

  const chunks = [];
  for (let k = 0, s0 = S_MIN; s0 < S_MAX; k++, s0 += CHUNK) {
    const c = buildChunk(k, s0);
    scene.add(c.grp);
    chunks.push(c);
  }

  // --- sky, lights, fog ---
  const sky = makeSky(), U = sky.material.uniforms;
  const cloudMat = new THREE.MeshBasicMaterial({ map: T.cloud, transparent: true, depthWrite: false, fog: false });
  const skyGroup = new THREE.Group();
  skyGroup.add(sky, makeVolcano(U.uHor));
  const CR = rng(5);
  for (let i = 0; i < 11; i++) {
    const az = (i / 11) * 6.28 + CR(), el = 0.13 + CR() * 0.4, dist = 700;
    const cloud = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cloudMat);
    cloud.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist);
    cloud.scale.set(280 + CR() * 260, 80 + CR() * 70, 1);
    cloud.lookAt(0, 0, 0);
    skyGroup.add(cloud);
  }
  scene.add(skyGroup);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(lowQ ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 240 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(sun, sun.target, hemi);
  scene.fog = new THREE.Fog(0xffffff, 100, 800);

  const petals = new Petals(scene);
  const sunDir = new THREE.Vector3();
  const mix = (a, b, t) => a + (b - a) * t;

  return {
    // s: player distance. focus: point the shadow follows. wide: show the track behind too (orbit camera).
    update(s, focus, camera, dt, time, wide) {
      const [i, j, t] = zoneBlend(s), A = LOOK[i], B = LOOK[j];
      U.uTop.value.copy(A.top).lerp(B.top, t);
      U.uHor.value.copy(A.hor).lerp(B.hor, t);
      U.uGnd.value.copy(U.uHor.value);
      U.uSun.value.copy(A.sun).lerp(B.sun, t);
      sunDir.copy(A.dir).lerp(B.dir, t).normalize();
      U.uSunDir.value.copy(sunDir);
      scene.fog.color.copy(U.uHor.value);
      scene.fog.near = mix(A.fogN, B.fogN, t);
      scene.fog.far = mix(A.fogF, B.fogF, t);
      sun.color.copy(U.uSun.value);
      sun.intensity = mix(A.sunI, B.sunI, t);
      sun.position.copy(focus).addScaledVector(sunDir, 100);
      sun.target.position.copy(focus);
      hemi.color.copy(A.sky).lerp(B.sky, t);
      hemi.groundColor.copy(A.gnd).lerp(B.gnd, t);
      hemi.intensity = mix(A.hemI, B.hemI, t);
      cloudMat.color.copy(A.cloud).lerp(B.cloud, t);
      skyGroup.position.copy(camera.position);

      const back = wide ? 560 : 90, fwd = scene.fog.far + 80;
      for (const c of chunks) c.grp.visible = c.s1 > s - back && c.s0 < s + fwd;

      crowdTime.value = time;
      petals.update(dt, camera, (i === 1 ? 1 - t : 0) + (j === 1 && i !== 1 ? t : 0), time);
    },
  };
}

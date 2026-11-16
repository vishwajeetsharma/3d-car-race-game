// Small helpers for building everything in code (no downloaded assets).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
const P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();

// A copy of `geo`, moved into place and painted one colour, ready to be merged.
export function part(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (typeof scale === 'number') S.setScalar(scale); else S.set(...scale);
  g.applyMatrix4(M.compose(P.set(...pos), Q.setFromEuler(E.set(...rot)), S));
  C.set(color);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) C.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

export const merge = (parts) => mergeGeometries(parts, false);
export const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

// Seeded random numbers, so the world is identical on every load.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A texture painted with the 2D canvas API.
export function canvasTex(w, h, draw, { repeat = false, aniso = 1, nearest = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (nearest) t.magFilter = THREE.NearestFilter;
  t.anisotropy = aniso;
  return t;
}

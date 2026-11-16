// Camera rigs: chase (TPP), cockpit (FPP) and a slow orbit for the menu / finish.
import * as THREE from 'three';
import { cx, cy, WALL, clamp } from './track.js';

const look = new THREE.Vector3(), tmp = new THREE.Vector3();
let camLat = 0;

export function updateCamera(cam, p, mode, dt, time) {
  const portrait = cam.aspect < 1, g = p.model.group, s = p.s;
  let fov;

  if (mode === 'orbit') {
    const a = time * 0.3 + 0.6, r = portrait ? 9.5 : 7.5;
    const z = g.position.z + Math.cos(a) * r, sc = -z;
    const x = clamp(g.position.x + Math.sin(a) * r, cx(sc) - WALL + 1.2, cx(sc) + WALL - 1.2);
    cam.position.set(x, g.position.y + 2, z);
    // In portrait the menu covers the lower half, so aim low to lift the car up the screen.
    look.set(g.position.x, g.position.y + (portrait ? -2.2 : 0.2), g.position.z);
    fov = portrait ? 80 : 45;
    camLat = p.lat;
  } else if (mode === 'fpp') {
    g.updateMatrixWorld(true);
    cam.position.copy(tmp.set(0, 1.12, 0).applyMatrix4(g.matrixWorld)); // onboard, just above the driver
    const a = s + 30;
    look.set(cx(a) + p.lat * 0.9 + Math.tan(p.yaw * 0.4) * 30, cy(a) + 0.6, -a);
    fov = (portrait ? 84 : 66) + p.boostK * 10;
    camLat = p.lat;
  } else {
    camLat += (p.lat - camLat) * Math.min(1, dt * 5);
    const sc = s - (portrait ? 7.6 : 6.6) + p.boostK * 0.7;
    cam.position.set(cx(sc) + camLat * 0.92, cy(sc) + (portrait ? 3.3 : 2.4), -sc);
    const a = s + 14;
    look.set(cx(a) + p.lat * 0.6, cy(a) + 0.9, -a);
    fov = (portrait ? 76 : 56) + p.boostK * 12;
  }

  if (p.boostK > 0.05) {
    cam.position.x += (Math.random() - 0.5) * 0.06 * p.boostK;
    cam.position.y += (Math.random() - 0.5) * 0.06 * p.boostK;
  }
  cam.lookAt(look);
  if (mode === 'fpp') cam.rotateZ(-p.steer * 0.035);
  if (Math.abs(cam.fov - fov) > 0.01) {
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);
    cam.updateProjectionMatrix();
  }
}

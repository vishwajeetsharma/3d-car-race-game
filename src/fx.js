// Particles: tyre smoke / sparks, and falling cherry-blossom petals.
import * as THREE from 'three';
import { canvasTex } from './geo.js';

const softTex = () => canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
});

// A fixed pool of glowing puffs that fade out. Dead ones are simply black (invisible when additive).
export class Puffs {
  constructor(scene, n = 120) {
    this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3); this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 2.4, map: softTex(), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }

  emit(x, y, z, vx, vy, vz, life, r, g, b) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.base.set([r, g, b], i * 3);
    this.life[i] = this.max[i] = life;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      for (let a = 0; a < 3; a++) {
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.col[i * 3 + a] = this.base[i * 3 + a] * k;
      }
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.pts.geometry.attributes.color.needsUpdate = true;
  }
}

// Petals live in a box ahead of the camera and are recycled as it passes them.
export class Petals {
  constructor(scene, n = 260) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(1e6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.36, map: softTex(), color: 0xffb8d6, transparent: true, depthWrite: false, opacity: 0,
    }));
    this.pts.frustumCulled = false;
    this.pts.visible = false;
    scene.add(this.pts);
  }

  update(dt, cam, weight, time) {
    this.pts.visible = weight > 0.02;
    if (!this.pts.visible) return;
    this.pts.material.opacity = weight;
    const p = this.pos, c = cam.position;
    for (let i = 0; i < this.n; i++) {
      let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      y -= (1.2 + (i % 5) * 0.3) * dt;
      x += Math.sin(time * 1.3 + i) * 0.8 * dt;
      if (z > c.z + 4 || z < c.z - 130 || y < c.y - 6 || Math.abs(x - c.x) > 40) {
        x = c.x + (Math.random() - 0.5) * 60;
        y = c.y - 2 + Math.random() * 20;
        z = c.z - 12 - Math.random() * 110;
      }
      p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
  }
}

// effects.js — transient particle FX: an expanding shockwave ring on spawn, and
// a particle burst on grab. Each effect is self-disposing; call update(dt) once
// per frame to advance and garbage-collect them.

import * as THREE from "three";

export function createEffects(scene) {
  const active = [];

  // Expanding, fading ring — faces the camera (RingGeometry lies in the XY plane).
  function shockwave(pos, color = 0x8fecff) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 48), mat);
    ring.position.set(pos.x, pos.y, pos.z ?? 0);
    scene.add(ring);
    active.push({ obj: ring, life: 0, dur: 0.7, kind: "ring" });
  }

  // Outward particle spray.
  function burst(pos, color = 0xaef2ff, n = 20) {
    const positions = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z ?? 0;
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 2.2;
      vel.push(new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, (Math.random() - 0.5) * s));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.06, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(pts);
    active.push({ obj: pts, life: 0, dur: 0.6, kind: "burst", vel });
  }

  function update(dt) {
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i];
      e.life += dt;
      const k = e.life / e.dur;
      if (k >= 1) {
        scene.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose();
        active.splice(i, 1); continue;
      }
      if (e.kind === "ring") {
        const s = 0.2 + k * 3.4;
        e.obj.scale.set(s, s, s);
        e.obj.material.opacity = 0.9 * (1 - k);
      } else {
        const arr = e.obj.geometry.attributes.position.array;
        for (let j = 0; j < e.vel.length; j++) {
          arr[j * 3] += e.vel[j].x * dt;
          arr[j * 3 + 1] += e.vel[j].y * dt;
          arr[j * 3 + 2] += e.vel[j].z * dt;
        }
        e.obj.geometry.attributes.position.needsUpdate = true;
        e.obj.material.opacity = 1 - k;
      }
    }
  }

  return { shockwave, burst, update };
}

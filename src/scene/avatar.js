// avatar.js — JESTER's presence: a gyroscopic AI core. A bright double core sits
// inside three counter-rotating rings on different axes, wrapped in a spherical
// particle halo. Everything PULSES with the live amplitude of JESTER's voice, so
// it visibly "talks". This is the only model shown by default.

import * as THREE from "three";
import { makeHoloMaterial } from "./holo.js";

export function createAvatar(scene, position = new THREE.Vector3(0, 1.35, 0)) {
  const group = new THREE.Group();
  group.position.copy(position);

  const coreMat = makeHoloMaterial(0x9fe8ff);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 2), coreMat);
  const innerMat = makeHoloMaterial(0xffffff);
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), innerMat);

  // Three gyroscopic rings on distinct axes.
  const rings = [];
  for (const r of [0.72, 0.86, 1.0]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 10, 120), makeHoloMaterial(0x59d8ff));
    group.add(ring); rings.push(ring);
  }

  // Spherical particle halo.
  const N = 240;
  const pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), R = 0.9 + Math.random() * 0.3;
    pts[i * 3] = R * Math.sin(ph) * Math.cos(th);
    pts[i * 3 + 1] = R * Math.sin(ph) * Math.sin(th);
    pts[i * 3 + 2] = R * Math.cos(ph);
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  const halo = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 0xaef2ff, size: 0.02, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));

  group.add(core, inner, halo);
  scene.add(group);

  const mats = [coreMat, innerMat, ...rings.map((r) => r.material)];
  let smooth = 0;

  return {
    object: group,
    setVisible: (v) => { group.visible = v; },

    update(level, time) {
      smooth += (level - smooth) * 0.35;
      const pulse = Math.min(smooth * 6, 1);

      core.scale.setScalar(1 + pulse * 0.3);
      inner.scale.setScalar(1 + pulse * 0.6);
      coreMat.uniforms.hold.value = 0.4 + pulse * 0.9;
      innerMat.uniforms.hold.value = 0.5 + pulse;

      // Gyroscope: each ring tumbles on a different pair of axes, faster while talking.
      const spin = 0.5 + pulse * 1.4;
      rings[0].rotation.set(0.25, time * 0.8 * spin, 0);
      rings[1].rotation.set(time * 0.6 * spin + 1.0, 0, time * 0.3);
      rings[2].rotation.set(0, time * 0.4, -time * 0.7 * spin);
      rings.forEach((r) => { r.material.uniforms.hold.value = pulse * 0.7; r.scale.setScalar(1 + pulse * 0.12); });

      core.rotation.set(time * 0.2, time * 0.4, 0);
      inner.rotation.y = -time * 0.9;
      halo.rotation.set(time * 0.1, time * 0.15, 0);
      halo.material.opacity = 0.5 + pulse * 0.5;

      for (const m of mats) m.uniforms.time.value = time;
    },
  };
}

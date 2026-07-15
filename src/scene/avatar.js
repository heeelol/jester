// avatar.js — JESTER's on-screen presence: a glowing core inside a wireframe
// shell with an orbiting ring. It idles gently and PULSES with the live amplitude
// of JESTER's voice (fed from the voice engine's outputLevel), so it visibly
// "talks". This is the model that floats over the desktop in mainframe mode.

import * as THREE from "three";
import { makeHoloMaterial } from "./holo.js";

export function createAvatar(scene, position = new THREE.Vector3(0, 1.35, 0)) {
  const group = new THREE.Group();
  group.position.copy(position);

  const coreMat = makeHoloMaterial(0xaef2ff);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), coreMat);

  const shellMat = makeHoloMaterial(0x59d8ff);
  const shellGeo = new THREE.IcosahedronGeometry(0.8, 0);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  const shellWire = new THREE.LineSegments(
    new THREE.WireframeGeometry(shellGeo),
    new THREE.LineBasicMaterial({ color: 0xaef2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );

  const ringMat = makeHoloMaterial(0x8fecff);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.02, 8, 72), ringMat);
  ring.rotation.x = Math.PI / 2;

  group.add(core, shell, shellWire, ring);
  scene.add(group);

  const mats = [coreMat, shellMat, ringMat];
  let smooth = 0;

  return {
    object: group,
    setVisible: (v) => { group.visible = v; },

    // level: 0..~0.3 RMS from the voice engine. time: seconds.
    update(level, time) {
      smooth += (level - smooth) * 0.35;
      const pulse = Math.min(smooth * 6, 1); // normalise to 0..1

      const s = 1 + pulse * 0.35;
      shell.scale.setScalar(s); shellWire.scale.setScalar(s);
      core.scale.setScalar(1 + pulse * 0.22);
      coreMat.uniforms.hold.value = 0.3 + pulse * 0.9;
      shellMat.uniforms.hold.value = pulse * 0.6;
      shellWire.material.opacity = 0.55 + pulse * 0.4;

      group.rotation.y = time * 0.3;
      shell.rotation.x = time * 0.2; shellWire.rotation.x = time * 0.2;
      core.rotation.y = -time * 0.5;
      ring.rotation.z = time * 0.7;
      for (const m of mats) m.uniforms.time.value = time;
    },
  };
}

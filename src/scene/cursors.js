// cursors.js — a glowing ring floating at each hand's pinch point in 3D. It
// widens when the hand is open and snaps tight + flares when you pinch, giving
// tactile feedback for grabbing. Driven by the same hand→world mapping the
// interaction controller uses, so the cursor sits exactly where a grab lands.

import * as THREE from "three";
import { makeHoloMaterial } from "./holo.js";
import { toWorld } from "../interaction/space.js";
import { pinchStrength, pinchPoint } from "../hands/gestures.js";

function makeCursor() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.02, 12, 48), makeHoloMaterial(0x8fecff));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), makeHoloMaterial(0xffffff));
  group.add(ring, dot);
  group.visible = false;
  return group;
}

export function createCursors(scene, max = 2) {
  const cursors = Array.from({ length: max }, () => {
    const c = makeCursor();
    scene.add(c);
    return c;
  });

  return {
    update(hands, time) {
      cursors.forEach((cursor, i) => {
        const hand = hands[i];
        if (!hand) { cursor.visible = false; return; }

        const strength = pinchStrength(hand.landmarks);   // ~0 pinched, ~1 open
        const grab = Math.max(0, Math.min(1, (0.55 - strength) / 0.35)); // 0..1 closed
        const w = toWorld(pinchPoint(hand.landmarks));

        cursor.visible = true;
        cursor.position.set(w.x, w.y, w.z + 0.2);
        cursor.rotation.z = time * (0.4 + grab * 3.0);     // spins faster as you close
        cursor.scale.setScalar(1.0 - grab * 0.45);         // snaps tight on pinch
        for (const child of cursor.children) child.material.uniforms.hold.value = grab;
      });
    },
  };
}

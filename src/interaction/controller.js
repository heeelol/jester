// controller.js — the interaction engine. This is the heart of the project.
//
// It maps hand gestures onto 3D transforms with three rules:
//   • one pinch            → grab the nearest hologram and move it
//   • two pinches, one obj → scale it (by the distance between hands)
//                            and rotate it (by the angle between hands)
//   • release              → let go
//
// The whole thing is stateless except for `held` (what each hand is holding) and
// `xform` (the two-hand gesture baseline). Everything else is derived each frame.

import { pinchStrength, pinchPoint } from "../hands/gestures.js";
import { toWorld } from "./space.js"; // shared hand→world mapping (also used by the cursors)

const GRAB_RADIUS = 1.6; // how close a pinch must be to snap onto an object
// Hysteresis: pinch must close past ON to grab, and open past OFF to release.
// The gap between them kills the flicker you'd get from a single threshold.
const PINCH_ON = 0.30;
const PINCH_OFF = 0.45;

export class InteractionController {
  constructor(grabbables, { onGrab } = {}) {
    this.grabbables = grabbables;   // live array of grabbable meshes (from the scene)
    this.held = new Map();          // handIndex -> { mesh, offset }
    this.xform = null;              // active two-hand transform baseline, or null
    this.pinching = new Map();      // handIndex -> bool (hysteresis state)
    this.onGrab = onGrab;           // (worldPoint, mesh) => void, on a fresh grab
  }

  // Nearest grabbable to a world point, within GRAB_RADIUS. Ignores objects a
  // different hand is already holding.
  #pick(world) {
    let best = null, bestD = GRAB_RADIUS;
    for (const mesh of this.grabbables) {
      if (mesh.userData.heldBy != null) continue;
      const d = Math.hypot(mesh.position.x - world.x, mesh.position.y - world.y);
      if (d < bestD) { best = mesh; bestD = d; }
    }
    return best;
  }

  // Called once per frame with the current hands.
  update(hands) {
    // Resolve each hand to a pinch point (or null), with hysteresis so a hand
    // hovering near the threshold doesn't rapidly grab/drop.
    const pinches = hands.map((h, i) => {
      const s = pinchStrength(h.landmarks);
      const now = this.pinching.get(i) ? s < PINCH_OFF : s < PINCH_ON;
      this.pinching.set(i, now);
      return now ? toWorld(pinchPoint(h.landmarks)) : null;
    });
    // Forget state for hands that are no longer present.
    for (const i of this.pinching.keys()) if (i >= hands.length) this.pinching.delete(i);

    // 1. Grab / release bookkeeping.
    pinches.forEach((world, i) => {
      if (world && !this.held.has(i)) {
        const mesh = this.#pick(world);
        if (mesh) {
          mesh.userData.heldBy = i;
          this.held.set(i, { mesh, offset: { x: mesh.position.x - world.x, y: mesh.position.y - world.y } });
          this.onGrab?.(world, mesh);
        }
      } else if (!world && this.held.has(i)) {
        this.held.get(i).mesh.userData.heldBy = null;
        this.held.delete(i);
      }
    });

    // 2. Two hands holding the SAME object → scale + rotate. Otherwise → move.
    const active = [...this.held.entries()].filter(([i]) => pinches[i]);

    if (active.length === 2 && active[0][1].mesh === active[1][1].mesh) {
      this.#transformTwoHanded(active[0][1].mesh, pinches[active[0][0]], pinches[active[1][0]]);
    } else {
      this.xform = null;
      for (const [i, grip] of active) {
        grip.mesh.position.x = pinches[i].x + grip.offset.x;
        grip.mesh.position.y = pinches[i].y + grip.offset.y;
      }
    }
  }

  // The elegant bit: derive scale from the distance between the two pinch points
  // and rotation from the angle of the line between them, relative to the moment
  // the two-hand grip began.
  #transformTwoHanded(mesh, a, b) {
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);

    if (!this.xform || this.xform.mesh !== mesh) {
      this.xform = { mesh, dist, angle, scale: mesh.scale.x, rot: mesh.rotation.z };
      return; // first frame just records the baseline — no jump
    }

    const s = this.xform.scale * (dist / this.xform.dist);
    mesh.scale.setScalar(Math.min(Math.max(s, 0.2), 6));   // clamp so it can't vanish/explode
    mesh.rotation.z = this.xform.rot + (angle - this.xform.angle);

    // Keep it centered between the hands while transforming.
    mesh.position.x = (a.x + b.x) / 2;
    mesh.position.y = (a.y + b.y) / 2;
  }

  // Which hand indices are currently holding something — for the HUD.
  get grabbing() { return [...this.held.keys()]; }
}

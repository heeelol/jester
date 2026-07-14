// space.js — the single source of truth for mapping a hand's normalized image
// coordinates (0..1) onto the 3D interaction plane. Both the interaction
// controller and the on-screen cursors import this, so a pinch and its cursor
// always land in exactly the same spot.

export const MIRROR = true;   // flip X so mirrored (selfie) motion matches the hand
export const PLANE_W = 8;      // world units spanned horizontally by the view
export const PLANE_H = 4.5;    // ~16:9
export const PLANE_Z = 0;      // holograms live on this depth plane

export function toWorld(p) {
  return {
    x: (MIRROR ? 0.5 - p.x : p.x - 0.5) * PLANE_W,
    y: (0.5 - p.y) * PLANE_H, // image Y grows downward; world Y grows up
    z: PLANE_Z,
  };
}

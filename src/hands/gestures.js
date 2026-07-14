// gestures.js — pure functions over a hand's 21 MediaPipe landmarks.
//
// Each landmark is { x, y, z } in normalized image space (0..1, origin top-left).
// These functions never touch the scene or DOM — they only read landmarks and
// return numbers/booleans. That keeps gesture logic trivial to reason about and test.
//
// Landmark indices we care about:
//   0  wrist        4  thumb tip     8  index tip
//   9  middle MCP  12  middle tip   16  ring tip    20  pinky tip

const WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_MCP = 9, MIDDLE_TIP = 12;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Hand "size" used to normalize distances so thresholds are scale-independent
// (a hand near the camera and one far away report the same pinch strength).
const handSpan = (lm) => dist(lm[WRIST], lm[MIDDLE_MCP]) || 1e-4;

// 0 = fully pinched (thumb touching index), ~1+ = wide open.
export function pinchStrength(lm) {
  return dist(lm[THUMB_TIP], lm[INDEX_TIP]) / handSpan(lm);
}

export const isPinch = (lm) => pinchStrength(lm) < 0.35;

// Midpoint of the thumb+index tips — the point the user is "holding".
export const pinchPoint = (lm) => ({
  x: (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
  y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
});

// A finger is extended when its tip is farther from the wrist than its lower joint.
const extended = (lm, tip, pip) => dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.15;

// Closed fist — all four fingers curled toward the palm.
export const isGrab = (lm) =>
  !extended(lm, 8, 6) && !extended(lm, 12, 10) && !extended(lm, 16, 14) && !extended(lm, 20, 18);

// Open hand with fingers spread.
export const isSpread = (lm) =>
  extended(lm, 8, 6) && extended(lm, 12, 10) && extended(lm, 16, 14) && extended(lm, 20, 18);

// Index only — a pointing gesture.
export const isPoint = (lm) =>
  extended(lm, 8, 6) && !extended(lm, 12, 10) && !extended(lm, 16, 14);

// Human-readable label for the HUD.
export function label(lm) {
  if (isPinch(lm)) return "PINCH";
  if (isPoint(lm)) return "POINT";
  if (isGrab(lm)) return "FIST";
  if (isSpread(lm)) return "OPEN";
  return "…";
}

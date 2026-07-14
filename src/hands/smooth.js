// smooth.js — a one-euro filter over the hand landmarks. It removes tracking
// jitter when a hand is still (so holograms sit rock-steady) while staying
// responsive when the hand moves fast (low lag). This is the single biggest
// "feels premium" upgrade for the demo.
//
// One-euro filter: https://gery.casiez.net/1euro/  — adaptive low-pass whose
// cutoff rises with speed, so slow = very smooth, fast = very responsive.

class LowPass {
  constructor() { this.y = null; }
  filter(x, alpha) { this.y = this.y == null ? x : alpha * x + (1 - alpha) * this.y; return this.y; }
}

class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.03, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = new LowPass(); this.dx = new LowPass(); this.tPrev = null; this.xPrev = 0;
  }
  #alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.tPrev == null) { this.tPrev = t; this.xPrev = x; return this.x.filter(x, 1); }
    let dt = t - this.tPrev; if (dt <= 0) dt = 1 / 60;
    this.tPrev = t;
    const dxv = (x - this.xPrev) / dt; this.xPrev = x;
    const edx = this.dx.filter(dxv, this.#alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(x, this.#alpha(cutoff, dt));
  }
}

export function createHandSmoother() {
  const filters = new Map(); // "slot:landmark" -> { x, y, z }
  const get = (key) => {
    let f = filters.get(key);
    if (!f) { f = { x: new OneEuro(), y: new OneEuro(), z: new OneEuro() }; filters.set(key, f); }
    return f;
  };
  return {
    // Returns a new hands array with smoothed landmark positions.
    smooth(hands, t) {
      return hands.map((h, i) => ({
        handedness: h.handedness,
        landmarks: h.landmarks.map((p, j) => {
          const f = get(`${i}:${j}`);
          return { x: f.x.filter(p.x, t), y: f.y.filter(p.y, t), z: f.z.filter(p.z, t) };
        }),
      }));
    },
  };
}

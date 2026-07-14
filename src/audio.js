// audio.js — procedural sound design via the Web Audio API. No sample files: a
// low ambient hologram hum plus short synthesized cues for boot / spawn / grab /
// dismiss. Sound is the single biggest perceived-quality jump on a demo video.
//
// The AudioContext must be created/resumed from a user gesture (the Initialize
// click), so call start() from there.

export function createAudio() {
  let ctx, master, humming = false;

  const ensure = () => {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  };

  // A short synth tone with an exponential pluck envelope; optional pitch glide.
  const tone = (freq, dur, type = "sine", vol = 0.18, glideTo = null) => {
    ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  };

  // A filtered-noise sweep — the "materialize" whoosh.
  const noiseSweep = (dur, vol = 0.12) => {
    ensure();
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t);
  };

  const startHum = () => {
    if (humming) return; humming = true;
    const g = ctx.createGain(); g.gain.value = 0.035; g.connect(master);
    const o1 = ctx.createOscillator(); o1.type = "sine"; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = 110.5; // slight detune → beating
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.18;
    const lg = ctx.createGain(); lg.gain.value = 0.014;
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(g); o2.connect(g);
    o1.start(); o2.start(); lfo.start();
  };

  return {
    start() { ensure(); if (ctx.state === "suspended") ctx.resume(); startHum(); },
    sfx: {
      boot() { [220, 330, 440, 660].forEach((f, i) => setTimeout(() => tone(f, 0.3, "sine", 0.16), i * 90)); noiseSweep(0.6, 0.1); },
      spawn() { tone(300, 0.4, "sine", 0.2, 900); noiseSweep(0.35, 0.12); },
      grab() { tone(880, 0.07, "square", 0.07); },
      dismiss() { tone(520, 0.3, "sine", 0.16, 120); },
      blip() { tone(1200, 0.05, "sine", 0.05); },
    },
  };
}

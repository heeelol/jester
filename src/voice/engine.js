// engine.js — the desktop voice engine. One AudioContext drives everything:
//
//   • TTS OUT: /tts audio is decoded and played through a gain→analyser graph, so
//     we can (a) measure its live amplitude to PULSE the JESTER model and
//     (b) hard-stop it instantly when the user interrupts.
//   • MIC IN: getUserMedia with echo-cancellation, recorded to /stt (Whisper).
//   • CONVERSATION: continuous voice-activity detection. When you start talking
//     while JESTER is speaking, it BARGES IN — cuts JESTER off, records your
//     utterance, and hands back the transcript. This is the interrupt behaviour.
//
// listenOnce (phone Web Speech) stays in speech.js; this module is for the PC.

const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
const pickMime = () => (MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm");

async function sttBlob(blob, mime) {
  const r = await fetch("/stt", { method: "POST", headers: { "Content-Type": mime }, body: blob });
  const d = await r.json();
  return (d.text || "").trim();
}
const rms = (buf) => { let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); };

export function createVoice() {
  let ctx, ttsGain, ttsAnalyser;
  const ensure = () => {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    ttsGain = ctx.createGain(); ttsGain.connect(ctx.destination);
    ttsAnalyser = ctx.createAnalyser(); ttsAnalyser.fftSize = 256; ttsGain.connect(ttsAnalyser);
    return ctx;
  };

  let queue = Promise.resolve();
  let currentSource = null;
  let generation = 0; // bumped on stop → stale queued lines are dropped

  const init = () => { ensure(); ctx.resume?.(); };

  async function fetchTTS(text) {
    const r = await fetch("/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error("tts " + r.status);
    return r.arrayBuffer();
  }
  const playBuffer = (audioBuf, gen) => new Promise((resolve) => {
    if (gen !== generation) return resolve();
    const src = ctx.createBufferSource();
    src.buffer = audioBuf; src.connect(ttsGain);
    currentSource = src;
    src.onended = () => { if (currentSource === src) currentSource = null; resolve(); };
    src.start();
  });

  function speak(text) {
    if (!text.trim()) return;
    ensure();
    const gen = generation;
    queue = queue.then(async () => {
      if (gen !== generation) return;
      try {
        const ab = await fetchTTS(text);
        if (gen !== generation) return;
        await playBuffer(await ctx.decodeAudioData(ab), gen);
      } catch {
        try { speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* no audio */ }
      }
    });
  }

  function stopSpeaking() {
    generation++;
    try { currentSource?.stop(); } catch { /* already stopped */ }
    currentSource = null;
    try { speechSynthesis.cancel(); } catch { /* n/a */ }
    queue = Promise.resolve();
  }

  const isSpeaking = () => currentSource != null;

  // Live amplitude of JESTER's voice (0..~1) — drives the model pulse.
  function outputLevel() {
    if (!ttsAnalyser || !currentSource) return 0;
    const b = new Uint8Array(ttsAnalyser.fftSize);
    ttsAnalyser.getByteTimeDomainData(b);
    return rms(b);
  }

  function sentenceSpeaker() {
    let buf = "";
    const flush = (force = false) => {
      let m;
      while ((m = buf.match(/^(.*?[.!?…])\s+/s))) { speak(m[1]); buf = buf.slice(m[0].length); }
      if (force && buf.trim()) { speak(buf); buf = ""; }
    };
    return { feed: (d) => { buf += d; flush(); }, end: () => flush(true) };
  }

  // Single-shot record → transcribe (used by the mic button / phone-less prompt).
  async function transcribeOnce({ onState } = {}) {
    ensure(); await ctx.resume?.();
    const stream = await navigator.mediaDevices.getUserMedia(MIC);
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const START = performance.now();
    let lastLoud = START, spoke = false;
    const MAX = 9000, SIL = 1200, TH = 0.02;
    return new Promise((resolve, reject) => {
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); onState?.("done");
        if (!chunks.length) return resolve("");
        try { resolve(await sttBlob(new Blob(chunks, { type: mime }), mime)); } catch (e) { reject(e); }
      };
      rec.start(); onState?.("listening");
      const tick = () => {
        if (rec.state !== "recording") return;
        an.getByteTimeDomainData(buf);
        const level = rms(buf), now = performance.now();
        if (level > TH) { lastLoud = now; spoke = true; }
        if (now - START > MAX || (spoke && now - lastLoud > SIL)) return rec.stop();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // Continuous conversation with barge-in.
  let convo = null;
  async function startConversation({ onTranscript, onState } = {}) {
    stopConversation();
    ensure(); await ctx.resume?.();
    const stream = await navigator.mediaDevices.getUserMedia(MIC);
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const mime = pickMime();
    let active = true, recording = false, rec, chunks = [], speechStart = 0, lastLoud = 0, loud = 0;
    const TH = 0.05, SIL = 900, MAX = 9000, ONSET = 3; // 3 loud frames = you're speaking
    convo = { stop: () => { active = false; try { rec?.state === "recording" && rec.stop(); } catch {} stream.getTracks().forEach((t) => t.stop()); } };
    onState?.("idle");

    const tick = () => {
      if (!active) return;
      an.getByteTimeDomainData(buf);
      const level = rms(buf), now = performance.now();
      if (!recording) {
        loud = level > TH ? loud + 1 : 0;
        if (loud >= ONSET) {
          stopSpeaking();               // BARGE-IN: cut JESTER off
          onState?.("listening");
          recording = true; chunks = []; speechStart = now; lastLoud = now; loud = 0;
          rec = new MediaRecorder(stream, { mimeType: mime });
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          rec.onstop = async () => {
            recording = false; onState?.("idle");
            try { const text = await sttBlob(new Blob(chunks, { type: mime }), mime); if (text) onTranscript?.(text); } catch { /* drop */ }
          };
          rec.start();
        }
      } else {
        if (level > TH) lastLoud = now;
        if (now - speechStart > MAX || now - lastLoud > SIL) rec.stop();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function stopConversation() { convo?.stop?.(); convo = null; }

  return { init, speak, stopSpeaking, isSpeaking, outputLevel, sentenceSpeaker, transcribeOnce, startConversation, stopConversation };
}

// speech.js — voice in and out.
//
// OUT: speak() plays OpenAI TTS from /tts (a real JESTER voice), falling back to
//      the browser's built-in synth if that fails.
// IN:  transcribeOnce() records the mic with silence-detection and sends it to
//      /stt (Whisper). This works inside Electron, where the browser Web Speech
//      recognition API does not. listenOnce() (Web Speech) is kept for the phone,
//      where it's fast and reliable.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// ── Speech in (phone): Web Speech API ──────────────────────────────────────
export function listenOnce({ onInterim } = {}) {
  return new Promise((resolve, reject) => {
    if (!SpeechRecognition) return reject(new Error("SpeechRecognition unsupported"));
    const rec = new SpeechRecognition();
    rec.lang = "en-US"; rec.interimResults = true; rec.maxAlternatives = 1;
    let final = "";
    rec.onresult = (e) => {
      let interim = "";
      for (const r of e.results) { if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; }
      onInterim?.(interim || final);
    };
    rec.onerror = (e) => reject(new Error(e.error));
    rec.onend = () => resolve(final.trim());
    rec.start();
  });
}

// ── Speech in (desktop): record → Whisper ──────────────────────────────────
export async function transcribeOnce({ onState } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  // Silence detection: stop ~1.2s after speech ends, or after 9s hard cap.
  const ac = new AudioContext();
  const analyser = ac.createAnalyser(); analyser.fftSize = 512;
  ac.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const START = performance.now();
  let lastLoud = START, spoke = false;
  const MAX_MS = 9000, SILENCE_MS = 1200, THRESH = 0.02;

  return new Promise((resolve, reject) => {
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      ac.close().catch(() => {});
      onState?.("done");
      if (!chunks.length) return resolve("");
      try {
        const blob = new Blob(chunks, { type: mime });
        const res = await fetch("/stt", { method: "POST", headers: { "Content-Type": mime }, body: blob });
        const data = await res.json();
        resolve((data.text || "").trim());
      } catch (err) { reject(err); }
    };
    rec.start();
    onState?.("listening");
    const tick = () => {
      if (rec.state !== "recording") return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > THRESH) { lastLoud = now; spoke = true; }
      if (now - START > MAX_MS || (spoke && now - lastLoud > SILENCE_MS)) return rec.stop();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ── Speech out: OpenAI TTS with a browser fallback ─────────────────────────
let chain = Promise.resolve(); // serialise playback so lines don't overlap

async function playTTS(text) {
  const res = await fetch("/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error("tts " + res.status);
  const url = URL.createObjectURL(await res.blob());
  const audio = new Audio(url);
  await new Promise((done) => { audio.onended = done; audio.onerror = done; audio.play().catch(done); });
  URL.revokeObjectURL(url);
}

function browserSpeak(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05; u.pitch = 0.9;
  speechSynthesis.speak(u);
}

export function speak(text) {
  if (!text.trim()) return;
  chain = chain.then(() => playTTS(text)).catch(() => browserSpeak(text));
}

// Speaks each complete sentence as it streams in — the first sentence plays
// while later ones are still being generated.
export function sentenceSpeaker() {
  let buffer = "";
  const flush = (force = false) => {
    let m;
    while ((m = buffer.match(/^(.*?[.!?…])\s+/s))) { speak(m[1]); buffer = buffer.slice(m[0].length); }
    if (force && buffer.trim()) { speak(buffer); buffer = ""; }
  };
  return { feed: (delta) => { buffer += delta; flush(); }, end: () => flush(true) };
}

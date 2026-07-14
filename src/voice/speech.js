// speech.js — browser speech in and out, via the Web Speech API. No cloud, no
// keys, no latency: recognition and synthesis both run in Chrome.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// One-shot listen: resolves the final transcript of a single utterance.
export function listenOnce({ onInterim } = {}) {
  return new Promise((resolve, reject) => {
    if (!SpeechRecognition) return reject(new Error("SpeechRecognition unsupported (use Chrome)"));
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let final = "";
    rec.onresult = (e) => {
      let interim = "";
      for (const r of e.results) {
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim?.(interim || final);
    };
    rec.onerror = (e) => reject(new Error(e.error));
    rec.onend = () => resolve(final.trim());
    rec.start();
  });
}

// Pick a voice that sounds the part — prefer a British male ("Daniel" on most
// systems), falling back to any English voice.
function jesterVoice() {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => /daniel|george|arthur/i.test(v.name)) ||
    voices.find((v) => v.lang === "en-GB") ||
    voices.find((v) => v.lang.startsWith("en")) ||
    voices[0]
  );
}

export function speak(text) {
  if (!text.trim()) return;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = jesterVoice();
  u.rate = 1.05;
  u.pitch = 0.9;
  speechSynthesis.speak(u);
}

// Accumulates streamed text deltas and speaks each complete sentence as soon as
// it arrives — this is what makes JESTER feel like it's replying in real time
// instead of after the whole response is generated.
export function sentenceSpeaker() {
  let buffer = "";
  const flush = (force = false) => {
    let m;
    while ((m = buffer.match(/^(.*?[.!?…])\s+/s))) {
      speak(m[1]);
      buffer = buffer.slice(m[0].length);
    }
    if (force && buffer.trim()) { speak(buffer); buffer = ""; }
  };
  return {
    feed: (delta) => { buffer += delta; flush(); },
    end: () => flush(true),
  };
}

// Some browsers populate the voice list asynchronously; nudge it early.
if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();

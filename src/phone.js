// phone.js — the CONTROLLER (your phone). It runs the camera + hand tracking and
// streams landmarks (and voice transcripts) to the paired display over WebSocket.
// It renders no holograms itself — it's a pure input device.

import { createHandTracker } from "./hands/tracker.js";
import { label as gestureLabel } from "./hands/gestures.js";
import { createLink } from "./net/link.js";

// Record a spoken utterance and transcribe it via the server's Whisper endpoint.
// This works on iOS Safari (which has no Web Speech recognition) and doesn't need
// a PC microphone — the phone is the mic.
async function recordAndTranscribe(onState) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC(); await ac.resume?.();
  const an = ac.createAnalyser(); an.fftSize = 512;
  ac.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  const START = performance.now(); let lastLoud = START, spoke = false;
  const MAX = 9000, SIL = 1200, TH = 0.02;
  return new Promise((resolve) => {
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); ac.close?.();
      if (!chunks.length) return resolve("");
      const type = rec.mimeType || mime || "audio/webm";
      try {
        const r = await fetch("/stt", { method: "POST", headers: { "Content-Type": type }, body: new Blob(chunks, { type }) });
        const d = await r.json();
        resolve((d.text || "").trim());
      } catch { resolve(""); }
    };
    rec.start(); onState?.("listening");
    const tick = () => {
      if (rec.state !== "recording") return;
      an.getByteTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
      const rms = Math.sqrt(s / buf.length), now = performance.now();
      if (rms > TH) { lastLoud = now; spoke = true; }
      if (now - START > MAX || (spoke && now - lastLoud > SIL)) return rec.stop();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const $ = (id) => document.getElementById(id);
const room = (new URLSearchParams(location.search).get("room") || "").toUpperCase();

// Hand-skeleton topology, for on-phone visual feedback.
const BONES = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17],
];

let facing = "user";
let stream = null;

async function openCamera(video) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
  video.srcObject = stream;
  await video.play();
}

// Shrink landmarks before sending: strip to {x,y,z} at 3 decimals.
const pack = (hands) =>
  hands.map((h) => ({
    handedness: h.handedness,
    landmarks: h.landmarks.map((p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) })),
  }));

function drawSkeleton(canvas, hands) {
  const ctx = canvas.getContext("2d");
  if (canvas.width !== innerWidth) { canvas.width = innerWidth; canvas.height = innerHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.shadowColor = "rgba(89,216,255,0.9)"; ctx.shadowBlur = 10;
  ctx.strokeStyle = "rgba(120,225,255,0.9)"; ctx.lineWidth = 2.5;
  for (const { landmarks } of hands) {
    const px = (p) => [p.x * canvas.width, p.y * canvas.height];
    for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(...px(landmarks[a])); ctx.lineTo(...px(landmarks[b])); ctx.stroke(); }
    ctx.fillStyle = "#eafcff";
    for (const p of landmarks) { const [x, y] = px(p); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.shadowBlur = 0;
}

async function main() {
  const video = $("video");
  await openCamera(video);
  const tracker = await createHandTracker();

  const setStatus = (text, on) => {
    $("status").textContent = text;
    $("dot").classList.toggle("on", !!on);
  };
  setStatus("LINKING…", false);

  const link = createLink({
    role: "phone",
    room,
    onMessage: (msg) => {
      if (msg.type === "peer" && msg.role === "display") {
        if (msg.state === "joined") setStatus("CONTROLLING DISPLAY", true);
        else if (msg.state === "waiting") setStatus("WAITING FOR DISPLAY…", false);
        else if (msg.state === "left") setStatus("DISPLAY DISCONNECTED", false);
      }
    },
    onClose: () => setStatus("DISCONNECTED", false),
  });

  // Voice: record on the phone → Whisper → send the transcript to the display,
  // which speaks + acts. Works on any phone (iOS included).
  let listening = false;
  $("mic").addEventListener("click", async () => {
    if (listening) return;
    listening = true;
    try {
      setStatus("LISTENING… speak now", true);
      const transcript = await recordAndTranscribe();
      if (transcript) link.send({ type: "speech", transcript });
      setStatus(transcript ? "SENT: " + transcript.slice(0, 40) : "CONTROLLING DISPLAY", true);
    } catch (e) {
      console.error(e); setStatus("MIC ERROR — allow microphone access", true);
    } finally { listening = false; }
  });

  $("flip").addEventListener("click", async () => {
    facing = facing === "user" ? "environment" : "user";
    try { await openCamera(video); } catch (e) { console.error(e); }
  });

  // Track + stream every frame.
  const overlay = $("overlay");
  function frame(now) {
    const hands = tracker.detect(video, now);
    drawSkeleton(overlay, hands);
    link.send({ type: "hands", hands: pack(hands) });
    if ($("dot").classList.contains("on")) {
      // keep the gesture readout fresh once connected
      $("status").textContent = hands.length
        ? "CONTROLLING · " + hands.map((h) => gestureLabel(h.landmarks)).join(" ")
        : "CONTROLLING DISPLAY";
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

$("go").addEventListener("click", () => {
  if (!room) { alert("No room code — open this page via the QR code on the display."); return; }
  $("start").remove();
  main().catch((err) => { console.error(err); alert("Could not start: " + err.message + "\n\nUse Chrome, and allow the camera."); });
});

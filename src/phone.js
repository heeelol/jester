// phone.js — the CONTROLLER (your phone). It runs the camera + hand tracking and
// streams landmarks (and voice transcripts) to the paired display over WebSocket.
// It renders no holograms itself — it's a pure input device.

import { createHandTracker } from "./hands/tracker.js";
import { label as gestureLabel } from "./hands/gestures.js";
import { createLink } from "./net/link.js";

// Tap-to-start / tap-to-stop recording, transcribed via the server's Whisper
// endpoint. Explicit start/stop (no silence detection) is the most reliable path
// across phones, including iOS Safari (which has no Web Speech recognition).
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""].find((t) => t === "" || MediaRecorder.isTypeSupported(t));
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () => new Promise((resolve, reject) => {
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!chunks.length) return resolve("");
        const type = rec.mimeType || "audio/webm";
        try {
          const r = await fetch("/stt", { method: "POST", headers: { "Content-Type": type }, body: new Blob(chunks, { type }) });
          if (!r.ok) return reject(new Error("stt " + r.status));
          const d = await r.json();
          resolve((d.text || "").trim());
        } catch (e) { reject(e); }
      };
      rec.stop();
    }),
  };
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

  // Voice: tap to start recording, tap again to stop → Whisper → send transcript.
  let recorder = null;
  const micBtn = $("mic");
  micBtn.addEventListener("click", async () => {
    if (!recorder) {
      try {
        recorder = await startRecording();
        micBtn.textContent = "⏹ STOP";
        setStatus("RECORDING… tap STOP when done", true);
      } catch (e) {
        console.error(e); recorder = null;
        setStatus("MIC BLOCKED: " + (e.message || e) + " — allow microphone", true);
      }
      return;
    }
    // Stop → transcribe → send.
    const r = recorder; recorder = null;
    micBtn.textContent = "🎤 SPEAK";
    setStatus("TRANSCRIBING…", true);
    try {
      const text = await r.stop();
      if (text) { link.send({ type: "speech", transcript: text }); setStatus("SENT: " + text.slice(0, 45), true); }
      else setStatus("NO SPEECH HEARD — try again, closer to the mic", true);
    } catch (e) {
      console.error(e); setStatus("TRANSCRIBE FAILED: " + (e.message || e), true);
    }
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

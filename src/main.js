// main.js — the DISPLAY (big screen). It renders the holographic scene and runs
// JESTER's voice, but takes its hand input from a paired phone over WebSocket:
//
//   phone camera → landmarks → server relay → (here) controller + cursors → scene
//   phone mic    → transcript → server relay → (here) JESTER → speech + actions
//
// A single-device fallback ("use this device's camera") lets the same page run
// standalone with a laptop webcam.

import { createScene } from "./scene/objects.js";
import { createCursors } from "./scene/cursors.js";
import { createHandTracker } from "./hands/tracker.js";
import { InteractionController } from "./interaction/controller.js";
import { label as gestureLabel } from "./hands/gestures.js";
import { createHUD } from "./hud.js";
import { askJester } from "./voice/jester.js";
import { listenOnce, speak, sentenceSpeaker } from "./voice/speech.js";
import { createLink } from "./net/link.js";

const $ = (id) => document.getElementById(id);
const randomRoom = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

// Translate a JESTER action into a scene mutation — the single place voice
// commands touch the world.
function applyAction(scene, action) {
  const last = scene.grabbables[scene.grabbables.length - 1];
  switch (action?.command) {
    case "spawn":   scene.spawn(action.target && action.target !== "all" ? action.target : "reactor"); break;
    case "dismiss": (action.target === "all" || !last) ? scene.dismissAll() : scene.dismiss(last); break;
    case "reset":   scene.dismissAll(); break;
    case "rotate":  if (last) last.rotation.y += (action.amount || 1) * 0.8; break;
    case "scale":   if (last) last.scale.multiplyScalar(action.amount && action.amount > 0 ? action.amount : 1.3); break;
  }
}

async function main() {
  const hud = createHUD();
  const scene = createScene($("scene"));
  const cursors = createCursors(scene.scene);
  const controller = new InteractionController(scene.grabbables);
  const speaker = sentenceSpeaker();
  scene.spawn("reactor");

  let hands = [];       // latest hand landmarks (from phone or local camera)
  let localMode = false;
  let tracker = null;

  // Run one JESTER turn. With `preset` (phone speech) we skip local listening.
  async function converse(preset) {
    try {
      let transcript = preset;
      if (transcript == null) {
        hud.status("listening"); hud.subtitle("…");
        transcript = await listenOnce({ onInterim: (t) => hud.subtitle(t) });
      }
      if (!transcript) { hud.status("online"); hud.subtitle(""); return; }

      hud.status("thinking");
      let said = "";
      await askJester(transcript, {
        onSay: (delta) => { said += delta; hud.subtitle(said); speaker.feed(delta); },
        onAction: (action) => applyAction(scene, action),
        onDone: () => { speaker.end(); hud.status("online"); },
      });
    } catch (err) {
      console.error(err); hud.status("error"); speak("I'm afraid I ran into a problem, sir.");
    }
  }
  hud.micButton.addEventListener("click", () => converse());

  // Pairing: generate a room, show the QR, connect as the display.
  const room = randomRoom();
  const phoneURL = `${location.origin}/phone.html?room=${room}`;
  $("pair-code").textContent = room;
  $("pair-url").textContent = phoneURL;
  $("qr").src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(phoneURL)}`;
  $("boot").remove();
  $("pair").style.display = "flex";

  const link = createLink({
    role: "display",
    room,
    onMessage: (msg) => {
      if (msg.type === "hands") hands = msg.hands || [];
      else if (msg.type === "speech") converse(msg.transcript);
      else if (msg.type === "peer" && msg.role === "phone") {
        if (msg.state === "joined") {
          $("pair").style.display = "none";
          hud.status("online");
          speak("Controller linked. Do try to keep up, sir.");
        } else if (msg.state === "left") {
          hud.status("standby"); hud.subtitle("Controller disconnected");
        }
      }
    },
  });

  // Fallback: drive the display from this device's own webcam.
  $("use-local").addEventListener("click", async () => {
    try {
      const video = $("video");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      video.srcObject = stream; await video.play();
      $("cam").style.display = "block";
      tracker = await createHandTracker();
      localMode = true;
      $("pair").style.display = "none";
      hud.status("online");
      speak("Local camera engaged, sir.");
    } catch (err) { console.error(err); alert("Camera failed: " + err.message); }
  });

  // Render loop: consume whichever hand source is active, drive scene + cursors.
  function frame(now) {
    const t = now / 1000;
    if (localMode && tracker) hands = tracker.detect($("video"), now);
    controller.update(hands);
    cursors.update(hands, t);
    hud.drawHands($("overlay"), hands);
    hud.handCount(hands.map((h) => gestureLabel(h.landmarks)));
    scene.render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => {
  main().catch((err) => { console.error(err); alert("Startup failed: " + err.message); });
});

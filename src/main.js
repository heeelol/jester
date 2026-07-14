// main.js — boot sequence and the per-frame loop that wires everything together:
//   webcam → hand tracker → interaction controller → three.js render
//   mic → JESTER brain → speech + scene actions
//
// Both the hands and the voice drive the SAME scene API, so "pull up the reactor"
// and physically grabbing it are just two paths into the same commands.

import { createScene } from "./scene/objects.js";
import { createCursors } from "./scene/cursors.js";
import { createHandTracker } from "./hands/tracker.js";
import { InteractionController } from "./interaction/controller.js";
import { label as gestureLabel } from "./hands/gestures.js";
import { createHUD } from "./hud.js";
import { askJester } from "./voice/jester.js";
import { listenOnce, speak, sentenceSpeaker } from "./voice/speech.js";

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const boot = document.getElementById("boot");

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  video.srcObject = stream;
  await video.play();
}

// Translate a JESTER action into a scene mutation. This is the single place
// voice commands touch the world.
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
  hud.status("booting");

  await startCamera();
  const scene = createScene(document.getElementById("scene"));
  const cursors = createCursors(scene.scene);
  const tracker = await createHandTracker();
  const controller = new InteractionController(scene.grabbables);
  const speaker = sentenceSpeaker();

  scene.spawn("reactor"); // something on screen from frame one
  hud.status("online");
  speak("Systems online. Do try to keep up, sir.");

  // Mic → JESTER. Listen for one utterance, stream the reply to TTS + scene.
  async function converse() {
    try {
      hud.status("listening");
      hud.subtitle("…");
      const transcript = await listenOnce({ onInterim: (t) => hud.subtitle(t) });
      if (!transcript) { hud.status("online"); hud.subtitle(""); return; }

      hud.status("thinking");
      let said = "";
      await askJester(transcript, {
        onSay: (delta) => { said += delta; hud.subtitle(said); speaker.feed(delta); },
        onAction: (action) => applyAction(scene, action),
        onDone: () => { speaker.end(); hud.status("online"); },
      });
    } catch (err) {
      console.error(err);
      hud.status("error");
      speak("I'm afraid I ran into a problem.");
    }
  }
  hud.micButton.addEventListener("click", converse);

  // Main loop: track hands, drive interaction, render.
  function frame(now) {
    const t = now / 1000;
    const hands = tracker.detect(video, now);
    controller.update(hands);
    cursors.update(hands, t);
    hud.drawHands(overlay, hands);
    hud.handCount(hands.map((h) => gestureLabel(h.landmarks)));
    scene.render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

document.getElementById("start").addEventListener("click", async () => { // JESTER boot
  boot.remove();
  try {
    await main();
  } catch (err) {
    console.error(err);
    alert("Startup failed: " + err.message + "\n\nUse Chrome, and allow camera + mic.");
  }
});

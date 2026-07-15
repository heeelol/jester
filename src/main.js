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
import { createEffects } from "./scene/effects.js";
import { createDeck } from "./files/deck.js";
import { createAudio } from "./audio.js";
import { createHandTracker } from "./hands/tracker.js";
import { createHandSmoother } from "./hands/smooth.js";
import { InteractionController } from "./interaction/controller.js";
import { label as gestureLabel } from "./hands/gestures.js";
import { createHUD } from "./hud.js";
import { askJester } from "./voice/jester.js";
import { QUIPS, pick } from "./voice/quips.js";
import { createVoice } from "./voice/engine.js";
import { createAvatar } from "./scene/avatar.js";
import { createLink } from "./net/link.js";

const $ = (id) => document.getElementById(id);
const randomRoom = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

// Translate a JESTER action into a scene mutation — the single place voice
// commands touch the world. `fx` = { audio, effects } for sound + particles.
function applyAction(scene, action, fx) {
  const last = scene.grabbables[scene.grabbables.length - 1];
  switch (action?.command) {
    case "spawn": {
      const obj = scene.spawn(action.target && action.target !== "all" ? action.target : "reactor");
      fx.effects.shockwave(obj.position); fx.audio.sfx.spawn();
      break;
    }
    case "dismiss": (action.target === "all" || !last) ? scene.dismissAll() : scene.dismiss(last); fx.audio.sfx.dismiss(); break;
    case "reset":   scene.dismissAll(); fx.audio.sfx.dismiss(); break;
    case "rotate":  if (last) last.rotation.y += (action.amount || 1) * 0.8; break;
    case "scale":   if (last) last.scale.multiplyScalar(action.amount && action.amount > 0 ? action.amount : 1.3); break;
  }
}

async function main() {
  const hud = createHUD();
  const scene = createScene($("scene"));
  const cursors = createCursors(scene.scene);
  const effects = createEffects(scene.scene);
  const audio = createAudio();
  audio.start(); // within the Initialize-click gesture, so the AudioContext is allowed
  const fx = { audio, effects };
  const controller = new InteractionController(scene.grabbables, {
    onGrab: (p) => { audio.sfx.grab(); effects.burst(p); },
  });
  const smoother = createHandSmoother();
  const deck = createDeck(scene.scene, scene.camera, { maxAnisotropy: scene.maxAnisotropy });
  const voice = createVoice();
  voice.init(); // create the AudioContext within the Initialize-click gesture
  const speak = (t) => voice.speak(t);
  const avatar = createAvatar(scene.scene); // JESTER's pulsing presence
  const reactor = scene.spawn("reactor");
  let turn = 0; // conversation turn id — lets a new utterance interrupt an old reply

  // Holographic media deck: connect a folder → files fan out as tiles you browse
  // with point + pinch. While the deck is active, gestures drive the deck (not
  // the hologram grab) so pinches don't fight.
  const filesBtn = $("files-btn");
  filesBtn.addEventListener("click", async () => {
    if (deck.active) {
      deck.close(); filesBtn.textContent = "◫ CONNECT FILES";
      return;
    }
    try {
      const ok = await deck.connect();
      if (ok) { filesBtn.textContent = "✕ CLOSE FILES"; speak("Behold, your files, sir. Point and pinch."); }
    } catch (e) { console.error(e); alert("Couldn't open files: " + (e?.message || e)); }
  });

  // A little power-on flourish once a hand source is live.
  const bootFlourish = () => { audio.sfx.boot(); effects.shockwave(reactor.position); filesBtn.style.display = "block"; };

  // ── Mainframe (Electron desktop overlay) ─────────────────────────────────
  // In the desktop app, `window.jester` is present. "Enter the mainframe" flips
  // the window to a transparent, click-through overlay over the live desktop and
  // unlocks voice PC control. In a plain browser this all no-ops gracefully.
  const jester = window.jester;
  let mainframe = false;

  const enterMainframe = (callNative = true) => {
    if (mainframe) return;
    mainframe = true;
    document.body.classList.add("mainframe");
    scene.setOverlayMode(true); // 3D renders transparent over the live desktop
    hud.status("mainframe"); hud.flash("MAINFRAME ONLINE"); audio.sfx.boot();
    if (callNative) jester?.enterMainframe();
  };
  const exitMainframe = (callNative = true) => {
    if (!mainframe) return;
    mainframe = false;
    document.body.classList.remove("mainframe");
    scene.setOverlayMode(false);
    hud.status("online"); audio.sfx.dismiss();
    if (callNative) jester?.exitMainframe();
  };

  const PC_CMDS = new Set(["launch_app", "open_url", "show_desktop", "lock_pc"]);
  const handlePc = (action) => {
    if (!jester) { speak("The mainframe needs the desktop app, sir — run me with 'npm run app'."); return; }
    if (!mainframe) { speak("Enter the mainframe first, sir."); return; }
    switch (action.command) {
      case "launch_app":   jester.launchApp(action.app || action.target); break;
      case "open_url":     jester.systemCommand("open_url", action.url); break;
      case "show_desktop": jester.systemCommand("show_desktop"); break;
      case "lock_pc":      jester.systemCommand("lock"); break;
    }
  };

  let hands = [];       // latest hand landmarks (from phone or local camera)
  let localMode = false;
  let tracker = null;

  const idleStatus = () => (mainframe ? "mainframe" : "online");

  // Run one JESTER turn. A fresh utterance (preset from phone/conversation, or a
  // one-shot recording) INTERRUPTS whatever JESTER is currently saying, and the
  // turn id guards against a stale reply landing after you've moved on.
  async function converse(preset) {
    voice.stopSpeaking();            // barge-in: cut off the current reply
    const myTurn = ++turn;
    const spk = voice.sentenceSpeaker();
    try {
      let transcript = preset;
      if (transcript == null) {
        hud.status("listening"); hud.subtitle("Listening…");
        transcript = await voice.transcribeOnce();
      }
      if (myTurn !== turn) return;
      if (!transcript) { hud.status(idleStatus()); hud.subtitle(""); return; }

      // Mainframe enter/exit is handled locally so the hero moment is 100% reliable.
      const low = transcript.toLowerCase();
      if (low.includes("mainframe")) {
        if (/\b(exit|leave|back|out|close|quit|sandbox)\b/.test(low)) { exitMainframe(); speak("Returning to the sandbox, sir."); }
        else { enterMainframe(); speak("Entering the mainframe. Do behave, sir."); }
        hud.subtitle(""); return;
      }

      hud.status("thinking");
      let said = "";
      await askJester(transcript, {
        onSay: (delta) => { if (myTurn !== turn) return; said += delta; hud.subtitle(said); spk.feed(delta); },
        onAction: (action) => { if (myTurn !== turn) return; if (PC_CMDS.has(action?.command)) handlePc(action); else applyAction(scene, action, fx); },
        onDone: () => { if (myTurn !== turn) return; spk.end(); hud.status(idleStatus()); },
      });
    } catch (err) {
      if (myTurn !== turn) return;
      console.error(err); hud.status("error"); speak(pick(QUIPS.fallback));
    }
  }

  // Continuous, interruptible conversation using the PC mic (barge-in). Toggle
  // with the mic button / voice hotkey. Phone speech interrupts too (each phone
  // utterance calls converse(), which stops the current reply).
  let convoOn = false;
  async function toggleConversation() {
    if (convoOn) {
      convoOn = false; voice.stopConversation(); voice.stopSpeaking();
      hud.status(idleStatus()); hud.subtitle("");
      return;
    }
    try {
      convoOn = true;
      hud.status("listening"); hud.subtitle("Listening — speak any time, interrupt me freely.");
      await voice.startConversation({ onTranscript: (t) => converse(t) });
    } catch (err) {
      convoOn = false; console.error(err);
      hud.status(idleStatus());
      hud.subtitle("No microphone on this device — talk using your phone.");
      speak("I can't find a microphone, sir. Talk to me through the phone instead.");
    }
  }
  hud.micButton.addEventListener("click", toggleConversation);

  // Desktop-app hooks: global shortcut toggles conversation (works under the
  // click-through overlay), and native-driven mainframe enter/exit.
  jester?.onVoiceListen?.(() => toggleConversation());
  jester?.onEnterMainframe?.(() => enterMainframe(false));
  jester?.onExitMainframe?.(() => exitMainframe(false));

  // Pairing: generate a room, show the QR, connect as the display.
  // The phone can't reach localhost, so the phone URL uses a public base when one
  // is provided (?pub=<tunnel> — set by the Electron shell via JESTER_PUBLIC).
  const room = randomRoom();
  const phoneBase = new URLSearchParams(location.search).get("pub") || location.origin;
  const phoneURL = `${phoneBase}/phone.html?room=${room}`;
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
          hud.flash("CONTROLLER LINKED");
          bootFlourish();
          speak("Controller linked. Try not to embarrass us both, sir.");
        } else if (msg.state === "left") {
          hud.status("standby"); hud.subtitle("Controller disconnected");
        }
      }
    },
  });

  // Continue without any controller (e.g. a PC with no camera): dismiss pairing
  // and start the session — voice + files + avatar work; hands come later if a
  // phone pairs.
  $("skip-pair").addEventListener("click", () => {
    $("pair").style.display = "none";
    hud.status("online");
    bootFlourish();
    speak("Running without a controller, sir. Voice and files at your service.");
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
      bootFlourish();
      speak("Local camera engaged. I'll pretend not to watch, sir.");
    } catch (err) { console.error(err); alert("Camera failed: " + err.message); }
  });

  // Render loop: consume whichever hand source is active, drive scene + cursors.
  let prev = 0;
  function frame(now) {
    const t = now / 1000;
    const dt = Math.min(t - prev, 0.05); prev = t;
    if (localMode && tracker) hands = tracker.detect($("video"), now);
    const smoothed = smoother.smooth(hands, t); // de-jittered for steady holograms
    // In file-browsing mode gestures drive the deck; otherwise they grab holograms.
    if (deck.active) deck.update(smoothed, dt);
    else controller.update(smoothed);
    // Sharpen media by cutting the bloom haze while a photo/video is open.
    scene.setBloom(deck.isOpen ? 0.12 : 0.55);
    cursors.update(smoothed, t);
    effects.update(dt);
    avatar.update(voice.outputLevel(), t); // pulse with JESTER's voice
    hud.drawHands($("overlay"), smoothed);
    hud.handCount(smoothed.map((h) => gestureLabel(h.landmarks)));
    scene.render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => {
  main().catch((err) => { console.error(err); alert("Startup failed: " + err.message); });
});

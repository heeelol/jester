// main.js — the DISPLAY (big screen). It renders the holographic scene and runs
// JESTER's voice, but takes its hand input from a paired phone over WebSocket:
//
//   phone camera → landmarks → server relay → (here) controller + cursors → scene
//   phone mic    → transcript → server relay → (here) JESTER → speech + actions
//
// A single-device fallback ("use this device's camera") lets the same page run
// standalone with a laptop webcam.

import * as THREE from "three";
import { createScene } from "./scene/objects.js";
import { createCursors } from "./scene/cursors.js";
import { createEffects } from "./scene/effects.js";
import { createDeck } from "./files/deck.js";
import { createResults } from "./scene/results.js";
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
import { report } from "./report.js";

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

  // Tell the user (and us) what input hardware this PC actually has.
  navigator.mediaDevices?.enumerateDevices?.().then((ds) => {
    const mics = ds.filter((d) => d.kind === "audioinput").length;
    const cams = ds.filter((d) => d.kind === "videoinput").length;
    console.log(`[jester] devices: ${mics} mic(s), ${cams} camera(s)`);
    if (!mics) hud.subtitle("No microphone on this PC — use your phone's mic (🎤 on the phone) to talk.");
  }).catch(() => {});
  const avatar = createAvatar(scene.scene); // JESTER's pulsing presence — the only default model
  let turn = 0; // conversation turn id — lets a new utterance interrupt an old reply

  // Where the avatar should drift to (voice "move to the top-left", or mainframe).
  const avatarTarget = new THREE.Vector3(0, 1.35, 0);
  const AVATAR_POS = {
    "top-left": [-3.6, 1.9, 0], "top-right": [3.6, 1.9, 0],
    "bottom-left": [-3.6, -1.6, 0], "bottom-right": [3.6, -1.6, 0],
    "center": [0, 0.6, 0], left: [-3.6, 0.6, 0], right: [3.6, 0.6, 0],
    top: [0, 2.0, 0], bottom: [0, -1.6, 0],
  };
  const moveAvatar = (name) => { const p = AVATAR_POS[String(name || "").toLowerCase()]; if (p) avatarTarget.set(p[0], p[1], p[2]); };

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
  const bootFlourish = () => { audio.sfx.boot(); effects.shockwave(avatar.object.position); filesBtn.style.display = "block"; };

  // ── Mainframe (Electron desktop overlay) ─────────────────────────────────
  // In the desktop app, `window.jester` is present. "Enter the mainframe" flips
  // the window to a transparent, click-through overlay over the live desktop and
  // unlocks voice PC control. In a plain browser this all no-ops gracefully.
  const jester = window.jester;
  let mainframe = false;

  const enterMainframe = (callNative = true) => {
    if (mainframe) return;
    mainframe = true;
    if (deck.active) { deck.close(); filesBtn.textContent = "◫ CONNECT FILES"; } // close any open folders
    document.body.classList.add("mainframe");
    scene.setOverlayMode(true);                                   // transparent over the desktop
    avatarTarget.set(3.6, 1.9, 0); avatar.object.scale.setScalar(0.5); // tuck into the top-right
    hud.status("mainframe"); hud.flash("MAINFRAME ONLINE"); audio.sfx.boot();
    hud.subtitle("Listening — just speak. e.g. “open spotify”, “open discord”.");
    // Voice-activated: no clicking. Continuous listening with barge-in.
    voice.startConversation({ onTranscript: (tt) => converse(tt) })
      .catch((e) => { console.error(e); hud.subtitle("No microphone here — use the phone’s 🎤."); });
    if (callNative) jester?.enterMainframe();
  };
  const exitMainframe = (callNative = true) => {
    if (!mainframe) return;
    mainframe = false;
    document.body.classList.remove("mainframe");
    scene.setOverlayMode(false);
    avatarTarget.set(0, 1.35, 0); avatar.object.scale.setScalar(1);
    results.clear(); pendingResults = [];
    voice.stopConversation(); voice.stopSpeaking();
    hud.status("online"); hud.subtitle(""); audio.sfx.dismiss();
    if (callNative) jester?.exitMainframe();
  };

  const MEDIA = new Set(["volume_up", "volume_down", "mute", "play_pause", "next_track", "previous_track", "fullscreen", "minimize", "maximize"]);
  const PC_CMDS = new Set(["launch_app", "close_app", "open_url", "show_desktop", "lock_pc", "web_search", ...MEDIA]);
  const handlePc = (action) => {
    if (!jester) { speak("The mainframe needs the desktop app, sir — run me with 'npm run app'."); return; }
    if (!mainframe) { speak("Enter the mainframe first, sir."); return; }
    if (MEDIA.has(action.command)) { jester.media(action.command); return; }
    switch (action.command) {
      case "launch_app":   jester.launchApp(action.app || action.target); break;
      case "close_app":    jester.closeApp(action.app || action.target); break;
      case "open_url":     jester.systemCommand("open_url", action.url); break;
      case "show_desktop": jester.systemCommand("show_desktop"); break;
      case "lock_pc":      jester.systemCommand("lock"); break;
      case "web_search":   jester.webSearch(action.query, action.engine); break;
    }
  };

  // ── YouTube search: fetch results, show thumbnails, choose by voice ──────
  const results = createResults(scene.scene, { maxAnisotropy: scene.maxAnisotropy });
  let pendingResults = [];

  async function doYoutubeSearch(query) {
    hud.subtitle("Searching YouTube…");
    if (jester?.webSearch) jester.webSearch(query, "youtube"); // watch it type the search in the browser
    try {
      const r = await fetch(`/youtube?q=${encodeURIComponent(query || "")}`);
      const { videos } = await r.json();
      if (!videos || !videos.length) { speak("I found nothing worth watching, sir."); pendingResults = []; results.clear(); return; }
      pendingResults = videos;
      results.show(videos);
      const words = ["one", "two", "three", "four", "five", "six"];
      const top = videos.slice(0, 3).map((v, i) => `${words[i]}, ${v.title}`).join("; ");
      speak(`I found a few, sir. ${top}. Which shall I play?`);
      hud.subtitle("Say “play number two”, or name it.");
    } catch (e) { console.error(e); speak("The search failed, sir."); }
  }

  const WORD_NUM = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  function pickResult(transcript) {
    const low = transcript.toLowerCase();
    let idx = null;
    const num = low.match(/\b(\d+)\b/); if (num) idx = parseInt(num[1], 10);
    for (const [w, nn] of Object.entries(WORD_NUM)) if (new RegExp(`\\b${w}\\b`).test(low)) idx = nn;
    if (/\blast\b/.test(low)) idx = pendingResults.length;
    if (idx && idx >= 1 && idx <= pendingResults.length) return pendingResults[idx - 1];
    const words = low.split(/\W+/).filter((w) => w.length > 3);
    let best = null, score = 0;
    for (const v of pendingResults) { const tl = v.title.toLowerCase(); let s = 0; for (const w of words) if (tl.includes(w)) s++; if (s > score) { score = s; best = v; } }
    return score >= 1 ? best : null;
  }

  function playVideo(v) {
    const url = `https://www.youtube.com/watch?v=${v.videoId}`;
    if (jester?.openInBrowser) jester.openInBrowser(url); else window.open(url, "_blank");
    pendingResults = []; results.clear();
  }

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
      hud.userSaid(transcript); // show what you said

      // Choosing from YouTube results ("play number two", or by name).
      if (pendingResults.length) {
        const chosen = pickResult(transcript);
        if (chosen) { playVideo(chosen); speak(`Playing ${chosen.title}, sir.`); hud.subtitle(""); return; }
      }

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
        onAction: (action) => {
          if (myTurn !== turn) return;
          // The model occasionally omits `command`; infer it from the fields present.
          if (action && !action.command) {
            if (action.query) action.command = "web_search";
            else if (action.position) action.command = "move";
            else if (action.url) action.command = "open_url";
            else if (action.app) action.command = "launch_app";
          }
          if (action?.command === "move") moveAvatar(action.position || action.target);
          else if (action?.command === "web_search") {
            if ((action.engine || "youtube") === "youtube") doYoutubeSearch(action.query);
            else handlePc(action); // google/web → visible browser typing
          }
          else if (PC_CMDS.has(action?.command)) handlePc(action);
          else applyAction(scene, action, fx);
        },
        onDone: () => { if (myTurn !== turn) return; spk.end(); hud.status(idleStatus()); },
      });
    } catch (err) {
      if (myTurn !== turn) return;
      console.error(err); hud.status("error"); speak(pick(QUIPS.fallback));
    }
  }

  // Tap-to-record on the display mic (reliable). Tap to start, tap to stop →
  // Whisper → converse (which interrupts any current reply). Speaking again on
  // the phone also interrupts. Shows clear status so failures are visible.
  let recorder = null;
  async function micTap() {
    if (!recorder) {
      voice.stopSpeaking();
      try {
        recorder = await voice.startRecording();
        hud.micButton.textContent = "⏹ STOP";
        hud.status("listening"); hud.subtitle("Recording… click ⏹ STOP when done.");
      } catch (err) {
        recorder = null; console.error(err);
        hud.subtitle("No microphone on this device — use your phone's 🎤 to talk.");
      }
      return;
    }
    const r = recorder; recorder = null;
    hud.micButton.textContent = "🎤 SPEAK";
    hud.status("thinking"); hud.subtitle("Transcribing…");
    try {
      const text = await r.stop();
      if (text) converse(text);
      else { hud.subtitle("No speech heard — try again."); hud.status(idleStatus()); }
    } catch (err) {
      console.error(err); hud.subtitle("Transcribe failed: " + (err?.message || err)); hud.status(idleStatus());
    }
  }
  hud.micButton.addEventListener("click", micTap);

  // Desktop-app hooks: global shortcut = tap-to-record (works under the
  // click-through overlay), and native-driven mainframe enter/exit.
  jester?.onVoiceListen?.(() => micTap());
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
    // In the mainframe overlay there is no hand tracking — it's voice-only, and
    // the JESTER avatar sits in the corner. Otherwise, drive hands normally.
    if (!mainframe) {
      if (localMode && tracker) hands = tracker.detect($("video"), now);
      const smoothed = smoother.smooth(hands, t); // de-jittered for steady holograms
      if (deck.active) deck.update(smoothed, dt);
      else controller.update(smoothed);
      scene.setBloom(deck.isOpen ? 0.12 : 0.55);
      cursors.update(smoothed, t);
      hud.drawHands($("overlay"), smoothed);
      hud.handCount(smoothed.map((h) => gestureLabel(h.landmarks)));
    } else {
      cursors.update([], t);            // hide pinch cursors
      hud.drawHands($("overlay"), []);  // clear the hand skeleton
      hud.handCount([]);
    }
    effects.update(dt);
    avatar.object.position.lerp(avatarTarget, 0.12); // glide toward its target spot
    avatar.update(voice.outputLevel(), t);           // pulse with JESTER's voice
    scene.render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => {
  main().catch((err) => { console.error(err); alert("Startup failed: " + err.message); });
});

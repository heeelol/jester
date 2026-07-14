# J.E.S.T.E.R — Holographic Interface

A browser-based Iron Man interface: control 3D holograms with your bare hands via
webcam hand-tracking, and command a voice-driven JESTER assistant that both talks
back and reshapes the display.

Two ways to run it:

- **Solo** — everything on one machine (laptop webcam controls the holograms).
- **Phone controller** 🔥 — your **phone** tracks your hands and streams them to a
  **big screen** where the holograms live. You stand back and conduct the display,
  Tony-Stark style.

No special hardware — just a webcam (or phone), and Chrome.

## What it does

- **Pinch to grab** a hologram and move it.
- **Two-handed pinch** to scale (distance between hands) and rotate (angle between hands).
- **Speak** — "pull up the reactor", "dismiss everything", "rotate that" — and JESTER
  replies in voice while acting on the display.

## The interesting code

Built around small, readable engines:

- **`src/interaction/controller.js`** — the gesture→transform engine. A stateless
  per-frame `update(hands)` mapping pinches onto grab / move / scale / rotate. The
  two-hand transform (scale from hand distance, rotation from hand angle) is ~30 lines.
- **`src/voice/jester.js` + `server/jester.js`** — the say-and-act pipeline. One
  model call returns both a spoken line (streamed to TTS) and a structured scene
  command (function calling), so voice and hands drive the *same* scene API.
- **`server/jester.js` (WebSocket relay) + `src/net/link.js`** — a pure room-based
  relay that pairs a phone controller with a display.

The display renders identically whether hands come from a local camera or a phone
over the wire — the input source is abstracted behind one `hands` array.

## Stack

- **Hand tracking:** MediaPipe Tasks Vision (`HandLandmarker`), 21 landmarks/hand.
- **Rendering:** three.js + a custom holographic shader + Unreal bloom post-processing.
- **Voice:** Web Speech API (recognition + synthesis) — no cloud STT/TTS.
- **Brain:** OpenAI (`gpt-4o-mini`) via a tiny Express proxy, streamed.
- **Pairing:** WebSocket relay (phone → display).

## Run it — solo

```bash
npm install
cp .env.example .env      # paste your OpenAI key into .env
npm start
```

Open **http://localhost:3000** in Chrome → **Initialize Display** → click
*"use this device's camera instead"*. Allow camera + mic.

## Run it — phone controller (the cool one)

Phone cameras require **HTTPS** (browsers block camera access on plain `http`), so
you need a public HTTPS URL to your local server. Easiest, zero-account option:

```bash
npm start
# in another terminal:
npx cloudflared tunnel --url http://localhost:3000
```

This prints an `https://…trycloudflare.com` URL. Then:

1. Open that **HTTPS URL on the big screen** (laptop/TV) → **Initialize Display**.
   A **QR code** appears.
2. **Scan the QR with your phone** (it opens the controller over the same HTTPS URL).
   Tap **Start Tracking**, allow the camera.
3. Prop the phone up so it sees both hands — you're now controlling the display.
   Tap the phone's 🎤 to give voice commands.

> **iPhone note:** hand-tracking works, but Safari has no reliable speech
> recognition — voice commands need **Android Chrome**. (Tailscale Funnel works
> as an HTTPS tunnel too: `tailscale funnel 3000`.)

## Architecture

```
PHONE                         SERVER                    DISPLAY (big screen)
camera ─▶ MediaPipe ─▶ hands ─┐
mic ─▶ Web Speech ─▶ speech ──┤─▶ /ws relay ─▶ hands ─▶ controller ─▶ holograms
                              │                 speech ─▶ JESTER ─▶ voice + actions
                              └─▶ /jester ─▶ OpenAI ─▶ say + action
```

## Tuning

- Grabbing feels reversed? Flip `MIRROR` in `src/interaction/space.js`.
- Pinch too sensitive? Adjust the `0.35` threshold in `src/hands/gestures.js`.
- Bloom too strong/weak? Tune the `UnrealBloomPass` args in `src/scene/objects.js`.
- Wittier JESTER? Swap `MODEL` to `gpt-4o` in `server/jester.js`.
- Real 3D models? Replace the factories in `src/scene/objects.js` with a GLTF loader.

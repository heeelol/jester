# J.E.S.T.E.R — Holographic Interface

A browser-based Iron Man interface: manipulate 3D holograms with your bare hands
(webcam hand-tracking), and command a voice-driven JESTER assistant that both
talks back and reshapes the display.

No special hardware — just a webcam, a microphone, and Chrome.

## What it does

- **Pinch to grab** a hologram and move it.
- **Two-handed pinch** to scale (distance between hands) and rotate (angle between hands).
- **Speak** — "pull up the reactor", "dismiss everything", "rotate that" — and JESTER
  replies in voice while acting on the display.

## The interesting code

The project is built around two small, readable engines:

- **`src/interaction/controller.js`** — the gesture→transform engine. A stateless
  per-frame `update(hands)` that maps pinches onto grab / move / scale / rotate.
  The two-hand transform (scale from hand distance, rotation from hand angle) is
  the core ~30 lines.
- **`src/voice/jester.js` + `server/jester.js`** — the say-and-act pipeline.
  One model call returns both a spoken line (streamed to TTS) and a structured
  scene command (function calling), so voice and hands drive the *same* scene API.

Everything runs client-side except a ~60-line proxy that keeps the API key off
the browser.

## Stack

- **Hand tracking:** MediaPipe Tasks Vision (`HandLandmarker`), 21 landmarks/hand.
- **Rendering:** three.js + a custom holographic shader (fresnel rim, scanlines, flicker).
- **Voice:** Web Speech API (recognition + synthesis) — no cloud STT/TTS.
- **Brain:** OpenAI (`gpt-4o-mini`) via a tiny Express proxy, streamed.

## Run it

```bash
npm install
cp .env.example .env          # then paste your OpenAI key into .env
npm start
```

Open **http://localhost:3000** in Chrome, click **Initialize J.E.S.T.E.R**, and
allow camera + microphone.

> The hand-tracking and holograms work without an API key — only the voice
> replies need it.

## Architecture

```
webcam ─▶ MediaPipe ─▶ gestures.js ─▶ controller.js ─┐
                                                      ├─▶ scene (three.js holograms)
mic ─▶ Web Speech ─▶ /jester proxy ─▶ OpenAI ─▶ say + action ─┘
```

## Tuning

- Grabbing feels reversed? Flip `MIRROR` in `src/interaction/controller.js`.
- Pinch too sensitive? Adjust the `0.35` threshold in `src/hands/gestures.js`.
- Want a smarter/wittier JESTER? Swap `MODEL` to `gpt-4o` in `server/jester.js`.
- Real 3D models instead of procedural shapes? Replace the factories in
  `src/scene/objects.js` with a GLTF loader — nothing else changes.

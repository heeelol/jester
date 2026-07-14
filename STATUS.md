# J.E.S.T.E.R — build status & resume notes

_Last updated: 2026-07-15. Recording: Friday 2026-07-17 evening._

## TL;DR of where we are
The web app (holograms, gestures, media deck) is solid. The **Electron desktop
overlay** ("enter the mainframe") is built and the transparent-overlay + PC app
launching work. The **voice pipeline is the open problem**: it fails
intermittently with a Node/undici `Premature close` error against the OpenAI API.

## What works (verified)
- Holographic playground: hand-tracking (phone controller over Tailscale funnel),
  pinch grab / two-hand scale+rotate, arc-reactor + wireframe holograms, bloom,
  sound FX, media deck (sharp photos/videos).
- Electron shell: `npm run app` launches; transparent desktop overlay via
  `Ctrl+Shift+Enter` / "enter the mainframe"; **no longer traps you** (html
  transparency fixed, taskbar stays, Escape + Ctrl+Shift+M + Ctrl+Q all exit).
- OS control (Electron main, local only): allowlisted app launch, show desktop,
  lock, open URL — fires from JESTER actions when in the mainframe.
- **TTS** (`/tts`, OpenAI voice) — verified returns real audio.
- **STT** (`/stt`, Whisper) — verified end-to-end via a TTS→STT round-trip
  (fixed by uploading a native `Blob` so undici sets Content-Length instead of
  chunked encoding).

## OPEN ISSUE #1 — `/jester` chat: `Premature close` (highest priority)
Symptom: JESTER "can't reach the AI", errors, falls back to canned quips spoken
in the robotic browser voice. Server log: repeated `JESTER error: Premature close`.
- Root cause hypothesis: **Node v26.3.1 + OpenAI SDK (undici) streaming** drops
  the SSE response. Same family as the `/stt` bug. `/tts` (non-streaming binary)
  and a *single* `/jester` curl both worked, so it's intermittent under load.
- Candidate fixes to try (in order):
  1. Make `/jester` **non-streaming** (await the full `chat.completions.create`
     without `stream:true`, then emit say+action once). Simplest, most robust;
     loses token-streaming but replies are 1–2 sentences so it's fine.
  2. Or give the OpenAI client a custom fetch/agent with keep-alive disabled, or
     add stream ret/reconnect.
  3. Or run on **Node LTS 22** instead of 26 (undici in 26 is the suspect).
  Recommend trying #1 first — quick and likely sufficient.

## OPEN ISSUE #2 — PC-direct voice: "nothing transcribes"
`/stt` works server-side, so the client audio is likely empty. Most probable:
**the PC has no working microphone** (it also has no camera). Need to confirm.
- Diagnose: check server log for `/stt` hits when the desktop mic is used. No hits
  = recording/mic failed (no device); hits with empty text = mic capturing silence.
- Client robustness to add (`src/voice/speech.js` `transcribeOnce`):
  - `await audioCtx.resume()` — the AudioContext for silence-detection may start
    suspended, so RMS reads silence and it records the full 9s cap.
  - Enumerate devices / catch `getUserMedia` NotFoundError and surface a clear
    "no microphone — use the phone" message.
- **Reliable workaround for the demo:** use the **phone as the mic**. Phone speech
  (Web Speech) → WS relay → display `converse(transcript)` → mainframe keyword +
  PC commands all work without a PC mic. This is the intended setup given no PC
  camera/mic.

## Also verify on the real machine (untested by user yet)
- Does the mainframe overlay actually show the desktop through it now? (html
  transparency fix — needs eyes-on confirmation).

## How to run
```
# server auto-starts inside Electron; JESTER_PUBLIC lets the phone pair via the tunnel
JESTER_PUBLIC=https://jiaweipc.tail0eb53b.ts.net:8443 npm run app
# or web-only:  npm start   → http://localhost:3000
```
Hotkeys: Ctrl+Shift+Enter enter mainframe · Ctrl+Shift+M / Escape exit · Ctrl+Q quit
· Ctrl+Shift+Space voice.

## Currently-running services (from this session)
- Local server on :3000 (background) — reused by Electron.
- Tailscale Funnel :8443 → localhost:3000 (public HTTPS for the phone).
  Stop with: `tailscale funnel --https=8443 off`

## Housekeeping
- **Rotate the OpenAI key** — it was exposed in chat; `.env` holds it (gitignored).
- Repo: github.com/heeelol/jester (public). Commits authored as NinJaWay only.

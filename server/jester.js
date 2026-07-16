// server/jester.js — the JESTER brain and static host.
//
// One tiny Express server does two things:
//   1. serves the front-end (so the whole app is one `npm start`)
//   2. exposes POST /jester — the ONLY place the OpenAI API key is used
//
// It streams the reply back as newline-delimited JSON: `say` events carry spoken
// text token-by-token (low latency for TTS), and an `action` event carries a
// structured scene command when JESTER decides to manipulate the display.

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

// We call OpenAI over native fetch, not the SDK: the SDK's undici HTTP layer
// intermittently drops responses under Node 26 ("Premature close"). Native fetch
// is reliable here. One tiny helper builds the auth headers.
const OPENAI = "https://api.openai.com/v1";
const authJSON = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Model: gpt-4o-mini is the fast / cheap tier — low time-to-first-token, which
// is what makes a voice assistant feel instant. JESTER turns are short, so mini
// is plenty. For more wit, swap to "gpt-4o".
const MODEL = "gpt-4o-mini";

const SYSTEM = `You are J.E.S.T.E.R. — the court jester of AIs, running a holographic display.
You are genuinely sharp and helpful, but you cannot resist a quip, a pun, or a bit of gentle
teasing. Think a stand-up comedian who happens to be a brilliant butler. Address the user as "sir".
Rules of the act:
- Keep every spoken reply to ONE or TWO short sentences — it's read aloud, so land the joke fast.
- Be clever, not corny. Never explain the joke. A little dry sarcasm goes a long way.
- Still actually do what's asked — the comedy is seasoning, not an excuse.
HOLOGRAMS: when asked to show/summon, hide/dismiss, rotate, scale, or reset holograms, call
perform_action (reactor, helmet, globe, cube).
PC CONTROL (relevant once "in the mainframe"): when asked to open/launch OR close/quit an app, show
the desktop, lock the PC, or open a website, call perform_action with command "launch_app" or
"close_app" (with the app name), or the matching system command. Known apps: chrome, edge, firefox,
spotify, discord, notepad, explorer, calculator, code, terminal, powershell, settings, camera, mail,
whatsapp, telegram, steam, slack.
For anything else (questions, chat), just riff — no function call.`;

const ACTION_TOOL = {
  type: "function",
  function: {
    name: "perform_action",
    description: "Manipulate the holographic display OR control the PC (launch apps, show desktop, lock, open a URL).",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["spawn", "dismiss", "rotate", "scale", "reset", "launch_app", "close_app", "show_desktop", "lock_pc", "open_url"] },
        target:  { type: "string", enum: ["reactor", "helmet", "globe", "cube", "all"], description: "Which hologram (spawn/dismiss)." },
        app:     { type: "string", description: "App name for launch_app, e.g. spotify, chrome, notepad." },
        url:     { type: "string", description: "Full https URL for open_url." },
        amount:  { type: "number", description: "Optional magnitude for rotate/scale, e.g. 1.5." },
      },
      required: ["command"],
    },
  },
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..")));

// Client telemetry — lets us see what the browser/Electron renderer is doing
// (button clicks, device counts, errors) from the server log during debugging.
app.post("/log", (req, res) => {
  console.log("[client]", JSON.stringify(req.body).slice(0, 400));
  res.json({ ok: true });
});

app.post("/jester", async (req, res) => {
  const transcript = (req.body?.transcript || "").toString().slice(0, 500);
  if (!transcript) return res.status(400).end();

  res.setHeader("Content-Type", "application/x-ndjson");
  const send = (obj) => res.write(JSON.stringify(obj) + "\n");

  try {
    const r = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: authJSON(),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        tools: [ACTION_TOOL],
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: transcript },
        ],
      }),
    });
    if (!r.ok) throw new Error(`chat ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const data = await r.json();

    const msg = data.choices?.[0]?.message;
    if (msg?.content) send({ type: "say", text: msg.content });
    for (const tc of msg?.tool_calls || []) {
      try { send({ type: "action", action: JSON.parse(tc.function?.arguments || "{}") }); } catch { /* skip bad args */ }
    }
    send({ type: "done" });
  } catch (err) {
    console.error("JESTER error:", err.message);
    send({ type: "say", text: "I'm afraid something went wrong, sir." });
    send({ type: "done" });
  }
  res.end();
});

// ── Text-to-speech ─────────────────────────────────────────────────────────
// A real JESTER voice (OpenAI TTS) — much better than the browser's robotic
// default, and it works identically inside the Electron app.
app.post("/tts", async (req, res) => {
  const text = (req.body?.text || "").toString().slice(0, 600);
  if (!text) return res.status(400).end();
  try {
    const r = await fetch(`${OPENAI}/audio/speech`, {
      method: "POST",
      headers: authJSON(),
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "ash",
        input: text,
        instructions: "A sleek, confident AI concierge with a dry, playful wit — think a suave secret-agent's assistant. Smooth and cool, measured pace, a subtle smirk in the delivery. Never robotic.",
      }),
    });
    if (!r.ok) throw new Error(`tts ${r.status}`);
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).end();
  }
});

// ── Speech-to-text ─────────────────────────────────────────────────────────
// Whisper transcription — works where the browser Web Speech API doesn't (i.e.
// inside Electron), so you can talk to the PC directly.
app.post("/stt", express.raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }), async (req, res) => {
  if (!req.body || !req.body.length) return res.json({ text: "" });
  const ct = req.headers["content-type"] || "audio/webm";
  const ext = /mp4|m4a|aac/.test(ct) ? "mp4" : /mp3|mpeg/.test(ct) ? "mp3" : /wav/.test(ct) ? "wav" : "webm";
  try {
    // A native Blob has a known length, so undici sets Content-Length and avoids
    // chunked transfer-encoding — which the transcription endpoint drops
    // ("Premature close"). This is why we bypass the SDK's uploader here.
    const form = new FormData();
    form.append("file", new Blob([req.body], { type: ct }), `audio.${ext}`);
    form.append("model", "gpt-4o-transcribe");  // far more accurate than whisper-1
    form.append("language", "en");
    // Bias recognition toward JESTER's actual vocabulary.
    form.append("prompt", "Commands for the JESTER assistant: enter the mainframe, exit the mainframe, open Spotify, open Discord, open Chrome, open Notepad, close Discord, close Spotify, show my desktop, lock the PC, pull up the reactor, scroll, focus, open, close.");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!r.ok) { console.error("STT http", r.status, (await r.text().catch(() => "")).slice(0, 200)); return res.status(500).json({ text: "" }); }
    const data = await r.json();
    res.json({ text: data.text || "" });
  } catch (err) {
    console.error("STT error:", err.message);
    res.status(500).json({ text: "" });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("\n⚠  OPENAI_API_KEY is not set — voice replies will fail.\n   Put it in a .env file:  OPENAI_API_KEY=sk-...\n");
  }
  console.log(`\n🃏 J.E.S.T.E.R online → http://localhost:${PORT}\n`);
});

// ── WebSocket relay ────────────────────────────────────────────────────────
// Pairs a phone (controller) with a display via a shared room code. The phone
// streams hand landmarks and speech transcripts; the server relays them to the
// display(s) in the same room. Pure relay — no game state lives here.

const wss = new WebSocketServer({ server, path: "/ws" });
const rooms = new Map(); // code -> { display:Set<ws>, phone:Set<ws> }
const roomOf = (code) => rooms.get(code) || (rooms.set(code, { display: new Set(), phone: new Set() }), rooms.get(code));
const send = (ws, obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf); } catch { return; }

    if (msg.type === "join") {
      ws.role = msg.role === "phone" ? "phone" : "display";
      ws.room = String(msg.room || "").toUpperCase();
      const r = roomOf(ws.room);
      r[ws.role].add(ws);
      // Announce presence so each side knows a peer is ready.
      const peers = ws.role === "phone" ? r.display : r.phone;
      peers.forEach((p) => send(p, { type: "peer", role: ws.role, state: "joined" }));
      // Also tell the newcomer whether the other side is already present.
      const otherPresent = (ws.role === "phone" ? r.display.size : r.phone.size) > 0;
      send(ws, { type: "peer", role: ws.role === "phone" ? "display" : "phone", state: otherPresent ? "joined" : "waiting" });
      return;
    }

    // Relay everything else to the opposite role in the room.
    const r = rooms.get(ws.room);
    if (!r) return;
    const targets = ws.role === "phone" ? r.display : r.phone;
    targets.forEach((t) => send(t, msg));
  });

  ws.on("close", () => {
    const r = rooms.get(ws.room);
    if (!r) return;
    r[ws.role]?.delete(ws);
    const peers = ws.role === "phone" ? r.display : r.phone;
    peers.forEach((p) => send(p, { type: "peer", role: ws.role, state: "left" }));
    if (r.display.size === 0 && r.phone.size === 0) rooms.delete(ws.room);
  });
});

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
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Model: gpt-4o-mini is the fast / cheap tier — low time-to-first-token, which
// is what makes a voice assistant feel instant. JESTER turns are short, so mini
// is plenty. For more wit, swap to "gpt-4o".
const MODEL = "gpt-4o-mini";

const SYSTEM = `You are J.E.S.T.E.R., a witty AI assistant running a holographic display —
think Iron Man's JARVIS with a mischievous streak. Persona: quick, dry, playful, but genuinely helpful.
Address the user as "sir".
ALWAYS reply with ONE or TWO short spoken sentences — this is read aloud, so be brief and natural.
When the user asks to show, summon, hide, rotate, scale, or reset holograms, ALSO call the
perform_action function. Available holograms: reactor, helmet, globe, cube. For anything else
(questions, chat), just speak — no function call.`;

const ACTION_TOOL = {
  type: "function",
  function: {
    name: "perform_action",
    description: "Manipulate the holographic display. Call when the user asks to show/summon, hide/dismiss, rotate, scale, or reset holograms.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["spawn", "dismiss", "rotate", "scale", "reset"] },
        target:  { type: "string", enum: ["reactor", "helmet", "globe", "cube", "all"], description: "Which hologram; 'all' where it makes sense." },
        amount:  { type: "number", description: "Optional magnitude for rotate/scale, e.g. 1.5." },
      },
      required: ["command"],
    },
  },
};

// Constructed lazily on first voice request — the OpenAI SDK throws at
// construction if no key is set, and we don't want that to take down the static
// server (the hands + holograms run fine without a key).
let client;
const getClient = () => (client ??= new OpenAI()); // reads OPENAI_API_KEY

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..")));

app.post("/jester", async (req, res) => {
  const transcript = (req.body?.transcript || "").toString().slice(0, 500);
  if (!transcript) return res.status(400).end();

  res.setHeader("Content-Type", "application/x-ndjson");
  const send = (obj) => res.write(JSON.stringify(obj) + "\n");

  try {
    const stream = await getClient().chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      stream: true,
      tools: [ACTION_TOOL],
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: transcript },
      ],
    });

    // Streaming assembles two things at once: spoken text (emitted live) and
    // function-call arguments (accumulated as fragments, parsed at the end).
    const toolCalls = {}; // index -> { name, args }
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) send({ type: "say", text: delta.content });
      for (const tc of delta.tool_calls || []) {
        const slot = (toolCalls[tc.index] ??= { name: "", args: "" });
        if (tc.function?.name) slot.name = tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }

    for (const slot of Object.values(toolCalls)) {
      try { send({ type: "action", action: JSON.parse(slot.args || "{}") }); } catch { /* incomplete args — skip */ }
    }
    send({ type: "done" });
  } catch (err) {
    console.error("JESTER error:", err.message);
    send({ type: "say", text: "I'm afraid something went wrong, sir." });
    send({ type: "done" });
  }
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("\n⚠  OPENAI_API_KEY is not set — voice replies will fail.\n   Put it in a .env file:  OPENAI_API_KEY=sk-...\n");
  }
  console.log(`\n🃏 J.E.S.T.E.R online → http://localhost:${PORT}\n`);
});

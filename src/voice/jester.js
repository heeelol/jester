// jester.js — the client half of the JESTER brain. Streams a transcript to the
// /jester proxy and dispatches two kinds of events back to the caller:
//
//   onSay(delta)     spoken text, token by token (feed it to the TTS speaker)
//   onAction(action) a structured scene command, e.g. { command:"spawn", target:"reactor" }
//
// The API key never touches the browser — it lives on the proxy. See server/jester.js.

export async function askJester(transcript, { onSay, onAction, onDone } = {}) {
  const res = await fetch("/jester", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok || !res.body) throw new Error(`JESTER proxy error ${res.status}`);

  // The proxy streams newline-delimited JSON events. Parse them as they arrive.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === "say") onSay?.(ev.text);
      else if (ev.type === "action") onAction?.(ev.action);
      else if (ev.type === "done") onDone?.();
    }
  }
  onDone?.();
}

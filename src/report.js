// report.js — fire-and-forget client telemetry to the server log, so we can see
// what the renderer is doing during debugging without the user reading it back.
export function report(tag, data) {
  try {
    fetch("/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, data }) });
  } catch { /* ignore */ }
  try { console.log("[jester]", tag, data ?? ""); } catch { /* ignore */ }
}

// link.js — a tiny WebSocket wrapper shared by the display and the phone. Both
// join a named "room"; the server relays messages between the phone (controller)
// and the display in the same room. Uses wss:// automatically when the page is
// served over HTTPS (required for the phone camera anyway).
//
// Auto-reconnects with backoff and re-joins the room on every (re)connect, so a
// dropped Wi-Fi frame or a phone that sleeps for a second doesn't kill the link
// mid-demo.

export function createLink({ role, room, onMessage, onOpen, onClose }) {
  let ws;
  let closed = false;
  let retries = 0;

  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener("open", () => {
      retries = 0;
      ws.send(JSON.stringify({ type: "join", role, room }));
      onOpen?.();
    });
    ws.addEventListener("message", (e) => {
      try { onMessage(JSON.parse(e.data)); } catch { /* ignore malformed frame */ }
    });
    ws.addEventListener("close", () => {
      onClose?.();
      if (!closed) {
        retries += 1;
        setTimeout(connect, Math.min(500 * retries, 4000)); // backoff, capped at 4s
      }
    });
    ws.addEventListener("error", () => ws.close());
  };
  connect();

  return {
    send: (obj) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
    close: () => { closed = true; ws?.close(); },
  };
}

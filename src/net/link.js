// link.js — a tiny WebSocket wrapper shared by the display and the phone. Both
// join a named "room"; the server relays messages between the phone (controller)
// and the display in the same room. Uses wss:// automatically when the page is
// served over HTTPS (required for the phone camera anyway).

export function createLink({ role, room, onMessage, onOpen, onClose }) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join", role, room }));
    onOpen?.();
  });
  ws.addEventListener("message", (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore malformed frame */ }
  });
  ws.addEventListener("close", () => onClose?.());

  return {
    send: (obj) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
    close: () => ws.close(),
  };
}

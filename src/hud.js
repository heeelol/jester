// hud.js — the Stark-style overlay: corner readouts, a subtitle line for JESTER,
// and the glowing hand-skeleton wireframe drawn over the 3D scene.

// Connections between the 21 hand landmarks (MediaPipe topology).
const BONES = [
  [0,1],[1,2],[2,3],[3,4],           // thumb
  [0,5],[5,6],[6,7],[7,8],           // index
  [5,9],[9,10],[10,11],[11,12],      // middle
  [9,13],[13,14],[14,15],[15,16],    // ring
  [13,17],[17,18],[18,19],[19,20],   // pinky
  [0,17],                            // palm base
];
const TIPS = [4, 8, 12, 16, 20];

export function createHUD() {
  const root = document.getElementById("hud");
  root.innerHTML = `
    <div style="position:absolute;top:26px;left:34px;font-size:13px;letter-spacing:2px;line-height:1.9;">
      <div style="font-size:15px;letter-spacing:7px;margin-bottom:2px;">J.E.S.T.E.R</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span id="hud-dot" style="width:8px;height:8px;border-radius:50%;background:#59d8ff;box-shadow:0 0 8px #59d8ff;"></span>
        <span id="hud-status">SYSTEM · STANDBY</span>
      </div>
      <div id="hud-hands" style="opacity:.75;">HANDS · 0</div>
    </div>
    <div style="position:absolute;top:26px;right:56px;text-align:right;font-size:11px;letter-spacing:2px;line-height:1.9;opacity:.6;">
      PINCH · grab<br/>TWO HANDS · scale + rotate<br/>SPEAK · "pull up the reactor"
    </div>
    <div id="hud-sub" style="position:absolute;bottom:96px;left:0;right:0;text-align:center;font-size:22px;letter-spacing:1px;min-height:30px;padding:0 40px;"></div>
    <button id="hud-mic" style="pointer-events:auto;position:absolute;bottom:30px;left:50%;transform:translateX(-50%);
      background:rgba(4,6,10,.4);color:#59d8ff;border:1px solid #59d8ff;border-radius:30px;padding:13px 30px;
      font-size:14px;letter-spacing:3px;cursor:pointer;box-shadow:0 0 16px rgba(89,216,255,.3);backdrop-filter:blur(4px);transition:all .2s;">🎤 SPEAK</button>
    <style>
      #hud-dot { animation: hudpulse 1.6s ease-in-out infinite; }
      @keyframes hudpulse { 50% { opacity: .3; transform: scale(.8); } }
      #hud-mic:hover { background: rgba(89,216,255,.15); box-shadow: 0 0 30px rgba(89,216,255,.55); }
    </style>
  `;

  const $dot = root.querySelector("#hud-dot");
  const $status = root.querySelector("#hud-status");
  const $hands = root.querySelector("#hud-hands");
  const $sub = root.querySelector("#hud-sub");

  const DOT = { listening: "#ffd166", thinking: "#c77dff", error: "#ff5b5b" };

  return {
    micButton: root.querySelector("#hud-mic"),
    status: (t) => {
      $status.textContent = "SYSTEM · " + t.toUpperCase();
      const c = DOT[t.toLowerCase()] || "#59d8ff";
      $dot.style.background = c;
      $dot.style.boxShadow = `0 0 8px ${c}`;
    },
    handCount: (labels) => {
      $hands.textContent = `HANDS · ${labels.length}` + (labels.length ? " · " + labels.join(" ") : "");
    },
    subtitle: (t) => { $sub.textContent = t; },

    // Draw the hand skeletons onto the overlay canvas (already CSS-mirrored to
    // match the camera, so we draw in raw normalized coords). shadowBlur gives
    // the lines a holographic glow.
    drawHands(canvas, hands) {
      const ctx = canvas.getContext("2d");
      if (canvas.width !== innerWidth) { canvas.width = innerWidth; canvas.height = innerHeight; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.shadowColor = "rgba(89,216,255,0.9)";
      ctx.shadowBlur = 12;
      ctx.strokeStyle = "rgba(120,225,255,0.85)";
      ctx.lineWidth = 2;

      for (const { landmarks } of hands) {
        const px = (p) => [p.x * canvas.width, p.y * canvas.height];
        for (const [a, b] of BONES) {
          ctx.beginPath();
          ctx.moveTo(...px(landmarks[a]));
          ctx.lineTo(...px(landmarks[b]));
          ctx.stroke();
        }
        // Joints.
        ctx.fillStyle = "rgba(180,240,255,0.9)";
        for (const p of landmarks) {
          const [x, y] = px(p);
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        // Fingertips get brighter, larger nodes.
        ctx.fillStyle = "#eafcff";
        for (const t of TIPS) {
          const [x, y] = px(landmarks[t]);
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
    },
  };
}

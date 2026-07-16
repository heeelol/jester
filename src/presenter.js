// presenter.js — a holographic JESTER jester-face whose mouth lip-syncs to the
// microphone. Screen-record this window and chroma-key the green in CapCut to get
// a "jester-as-me" talking head for the corner of your demo.
//
// ?open=0.6 forces a fixed mouth openness and skips the mic (used for previews).

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const CY = "#59d8ff", MAG = "#c77dff", WHITE = "#eafcff";
const BGS = ["#00b140", "#0b0f14", "#b400b4"]; // chroma green, dark, chroma magenta
let bgi = 0;

let W, H;
const resize = () => { W = canvas.width = innerWidth; H = canvas.height = innerHeight; };
addEventListener("resize", resize); resize();

const forced = new URLSearchParams(location.search).get("open");
const testMode = forced != null;

let level = 0, open = testMode ? parseFloat(forced) : 0;
let analyser = null, buf = null;

async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  await ac.resume?.();
  const src = ac.createMediaStreamSource(stream);
  analyser = ac.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
  buf = new Uint8Array(analyser.fftSize);
}
function micLevel() {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buf);
  let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}

const eyeBlink = (t) => { const c = t % 4.3; return c < 0.14 ? Math.abs(c - 0.07) / 0.07 : 1; };

function hat(R, glow) {
  const baseY = -R * 0.78;
  const bases = [-R * 0.4, 0, R * 0.4];
  const tips = [{ x: -R * 1.2, y: -R * 1.2 }, { x: 0, y: -R * 1.7 }, { x: R * 1.2, y: -R * 1.2 }];
  for (let i = 0; i < 3; i++) {
    const bx = bases[i], tip = tips[i], mx = (bx + tip.x) / 2, my = (baseY + tip.y) / 2;
    ctx.shadowColor = CY; ctx.shadowBlur = glow; ctx.lineWidth = 4; ctx.strokeStyle = CY; ctx.fillStyle = "rgba(89,216,255,0.16)";
    ctx.beginPath();
    ctx.moveTo(bx - R * 0.17, baseY);
    ctx.quadraticCurveTo(mx - R * 0.12, my, tip.x, tip.y);      // outer edge → tip
    ctx.quadraticCurveTo(mx + R * 0.12, my, bx + R * 0.17, baseY); // tip → inner edge
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = MAG; ctx.shadowColor = MAG;
    ctx.beginPath(); ctx.arc(tip.x, tip.y, R * 0.11, 0, Math.PI * 2); ctx.fill();
  }
}

function eye(x, y, rx, ry, glow) {
  ctx.shadowColor = CY; ctx.shadowBlur = glow; ctx.strokeStyle = CY; ctx.lineWidth = 3; ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath(); ctx.ellipse(x, y, rx, Math.max(ry, 0.5), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (ry > rx * 0.4) { ctx.fillStyle = WHITE; ctx.shadowColor = WHITE; ctx.beginPath(); ctx.arc(x, y, Math.min(rx * 0.55, ry), 0, Math.PI * 2); ctx.fill(); }
}

function mouth(y, w, o, glow) {
  ctx.save(); ctx.translate(0, y);
  ctx.shadowColor = CY; ctx.shadowBlur = glow; ctx.strokeStyle = CY; ctx.lineWidth = 4;
  const h = 5 + o * w * 0.62;
  ctx.fillStyle = "rgba(12,0,18,0.85)";
  ctx.beginPath(); ctx.ellipse(0, 0, w * 0.5, h, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (o > 0.12) { ctx.fillStyle = WHITE; ctx.shadowColor = WHITE; ctx.shadowBlur = glow * 0.5; ctx.fillRect(-w * 0.38, -h, w * 0.76, Math.min(7, h * 0.35)); }
  if (o > 0.35) { ctx.fillStyle = "#ff6b9d"; ctx.shadowColor = "#ff6b9d"; ctx.beginPath(); ctx.ellipse(0, h * 0.42, w * 0.26, h * 0.38, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function collar(y, R, glow) {
  ctx.save(); ctx.translate(0, y);
  ctx.shadowColor = CY; ctx.shadowBlur = glow; ctx.strokeStyle = CY; ctx.lineWidth = 4; ctx.fillStyle = "rgba(89,216,255,0.12)";
  const pts = 6, spread = R * 1.35;
  ctx.beginPath(); ctx.moveTo(-spread, 0);
  for (let i = 0; i <= pts; i++) ctx.lineTo(-spread + (2 * spread) * (i / pts), i % 2 ? R * 0.5 : 0);
  ctx.lineTo(spread, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = MAG; ctx.shadowColor = MAG;
  for (let i = 1; i < pts; i += 2) { ctx.beginPath(); ctx.arc(-spread + (2 * spread) * (i / pts), R * 0.5, R * 0.08, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function draw(t) {
  ctx.fillStyle = BGS[bgi]; ctx.fillRect(0, 0, W, H);
  const R = Math.min(W, H) * 0.26;
  const cx = W / 2, cy = H / 2 + Math.sin(t * 1.6) * R * 0.03;
  const glow = 12 + level * 55;
  ctx.save(); ctx.translate(cx, cy);

  collar(R * 1.02, R, glow);
  hat(R, glow);

  // face
  ctx.shadowColor = CY; ctx.shadowBlur = glow; ctx.lineWidth = 4; ctx.strokeStyle = CY; ctx.fillStyle = "rgba(8,16,24,0.55)";
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.92, R, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  const eo = eyeBlink(t);
  eye(-R * 0.38, -R * 0.12, R * 0.2, R * 0.14 * eo, glow);
  eye(R * 0.38, -R * 0.12, R * 0.2, R * 0.14 * eo, glow);

  // cheeks
  ctx.shadowColor = MAG; ctx.shadowBlur = glow * 0.6; ctx.fillStyle = "rgba(199,125,255,0.45)";
  ctx.beginPath(); ctx.arc(-R * 0.52, R * 0.22, R * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(R * 0.52, R * 0.22, R * 0.12, 0, Math.PI * 2); ctx.fill();

  mouth(R * 0.45, R * 0.55, open, glow);
  ctx.restore();
}

function frame(now) {
  const t = now / 1000;
  if (!testMode) { level += (micLevel() - level) * 0.4; open += (Math.min(level * 6, 1) - open) * 0.5; }
  else level = open * 0.16;
  draw(t);
  requestAnimationFrame(frame);
}

addEventListener("keydown", (e) => {
  if (e.key === "b" || e.key === "B") bgi = (bgi + 1) % BGS.length;
  if (e.key === "h" || e.key === "H") document.getElementById("hint")?.classList.toggle("hidden");
});

function begin() { document.getElementById("start")?.remove(); requestAnimationFrame(frame); }

if (testMode) { document.getElementById("start")?.remove(); requestAnimationFrame(frame); }
else document.getElementById("go").addEventListener("click", async () => {
  try { await startMic(); begin(); }
  catch (e) { alert("Microphone needed: " + e.message); }
});

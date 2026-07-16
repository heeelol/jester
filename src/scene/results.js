// results.js — a holographic gallery of YouTube search results. Numbered
// thumbnail cards you pick from by voice ("play number two"). Thumbnails load
// through the server's /img proxy so they're usable as WebGL textures.

import * as THREE from "three";

function numberSprite(n) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(4,10,16,0.85)"; ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#8fecff"; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = "#eafcff"; ctx.font = "bold 70px Orbitron, Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(0.34, 0.34, 1);
  return spr;
}

// Wrap text to at most `maxLines` lines that fit `maxW` px, ellipsising overflow.
function wrap(ctx, text, maxW, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line); line = w;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    while (ctx.measureText(lines[maxLines - 1] + "…").width > maxW && lines[maxLines - 1].length) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1);
    }
    if (words.join(" ") !== lines.join(" ")) lines[maxLines - 1] += "…";
  }
  return lines;
}

// A caption plane: title (2 lines) + channel · duration below it.
function caption(video, w, aniso) {
  const cw = 512, chh = 176;
  const c = document.createElement("canvas"); c.width = cw; c.height = chh;
  const ctx = c.getContext("2d");
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillStyle = "#eafcff"; ctx.font = "600 32px Rajdhani, Arial";
  const lines = wrap(ctx, video.title || "", cw - 24, 2);
  lines.forEach((ln, i) => ctx.fillText(ln, cw / 2, 4 + i * 36));
  ctx.fillStyle = "#7fb8cc"; ctx.font = "500 26px Rajdhani, Arial";
  const sub = [video.channel, video.duration].filter(Boolean).join("  ·  ");
  ctx.fillText(sub, cw / 2, 4 + lines.length * 36 + 8);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, w * chh / cw), mat);
}

export function createResults(scene, { maxAnisotropy = 1 } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const loader = new THREE.TextureLoader();
  let cards = [];

  function clear() {
    for (const c of cards) {
      group.remove(c);
      c.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
    }
    cards = [];
  }

  function show(videos) {
    clear();
    const n = videos.length;
    const cols = Math.min(n, 3), rows = Math.ceil(n / cols);
    videos.forEach((v, i) => {
      const w = 1.7, h = w * 9 / 16;
      const mat = new THREE.MeshBasicMaterial({ color: 0x14202b, transparent: true, opacity: 0.96, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      loader.load(`/img?u=${encodeURIComponent(v.thumbnail)}`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAnisotropy;
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
      });
      mesh.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)),
        new THREE.LineBasicMaterial({ color: 0x8fecff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
      ));
      const label = numberSprite(i + 1);
      label.position.set(-w / 2 + 0.16, h / 2 - 0.14, 0.02);
      mesh.add(label);

      // Short description under the thumbnail.
      const cap = caption(v, w, maxAnisotropy);
      cap.position.set(0, -h / 2 - (w * 176 / 512) / 2 - 0.07, 0.01);
      mesh.add(cap);

      const col = i % cols, row = Math.floor(i / cols);
      mesh.position.set((col - (cols - 1) / 2) * 2.05, ((rows - 1) / 2 - row) * 2.0 + 0.55, -0.2);
      group.add(mesh); cards.push(mesh);
    });
  }

  return { show, clear, get active() { return cards.length > 0; } };
}

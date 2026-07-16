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
      const w = 1.9, h = w * 9 / 16;
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

      const col = i % cols, row = Math.floor(i / cols);
      mesh.position.set((col - (cols - 1) / 2) * 2.15, ((rows - 1) / 2 - row) * 1.45 + 0.35, -0.2);
      group.add(mesh); cards.push(mesh);
    });
  }

  return { show, clear, get active() { return cards.length > 0; } };
}

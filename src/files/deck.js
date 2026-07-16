// deck.js — a 3D media carousel you drive with one hand.
//
//   • SCROLL  — move your hand left/right to spin through the photos/videos
//               (cover-flow: the centred item is nearest and largest).
//   • PINCH   — thumb + index together locks focus on the centred item.
//   • OPEN    — release (open thumb + index) blows the focused item up big
//               (videos play).
//   • CLOSE   — pinch again while it's open to close it and resume scrolling.
//
// 100% browser-side: the folder is read locally, nothing is uploaded.

import * as THREE from "three";
import { pinchStrength } from "../hands/gestures.js";
import { MIRROR } from "../interaction/space.js";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogg)$/i;
const MAX_TILES = 40;
const H = 1.3;          // tile height (world units); width follows the media aspect
const SPACING = 2.0;    // horizontal gap between items
const OPEN_H = 3.8;     // opened tile height

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function holoFrame() {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: 0x8fecff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );
}

export function createDeck(scene, camera, { maxAnisotropy = 1 } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const tiles = [];
  let active = false;
  let state = "scroll";     // scroll | focus | open
  let scroll = 0, scrollTarget = 0, focusIndex = 0;
  let wasClosed = false;

  const clear = () => {
    for (const t of tiles) {
      t.video?.pause();
      if (t.video?.src) URL.revokeObjectURL(t.video.src);
      group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.map?.dispose();
      t.mesh.material.dispose();
    }
    tiles.length = 0;
    state = "scroll"; scroll = scrollTarget = focusIndex = 0;
  };

  function connect() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file"; input.multiple = true;
      try { input.webkitdirectory = true; } catch { /* individual files */ }
      input.onchange = async () => {
        try {
          const picked = [...(input.files || [])]
            .filter((f) => IMAGE_RE.test(f.name) || VIDEO_RE.test(f.name))
            .slice(0, MAX_TILES);
          if (!picked.length) { alert("No photos or videos in that folder."); return resolve(false); }
          clear();
          for (const file of picked) {
            const tile = await buildTile(file, IMAGE_RE.test(file.name) ? "image" : "video");
            group.add(tile.mesh); tiles.push(tile);
          }
          scrollTarget = scroll = 0; active = true;
          resolve(true);
        } catch (e) { reject(e); }
      };
      input.oncancel = () => resolve(false);
      input.click();
    });
  }

  const setAspect = (tile, aspect) => tile.baseScale.set(H * aspect, H, 1);

  async function buildTile(file, kind) {
    let texture, video = null, aspect = 1;
    if (kind === "image") {
      const bitmap = await createImageBitmap(file);
      aspect = bitmap.width / bitmap.height;
      texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = maxAnisotropy; texture.generateMipmaps = true; texture.needsUpdate = true;
    } else {
      video = document.createElement("video");
      video.src = URL.createObjectURL(file);
      video.loop = true; video.playsInline = true; video.preload = "metadata";
      texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = maxAnisotropy;
    }
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.add(holoFrame());
    const tile = { mesh, kind, video, baseScale: new THREE.Vector3() };
    setAspect(tile, aspect);
    if (video) video.addEventListener("loadedmetadata", () => { if (video.videoWidth) setAspect(tile, video.videoWidth / video.videoHeight); }, { once: true });
    return tile;
  }

  const tmp = new THREE.Vector3();
  const openPos = new THREE.Vector3(0, 0.3, 1.4);

  function update(hands) {
    if (!active) return;
    const n = tiles.length;
    const hand = hands[0];

    if (hand) {
      const strength = pinchStrength(hand.landmarks);
      const closed = wasClosed ? strength < 0.45 : strength < 0.30; // hysteresis
      const closeEdge = closed && !wasClosed;
      const openEdge = !closed && wasClosed;
      wasClosed = closed;

      // Palm x (middle-finger knuckle) drives scrolling.
      const px = hand.landmarks[9].x;
      const handX = MIRROR ? 1 - px : px;

      if (state === "scroll") {
        if (!closed) scrollTarget = clamp((handX - 0.15) / 0.7, 0, 1) * (n - 1);
        if (closeEdge) { state = "focus"; focusIndex = clamp(Math.round(scroll), 0, n - 1); }
      } else if (state === "focus") {
        if (openEdge) { state = "open"; openTile(focusIndex); }
      } else if (state === "open") {
        if (closeEdge) { closeTile(); state = "scroll"; }
      }
    }

    scroll += (scrollTarget - scroll) * 0.18;
    layout(n);
  }

  function layout(n) {
    for (let i = 0; i < n; i++) {
      const t = tiles[i];
      const opened = state === "open" && i === focusIndex;
      if (opened) {
        t.mesh.position.lerp(openPos, 0.2);
        t.mesh.scale.lerp(tmp.copy(t.baseScale).multiplyScalar(OPEN_H / H), 0.2);
        t.mesh.rotation.y += (0 - t.mesh.rotation.y) * 0.2;
        t.mesh.material.opacity = 1;
        t.mesh.visible = true;
        continue;
      }
      const off = i - scroll;
      if (Math.abs(off) > 4.5) { t.mesh.visible = false; continue; }
      t.mesh.visible = true;
      const focused = state === "focus" && i === focusIndex;
      const target = tmp.set(off * SPACING, 0.3, -Math.abs(off) * 0.7 + (focused ? 0.8 : 0));
      t.mesh.position.lerp(target, 0.2);
      const bump = focused ? 1.35 : (Math.abs(off) < 0.5 ? 1.12 : 0.92);
      const want = tmp.copy(t.baseScale).multiplyScalar(bump);
      t.mesh.scale.lerp(want, 0.2);
      t.mesh.rotation.y += (clamp(-off * 0.28, -0.9, 0.9) - t.mesh.rotation.y) * 0.2; // cover-flow tilt
      t.mesh.material.opacity = clamp(1 - Math.abs(off) * 0.22, 0.25, 1) * (focused ? 1 : 0.9);
    }
  }

  function openTile(i) { const v = tiles[i]?.video; if (v) v.play().catch(() => {}); }
  function closeTile() { const v = tiles[focusIndex]?.video; if (v) v.pause(); }

  return {
    connect,
    update,
    close: () => { clear(); active = false; },
    get active() { return active; },
    get isOpen() { return state === "open"; },
  };
}

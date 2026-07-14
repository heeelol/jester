// deck.js — the holographic media deck. Connect a folder (File System Access API,
// Chrome) and its photos/videos fan out as glowing holographic tiles. Point your
// index finger to highlight a tile, pinch to open it big, open your palm to close.
//
// This is 100% browser-side (the picked folder is read in the sandbox, nothing is
// uploaded and no OS access is involved), so it can never affect your PC.

import * as THREE from "three";
import { toWorld } from "../interaction/space.js";
import { pinchStrength, isSpread } from "../hands/gestures.js";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogg)$/i;
const MAX_TILES = 12;

// Grid placement in world space — a gentle arc facing the camera.
function tilePosition(i, n) {
  const cols = Math.min(n, 4);
  const rows = Math.ceil(n / cols);
  const col = i % cols, row = Math.floor(i / cols);
  const x = (col - (cols - 1) / 2) * 2.1;
  const y = ((rows - 1) / 2 - row) * 1.6 + 0.3;
  return new THREE.Vector3(x, y, -Math.abs(col - (cols - 1) / 2) * 0.3);
}

function holoFrame(w, h) {
  const geo = new THREE.PlaneGeometry(w, h);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x8fecff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  return edges;
}

export function createDeck(scene, camera) {
  const group = new THREE.Group();
  scene.add(group);
  const tiles = [];        // { mesh, kind, video? }
  let opened = null;       // currently enlarged tile
  let wasPinching = false;
  let active = false;

  const clear = () => {
    for (const t of tiles) {
      t.video?.pause();
      group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.map?.dispose();
      t.mesh.material.dispose();
    }
    tiles.length = 0; opened = null;
  };

  async function connect() {
    if (!window.showDirectoryPicker) { alert("Folder access needs Chrome/Edge (File System Access API)."); return false; }
    const dir = await window.showDirectoryPicker();
    clear();

    const entries = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file") continue;
      const kind = IMAGE_RE.test(name) ? "image" : VIDEO_RE.test(name) ? "video" : null;
      if (kind) entries.push({ name, handle, kind });
      if (entries.length >= MAX_TILES) break;
    }
    if (!entries.length) { alert("No photos or videos found in that folder."); return false; }

    for (let i = 0; i < entries.length; i++) {
      const { name, handle, kind } = entries[i];
      const file = await handle.getFile();
      const tile = await buildTile(file, kind, name);
      tile.mesh.position.copy(tilePosition(i, entries.length));
      tile.mesh.userData.home = tile.mesh.position.clone();
      group.add(tile.mesh);
      tiles.push(tile);
    }
    active = true;
    return true;
  }

  async function buildTile(file, kind, name) {
    const w = 1.7, h = 1.2;
    let texture, video = null;

    if (kind === "image") {
      const bitmap = await createImageBitmap(file);
      texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    } else {
      video = document.createElement("video");
      video.src = URL.createObjectURL(file);
      video.loop = true; video.muted = false; video.playsInline = true;
      texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
    }

    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.92 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.add(holoFrame(w, h));
    mesh.userData = { kind, name, highlight: 0 };
    return { mesh, kind, video };
  }

  // Project a world position to a normalized screen point (0..1, y-down) so we can
  // compare against the index fingertip's normalized image coordinates.
  const projected = new THREE.Vector3();
  function toScreen(worldPos) {
    projected.copy(worldPos).project(camera);
    return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
  }

  function update(hands, dt) {
    if (!active) return;

    // Use the first hand as the "pointer".
    const hand = hands[0];
    const tipWorld = hand ? toWorld(hand.landmarks[8]) : null; // index fingertip
    const pinching = hand ? pinchStrength(hand.landmarks) < 0.32 : false;
    const palmOpen = hand ? isSpread(hand.landmarks) : false;

    // Find the highlighted tile: nearest tile to the fingertip in world XY.
    let hot = null, hotD = 1.3;
    if (tipWorld && !opened) {
      for (const t of tiles) {
        const d = Math.hypot(t.mesh.position.x - tipWorld.x, t.mesh.position.y - tipWorld.y);
        if (d < hotD) { hot = t; hotD = d; }
      }
    }

    // Animate highlight + tile rest positions.
    for (const t of tiles) {
      const target = t === hot ? 1 : 0;
      t.mesh.userData.highlight += (target - t.mesh.userData.highlight) * 0.2;
      const lift = 1 + t.mesh.userData.highlight * 0.12;
      if (t !== opened) {
        t.mesh.position.lerp(t.mesh.userData.home, 0.2);
        t.mesh.scale.setScalar(lift);
        t.mesh.material.opacity = 0.55 + t.mesh.userData.highlight * 0.4;
      }
    }

    // Pinch (rising edge) opens the highlighted tile, or closes the open one.
    const pinchEdge = pinching && !wasPinching;
    wasPinching = pinching;

    if (opened) {
      // Keep the opened tile large and centered; a palm or a fresh pinch closes it.
      opened.mesh.position.lerp(new THREE.Vector3(0, 0.3, 1.2), 0.2);
      const s = 3.4; opened.mesh.scale.lerp(new THREE.Vector3(s, s, s), 0.2);
      opened.mesh.material.opacity = 1;
      if (palmOpen || pinchEdge) close();
    } else if (pinchEdge && hot) {
      open(hot);
    }
  }

  function open(tile) {
    opened = tile;
    if (tile.video) tile.video.play().catch(() => {});
  }
  function close() {
    if (opened?.video) opened.video.pause();
    opened = null;
  }

  return {
    connect,
    update,
    close: () => { clear(); active = false; },
    get active() { return active; },
    get isOpen() { return !!opened; },
  };
}

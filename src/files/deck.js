// deck.js — the holographic media deck. Connect a folder (File System Access API,
// Chrome) and its photos/videos fan out as glowing holographic tiles. Point your
// index finger to highlight a tile, pinch to open it big, open your palm to close.
//
// This is 100% browser-side (the picked folder is read in the sandbox, nothing is
// uploaded and no OS access is involved), so it can never affect your PC.
//
// Media is rendered crisp: textures use max anisotropy, tiles are sized to each
// file's real aspect ratio (no stretching), and the material bypasses tone-mapping
// so colours stay true. The caller drops scene bloom while an item is open so the
// photo/video reads sharp instead of hazy.

import * as THREE from "three";
import { toWorld } from "../interaction/space.js";
import { pinchStrength, isSpread } from "../hands/gestures.js";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogg)$/i;
const MAX_TILES = 12;
const H = 1.15;   // base tile height (world units); width follows the media aspect
const OPEN = 3.6; // opened tile height

function tilePosition(i, n) {
  const cols = Math.min(n, 4);
  const rows = Math.ceil(n / cols);
  const col = i % cols, row = Math.floor(i / cols);
  const x = (col - (cols - 1) / 2) * 2.3;
  const y = ((rows - 1) / 2 - row) * 1.7 + 0.3;
  return new THREE.Vector3(x, y, -Math.abs(col - (cols - 1) / 2) * 0.3);
}

// A unit-plane wireframe frame (scales with its parent tile).
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
  let opened = null, wasPinching = false, active = false;

  const clear = () => {
    for (const t of tiles) {
      t.video?.pause();
      if (t.video?.src) URL.revokeObjectURL(t.video.src);
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
      const tile = await buildTile(await handle.getFile(), kind, name);
      tile.mesh.position.copy(tilePosition(i, entries.length));
      tile.mesh.userData.home = tile.mesh.position.clone();
      group.add(tile.mesh);
      tiles.push(tile);
    }
    active = true;
    return true;
  }

  // Give a tile the aspect ratio of its media (unit plane + per-axis base scale).
  const setAspect = (tile, aspect) => { tile.baseScale.set(H * aspect, H, 1); };

  async function buildTile(file, kind, name) {
    let texture, video = null, aspect = 1;

    if (kind === "image") {
      const bitmap = await createImageBitmap(file);
      aspect = bitmap.width / bitmap.height;
      texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = maxAnisotropy;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
    } else {
      video = document.createElement("video");
      video.src = URL.createObjectURL(file);
      video.loop = true; video.playsInline = true; video.preload = "metadata";
      texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = maxAnisotropy;
    }

    // MeshBasicMaterial + toneMapped:false keeps photos true-colour and crisp
    // (ACES tone-mapping is for the glowing holograms, not for real imagery).
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.add(holoFrame());
    mesh.userData = { kind, name, highlight: 0 };

    const tile = { mesh, kind, video, baseScale: new THREE.Vector3() };
    setAspect(tile, aspect);
    if (video) video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth) setAspect(tile, video.videoWidth / video.videoHeight);
    }, { once: true });
    return tile;
  }

  const tmp = new THREE.Vector3();
  const openPos = new THREE.Vector3(0, 0.3, 1.2);

  function update(hands) {
    if (!active) return;
    const hand = hands[0];
    const tipWorld = hand ? toWorld(hand.landmarks[8]) : null; // index fingertip
    const pinching = hand ? pinchStrength(hand.landmarks) < 0.32 : false;
    const palmOpen = hand ? isSpread(hand.landmarks) : false;

    // Highlight the tile nearest the fingertip.
    let hot = null, hotD = 1.4;
    if (tipWorld && !opened) {
      for (const t of tiles) {
        const d = Math.hypot(t.mesh.position.x - tipWorld.x, t.mesh.position.y - tipWorld.y);
        if (d < hotD) { hot = t; hotD = d; }
      }
    }

    for (const t of tiles) {
      const target = t === hot ? 1 : 0;
      t.mesh.userData.highlight += (target - t.mesh.userData.highlight) * 0.2;
      if (t !== opened) {
        t.mesh.position.lerp(t.mesh.userData.home, 0.2);
        t.mesh.scale.copy(tmp.copy(t.baseScale).multiplyScalar(1 + t.mesh.userData.highlight * 0.12));
        t.mesh.material.opacity = 0.6 + t.mesh.userData.highlight * 0.4;
      }
    }

    const pinchEdge = pinching && !wasPinching;
    wasPinching = pinching;

    if (opened) {
      opened.mesh.position.lerp(openPos, 0.2);
      opened.mesh.scale.lerp(tmp.copy(opened.baseScale).multiplyScalar(OPEN / H), 0.2);
      opened.mesh.material.opacity = 1;
      if (palmOpen || pinchEdge) close();
    } else if (pinchEdge && hot) {
      open(hot);
    }
  }

  function open(tile) { opened = tile; if (tile.video) tile.video.play().catch(() => {}); }
  function close() { if (opened?.video) opened.video.pause(); opened = null; }

  return {
    connect,
    update,
    close: () => { clear(); active = false; },
    get active() { return active; },
    get isOpen() { return !!opened; },
  };
}

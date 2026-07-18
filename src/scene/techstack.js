// techstack.js — the "BUILT WITH" reveal, in 3D. Instead of flat logos, each
// technology is a holographic emblem that IS the thing: MediaPipe's hand
// skeleton, three.js's wireframe polyhedron, OpenAI's swirl (a torus knot), a
// Web-Audio equalizer, a WebSocket packet-link, and Electron's atom. They float
// in a shallow arc, stagger in on show(), gently animate, and fade out on hide().

import * as THREE from "three";
import { makeHoloMaterial } from "./holo.js";

// A brand-name plate that sits under each emblem.
function labelSprite(text, hex) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.font = "bold 58px Orbitron, Rajdhani, Arial";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = hex; ctx.shadowBlur = 22;
  ctx.fillStyle = "#eafcff";
  ctx.fillText(text, 256, 74);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
  spr.scale.set(1.5, 0.375, 1);
  return spr;
}

// A big title plate for the header.
function titleSprite(text) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 160;
  const ctx = c.getContext("2d");
  ctx.font = "900 92px Orbitron, Arial";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "#8fecff"; ctx.shadowBlur = 30;
  ctx.fillStyle = "#eafcff";
  ctx.fillText(text, 512, 90);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
  spr.scale.set(3.4, 0.53, 1);
  return spr;
}

// ── Emblem builders ───────────────────────────────────────────────────────
// Each returns { object: Group, anim(t) }. `object` is placed/scaled by the
// arc; `anim` drives internal motion (orbits, bars, packets).

function mediapipeEmblem() {
  // 21 hand landmarks + bones, MediaPipe's signature skeleton.
  const P = [
    [0.50, 0.92], [0.36, 0.82], [0.26, 0.70], [0.19, 0.60], [0.13, 0.52], // wrist + thumb
    [0.43, 0.58], [0.41, 0.40], [0.40, 0.28], [0.39, 0.18],               // index
    [0.52, 0.55], [0.53, 0.35], [0.54, 0.21], [0.55, 0.10],               // middle
    [0.62, 0.58], [0.65, 0.40], [0.67, 0.28], [0.69, 0.19],               // ring
    [0.72, 0.64], [0.77, 0.52], [0.80, 0.44], [0.83, 0.37],               // pinky
  ];
  const S = 0.9;
  const v = P.map(([x, y]) => new THREE.Vector3((x - 0.5) * S, (0.55 - y) * S, 0));
  const bones = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  const lg = new THREE.BufferGeometry().setFromPoints(bones.flatMap(([a, b]) => [v[a], v[b]]));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  const dg = new THREE.BufferGeometry().setFromPoints(v);
  const dots = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xd8f6ff, size: 0.07, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const g = new THREE.Group(); g.add(lines, dots);
  return { object: g, anim: () => {} };
}

function threejsEmblem() {
  const mat = makeHoloMaterial(0xffffff);
  const solid = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.42, 0)),
    new THREE.LineBasicMaterial({ color: 0xaef2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const g = new THREE.Group(); g.add(solid, wire);
  return { object: g, mat, anim: (t) => { g.rotation.y = t * 0.7; g.rotation.x = t * 0.35; } };
}

function openaiEmblem() {
  const mat = makeHoloMaterial(0x2fe0b0); // OpenAI green
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.30, 0.085, 140, 18, 2, 3), mat);
  const g = new THREE.Group(); g.add(knot);
  return { object: g, mat, anim: (t) => { g.rotation.y = t * 0.9; g.rotation.z = t * 0.4; } };
}

function webaudioEmblem() {
  // A live equalizer — five bars pumping like a spectrum.
  const bars = [];
  const g = new THREE.Group();
  const N = 5, w = 0.12, gap = 0.06;
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, w), makeHoloMaterial(0x59d8ff));
    m.position.x = (i - (N - 1) / 2) * (w + gap);
    g.add(m); bars.push(m);
  }
  return {
    object: g,
    anim: (t) => {
      bars.forEach((b, i) => {
        const h = 0.18 + 0.5 * (0.5 + 0.5 * Math.sin(t * 5 + i * 1.3)) + 0.12 * Math.sin(t * 11 + i);
        b.scale.y = h; b.position.y = (h - 1) / 2 * 1 - 0.35 + h / 2;
        b.material.uniforms.hold.value = h - 0.2;
      });
    },
  };
}

function websocketEmblem() {
  // Two endpoints with packets shuttling both ways along the link.
  const g = new THREE.Group();
  const nodeGeo = new THREE.IcosahedronGeometry(0.16, 1);
  const a = new THREE.Mesh(nodeGeo, makeHoloMaterial(0xffc061)); a.position.x = -0.5;
  const b = new THREE.Mesh(nodeGeo, makeHoloMaterial(0xffc061)); b.position.x = 0.5;
  const link = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([a.position, b.position]),
    new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  const packets = [0, 1].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff0cf, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  g.add(a, b, link, ...packets);
  return {
    object: g,
    anim: (t) => {
      const p0 = (t * 0.6) % 1, p1 = (t * 0.6 + 0.5) % 1;
      packets[0].position.set(-0.5 + p0, Math.sin(p0 * Math.PI) * 0.12, 0);
      packets[1].position.set(0.5 - p1, -Math.sin(p1 * Math.PI) * 0.12, 0);
    },
  };
}

function electronEmblem() {
  // Electron's own logo: a nucleus with three elliptical orbits + electrons.
  const g = new THREE.Group();
  const nucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 2), makeHoloMaterial(0x7fe9ff));
  g.add(nucleus);
  const orbits = [];
  for (let i = 0; i < 3; i++) {
    const o = new THREE.Group();
    const curve = new THREE.EllipseCurve(0, 0, 0.42, 0.17, 0, Math.PI * 2);
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(80).map((p) => new THREE.Vector3(p.x, p.y, 0))),
      new THREE.LineBasicMaterial({ color: 0x47cfe0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    o.rotation.z = (i * Math.PI) / 3;
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), new THREE.MeshBasicMaterial({ color: 0xe6ffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    o.add(ring, e); g.add(o); orbits.push({ o, e, phase: (i * Math.PI * 2) / 3 });
  }
  return {
    object: g,
    anim: (t) => {
      orbits.forEach(({ e, phase }) => { const a = t * 1.6 + phase; e.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.17, 0); });
    },
  };
}

const TECHS = [
  { build: mediapipeEmblem, label: "MediaPipe",      hex: "#6fd6ff" },
  { build: threejsEmblem,   label: "three.js",       hex: "#aef2ff" },
  { build: openaiEmblem,    label: "OpenAI · GPT-4o", hex: "#2fe0b0" },
  { build: webaudioEmblem,  label: "Web Audio",      hex: "#59d8ff" },
  { build: websocketEmblem, label: "WebSocket",      hex: "#ffb347" },
  { build: electronEmblem,  label: "Electron",       hex: "#7fe9ff" },
];

export function createTechStack(scene) {
  const root = new THREE.Group();
  root.position.set(0, 0.15, 2.2);
  root.visible = false;
  scene.add(root);

  const title = titleSprite("BUILT WITH");
  title.position.set(0, 1.35, 0);
  root.add(title);

  const N = TECHS.length;
  const items = TECHS.map((tech, i) => {
    const emblem = tech.build();
    const cell = new THREE.Group();
    // Even spread across x — no emblem at x=0, so the avatar pulses in the gap.
    const x = (i - (N - 1) / 2) * 1.12;
    cell.position.set(x, 0.35, 0);
    const label = tech.label ? labelSprite(tech.label, tech.hex) : null;
    if (label) { label.position.set(0, -0.62, 0); cell.add(label); }
    cell.add(emblem.object);
    cell.scale.setScalar(0.001);
    root.add(cell);
    return { emblem, cell, label, delay: 0.12 + i * 0.14, base: cell.position.clone() };
  });

  const mats = [];
  root.traverse((o) => { if (o.material?.uniforms?.time) mats.push(o.material); });

  let phase = "idle";   // idle | in | hold | out
  let t0 = 0;

  const easeOut = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);

  return {
    get visible() { return root.visible; },

    show() { root.visible = true; phase = "in"; t0 = -1; },

    hide() { if (root.visible) { phase = "out"; t0 = -1; } },

    update(t) {
      if (!root.visible) return;
      if (t0 < 0) t0 = t;             // capture start on first frame after show/hide
      const el = t - t0;
      for (const m of mats) m.uniforms.time.value = t;

      // Global fade for the whole reveal (0→1 in, 1→0 out).
      const global = phase === "out" ? 1 - easeOut(el / 0.5) : 1;
      if (phase === "out" && el >= 0.5) { root.visible = false; phase = "idle"; return; }

      title.material.opacity = global * easeOut((el - 0.05) / 0.5);

      items.forEach(({ emblem, cell, label, delay, base }) => {
        const a = phase === "out" ? 1 : easeOut((el - delay) / 0.55); // entrance 0→1
        const appear = a * global;
        cell.scale.setScalar(0.001 + appear);
        cell.position.y = base.y + (1 - appear) * -0.4;              // rise into place
        if (label) label.material.opacity = appear;
        emblem.object.position.y = Math.sin(t * 1.3 + delay * 8) * 0.05; // idle float
        emblem.anim(t);
        if (emblem.mat) emblem.mat.uniforms.hold.value = 0.25 + 0.25 * Math.sin(t * 2 + delay);
      });
    },
  };
}

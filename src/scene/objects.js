// objects.js — the scene, its grabbable holograms, and the render pipeline
// (ACES tone-mapping + bloom give everything that luminous hologram haze).
//
// Each hologram is a glowing wireframe over a ghost shell. Most are a single
// low-poly geometry; the "reactor" is a composite arc-reactor (concentric rings
// + a spinning core), so the object pipeline is generalized to walk an Object3D
// and update every holo material / wireframe it contains.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { makeHoloMaterial } from "./holo.js";
import { createEnvironment } from "./environment.js";

// Single-geometry holograms. The "reactor" is built separately (see buildObject).
const GEOMETRIES = {
  helmet: () => new THREE.TorusKnotGeometry(0.62, 0.22, 120, 10),
  globe:  () => new THREE.SphereGeometry(1, 18, 12),
  cube:   () => new THREE.BoxGeometry(1.5, 1.5, 1.5),
};

const smootherstep = (t) => t * t * (3 - 2 * t);

// A glowing wireframe over a translucent shell — the base hologram look.
function makeHolo(geo, color = 0x59d8ff) {
  const mesh = new THREE.Mesh(geo, makeHoloMaterial(color));
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xaef2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  mesh.add(wire);
  return mesh;
}

// Returns { obj, tick? }. `tick(dt)` animates internal parts (e.g. reactor rings).
function buildObject(name) {
  if (name === "reactor") {
    const g = new THREE.Group();
    const r1 = makeHolo(new THREE.TorusGeometry(1.0, 0.06, 16, 60));
    const r2 = makeHolo(new THREE.TorusGeometry(0.68, 0.05, 12, 48)); r2.rotation.x = Math.PI / 2;
    const r3 = makeHolo(new THREE.TorusGeometry(0.88, 0.02, 8, 60));  r3.rotation.y = Math.PI / 2;
    const core = makeHolo(new THREE.IcosahedronGeometry(0.34, 0), 0xaef2ff);
    g.add(r1, r2, r3, core);
    const tick = (dt) => {
      r1.rotation.z += dt * 0.6; r2.rotation.z -= dt * 0.9;
      r3.rotation.x += dt * 0.5; core.rotation.y += dt * 1.2;
    };
    return { obj: g, tick };
  }
  const make = GEOMETRIES[name] || GEOMETRIES.cube;
  return { obj: makeHolo(make()) };
}

export function createScene(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0.4, 6);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x04060a, 1);
  // Filmic tone-mapping rolls bright additive highlights off gracefully instead
  // of clipping them to a white blob — essential once bloom is stacked on top.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  container.appendChild(renderer.domElement);

  const environment = createEnvironment(scene);

  // Post-processing: render → bloom → output.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 0.25);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const grabbables = [];
  let prev = 0;
  let overlay = false; // desktop-overlay mode: transparent, no bloom, no grid

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();

  function spawn(name = "reactor") {
    const { obj, tick } = buildObject(name);

    // Collect every holo shader material and wireframe so the render loop can
    // drive them uniformly, whatever the object's internal structure.
    const holos = [], wires = [];
    obj.traverse((o) => {
      if (o.material?.uniforms?.hold) holos.push(o.material);
      if (o.isLineSegments) wires.push(o.material);
    });

    obj.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.5, 0);
    obj.scale.setScalar(0.001); // grows in via the birth animation below
    obj.userData = { name, heldBy: null, spin: 0.3 + Math.random() * 0.4, born: 0, hold: 0, holos, wires, tick };
    scene.add(obj);
    grabbables.push(obj);
    return obj;
  }

  function dismiss(obj) {
    scene.remove(obj);
    obj.traverse((o) => { o.geometry?.dispose?.(); });
    const i = grabbables.indexOf(obj);
    if (i >= 0) grabbables.splice(i, 1);
  }

  function dismissAll() { [...grabbables].forEach(dismiss); }

  function render(time) {
    const dt = Math.min(time - prev, 0.05); prev = time;
    environment.update(time);

    for (const obj of grabbables) {
      const u = obj.userData;

      // Birth pop-in over ~0.45s, then gestures take over.
      if (u.born < 1) {
        u.born = Math.min(u.born + dt / 0.45, 1);
        obj.scale.setScalar(smootherstep(u.born));
      }

      // Grabbed objects flare (hold) and stop drifting.
      const target = u.heldBy != null ? 1 : 0;
      u.hold += (target - u.hold) * 0.15;
      for (const m of u.holos) { m.uniforms.time.value = time; m.uniforms.hold.value = u.hold; }
      for (const w of u.wires) { w.opacity = 0.8 + u.hold * 0.2; }

      if (u.heldBy == null && u.born >= 1) {
        obj.rotation.y += u.spin * dt;
        u.tick?.(dt);
      }
    }

    // Overlay mode renders straight to the transparent framebuffer (no bloom pass,
    // which would fill the alpha) so the desktop shows through behind the model.
    if (overlay) renderer.render(scene, camera);
    else composer.render();
  }

  // Desktop overlay: transparent background + hide the grid/stars (they'd cover
  // the desktop). The JESTER avatar and any holograms stay visible.
  function setOverlayMode(on) {
    overlay = on;
    renderer.setClearColor(0x04060a, on ? 0 : 1);
    environment.setVisible(!on);
  }

  return {
    scene, camera, grabbables, spawn, dismiss, dismissAll, render, GEOMETRIES,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    setBloom: (s) => { bloom.strength = s; }, // dial bloom down while viewing media
    setOverlayMode,
  };
}

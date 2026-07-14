// objects.js — the scene, its grabbable holograms, and the render pipeline
// (bloom post-processing gives everything that luminous hologram haze).
//
// Holograms are procedural geometries (no asset files — runs the moment you open
// the page). Swap any factory below for a GLTF loader later without touching the
// interaction or voice code: both drive this same small API.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { makeHoloMaterial } from "./holo.js";
import { createEnvironment } from "./environment.js";

// Named registry — the vocabulary shared by voice commands and the spawn menu.
// Kept low-poly so the wireframe overlay reads as clean holographic structure.
const GEOMETRIES = {
  reactor: () => new THREE.IcosahedronGeometry(1, 0),
  helmet:  () => new THREE.TorusKnotGeometry(0.62, 0.22, 120, 10),
  globe:   () => new THREE.SphereGeometry(1, 18, 12),
  cube:    () => new THREE.BoxGeometry(1.5, 1.5, 1.5),
};

const smootherstep = (t) => t * t * (3 - 2 * t);

export function createScene(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0.4, 6);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x04060a, 1);
  // Filmic tone-mapping rolls bright additive highlights off gracefully instead
  // of clipping them to a white blob — essential once bloom is stacked on top.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  container.appendChild(renderer.domElement);

  const environment = createEnvironment(scene);

  // Post-processing: render → bloom → output. Bloom is what sells the hologram
  // look, blooming the bright additive rims into a soft glow.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 0.25);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const grabbables = [];
  let prev = 0;

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
    const make = GEOMETRIES[name] || GEOMETRIES.reactor;
    const geo = make();
    // A ghostly translucent shell (shader) + a bright wireframe of the geometry
    // edges. The wireframe is what makes it read as a Stark hologram — glowing
    // structure rather than a solid disc.
    const mesh = new THREE.Mesh(geo, makeHoloMaterial());
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xaef2ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mesh.add(wire);
    mesh.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.5, 0);
    mesh.scale.setScalar(0.001); // grows in via the birth animation below
    mesh.userData = { name, heldBy: null, spin: 0.3 + Math.random() * 0.4, born: 0, wire };
    scene.add(mesh);
    grabbables.push(mesh);
    return mesh;
  }

  function dismiss(mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.userData.wire?.geometry.dispose();
    const i = grabbables.indexOf(mesh);
    if (i >= 0) grabbables.splice(i, 1);
  }

  function dismissAll() { [...grabbables].forEach(dismiss); }

  function render(time) {
    const dt = Math.min(time - prev, 0.05); prev = time;
    environment.update(time);

    for (const mesh of grabbables) {
      const u = mesh.material.uniforms;
      u.time.value = time;

      // Birth animation: pop in with an overshoot over ~0.45s, then hand control
      // to gestures.
      if (mesh.userData.born < 1) {
        mesh.userData.born = Math.min(mesh.userData.born + dt / 0.45, 1);
        mesh.scale.setScalar(smootherstep(mesh.userData.born));
      }

      // Grabbed objects flare (hold uniform) and stop their idle drift.
      const target = mesh.userData.heldBy != null ? 1 : 0;
      u.hold.value += (target - u.hold.value) * 0.15;
      mesh.userData.wire.material.opacity = 0.8 + u.hold.value * 0.2;
      if (mesh.userData.heldBy == null && mesh.userData.born >= 1) {
        mesh.rotation.y += mesh.userData.spin * dt;
      }
    }

    composer.render();
  }

  return { scene, camera, grabbables, spawn, dismiss, dismissAll, render, GEOMETRIES };
}

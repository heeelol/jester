// environment.js — the world the holograms float in: a glowing floor grid that
// recedes into fog, a drifting starfield for depth, and a big faint backdrop
// ring. All additive so it blooms. Returns an `update(time)` to animate it.

import * as THREE from "three";

const HOLO = 0x59d8ff;

// A flat shader-grid plane: crisp glowing lines that fade with distance.
function makeGrid() {
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(HOLO) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float time;
      uniform vec3  color;
      varying vec2 vUv;
      // Antialiased grid lines via screen-space derivatives.
      float gridLines(vec2 p, float step) {
        vec2 g = abs(fract(p / step - 0.5) - 0.5) / fwidth(p / step);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        vec2 p = vUv * 60.0;
        float line = gridLines(p, 1.0);
        // Radial fade so the grid dissolves toward the horizon.
        float fade = smoothstep(1.0, 0.15, length(vUv - 0.5) * 2.0);
        // A ripple of brightness travelling outward.
        float pulse = 0.6 + 0.4 * sin(length(vUv - 0.5) * 20.0 - time * 1.5);
        gl_FragColor = vec4(color * (0.6 + pulse * 0.5), line * fade * 0.5);
      }
    `,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), material);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -3.2;
  return grid;
}

// A cloud of faint glowing points, slowly rotating.
function makeStarfield(count = 700) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 24;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40 - 8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: HOLO, size: 0.05, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

// A large, faint wireframe ring far behind everything.
function makeBackdropRing() {
  const geo = new THREE.TorusGeometry(12, 0.05, 8, 120);
  const mat = new THREE.MeshBasicMaterial({
    color: HOLO, transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.z = -14;
  return ring;
}

export function createEnvironment(scene) {
  const fog = new THREE.FogExp2(0x04060a, 0.035);
  scene.fog = fog;

  const grid = makeGrid();
  const stars = makeStarfield();
  const ring = makeBackdropRing();
  scene.add(grid, stars, ring);

  return {
    update(time) {
      grid.material.uniforms.time.value = time;
      stars.rotation.y = time * 0.02;
      ring.rotation.z = time * 0.05;
    },
    // Hidden in the desktop overlay (the grid/stars would occlude the desktop).
    setVisible(v) {
      grid.visible = v; stars.visible = v; ring.visible = v;
      scene.fog = v ? fog : null;
    },
  };
}

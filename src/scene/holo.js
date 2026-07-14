// holo.js — the holographic look. A single unlit ShaderMaterial combining a
// fresnel rim glow, scrolling scanlines, a bright scan-sweep band that rises
// through the object, and a flicker. The `hold` uniform (0..1) is driven up when
// the object is grabbed, making it flare brighter under your hand.
//
// Materials are additively blended so holograms read as projected light. Bloom
// (post-processing) then blooms the bright rims into that classic hologram haze.

import * as THREE from "three";

const vertex = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vPos;
  void main() {
    vPos = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld  = world.xyz;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView   = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */`
  uniform float time;
  uniform vec3  color;
  uniform float opacity;
  uniform float hold;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vPos;

  void main() {
    // Rim light: bright where the surface faces away from the camera.
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.2);

    // Fine scrolling scanlines in world space.
    float scan  = 0.5 + 0.5 * sin(vWorld.y * 45.0 - time * 2.5);
    float lines = mix(0.65, 1.0, smoothstep(0.35, 0.65, scan));

    // A single bright band that rises through the object's local height.
    float sweepPos = fract(vPos.y * 0.5 - time * 0.25);
    float sweep    = smoothstep(0.0, 0.04, sweepPos) * (1.0 - smoothstep(0.04, 0.09, sweepPos));

    // Projector flicker.
    float flick = 0.92 + 0.08 * sin(time * 34.0);

    float base  = 0.12 + fresnel * 0.9;
    float glow  = base * flick * lines + sweep * 0.8;
    glow *= 1.0 + hold * 1.4;                 // flare when grabbed

    vec3 rgb = color * (0.55 + fresnel * 1.7 + hold * 0.6);
    rgb += vec3(0.9) * sweep;                 // white-hot sweep line

    gl_FragColor = vec4(rgb, glow * opacity);
  }
`;

export function makeHoloMaterial(color = 0x59d8ff) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time:    { value: 0 },
      color:   { value: new THREE.Color(color) },
      opacity: { value: 1 },
      hold:    { value: 0 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

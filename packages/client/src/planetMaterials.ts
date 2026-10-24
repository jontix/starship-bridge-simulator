import {
  Color3, Effect, ShaderMaterial, StandardMaterial, Vector3, type Scene
} from "@babylonjs/core";
import type { CelestialBody } from "@bridge-sim/shared";
import type { PlanetTextures } from "./planetTextures";

/**
 * All shading takes place in the camera-relative planetary sky, NOT the
 * astronomical metre coordinate system. The sky camera is always at (0,0,0).
 * The surface normals and sunlight direction are world-space unit vectors.
 */
const vertexSource = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec2 vUV;
void main(void) {
  vec4 worldPoint = world * vec4(position, 1.0);
  vWorldPosition = worldPoint.xyz;
  vNormal = normalize(mat3(world) * normal);
  vLocalPosition = position;
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const surfaceFragment = `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec2 vUV;
uniform sampler2D surfaceSampler;
uniform sampler2D nightSampler;
uniform vec3 sunDirection;
uniform float nightIntensity;
uniform float oceanIntensity;
uniform float stellar;
uniform float contrastGain;
const float PI = 3.14159265;

void main(void) {
  vec4 texel = texture2D(surfaceSampler, vUV);
  vec3 n = normalize(vNormal);
  vec3 toSun = normalize(sunDirection);
  vec3 toEye = normalize(-vWorldPosition);
  float cosSun = dot(n, toSun);
  if (stellar > 0.5) {
    // Physically motivated stellar limb darkening: brighter at disc centre.
    float mu = max(0.0, dot(n, toEye));
    float limb = 0.54 + 0.46 * pow(mu, 0.42);
    vec3 solar = texel.rgb * (1.22 + 0.21 * contrastGain) * limb;
    gl_FragColor = vec4(solar, 1.0);
    return;
  }

  // Work roughly in linear-light space. Surface maps are artist-graded sRGB
  // and must not be applied as flat emissive colours (the v1 washed-out look).
  vec3 albedo = pow(max(texel.rgb, vec3(0.0)), vec3(2.15));
  float sun = max(0.0, cosSun);
  float terminator = smoothstep(-0.04, 0.06, cosSun);
  float illumination = 0.012 + terminator * (0.035 + 1.08 * sun);
  vec3 lit = albedo * illumination;

  // Separate ocean reflectance data lives in the G channel of the night map.
  // Rough, dim land; tight, coloured, star-reflecting ocean specularity.
  vec4 secondary = texture2D(nightSampler, vUV);
  float ocean = secondary.g * oceanIntensity;
  vec3 halfVector = normalize(toSun + toEye);
  float specAngle = max(0.0, dot(n, halfVector));
  float seaGlitter = pow(specAngle, 145.0) * 0.65
                    + pow(specAngle, 14.0) * 0.075;
  lit += ocean * seaGlitter * vec3(0.56, 0.70, 0.83) * terminator;

  // No uniform city glow: emission appears only in inhabited night-side areas.
  float night = 1.0 - smoothstep(-0.19, 0.08, cosSun);
  float city = secondary.r * nightIntensity;
  lit += vec3(1.25, 0.49, 0.15) * city * night * 1.35;

  // Soft filmic rolloff for highlights, rather than clipping to flat white.
  lit *= contrastGain;
  lit = lit / (vec3(1.0) + lit * 0.28);
  gl_FragColor = vec4(pow(max(lit, vec3(0.0)), vec3(1.0 / 2.15)), 1.0);
}
`;

const cloudFragment = `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec2 vUV;
uniform sampler2D cloudSampler;
uniform vec3 sunDirection;
uniform float cloudOpacity;
void main(void) {
  vec4 cloud = texture2D(cloudSampler, vUV);
  vec3 n = normalize(vNormal);
  float illumination = dot(n, normalize(sunDirection));
  float day = smoothstep(-0.16, 0.22, illumination);
  // Thin veils are translucent, thick convective cloud banks stay bright.
  // Avoid the solid opaque white layer that hid most of Haven in v1.
  float opacity = cloud.a * cloudOpacity;
  if (opacity < 0.008) discard;
  vec3 white = mix(vec3(0.018, 0.031, 0.055),
                   vec3(0.86, 0.91, 0.97) * (0.57 + 0.40 * max(0.0, illumination)),
                   day);
  gl_FragColor = vec4(white * mix(0.72, 1.0, opacity), opacity);
}
`;

/**
 * Finite-volume Rayleigh/Mie-inspired scattering over a spherical atmosphere.
 *
 * Every fragment traces a world-space camera ray through the atmosphere's
 * actual projected shell. Optical depth decays exponentially with altitude.
 * Surface hits truncate the integral, so the near/limb view has no opaque
 * overlapping bands. This is an orbital-view approximation, not a full
 * Bruneton LUT model or a planet-surface atmospheric renderer.
 */
const atmosphereFragment = `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec2 vUV;
uniform vec3 sunDirection;
uniform vec3 atmosphereColor;
uniform vec3 planetCenter;
uniform float planetRadius;
uniform float atmosphereRadius;
uniform float atmosphereDensity;
const int STEPS = 14;

void main(void) {
  vec3 dir = normalize(vWorldPosition); // camera = origin
  vec3 fromCenter = -planetCenter;
  float b = dot(fromCenter, dir);
  float outerC = dot(fromCenter, fromCenter) - atmosphereRadius * atmosphereRadius;
  float outerDisc = b * b - outerC;
  if (outerDisc <= 0.0) discard;

  float outerRoot = sqrt(outerDisc);
  float nearT = max(0.0, -b - outerRoot);
  float farT = -b + outerRoot;
  if (farT <= nearT) discard;

  // Do not scatter the part of the atmosphere hidden by solid ground.
  float groundC = dot(fromCenter, fromCenter) - planetRadius * planetRadius;
  float groundDisc = b * b - groundC;
  if (groundDisc > 0.0) {
    float groundT = -b - sqrt(groundDisc);
    if (groundT > 0.0) farT = min(farT, groundT);
  }
  if (farT <= nearT) discard;

  vec3 toSun = normalize(sunDirection);
  float shellThickness = max(0.0001, atmosphereRadius - planetRadius);
  float stepSize = (farT - nearT) / float(STEPS);
  float optical = 0.0;
  vec3 gatheredLight = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    float t = nearT + (float(i) + 0.5) * stepSize;
    vec3 samplePoint = dir * t - planetCenter;
    float radial = length(samplePoint);
    float altitude = max(0.0, (radial - planetRadius) / shellThickness);
    // Much denser at low altitude; extremely thin at the visible outer edge.
    float molecular = exp(-altitude * 6.5);
    vec3 normal = samplePoint / max(radial, 0.0001);
    float solar = dot(normal, toSun);
    // A little twilight scattering even slightly beyond the terminator.
    float sunVisibility = smoothstep(-0.23, 0.18, solar);
    float increment = molecular * (stepSize / shellThickness);
    optical += increment;
    gatheredLight += increment * sunVisibility *
      (0.35 + 0.65 * max(0.0, solar));
  }

  float opacity = (1.0 - exp(-optical * 0.21 * atmosphereDensity));
  float sunlight = gatheredLight / max(optical, 0.0001);
  float rayToSun = dot(dir, toSun);
  float forwardScatter = pow(max(0.0, rayToSun), 11.0) * 0.35;
  float viewOpacity = min(0.62, opacity * (0.65 + forwardScatter));
  vec3 rayleighBlue = atmosphereColor * vec3(0.55, 0.79, 1.12);
  vec3 color = mix(rayleighBlue, vec3(0.82, 0.65, 0.49), forwardScatter);
  color *= 0.28 + 0.92 * sunlight;

  // Subtle dithering avoids noticeable 8-bit colour contour bands.
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  color += (jitter - 0.5) / 512.0;
  gl_FragColor = vec4(color, viewOpacity);
}
`;

// Dynamic, seamless granulation and sunspots applied to a rotating star globe.
// The underlying equirectangular map provides the large-scale chromosphere.
const stellarFragment = `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec2 vUV;
uniform sampler2D surfaceSampler;
uniform float stellarTime;
uniform float stellarActivity;
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i), n100 = hash3(i + vec3(1,0,0));
  float n010 = hash3(i + vec3(0,1,0)), n110 = hash3(i + vec3(1,1,0));
  float n001 = hash3(i + vec3(0,0,1)), n101 = hash3(i + vec3(1,0,1));
  float n011 = hash3(i + vec3(0,1,1)), n111 = hash3(i + vec3(1,1,1));
  float a = mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y);
  float b = mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y);
  return mix(a,b,f.z);
}
void main(void) {
  vec3 n = normalize(vNormal);
  vec3 eye = normalize(-vWorldPosition);
  float mu = max(0.0, dot(n, eye));
  vec3 p = normalize(vLocalPosition);
  float tick = stellarTime;
  float granulation = noise3(p * 80.0 + vec3(tick * 0.04, 0, tick * 0.02));
  float convection = noise3(p * 19.0 + vec3(0.0, tick * 0.07, 0.0));
  float spots = noise3(p * 8.0 + vec3(tick * 0.008, 0.0, 0.0));
  float spotMask = 1.0 - smoothstep(0.17, 0.31, spots);
  float cellular = 0.63 + 0.34 * granulation + 0.13 * convection;
  float limb = 0.43 + 0.57 * pow(mu, 0.49);
  vec3 base = texture2D(surfaceSampler, vUV).rgb;
  vec3 colour = mix(vec3(1.0,0.45,0.11), vec3(1.0,0.92,0.59), granulation);
  colour *= mix(0.16, 1.0, 1.0 - spotMask * stellarActivity);
  colour *= cellular * limb;
  colour = mix(colour, base * 0.89 * limb, 0.21);
  gl_FragColor = vec4(colour, 1.0);
}
`;

let registered = false;
function registerShaders(): void {
  if (registered) return;
  for (const [name, source] of [
    ["bridgePlanet", surfaceFragment],
    ["bridgeCloud", cloudFragment],
    ["bridgeAtmosphere", atmosphereFragment],
    ["bridgeStellar", stellarFragment]
  ] as const) {
    Effect.ShadersStore[name + "VertexShader"] = vertexSource;
    Effect.ShadersStore[name + "FragmentShader"] = source;
  }
  registered = true;
}

function shader(scene: Scene, name: string, kind: string, transparent = false): ShaderMaterial {
  registerShaders();
  const material = new ShaderMaterial(name, scene, {
    vertex: "bridge" + kind, fragment: "bridge" + kind
  }, {
    attributes: ["position", "normal", "uv"],
    uniforms: [
      "world", "worldViewProjection", "sunDirection", "nightIntensity",
      "oceanIntensity", "stellar", "contrastGain", "cloudOpacity",
      "atmosphereColor", "planetCenter", "planetRadius", "atmosphereRadius",
      "atmosphereDensity", "stellarTime", "stellarActivity"
    ],
    samplers: ["surfaceSampler", "nightSampler", "cloudSampler"],
    needAlphaBlending: transparent,
    needAlphaTesting: false
  });
  material.backFaceCulling = true;
  return material;
}

export function surfaceMaterial(scene: Scene, body: CelestialBody, textures: PlanetTextures): ShaderMaterial {
  const material = shader(scene, body.id + "-surface-v2", "Planet");
  material.setTexture("surfaceSampler", textures.surface);
  material.setTexture("nightSampler", textures.night ?? textures.surface);
  material.setFloat("nightIntensity", textures.night ? 1 : 0);
  material.setFloat("oceanIntensity", body.appearance?.archetype === "ocean" ? 1 : 0);
  material.setFloat("stellar", body.appearance?.archetype === "stellar" ? 1 : 0);
  material.setFloat("contrastGain", 1.08);
  return material;
}

export function starMaterial(scene: Scene, body: CelestialBody, textures: PlanetTextures): ShaderMaterial {
  const material = shader(scene, body.id + "-stellar-v2", "Stellar");
  material.setTexture("surfaceSampler", textures.surface);
  material.setFloat("stellarTime", 0);
  material.setFloat("stellarActivity", 0.83);
  return material;
}

export function cloudMaterial(scene: Scene, body: CelestialBody, textures: PlanetTextures): ShaderMaterial {
  const material = shader(scene, body.id + "-clouds-v2", "Cloud", true);
  if (!textures.clouds) throw new Error("Missing cloud texture for " + body.id);
  material.setTexture("cloudSampler", textures.clouds);
  material.setFloat("cloudOpacity", 0.42);
  material.backFaceCulling = true;
  return material;
}

export function atmosphereMaterial(scene: Scene, body: CelestialBody): ShaderMaterial {
  const material = shader(scene, body.id + "-atmosphere-v2", "Atmosphere", true);
  const color = Color3.FromHexString(body.appearance?.atmosphere?.colorHex ?? "#73bdff");
  material.setColor3("atmosphereColor", color);
  material.setVector3("planetCenter", Vector3.Zero());
  material.setFloat("planetRadius", 1);
  material.setFloat("atmosphereRadius", 1.03);
  material.setFloat("atmosphereDensity", 0.75);
  material.backFaceCulling = true; // Integrate atmospheric path only once, not through back faces again.
  material.disableDepthWrite = true;
  return material;
}

export function placeholderMaterial(scene: Scene, body: CelestialBody): StandardMaterial {
  const material = new StandardMaterial(body.id + "-placeholder", scene);
  material.diffuseColor = Color3.FromHexString(body.mapColor);
  material.emissiveColor = material.diffuseColor.scale(0.21);
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  return material;
}

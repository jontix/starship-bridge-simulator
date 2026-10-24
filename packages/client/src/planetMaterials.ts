import { Color3, Effect, ShaderMaterial, StandardMaterial, type Scene } from "@babylonjs/core";
import type { CelestialBody } from "@bridge-sim/shared";
import type { PlanetTextures } from "./planetTextures";

const vertexSource = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec2 vUV;
void main(void) {
  vec4 worldPosition = world * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(world) * normal);
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const surfaceFragment = `
precision highp float;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec2 vUV;
uniform sampler2D surfaceSampler;
uniform sampler2D nightSampler;
uniform vec3 sunDirection;
uniform float nightIntensity;
uniform float oceanIntensity;
uniform float stellar;
void main(void) {
  vec4 surface = texture2D(surfaceSampler, vUV);
  if (stellar > 0.5) {
    gl_FragColor = vec4(surface.rgb * 1.28, 1.0);
    return;
  }
  vec3 normal = normalize(vWorldNormal);
  vec3 lightDir = normalize(sunDirection);
  float daylight = dot(normal, lightDir);
  float diffuse = max(0.0, daylight);
  float softTerminator = smoothstep(-0.08, 0.15, daylight);
  float illumination = 0.018 + softTerminator * (0.15 + 0.98 * diffuse);
  vec3 color = surface.rgb * illumination;
  float nightSide = 1.0 - smoothstep(-0.2, 0.11, daylight);
  float city = texture2D(nightSampler, vUV).r * nightIntensity;
  color += city * vec3(1.15, 0.68, 0.29) * nightSide * 1.4;
  vec3 eye = normalize(-vWorldPosition);
  vec3 halfVector = normalize(lightDir + eye);
  float highlight = pow(max(0.0, dot(normal, halfVector)), 95.0);
  float oceanMask = texture2D(nightSampler, vUV).g * oceanIntensity;
  color += oceanMask * highlight * vec3(0.45, 0.67, 0.83) * softTerminator;
  gl_FragColor = vec4(color, 1.0);
}
`;

const cloudsFragment = `
precision highp float;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec2 vUV;
uniform sampler2D cloudSampler;
uniform vec3 sunDirection;
void main(void) {
  vec4 cloud = texture2D(cloudSampler, vUV);
  float daylight = dot(normalize(vWorldNormal), normalize(sunDirection));
  float lit = 0.10 + 0.90 * smoothstep(-0.12, 0.36, daylight);
  gl_FragColor = vec4(cloud.rgb * lit, cloud.a * 0.88);
}
`;

const atmosphereFragment = `
precision highp float;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec2 vUV;
uniform vec3 sunDirection;
uniform vec3 atmosphereColor;
void main(void) {
  vec3 normal = normalize(vWorldNormal);
  vec3 toEye = normalize(-vWorldPosition);
  float mu = max(0.0, dot(normal, toEye));
  float rim = pow(1.0 - mu, 3.0);
  float sunlit = smoothstep(-0.32, 0.4, dot(normal, normalize(sunDirection)));
  vec3 color = atmosphereColor * (0.40 + 0.85 * sunlit);
  gl_FragColor = vec4(color, rim * (0.08 + sunlit * 0.54));
}
`;

let registered = false;
function registerShaders(): void {
  if (registered) return;
  Effect.ShadersStore["bridgePlanetVertexShader"] = vertexSource;
  Effect.ShadersStore["bridgePlanetFragmentShader"] = surfaceFragment;
  Effect.ShadersStore["bridgeCloudVertexShader"] = vertexSource;
  Effect.ShadersStore["bridgeCloudFragmentShader"] = cloudsFragment;
  Effect.ShadersStore["bridgeAtmosphereVertexShader"] = vertexSource;
  Effect.ShadersStore["bridgeAtmosphereFragmentShader"] = atmosphereFragment;
  registered = true;
}

function shader(scene: Scene, name: string, kind: string, transparent = false): ShaderMaterial {
  registerShaders();
  return new ShaderMaterial(name, scene, { vertex: "bridge" + kind, fragment: "bridge" + kind }, {
    attributes: ["position", "normal", "uv"],
    uniforms: ["world", "worldViewProjection", "sunDirection", "nightIntensity", "oceanIntensity", "stellar", "atmosphereColor"],
    samplers: ["surfaceSampler", "nightSampler", "cloudSampler"],
    needAlphaBlending: transparent,
    needAlphaTesting: false
  });
}

export function surfaceMaterial(scene: Scene, body: CelestialBody, textures: PlanetTextures): ShaderMaterial {
  const material = shader(scene, body.id + "-surface-shader", "Planet");
  material.setTexture("surfaceSampler", textures.surface);
  material.setTexture("nightSampler", textures.night ?? textures.surface);
  material.setFloat("nightIntensity", textures.night ? 1 : 0);
  material.setFloat("oceanIntensity", body.appearance?.archetype === "ocean" ? 1 : 0);
  material.setFloat("stellar", body.appearance?.archetype === "stellar" ? 1 : 0);
  material.backFaceCulling = true;
  return material;
}

export function cloudMaterial(scene: Scene, body: CelestialBody, textures: PlanetTextures): ShaderMaterial {
  const material = shader(scene, body.id + "-cloud-shader", "Cloud", true);
  if (!textures.clouds) throw new Error("Missing cloud texture");
  material.setTexture("cloudSampler", textures.clouds);
  material.backFaceCulling = true;
  return material;
}

export function atmosphereMaterial(scene: Scene, body: CelestialBody): ShaderMaterial {
  const material = shader(scene, body.id + "-atmosphere-shader", "Atmosphere", true);
  const color = Color3.FromHexString(body.appearance?.atmosphere?.colorHex ?? "#73bdff");
  material.setColor3("atmosphereColor", color);
  material.backFaceCulling = true;
  return material;
}

export function placeholderMaterial(scene: Scene, body: CelestialBody): StandardMaterial {
  const mat = new StandardMaterial(body.id + "-placeholder", scene);
  mat.diffuseColor = Color3.FromHexString(body.mapColor);
  mat.emissiveColor = Color3.FromHexString(body.mapColor).scale(0.22);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  return mat;
}

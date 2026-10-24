import { Texture, type Scene, type ShaderMaterial } from "@babylonjs/core";
import type { CelestialBody } from "@bridge-sim/shared";

/**
 * Asset priority:
 *  1. Curated artist-supplied textures in src/assets/planets/<body-id>/.
 *  2. Build-generated deterministic maps in src/assets/generated-planets/<body-id>/.
 *  3. Runtime procedural fallback for unbuilt/unknown worlds.
 *
 * Vite bundles both sets when they exist before Vite starts. The root
 * npm run dev/build scripts generate Haven's maps beforehand.
 */
const curated = import.meta.glob(
  "./assets/planets/*/*.{png,jpg,jpeg,webp}",
  { eager:true, query:"?url", import:"default" }
) as Record<string,string>;
const generated = import.meta.glob(
  "./assets/generated-planets/*/*.{png,jpg,jpeg,webp}",
  { eager:true, query:"?url", import:"default" }
) as Record<string,string>;
const generatedManifests = import.meta.glob(
  "./assets/generated-planets/*/manifest.json",
  { eager: true, import: "default" }
) as Record<string, { options?: { seed?: number } }>;

/** Use the same seed for baked continents and shader-space microterrain.
 * New planets without generated assets fall back to their catalog seed.
 */
export function getGeneratedPlanetSeed(body: CelestialBody): number {
  const key = "./assets/generated-planets/" + body.id + "/manifest.json";
  const seed = generatedManifests[key]?.options?.seed;
  return Number.isFinite(seed) ? seed! : (body.appearance?.seed ?? 1);
}

function locateIn(collection: Record<string,string>, bodyId: string, channel: string,
  folder: string): string | null {
  const prefix="./assets/"+folder+"/"+bodyId+"/"+channel+".";
  for(const [path,url] of Object.entries(collection))
    if(path.startsWith(prefix))return url;
  return null;
}
function locate(bodyId:string,channel:string):string|null{
  return locateIn(curated,bodyId,channel,"planets") ??
    locateIn(generated,bodyId,channel,"generated-planets");
}

/** Avoid expensive browser-side 1536px terrain generation when bundled
 * albedo already exists. A missing browser-only development asset still uses
 * the old procedural fallback.
 */
export function hasBundledPlanetAssets(bodyId:string):boolean{
  return Boolean(locate(bodyId,"albedo"));
}

export function attachAuthoredPlanetTextures(
  scene: Scene, body: CelestialBody,
  surfaceMaterial: ShaderMaterial, cloudMaterial: ShaderMaterial | null
): void {
  const channels=[
    {name:"albedo",sampler:"surfaceSampler",target:surfaceMaterial},
    {name:"night",sampler:"nightSampler",target:surfaceMaterial},
    {name:"height",sampler:"heightSampler",target:surfaceMaterial},
    {name:"roughness",sampler:"roughnessSampler",target:surfaceMaterial},
    {name:"clouds",sampler:"cloudSampler",target:cloudMaterial}
  ] as const;
  for(const channel of channels){
    if(!channel.target)continue;
    const url=locate(body.id,channel.name);
    if(!url)continue;
    const texture=new Texture(url,scene,false,false,Texture.TRILINEAR_SAMPLINGMODE,
      ()=>{
        texture.wrapU=Texture.WRAP_ADDRESSMODE;
        texture.wrapV=Texture.CLAMP_ADDRESSMODE;
        texture.hasAlpha=channel.name==="clouds";
        channel.target!.setTexture(channel.sampler,texture);
      },
      (_message,_exception)=>{
        console.warn("Planet map unavailable; retaining procedural fallback:",body.id,channel.name);
        texture.dispose();
      }
    );
  }
}

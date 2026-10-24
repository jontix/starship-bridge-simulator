/**
 * Starship Bridge — art-directed seeded spherical planet generator.
 * Pure JavaScript, shared by CLI and automated tests; no browser or renderer APIs.
 * Algorithm v1: warped continental fBm + ridged ranges, simple climate/biomes,
 * satellite/cloud fields, coastal settlement lights and finite-difference normals.
 * Equirectangular map is sampled from 3D unit-sphere noise (seam-free).
 */
export const GENERATOR_VERSION = "planet-art-v1";

const clamp = (x, lo=0, hi=1) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b-a)*t;
const smooth = t => t*t*(3-2*t);
const byte = x => Math.round(clamp(x,0,255));

export const PRESETS = Object.freeze({
  haven: Object.freeze({
    id:"haven", name:"Haven", seed:48271, width:1024, oceanCoverage:0.68,
    continentalScale:1.6, mountainStrength:0.68, moisture:0.60,
    cloudCoverage:0.42, polarCooling:0.84, axialTiltDegrees:24
  }),
  // Demonstrates same generator with a distinct seed/parameters; not yet a
  // replacement for specialised airless/gas-giant shaders in the simulator.
  verdant: Object.freeze({
    id:"verdant", name:"Verdant (prototype)", seed:71843, width:1024,
    oceanCoverage:0.48, continentalScale:2.2, mountainStrength:0.92,
    moisture:0.79, cloudCoverage:0.62, polarCooling:0.64, axialTiltDegrees:17
  })
});

export function validateOptions(options){
  const o={...PRESETS.haven,...options};
  if(!/^[a-z0-9-]{2,48}$/.test(o.id))throw new Error("Invalid planet id");
  if(!Number.isSafeInteger(o.seed) || o.seed<0 || o.seed>2147483647)throw new Error("seed must be a nonnegative 32-bit integer");
  if(!Number.isInteger(o.width)||o.width<128||o.width>4096||o.width%2)throw new Error("width must be an even integer 128–4096");
  const bounds={oceanCoverage:[0.15,0.90],continentalScale:[0.6,4], mountainStrength:[0,1.5],moisture:[0,1],cloudCoverage:[0,1],polarCooling:[0,1.5],axialTiltDegrees:[0,85]};
  for(const [key,[lo,hi]] of Object.entries(bounds))if(!Number.isFinite(o[key])||o[key]<lo||o[key]>hi)throw new Error(`${key} must be in ${lo}..${hi}`);
  return o;
}

function hash3(x,y,z,seed){
  let h = Math.imul(x,374761393) ^ Math.imul(y,668265263) ^ Math.imul(z,2246822519) ^ Math.imul(seed,1274126177);
  h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
}
function noise3(x,y,z,seed){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const tx=smooth(x-ix),ty=smooth(y-iy),tz=smooth(z-iz);
  const a=lerp(hash3(ix,iy,iz,seed),hash3(ix+1,iy,iz,seed),tx);
  const b=lerp(hash3(ix,iy+1,iz,seed),hash3(ix+1,iy+1,iz,seed),tx);
  const c=lerp(hash3(ix,iy,iz+1,seed),hash3(ix+1,iy,iz+1,seed),tx);
  const d=lerp(hash3(ix,iy+1,iz+1,seed),hash3(ix+1,iy+1,iz+1,seed),tx);
  return lerp(lerp(a,b,ty),lerp(c,d,ty),tz);
}
function fbm(x,y,z,seed,octaves=4){
  let s=0,amplitude=0.53,weight=0,freq=1;
  for(let i=0;i<octaves;i++){
    s+=amplitude*noise3(x*freq,y*freq,z*freq,seed+i*683);
    weight+=amplitude;amplitude*=0.50;freq*=2.07;
  }
  return s/weight;
}
export function planetCoordinates(u,v){
  const lon=u*2*Math.PI,lat=(0.5-v)*Math.PI,c=Math.cos(lat);
  return [c*Math.cos(lon),Math.sin(lat),c*Math.sin(lon)];
}
function pickColor(a,b,t){return [byte(lerp(a[0],b[0],clamp(t))),byte(lerp(a[1],b[1],clamp(t))),byte(lerp(a[2],b[2],clamp(t)))];}
function rgba(data,index,rgb,a=255){const i=index*4;data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=a;}
function mulPalette(base,other,mix){return pickColor(base,other,mix);}

/**
 * Map channels:
 *  albedo: sRGB opaque world surface (ocean, plains, mountains, ice)
 *  night: R city lights, G ocean-specular mask (shader contract), B unused
 *  clouds: RGB scattering colour, A density
 *  height: greyscale elevation/depth diagnostic (128 is sea level)
 *  normal: tangent-space approximation (ready for future surface-detail shader)
 *  roughness: greyscale low for sea, higher for mineral/vegetation
 *  biome: diagnostic palette for dry/forest/mountain/ice/water
 * Values are deterministic for the same seed/parameters/resolution.
 */
export function generatePlanet(userOptions={}){
  const o=validateOptions(userOptions), w=o.width, h=w/2, n=w*h, pi=Math.PI;
  const base=new Float32Array(n), heights=new Float32Array(n);
  const climate=new Float32Array(n), humid=new Float32Array(n);
  const cloudValues=new Float32Array(n), cityValues=new Float32Array(n);
  const polar=new Float32Array(n);
  const arrays={};
  for(const name of ["albedo","night","clouds","height","normal","roughness","biome"])arrays[name]=new Uint8Array(n*4);
  const seed=o.seed;
  // Phase 1: coherent continents, high-frequency island systems, ridged ranges.
  // Every lookup samples 3D coordinates: u=0 and u=1 coincide.
  for(let y=0;y<h;y++){
    const latitude=(0.5-(y+0.5)/h)*pi;
    for(let x=0;x<w;x++){
      const idx=y*w+x;
      const [sx,sy,sz]=planetCoordinates((x+0.5)/w,(y+0.5)/h);
      const warp=fbm(sx*2.9+10,sy*2.9,sz*2.9,seed+113,2)-0.5;
      const qx=sx+warp*0.17,qy=sy+warp*0.13,qz=sz-warp*0.13;
      const scale=o.continentalScale;
      const continental=fbm(qx*scale*2.0,qy*scale*2.0,qz*scale*2.0,seed+7,5);
      const islands=fbm(sx*6.5,sy*6.5,sz*6.5,seed+231,3);
      const ridgeNoise=fbm(sx*11.0,sy*11.0,sz*11.0,seed+413,3);
      const tectonic=Math.pow(clamp(1-Math.abs(ridgeNoise-0.5)*4.3),2);
      const height=continental*0.85+islands*0.15+tectonic*o.mountainStrength*0.16;
      base[idx]=height;
      polar[idx]=Math.abs(Math.sin(latitude));
      climate[idx]=fbm(sx*3.8,sy*3.8,sz*3.8,seed+51,3);
      humid[idx]=fbm(sx*4.6+30,sy*4.6,sz*4.6,seed+1203,3);
      cloudValues[idx]=fbm(sx*7.3,sy*7.3,sz*7.3,seed+911,4);
      cityValues[idx]=fbm(sx*53,sy*53,sz*53,seed+1401,2);
    }
  }
  // Calibrate actual water coverage via a histogram instead of a magic level.
  let lo=Infinity,hi=-Infinity;
  for(const v of base){if(v<lo)lo=v;if(v>hi)hi=v;}
  const buckets=new Uint32Array(2048);
  for(const v of base)buckets[Math.min(2047,Math.floor((v-lo)/(hi-lo+1e-9)*2048))]++;
  let count=0, thresholdIndex=2047;
  for(let b=0;b<2048;b++){count+=buckets[b];if(count>=o.oceanCoverage*n){thresholdIndex=b;break;}}
  const seaLevel=lo+(thresholdIndex+0.5)*(hi-lo)/2048;
  let landPixels=0,cloudPixels=0;
  // Phase 2: coupled climate and biome choices from elevation, latitude, humidity.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const idx=y*w+x, e=base[idx]-seaLevel, land=e>0;
    heights[idx]=e;
    if(land)landPixels++;
    const absLat=polar[idx];
    const warmth=clamp(1-absLat*o.polarCooling*1.17-
      Math.max(0,e)*2.4+(climate[idx]-0.5)*0.35);
    const moisture=clamp(o.moisture*0.62+humid[idx]*0.80-0.35-
      Math.max(0,e)*o.mountainStrength*0.45);
    const mount=clamp(e*7.5*o.mountainStrength);
    const ice=clamp((0.26-warmth)*5.0+Math.max(0,mount-0.60)*0.54);
    let color,diagnostic,rough;
    if(!land){
      const shelf=clamp((e+0.085)/0.085);
      color=pickColor([4,20,53],[23,124,150],Math.pow(shelf,1.25));
      color=mulPalette(color,[208,228,235],ice*0.75);
      diagnostic=[7,57,102]; rough=ice>0.5?0.63:0.10;
    }else{
      const beach=1-clamp(e*76);
      if(ice>0.48){color=pickColor([115,143,150],[236,241,240],ice);diagnostic=[218,239,245];rough=0.79;}
      else if(mount>0.55){color=pickColor([85,91,83],[183,174,155],mount);diagnostic=[118,114,105];rough=0.89;}
      else if(moisture>0.57){color=pickColor([57,122,74],[19,78,46],moisture);diagnostic=[40,132,64];rough=0.82;}
      else if(moisture<0.33){color=pickColor([123,120,79],[203,167,96],(0.33-moisture)*2.4);diagnostic=[189,164,95];rough=0.91;}
      else{color=pickColor([89,145,83],[74,126,65],moisture);diagnostic=[130,151,83];rough=0.75;}
      color=mulPalette(color,[196,177,133],beach*0.66);
    }
    rgba(arrays.albedo,idx,color);
    rgba(arrays.biome,idx,diagnostic);
    const value=e>=0 ? byte(128+clamp(e*5)*127) : byte(128-clamp(-e*6)*127);
    rgba(arrays.height,idx,[value,value,value]);
    const cityPotential=land && warmth>0.29 && mount<0.65 ?
      clamp((cityValues[idx]-0.59)*14) * clamp(0.12/(Math.abs(e)+0.02)) *
      clamp((moisture-0.12)*2) : 0;
    const city=byte(cityPotential*210);
    rgba(arrays.night,idx,[city,land?0:255,Math.round(city*0.22)]);
    const cloudDensity=clamp((cloudValues[idx]-(0.60-o.cloudCoverage*0.19))*6.8);
    if(cloudDensity>0.25)cloudPixels++;
    const cloudAlbedo=byte(210+35*cloudDensity);
    rgba(arrays.clouds,idx,[cloudAlbedo,byte(cloudAlbedo+6),byte(cloudAlbedo+11)],byte(cloudDensity*200));
    const r=byte(rough*255);
    rgba(arrays.roughness,idx,[r,r,r]);
  }
  // Wrapped longitude, clamped latitude. Tangent normal map for future shader.
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const ix=y*w+x, left=y*w+(x===0?w-1:x-1),right=y*w+(x+1===w?0:x+1);
    const top=Math.max(0,y-1)*w+x,bottom=Math.min(h-1,y+1)*w+x;
    const dx=(heights[right]-heights[left])*2.3;
    const dy=(heights[bottom]-heights[top])*2.3;
    const inv=1/Math.hypot(dx,dy,1);
    rgba(arrays.normal,ix,[byte((0.5-dx*inv*0.5)*255),byte((0.5-dy*inv*0.5)*255),byte((0.5+inv*0.5)*255)]);
  }
  return {options:o,width:w,height:h,maps:arrays,statistics:{
    landFraction:landPixels/n,oceanFraction:1-landPixels/n,
    cloudFraction:cloudPixels/n,seaLevel,algorithm:GENERATOR_VERSION
  }};
}

/** Fixed-angle CPU look-development discs independent of current orbit time.
 * NOT screenshots of the Babylon shader (which is tested separately).
 */
export function makeLightingPreview(planet,phase,size=440){
  if(!["day","terminator","night"].includes(phase))throw new Error("phase must be day/terminator/night");
  const out=new Uint8Array(size*size*4),r=size*0.405,center=size/2;
  const sx=phase==="day"?0.15:phase==="terminator"?0.93:0.07;
  const sz=phase==="day"?0.99:phase==="terminator"?0.36:-0.998;
  const norm=Math.hypot(sx,sz),sun=[sx/norm,0,sz/norm];
  const albedo=planet.maps.albedo,clouds=planet.maps.clouds,night=planet.maps.night;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const p=(y*size+x)*4,fx=(x-center)/r,fy=(center-y)/r;
    const rad=fx*fx+fy*fy;
    if(rad>1.09){out[p]=4;out[p+1]=8;out[p+2]=20;out[p+3]=255;continue;}
    if(rad>1){const glow=Math.exp(-(Math.sqrt(rad)-1)*56);out[p]=byte(4+11*glow);out[p+1]=byte(8+48*glow);out[p+2]=byte(20+96*glow);out[p+3]=255;continue;}
    const fz=Math.sqrt(Math.max(0,1-rad));
    const lon=Math.atan2(fx,fz);
    const lat=Math.asin(clamp(fy,-1,1));
    const u=((lon/(2*Math.PI)+1)%1),v=0.5-lat/Math.PI;
    const tx=Math.min(planet.width-1,Math.floor(u*planet.width)),ty=Math.min(planet.height-1,Math.max(0,Math.floor(v*planet.height)));
    const i=(ty*planet.width+tx)*4;
    const dot=fx*sun[0]+fz*sun[2];
    const lit=clamp(dot*1.18+0.14,0.035,1.22);
    const cloudA=clouds[i+3]/255*0.67*clamp(0.30+dot,0.10,1);
    const city=night[i]/255*clamp(-dot*3.3,0,1);
    for(let c=0;c<3;c++){
      const base=albedo[i+c]*lit;
      const white=clouds[i+c]*lit*cloudA;
      out[p+c]=byte(lerp(base,white+base*(1-cloudA)*0.45,cloudA)+city*[245,129,55][c]*0.65);
    }
    const limb=Math.pow(1-fz,3);
    out[p]=byte(out[p]+20*limb);out[p+1]=byte(out[p+1]+59*limb);out[p+2]=byte(out[p+2]+116*limb);
    out[p+3]=255;
  }
  return {width:size,height:size,data:out};
}

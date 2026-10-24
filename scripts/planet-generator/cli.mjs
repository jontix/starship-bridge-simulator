#!/usr/bin/env node
/** Build-time planetary asset pipeline, intentionally not part of the server.
 * Usage: node scripts/planet-generator/cli.mjs --preset haven --width 1024
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { generatePlanet, makeLightingPreview, PRESETS, GENERATOR_VERSION } from "./core.mjs";

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const flagSpec={
  "--preset":"preset","--id":"id","--seed":"seed","--width":"width",
  "--ocean":"oceanCoverage","--continental":"continentalScale",
  "--mountains":"mountainStrength","--moisture":"moisture",
  "--clouds":"cloudCoverage","--polar":"polarCooling","--tilt":"axialTiltDegrees",
  "--config":"config","--asset-root":"assetRoot","--preview-root":"previewRoot",
  "--if-missing":"ifMissing"
};

export function parseArgs(argv){
  const result={preset:"haven"};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==="--help")return{help:true};
    if(argv[i]==="--if-missing"){result.ifMissing=true;continue;}
    const key=flagSpec[argv[i]];
    if(!key)throw new Error("Unknown option: "+argv[i]);
    const raw=argv[++i];if(raw===undefined)throw new Error("Missing value for "+argv[i-1]);
    result[key]=["preset","id","config","assetRoot","previewRoot"].includes(key)?raw:Number(raw);
  }
  return result;
}

const CRC_TABLE=new Uint32Array(256);
for(let n=0;n<256;n++){
  let c=n;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
  CRC_TABLE[n]=c>>>0;
}
function crc32(data){
  let c=0xffffffff;
  for(const b of data)c=CRC_TABLE[(c^b)&255]^(c>>>8);
  return(c^0xffffffff)>>>0;
}
function chunk(name,payload){
  const header=Buffer.from(name,"ascii");const length=Buffer.allocUnsafe(4);
  length.writeUInt32BE(payload.length,0);
  const crc=Buffer.allocUnsafe(4);crc.writeUInt32BE(crc32(Buffer.concat([header,payload])),0);
  return Buffer.concat([length,header,payload,crc]);
}
export function encodePng({width,height,data}){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)
    throw new Error("Invalid PNG dimensions");
  if(data.length!==width*height*4)throw new Error("Expected RGBA pixels");
  const rowSize=width*4,scanlines=Buffer.alloc(height*(rowSize+1));
  for(let y=0;y<height;y++)Buffer.from(data.buffer,data.byteOffset+y*rowSize,rowSize)
    .copy(scanlines,y*(rowSize+1)+1);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
  ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),
    chunk("IDAT",deflateSync(scanlines,{level:6})),chunk("IEND",Buffer.alloc(0))
  ]);
}

export async function buildAssets(userOptions={}){
  const cli={...userOptions}, presetId=cli.preset??"haven";
  const ifMissing=Boolean(cli.ifMissing);
  delete cli.ifMissing;
  delete cli.preset;
  if(!(presetId in PRESETS))throw new Error("Unknown preset "+presetId+". Available: "+Object.keys(PRESETS).join(", "));
  const base={...PRESETS[presetId]};
  if(cli.config){
    const config=JSON.parse(await readFile(resolve(projectRoot,cli.config),"utf8"));
    Object.assign(base,config);delete cli.config;
  }
  const assetRoot=resolve(projectRoot,cli.assetRoot??"packages/client/src/assets/generated-planets");
  const previewRoot=resolve(projectRoot,cli.previewRoot??"packages/client/public/planet-lab");
  delete cli.assetRoot;delete cli.previewRoot;
  const id=cli.id??base.id;
  if(ifMissing){
    try{
      const cached=JSON.parse(await readFile(join(assetRoot,id,"manifest.json"),"utf8"));
      if(cached.generator===GENERATOR_VERSION &&
        cached.options?.id===id && cached.options?.width >= 128){
        console.log("Using cached planetary maps for "+id+" (seed "+cached.options.seed+").");
        return {manifest:cached,assetsDir:join(assetRoot,id),previewsDir:join(previewRoot,id)};
      }
    }catch{/* No cached assets: generate now. */}
  }
  const data=generatePlanet({...base,...cli});
  const assetsDir=join(assetRoot,data.options.id);
  const previewsDir=join(previewRoot,data.options.id);
  await Promise.all([mkdir(assetsDir,{recursive:true}),mkdir(previewsDir,{recursive:true})]);
  const files={};
  await mkdir(join(previewsDir,"maps"),{recursive:true});
  for(const [name,pixels] of Object.entries(data.maps)){
    const png=encodePng({width:data.width,height:data.height,data:pixels});
    const filename=`${name}.png`;
    await Promise.all([
      writeFile(join(assetsDir,filename),png),
      writeFile(join(previewsDir,"maps",filename),png)
    ]);
    files[filename]=createHash("sha256").update(png).digest("hex");
  }
  for(const phase of ["day","terminator","night"]){
    const pixels=makeLightingPreview(data,phase,440);
    const image=encodePng(pixels);
    await writeFile(join(previewsDir,phase+".png"),image);
    files["preview/"+phase+".png"]=createHash("sha256").update(image).digest("hex");
  }
  const manifest={generator:GENERATOR_VERSION,planet:data.options.id,
    options:data.options,statistics:data.statistics,files};
  const serialized=JSON.stringify(manifest,null,2)+"\n";
  await Promise.all([
    writeFile(join(assetsDir,"manifest.json"),serialized),
    writeFile(join(previewsDir,"manifest.json"),serialized)
  ]);
  return {manifest,assetsDir,previewsDir};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=parseArgs(process.argv.slice(2));
    if(args.help){
      console.log("Planet art build: --preset haven|verdant --seed N --width 1024 [--ocean 0.68 --continental 1.6 --mountains 0.68 --moisture 0.6 --clouds 0.42] [--config config.json] [--asset-root path] [--preview-root path]");
    }else{
      const result=await buildAssets(args);
      console.log(`Generated ${result.manifest.planet} ${result.manifest.options.width}×${result.manifest.options.width/2}: ocean ${(result.manifest.statistics.oceanFraction*100).toFixed(1)}%, seed ${result.manifest.options.seed}`);
      console.log("Game textures:",result.assetsDir);
      console.log("Day/terminator/night previews:",result.previewsDir);
    }
  }catch(error){console.error(error);process.exitCode=1;}
}

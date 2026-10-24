import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  generatePlanet, makeLightingPreview, validateOptions, planetCoordinates
} from "./core.mjs";
import { buildAssets, encodePng, parseArgs } from "./cli.mjs";

const sha = data => createHash("sha256").update(data).digest("hex");
const small = { width:128, seed:48271 };

test("seed and options produce identical maps across runs", () => {
  const a=generatePlanet(small),b=generatePlanet(small);
  for(const name of Object.keys(a.maps)){
    assert.equal(a.maps[name].length,a.width*a.height*4);
    assert.equal(sha(a.maps[name]),sha(b.maps[name]));
  }
  assert.notEqual(sha(a.maps.albedo),sha(generatePlanet({...small,seed:48272}).maps.albedo));
});

test("ocean/land quantile matches configured coverage across seeds",()=>{
  for(const seed of [1,92,48271])for(const oceanCoverage of [.25,.68,.86]){
    const p=generatePlanet({...small,seed,oceanCoverage});
    assert.ok(Math.abs(p.statistics.oceanFraction-oceanCoverage)<.015,
      `Water ${oceanCoverage} seed ${seed}: ${p.statistics.oceanFraction}`);
  }
});

test("spherical terrain coordinates close at longitude seam; texture channels satisfy shader contract",()=>{
  const p=generatePlanet(small),w=p.width,h=p.height;
  let land=0,water=0,cloud=0,different=0;
  for(let i=0;i<w*h;i++){
    const offset=i*4;
    assert.equal(p.maps.albedo[offset+3],255);
    assert.equal(p.maps.night[offset+3],255);
    assert.equal(p.maps.normal[offset+3],255);
    assert.ok(p.maps.normal[offset+2]>=120);
    if(p.maps.night[offset+1]===255)water++;else land++;
    if(p.maps.clouds[offset+3]>0)cloud++;
    if(p.maps.albedo[offset]!==p.maps.albedo[0])different++;
  }
  assert.ok(water>0&&land>0&&cloud>0&&different>100);
  for(const v of [0,.1,.5,.81,1]){
    const a=planetCoordinates(0,v),b=planetCoordinates(1,v);
    for(let k=0;k<3;k++)assert.ok(Math.abs(a[k]-b[k])<1e-12);
  }
});

test("fixed lighting phases are reproducible and day is brighter than night",()=>{
  const p=generatePlanet(small);
  const previews=["day","terminator","night"].map(phase=>makeLightingPreview(p,phase,96));
  const brightness=preview=>{
    let sum=0;for(let i=0;i<preview.data.length;i+=4)
      sum+=preview.data[i]+preview.data[i+1]+preview.data[i+2];
    return sum;
  };
  assert.ok(brightness(previews[0])>brightness(previews[1]));
  assert.ok(brightness(previews[1])>brightness(previews[2]));
  assert.equal(sha(previews[0].data),sha(makeLightingPreview(p,"day",96).data));
});

test("build CLI writes PNG maps, diagnostics and a hashed manifest",async()=>{
  const root=await mkdtemp(join(tmpdir(),"bridge-planet-art-"));
  try{
    const {manifest,assetsDir,previewsDir}=await buildAssets({width:128,
      assetRoot:join(root,"game"),previewRoot:join(root,"lab")});
    assert.equal(manifest.options.seed,48271);
    assert.equal(manifest.options.width,128);
    const raw=await readFile(join(assetsDir,"albedo.png"));
    assert.equal(raw.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(raw.readUInt32BE(16),128);
    assert.equal(raw.readUInt32BE(20),64);
    assert.equal(sha(raw),manifest.files["albedo.png"]);
    assert.ok((await readFile(join(previewsDir,"day.png"))).length>800);
    assert.ok((await readFile(join(previewsDir,"maps","albedo.png"))).length>800);
    assert.equal(JSON.parse(await readFile(join(assetsDir,"manifest.json"),"utf8")).generator,
      manifest.generator);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("startup reuses edited planet seeds instead of overwriting them with defaults",async()=>{
  const root=await mkdtemp(join(tmpdir(),"bridge-planet-cache-"));
  try{
    const paths={assetRoot:join(root,"game"),previewRoot:join(root,"lab")};
    const first=await buildAssets({...paths,width:128,seed:73199});
    const imageHash=first.manifest.files["albedo.png"];
    const cached=await buildAssets({...paths,width:128,seed:48271,ifMissing:true});
    assert.equal(cached.manifest.options.seed,73199);
    assert.equal(cached.manifest.files["albedo.png"],imageHash);
    const replaced=await buildAssets({...paths,width:128,seed:48271});
    assert.equal(replaced.manifest.options.seed,48271);
    assert.notEqual(replaced.manifest.files["albedo.png"],imageHash);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("invalid seed, ocean fraction, sizes and malformed CLI are rejected",()=>{
  for(const o of [{width:111},{width:10000},{seed:-3},{oceanCoverage:1.1},{moisture:Infinity}])
    assert.throws(()=>validateOptions(o));
  assert.throws(()=>parseArgs(["--bad","yes"]));
  assert.throws(()=>encodePng({width:10,height:10,data:new Uint8Array(7)}));
});

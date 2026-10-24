import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const root=resolve(import.meta.dirname ?? join(process.cwd(),"scripts"));
const repositoryRoot=resolve(root,"..");
const port=5179;
const artifacts=join(repositoryRoot,"test-artifacts");
await mkdir(artifacts,{recursive:true});

let log="";
const server=spawn("npm",["--prefix","packages/client","run","dev","--",
  "--host","127.0.0.1","--port",String(port),"--strictPort"],{
  cwd:repositoryRoot,env:process.env,
  detached:process.platform!=="win32",
  stdio:["ignore","pipe","pipe"]
});
for(const s of [server.stdout,server.stderr]){
  s.setEncoding("utf8");s.on("data",chunk=>{log+=String(chunk);});
}
let browser;
try{
  let online=false;
  for(let n=0;n<150;n++){
    try{
      const response=await fetch(`http://127.0.0.1:${port}/planet-lab.html`);
      if(response.ok){online=true;break;}
    }catch{/* Vite starting */}
    if(server.exitCode!==null)break;
    await sleep(200);
  }
  assert.ok(online,"Planet Lab Vite server failed to start: "+log);

  const manifest=JSON.parse(await readFile(
    join(repositoryRoot,"packages/client/public/planet-lab/haven/manifest.json"),"utf8"));
  assert.equal(manifest.planet,"haven");
  assert.ok(Math.abs(manifest.statistics.oceanFraction-.68)<.02);
  browser=await chromium.launch({
    headless:true,
    args:["--enable-webgl","--use-gl=angle","--use-angle=swiftshader",
      "--enable-unsafe-swiftshader","--disable-dev-shm-usage"]
  });
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];
  page.on("pageerror",e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/planet-lab.html`);
  await page.getByText(/Loaded haven/).waitFor({timeout:25_000});
  assert.equal(await page.locator("#seed").inputValue(),String(manifest.options.seed));
  for(const id of ["day","terminator","night","albedo","biome","height","clouds"]){
    await page.locator("#"+id).evaluate(async (img)=>{
      if(!img.complete)await new Promise(resolve=>img.addEventListener("load",resolve,{once:true}));
      if(!(img.naturalWidth>40))throw Error("Missing preview image "+img.id);
    });
  }

  // The same Babylon shaders run in two real WebGL contexts, at exactly
  // the same orbital position/lighting, differing *only* in fractal LOD.
  await page.getByText(/Fixed sun and geography/).waitFor({timeout:30_000});
  await page.locator("#detail-altitude").selectOption("430");
  await page.locator("#detail-strength").fill("1.4");
  await page.waitForTimeout(2200);
  const contextStatus=await page.evaluate(()=>{
    const canvases=["detail-before","detail-after"].map(
      id=>document.getElementById(id));
    return canvases.map(canvas=>{
      const gl=canvas?.getContext("webgl2") || canvas?.getContext("webgl");
      return Boolean(gl) && !gl.isContextLost();
    });
  });
  assert.deepEqual(contextStatus,[true,true],"Both fixed-altitude orbital views require working WebGL");
  const baseline=PNG.sync.read(await page.locator("#detail-before").screenshot());
  const enhanced=PNG.sync.read(await page.locator("#detail-after").screenshot());
  assert.equal(baseline.width,enhanced.width);
  assert.equal(baseline.height,enhanced.height);
  let changed=0;
  for(let y=18;y<baseline.height-18;y+=3)for(let x=18;x<baseline.width-18;x+=3){
    const pos=(y*baseline.width+x)*4;
    const diff=Math.abs(baseline.data[pos]-enhanced.data[pos])+
      Math.abs(baseline.data[pos+1]-enhanced.data[pos+1])+
      Math.abs(baseline.data[pos+2]-enhanced.data[pos+2]);
    if(diff>9)changed++;
  }
  assert.ok(changed>85,"Fractal-detail comparison did not visibly change GPU pixels: "+changed);
  await page.locator("#detail-strength").fill("0");
  await page.getByText(/left: OFF · right: 0%/).waitFor({timeout:10_000});
  await page.locator("#detail-strength").fill("1");
  await page.locator("#detail-altitude").selectOption("20000");
  await page.getByText(/20,000 km above/).waitFor({timeout:10_000});
  await page.locator("#detail-altitude").selectOption("430");

  const initialCommand=await page.locator("#command").textContent();
  await page.locator("#seed").fill("71002");
  assert.ok((await page.locator("#command").textContent()).includes("--seed 71002"));
  await page.getByRole("button",{name:"Restore built preset"}).click();
  assert.equal(await page.locator("#command").textContent(),initialCommand);

  await page.screenshot({path:join(artifacts,"planet-lab-v1.png"),fullPage:true});
  assert.deepEqual(errors,[],"Planet Lab browser errors");
  console.log("Planet Lab smoke passed: cached generation, fixed lighting maps, presets, seed controls");
}finally{
  if(browser)await browser.close();
  if(server.pid){
    if(process.platform!=="win32"){
      try{process.kill(-server.pid,"SIGTERM");}catch{server.kill("SIGTERM");}
    }else server.kill("SIGTERM");
  }
}

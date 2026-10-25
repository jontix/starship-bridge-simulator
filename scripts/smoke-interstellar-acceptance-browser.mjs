/**
 * Stage E human-interface proxy: genuine Chromium on production 6s / 45s
 * timings. Exercises Helm command workflow, Main Screen spectator controls,
 * reload/rejoin during transit, destination visuals and screen capture.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { Client } from "colyseus.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = join(root, "test-artifacts");
await mkdir(screenshots, { recursive: true });
const port = 2593, webPort = 5193, children = [];
function run(command, args, name, env = {}) {
  const child = spawn(command, args, {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32", env: { ...process.env, ...env }
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", part => { output = (output + part).slice(-18000); });
  }
  children.push({ name, child, log: () => output });
}
async function until(predicate, label, ms = 15000) {
  const end = Date.now()+ms;
  while (Date.now()<end) {
    if (predicate()) return;
    await sleep(45);
  }
  throw Error("Timeout "+label+"\n"+children.map(c=>c.name+": "+c.log()).join("\n"));
}
async function healthy(url) {
  for (let i=0;i<160;i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(130);
  }
  throw Error("Health timeout "+url);
}
async function stop(child) {
  if(!child.pid||child.exitCode!==null)return;
  if(process.platform!=="win32") {
    try {process.kill(-child.pid,"SIGTERM");return;}catch{}
  }
  child.kill("SIGTERM");
}
let browser, observer;
try {
  run(process.execPath,["packages/server/dist/index.js"],"server",{
    PORT:String(port),BRIDGE_SYSTEM_ID:"aster-reach",
    BRIDGE_TEST_START_EPOCH_SECONDS:String(Date.UTC(2026,9,24,20)/1000),
    BRIDGE_TEST_JUMP_TIME_SCALE:undefined
  });
  run("npm",["--prefix","packages/client","run","dev","--",
    "--host","127.0.0.1","--port",String(webPort),"--strictPort"],"client",{
    VITE_SERVER_URL:"ws://127.0.0.1:"+port
  });
  await healthy("http://127.0.0.1:"+port+"/health");
  await healthy("http://127.0.0.1:"+webPort);

  // A separate connected crew observer keeps authoritative room alive while
  // browser switches roles and reloads, rather than accidentally creating a new ship.
  const client=new Client("ws://127.0.0.1:"+port);
  observer=await client.joinOrCreate("bridge",{role:"main-screen"});
  const roomId=observer.roomId;
  let authority=null;
  observer.onMessage("snapshot",snap=>{authority=snap;});
  await until(()=>authority?.universe.systemId==="aster-reach","server initial snapshot");

  browser=await chromium.launch({headless:true,args:[
    "--enable-webgl","--use-gl=angle","--use-angle=swiftshader",
    "--enable-unsafe-swiftshader","--disable-dev-shm-usage"
  ]});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror", e=>errors.push(String(e)));
  page.on("console",m=>{
    if(m.type()==="error" || /shader compilation|unable to compile|same key|non-unique keys/i.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.goto("http://127.0.0.1:"+webPort,{waitUntil:"domcontentloaded"});
  await page.getByText("Connected · Main Screen").waitFor({timeout:30000});

  // Current ship catalog is readable, but viewing alone never confers Helm authority.
  await page.keyboard.press("g");
  const chart=page.getByRole("dialog",{name:"Galactic Navigation map"});
  await chart.waitFor();
  await chart.getByText("MAIN SCREEN · READ ONLY").waitFor();
  assert.equal(await chart.getByRole("button",{name:"PLOT SELECTED ROUTE"}).count(),0);
  await page.keyboard.press("Escape");
  await page.locator("header .role-select select").selectOption("helm");
  await page.getByText("Connected · Helm").waitFor({timeout:15000});
  const panelOpener=page.getByRole("button",{name:"JUMP DRIVE"});
  await panelOpener.click();
  const panel=page.getByRole("region",{name:"Interstellar jump drive controls"});
  await panel.waitFor();
  assert.equal(await panel.getByRole("button",{name:"ENGAGE JUMP"}).isDisabled(),true);
  await panel.getByRole("button",{name:"PLOT ROUTE"}).click();
  await until(()=>authority?.interstellar?.destinationSystemId==="vesper","server confirmed plot");
  assert.equal(authority.interstellar.phase,"idle","Plot should not trigger drive");
  await panel.getByRole("button",{name:"ENGAGE JUMP"}).click();
  await until(()=>authority?.interstellar?.phase==="charging","production charge",6000);
  const chargeAt=Date.now();
  await panel.getByText("CHARGING",{exact:true}).first().waitFor({timeout:3000});
  assert.ok(authority.interstellar.etaSeconds >49 && authority.interstellar.etaSeconds<=51.2);
  assert.equal(await panel.getByRole("button",{name:"CANCEL CHARGE"}).isEnabled(),true);
  assert.equal(await page.getByRole("button",{name:/EMERGENCY BRAKE/}).isDisabled(),true);
  await page.screenshot({path:join(screenshots,"stage-e-helm-full-speed-charge.png"),fullPage:true});

  await until(()=>authority?.interstellar.phase==="transit","production transit",13000);
  assert.ok(Date.now()-chargeAt>=5100,"Charging must be real-time, not accelerated");
  await page.getByRole("region",{name:"Interstellar voyage visual"}).waitFor({timeout:7000});
  await panel.getByRole("button",{name:"CANCEL CHARGE"}).isDisabled();
  // Browser-role disconnect/rejoin: transfer to spectator while genuine server runs.
  const roomStartEpoch=authority.universe.epochSeconds;
  await page.locator("header .role-select select").selectOption("main-screen");
  await page.getByText("Connected · Main Screen").waitFor({timeout:15000});
  const banner=page.getByRole("region",{name:"Shared interstellar journey status"});
  await banner.getByRole("progressbar",{name:"Main Screen interstellar transit progress"})
    .waitFor({timeout:6000});
  await until(()=>authority?.interstellar.progress>.15,"transit progress before browser reload",15000);
  const progressBefore=authority.interstellar.progress;
  await page.screenshot({path:join(screenshots,"stage-e-main-full-speed-transit.png"),fullPage:true});
  // A real page reload closes the old websocket and creates a fresh one.
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByText("Connected · Main Screen").waitFor({timeout:25000});
  await banner.getByRole("progressbar",{name:"Main Screen interstellar transit progress"})
    .waitFor({timeout:9000});
  assert.equal(authority.universe.systemId,"aster-reach","Reload may not teleport");
  assert.ok(authority.interstellar.progress>=progressBefore,"Voyage must not restart");
  assert.ok(authority.universe.epochSeconds>roomStartEpoch,"Server epoch advanced during browser reload");
  assert.equal(observer.roomId,roomId,"Crew stays in original room");
  await until(()=>authority?.universe.systemId==="vesper" &&
    authority.interstellar.phase==="idle","full-speed Vesper arrival",70000);
  assert.ok(Date.now()-chargeAt>44000,"Transit must not be artificially shortened");
  await page.locator('canvas.scene[data-system-id="vesper"]').waitFor({timeout:20000});
  await page.waitForFunction(()=>{
    const d=window.__bridgeRendererDiagnostics;
    return d?.active===1 && d.activeSystemId==="vesper" &&
      d.activeSkyBodyIds.includes("vesper-primary") && d.oldSystemSkyBodies===0;
  },null,{timeout:25000});
  assert.equal(await page.getByRole("region",{name:"Shared interstellar journey status"}).count(),0,
    "Active transit overlay must clear on arrival");
  await page.getByText("Connected · Main Screen").waitFor();
  await page.screenshot({path:join(screenshots,"stage-e-main-full-speed-vesper.png"),fullPage:true});
  assert.equal(errors.length,0,"Browser errors: "+errors.join("\n"));
  console.log("Stage E full-speed browser PASS: live Helm plot/engage, six-second charge, Main Screen telemetry, browser reload/rejoin mid-transit, 45-second arrival, one clean Vesper WebGL renderer");
  await context.close();
} catch(error) {
  console.error(error);
  for(const child of children)console.error(child.name,child.log());
  process.exitCode=1;
} finally {
  try{await observer?.leave()}catch{}
  if(browser)await browser.close();
  await Promise.all(children.map(x=>stop(x.child)));
}

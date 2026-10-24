import { initializeOrbitalDetailLab } from "./orbitalDetailLab";

const labels: Record<string,{name:string,min:number,max:number,step:number,flag:string}> = {
  oceanCoverage:{name:"Ocean coverage",min:.15,max:.9,step:.01,flag:"--ocean"},
  continentalScale:{name:"Continental scale",min:.6,max:4,step:.1,flag:"--continental"},
  mountainStrength:{name:"Mountain strength",min:0,max:1.5,step:.05,flag:"--mountains"},
  moisture:{name:"Moisture / vegetation",min:0,max:1,step:.05,flag:"--moisture"},
  cloudCoverage:{name:"Cloud coverage",min:0,max:1,step:.05,flag:"--clouds"},
  polarCooling:{name:"Polar cooling",min:0,max:1.5,step:.05,flag:"--polar"}
};
type Options=Record<string,string|number>;
type Manifest={options:Options,statistics:{oceanFraction:number,cloudFraction:number},generator:string};
const $=(id:string)=>document.getElementById(id)!;
const input=(id:string)=>$(id) as HTMLInputElement;
const image=(id:string)=>$(id) as HTMLImageElement;
let preset="haven";
let baseline:Options={};
let params:Options={};
let lastCommand="";
const orbitalComparison = initializeOrbitalDetailLab();
const format=(v:number)=>Number.isInteger(v)?String(v):v.toFixed(2);
function updateCommand(){
  params.seed=Number(input("seed").value);
  params.width=Number(input("width").value);
  const bits=["npm.cmd run generate:planets -- --preset",preset,
    "--seed",String(params.seed),"--width",String(params.width)];
  for(const [key,def] of Object.entries(labels)){
    const value=Number(params[key]);
    if(Number.isFinite(value))bits.push(def.flag,format(value));
  }
  lastCommand=bits.join(" ");
  $("command").textContent=lastCommand;
  $("status").textContent="Previews show the last generated maps. Run the command and refresh to see changes.";
}
function createSliders(){
  const root=$("parameters");
  root.replaceChildren();
  for(const [key,def] of Object.entries(labels)){
    const label=document.createElement("label");
    const value=document.createElement("strong");
    value.textContent=format(Number(params[key]));
    const line=document.createElement("span");
    line.className="control-label";
    const title=document.createElement("span");
    title.textContent=def.name;
    line.append(title,value);
    const slider=document.createElement("input");
    slider.type="range";
    slider.min=String(def.min);
    slider.max=String(def.max);
    slider.step=String(def.step);
    slider.value=String(params[key]);
    slider.addEventListener("input",()=>{
      params[key]=Number(slider.value);
      value.textContent=format(Number(params[key]));
      updateCommand();
    });
    label.append(line,slider);
    root.append(label);
  }
}
async function load(){
  preset=input("preset").value;
  const path="/planet-lab/"+preset+"/";
  try{
    const response=await fetch(path+"manifest.json",{cache:"no-store"});
    if(!response.ok)throw new Error("Missing generated files");
    const manifest=await response.json() as Manifest;
    baseline=manifest.options;
    params={...baseline};
    input("seed").value=String(params.seed);
    input("width").value=String(params.width);
    createSliders();
    for(const channel of ["day","terminator","night"])
      image(channel).src=path+channel+".png?t="+Date.now();
    for(const name of ["albedo","biome","height","clouds"])
      image(name).src=path+"maps/"+name+".png?t="+Date.now();
    $("oceanStat").textContent=(manifest.statistics.oceanFraction*100).toFixed(1)+"%";
    $("cloudStat").textContent=(manifest.statistics.cloudFraction*100).toFixed(1)+"%";
    $("seedStat").textContent=String(params.seed);
    updateCommand();
    $("status").textContent="Loaded "+preset+" • "+manifest.generator+". Fixed lighting and identical map seed across three views.";
    $("status").classList.remove("error");
    orbitalComparison.configure(preset, Number(params.seed));
  }catch{
    params=preset==="haven"
      ?{seed:48271,width:1024,oceanCoverage:.68,continentalScale:1.6,mountainStrength:.68,moisture:.60,cloudCoverage:.42,polarCooling:.84}
      :{seed:71843,width:1024,oceanCoverage:.48,continentalScale:2.2,mountainStrength:.92,moisture:.79,cloudCoverage:.62,polarCooling:.64};
    baseline={...params};
    input("seed").value=String(params.seed);
    input("width").value=String(params.width);
    createSliders();
    updateCommand();
    $("status").textContent="No maps built yet for "+preset+". Run the command below and refresh.";
    $("status").classList.add("error");
    orbitalComparison.dispose();
    $("orbital-render-status").textContent = "Generate this preset first to load its Babylon detail comparison.";
  }
}
input("preset").addEventListener("change",()=>void load());
input("seed").addEventListener("input",updateCommand);
input("width").addEventListener("change",updateCommand);
$("reset").addEventListener("click",()=>{
  params={...baseline};
  input("seed").value=String(params.seed);
  input("width").value=String(params.width);
  createSliders();
  updateCommand();
});
$("copy").addEventListener("click",async()=>{
  try{
    await navigator.clipboard.writeText(lastCommand);
    $("copy").textContent="Copied";
  }catch{$("copy").textContent="Select and copy the command above";}
});
void load();

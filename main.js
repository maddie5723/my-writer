import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const $ = (id) => document.getElementById(id);
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const load = (k, d=null) => { try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const uuid = () => Math.random().toString(36).slice(2,10);

let settings = load("settings", { model:"Llama-3.2-1B-Instruct-q4f32_1-MLC", temp:0.9, maxTok:512, globalStyle:"" });
let engine = null;

async function ensureEngine(){
  if (engine) return;
  engine = await CreateMLCEngine(settings.model);
}

function show(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.querySelector(`.page[data-page='${page}']`)?.classList.add("active");
  document.querySelectorAll(".dockBtn").forEach(b=>b.classList.remove("active"));
  document.querySelector(`.dockBtn[data-page='${page}']`)?.classList.add("active");
  if(page==="home") renderHome();
  if(page==="characters") renderCharacters();
  if(page==="lore") renderLore();
}
document.querySelectorAll(".dockBtn").forEach(btn=> btn.onclick = ()=> show(btn.dataset.page));
show("home");

$("menuBtn").onclick = ()=>{ $("drawerName").textContent = "You"; $("menuDrawer").showModal(); };
$("closeDrawer").onclick = ()=> $("menuDrawer").close();
document.querySelectorAll(".qbtn").forEach(b=> b.onclick = ()=>{ $("menuDrawer").close(); show(b.dataset.jump); });

const defaultTiles = [
  {key:"characters", label:"Characters", color:"#739c80"},
  {key:"lore", label:"Lorebook", color:"#739c80"},
  {key:"writer", label:"Story Writer", color:"#e9c46a"},
  {key:"profile", label:"Profile", color:"#739c80"},
  {key:"settings", label:"Settings", color:"#3d5a49"}
];
let tiles = load("tiles", defaultTiles);
function renderHome(){
  const wrap = $("homeTiles"); wrap.innerHTML="";
  tiles.forEach(t=>{
    const el = document.createElement("div"); el.className="tile";
    el.style.boxShadow = `0 8px 26px ${hexToRgba(t.color, .25)}`;
    el.innerHTML = `<div class="label">${t.label}</div>`;
    el.onclick = ()=>{
      const map={characters:"characters", lore:"lore", writer:"writer", profile:"profile", settings:"settings"};
      show(map[t.key]||"home");
    };
    let press; el.onmousedown = ()=> press=setTimeout(()=> editTile(t),650);
    el.onmouseup = el.onmouseleave = ()=> clearTimeout(press);
    el.ontouchstart = ()=> press=setTimeout(()=> editTile(t),650);
    el.ontouchend = ()=> clearTimeout(press);
    wrap.appendChild(el);
  });
}
function editTile(t){
  const label = prompt("Tile label:", t.label); if(label===null) return;
  const color = prompt("Accent color (hex):", t.color); if(color===null) return;
  t.label=label; t.color=color; save("tiles", tiles); renderHome();
}

let characters = load("characters", []);
function renderCharacters(){
  const grid = $("charGrid"); grid.innerHTML="";
  characters.forEach(ch=>{
    const el=document.createElement("div"); el.className="tile";
    el.innerHTML = `<div class="label">${ch.name}</div><div class="hint">${(ch.tags||[]).slice(0,3).join(", ")}</div>`;
    el.onclick = ()=> openChat(ch);
    grid.appendChild(el);
  });
}
$("newCharBtn").onclick = ()=>{
  const name = prompt("Character name?") || "Unnamed";
  const tags = (prompt("Tags (comma separated)?")||"").split(",").map(s=>s.trim()).filter(Boolean);
  const ch = { id:uuid(), name, tags, summary:"", boundaries:"Adults 21+, consensual; cussing allowed.", appearance:"", personality:"" };
  characters.push(ch); save("characters", characters); renderCharacters();
};

function openChat(ch){
  alert(`Chat would open with ${ch.name}.`);
}

$("genStory").onclick = ()=> generate(false);
$("contStory").onclick = ()=> generate(true);
$("exportStory").onclick = ()=> downloadTxt($("storyOut").textContent, `story-${new Date().toISOString().slice(0,10)}.txt`);
["temp","tempNum"].forEach(id=> $(id)?.addEventListener("input", ()=>{ if($("temp")&&$("tempNum")){ $("temp").value=$("tempNum").value=event.target.value; } }));
["maxTok","maxTokNum"].forEach(id=> $(id)?.addEventListener("input", ()=>{ if($("maxTok")&&$("maxTokNum")){ $("maxTok").value=$("maxTokNum").value=event.target.value; } }));
$("saveSettings").onclick = ()=>{
  settings.model = $("modelSel").value;
  settings.temp = parseFloat($("temp").value||"0.9");
  settings.maxTok = parseInt($("maxTok").value||"512",10);
  settings.globalStyle = $("globalStyle").value||"";
  save("settings", settings);
  engine = null;
  alert("Settings saved.");
};

async function generate(continuation){
  await ensureEngine();
  const title=$("storyTitle").value.trim();
  const pov=$("pov").value, tense=$("tense").value;
  const length=parseInt($("length").value||"800",10);
  const beats=$("beats").value.trim();
  const heat=parseFloat($("heat").value||"5");
  const realism=parseFloat($("realism").value||"5");
  const violence=parseFloat($("violence").value||"3");
  const creativity=parseFloat($("creativity").value||"6");

  const sys=[
    "You are a creative writing model. Write immersive, cinematic prose with realistic dialogue and sensory detail.",
    "Only fictional, consensual adult characters (21+).",
    settings.globalStyle ? `Global style:\n${settings.globalStyle}` : "",
    `Controls: Heat=${heat}/10, Realism=${realism}/10, Violence=${violence}/10, Creativity=${creativity}/10.`,
    `POV=${pov}, Tense=${tense}, Target length≈${length} words.`,
    "If an outline is provided, follow it."
  ].join("\n");

  const prompt = continuation
    ? "Continue the previous narrative."
    : `Write a new scene${title?` titled "${title}"`:""}${beats?` using this outline:\n${beats}`:""}.`;

  const stream = await engine.chat.completions.create({
    messages:[{role:"system",content:sys},{role:"user",content:prompt}],
    temperature: clamp(0.2, 1.5, 0.5 + (creativity-5)/10 + (heat-5)/20 - (realism-5)/30),
    top_p:0.9,
    max_tokens: settings.maxTok
  });

  let out = $("storyOut");
  if (stream?.choices?.[0]?.message?.content){
    out.textContent = continuation ? (out.textContent + stream.choices[0].message.content) : stream.choices[0].message.content;
  } else if (stream[Symbol.asyncIterator]) {
    if(!continuation) out.textContent="";
    for await (const chunk of stream){
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      out.textContent += delta;
    }
  } else {
    out.textContent += "\n[No content returned]";
  }
}

let lore = load("lore", []);
$("newLoreBtn").onclick = ()=>{
  const title=prompt("Entry title?")||"(untitled)";
  const tags=(prompt("Tags (comma)?")||"").split(",").map(s=>s.trim()).filter(Boolean);
  const keywords=(prompt("Keywords (comma)?")||"").split(",").map(s=>s.trim()).filter(Boolean);
  const content=prompt("Content (short)…")||"";
  lore.push({id:uuid(), title, tags, keywords, content}); save("lore", lore); renderLore();
};
function renderLore(){
  const list=$("loreList"); list.innerHTML="";
  lore.forEach(e=>{
    const el=document.createElement("div"); el.className="tile";
    el.innerHTML = `<div class="label">${e.title}</div><div class="hint">${e.tags.map(t=>"#"+t).join(" ")}</div>`;
    list.appendChild(el);
  });
}

function downloadTxt(text, name){ const blob=new Blob([text],{type:"text/plain"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); }
function hexToRgba(hex, a){ try{ const m=hex.replace("#",""); const i=parseInt(m,16); const r=(i>>16)&255, g=(i>>8)&255, b=i&255; return `rgba(${r},${g},${b},${a})`; }catch{ return "rgba(0,0,0,0.2)"; } }
function clamp(lo,hi,x){ return Math.max(lo, Math.min(hi, x)); }

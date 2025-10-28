import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

/* ========= Utilities & Storage ========= */
const $ = (id) => document.getElementById(id);
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const load = (k, d=null) => { try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const id = () => Math.random().toString(36).slice(2,10);
const now = () => new Date().toISOString();

/* ========= Rotating mood lines ========= */
const moods = [
  "writing softly-lit chaos…",
  "plotting slow-burn trouble…",
  "banter first, feelings later…",
  "coffee, commas, and chemistry…"
];
let moodIdx = 0;
setInterval(()=>{ $("moodLine").textContent = moods[moodIdx=(moodIdx+1)%moods.length]; }, 4000);

/* ========= Profiles ========= */
let activeProfileId = load("activeProfileId") || (()=>{
  const p = { id:id(), name:"You", bio:"", theme:"dark", font:"ui",
    colors:{accent:"#739c80",accent2:"#3d5a49",gold:"#e9c46a"},
    tiles:[
      {key:"characters", label:"Characters", icon:"🃏", color:"#739c80"},
      {key:"lore", label:"Lorebook", icon:"📚", color:"#739c80"},
      {key:"writer", label:"Story Writer", icon:"📝", color:"#e9c46a"},
      {key:"profile", label:"Profile", icon:"👤", color:"#739c80"},
      {key:"settings", label:"Settings", icon:"⚙️", color:"#3d5a49"}
    ]
  };
  const all = [p]; save("profiles", all); save("activeProfileId", p.id); return p.id;
})();
function getProfiles(){ return load("profiles", []); }
function setProfiles(list){ save("profiles", list); }
function getActiveProfile(){ return getProfiles().find(p=>p.id===activeProfileId); }
function setActiveProfile(idv){ activeProfileId=idv; save("activeProfileId", activeProfileId); applyProfile(); }

/* ========= State ========= */
let engine = null;
let settings = load("settings", {
  model:"Llama-3.2-1B-Instruct-q4f32_1-MLC",
  temp:0.9, maxTok:512, globalStyle:"",
  sounds:"off", profanity:"allow"
});
let library = load("library", { // per profile libraries stored under key library_<id>, but keep default too
  characters:[], chats:{}, lore:[], stories:[], recents:[]
});
function lib(){ // get library per profile
  const key = "library_"+activeProfileId;
  let L = load(key);
  if(!L){ L = JSON.parse(JSON.stringify(library)); save(key, L); }
  return L;
}
function setLib(L){
  save("library_"+activeProfileId, L);
}

/* ========= Engine ========= */
async function ensureEngine(){
  if (engine) return;
  const pill = $("pill"); pill.textContent = "Loading…";
  engine = await CreateMLCEngine(settings.model, {
    initProgressCallback: (p)=>{ pill.textContent = `Loading ${Math.round((p.progress||0)*100)}%`; }
  });
  pill.textContent = "Idle";
}

/* ========= Navigation ========= */
document.querySelectorAll(".tab").forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.page).classList.add("active");
    if (btn.dataset.page==="characters") renderCharacters();
    if (btn.dataset.page==="lore") renderLore();
    if (btn.dataset.page==="profile") renderProfile();
    if (btn.dataset.page==="settings") renderSettings();
    if (btn.dataset.page==="home") renderHome();
  };
});

/* ========= Home ========= */
function renderHome(){
  const p = getActiveProfile();
  // tiles
  const t = $("homeTiles"); t.innerHTML = "";
  p.tiles.forEach(tile=>{
    const el = document.createElement("div");
    el.className = "tile";
    el.style.borderColor = "#2a322b";
    el.innerHTML = `<div class="icon">${tile.icon}</div><div class="label">${tile.label}</div>`;
    el.style.boxShadow = `0 8px 26px ${hexToRgba(tile.color,0.25)}`;
    el.oncontextmenu = (e)=>{ e.preventDefault(); editTile(tile); };
    el.ontouchstart = (e)=>{ // long press
      let pressTimer=setTimeout(()=>editTile(tile),650);
      e.target.addEventListener("touchend",()=>clearTimeout(pressTimer),{once:true});
    };
    el.onclick = ()=>{
      const map = {characters:"characters", lore:"lore", writer:"writer", profile:"profile", settings:"settings"};
      const page = map[tile.key]||"home";
      document.querySelector(`.tab[data-page='${page}']`).click();
    };
    t.appendChild(el);
  });
  // recents
  const r = $("recents"); r.innerHTML="";
  const R = (lib().recents||[]).slice(0,8);
  R.forEach(x=>{
    const c = document.createElement("div"); c.className="card";
    c.innerHTML = `<b>${x.type}</b><div class="hint">${new Date(x.time).toLocaleString()}</div><div class="hint">${x.title||x.name||""}</div>`;
    c.onclick = ()=>{
      if (x.type==="chat") openChatByCharacterId(x.characterId);
      if (x.type==="story") { document.querySelector(".tab[data-page='writer']").click(); $("storyOut").textContent = x.content||""; }
    };
    r.appendChild(c);
  });
}

/* ========= Tile editor (profile page) ========= */
function editTile(tile){
  const label = prompt("Tile label:", tile.label); if(label===null) return;
  const icon = prompt("Icon (emoji or short text):", tile.icon); if(icon===null) return;
  const color = prompt("Accent color (hex):", tile.color); if(color===null) return;
  const p = getActiveProfile();
  const idx = p.tiles.findIndex(t=>t.key===tile.key);
  p.tiles[idx] = {...tile,label,icon,color};
  updateProfile(p);
  renderHome();
}

/* ========= Characters ========= */
$("newCharBtn").onclick = ()=> openCharEditor();

function renderCharacters(){
  const grid = $("charGrid"); grid.innerHTML="";
  const chars = lib().characters;
  chars.forEach(ch=>{
    const el = document.createElement("div"); el.className="char";
    el.innerHTML = `
      <div class="stripe" style="background:${getActiveProfile().colors.accent}"></div>
      <img class="avatar" src="${ch.avatar||""}"/>
      <div class="name">${ch.name}</div>
      <div class="tags">${(ch.tags||[]).slice(0,3).map(t=>`<span class="tag">${t}</span>`).join("")}</div>
      <div class="row" style="margin-top:8px">
        <button class="ghost">Details</button>
        <div class="grow"></div>
        <button class="btn">Chat</button>
      </div>`;
    const [btnDetails, , , btnChat] = el.querySelectorAll("button");
    btnDetails.onclick = ()=> openCharEditor(ch.id);
    btnChat.onclick = ()=> openChat(ch.id);
    grid.appendChild(el);
  });
}

/* ========= Character Editor ========= */
const charDlg = $("charDlg");
$("closeChar").onclick = ()=> charDlg.close();
$("openChatFromEditor").onclick = ()=>{
  const idv = $("charDlg").dataset.id;
  if (idv) { charDlg.close(); openChat(idv); }
};

$("cAvatar").addEventListener("change", async (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  const b64 = await fileToBase64(f);
  $("cAvatarPreview").src = b64;
});

["cHeat","cReal","cViol","cCreat"].forEach((rid,i)=>{
  const range = $(rid);
  const num = $(["cHeatNum","cRealNum","cViolNum","cCreatNum"][i]);
  range.oninput = ()=> num.value = range.value;
  num.oninput = ()=> range.value = num.value;
});

function openCharEditor(idv=null){
  const L = lib();
  let ch = null;
  if (idv) ch = L.characters.find(c=>c.id===idv);
  $("charDlgTitle").textContent = idv ? `Edit ${ch.name}` : "New Character";
  $("delCharBtn").style.display = idv ? "inline-block" : "none";
  $("charDlg").dataset.id = idv||"";
  // fill
  $("cName").value = ch?.name||"";
  $("cTags").value = (ch?.tags||[]).join(", ");
  $("cSummary").value = ch?.summary||"";
  $("cAvatarPreview").src = ch?.avatar||"";
  $("cAppearance").value = ch?.appearance||"";
  $("cPersonality").value = ch?.personality||"";
  $("cBoundaries").value = ch?.boundaries||"Adults 21+, fully consensual; realistic cussing allowed.";
  $("cHeat").value = $("cHeatNum").value = ch?.defaults?.heat ?? 5;
  $("cReal").value = $("cRealNum").value = ch?.defaults?.realism ?? 5;
  $("cViol").value = $("cViolNum").value = ch?.defaults?.violence ?? 3;
  $("cCreat").value = $("cCreatNum").value = ch?.defaults?.creativity ?? 6;
  $("cStyle").value = ch?.styleOverride||"";
  $("cPerm").value = ch?.perm || "private";
  charDlg.showModal();
}

$("saveChar").onclick = ()=>{
  const L = lib();
  const idv = $("charDlg").dataset.id || id();
  const existingIdx = L.characters.findIndex(c=>c.id===idv);
  const ch = {
    id:idv,
    name:$("cName").value.trim()||"Unnamed",
    tags: $("cTags").value.split(",").map(s=>s.trim()).filter(Boolean),
    summary:$("cSummary").value,
    avatar:$("cAvatarPreview").src || "",
    appearance:$("cAppearance").value,
    personality:$("cPersonality").value,
    boundaries:$("cBoundaries").value,
    defaults:{
      heat:parseFloat($("cHeat").value),
      realism:parseFloat($("cReal").value),
      violence:parseFloat($("cViol").value),
      creativity:parseFloat($("cCreat").value),
    },
    styleOverride:$("cStyle").value,
    perm:$("cPerm").value,
    createdAt: ch?.createdAt || now()
  };
  if (existingIdx>=0) L.characters[existingIdx]=ch; else L.characters.push(ch);
  setLib(L); charDlg.close(); renderCharacters();
};

$("delCharBtn").onclick = ()=>{
  const idv = $("charDlg").dataset.id; if(!idv) return;
  const L = lib(); L.characters = L.characters.filter(c=>c.id!==idv);
  setLib(L); charDlg.close(); renderCharacters();
};

async function fileToBase64(file){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=> res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ========= Chat ========= */
const chatDlg = $("chatDlg");
$("closeChat").onclick = ()=> chatDlg.close();
$("chatSkin").onchange = ()=> applyChatSkin();
$("sendMsg").onclick = ()=> sendChat();
$("contMsg").onclick = ()=> sendChat("Continue the last scene.");
["sHeat","sReal","sViol","sCreat"].forEach((rid,i)=>{
  const range = $(rid); const num = $(["sHeatNum","sRealNum","sViolNum","sCreatNum"][i]);
  range.oninput = ()=> num.value = range.value;
  num.oninput = ()=> range.value = num.value;
});

let currentChat = { characterId:null, history:[] };

function openChatByCharacterId(cid){
  openChat(cid);
}
function openChat(cid){
  const L = lib();
  const ch = L.characters.find(c=>c.id===cid); if(!ch) return alert("Character not found");
  $("chatAvatar").src = ch.avatar||"";
  $("chatName").textContent = ch.name;
  $("chatMini").textContent = ch.summary||"";
  $("chatStatus").textContent = "Idle";
  $("chatArea").innerHTML = "";
  $("chatSkin").value = "roleplay";
  $("dirNotes").value = "";
  currentChat = { characterId: ch.id, history: [] };
  applyChatSkin();
  chatDlg.showModal();
}

function applyChatSkin(){
  const skin = $("chatSkin").value;
  $("chatArea").classList.toggle("texting", skin==="texting");
  $("directorPane").style.display = skin==="director" ? "grid" : "none";
}

function pushMsg(role, content){
  const area = $("chatArea");
  const row = document.createElement("div");
  row.className = "msg "+(role==="user"?"me":"bot");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  row.appendChild(bubble);
  area.appendChild(row);
  const meta = document.createElement("div");
  meta.className="meta"; meta.textContent = new Date().toLocaleTimeString();
  area.appendChild(meta);
  area.scrollTop = area.scrollHeight;
}

async function sendChat(userText=null){
  if (!userText){
    userText = $("chatInput").value.trim();
    if (!userText) return;
    $("chatInput").value = "";
  }
  const L = lib();
  const ch = L.characters.find(c=>c.id===currentChat.characterId);
  if (!ch) return;
  pushMsg("user", userText);
  currentChat.history.push({role:"user", content:userText});

  await ensureEngine();
  $("chatStatus").textContent = "Thinking…";

  // sliders & mappings
  const heat = parseFloat($("sHeat").value);
  const realism = parseFloat($("sReal").value);
  const violence = parseFloat($("sViol").value);
  const creativity = parseFloat($("sCreat").value);

  const sys = [
    "You are roleplaying as the character below in a fully fictional setting.",
    "Only depict consensual interactions between clearly adult characters (21+).",
    settings.profanity==="allow" ? "Realistic cussing is allowed; do not overdo it." : "Avoid profanity.",
    `Respect boundaries:\n${ch.boundaries||"Adults 21+, consensual."}`,
    ch.styleOverride ? `Character style override:\n${ch.styleOverride}` : "",
    `User global style:\n${settings.globalStyle||""}`,
    `Tone controls: Heat=${heat}/10, Realism=${realism}/10, Violence=${violence}/10, Creativity=${creativity}/10.`,
    "Keep dialogue natural; use body language and sensory detail; avoid meta commentary."
  ].join("\n");

  // optional director notes
  const dir = $("chatSkin").value==="director" ? `\nDirector notes:\n${$("dirNotes").value}` : "";

  // build convo
  const messages = [
    {role:"system", content: sys + `\n\nCharacter Sheet:\nSummary:${ch.summary}\nAppearance:${ch.appearance}\nPersonality & Voice:${ch.personality}${dir}`},
    ...currentChat.history
  ];

  // map sliders to sampling
  const temp = Math.min(1.5, Math.max(0.2, 0.5 + (creativity-5)/10 + (heat-5)/20 - (realism-5)/30));
  const top_p = 0.9;

  const stream = await engine.chat.completions.create({
    messages, stream:true, temperature: temp, top_p, max_tokens: settings.maxTok
  });

  let acc = "";
  pushMsg("assistant", "…"); // placeholder; replace as we stream
  const area = $("chatArea");
  const lastBubble = area.querySelectorAll(".bubble")[area.querySelectorAll(".bubble").length-2]; // previous append: user bubble + meta; then assistant bubble
  lastBubble.textContent = "";

  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content || "";
    acc += delta; lastBubble.textContent += delta;
    area.scrollTop = area.scrollHeight;
  }

  currentChat.history.push({role:"assistant", content:acc});
  $("chatStatus").textContent = "Idle";

  // add to recents
  const rec = lib(); rec.recents.unshift({type:"chat", time:now(), characterId:ch.id, name:ch.name}); rec.recents = rec.recents.slice(0,20); setLib(rec);
}

/* ========= Story Writer ========= */
["heat","realism","violence","creativity"].forEach((k)=>{
  const range = $(k); const num = $(k+"Num");
  range.oninput = ()=> num.value = range.value;
  num.oninput = ()=> range.value = num.value;
});

$("genStory").onclick = ()=> generateStory(false);
$("contStory").onclick = ()=> generateStory(true);
$("exportStory").onclick = ()=>{
  const text = $("storyOut").textContent;
  downloadTxt(text, `story-${new Date().toISOString().slice(0,10)}.txt`);
};

async function generateStory(continuation=false){
  await ensureEngine();
  const title = $("storyTitle").value.trim();
  const pov = $("pov").value; const tense = $("tense").value;
  const length = parseInt($("length").value||800,10);
  const presetName = $("styleName").value.trim();
  const style = $("styleText").value.trim();
  const beats = $("beats").value.trim();
  const heat = parseFloat($("heat").value);
  const realism = parseFloat($("realism").value);
  const violence = parseFloat($("violence").value);
  const creativity = parseFloat($("creativity").value);

  const sys = [
    "You are a creative writing model. Write immersive, cinematic prose with realistic dialogue and sensory detail.",
    "Only fictional, consensual adult characters (21+).",
    settings.profanity==="allow" ? "Realistic cussing is allowed when natural." : "Avoid profanity.",
    `User global style:\n${settings.globalStyle||""}`,
    style ? `Style preset (${presetName||"custom"}):\n${style}` : "",
    `Controls: Heat=${heat}/10, Realism=${realism}/10, Violence=${violence}/10, Creativity=${creativity}/10.`,
    `POV=${pov}, Tense=${tense}, Target length≈${length} words.`,
    "If an outline is provided, follow it closely."
  ].join("\n");

  const messages = [{role:"system",content:sys}];
  const prompt = continuation ? "Continue the previous narrative." :
    `Write a new scene${title?` titled "${title}"`:""}${beats?` using this outline:\n${beats}`:""}.`;

  if (!continuation) $("storyOut").textContent = "";
  const stream = await engine.chat.completions.create({
    messages:[...messages, {role:"user", content: prompt}], stream:true,
    temperature: Math.min(1.5, Math.max(0.2, 0.5 + (creativity-5)/10 + (heat-5)/20 - (realism-5)/30)),
    top_p: 0.9, max_tokens: settings.maxTok
  });

  let acc = "";
  for await (const chunk of stream){
    const delta = chunk?.choices?.[0]?.delta?.content || "";
    acc += delta; $("storyOut").textContent += delta;
  }

  const L = lib();
  L.recents.unshift({type:"story", time:now(), title: title||"(untitled)", content: acc.slice(0,200)});
  L.recents = L.recents.slice(0,20);
  setLib(L);
}

/* ========= Lore ========= */
$("newLoreBtn").onclick = ()=> editLore();
function renderLore(){
  const list = $("loreList"); list.innerHTML="";
  const entries = lib().lore;
  entries.forEach(entry=>{
    const card = document.createElement("div"); card.className="card";
    card.innerHTML = `<b>${entry.title}</b>
      <div class="hint">${(entry.tags||[]).map(t=>`#${t}`).join(" ")}</div>
      <div class="hint">${(entry.keywords||[]).join(", ")}</div>
      <div style="margin-top:8px">${(entry.content||"").slice(0,160)}${(entry.content||"").length>160?"…":""}</div>
      <div class="row" style="margin-top:8px">
        <button class="ghost">Edit</button><div class="grow"></div><button class="btn">Use</button>
      </div>`;
    const [btnE,,btnU] = card.querySelectorAll("button");
    btnE.onclick = ()=> editLore(entry.id);
    btnU.onclick = ()=> alert("Lore will auto-inject when keywords match your prompt.");
    list.appendChild(card);
  });
}

function editLore(idv=null){
  const L = lib();
  const entry = idv ? L.lore.find(x=>x.id===idv) : null;
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<div class="sheet">
    <div class="row"><b>${idv?"Edit":"New"} Lore</b><div class="grow"></div><button class="ghost" id="close">Close</button><button class="btn" id="save">Save</button></div>
    <div class="grid">
      <input id="Ltitle" placeholder="Title" value="${entry?.title||""}">
      <input id="Ltags" placeholder="Tags (comma)" value="${(entry?.tags||[]).join(", ")}">
      <input id="Lkeys" placeholder="Keywords (comma)" value="${(entry?.keywords||[]).join(", ")}">
      <select id="Lmode">
        <option value="keywords" ${entry?.mode!=="always"?"selected":""}>Include on keywords</option>
        <option value="always" ${entry?.mode==="always"?"selected":""}>Always include</option>
      </select>
      <textarea id="Lcontent" placeholder="Content…">${entry?.content||""}</textarea>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector("#close").onclick = ()=> dlg.close();
  dlg.addEventListener("close", ()=> dlg.remove());
  dlg.querySelector("#save").onclick = ()=>{
    const E = {
      id: entry?.id || id(),
      title: dlg.querySelector("#Ltitle").value,
      tags: dlg.querySelector("#Ltags").value.split(",").map(s=>s.trim()).filter(Boolean),
      keywords: dlg.querySelector("#Lkeys").value.split(",").map(s=>s.trim()).filter(Boolean),
      mode: dlg.querySelector("#Lmode").value,
      content: dlg.querySelector("#Lcontent").value
    };
    const Lib = lib();
    const idx = Lib.lore.findIndex(x=>x.id===E.id);
    if (idx>=0) Lib.lore[idx]=E; else Lib.lore.push(E);
    setLib(Lib); dlg.close(); renderLore();
  };
}

/* ========= Profile ========= */
function applyProfile(){
  const p = getActiveProfile();
  document.body.dataset.theme = p.theme || "dark";
  document.body.style.setProperty("--accent", p.colors?.accent || "#739c80");
  document.body.style.setProperty("--accent-2", p.colors?.accent2 || "#3d5a49");
  document.body.style.setProperty("--gold", p.colors?.gold || "#e9c46a");
  document.body.style.fontFamily = p.font==="serif" ? "var(--font-serif)" : "var(--font-ui)";
  $("profileName").textContent = p.name || "My Writer";
  $("profileAvatar").style.background = p.colors?.accent || "#739c80";
  renderHome();
}
applyProfile();

function renderProfile(){
  const p = getActiveProfile();
  $("profName").value = p.name||"";
  $("profBio").value = p.bio||"";
  $("themeSel").value = p.theme||"dark";
  $("fontSel").value = p.font||"ui";
  $("accentColor").value = p.colors?.accent || "#739c80";
  $("accent2Color").value = p.colors?.accent2 || "#3d5a49";
  $("goldColor").value = p.colors?.gold || "#e9c46a";
  // tiles editor
  const ed = $("tileEditor"); ed.innerHTML="";
  p.tiles.forEach(tile=>{
    const pane = document.createElement("div"); pane.className="card";
    pane.innerHTML = `<b>${tile.label}</b>
      <div class="grid">
        <input data-k="label" value="${tile.label}" />
        <input data-k="icon" value="${tile.icon}" />
        <input data-k="color" value="${tile.color}" />
        <div class="row">
          <button class="ghost" data-act="apply">Apply</button>
        </div>
      </div>`;
    pane.querySelector("[data-act='apply']").onclick = ()=>{
      tile.label = pane.querySelector("[data-k='label']").value;
      tile.icon = pane.querySelector("[data-k='icon']").value;
      tile.color = pane.querySelector("[data-k='color']").value;
      updateProfile(p);
      renderHome();
    };
    ed.appendChild(pane);
  });
}

$("saveProfile").onclick = ()=>{
  const p = getActiveProfile();
  p.name = $("profName").value; p.bio = $("profBio").value;
  p.theme = $("themeSel").value; p.font = $("fontSel").value;
  p.colors = {accent:$("accentColor").value,accent2:$("accent2Color").value,gold:$("goldColor").value};
  updateProfile(p);
  applyProfile();
};

$("newProfile").onclick = ()=>{
  const name = prompt("New profile name:"); if(!name) return;
  const p = getActiveProfile();
  const np = JSON.parse(JSON.stringify(p));
  np.id = id(); np.name = name;
  const all = getProfiles(); all.push(np); setProfiles(all);
  setActiveProfile(np.id);
  alert("Profile created & switched.");
};

$("switchProfile").onclick = ()=>{
  const all = getProfiles();
  const names = all.map(x=>x.name).join(", ");
  const pick = prompt("Switch to which profile? Options: "+names);
  const f = all.find(x=>x.name===pick);
  if (f){ setActiveProfile(f.id); alert("Switched."); }
  else alert("Not found.");
};

function updateProfile(p){
  const all = getProfiles().map(x=> x.id===p.id ? p : x);
  setProfiles(all);
}

/* ========= Settings ========= */
function renderSettings(){
  $("modelSel").value = settings.model;
  $("temp").value = settings.temp; $("tempNum").value = settings.temp;
  $("maxTok").value = settings.maxTok; $("maxTokNum").value = settings.maxTok;
  $("globalStyle").value = settings.globalStyle||"";
  $("sounds").value = settings.sounds||"off";
  $("profanity").value = settings.profanity||"allow";
}
["temp","tempNum"].forEach(k=> $(k).oninput = ()=>{ $("temp").value = $("tempNum").value = $(k).value; });
["maxTok","maxTokNum"].forEach(k=> $(k).oninput = ()=>{ $("maxTok").value = $("maxTokNum").value = $(k).value; });

$("saveSettings").onclick = ()=>{
  settings = {
    model: $("modelSel").value,
    temp: parseFloat($("temp").value),
    maxTok: parseInt($("maxTok").value,10),
    globalStyle: $("globalStyle").value,
    sounds: $("sounds").value,
    profanity: $("profanity").value
  };
  save("settings", settings);
  engine = null; // force reload next gen
  alert("Settings saved.");
};

/* ========= Export/Import ========= */
$("exportAll").onclick = ()=>{
  const pack = {
    profiles: getProfiles(),
    activeProfileId,
    libraries: getProfiles().map(p=>({profileId:p.id, library: load("library_"+p.id, {characters:[],chats:{},lore:[],stories:[],recents:[]}) })),
    settings
  };
  downloadJson(pack, "my-writer-library.json");
};
$("importAll").addEventListener("change", async (e)=>{
  const f = e.target.files?.[0]; if(!f) return;
  const text = await f.text();
  try{
    const pack = JSON.parse(text);
    if (pack.profiles){ save("profiles", pack.profiles); }
    if (pack.activeProfileId){ save("activeProfileId", pack.activeProfileId); activeProfileId = pack.activeProfileId; }
    if (Array.isArray(pack.libraries)){
      pack.libraries.forEach(item=> save("library_"+item.profileId, item.library));
    }
    if (pack.settings){ save("settings", pack.settings); settings = pack.settings; engine=null; }
    applyProfile();
    alert("Imported!");
  }catch(e){ alert("Import failed: "+e.message); }
});

function downloadJson(obj, name){
  const blob = new Blob([JSON.stringify(obj,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
function downloadTxt(text, name){
  const blob = new Blob([text], {type:"text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/* ========= Init ========= */
renderHome();

/* ========= Helpers ========= */
function hexToRgba(hex, alpha){
  try{
    const m = hex.replace("#","");
    const bigint = parseInt(m,16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }catch{ return "rgba(0,0,0,0.2)";}
}
// Drawer open/close
const menuBtn = document.getElementById('menuBtn');
const drawer = document.getElementById('menuDrawer');

if (menuBtn && drawer) {
  menuBtn.onclick = () => {
    const p = (typeof getActiveProfile === 'function' && getActiveProfile()) || {name:'You', colors:{accent:'#739c80'}};
    const nameEl = document.getElementById('drawerName');
    const avEl = document.getElementById('drawerAvatar');
    if (nameEl) nameEl.textContent = p.name || 'You';
    if (avEl) avEl.style.background = (p.colors && p.colors.accent) || '#739c80';
    drawer.showModal();
  };

  const closeBtn = document.getElementById('closeDrawer');
  if (closeBtn) closeBtn.onclick = () => drawer.close();

  document.querySelectorAll('.qbtn').forEach(b=>{
    b.addEventListener('click', () => {
      drawer.close();
      const target = b.dataset.jump;
      const tab = document.querySelector(`.tab[data-page='${target}']`);
      if (tab) tab.click();
    });
  });
}


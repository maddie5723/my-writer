import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const load = (k, d=null) => { try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const uuid = () => Math.random().toString(36).slice(2,10);
const clamp = (lo,hi,x)=> Math.max(lo, Math.min(hi, x));
const hexToRgba = (hex, a)=>{ try{ const m=hex.replace("#",""); const i=parseInt(m,16); const r=(i>>16)&255, g=(i>>8)&255, b=i&255; return `rgba(${r},${g},${b},${a})`; }catch{ return "rgba(0,0,0,0.2)"; } };

// ---------- state ----------
let settings = load("settings", { model:"Llama-3.2-1B-Instruct-q4f32_1-MLC", temp:0.9, maxTok:512, globalStyle:"" });
let tiles = load("tiles", [
  {key:"characters", label:"Characters", color:"#739c80"},
  {key:"lore", label:"Lorebook", color:"#739c80"},
  {key:"writer", label:"Story Writer", color:"#e9c46a"},
  {key:"profile", label:"Profile", color:"#739c80"},
  {key:"settings", label:"Settings", color:"#3d5a49"}
]);
let characters = load("characters", []);
let lore = load("lore", []);
let engine = null;

// ---------- bootstrap ----------
window.addEventListener("DOMContentLoaded", () => {
  bindGlobal();
  renderHome();
  show("home");
});

// ---------- engine ----------
async function ensureEngine(){
  if (engine) return;
  try {
    engine = await CreateMLCEngine(settings.model);
  } catch (e){
    console.warn("Engine failed to load:", e);
    engine = null;
  }
}

// ---------- nav ----------
function show(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.querySelector(`.page[data-page='${page}']`)?.classList.add("active");
  document.querySelectorAll(".dockBtn").forEach(b=>b.classList.remove("active"));
  document.querySelector(`.dockBtn[data-page='${page}']`)?.classList.add("active");

  if (page === "home") renderHome();
  if (page === "characters") { bindCharactersUI(); renderCharacters(); }
  if (page === "lore") { bindLoreUI(); renderLore(); }
  if (page === "writer") { bindWriterUI(); }
  if (page === "settings") { bindSettingsUI(); }
}

function bindGlobal(){
  document.querySelectorAll(".dockBtn").forEach(btn=> btn.onclick = ()=> show(btn.dataset.page));
  $("menuBtn").onclick = ()=>{ $("drawerName").textContent = $("profName")?.value || "You"; $("menuDrawer").showModal(); };
  $("closeDrawer").onclick = ()=> $("menuDrawer").close();
  document.querySelectorAll(".qbtn").forEach(b=> b.onclick = ()=>{ $("menuDrawer").close(); show(b.dataset.jump); });
}

// ---------- home ----------
function renderHome(){
  const wrap = $("homeTiles"); if (!wrap) return;
  wrap.innerHTML = "";
  tiles.forEach(t=>{
    const el = document.createElement("div"); el.className="tile";
    el.style.boxShadow = `0 8px 26px ${hexToRgba(t.color, .25)}`;
    el.innerHTML = `<div class="label">${t.label}</div>`;
    el.onclick = ()=>{
      const map={characters:"characters", lore:"lore", writer:"writer", profile:"profile", settings:"settings"};
      show(map[t.key]||"home");
    };
    let timer;
    const start=()=> timer=setTimeout(()=> editTile(t),650);
    const clear=()=> timer&&clearTimeout(timer);
    el.onmousedown = start; el.onmouseup = clear; el.onmouseleave = clear;
    el.ontouchstart = start; el.ontouchend = clear;
    wrap.appendChild(el);
  });
}
function editTile(t){
  const label = prompt("Tile label:", t.label); if(label===null) return;
  const color = prompt("Accent color (hex):", t.color); if(color===null) return;
  t.label=label; t.color=color; save("tiles", tiles); renderHome();
}

// ---------- characters ----------
function bindCharactersUI(){
  const btn = $("newCharBtn");
  if (btn && !btn._bound){
    btn._bound = true;
    btn.onclick = ()=> openCharModal(); // create
  }

  // modal controls
  const modal = $("charModal");
  const cancel = $("charCancel");
  if (cancel && !cancel._bound){
    cancel._bound = true;
    cancel.onclick = (e)=>{ e.preventDefault(); modal.close(); };
  }
  const del = $("charDelete");
  if (del && !del._bound){
    del._bound = true;
    del.onclick = (e)=>{
      e.preventDefault();
      const id = del.dataset.id;
      if (!id) return modal.close();
      if (!confirm("Delete this character?")) return;
      characters = characters.filter(c=>c.id !== id);
      save("characters", characters);
      modal.close(); renderCharacters();
    };
  }
  const saveBtn = $("charSave");
  if (saveBtn && !saveBtn._bound){
    saveBtn._bound = true;
    saveBtn.onclick = (e)=>{
      e.preventDefault();
      const id = saveBtn.dataset.id || uuid();
      const obj = {
        id,
        name: $("chName").value.trim() || "Unnamed",
        tags: ($("chTags").value || "").split(",").map(s=>s.trim()).filter(Boolean),
        avatar: $("chAvatar").value.trim(),
        speech: $("chSpeech").value.trim(),
        personality: $("chPersonality").value.trim(),
        appearance: $("chAppearance").value.trim(),
        boundaries: $("chBoundaries").value.trim() || "Adults 21+, consensual; cussing allowed.",
        adultOnly: $("chAdult").checked,
        private: $("chPrivate").checked,
        shareReadOnly: $("chShareRO").checked
      };
      const existing = characters.findIndex(c=>c.id===id);
      if (existing>=0) characters[existing]=obj; else characters.push(obj);
      save("characters", characters);
      modal.close(); renderCharacters();
    };
  }
}
function openCharModal(ch=null){
  const isEdit = !!ch;
  $("charModalTitle").textContent = isEdit ? "Edit Character" : "New Character";
  $("chName").value = ch?.name || "";
  $("chTags").value = (ch?.tags||[]).join(", ");
  $("chAvatar").value = ch?.avatar || "";
  $("chSpeech").value = ch?.speech || "";
  $("chPersonality").value = ch?.personality || "";
  $("chAppearance").value = ch?.appearance || "";
  $("chBoundaries").value = ch?.boundaries || "Adults 21+, consensual; cussing allowed.";
  $("chAdult").checked = ch?.adultOnly ?? true;
  $("chPrivate").checked = ch?.private ?? true;
  $("chShareRO").checked = ch?.shareReadOnly ?? false;
  $("charDelete").style.display = isEdit ? "inline-block" : "none";
  $("charDelete").dataset.id = ch?.id || "";
  $("charSave").dataset.id = ch?.id || "";
  $("charModal").showModal();
}
function renderCharacters(){
  const grid = $("charGrid"); if (!grid) return;
  grid.innerHTML = "";
  if (!characters.length){
    const empty = document.createElement("div"); empty.className="hint";
    empty.textContent="No characters yet. Tap + New Character to add one."; grid.appendChild(empty); return;
  }
  characters.forEach(ch=>{
    const el=document.createElement("div"); el.className="tile";
    el.innerHTML = `
      <div class="charCard">
        <div class="pic" style="${ch.avatar?`background-image:url('${ch.avatar.replace(/"/g,'\"')}');`:""}"></div>
        <div class="meta">
          <div class="name">${ch.name}</div>
          <div class="tags">${(ch.tags||[]).slice(0,4).join(", ")}</div>
        </div>
      </div>
    `;
    // Tap to edit; long-press could be future chat open
    el.onclick = ()=> openCharModal(ch);
    grid.appendChild(el);
  });
}

// ---------- lore ----------
function bindLoreUI(){
  const btn = $("newLoreBtn");
  if (btn && !btn._bound){
    btn._bound = true;
    btn.onclick = () => {
      const title=prompt("Entry title?")||"(untitled)";
      const tags=(prompt("Tags (comma)?")||"").split(",").map(s=>s.trim()).filter(Boolean);
      const keywords=(prompt("Keywords (comma)?")||"").split(",").map(s=>s.trim()).filter(Boolean);
      const content=prompt("Content (short)…")||"";
      lore.push({id:uuid(), title, tags, keywords, content});
      save("lore", lore); renderLore();
    };
  }
}
function renderLore(){
  const list=$("loreList"); if(!list) return;
  list.innerHTML="";
  if(!lore.length){
    const empty=document.createElement("div"); empty.className="hint";
    empty.textContent="No lore entries yet. Tap + New Entry to add one."; list.appendChild(empty); return;
  }
  lore.forEach(e=>{
    const el=document.createElement("div"); el.className="tile";
    el.innerHTML = `<div class="label">${e.title}</div><div class="hint">${e.tags.map(t=>"#"+t).join(" ")}</div>`;
    list.appendChild(el);
  });
}

// ---------- writer ----------
function bindWriterUI(){
  const g=$("genStory"), c=$("contStory"), exp=$("exportStory");
  if (g && !g._bound){ g._bound=true; g.onclick = ()=> generate(false); }
  if (c && !c._bound){ c._bound=true; c.onclick = ()=> generate(true); }
  if (exp && !exp._bound){ exp._bound=true; exp.onclick = ()=> downloadTxt($("storyOut").textContent, `story-${new Date().toISOString().slice(0,10)}.txt`); }
}
async function generate(continuation){
  await ensureEngine();
  if (!engine){
    alert("Model not loaded yet. Open Settings and ensure a model, then try again.");
    return;
  }
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

  const result = await engine.chat.completions.create({
    messages:[{role:"system",content:sys},{role:"user",content:prompt}],
    temperature: clamp(0.2, 1.5, 0.5 + (creativity-5)/10 + (heat-5)/20 - (realism-5)/30),
    top_p:0.9,
    max_tokens: settings.maxTok
  });

  const out = $("storyOut");
  const content = result?.choices?.[0]?.message?.content || "";
  if (continuation) out.textContent += content;
  else out.textContent = content || "[No content returned]";
}

// ---------- settings ----------
function bindSettingsUI(){
  const m=$("modelSel"), t=$("temp"), tn=$("tempNum"), mx=$("maxTok"), mxn=$("maxTokNum"), gs=$("globalStyle"), sv=$("saveSettings");
  if (m) m.value = settings.model;
  if (t) t.value = settings.temp;
  if (tn) tn.value = settings.temp;
  if (mx) mx.value = settings.maxTok;
  if (mxn) mxn.value = settings.maxTok;
  if (gs) gs.value = settings.globalStyle;

  if (t && tn && !t._bound){
    t._bound = tn._bound = true;
    const sync = (v)=>{ t.value=v; tn.value=v; };
    t.addEventListener("input", e=> sync(e.target.value));
    tn.addEventListener("input", e=> sync(e.target.value));
  }
  if (mx && mxn && !mx._bound){
    mx._bound = mxn._bound = true;
    const sync = (v)=>{ mx.value=v; mxn.value=v; };
    mx.addEventListener("input", e=> sync(e.target.value));
    mxn.addEventListener("input", e=> sync(e.target.value));
  }
  if (sv && !sv._bound){
    sv._bound = true;
    sv.onclick = ()=>{
      settings.model = m?.value || settings.model;
      settings.temp = parseFloat(t?.value || settings.temp);
      settings.maxTok = parseInt(mx?.value || settings.maxTok, 10);
      settings.globalStyle = gs?.value || settings.globalStyle;
      save("settings", settings);
      engine = null;
      alert("Settings saved.");
    };
  }
}

// ---------- utils ----------
function downloadTxt(text, name){ const blob=new Blob([text],{type:"text/plain"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); }

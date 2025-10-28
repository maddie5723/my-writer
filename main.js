import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const $ = (id) => document.getElementById(id);
const chatEl = $("chat");
const promptEl = $("prompt");
const sendBtn = $("send");
const contBtn = $("cont");
const clearBtn = $("clear");
const statusEl = $("status");
const statusPill = $("statusPill");

const dlg = $("settings");
const openSettings = $("openSettings");
const closeSettings = $("closeSettings");
const modelSel = $("model");
const sysEl = $("system");
const memEl = $("memory");
const tempEl = $("temp");
const maxEl = $("maxToks");
const tval = $("tval");
const mval = $("mval");
const saveBtn = $("save");

let engine = null;
let history = [];

function bubble(role, text) {
  const msg = document.createElement("div");
  msg.className = `msg ${role}`;
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = text;
  msg.appendChild(b);
  chatEl.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
  return b;
}

// defaults + saved prefs
(function initPrefs(){
  const saved = JSON.parse(localStorage.getItem("writer_prefs_v2") || "{}");
  sysEl.value = saved.system ?? `You are a private fiction assistant. Only fictional, consensual content between clearly adult characters (21+).
Style: slow-burn, realistic dialogue, cinematic detail, sensory cues, minimal em dashes.`;
  memEl.value = saved.memory ?? "";
  tempEl.value = saved.temp ?? 0.9;
  maxEl.value = saved.maxToks ?? 512;
  tval.textContent = tempEl.value;
  mval.textContent = maxEl.value;
  if (saved.model) modelSel.value = saved.model;
})();

tempEl.oninput = () => (tval.textContent = tempEl.value);
maxEl.oninput = () => (mval.textContent = maxEl.value);

saveBtn.onclick = () => {
  localStorage.setItem("writer_prefs_v2", JSON.stringify({
    model: modelSel.value,
    system: sysEl.value,
    memory: memEl.value,
    temp: parseFloat(tempEl.value),
    maxToks: parseInt(maxEl.value,10),
  }));
  statusEl.textContent = "Saved locally ✅";
  setTimeout(()=>statusEl.textContent="",1200);
};

openSettings.onclick = () => dlg.showModal();
closeSettings.onclick = () => dlg.close();
modelSel.onchange = () => { engine = null; statusPill.textContent = "Model switched"; };

async function ensureEngine() {
  if (engine) return;
  statusEl.textContent = "Loading model (first time only)…";
  statusPill.textContent = "Loading…";
  engine = await CreateMLCEngine(modelSel.value, {
    initProgressCallback: (p) => {
      const pct = Math.round((p.progress || 0) * 100);
      statusEl.textContent = `Loading: ${pct}%`;
      statusPill.textContent = `Loading ${pct}%`;
    },
  });
  statusEl.textContent = "Ready.";
  statusPill.textContent = "Ready";
}

async function generate(userText, {append=false}={}) {
  await ensureEngine();

  const sys = sysEl.value.trim();
  const mem = memEl.value.trim();
  const temperature = parseFloat(tempEl.value);
  const max_tokens = parseInt(maxEl.value, 10);

  const messages = [];
  if (sys) messages.push({ role: "system", content: sys });
  if (mem) messages.push({ role: "system", content: `Memory:\n${mem}` });
  messages.push(...history);
  messages.push({ role: "user", content: userText });

  const u = bubble("me", userText);
  u.scrollIntoView({behavior:"smooth",block:"end"});

  const aBubble = bubble("bot", "");
  statusEl.textContent = "Thinking…";
  statusPill.textContent = "Thinking…";

  const stream = await engine.chat.completions.create({
    messages, stream: true,
    temperature, top_p: 0.92, max_tokens
  });

  let acc = "";
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content || "";
    acc += delta;
    aBubble.textContent += delta;
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  statusEl.textContent = "Done.";
  statusPill.textContent = "Idle";
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: acc });
}

sendBtn.onclick = async () => {
  const text = promptEl.value.trim();
  if (!text) return;
  promptEl.value = "";
  await generate(text);
};

contBtn.onclick = async () => {
  if (!history.length) return;
  await generate("Continue the last scene.");
};

clearBtn.onclick = () => {
  chatEl.innerHTML = "";
  history = [];
  bubble("bot", "Cleared. Ready when you are ✨");
  statusEl.textContent = "";
  statusPill.textContent = "Idle";
};

// allow Cmd+Enter to send on hardware keyboards
document.addEventListener("keydown",(e)=>{
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendBtn.click();
});
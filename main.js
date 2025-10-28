import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const ui = {
  model: document.getElementById("model"),
  system: document.getElementById("system"),
  memory: document.getElementById("memory"),
  temp: document.getElementById("temp"),
  tval: document.getElementById("tval"),
  maxToks: document.getElementById("maxToks"),
  mval: document.getElementById("mval"),
  prompt: document.getElementById("prompt"),
  go: document.getElementById("go"),
  cont: document.getElementById("cont"),
  clear: document.getElementById("clear"),
  status: document.getElementById("status"),
  out: document.getElementById("out"),
  save: document.getElementById("save"),
};

let engine = null;
let history = [];     // chat history to keep continuity
let lastStop = false; // track if we hit end naturally

// defaults + load saved
(function initDefaults(){
  const saved = JSON.parse(localStorage.getItem("writer_prefs") || "{}");
  ui.system.value = saved.system ?? `You are a private fiction assistant.
Write only fictional content between clearly adult characters (21+), fully consensual.
Style: slow-burn, realistic dialogue, cinematic detail, sensory cues, minimal em dashes.`;
  ui.memory.value = saved.memory ?? "";
  ui.temp.value = saved.temp ?? 0.9;
  ui.maxToks.value = saved.maxToks ?? 512;
  ui.tval.textContent = ui.temp.value;
  ui.mval.textContent = ui.maxToks.value;
  if (saved.model) ui.model.value = saved.model;
})();

ui.temp.oninput = () => ui.tval.textContent = ui.temp.value;
ui.maxToks.oninput = () => ui.mval.textContent = ui.maxToks.value;

ui.save.onclick = () => {
  localStorage.setItem("writer_prefs", JSON.stringify({
    model: ui.model.value,
    system: ui.system.value,
    memory: ui.memory.value,
    temp: parseFloat(ui.temp.value),
    maxToks: parseInt(ui.maxToks.value,10),
  }));
  ui.status.textContent = "Saved locally ✅";
  setTimeout(()=> ui.status.textContent="", 1500);
};

ui.clear.onclick = () => { ui.out.textContent = ""; history = []; };

async function ensureEngine() {
  if (engine) return;
  ui.status.textContent = "Loading model (first time only)…";
  engine = await CreateMLCEngine(ui.model.value, {
    initProgressCallback: (p) => {
      ui.status.textContent = `Loading: ${Math.round(p.progress*100)}%`;
    },
  });
  ui.status.textContent = "Ready.";
}

async function generate(userText, {append=true} = {}) {
  await ensureEngine();

  const sys = ui.system.value.trim();
  const mem = ui.memory.value.trim();
  const temperature = parseFloat(ui.temp.value);
  const max_tokens = parseInt(ui.maxToks.value, 10);

  const msgs = [];
  if (sys) msgs.push({ role: "system", content: sys });
  if (mem) msgs.push({ role: "system", content: `Memory:\n${mem}` });

  // include prior turns for continuity
  msgs.push(...history);

  // add the new user prompt
  msgs.push({ role: "user", content: userText });

  ui.out.textContent = append ? ui.out.textContent : "";
  ui.status.textContent = "Thinking…";
  lastStop = false;

  const stream = await engine.chat.completions.create({
    messages: msgs,
    stream: true,
    temperature,
    top_p: 0.92,
    max_tokens,
  });

  let acc = "";
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content || "";
    acc += delta;
    ui.out.textContent += delta;
  }

  ui.status.textContent = "Done.";
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: acc });
}

ui.go.onclick = async () => {
  const prompt = ui.prompt.value.trim();
  if (!prompt) return;
  await generate(prompt, { append: false });
};

// “Continue” asks the model to keep going based on the last exchange
ui.cont.onclick = async () => {
  if (history.length === 0) return;
  await generate("Continue the last scene.", { append: true });
};

// swap model live (clears loaded engine)
ui.model.onchange = () => {
  engine = null; // force re-init with new model
  ui.status.textContent = "Model switched. Will load on next generate.";
};
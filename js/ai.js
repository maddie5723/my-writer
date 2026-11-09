/* =========================================================
   ai.js — the on-device model (WebLLM).
   • Loaded lazily, so the app opens instantly even offline.
   • Picks the f16 build when the GPU supports it, else f32.
   • One generation at a time, with a real Stop button.
   ========================================================= */

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm@0.2.86";

/** Curated models. All have a 4,096-token memory ("context window"). */
export const MODELS = [
  {
    key: "hermes3-3b",
    name: "Hermes 3 · 3B",
    ids: { f16: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC", f32: "Hermes-3-Llama-3.2-3B-q4f32_1-MLC" },
    size: "≈2.3 GB",
    blurb: "Best balance. Tuned for roleplay and staying in character.",
    recommended: true,
  },
  {
    key: "llama32-3b",
    name: "Llama 3.2 · 3B",
    ids: { f16: "Llama-3.2-3B-Instruct-q4f16_1-MLC", f32: "Llama-3.2-3B-Instruct-q4f32_1-MLC" },
    size: "≈2.3 GB",
    blurb: "Solid all-rounder. A little more 'polite assistant' than Hermes.",
  },
  {
    key: "llama32-1b",
    name: "Llama 3.2 · 1B",
    ids: { f16: "Llama-3.2-1B-Instruct-q4f16_1-MLC", f32: "Llama-3.2-1B-Instruct-q4f32_1-MLC" },
    size: "≈0.9 GB",
    blurb: "Fastest and smallest. Runs almost anywhere, but characters drift more.",
  },
  {
    key: "hermes3-8b",
    name: "Hermes 3 · 8B",
    ids: { f16: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC", f32: "Hermes-3-Llama-3.1-8B-q4f32_1-MLC" },
    size: "≈4.9 GB",
    blurb: "Richest writing and best memory for detail. Computers only: too big for phones.",
    desktopOnly: true,
  },
];
export const CONTEXT_TOKENS = 4096;
/** How much the model can "see" at once: small on-device, much more online */
export const contextTokens = (settings) => (settings?.provider === "online" ? 16000 : CONTEXT_TOKENS);
export const isOnline = (settings) => settings?.provider === "online" && settings.onlineKey && settings.onlineModel;
export const modelByKey = (k) => MODELS.find((m) => m.key === k) || MODELS[0];
/** Phones and tablets have far less graphics memory than computers */
export const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/* ---------- Status (UI subscribes to this) ---------- */
const listeners = new Set();
export const status = { state: "idle", progress: 0, text: "", modelKey: null };
function setStatus(patch) {
  Object.assign(status, patch);
  listeners.forEach((fn) => fn(status));
}
export function onStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }

/* ---------- GPU check ---------- */
let gpuInfo = null;
export async function checkGPU() {
  if (gpuInfo) return gpuInfo;
  if (!("gpu" in navigator)) {
    return (gpuInfo = { ok: false, reason: "This browser doesn't support WebGPU, which the on-device AI needs. Try Chrome or Edge (desktop/Android) or Safari 26+ on iPhone/iPad." });
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return (gpuInfo = { ok: false, reason: "WebGPU is turned on but no compatible graphics chip was found on this device." });
    return (gpuInfo = { ok: true, f16: adapter.features.has("shader-f16") });
  } catch (e) {
    return (gpuInfo = { ok: false, reason: "Couldn't access the graphics chip: " + e.message });
  }
}

/* ---------- Engine ---------- */
let webllm = null;
let engine = null;
let engineKey = null;
let worker = null;
let loading = null;

export async function ensureEngine(modelKey) {
  if (engine && engineKey === modelKey) return engine;
  if (loading) { try { await loading; } catch { /* fall through and retry */ } }
  if (engine && engineKey === modelKey) return engine;

  loading = (async () => {
    const model = modelByKey(modelKey);
    setStatus({ state: "loading", progress: 0, text: "Checking your device…", modelKey });
    const gpu = await checkGPU();
    if (!gpu.ok) throw new Error(gpu.reason);
    const id = gpu.f16 ? model.ids.f16 : model.ids.f32;

    setStatus({ text: "Loading the AI engine…" });
    webllm ??= await import(WEBLLM_URL);

    if (engine) { try { await engine.unload(); } catch { /* ignore */ } engine = null; engineKey = null; }

    const cached = await webllm.hasModelInCache(id).catch(() => false);
    const config = {
      initProgressCallback: (p) => setStatus({
        progress: p.progress || 0,
        text: cached ? "Waking up " + model.name + "…" : `Downloading ${model.name} (${model.size}, one time only)…`,
      }),
    };
    // Run the model in a background worker so the screen never freezes while it thinks
    let e;
    try {
      worker ??= new Worker(new URL("../worker.js", import.meta.url), { type: "module" });
      // If the background worker never starts (some browsers), don't hang forever: fall back after a while
      let heard = false;
      const cfg = { ...config, initProgressCallback: (p) => { heard = true; config.initProgressCallback(p); } };
      e = await Promise.race([
        webllm.CreateWebWorkerMLCEngine(worker, id, cfg),
        new Promise((_, rej) => setTimeout(() => { if (!heard) rej(new Error("worker-stalled")); }, 25000)),
      ]);
    } catch (err) {
      if (/WebGPU|memory|device|quota|fetch|network/i.test(String(err?.message))) throw err;
      try { worker?.terminate(); } catch { /* ignore */ }
      worker = null;
      e = await webllm.CreateMLCEngine(id, config); // older browsers: same thing, on the main thread
    }
    engine = e;
    engineKey = modelKey;
    setStatus({ state: "ready", progress: 1, text: model.name + " is ready" });
    return e;
  })();

  try {
    return await loading;
  } catch (err) {
    setStatus({ state: "error", text: friendlyError(err) });
    throw new Error(friendlyError(err));
  } finally {
    loading = null;
  }
}

export async function unloadEngine() {
  if (engine) { try { await engine.unload(); } catch { /* ignore */ } }
  engine = null; engineKey = null;
  setStatus({ state: "idle", progress: 0, text: "" });
}

export function friendlyError(err) {
  const m = String(err?.message || err);
  if (/WebGPU|graphics chip/i.test(m)) return m;
  if (/fetch|network|Failed to load/i.test(m)) return "Couldn't download the model. Check your connection and try again.";
  if (/quota|storage/i.test(m)) return "Not enough storage space on this device for the model. Try a smaller model in Settings.";
  if (/device.*lost|out of memory|OOM|allocate/i.test(m)) return "Your device ran out of graphics memory. Try a smaller model in Settings.";
  if (/context window|prompt tokens exceed/i.test(m)) return "That was too long for the model's memory. Try shortening the character or memory notes.";
  return m;
}

/* ---------- Generation ---------- */
let busy = false;
let abortCtl = null;
export const isBusy = () => busy;

/**
 * Stream a reply. onText(fullTextSoFar) is called as tokens arrive.
 * Uses the online service when it's set up in Me → AI model, otherwise the on-device model.
 * Returns { text, stopped }.
 */
export async function generate({ settings, modelKey, messages, temperature, maxTokens, stop, onText }) {
  if (busy) throw new Error("Already writing. Stop the current reply first.");
  busy = true;
  try {
    if (settings?.provider === "online") return await generateOnline({ settings, messages, temperature, maxTokens, stop, onText });
    return await generateLocal({ modelKey: modelKey || settings?.model, messages, temperature, maxTokens, stop, onText });
  } catch (err) {
    throw new Error(friendlyError(err));
  } finally {
    busy = false;
    abortCtl = null;
    if (status.state === "generating") setStatus({ state: "ready" });
  }
}

async function generateLocal({ modelKey, messages, temperature, maxTokens, stop, onText }) {
  let text = "", stopped = false;
  const e = await ensureEngine(modelKey);
  setStatus({ state: "generating" });
  const stream = await e.chat.completions.create({
    messages, stream: true, temperature, top_p: 0.92, repetition_penalty: 1.08,
    max_tokens: maxTokens, stop: stop?.length ? stop.slice(0, 4) : undefined,
  });
  for await (const chunk of stream) {
    const choice = chunk?.choices?.[0];
    const d = choice?.delta?.content || "";
    if (d) { text += d; onText?.(text); }
    if (choice?.finish_reason === "abort") stopped = true;
  }
  return { text, stopped };
}

/** Any OpenAI-compatible chat API (OpenRouter by default), streamed over SSE */
async function generateOnline({ settings, messages, temperature, maxTokens, stop, onText }) {
  if (!settings.onlineKey) throw new Error("Add your API key in Me → AI model → Online.");
  if (!settings.onlineModel) throw new Error("Pick an online model in Me → AI model → Online.");
  abortCtl = new AbortController();
  setStatus({ state: "generating" });
  let text = "", stopped = false;
  let res;
  try {
    res = await fetch(settings.onlineUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      signal: abortCtl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.onlineKey}`,
        "X-Title": "My Writer",
      },
      body: JSON.stringify({
        model: settings.onlineModel, messages, stream: true, temperature,
        max_tokens: Math.round(maxTokens * 1.6), // bigger models write fuller replies
        stop: stop?.length ? stop.slice(0, 4) : undefined,
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") return { text, stopped: true };
    throw new Error("Couldn't reach the online AI. Check your connection.");
  }
  if (!res.ok) {
    let msg = "";
    try { const j = await res.json(); msg = j.error?.message || j.message || ""; } catch { /* ignore */ }
    if (res.status === 401) throw new Error("The online AI rejected your API key. Check it in Me → AI model.");
    if (res.status === 402) throw new Error("Your online AI account is out of credits.");
    if (res.status === 429) throw new Error("The online AI is busy (rate limited). Wait a moment and try again.");
    throw new Error(`Online AI error ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return { text, stopped };
        try {
          const j = JSON.parse(data);
          if (j.error) throw new Error(j.error.message || "Online AI error");
          const d = j.choices?.[0]?.delta?.content || "";
          if (d) { text += d; onText?.(text); }
        } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") stopped = true; else throw err;
  }
  return { text, stopped };
}

/** List models from an OpenAI-compatible service (OpenRouter's list is public) */
export async function listOnlineModels(settings) {
  const res = await fetch(settings.onlineUrl.replace(/\/+$/, "") + "/models", {
    headers: settings.onlineKey ? { Authorization: `Bearer ${settings.onlineKey}` } : {},
  });
  if (!res.ok) throw new Error(`Couldn't load the model list (${res.status})`);
  const j = await res.json();
  return (j.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    ctx: m.context_length,
    price: m.pricing?.completion != null ? Number(m.pricing.completion) * 1e6 : null, // $ per million output tokens
  }));
}

export async function stopGenerating() {
  if (!busy) return;
  if (abortCtl) { abortCtl.abort(); return; }
  if (engine) { try { await engine.interruptGenerate(); } catch { /* ignore */ } }
}

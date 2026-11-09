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
    blurb: "Richest writing and best memory for detail. Needs a strong GPU.",
  },
];
export const CONTEXT_TOKENS = 4096;
export const modelByKey = (k) => MODELS.find((m) => m.key === k) || MODELS[0];

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
    const e = await webllm.CreateMLCEngine(id, {
      initProgressCallback: (p) => setStatus({
        progress: p.progress || 0,
        text: cached ? "Waking up " + model.name + "…" : `Downloading ${model.name} (${model.size}, one time only)…`,
      }),
    });
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
export const isBusy = () => busy;

/**
 * Stream a reply. onText(fullTextSoFar) is called as tokens arrive.
 * Returns { text, stopped }.
 */
export async function generate({ modelKey, messages, temperature, maxTokens, stop, onText }) {
  if (busy) throw new Error("Already writing. Stop the current reply first.");
  busy = true;
  let text = "";
  let stopped = false;
  try {
    const e = await ensureEngine(modelKey);
    setStatus({ state: "generating" });
    const stream = await e.chat.completions.create({
      messages,
      stream: true,
      temperature,
      top_p: 0.92,
      repetition_penalty: 1.08,
      max_tokens: maxTokens,
      stop: stop?.length ? stop.slice(0, 4) : undefined,
    });
    for await (const chunk of stream) {
      const choice = chunk?.choices?.[0];
      const d = choice?.delta?.content || "";
      if (d) { text += d; onText?.(text); }
      if (choice?.finish_reason === "abort") stopped = true;
    }
  } catch (err) {
    throw new Error(friendlyError(err));
  } finally {
    busy = false;
    if (status.state === "generating") setStatus({ state: "ready" });
  }
  return { text, stopped };
}

export async function stopGenerating() {
  if (engine && busy) { try { await engine.interruptGenerate(); } catch { /* ignore */ } }
}

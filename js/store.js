/* =========================================================
   store.js — everything saved on this device (localStorage).
   Keeps the same keys the old version used ("profiles",
   "activeProfileId", "settings", "library_<profileId>") and
   upgrades old data in place, so nothing is lost.
   ========================================================= */

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const nowISO = () => new Date().toISOString();

const SCHEMA = 2;
const DEFAULT_TONE = { heat: 5, realism: 5, violence: 3, creativity: 6 };
export const DEFAULT_BOUNDARIES = "Everyone is an adult (21+). Everything is consensual.";

function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    window.dispatchEvent(new CustomEvent("mw:storage-error", { detail: err }));
    return false;
  }
}


/* ---------- Pictures are stored on their own ----------
   Avatars and chat backgrounds are big. Keeping them inside the library
   meant every tiny change re-saved megabytes. Now each picture is saved
   once under its own key, and the library just points at it. */
const IMG_PREFIX = "mwimg:";
const imgKeys = new Map(); // dataURL -> storage key (so each picture is only written once)
function imgHash(str) {
  let h = 2166136261 >>> 0;
  const step = Math.max(1, Math.floor(str.length / 4096));
  for (let i = 0; i < str.length; i += step) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36) + str.length.toString(36);
}
function readLib(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return {};
    return JSON.parse(raw, (k, v) => {
      if (typeof v === "string" && v.startsWith(IMG_PREFIX)) {
        const sk = v.slice(IMG_PREFIX.length);
        const data = localStorage.getItem(sk) || "";
        if (data) imgKeys.set(data, sk);
        return data;
      }
      return v;
    }) ?? {};
  } catch { return {}; }
}
function writeLib(key, data) {
  const pid = key.slice("library_".length);
  const used = new Set();
  try {
    const json = JSON.stringify(data, (k, v) => {
      if (typeof v === "string" && v.length > 2000 && v.startsWith("data:image")) {
        let sk = imgKeys.get(v);
        if (!sk || !sk.startsWith(`mwimg_${pid}_`)) {
          sk = `mwimg_${pid}_${imgHash(v)}`;
          if (localStorage.getItem(sk) == null) localStorage.setItem(sk, v);
          imgKeys.set(v, sk);
        }
        used.add(sk);
        return IMG_PREFIX + sk;
      }
      return v;
    });
    localStorage.setItem(key, json);
  } catch (err) {
    window.dispatchEvent(new CustomEvent("mw:storage-error", { detail: err }));
    return false;
  }
  // tidy up pictures this profile no longer uses
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(`mwimg_${pid}_`) && !used.has(k)) localStorage.removeItem(k);
  }
  return true;
}

/* ---------- Normalizers (also used for imports) ---------- */
export function normalizeTone(t = {}) {
  const out = {};
  for (const k of Object.keys(DEFAULT_TONE)) {
    const v = Number(t[k]);
    out[k] = Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : DEFAULT_TONE[k];
  }
  return out;
}

export function normalizeCharacter(c = {}) {
  return {
    id: c.id || uid(),
    name: (c.name || "Unnamed").trim(),
    avatar: c.avatar || "",
    summary: c.summary || "",
    tags: Array.isArray(c.tags) ? c.tags : String(c.tags || "").split(",").map((s) => s.trim()).filter(Boolean),
    personality: c.personality || "",
    speech: c.speech || "",
    examples: c.examples || "",
    appearance: c.appearance || "",
    scenario: c.scenario || "",
    greeting: c.greeting || "",
    greetings: Array.isArray(c.greetings) ? c.greetings.map(String).filter((g) => g.trim()) : [],
    chatStyle: MODES.includes(c.chatStyle) ? c.chatStyle : "roleplay",
    thoughts: !!c.thoughts,
    // ready-made storylines: { title, premise, opening } (opening is optional; without it they start the scene)
    storylines: Array.isArray(c.storylines)
      ? c.storylines.filter((x) => x && (x.title || x.premise)).map((x) => ({ title: String(x.title || "").trim(), premise: String(x.premise || ""), opening: String(x.opening || "") }))
      : [],
    arc: ARCS.includes(c.arc) ? c.arc : "",
    avoid: c.avoid || "",
    boundaries: c.boundaries || DEFAULT_BOUNDARIES,
    style: c.style || c.styleOverride || "",
    defaults: normalizeTone(c.defaults),
    createdAt: c.createdAt || nowISO(),
    updatedAt: c.updatedAt || c.createdAt || nowISO(),
  };
}

export function normalizeMessage(m = {}) {
  const alts = Array.isArray(m.alts) && m.alts.length ? m.alts.map(String) : [String(m.content || "")];
  const altIdx = Math.min(Math.max(0, m.altIdx ?? alts.length - 1), alts.length - 1);
  const out = { id: m.id || uid(), role: m.role === "user" ? "user" : "assistant", alts, altIdx, time: m.time || nowISO() };
  if (out.role === "assistant" && m.speaker) out.speaker = m.speaker; // character id or "narrator"
  return out;
}
export const msgText = (m) => m.alts[m.altIdx] ?? "";

export const THEMES = ["default", "neon", "road", "whiskey", "salt", "rain", "candle"];
export const MODES = ["prose", "roleplay", "texting"];          // Fanfic · Roleplay · Texting
export const ARCS = ["", "friends", "tension", "confessed", "together"]; // slow-burn stages ("" = off)
export function normalizeChat(c = {}) {
  const cast = Array.isArray(c.cast) && c.cast.length ? [...new Set(c.cast)] : [c.characterId].filter(Boolean);
  return {
    id: c.id || uid(),
    characterId: cast[0],
    cast,
    narrator: !!c.narrator,
    chimeIn: c.chimeIn !== false,
    summary: c.summary || "",
    summarizedUpTo: Number.isInteger(c.summarizedUpTo) ? c.summarizedUpTo : 0,
    avoid: c.avoid || "",
    theme: THEMES.includes(c.theme) ? c.theme : "default",
    bg: c.bg || "",
    messages: Array.isArray(c.messages) ? c.messages.map(normalizeMessage) : [],
    mode: MODES.includes(c.mode) ? c.mode : "roleplay",
    arc: ARCS.includes(c.arc) ? c.arc : "",
    title: c.title || "",          // storyline name
    premise: c.premise || "",      // what this storyline is about
    thoughts: !!c.thoughts,        // show the character's inner thoughts
    autoStart: !!c.autoStart,      // character writes the opening scene
    length: ["short", "medium", "long"].includes(c.length) ? c.length : "medium",
    tone: normalizeTone(c.tone),
    memory: c.memory || "",
    direction: c.direction || "",
    createdAt: c.createdAt || nowISO(),
    updatedAt: c.updatedAt || nowISO(),
  };
}

export function normalizeLore(e = {}) {
  const list = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((s) => String(s).trim()).filter(Boolean);
  return {
    id: e.id || uid(),
    title: e.title || "Untitled",
    keywords: list(e.keywords),
    tags: list(e.tags),
    mode: e.mode === "always" ? "always" : "keywords",
    enabled: e.enabled !== false,
    content: e.content || "",
  };
}

export function normalizeStory(s = {}) {
  return {
    id: s.id || uid(),
    title: s.title || "",
    content: s.content || "",
    premise: s.premise || s.beats || "",
    direction: s.direction || "",
    pov: ["first", "second", "third"].includes(s.pov) ? s.pov : "third",
    tense: s.tense === "present" ? "present" : "past",
    chunk: ["short", "medium", "long"].includes(s.chunk) ? s.chunk : "medium",
    style: s.style || "",
    castIds: Array.isArray(s.castIds) ? s.castIds : [],
    tone: normalizeTone(s.tone),
    createdAt: s.createdAt || nowISO(),
    updatedAt: s.updatedAt || nowISO(),
  };
}

function normalizeLibrary(L = {}) {
  const chats = {};
  for (const c of Object.values(L.chats || {})) {
    if (c && (c.characterId || c.cast?.length)) { const n = normalizeChat(c); chats[n.id] = n; }
  }
  return {
    characters: (L.characters || []).map(normalizeCharacter),
    chats,
    lore: (L.lore || []).map(normalizeLore),
    stories: (L.stories || []).map(normalizeStory),
  };
}

function normalizeProfile(p = {}) {
  return {
    id: p.id || uid(),
    name: p.name || "You",
    persona: p.persona ?? p.bio ?? "",
    pronouns: p.pronouns || "",
    age: p.age || "",
    avoid: p.avoid || "",
    banned: p.banned || "",
    theme: ["dark", "light", "system"].includes(p.theme) ? p.theme : "system",
    accent: p.accent || p.colors?.accent || "#86b49a",
    readingFont: p.readingFont === "sans" ? "sans" : "serif",
    textSize: ["s", "m", "l"].includes(p.textSize) ? p.textSize : "m",
  };
}

const MODEL_MIGRATIONS = {
  "Llama-3.2-1B-Instruct-q4f32_1-MLC": "llama32-1b",
  "Llama-3-8B-Instruct-q4f16_1-MLC": "hermes3-8b", // this id no longer exists in WebLLM
};
function normalizeSettings(s = {}) {
  return {
    model: MODEL_MIGRATIONS[s.model] || s.model || "hermes3-3b",
    temp: Number.isFinite(+s.temp) ? +s.temp : 0.85,
    globalStyle: s.globalStyle || "",
    profanity: ["avoid", "allow", "unfiltered"].includes(s.profanity) ? s.profanity : "allow",
    enterToSend: s.enterToSend ?? !matchMedia("(pointer: coarse)").matches,
    provider: s.provider === "online" ? "online" : "local",
    onlineUrl: s.onlineUrl || "https://openrouter.ai/api/v1",
    onlineKey: s.onlineKey || "",
    onlineModel: s.onlineModel || "",
  };
}

/* ---------- Boot / migration ---------- */
function migrate() {
  let profiles = read("profiles", []);
  if (!Array.isArray(profiles) || !profiles.length) profiles = [{ name: "You" }];
  profiles = profiles.map(normalizeProfile);
  write("profiles", profiles);

  let active = read("activeProfileId");
  if (!profiles.some((p) => p.id === active)) active = profiles[0].id;
  write("activeProfileId", active);

  write("settings", normalizeSettings(read("settings", {})));

  for (const p of profiles) {
    const key = "library_" + p.id;
    writeLib(key, normalizeLibrary(readLib(key)));
  }
  localStorage.removeItem("library"); // unused leftover from v1
  write("schemaVersion", SCHEMA);
}
migrate();

/* ---------- Profiles ---------- */
export const getProfiles = () => read("profiles", []);
export const getActiveProfileId = () => read("activeProfileId");
export const getProfile = () => getProfiles().find((p) => p.id === getActiveProfileId()) || getProfiles()[0];

export function updateProfile(patch) {
  const id = getActiveProfileId();
  write("profiles", getProfiles().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}
export function createProfile(name) {
  const p = normalizeProfile({ ...getProfile(), id: uid(), name, persona: "" });
  write("profiles", [...getProfiles(), p]);
  write("library_" + p.id, normalizeLibrary({}));
  switchProfile(p.id);
}
export function renameProfile(id, name) {
  write("profiles", getProfiles().map((p) => (p.id === id ? { ...p, name } : p)));
  window.dispatchEvent(new CustomEvent("mw:profile"));
}
export function deleteProfile(id) {
  if (id === getActiveProfileId()) return;
  write("profiles", getProfiles().filter((p) => p.id !== id));
  localStorage.removeItem("library_" + id);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(`mwimg_${id}_`)) localStorage.removeItem(k);
  }
}
export function switchProfile(id) {
  flushLib();
  write("activeProfileId", id);
  libCache = null;
  window.dispatchEvent(new CustomEvent("mw:profile"));
}

/* ---------- Settings ---------- */
export const getSettings = () => normalizeSettings(read("settings", {}));
export function updateSettings(patch) { write("settings", { ...getSettings(), ...patch }); }

/* ---------- Library (cached, write-through) ---------- */
let libCache = null;
export function lib() {
  const key = "library_" + getActiveProfileId();
  if (!libCache || libCache.key !== key) libCache = { key, data: normalizeLibrary(readLib(key)) };
  return libCache.data;
}
/* Saving the whole library (with pictures) is slow on phones, so saves are
   grouped: many changes in a row become one write a moment later. Anything
   pending is written right away if the app is hidden or closed. */
let saveTimer = null;
export function saveLib() {
  if (!libCache) return true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushLib, 400);
  return true;
}
export function flushLib() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (libCache) writeLib(libCache.key, libCache.data);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushLib(); });
window.addEventListener("pagehide", flushLib);

// Characters
export const getCharacter = (id) => lib().characters.find((c) => c.id === id);
export function saveCharacter(c) {
  const L = lib();
  const n = normalizeCharacter({ ...c, updatedAt: nowISO() });
  const i = L.characters.findIndex((x) => x.id === n.id);
  if (i >= 0) L.characters[i] = n; else L.characters.unshift(n);
  saveLib();
  return n;
}
export function deleteCharacter(id) {
  const L = lib();
  L.characters = L.characters.filter((c) => c.id !== id);
  for (const [cid, chat] of Object.entries(L.chats)) {
    if (!chat.cast.includes(id)) continue;
    chat.cast = chat.cast.filter((x) => x !== id);
    if (!chat.cast.length) delete L.chats[cid]; else chat.characterId = chat.cast[0];
  }
  L.stories.forEach((s) => { s.castIds = s.castIds.filter((x) => x !== id); });
  saveLib();
}

// Chats
export const getChat = (id) => lib().chats[id];
export const chatsFor = (characterId) =>
  Object.values(lib().chats).filter((c) => c.cast.includes(characterId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export const recentChats = () => Object.values(lib().chats).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
/** greetings: array of opening lines (first is default, the rest are swipeable alternatives) */
export function createChat(ch, greetings = [], extra = {}) {
  const chat = normalizeChat({ characterId: ch.id, tone: ch.defaults, ...extra });
  const g = (Array.isArray(greetings) ? greetings : [greetings]).filter((x) => x && x.trim());
  if (g.length) chat.messages.push(normalizeMessage({ role: "assistant", speaker: ch.id, alts: g, altIdx: 0 }));
  lib().chats[chat.id] = chat;
  saveLib();
  return chat;
}
export function touchChat(chat) { chat.updatedAt = nowISO(); lib().chats[chat.id] = chat; saveLib(); }
export function deleteChat(id) { delete lib().chats[id]; saveLib(); }

// Lore
export function saveLore(e) {
  const L = lib();
  const n = normalizeLore(e);
  const i = L.lore.findIndex((x) => x.id === n.id);
  if (i >= 0) L.lore[i] = n; else L.lore.unshift(n);
  saveLib();
  return n;
}
export function deleteLore(id) { lib().lore = lib().lore.filter((x) => x.id !== id); saveLib(); }

// Stories
export const getStory = (id) => lib().stories.find((s) => s.id === id);
export function saveStory(s) {
  const L = lib();
  s.updatedAt = nowISO();
  const i = L.stories.findIndex((x) => x.id === s.id);
  if (i >= 0) L.stories[i] = s; else L.stories.unshift(s);
  saveLib();
  return s;
}
export function newStory() { return saveStory(normalizeStory({})); }
export function deleteStory(id) { lib().stories = lib().stories.filter((s) => s.id !== id); saveLib(); }

/* ---------- Backup ---------- */
export function exportAll() {
  flushLib();
  return {
    app: "my-writer",
    schemaVersion: SCHEMA,
    exportedAt: nowISO(),
    profiles: getProfiles(),
    activeProfileId: getActiveProfileId(),
    libraries: getProfiles().map((p) => ({ profileId: p.id, library: readLib("library_" + p.id) })), // pictures included
    settings: { ...getSettings(), onlineKey: "" }, // the API key never goes into backup files
  };
}
export function importAll(pack) {
  if (!pack || !Array.isArray(pack.profiles)) throw new Error("That file isn't a My Writer backup.");
  clearTimeout(saveTimer); saveTimer = null; // drop pending saves; the backup replaces everything
  write("profiles", pack.profiles.map(normalizeProfile));
  for (const item of pack.libraries || []) writeLib("library_" + item.profileId, normalizeLibrary(item.library));
  if (pack.settings) write("settings", normalizeSettings({ ...pack.settings, onlineKey: getSettings().onlineKey }));
  const ids = getProfiles().map((p) => p.id);
  write("activeProfileId", ids.includes(pack.activeProfileId) ? pack.activeProfileId : ids[0]);
  libCache = null;
  window.dispatchEvent(new CustomEvent("mw:profile"));
}

export function storageUsedKB() {
  flushLib();
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    n += k.length + (localStorage.getItem(k) || "").length;
  }
  return Math.round((n * 2) / 1024); // UTF-16
}

/* ---------- A sample character that shows what a strong card looks like ---------- */
export function sampleCharacter() {
  return {
    name: "Wren Calloway",
    summary: "Runs a secondhand bookshop that only opens after midnight. Knows everyone's secrets; keeps most of them.",
    tags: ["slow burn", "banter", "mystery"],
    personality:
      "Dry, observant, quietly kind but hides it behind sarcasm. Hates small talk, loves a good argument about books. " +
      "Lonely in a way she'd never admit. Notices details other people miss and uses them to tease. " +
      "Wants: someone who keeps up with her. Afraid of: being needed and then left.",
    speech:
      "Short, clipped sentences. Deadpan. Answers questions with questions when she's dodging. " +
      "Calls {{user}} \"night owl\". Swears mildly when surprised (\"hell\", \"damn it\"). " +
      "Never gushes; when she's being sincere her sentences get softer and longer.",
    examples:
      "{{char}}: *doesn't look up from the ledger* We're closed. Unless you're here to buy something. Then we're very open.\n" +
      "{{user}}: What would you recommend?\n" +
      "{{char}}: Depends. Are you trying to feel something, or avoid feeling something? *finally looks up* ...Yeah. Thought so. Poetry section's in the back.",
    appearance: "Late twenties. Ink-stained fingers, oversized cardigan, reading glasses pushed into messy dark hair. Smells like old paper and black coffee.",
    scenario: "It's 1 a.m. and raining. {{user}} has wandered into Wren's shop for the third night in a row, and she has started to notice.",
    greeting: "*The bell over the door jingles. Wren doesn't look up.* Third night in a row, night owl. Either you really love books, or you're avoiding something at home. *She turns a page.* Coffee's on the counter. Don't tell anyone I offered.",
    boundaries: DEFAULT_BOUNDARIES,
    defaults: { heat: 4, realism: 7, violence: 1, creativity: 6 },
  };
}

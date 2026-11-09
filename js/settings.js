/* =========================================================
   settings.js — "Me" tab, laid out like phone Settings:
   one short list, each row opens its own small page.
   ========================================================= */
import { h, icon, toast, confirmDialog, promptDialog, autosize, field, segmented, toggle, downloadFile, debounce, avatar, navRow, group, fillRange, chipSelect } from "./ui.js";
import { page, modelStatusCard } from "./layout.js";
import {
  getProfile, updateProfile, getProfiles, getActiveProfileId, createProfile, renameProfile, deleteProfile, switchProfile,
  getSettings, updateSettings, exportAll, importAll, storageUsedKB, lib,
} from "./store.js";
import { MODELS, modelByKey, onStatus, ensureEngine, unloadEngine, checkGPU, listOnlineModels, isPhone, centsLabel, messagesFor } from "./ai.js";
import { applyTheme } from "./app.js";

const ACCENTS = ["#86b49a", "#e3bf6b", "#d98b8b", "#8fb3e0", "#b59ad9", "#e0a170"];

/* ---------- Me (list) ---------- */
export function renderMe() {
  const p = getProfile();
  const s = getSettings();
  const L = lib();
  const themeName = { system: "Auto", dark: "Dark", light: "Light" }[p.theme];

  const card = h("a", { class: "me-card", href: "#/me/profile" },
    avatar({ name: p.name || "You" }, "lg"),
    h("div", { class: "me-card-text" },
      h("b", {}, p.name || "You"),
      h("span", {}, p.persona ? p.persona.slice(0, 70) : "Add a little about yourself")),
    icon("chevronRight", 18));

  return page({
    title: "Me", large: true,
    body: [
      card,
      group(
        navRow({ icon: "eye", label: "Appearance", detail: themeName, href: "#/me/look" }),
        navRow({ icon: "cpu", label: "AI model", detail: s.provider === "online" ? (s.onlineModel.split("/").pop() || "Online") : modelByKey(s.model).name, href: "#/me/model" })),
      group(
        navRow({ icon: "book", label: "Lorebook", detail: String(L.lore.length), href: "#/lore" })),
      group(
        navRow({ icon: "download", label: "Backup & profiles", href: "#/me/data" })),
      h("p", { class: "muted small center footer-note" }, "My Writer · everything stays on this device"),
    ],
  });
}

/* ---------- Profile ---------- */
export function renderMeProfile() {
  const p = getProfile();
  const save = debounce((patch) => updateProfile(patch), 300);
  const inp = (key, placeholder, extra = {}) => {
    const el = h("input", { class: "input", value: p[key], placeholder, ...extra, onInput: () => save({ [key]: el.value }) });
    return el;
  };
  const ta = (key, rows, placeholder) => {
    const el = h("textarea", { class: "input", rows, value: p[key], placeholder, onInput: () => save({ [key]: el.value }) });
    autosize(el, 300);
    return el;
  };
  return page({
    title: "Profile", back: "#/me",
    body: h("div", { class: "form" },
      field("Your name", inp("name", "Your name"), "Characters call you this."),
      h("div", { class: "two-col" },
        field("Age", inp("age", "e.g. 25", { inputmode: "numeric" })),
        field("Pronouns", inp("pronouns", "e.g. she/her"))),
      field("About you", ta("persona", 3, "Looks, job, personality, how you like to play…"), "Every character knows this, so they react to you, not a stranger."),
      h("div", { class: "group-title" }, "Never"),
      field("Things characters should never do", ta("avoid", 4, "One per line, e.g.\nDon't call me kid or kiddo\nDon't treat me like I'm fragile\nNo pet names unless we're together"),
        "Hard rules for every character in every chat. They're reminded of these with every message."),
      field("Banned words", inp("banned", "e.g. kid, kiddo, sweetheart"),
        "Comma separated. If a reply uses one, it's automatically rewritten.")),
  });
}

/* ---------- Appearance ---------- */
export function renderMeLook() {
  const p = getProfile();
  const s = getSettings();
  const swatches = h("div", { class: "swatches" });
  const draw = (cur) => swatches.replaceChildren(
    ...ACCENTS.map((c) => h("button", { class: `swatch ${c === cur ? "on" : ""}`, type: "button", style: { background: c }, "aria-label": `Accent ${c}`,
      onClick: () => { updateProfile({ accent: c }); applyTheme(); draw(c); } })),
    h("label", { class: "swatch custom", title: "Custom color" }, icon("plus", 16),
      h("input", { type: "color", value: cur, onInput: (e) => { updateProfile({ accent: e.target.value }); applyTheme(); } })));
  draw(p.accent);

  return page({
    title: "Appearance", back: "#/me",
    body: h("div", { class: "form" },
      field("Theme", segmented([["system", "Auto"], ["dark", "Dark"], ["light", "Light"]], p.theme, (v) => { updateProfile({ theme: v }); applyTheme(); })),
      field("Accent color", swatches),
      field("Text size", segmented([["s", "Small"], ["m", "Medium"], ["l", "Large"]], p.textSize, (v) => { updateProfile({ textSize: v }); applyTheme(); })),
      field("Story font", segmented([["serif", "Bookish"], ["sans", "Clean"]], p.readingFont, (v) => { updateProfile({ readingFont: v }); applyTheme(); })),
      h("div", { class: "group pad" }, toggle(s.enterToSend, (v) => updateSettings({ enterToSend: v }), "Return key sends messages"))),
  });
}

/* ---------- AI model ---------- */
export function renderMeModel() {
  const s = getSettings();
  const list = h("div", { class: "group" });
  const gpuNote = h("p", { class: "muted small" });
  checkGPU().then((g) => {
    gpuNote.textContent = g.ok ? "✓ Your device can run the AI." : g.reason;
    gpuNote.classList.toggle("warn", !g.ok);
  });

  const draw = () => {
    const cur = getSettings().model;
    list.replaceChildren(...MODELS.map((m) => h("button", {
      class: `model-row ${m.key === cur ? "on" : ""}`, type: "button", role: "radio", "aria-checked": String(m.key === cur),
      onClick: async () => {
        if (m.key === getSettings().model) return;
        if (m.desktopOnly && isPhone() && !(await confirmDialog(`${m.name} is about ${m.size} and needs a computer's graphics chip. On a phone it usually downloads and then can't reply.`, { title: "Too big for phones", ok: "Use it anyway" }))) return;
        updateSettings({ model: m.key, modelChosen: true });
        await unloadEngine();
        draw();
        toast(`${m.name} selected`);
      },
    },
    h("div", { class: "model-row-text" },
      h("div", { class: "model-row-head" }, h("b", {}, m.name), m.recommended ? h("span", { class: "badge gold" }, "Recommended") : null),
      h("div", { class: "muted small" }, `${m.blurb} ${m.size}.`)),
    h("span", { class: "radio" }))));
  };
  draw();

  const loadState = h("span", { class: "muted small" });
  const loadBtn = h("button", { class: "btn ghost wide", type: "button", onClick: () => ensureEngine(getSettings().model).catch(() => {}) }, icon("download", 18), "Download now");
  let first = true;
  const unsub = onStatus((st) => {
    if (!first && !loadState.isConnected) { unsub(); return; }
    first = false;
    const ready = st.state === "ready" || st.state === "generating";
    loadState.textContent = ready ? "✓ Downloaded and ready" : "";
    loadBtn.hidden = ready || st.state === "loading";
  });

  const temp = h("input", { type: "range", min: 0.3, max: 1.3, step: 0.05, value: s.temp, "aria-label": "Creativity" });
  const tempVal = h("span", { class: "tone-val" });
  const word = (v) => (v < 0.6 ? "Careful" : v < 0.8 ? "Steady" : v < 1.0 ? "Balanced" : v < 1.15 ? "Loose" : "Chaotic");
  tempVal.textContent = word(s.temp);
  const saveSoon = debounce((patch) => updateSettings(patch), 300);
  temp.addEventListener("input", () => { tempVal.textContent = word(+temp.value); saveSoon({ temp: +temp.value }); });

  const style = h("textarea", { class: "input", rows: 3, value: s.globalStyle,
    placeholder: "e.g. Show, don't tell. Witty banter. No clichés.",
    onInput: () => saveSoon({ globalStyle: style.value }) });
  autosize(style, 240);

  const localPart = h("div", { class: "form" },
    h("p", { class: "muted small" }, "Runs on your device, so nothing you write leaves it. Downloads once, then works offline."),
    isPhone() ? h("div", { class: "tip" }, icon("sparkles", 16), h("span", {},
      "On a phone, on-device AI is slow and limited by memory. Hermes 3 · 3B is the biggest that usually works; Llama 3.2 · 1B is the safest. For the best stories on a phone, use Online.")) : null,
    gpuNote,
    list,
    loadState, loadBtn,
    modelStatusCard({ onRetry: () => ensureEngine(getSettings().model).catch(() => {}) }));
  const onlinePart = onlineSetup();
  const showPart = (v) => { localPart.hidden = v !== "local"; onlinePart.hidden = v !== "online"; if (v === "online") onlinePart.autoBrowse(); };
  showPart(s.provider);

  return page({
    title: "AI model", back: "#/me",
    body: h("div", { class: "form" },
      field("Where the AI runs", segmented([["local", "On this device"], ["online", "Online (smarter)"]], s.provider, (v) => { updateSettings({ provider: v }); showPart(v); })),
      localPart,
      onlinePart,
      h("div", { class: "group-title" }, "Writing"),
      h("div", { class: "tone" },
        h("div", { class: "tone-head" }, h("span", { class: "tone-emoji" }, "🎲"), h("span", { class: "tone-label" }, "Creativity"), tempVal),
        fillRange(temp),
        h("div", { class: "tone-ends" }, h("span", {}, "Careful"), h("span", {}, "Chaotic"))),
      field("Your writing style", style, "Applied to every chat and story."),
      field("Swearing & crude humor", segmented([["avoid", "Avoid"], ["allow", "Natural"], ["unfiltered", "Unfiltered"]], s.profanity, (v) => updateSettings({ profanity: v })),
        "Unfiltered: characters talk exactly like themselves (swearing, dirty jokes, innuendo).")),
  });
}

/* ---------- Backup & profiles ---------- */
export function renderMeData() {
  const profiles = h("div", { class: "group" });
  const draw = () => {
    const active = getActiveProfileId();
    profiles.replaceChildren(...getProfiles().map((pr) => h("div", { class: "nav-row" },
      h("button", { class: "nav-row-label as-btn", type: "button", onClick: () => { if (pr.id !== active) { switchProfile(pr.id); toast(`Switched to ${pr.name}`); } } },
        pr.name, pr.id === active ? h("span", { class: "badge" }, "Active") : null),
      h("button", { class: "text-btn", type: "button", onClick: async () => {
        const n = await promptDialog("Rename profile", { value: pr.name });
        if (n) { renameProfile(pr.id, n); draw(); }
      } }, "Rename"),
      pr.id !== active ? h("button", { class: "text-btn danger", type: "button", onClick: async () => {
        if (await confirmDialog(`Everything in "${pr.name}" will be deleted.`, { title: "Delete profile?", ok: "Delete", danger: true })) { deleteProfile(pr.id); draw(); }
      } }, "Delete") : null)));
  };
  draw();

  const importInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, onChange: async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const pack = JSON.parse(await f.text());
      if (!(await confirmDialog("This replaces everything on this device with the backup.", { title: "Restore backup?", ok: "Restore", danger: true }))) return;
      importAll(pack); toast("Backup restored");
    } catch (err) { toast(err.message || "Couldn't read that file", { type: "error" }); }
    finally { importInput.value = ""; }
  } });

  return page({
    title: "Backup & profiles", back: "#/me",
    body: h("div", { class: "form" },
      h("div", { class: "group-title" }, "Backup"),
      group(
        navRow({ icon: "download", label: "Export backup", onClick: () => downloadFile(JSON.stringify(exportAll(), null, 2), `my-writer-backup-${new Date().toISOString().slice(0, 10)}.json`) }),
        navRow({ icon: "upload", label: "Restore from backup", onClick: () => importInput.click() })),
      importInput,
      h("p", { class: "muted small" }, `Using ${storageUsedKB().toLocaleString()} KB in this browser. Export now and then. Clearing your browser data would erase everything.`),
      h("div", { class: "group-title" }, "Profiles"),
      h("p", { class: "muted small" }, "Each profile has its own characters, chats, lore and stories."),
      profiles,
      h("button", { class: "btn ghost wide", type: "button", onClick: async () => {
        const n = await promptDialog("New profile name", { placeholder: "e.g. Fantasy world" });
        if (n) { createProfile(n); toast(`Created ${n}`); draw(); }
      } }, icon("plus", 18), "New profile")),
  });
}

/* ---------- Online AI setup (OpenRouter or any OpenAI-compatible service) ---------- */
function onlineSetup() {
  const s = getSettings();
  const save = debounce((patch) => updateSettings(patch), 300);
  const key = h("input", { class: "input", type: "password", value: s.onlineKey, placeholder: "sk-or-…", autocomplete: "off", onInput: () => save({ onlineKey: key.value.trim() }) });
  const url = h("input", { class: "input", value: s.onlineUrl, placeholder: "https://openrouter.ai/api/v1", onInput: () => save({ onlineUrl: url.value.trim() }) });
  const current = h("div", { class: "nav-row-detail" + (s.onlineModel ? "" : " warn") }, s.onlineModel || "Pick one below ↓");
  const listWrap = h("div", { class: "model-browser", hidden: true });
  const search = h("input", { class: "input search", type: "search", placeholder: "Search (e.g. llama, mistral)" });
  const results = h("div", { class: "group" });
  const filterHint = h("p", { class: "muted small" });
  let all = [];
  let filter = "hermes";
  const HINTS = {
    hermes: "Hermes models are great at roleplay and very open about swearing and spice.",
    free: "Free models cost nothing but have daily limits, can be slow or busy, and some refuse spicy scenes. Great for trying it out.",
    cheap: "The cheapest paid models first.",
    all: "Every model, cheapest first.",
  };
  const filters = h("div", {});

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const cur = getSettings().onlineModel;
    filterHint.textContent = HINTS[filter];
    const byCost = (a, b) => (a.perMsg ?? 1e9) - (b.perMsg ?? 1e9);
    let list = all.filter((m) => !m.hidden);
    if (filter === "hermes") list = list.filter((m) => /hermes/i.test(`${m.id} ${m.name}`));
    if (filter === "free") list = list.filter((m) => m.free);
    if (filter === "cheap") list = list.filter((m) => !m.free);
    list.sort(byCost);
    const hits = list.filter((m) => !q || `${m.id} ${m.name}`.toLowerCase().includes(q)).slice(0, 40);
    results.replaceChildren(...hits.map((m) => h("button", { class: `model-row ${m.id === cur ? "on" : ""}`, type: "button", onClick: () => {
      updateSettings({ onlineModel: m.id }); current.textContent = m.id; current.classList.remove("warn"); draw(); toast(`Using ${m.name} ✓`);
    } },
    h("div", { class: "model-row-text" },
      h("div", { class: "model-row-head" }, h("b", {}, m.name), m.free ? h("span", { class: "badge" }, "Free") : null),
      m.free
        ? h("div", { class: "price-line" }, "Free · daily limits")
        : m.perMsg == null ? h("div", { class: "price-line" }, "Price unknown")
        : h("div", { class: "price-line" }, h("b", {}, centsLabel(m.perMsg).startsWith("under") ? "Under 0.1¢ a message" : `≈ ${centsLabel(m.perMsg)} a message`), ` · ${messagesFor(5, m.perMsg)} for $5 · ${messagesFor(20, m.perMsg)} for $20`),
      h("div", { class: "muted small" }, m.id)),
    h("span", { class: "radio" }))));
    if (!hits.length) results.append(h("div", { class: "nav-row muted" }, "No matches"));
  };
  search.addEventListener("input", draw);

  const browse = h("button", { class: "btn ghost wide", type: "button", onClick: async () => {
    browse.disabled = true; browse.textContent = "Loading…";
    try {
      all = await listOnlineModels(getSettings());
      listWrap.hidden = false;
      browse.hidden = true;
      filter = all.some((m) => /hermes/i.test(m.id)) ? "hermes" : "all";
      filters.replaceChildren(chipSelect([["hermes", "Hermes"], ["free", "Free"], ["cheap", "Cheapest"], ["all", "All"]], filter, (v) => { filter = v; draw(); }));
      search.value = ""; draw();
    } catch (err) { toast(err.message, { type: "error" }); browse.textContent = "Browse models"; }
    browse.disabled = false;
  } }, icon("users", 18), "Browse models");

  listWrap.append(filters, filterHint, search, results,
    h("p", { class: "muted small" }, "Estimates are for a medium-length story. Very long stories cost a bit more per message; new storylines cost less."));
  // open the list by itself when no model is picked yet (no hunting for a button)
  let tried = false;
  const autoBrowse = () => { if (!tried && !getSettings().onlineModel) { tried = true; browse.click(); } };

  const el = h("div", { class: "form" },
    h("div", { class: "tip" }, icon("sparkles", 16), h("span", {},
      "Uses a much bigger AI on the internet, so characters are smarter, funnier and remember more. ",
      "Your chats are sent to that service, and it usually costs a few cents per conversation.")),
    h("div", { class: "group" }, h("div", { class: "nav-row" }, h("span", { class: "nav-row-label" }, "Model"), current)),
    field("API key", key, "Get one at openrouter.ai → Keys. It stays on this device only and is never included in backups."),
    browse,
    listWrap,
    h("details", { class: "advanced" }, h("summary", {}, "Advanced"),
      field("Service address", url, "Any OpenAI-compatible API works. Leave as is for OpenRouter.")));
  el.autoBrowse = autoBrowse;
  return el;
}

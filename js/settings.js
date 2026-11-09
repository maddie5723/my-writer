/* =========================================================
   settings.js — "Me" tab, laid out like phone Settings:
   one short list, each row opens its own small page.
   ========================================================= */
import { h, icon, toast, confirmDialog, promptDialog, autosize, field, segmented, toggle, downloadFile, debounce, avatar, navRow, group, fillRange } from "./ui.js";
import { page, modelStatusCard } from "./layout.js";
import {
  getProfile, updateProfile, getProfiles, getActiveProfileId, createProfile, renameProfile, deleteProfile, switchProfile,
  getSettings, updateSettings, exportAll, importAll, storageUsedKB, lib,
} from "./store.js";
import { MODELS, modelByKey, onStatus, ensureEngine, unloadEngine, checkGPU } from "./ai.js";
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
        navRow({ icon: "cpu", label: "AI model", detail: modelByKey(s.model).name, href: "#/me/model" })),
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
  const name = h("input", { class: "input", value: p.name, placeholder: "Your name", onInput: () => save({ name: name.value }) });
  const persona = h("textarea", { class: "input", rows: 4, value: p.persona,
    placeholder: "Age, looks, job, personality, how you like to play…",
    onInput: () => save({ persona: persona.value }) });
  autosize(persona, 300);
  return page({
    title: "Profile", back: "#/me",
    body: h("div", { class: "form" },
      field("Your name", name, "Characters call you this."),
      field("About you", persona, "Every character knows this, so they react to you, not a stranger.")),
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
        updateSettings({ model: m.key });
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

  return page({
    title: "AI model", back: "#/me",
    body: h("div", { class: "form" },
      h("p", { class: "muted small" }, "Runs on your device, so nothing you write leaves it. Downloads once, then works offline."),
      gpuNote,
      list,
      loadState, loadBtn,
      modelStatusCard({ onRetry: () => ensureEngine(getSettings().model).catch(() => {}) }),
      h("div", { class: "group-title" }, "Writing"),
      h("div", { class: "tone" },
        h("div", { class: "tone-head" }, h("span", { class: "tone-emoji" }, "🎲"), h("span", { class: "tone-label" }, "Creativity"), tempVal),
        fillRange(temp),
        h("div", { class: "tone-ends" }, h("span", {}, "Careful"), h("span", {}, "Chaotic"))),
      field("Your writing style", style, "Applied to every chat and story."),
      field("Swearing", segmented([["allow", "Allowed"], ["avoid", "Avoid"]], s.profanity, (v) => updateSettings({ profanity: v })))),
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

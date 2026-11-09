/* =========================================================
   settings.js — "You" tab: persona, look & feel, AI model,
   profiles and backups. Everything saves as you change it.
   ========================================================= */
import { h, icon, toast, confirmDialog, promptDialog, autosize, field, segmented, toggle, downloadFile, debounce } from "./ui.js";
import { page, section, modelStatusCard } from "./layout.js";
import {
  getProfile, updateProfile, getProfiles, getActiveProfileId, createProfile, renameProfile, deleteProfile, switchProfile,
  getSettings, updateSettings, exportAll, importAll, storageUsedKB,
} from "./store.js";
import { MODELS, onStatus, ensureEngine, unloadEngine, checkGPU } from "./ai.js";
import { applyTheme } from "./app.js";

const ACCENTS = ["#86b49a", "#e3bf6b", "#d98b8b", "#8fb3e0", "#b59ad9", "#e0a170"];

export function renderSettings() {
  const p = getProfile();
  const s = getSettings();
  const saveProfile = debounce((patch) => updateProfile(patch), 300);
  const saveSettings = debounce((patch) => updateSettings(patch), 300);

  /* ---- You ---- */
  const name = h("input", { class: "input", value: p.name, placeholder: "What should characters call you?",
    onInput: () => saveProfile({ name: name.value }) });
  const persona = h("textarea", { class: "input", rows: 3, value: p.persona,
    placeholder: "Anything characters should know about you: age, looks, job, personality, how you like to play…",
    onInput: () => saveProfile({ persona: persona.value }) });
  autosize(persona, 300);

  /* ---- Look & feel ---- */
  const swatches = h("div", { class: "swatches" });
  const drawSwatches = (cur) => swatches.replaceChildren(
    ...ACCENTS.map((c) => h("button", { class: `swatch ${c === cur ? "on" : ""}`, type: "button", style: { background: c }, "aria-label": `Accent ${c}`,
      onClick: () => { updateProfile({ accent: c }); applyTheme(); drawSwatches(c); } })),
    h("label", { class: "swatch custom", title: "Custom color" }, icon("plus", 16),
      h("input", { type: "color", value: cur, onInput: (e) => { updateProfile({ accent: e.target.value }); applyTheme(); } })));
  drawSwatches(p.accent);

  /* ---- Model ---- */
  const modelList = h("div", { class: "model-list", role: "radiogroup" });
  const gpuNote = h("p", { class: "muted small" });
  checkGPU().then((g) => { gpuNote.textContent = g.ok ? `Your device supports on-device AI${g.f16 ? " (fast mode)" : ""}.` : g.reason; gpuNote.classList.toggle("warn", !g.ok); });
  const drawModels = () => {
    const cur = getSettings().model;
    modelList.replaceChildren(...MODELS.map((m) => h("button", {
      class: `model-opt ${m.key === cur ? "on" : ""}`, type: "button", role: "radio", "aria-checked": String(m.key === cur),
      onClick: async () => {
        if (m.key === getSettings().model) return;
        updateSettings({ model: m.key });
        await unloadEngine();
        drawModels();
        toast(`${m.name} selected — it'll load when you next chat`);
      },
    },
    h("div", { class: "model-opt-head" }, h("b", {}, m.name), m.recommended ? h("span", { class: "badge gold" }, "Recommended") : null, h("span", { class: "muted small grow-right" }, m.size)),
    h("div", { class: "muted small" }, m.blurb))));
  };
  drawModels();

  const loadState = h("span", { class: "muted small" });
  const loadBtn = h("button", { class: "btn ghost small", type: "button", onClick: () => ensureEngine(getSettings().model).catch(() => {}) }, icon("download", 16), "Download / load now");
  let first = true;
  const unsub = onStatus((st) => {
    if (!first && !loadState.isConnected) { unsub(); return; }
    first = false;
    loadState.textContent = st.state === "ready" || st.state === "generating" ? "✓ Loaded and ready" : st.state === "loading" ? `Loading ${Math.round(st.progress * 100)}%…` : "";
    loadBtn.hidden = st.state === "ready" || st.state === "generating" || st.state === "loading";
  });

  const temp = h("input", { type: "range", min: 0.3, max: 1.3, step: 0.05, value: s.temp, "aria-label": "Creativity baseline" });
  const tempVal = h("span", { class: "tone-val" });
  const tempWord = (v) => (v < 0.6 ? "Careful" : v < 0.8 ? "Steady" : v < 1.0 ? "Balanced" : v < 1.15 ? "Loose" : "Chaotic");
  tempVal.textContent = tempWord(s.temp);
  temp.addEventListener("input", () => { tempVal.textContent = tempWord(+temp.value); saveSettings({ temp: +temp.value }); });

  const globalStyle = h("textarea", { class: "input", rows: 3, value: s.globalStyle,
    placeholder: "Your voice for everything: e.g. 'Show, don't tell. Witty banter. No purple prose. Avoid clichés like \"a shiver ran down her spine\".'",
    onInput: () => saveSettings({ globalStyle: globalStyle.value }) });
  autosize(globalStyle, 300);

  /* ---- Profiles ---- */
  const profileList = h("div", { class: "list" });
  const drawProfiles = () => {
    const active = getActiveProfileId();
    profileList.replaceChildren(...getProfiles().map((pr) => h("div", { class: "list-row" },
      h("button", { class: "list-row-main", type: "button", onClick: () => { if (pr.id !== active) { switchProfile(pr.id); toast(`Switched to ${pr.name}`); } } },
        h("div", { class: "list-row-title" }, pr.name, pr.id === active ? h("span", { class: "badge" }, "Active") : null),
        h("div", { class: "list-row-sub" }, "Separate characters, chats, lore and stories")),
      h("button", { class: "btn ghost small", type: "button", onClick: async () => {
        const n = await promptDialog("Rename profile", { value: pr.name });
        if (n) { renameProfile(pr.id, n); drawProfiles(); }
      } }, "Rename"),
      pr.id !== active ? h("button", { class: "btn danger-ghost small", type: "button", onClick: async () => {
        if (await confirmDialog(`Everything in "${pr.name}" will be deleted.`, { title: "Delete profile?", ok: "Delete", danger: true })) { deleteProfile(pr.id); drawProfiles(); }
      } }, "Delete") : null)));
  };
  drawProfiles();

  /* ---- Backup ---- */
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
    title: "You", large: true,
    body: [
      section("About you", [
        field("Your name", name, "Characters call you this. It replaces {{user}} everywhere."),
        field("About you", persona, "Shared with every character, so they react to you, not a stranger."),
      ]),
      section("Look & feel", [
        field("Theme", segmented([["system", "Auto"], ["dark", "Dark"], ["light", "Light"]], p.theme, (v) => { updateProfile({ theme: v }); applyTheme(); })),
        field("Accent color", swatches),
        field("Reading font", segmented([["serif", "Bookish"], ["sans", "Clean"]], p.readingFont, (v) => { updateProfile({ readingFont: v }); applyTheme(); })),
        field("Text size", segmented([["s", "Small"], ["m", "Medium"], ["l", "Large"]], p.textSize, (v) => { updateProfile({ textSize: v }); applyTheme(); })),
        toggle(s.enterToSend, (v) => updateSettings({ enterToSend: v }), "Enter key sends messages"),
      ]),
      section("AI model", [
        h("p", { class: "muted small" }, "Runs entirely on your device — nothing you write ever leaves it. The model downloads once, then works offline."),
        gpuNote,
        modelList,
        h("div", { class: "row between" }, loadState, loadBtn),
        modelStatusCard({ onRetry: () => ensureEngine(getSettings().model).catch(() => {}) }),
        h("div", { class: "tone" },
          h("div", { class: "tone-head" }, h("span", { class: "tone-emoji" }, "🎲"), h("span", { class: "tone-label" }, "Creativity baseline"), tempVal),
          temp,
          h("div", { class: "tone-ends" }, h("span", {}, "Careful"), h("span", {}, "Chaotic"))),
        field("Your writing style", globalStyle, "Applied to every chat and story."),
        field("Swearing", segmented([["allow", "Allowed"], ["avoid", "Avoid"]], s.profanity, (v) => updateSettings({ profanity: v }))),
      ]),
      section("Profiles", [
        profileList,
        h("button", { class: "btn ghost", type: "button", onClick: async () => {
          const n = await promptDialog("New profile name", { placeholder: "e.g. Fantasy world" });
          if (n) { createProfile(n); toast(`Created ${n}`); }
        } }, icon("plus", 18), "New profile"),
      ]),
      section("Backup", [
        h("p", { class: "muted small" }, `Everything is stored in this browser (${storageUsedKB().toLocaleString()} KB used). Export a backup now and then — clearing site data would erase it.`),
        h("div", { class: "row wrap" },
          h("button", { class: "btn ghost", type: "button", onClick: () => downloadFile(JSON.stringify(exportAll(), null, 2), `my-writer-backup-${new Date().toISOString().slice(0, 10)}.json`) }, icon("download", 18), "Export backup"),
          h("button", { class: "btn ghost", type: "button", onClick: () => importInput.click() }, icon("upload", 18), "Restore backup"),
          importInput),
      ]),
      h("p", { class: "muted small center footer-note" }, "My Writer · private, on-device writing"),
    ],
  });
}

/* =========================================================
   writer.js — stories list and the story editor.
   ========================================================= */
import { h, icon, iconBtn, avatar, toast, sheet, confirmDialog, autosize, field, segmented, downloadFile, debounce, timeAgo } from "./ui.js";
import { page, empty, go, goBack, toneSliders, modelStatusCard } from "./layout.js";
import { lib, getStory, saveStory, newStory, deleteStory, getProfile, getSettings, getCharacter } from "./store.js";
import { buildStoryPrompt, temperatureFor } from "./prompts.js";
import { generate, stopGenerating, isBusy, ensureEngine } from "./ai.js";

const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/* ---------- List ---------- */
export function renderStories() {
  const stories = [...lib().stories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const create = () => go(`#/story/${newStory().id}`);

  const card = (s) => h("a", { class: "story-card", href: `#/story/${s.id}` },
    h("div", { class: "story-card-title" }, s.title || "Untitled story"),
    h("div", { class: "story-card-snip" }, (s.content || s.premise || "Nothing written yet.").slice(0, 180)),
    h("div", { class: "story-card-meta" },
      h("span", {}, `${words(s.content).toLocaleString()} words`),
      h("span", {}, timeAgo(s.updatedAt)),
      h("span", { class: "avatars-mini" }, s.castIds.map(getCharacter).filter(Boolean).slice(0, 4).map((c) => avatar(c, "xxs")))));

  return page({
    title: "Stories", large: true,
    actions: [h("button", { class: "btn primary small", type: "button", onClick: create }, icon("plus", 18), "New")],
    body: stories.length
      ? h("div", { class: "story-grid" }, stories.map(card))
      : empty("📝", "Write something", "Set up a premise, cast your characters, and write together a few hundred words at a time. You can edit anything the AI writes.",
        [h("button", { class: "btn primary", type: "button", onClick: create }, "Start a story")]),
  });
}

/* ---------- Editor ---------- */
export function renderStory(id) {
  const story = getStory(id);
  if (!story) return page({ title: "Not found", back: "#/write", body: empty("🫥", "This story doesn't exist anymore.") });
  const settings = getSettings();
  const profile = getProfile();
  const persist = debounce(() => saveStory(story), 500);

  const title = h("input", { class: "story-title", placeholder: "Untitled story", value: story.title, "aria-label": "Title",
    onInput: () => { story.title = title.value; persist(); } });

  const text = h("textarea", { class: "story-text", value: story.content, "aria-label": "Story text",
    placeholder: "Start writing here — or tap Write and let the AI open the story. Everything is editable.",
    onInput: () => { story.content = text.value; count(); persist(); } });
  const fitText = autosize(text);

  const counter = h("span", { class: "muted small" });
  const count = () => { counter.textContent = `${words(story.content).toLocaleString()} words`; };
  count();

  const direction = h("input", { class: "input", placeholder: "What happens next? (optional)", value: story.direction,
    onInput: () => { story.direction = direction.value; persist(); },
    onKeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); write(); } } });

  const writeBtn = h("button", { class: "btn primary", type: "button", onClick: () => (isBusy() ? stopGenerating() : write()) });
  const syncBtn = () => {
    const busy = isBusy();
    writeBtn.replaceChildren(icon(busy ? "stop" : "sparkles", 18), busy ? "Stop" : story.content.trim() ? "Continue" : "Write");
    writeBtn.classList.toggle("stop", busy);
    text.readOnly = busy;
  };
  syncBtn();

  const castRow = h("div", { class: "cast-row" });
  const drawCast = () => {
    const cast = story.castIds.map(getCharacter).filter(Boolean);
    castRow.replaceChildren(
      ...cast.map((c) => h("span", { class: "cast-chip" }, avatar(c, "xxs"), c.name)),
      h("button", { class: "chip-btn", type: "button", onClick: openSetup }, icon("sliders", 15), cast.length ? "Setup" : "Setup & cast"));
  };
  drawCast();

  const status = modelStatusCard({ onRetry: () => ensureEngine(settings.model).catch(() => {}) });
  const scroller = h("div", { class: "view-body" }, h("div", { class: "container narrow" }, title, castRow, text));
  const dock = h("div", { class: "story-dock" }, status, h("div", { class: "row" }, direction, writeBtn), h("div", { class: "row between" }, counter, h("span", { class: "muted small" }, "Edits save automatically")));

  async function write() {
    if (isBusy()) { toast("Still writing… stop it first."); return; }
    navigator.storage?.persist?.().catch(() => {});
    const continuing = !!story.content.trim();
    const cast = story.castIds.map(getCharacter).filter(Boolean);
    const prompt = buildStoryPrompt({ story, cast, profile, settings, lore: lib().lore, continuing });
    const base = story.content.replace(/\s+$/, "");
    const sep = base ? "\n\n" : "";
    syncBtn();
    try {
      const promise = generate({
        modelKey: settings.model,
        messages: prompt.messages,
        maxTokens: prompt.maxTokens,
        temperature: temperatureFor(settings.temp, story.tone),
        onText: (t) => {
          story.content = base + sep + t.replace(/^\s+/, "");
          text.value = story.content; fitText(); count();
          scroller.scrollTop = scroller.scrollHeight;
        },
      });
      syncBtn();
      await promise;
      story.direction = ""; direction.value = "";
    } catch (err) {
      toast(err.message, { type: "error", ms: 5000 });
    } finally {
      saveStory(story);
      if (text.isConnected) { syncBtn(); count(); }
    }
  }

  function openSetup() {
    const premise = h("textarea", { class: "input", rows: 4, value: story.premise,
      placeholder: "What's this story about? Setting, situation, the arc you want, key beats…",
      onInput: () => { story.premise = premise.value; persist(); } });
    const style = h("textarea", { class: "input", rows: 2, value: story.style,
      placeholder: "e.g. Lyrical but punchy. Lots of dialogue. Short chapters.",
      onInput: () => { story.style = style.value; persist(); } });
    autosize(premise, 300); autosize(style, 200);

    const chars = lib().characters;
    const castPicker = chars.length
      ? h("div", { class: "cast-pick" }, chars.map((c) => {
        const on = () => story.castIds.includes(c.id);
        const b = h("button", { class: `cast-opt ${on() ? "on" : ""}`, type: "button", "aria-pressed": String(on()),
          onClick: () => {
            story.castIds = on() ? story.castIds.filter((x) => x !== c.id) : [...story.castIds, c.id];
            b.classList.toggle("on", on()); b.setAttribute("aria-pressed", String(on())); persist();
          } }, avatar(c, "sm"), h("span", {}, c.name), icon("check", 16));
        return b;
      }))
      : h("p", { class: "muted" }, "No characters yet — you can still write without a cast.");

    sheet({
      title: "Story setup",
      body: h("div", { class: "form" },
        field("Premise & outline", premise, "The AI re-reads this every time it writes, so it's a good place for your plan."),
        h("div", { class: "field" }, h("span", { class: "field-label" }, "Cast"), h("span", { class: "field-hint" }, "Their personalities and voices are included so they sound like themselves."), castPicker),
        field("Point of view", segmented([["first", "1st · I"], ["second", "2nd · You"], ["third", "3rd · They"]], story.pov, (v) => { story.pov = v; persist(); })),
        field("Tense", segmented([["past", "Past"], ["present", "Present"]], story.tense, (v) => { story.tense = v; persist(); })),
        field("Each time, write", segmented([["short", "~300 words"], ["medium", "~600"], ["long", "~1,000"]], story.chunk, (v) => { story.chunk = v; persist(); })),
        field("Style", style),
        h("div", { class: "field-label" }, "Tone"),
        toneSliders(story.tone, persist)),
      onClose: () => { saveStory(story); drawCast(); },
    });
  }

  function openMenu() {
    const item = (ic, label, fn, cls = "") => h("button", { class: `menu-item ${cls}`, type: "button", onClick: () => { s.close(); fn(); } }, icon(ic, 20), h("span", {}, label));
    const s = sheet({
      title: story.title || "Untitled story",
      body: h("div", { class: "menu" },
        item("sliders", "Setup & cast", openSetup),
        item("download", "Export as .txt", () => downloadFile(`${story.title || "Untitled"}\n\n${story.content}`, `${(story.title || "story").replace(/[^\w-]+/g, "_")}.txt`, "text/plain")),
        item("copy", "Copy all text", () => { navigator.clipboard?.writeText(story.content); toast("Copied"); }),
        item("trash", "Delete story", async () => {
          if (await confirmDialog("This story will be gone for good.", { title: "Delete story?", ok: "Delete", danger: true })) {
            deleteStory(story.id); location.replace("#/write");
          }
        }, "danger")),
    });
  }

  const top = h("header", { class: "topbar" },
    iconBtn("back", "Back", () => goBack("#/write"), "ghost back-btn"),
    h("div", { class: "topbar-title" }, h("h1", {}, "Story")),
    h("div", { class: "topbar-actions" }, iconBtn("sliders", "Setup & cast", openSetup, "ghost"), iconBtn("more", "More", openMenu, "ghost")));

  // brand new story → open setup right away so it's obvious where to start
  if (!story.content.trim() && !story.premise.trim()) setTimeout(openSetup, 250);

  const view = h("section", { class: "view story" }, top, scroller, dock);
  view.onLeave = () => saveStory(story);
  return view;
}

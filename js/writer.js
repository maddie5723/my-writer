/* =========================================================
   writer.js — stories list and the story editor.
   ========================================================= */
import { h, icon, iconBtn, avatar, toast, sheet, confirmDialog, autosize, field, segmented, downloadFile, debounce, timeAgo, popover, tabs, setKids } from "./ui.js";
import { page, empty, go, goBack, replaceTo, toneSliders, modelStatusCard } from "./layout.js";
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
    actions: [iconBtn("plus", "New story", create, "ghost")],
    body: stories.length
      ? h("div", { class: "story-list" }, stories.map(card))
      : empty("📝", "Write something", "Set up a premise, cast your characters, and write together a few hundred words at a time. You can edit anything the AI writes.",
        [h("button", { class: "btn primary wide", type: "button", onClick: create }, "Start a story")]),
  });
}

/* ---------- Editor ---------- */
export function renderStory(id) {
  const story = getStory(id);
  if (!story) return page({ title: "Not found", back: "#/stories", body: empty("🫥", "This story doesn't exist anymore.") });
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
    setKids(castRow, 
      ...cast.map((c) => h("span", { class: "cast-chip" }, avatar(c, "xxs"), c.name)),
      h("button", { class: "chip-btn", type: "button", onClick: () => openSetup(cast.length ? 0 : 1) }, icon("sliders", 15), cast.length ? "Setup" : "Add cast & plot"));
  };
  drawCast();

  const status = modelStatusCard({ onRetry: () => ensureEngine(settings.model).catch(() => {}) });
  const scroller = h("div", { class: "view-body" }, h("div", { class: "container narrow" }, title, castRow, text));
  const dock = h("div", { class: "story-dock" }, status, h("div", { class: "row" }, direction, writeBtn), h("div", { class: "row between dock-meta" }, counter, h("span", {}, "Saves automatically")));

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
        settings,
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

  function openSetup(startTab = 0) {
    const plot = () => {
      const premise = h("textarea", { class: "input", rows: 5, value: story.premise,
        placeholder: "What's this story about? Setting, situation, the arc, key beats…",
        onInput: () => { story.premise = premise.value; persist(); } });
      autosize(premise, 300);
      return h("div", { class: "form" }, field("Premise & outline", premise, "The AI re-reads this every time it writes."));
    };
    const castTab = () => {
      const chars = lib().characters;
      if (!chars.length) return h("p", { class: "muted" }, "No characters yet. You can still write without a cast.");
      return h("div", { class: "form" }, h("div", { class: "field-hint" }, "Picked characters keep their personality and voice in the story."),
        h("div", { class: "cast-pick" }, chars.map((c) => {
          const on = () => story.castIds.includes(c.id);
          const b = h("button", { class: `cast-opt ${on() ? "on" : ""}`, type: "button", "aria-pressed": String(on()),
            onClick: () => {
              story.castIds = on() ? story.castIds.filter((x) => x !== c.id) : [...story.castIds, c.id];
              b.classList.toggle("on", on()); b.setAttribute("aria-pressed", String(on())); persist();
            } }, avatar(c, "sm"), h("span", {}, c.name), icon("check", 18));
          return b;
        })));
    };
    const format = () => {
      const style = h("textarea", { class: "input", rows: 2, value: story.style,
        placeholder: "e.g. Lyrical but punchy. Lots of dialogue.",
        onInput: () => { story.style = style.value; persist(); } });
      autosize(style, 200);
      return h("div", { class: "form" },
        field("Point of view", segmented([["first", "I"], ["second", "You"], ["third", "They"]], story.pov, (v) => { story.pov = v; persist(); })),
        field("Tense", segmented([["past", "Past"], ["present", "Present"]], story.tense, (v) => { story.tense = v; persist(); })),
        field("Each time, write", segmented([["short", "~300 words"], ["medium", "~600"], ["long", "~1,000"]], story.chunk, (v) => { story.chunk = v; persist(); })),
        field("Style", style));
    };
    const toneTab = () => h("div", { class: "form" }, toneSliders(story.tone, persist, { chat: false }));
    const t = tabs([{ label: "Plot", render: plot }, { label: "Cast", render: castTab }, { label: "Format", render: format }, { label: "Tone", render: toneTab }], startTab);
    sheet({ title: "Story setup", body: h("div", {}, t.bar, t.panel), onClose: () => { saveStory(story); drawCast(); } });
  }

  function openMenu(anchor) {
    popover(anchor, [
      { label: "Setup & cast", icon: "sliders", onClick: () => openSetup(0) },
      { label: "Lorebook", icon: "book", onClick: () => go("#/lore") },
      { label: "Copy all text", icon: "copy", onClick: () => { navigator.clipboard?.writeText(story.content); toast("Copied"); } },
      { label: "Export as .txt", icon: "download", onClick: () => downloadFile(`${story.title || "Untitled"}\n\n${story.content}`, `${(story.title || "story").replace(/[^\w-]+/g, "_")}.txt`, "text/plain") },
      "-",
      { label: "Delete story", icon: "trash", danger: true, onClick: async () => {
        if (await confirmDialog("This story will be gone for good.", { title: "Delete story?", ok: "Delete", danger: true })) {
          deleteStory(story.id); replaceTo("#/stories");
        }
      } },
    ]);
  }

  const top = h("header", { class: "topbar" },
    iconBtn("back", "Back", () => goBack("#/stories"), "ghost back-btn"),
    h("div", { class: "topbar-title" }, h("h1", {}, story.title || "Story")),
    h("div", { class: "topbar-actions" }, iconBtn("more", "More", (e) => openMenu(e.currentTarget), "ghost")));


  const view = h("section", { class: "view story" }, top, scroller, dock);
  view.onLeave = () => saveStory(story);
  return view;
}

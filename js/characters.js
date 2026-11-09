/* =========================================================
   characters.js — character grid, profile page and editor.
   ========================================================= */
import { h, icon, iconBtn, avatar, toast, confirmDialog, field, autosize, imageToDataURL, downloadFile, timeAgo, popover, tabs } from "./ui.js";
import { page, empty, go, goBack, replaceTo, toneSliders } from "./layout.js";
import {
  lib, getCharacter, saveCharacter, deleteCharacter, chatsFor, createChat, deleteChat,
  normalizeCharacter, sampleCharacter, getProfile, msgText, DEFAULT_BOUNDARIES,
} from "./store.js";
import { fill } from "./prompts.js";

/* ---------- Start (or continue) a chat ---------- */
export function startNewChat(ch) {
  const greeting = ch.greeting?.trim() ? fill(ch.greeting, ch.name, getProfile().name || "User") : "";
  const chat = createChat(ch, greeting);
  go(`#/chat/${chat.id}`);
}
export function openLatestChat(ch) {
  const latest = chatsFor(ch.id)[0];
  if (latest) go(`#/chat/${latest.id}`); else startNewChat(ch);
}

export function addSampleCharacter() {
  const ch = saveCharacter(normalizeCharacter(sampleCharacter()));
  toast(`Say hi to ${ch.name} 👋`);
  go(`#/c/${ch.id}`);
}

/* ---------- Grid ---------- */
export function renderCharacters() {
  const chars = lib().characters;
  const fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, onChange: (e) => importCard(e.target.files?.[0]) });

  const card = (ch) => h("a", { class: "pcard", href: `#/c/${ch.id}` },
    avatar(ch, "fill"),
    h("div", { class: "pcard-shade" }),
    h("div", { class: "pcard-text" },
      h("div", { class: "pcard-name" }, ch.name),
      ch.summary ? h("div", { class: "pcard-sum" }, ch.summary) : null));

  const more = iconBtn("more", "More", (e) => popover(e.currentTarget, [
    { label: "New character", icon: "plus", onClick: () => go("#/c/new") },
    { label: "Import character card", icon: "upload", onClick: () => fileInput.click() },
    { label: "Add sample (Wren)", icon: "sparkles", onClick: addSampleCharacter },
  ]), "ghost");

  const grid = h("div", { class: "pgrid" }, chars.map(card));
  let search = null;
  if (chars.length > 6) {
    search = h("input", {
      class: "input search", type: "search", placeholder: "Search",
      onInput: () => {
        const q = search.value.toLowerCase();
        [...grid.children].forEach((el, i) => { el.hidden = !(`${chars[i].name} ${chars[i].summary} ${chars[i].tags.join(" ")}`.toLowerCase().includes(q)); });
      },
    });
  }

  return page({
    title: "Characters", large: true,
    actions: [iconBtn("plus", "New character", () => go("#/c/new"), "ghost"), more, fileInput],
    body: chars.length ? [search, grid]
      : empty("🃏", "No characters yet", "Characters are who you chat and write with.",
        [h("a", { class: "btn primary wide", href: "#/c/new" }, "Create a character"),
          h("button", { class: "btn ghost wide", type: "button", onClick: addSampleCharacter }, "Meet Wren (sample)")]),
  });
}

async function importCard(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const d = raw.data && raw.spec ? raw.data : raw; // our export or "character card v2"
    const saved = saveCharacter(normalizeCharacter({
      name: d.name,
      avatar: d.avatar?.startsWith?.("data:") ? d.avatar : "",
      summary: d.summary || d.creator_notes || "",
      tags: d.tags,
      personality: [d.personality, d.description && !d.summary ? d.description : ""].filter(Boolean).join("\n\n"),
      speech: d.speech || "",
      examples: d.examples || (d.mes_example || "").replace(/<START>/gi, "").trim(),
      appearance: d.appearance || "",
      scenario: d.scenario || "",
      greeting: d.greeting || d.first_mes || "",
      boundaries: d.boundaries,
      style: d.style || d.system_prompt || "",
      defaults: d.defaults,
    }));
    toast(`Imported ${saved.name}`);
    go(`#/c/${saved.id}`);
  } catch {
    toast("That file isn't a character card I can read.", { type: "error" });
  }
}

/* ---------- Profile ---------- */
export function renderCharacter(id) {
  const ch = getCharacter(id);
  if (!ch) return page({ title: "Not found", back: "#/characters", body: empty("🫥", "This character doesn't exist anymore.") });
  const chats = chatsFor(ch.id);

  const menu = (btn) => popover(btn, [
    { label: "New chat", icon: "plus", onClick: () => startNewChat(ch) },
    { label: "Edit", icon: "edit", onClick: () => go(`#/c/${ch.id}/edit`) },
    { label: "Export card", icon: "download", onClick: () => downloadFile(JSON.stringify({ app: "my-writer", type: "character", ...ch }, null, 2), `${ch.name.replace(/[^\w-]+/g, "_")}.character.json`) },
    "-",
    { label: "Delete character", icon: "trash", danger: true, onClick: async () => {
      if (await confirmDialog(`${ch.name} and all of their chats will be deleted.`, { title: `Delete ${ch.name}?`, ok: "Delete", danger: true })) {
        deleteCharacter(ch.id); toast("Deleted"); replaceTo("#/characters");
      }
    } },
  ]);

  const hero = h("div", { class: "profile" },
    avatar(ch, "xl"),
    h("h1", { class: "profile-name" }, ch.name),
    ch.summary ? h("p", { class: "profile-sum" }, ch.summary) : null,
    ch.tags.length ? h("div", { class: "chips center" }, ch.tags.map((t) => h("span", { class: "chip" }, t))) : null,
    h("div", { class: "profile-actions" },
      h("button", { class: "btn primary grow", type: "button", onClick: () => openLatestChat(ch) }, icon("message", 18), "Message"),
      h("a", { class: "btn ghost", href: `#/c/${ch.id}/edit` }, "Edit")));

  const about = [
    ["Personality", ch.personality], ["How they talk", ch.speech], ["Scenario", ch.scenario],
  ].filter(([, v]) => v?.trim());

  const chatRow = (c) => {
    const last = c.messages[c.messages.length - 1];
    const row = h("div", { class: "convo-wrap" },
      h("a", { class: "convo", href: `#/chat/${c.id}` },
        h("div", { class: "convo-text" },
          h("div", { class: "convo-top" }, h("b", {}, `${c.messages.length} message${c.messages.length === 1 ? "" : "s"}`), h("span", {}, timeAgo(c.updatedAt))),
          h("div", { class: "convo-last" }, last ? msgText(last).replace(/[*]/g, "").slice(0, 120) : "Empty chat"))),
      iconBtn("more", "Chat options", (e) => popover(e.currentTarget, [
        { label: "Delete chat", icon: "trash", danger: true, onClick: async () => {
          if (await confirmDialog("This conversation will be gone for good.", { title: "Delete chat?", ok: "Delete", danger: true })) { deleteChat(c.id); row.remove(); toast("Chat deleted"); }
        } },
      ]), "ghost"));
    return row;
  };

  return page({
    title: ch.name, back: "#/characters", cls: "profile-view",
    actions: [iconBtn("more", "More", (e) => menu(e.currentTarget), "ghost")],
    body: [
      hero,
      about.length ? h("div", { class: "group about" }, about.map(([k, v]) =>
        h("div", { class: "about-item" }, h("div", { class: "about-k" }, k), h("div", { class: "about-v" }, fill(v, ch.name, getProfile().name || "you"))))) : null,
      chats.length ? h("div", { class: "group-title" }, "Chats") : null,
      chats.length ? h("div", { class: "group" }, chats.map(chatRow)) : null,
    ],
  });
}

/* ---------- Editor (tabbed, short screens) ---------- */
export function renderCharacterEditor(id) {
  const existing = id ? getCharacter(id) : null;
  if (id && !existing) return page({ title: "Not found", back: "#/characters", body: empty("🫥", "This character doesn't exist anymore.") });
  const draft = structuredClone(existing || normalizeCharacter({ name: "" }));
  if (!existing) draft.name = "";
  let dirty = false;
  const markDirty = () => { dirty = true; };

  const ta = (key, placeholder, rows = 3) => {
    const t = h("textarea", { class: "input", rows, placeholder, value: draft[key] || "", onInput: () => { draft[key] = t.value; markDirty(); } });
    autosize(t, 420);
    return t;
  };

  const tip = (text) => h("div", { class: "tip" }, icon("sparkles", 16), h("span", {}, text));

  const basics = () => {
    const slot = h("div", { class: "avatar-slot" });
    const fileInput = h("input", {
      type: "file", accept: "image/*", hidden: true,
      onChange: async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { draft.avatar = await imageToDataURL(f); markDirty(); draw(); } catch (err) { toast(err.message, { type: "error" }); }
      },
    });
    const draw = () => slot.replaceChildren(...[
      h("button", { class: "avatar-pick", type: "button", onClick: () => fileInput.click(), "aria-label": "Choose picture" },
        avatar({ name: draft.name || "?", avatar: draft.avatar }, "xl"),
        h("span", { class: "avatar-pick-badge" }, icon("image", 16))),
      h("button", { class: "link", type: "button", onClick: () => (draft.avatar ? (draft.avatar = "", markDirty(), draw()) : fileInput.click()) }, draft.avatar ? "Remove photo" : "Add photo"),
      fileInput].filter(Boolean));
    draw();
    const name = h("input", { class: "input", placeholder: "Name", value: draft.name, onInput: () => { draft.name = name.value; markDirty(); if (!draft.avatar) draw(); } });
    const tags = h("input", { class: "input", placeholder: "slow burn, rivals, fantasy", value: draft.tags.join(", "),
      onInput: () => { draft.tags = tags.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); } });
    return h("div", { class: "form" },
      slot,
      field("Name", name),
      field("Tagline", ta("summary", "Who they are at a glance, in a line or two.", 2), "Shown on their card. It's also the first thing the AI reads."),
      field("Tags", tags, "Optional, just to keep things organized."));
  };

  const personality = () => h("div", { class: "form" },
    field("Personality", ta("personality", "Traits, wants, fears, quirks, flaws…", 4),
      "Be specific. \"Teases people she likes, goes quiet when hurt\" beats \"nice and funny\"."),
    field("How they talk", ta("speech", "Slang, sentence length, accent, swearing, pet names, things they'd never say…", 3),
      "Keeps their voice consistent. The AI is reminded of this every message."),
    field("Example lines", ta("examples", "{{char}}: *doesn't look up* We're closed.\n{{user}}: The sign says open.\n{{char}}: The sign is an optimist.", 5),
      "The #1 way to make them sound like themselves. {{char}} = them, {{user}} = you."),
    field("Appearance", ta("appearance", "Looks, style, how they move…", 2)));

  const story = () => h("div", { class: "form" },
    tip("{{user}} turns into your name (set it in Me → Profile), so they always know who they're talking to."),
    field("Scenario", ta("scenario", "Who are you to them? Where does it start? What's the tension?", 3)),
    field("First message", ta("greeting", "*She glances up as the door opens.* You're late.", 3),
      "What they say when a new chat starts. Sets the tone and style."));

  const tone = () => h("div", { class: "form" },
    h("div", { class: "field-hint" }, "Starting tone for new chats. You can still change it in any chat."),
    toneSliders(draft.defaults, markDirty),
    field("Boundaries", ta("boundaries", DEFAULT_BOUNDARIES, 2), "Rules they always follow."),
    field("Writing style", ta("style", "e.g. Short punchy replies, lots of subtext.", 2), "Optional."));

  const t = tabs([
    { label: "Basics", render: basics },
    { label: "Personality", render: personality },
    { label: "Story", render: story },
    { label: "Tone", render: tone },
  ]);

  function save({ quiet = false } = {}) {
    if (!draft.name.trim()) {
      if (!quiet) { toast("Give them a name first", { type: "error" }); t.select(0); }
      return null;
    }
    const saved = saveCharacter(draft);
    dirty = false;
    if (!quiet) toast("Saved");
    return saved;
  }
  async function cancel() {
    if (dirty && !(await confirmDialog("Your changes won't be saved.", { title: "Discard changes?", ok: "Discard", danger: true }))) return;
    dirty = false;
    goBack(existing ? `#/c/${existing.id}` : "#/characters");
  }

  const view = page({
    title: existing ? "Edit" : "New character",
    left: h("button", { class: "text-btn", type: "button", onClick: cancel }, "Cancel"),
    actions: [h("button", { class: "text-btn strong", type: "button", onClick: () => { const s = save(); if (s) replaceTo(`#/c/${s.id}`); } }, "Save")],
    under: t.bar,
    body: t.panel,
    cls: "editor",
  });
  // leaving another way (system back) quietly keeps the work
  view.onLeave = () => { if (dirty && save({ quiet: true })) toast("Changes saved"); };
  return view;
}

/* =========================================================
   characters.js — character list, profile page and editor.
   ========================================================= */
import { h, icon, iconBtn, avatar, toast, confirmDialog, field, autosize, imageToDataURL, downloadFile, timeAgo } from "./ui.js";
import { page, section, empty, go, goBack, toneSliders } from "./layout.js";
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

/* ---------- List ---------- */
export function renderCharacters() {
  const chars = lib().characters;
  const fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, onChange: (e) => importCard(e.target.files?.[0]) });

  const card = (ch) => h("a", { class: "char-card", href: `#/c/${ch.id}` },
    h("div", { class: "char-card-art" }, avatar(ch, "fill")),
    h("div", { class: "char-card-text" },
      h("div", { class: "char-card-name" }, ch.name),
      ch.summary ? h("div", { class: "char-card-sum" }, ch.summary) : null));

  const grid = h("div", { class: "char-grid" },
    chars.map(card),
    h("a", { class: "char-card new", href: "#/c/new" }, icon("plus", 28), h("span", {}, "New character")));

  let search = null;
  if (chars.length > 6) {
    search = h("input", {
      class: "input search", type: "search", placeholder: "Search characters…",
      onInput: () => {
        const q = search.value.toLowerCase();
        [...grid.children].forEach((el, i) => {
          const c = chars[i];
          if (c) el.hidden = !(`${c.name} ${c.summary} ${c.tags.join(" ")}`.toLowerCase().includes(q));
        });
      },
    });
  }

  const body = chars.length
    ? [search, grid]
    : empty("🃏", "No characters yet",
      "Characters are who you chat and write with. Make your own, or start with a sample to see what a well-filled card looks like.",
      [h("a", { class: "btn primary", href: "#/c/new" }, "Create a character"),
        h("button", { class: "btn ghost", type: "button", onClick: addSampleCharacter }, "Meet Wren (sample)")]);

  return page({
    title: "Characters", large: true,
    actions: [iconBtn("upload", "Import character card", () => fileInput.click(), "ghost"), fileInput],
    body,
  });
}

async function importCard(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    // Accept our own export or the common "character card v2" JSON shape
    const d = raw.data && raw.spec ? raw.data : raw;
    const ch = normalizeCharacter({
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
    });
    ch.id = undefined;
    const saved = saveCharacter(normalizeCharacter(ch));
    toast(`Imported ${saved.name}`);
    go(`#/c/${saved.id}`);
  } catch {
    toast("That file isn't a character card I can read.", { type: "error" });
  }
}

/* ---------- Profile page ---------- */
export function renderCharacter(id) {
  const ch = getCharacter(id);
  if (!ch) return page({ title: "Not found", back: "#/characters", body: empty("🫥", "This character doesn't exist anymore.") });

  const chats = chatsFor(ch.id);
  const hero = h("div", { class: "char-hero" },
    avatar(ch, "xl"),
    h("h1", { class: "display" }, ch.name),
    ch.summary ? h("p", { class: "muted center" }, ch.summary) : null,
    ch.tags.length ? h("div", { class: "chips center" }, ch.tags.map((t) => h("span", { class: "chip" }, t))) : null,
    h("div", { class: "row center wrap" },
      h("button", { class: "btn primary", type: "button", onClick: () => openLatestChat(ch) }, icon("message", 18), chats.length ? "Continue chat" : "Start chatting"),
      chats.length ? h("button", { class: "btn ghost", type: "button", onClick: () => startNewChat(ch) }, icon("plus", 18), "New chat") : null,
      h("a", { class: "btn ghost", href: `#/c/${ch.id}/edit` }, icon("edit", 18), "Edit")));

  const chatRow = (c) => {
    const last = c.messages[c.messages.length - 1];
    const row = h("div", { class: "list-row" },
      h("a", { class: "list-row-main", href: `#/chat/${c.id}` },
        h("div", { class: "list-row-title" }, `${c.messages.length} message${c.messages.length === 1 ? "" : "s"} · ${timeAgo(c.updatedAt)}`),
        h("div", { class: "list-row-sub" }, last ? msgText(last).slice(0, 140) : "Empty chat")),
      iconBtn("trash", "Delete chat", async () => {
        if (await confirmDialog("This conversation will be gone for good.", { title: "Delete chat?", ok: "Delete", danger: true })) {
          deleteChat(c.id); row.remove(); toast("Chat deleted");
        }
      }, "ghost"));
    return row;
  };

  return page({
    title: "", back: "#/characters",
    actions: [iconBtn("download", "Export character card", () => exportCard(ch), "ghost")],
    body: [hero, chats.length ? section("Conversations", h("div", { class: "list" }, chats.map(chatRow))) : null],
  });
}

function exportCard(ch) {
  downloadFile(JSON.stringify({ app: "my-writer", type: "character", ...ch }, null, 2), `${ch.name.replace(/[^\w-]+/g, "_")}.character.json`);
}

/* ---------- Editor ---------- */
export function renderCharacterEditor(id) {
  const existing = id ? getCharacter(id) : null;
  if (id && !existing) return page({ title: "Not found", back: "#/characters", body: empty("🫥", "This character doesn't exist anymore.") });
  const draft = structuredClone(existing || normalizeCharacter({ name: "" }));
  if (!existing) draft.name = "";
  let dirty = false;
  const markDirty = () => { dirty = true; };

  const ta = (key, placeholder, rows = 3) => {
    const t = h("textarea", { class: "input", rows, placeholder, value: draft[key] || "", onInput: () => { draft[key] = t.value; markDirty(); } });
    autosize(t, 520);
    return t;
  };
  const inp = (key, placeholder) => {
    const i = h("input", { class: "input", placeholder, value: draft[key] || "", onInput: () => { draft[key] = i.value; markDirty(); } });
    return i;
  };

  // Avatar picker
  const avatarSlot = h("div", { class: "avatar-slot" });
  const fileInput = h("input", {
    type: "file", accept: "image/*", hidden: true,
    onChange: async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try { draft.avatar = await imageToDataURL(f); markDirty(); drawAvatar(); } catch (err) { toast(err.message, { type: "error" }); }
    },
  });
  const drawAvatar = () => avatarSlot.replaceChildren(...[
    h("button", { class: "avatar-pick", type: "button", onClick: () => fileInput.click(), "aria-label": "Choose picture" },
      avatar({ name: draft.name || "?", avatar: draft.avatar }, "xl"),
      h("span", { class: "avatar-pick-badge" }, icon("image", 16))),
    draft.avatar ? h("button", { class: "link", type: "button", onClick: () => { draft.avatar = ""; markDirty(); drawAvatar(); } }, "Remove picture") : null,
    fileInput].filter(Boolean));
  drawAvatar();

  const nameInput = inp("name", "e.g. Wren Calloway");
  nameInput.addEventListener("input", () => { if (!draft.avatar) drawAvatar(); });
  const tagsInput = h("input", { class: "input", placeholder: "slow burn, rivals, fantasy", value: draft.tags.join(", "),
    onInput: () => { draft.tags = tagsInput.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); } });

  const tip = (text) => h("div", { class: "tip" }, icon("sparkles", 16), h("span", {}, text));

  const form = h("div", { class: "form" },
    avatarSlot,
    section("The basics", [
      field("Name", nameInput),
      field("Tagline", ta("summary", "One or two lines: who they are at a glance.", 2), "Shown on their card, and it's the first thing the AI reads about them."),
      field("Tags", tagsInput, "Just for you, to organize. Separate with commas."),
    ]),
    section("Who they are", [
      field("Personality", ta("personality", "Core traits, what they want, what they're afraid of, quirks, flaws, how they treat people they like vs. don't.", 4),
        "Be specific. \"Teases people she likes, goes quiet when hurt\" beats \"nice and funny\"."),
      field("How they talk", ta("speech", "Sentence length, slang, accent, swearing, pet names, verbal tics, what they'd NEVER say.", 3),
        "This keeps their voice consistent. It's also reminded to the AI on every message."),
      field("Example lines", ta("examples", "{{char}}: *doesn't look up* We're closed.\n{{user}}: The sign says open.\n{{char}}: The sign is an optimist.", 5),
        "The #1 thing that makes them sound like themselves. Write 2–6 lines exactly how they'd say them. Use {{char}} for them and {{user}} for you."),
      field("Appearance", ta("appearance", "Looks, style, how they move, what they smell like…", 2)),
    ]),
    section("Your story together", [
      tip("{{user}} becomes your name from Settings → You, so the character always knows who they're talking to."),
      field("Scenario", ta("scenario", "Who are you to them? Where and when does this start? What's the tension?", 3),
        "Sets the scene so the first replies don't feel random."),
      field("Opening message", ta("greeting", "*She glances up as the door opens.* You're late.", 3),
        "Their first message in every new chat. It sets the tone and shows the AI the style to follow."),
    ]),
    section("Tone & rules", [
      h("div", { class: "field-label" }, "Default tone for new chats"),
      toneSliders(draft.defaults, markDirty),
      field("Boundaries", ta("boundaries", DEFAULT_BOUNDARIES, 2), "Hard rules this character always follows."),
      field("Writing style (optional)", ta("style", "e.g. Slow-burn, lots of subtext, short punchy replies.", 2), "Overrides for how this character's replies are written."),
    ]),
    existing ? h("button", { class: "btn danger-ghost wide", type: "button", onClick: remove }, icon("trash", 18), `Delete ${existing.name}`) : null);

  function save({ quiet = false } = {}) {
    if (!draft.name.trim()) { if (!quiet) { toast("Give them a name first", { type: "error" }); nameInput.focus(); } return null; }
    const saved = saveCharacter(draft);
    dirty = false;
    if (!quiet) toast("Saved");
    return saved;
  }
  async function remove() {
    if (await confirmDialog(`${existing.name} and all of their chats will be deleted.`, { title: "Delete character?", ok: "Delete", danger: true })) {
      deleteCharacter(existing.id); dirty = false; toast("Deleted"); location.replace("#/characters");
    }
  }
  async function back() {
    if (dirty && !(await confirmDialog("You have unsaved changes.", { title: "Leave without saving?", ok: "Discard", danger: true }))) return;
    dirty = false;
    goBack(existing ? `#/c/${existing.id}` : "#/characters");
  }

  const view = page({
    title: existing ? "Edit character" : "New character",
    actions: [h("button", { class: "btn primary small", type: "button", onClick: () => { const s = save(); if (s) location.replace(`#/c/${s.id}`); } }, "Save")],
    body: form,
  });
  // custom back so we can warn about unsaved changes
  view.querySelector(".topbar").prepend(iconBtn("back", "Back", back, "ghost back-btn"));
  // leaving another way (system back, tab bar) quietly keeps the work
  view.onLeave = () => { if (dirty && save({ quiet: true })) toast("Changes saved"); };
  return view;
}

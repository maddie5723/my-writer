/* =========================================================
   chat.js — full-screen chat with a character.
   ========================================================= */
import { h, icon, iconBtn, avatar, formatRP, toast, sheet, confirmDialog, autosize, field, segmented, downloadFile, debounce } from "./ui.js";
import { go, goBack, empty, page, toneSliders, modelStatusCard } from "./layout.js";
import { getChat, getCharacter, getProfile, getSettings, lib, touchChat, deleteChat, normalizeMessage, msgText } from "./store.js";
import { buildChatPrompt, cleanReply, temperatureFor } from "./prompts.js";
import { generate, stopGenerating, isBusy, onStatus, ensureEngine } from "./ai.js";
import { startNewChat } from "./characters.js";

export function renderChat(chatId) {
  const chat = getChat(chatId);
  const ch = chat && getCharacter(chat.characterId);
  if (!chat || !ch) return page({ title: "Chat not found", back: "#/home", body: empty("🫥", "This chat doesn't exist anymore.") });

  const profile = getProfile();
  const settings = getSettings();
  const userName = profile.name?.trim() || "User";
  let activeMsgId = null;     // message whose action bar is open
  let editingId = null;       // message being edited
  let streamingId = null;     // message currently being written
  const seen = new Set();     // messages already on screen (so only new ones animate in)
  const view = h("section", { class: "view chat" });

  /* ---------- Top bar ---------- */
  const subline = h("div", { class: "topbar-sub" }, ch.summary ? ch.summary.slice(0, 60) : "");
  const top = h("header", { class: "topbar chat-top" },
    iconBtn("back", "Back", () => goBack(`#/c/${ch.id}`), "ghost back-btn"),
    h("a", { class: "chat-who", href: `#/c/${ch.id}` }, avatar(ch, "sm"),
      h("div", { class: "topbar-title" }, h("h1", {}, ch.name), subline)),
    h("div", { class: "topbar-actions" },
      iconBtn("sliders", "Scene & tone", openScene, "ghost"),
      iconBtn("more", "More", openMenu, "ghost")));

  const setSub = (text, live = false) => { subline.textContent = text; subline.classList.toggle("live", live); };
  const idleSub = () => setSub(chat.mode === "texting" ? "Texting" : (ch.summary || "").slice(0, 60));
  idleSub();

  /* ---------- Message list ---------- */
  const list = h("div", { class: "messages", role: "log", "aria-live": "polite" });
  const intro = h("div", { class: "chat-intro" }, avatar(ch, "lg"), h("div", { class: "chat-intro-name" }, ch.name),
    ch.scenario ? h("div", { class: "chat-intro-scn" }, ch.scenario.replace(/\{\{\s*user\s*\}\}/gi, userName).replace(/\{\{\s*char\s*\}\}/gi, ch.name).slice(0, 220)) : null);
  const status = modelStatusCard({ onRetry: () => ensureEngine(settings.model).catch(() => {}) });
  const scroller = h("div", { class: "chat-scroll" }, h("div", { class: "chat-inner" }, intro, list));

  let stick = true;
  scroller.addEventListener("scroll", () => {
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }, { passive: true });
  const toBottom = (force = false) => { if (force || stick) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; }); };

  function bubblesFor(m) {
    const text = msgText(m);
    if (!text && m.id === streamingId) return [h("div", { class: "bubble typing", "aria-label": `${ch.name} is typing` }, h("i"), h("i"), h("i"))];
    const parts = chat.mode === "texting" && m.role === "assistant"
      ? text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
      : [text];
    return parts.map((p) => h("div", { class: "bubble", html: formatRP(p) }));
  }

  function messageEl(m, i, isLastBot) {
    const mine = m.role === "user";
    const wrap = h("div", { class: `msg ${mine ? "user" : "bot"} ${seen.has(m.id) ? "" : "new"}`, "data-id": m.id });
    seen.add(m.id);

    if (editingId === m.id) {
      const ta = h("textarea", { class: "input", value: msgText(m) });
      autosize(ta, 400);
      wrap.append(h("div", { class: "msg-edit" }, ta, h("div", { class: "row end" },
        h("button", { class: "btn ghost small", type: "button", onClick: () => { editingId = null; render(); } }, "Cancel"),
        h("button", { class: "btn primary small", type: "button", onClick: () => {
          m.alts[m.altIdx] = ta.value.trim(); editingId = null; touchChat(chat); render();
        } }, "Save"))));
      setTimeout(() => ta.focus(), 30);
      return wrap;
    }

    const bubbles = h("div", { class: "bubbles", onClick: () => { if (m.id === streamingId) return; activeMsgId = activeMsgId === m.id ? null : m.id; render(); } }, bubblesFor(m));
    if (!mine && chat.mode === "roleplay") wrap.append(avatar(ch, "xs"));
    wrap.append(bubbles);

    // swipe between alternative replies
    const extras = [];
    if (!mine && m.alts.length > 1 && m.id !== streamingId) {
      extras.push(h("div", { class: "alts" },
        iconBtn("chevronLeft", "Previous version", () => { m.altIdx = (m.altIdx - 1 + m.alts.length) % m.alts.length; touchChat(chat); render(); }, "ghost tiny"),
        h("span", {}, `${m.altIdx + 1} / ${m.alts.length}`),
        iconBtn("chevronRight", "Next version", () => { m.altIdx = (m.altIdx + 1) % m.alts.length; touchChat(chat); render(); }, "ghost tiny")));
    }
    if (isLastBot && !isBusy()) {
      extras.push(h("button", { class: "chip-btn", type: "button", onClick: () => reply({ regen: m }) }, icon("refresh", 15), "Reroll"));
    }
    if (activeMsgId === m.id) {
      extras.push(
        h("button", { class: "chip-btn", type: "button", onClick: () => { navigator.clipboard?.writeText(msgText(m)); toast("Copied"); activeMsgId = null; render(); } }, icon("copy", 15), "Copy"),
        h("button", { class: "chip-btn", type: "button", onClick: () => { editingId = m.id; activeMsgId = null; render(); } }, icon("edit", 15), "Edit"),
        h("button", { class: "chip-btn danger", type: "button", onClick: () => {
          chat.messages.splice(chat.messages.indexOf(m), 1); activeMsgId = null; touchChat(chat); render();
          toast("Message deleted");
        } }, icon("trash", 15), "Delete"));
    }
    if (extras.length) wrap.append(h("div", { class: "msg-extras" }, extras));
    return wrap;
  }

  function render() {
    const { firstVisibleIndex } = buildChatPrompt({ ch, chat, profile, settings, lore: lib().lore });
    const lastBotIdx = chat.messages.map((m) => m.role).lastIndexOf("assistant");
    const nodes = [];
    chat.messages.forEach((m, i) => {
      if (i === firstVisibleIndex && i > 0) {
        nodes.push(h("button", { class: "memory-line", type: "button", onClick: openScene },
          h("span", {}, `${ch.name} can't see messages above this line. Tap to add key facts to Memory.`)));
      }
      nodes.push(messageEl(m, i, i === lastBotIdx && i === chat.messages.length - 1));
    });
    list.replaceChildren(...nodes);
    view.classList.toggle("texting", chat.mode === "texting");
    if (!chat.messages.length) {
      list.append(h("div", { class: "chat-empty muted" }, `Say something to ${ch.name} to begin.`));
    }
    syncComposer();
  }

  // Fast path while streaming: only update the one bubble
  let raf = 0;
  function paintStreaming(m) {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = list.querySelector(`[data-id="${m.id}"] .bubbles`);
      if (el) el.replaceChildren(...bubblesFor(m));
      toBottom();
    });
  }

  /* ---------- Composer ---------- */
  const input = h("textarea", { class: "composer-input", rows: 1, placeholder: `Message ${ch.name}…`, "aria-label": "Your message" });
  const fit = autosize(input, 180);
  const sendBtn = h("button", { class: "send-btn", type: "button", "aria-label": "Send", onClick: () => (isBusy() ? stopGenerating() : send()) }, icon("send", 20));
  const contBtn = iconBtn("forward", `Let ${ch.name} keep going`, () => reply({ cont: true }), "ghost cont-btn");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && settings.enterToSend) { e.preventDefault(); send(); }
  });
  input.addEventListener("focus", () => toBottom(true));

  function syncComposer() {
    const busy = isBusy();
    sendBtn.replaceChildren(icon(busy ? "stop" : "send", 20));
    sendBtn.setAttribute("aria-label", busy ? "Stop" : "Send");
    sendBtn.classList.toggle("stop", busy);
    contBtn.disabled = busy || !chat.messages.length;
  }

  const composer = h("div", { class: "composer" }, contBtn, h("div", { class: "composer-field" }, input, sendBtn));

  /* ---------- Sending & replying ---------- */
  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (isBusy()) { toast("Still writing… stop it first."); return; }
    chat.messages.push(normalizeMessage({ role: "user", content: text }));
    input.value = ""; fit();
    activeMsgId = null;
    touchChat(chat);
    stick = true;
    reply();
  }

  async function reply({ regen = null, cont = false } = {}) {
    if (isBusy()) { toast("Still writing… stop it first."); return; }
    navigator.storage?.persist?.().catch(() => {});

    let target = regen;
    if (target) { target.alts.push(""); target.altIdx = target.alts.length - 1; }
    else { target = normalizeMessage({ role: "assistant", content: "" }); chat.messages.push(target); }

    const before = { ...chat, messages: chat.messages.slice(0, chat.messages.indexOf(target)) };
    const prompt = buildChatPrompt({
      ch, chat: before, profile, settings, lore: lib().lore,
      extraUserText: cont ? `(Continue — ${ch.name} keeps going from where they left off, without repeating anything.)` : null,
    });

    streamingId = target.id;
    activeMsgId = null;
    render(); toBottom(true);
    setSub("typing…", true);

    const statusUnsub = onStatus((s) => { if (s.state === "loading") setSub(`waking up… ${Math.round(s.progress * 100)}%`, true); else if (s.state === "generating") setSub("typing…", true); });
    try {
      const pending = generate({
        modelKey: settings.model,
        messages: prompt.messages,
        maxTokens: prompt.maxTokens,
        temperature: temperatureFor(settings.temp, chat.tone),
        stop: prompt.stop,
        onText: (t) => { target.alts[target.altIdx] = cleanReply(t, ch.name, userName); paintStreaming(target); },
      });
      syncComposer(); // generate() marks itself busy synchronously → show the Stop button now
      const { text } = await pending;
      const final = cleanReply(text, ch.name, userName);
      if (final) target.alts[target.altIdx] = final;
      else throw new Error("No reply came back. Try rerolling, or check the Scene settings.");
    } catch (err) {
      // undo the empty slot
      if (!msgText(target)) {
        if (target.alts.length > 1) { target.alts.pop(); target.altIdx = target.alts.length - 1; }
        else chat.messages.splice(chat.messages.indexOf(target), 1);
      }
      toast(err.message, { type: "error", ms: 5000 });
    } finally {
      statusUnsub();
      streamingId = null;
      touchChat(chat);
      if (list.isConnected) { idleSub(); render(); toBottom(); }
    }
  }

  /* ---------- Scene sheet ---------- */
  function openScene() {
    const saveSoon = debounce(() => touchChat(chat), 300);
    const memory = h("textarea", { class: "input", rows: 4, value: chat.memory,
      placeholder: `e.g. ${userName} told ${ch.name} about their sister. They kissed once at the lighthouse and haven't talked about it.`,
      onInput: () => { chat.memory = memory.value; saveSoon(); } });
    const direction = h("textarea", { class: "input", rows: 2, value: chat.direction,
      placeholder: `e.g. ${ch.name} finally admits they missed ${userName}.`,
      onInput: () => { chat.direction = direction.value; saveSoon(); } });
    autosize(memory, 300); autosize(direction, 200);

    sheet({
      title: "Scene",
      body: h("div", { class: "form" },
        field("Style", segmented([["roleplay", "Roleplay"], ["texting", "Texting"]], chat.mode, (v) => { chat.mode = v; saveSoon(); render(); }),
          chat.mode === "texting" ? "Like a real text thread — no actions, just messages." : "Actions in *asterisks*, dialogue in quotes."),
        field("Reply length", segmented([["short", "Short"], ["medium", "Medium"], ["long", "Long"]], chat.length, (v) => { chat.length = v; saveSoon(); })),
        field("Memory", memory, `Facts ${ch.name} should never forget in this chat. Small models only see the last few pages of chat, so put important things here.`),
        field("Direction", direction, "Optional nudge for the next replies. Clear it when you're done."),
        h("div", { class: "field-label" }, "Tone"),
        toneSliders(chat.tone, saveSoon)),
      onClose: () => { touchChat(chat); render(); },
    });
  }

  /* ---------- Menu sheet ---------- */
  function openMenu() {
    const item = (ic, label, fn, cls = "") => h("button", { class: `menu-item ${cls}`, type: "button", onClick: () => { s.close(); fn(); } }, icon(ic, 20), h("span", {}, label));
    const s = sheet({
      title: ch.name,
      body: h("div", { class: "menu" },
        item("plus", `New chat with ${ch.name}`, () => startNewChat(ch)),
        item("edit", `Edit ${ch.name}`, () => go(`#/c/${ch.id}/edit`)),
        item("eye", "What the AI sees", showPrompt),
        item("download", "Export chat as text", exportChat),
        item("trash", "Delete this chat", async () => {
          if (await confirmDialog("This conversation will be gone for good.", { title: "Delete chat?", ok: "Delete", danger: true })) {
            deleteChat(chat.id); location.replace(`#/c/${ch.id}`);
          }
        }, "danger")),
    });
  }

  function showPrompt() {
    const p = buildChatPrompt({ ch, chat, profile, settings, lore: lib().lore, extraUserText: "(your next message)" });
    sheet({
      title: "What the AI sees", wide: true,
      body: h("div", {},
        h("p", { class: "muted" }, `This is exactly what's sent to the model with your next message. It can see ${p.messages.length - 1} recent turns.`),
        h("pre", { class: "prompt-view" }, p.messages.map((m) => `▌${m.role.toUpperCase()}\n${m.content}`).join("\n\n"))),
    });
  }

  function exportChat() {
    const lines = chat.messages.map((m) => `${m.role === "user" ? userName : ch.name}:\n${msgText(m)}\n`);
    downloadFile(lines.join("\n"), `${ch.name}-chat-${chat.createdAt.slice(0, 10)}.txt`, "text/plain");
  }

  /* ---------- Assemble ---------- */
  chat.messages.forEach((m) => seen.add(m.id));
  render();
  requestAnimationFrame(() => toBottom(true));
  if (!chat.messages.length) setTimeout(() => input.focus(), 250);

  view.append(top, scroller, status, composer);
  return view;
}

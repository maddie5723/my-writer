/* =========================================================
   chat.js — full-screen chat, styled like a messaging app.
   ========================================================= */
import { h, icon, iconBtn, avatar, formatRP, toast, sheet, confirmDialog, autosize, field, segmented, downloadFile, debounce, popover, tabs, haptic } from "./ui.js";
import { go, goBack, replaceTo, empty, page, toneSliders, modelStatusCard } from "./layout.js";
import { getChat, getCharacter, getProfile, getSettings, lib, touchChat, deleteChat, normalizeMessage, msgText } from "./store.js";
import { buildChatPrompt, cleanReply, temperatureFor } from "./prompts.js";
import { generate, stopGenerating, isBusy, onStatus, ensureEngine } from "./ai.js";
import { startNewChat } from "./characters.js";

export function renderChat(chatId) {
  const chat = getChat(chatId);
  const ch = chat && getCharacter(chat.characterId);
  if (!chat || !ch) return page({ title: "Chat not found", back: "#/chats", body: empty("🫥", "This chat doesn't exist anymore.") });

  const profile = getProfile();
  const settings = getSettings();
  const userName = profile.name?.trim() || "User";
  let editingId = null;     // message being edited
  let streamingId = null;   // message currently being written
  const seen = new Set();   // already on screen → don't re-animate
  const view = h("section", { class: "view chat" });

  /* ---------- Header ---------- */
  const status = h("div", { class: "chat-status" });
  const setStatus = (text, live = false) => { status.textContent = text; status.classList.toggle("live", live); };
  const idleStatus = () => setStatus(chat.mode === "texting" ? "Texting" : "Roleplay");
  const top = h("header", { class: "topbar chat-top" },
    iconBtn("back", "Back", () => goBack("#/chats"), "ghost back-btn"),
    h("a", { class: "chat-who", href: `#/c/${ch.id}` }, avatar(ch, "sm"),
      h("div", { class: "chat-who-text" }, h("b", {}, ch.name), status)),
    iconBtn("more", "Chat options", (e) => openMenu(e.currentTarget), "ghost"));
  idleStatus();

  /* ---------- Messages ---------- */
  const list = h("div", { class: "messages", role: "log", "aria-live": "polite" });
  const fillNames = (t) => t.replace(/\{\{\s*user\s*\}\}/gi, userName).replace(/\{\{\s*char\s*\}\}/gi, ch.name);
  const intro = h("div", { class: "chat-intro" }, avatar(ch, "lg"),
    h("b", {}, ch.name),
    ch.summary ? h("div", { class: "muted small" }, fillNames(ch.summary).slice(0, 160)) : null);
  const statusCard = modelStatusCard({ onRetry: () => ensureEngine(settings.model).catch(() => {}) });
  const scroller = h("div", { class: "chat-scroll" }, h("div", { class: "chat-inner" }, intro, list));

  let stick = true;
  scroller.addEventListener("scroll", () => { stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80; }, { passive: true });
  const toBottom = (force = false) => { if (force || stick) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; }); };

  function bubblesFor(m) {
    const text = msgText(m);
    if (!text && m.id === streamingId) return [h("div", { class: "bubble typing", "aria-label": `${ch.name} is typing` }, h("i"), h("i"), h("i"))];
    const parts = chat.mode === "texting" && m.role === "assistant"
      ? text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
      : [text];
    return parts.map((p) => h("div", { class: "bubble", html: formatRP(p) }));
  }

  function messageMenu(m, anchor, isLastBot) {
    popover(anchor, [
      { label: "Copy", icon: "copy", onClick: () => { navigator.clipboard?.writeText(msgText(m)); toast("Copied"); } },
      { label: "Edit", icon: "edit", onClick: () => { editingId = m.id; render(); } },
      isLastBot ? { label: "Reroll", icon: "refresh", onClick: () => reply({ regen: m }) } : null,
      "-",
      { label: "Delete", icon: "trash", danger: true, onClick: () => { chat.messages.splice(chat.messages.indexOf(m), 1); touchChat(chat); render(); } },
    ], { align: m.role === "user" ? "end" : "start" });
  }

  function messageEl(m, i, { isLastBot, lastInGroup, firstInGroup }) {
    const mine = m.role === "user";
    const cls = ["msg", mine ? "user" : "bot", seen.has(m.id) ? "" : "new", lastInGroup ? "last" : "", firstInGroup ? "first" : ""].join(" ");
    const wrap = h("div", { class: cls, "data-id": m.id });
    seen.add(m.id);

    if (editingId === m.id) {
      const ta = h("textarea", { class: "input", value: msgText(m) });
      autosize(ta, 320);
      wrap.append(h("div", { class: "msg-edit" }, ta, h("div", { class: "row end" },
        h("button", { class: "btn ghost small", type: "button", onClick: () => { editingId = null; render(); } }, "Cancel"),
        h("button", { class: "btn primary small", type: "button", onClick: () => { m.alts[m.altIdx] = ta.value.trim(); editingId = null; touchChat(chat); render(); } }, "Save"))));
      setTimeout(() => ta.focus(), 30);
      return wrap;
    }

    if (!mine) wrap.append(lastInGroup ? avatar(ch, "xs") : h("span", { class: "avatar-gap" }));
    const bubbles = h("div", { class: "bubbles", onClick: (e) => {
      if (m.id === streamingId || isBusy()) return;
      messageMenu(m, e.target.closest(".bubble") || e.currentTarget, isLastBot);
    } }, bubblesFor(m));
    wrap.append(bubbles);

    // versions + reroll under the latest reply
    if (!mine && m.id !== streamingId && (m.alts.length > 1 || isLastBot)) {
      wrap.append(h("div", { class: "msg-tools" },
        m.alts.length > 1 ? iconBtn("chevronLeft", "Previous version", () => { m.altIdx = (m.altIdx - 1 + m.alts.length) % m.alts.length; touchChat(chat); render(); }, "ghost tiny") : null,
        m.alts.length > 1 ? h("span", { class: "alt-count" }, `${m.altIdx + 1}/${m.alts.length}`) : null,
        m.alts.length > 1 ? iconBtn("chevronRight", "Next version", () => { m.altIdx = (m.altIdx + 1) % m.alts.length; touchChat(chat); render(); }, "ghost tiny") : null,
        isLastBot && !isBusy() ? iconBtn("refresh", "Reroll this reply", () => reply({ regen: m }), "ghost tiny") : null));
    }
    return wrap;
  }

  function render() {
    const { firstVisibleIndex } = buildChatPrompt({ ch, chat, profile, settings, lore: lib().lore });
    const msgs = chat.messages;
    const lastBotIdx = msgs.map((m) => m.role).lastIndexOf("assistant");
    const nodes = [];
    msgs.forEach((m, i) => {
      if (i === firstVisibleIndex && i > 0) {
        nodes.push(h("button", { class: "memory-line", type: "button", onClick: () => openScene(2) },
          h("span", {}, `${ch.name} can't see above here · add key facts to Memory`)));
      }
      nodes.push(messageEl(m, i, {
        isLastBot: i === lastBotIdx && i === msgs.length - 1,
        firstInGroup: msgs[i - 1]?.role !== m.role,
        lastInGroup: msgs[i + 1]?.role !== m.role,
      }));
    });
    list.replaceChildren(...nodes);
    if (!msgs.length) list.append(h("div", { class: "chat-empty muted small" }, `Say hi to ${ch.name}.`));
    view.classList.toggle("texting", chat.mode === "texting");
    syncComposer();
  }

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
  const input = h("textarea", { class: "composer-input", rows: 1, placeholder: "Message", "aria-label": "Your message", enterkeyhint: settings.enterToSend ? "send" : "enter" });
  const fit = autosize(input, 150);
  const sendBtn = h("button", { class: "send-btn", type: "button", "aria-label": "Send", onClick: () => (isBusy() ? stopGenerating() : send()) }, icon("send", 18));
  const plusBtn = iconBtn("plus", "More options", (e) => popover(e.currentTarget, [
    { label: `Let ${ch.name.split(" ")[0]} keep going`, icon: "forward", onClick: () => reply({ cont: true }) },
    { label: "Style & length", icon: "sliders", onClick: () => openScene(0) },
    { label: "Tone", icon: "sparkles", onClick: () => openScene(1) },
    { label: "Memory", icon: "bookmark", onClick: () => openScene(2) },
  ], { align: "start" }), "plus-btn");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && settings.enterToSend) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", syncComposer);
  input.addEventListener("focus", () => toBottom(true));

  function syncComposer() {
    const busy = isBusy();
    sendBtn.replaceChildren(icon(busy ? "stop" : "send", 18));
    sendBtn.setAttribute("aria-label", busy ? "Stop" : "Send");
    sendBtn.classList.toggle("stop", busy);
    sendBtn.classList.toggle("ready", busy || !!input.value.trim());
    plusBtn.disabled = busy;
  }
  const composer = h("div", { class: "composer" }, plusBtn, h("div", { class: "composer-field" }, input, sendBtn));

  /* ---------- Sending & replying ---------- */
  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (isBusy()) { toast("Still writing… tap ■ to stop."); return; }
    haptic();
    chat.messages.push(normalizeMessage({ role: "user", content: text }));
    input.value = ""; fit();
    touchChat(chat);
    stick = true;
    reply();
  }

  async function reply({ regen = null, cont = false } = {}) {
    if (isBusy()) { toast("Still writing… tap ■ to stop."); return; }
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
    render(); toBottom(true);
    setStatus("typing…", true);
    const unsub = onStatus((s) => {
      if (s.state === "loading") setStatus(`waking up… ${Math.round(s.progress * 100)}%`, true);
      else if (s.state === "generating") setStatus("typing…", true);
    });
    try {
      const pending = generate({
        modelKey: settings.model,
        messages: prompt.messages,
        maxTokens: prompt.maxTokens,
        temperature: temperatureFor(settings.temp, chat.tone),
        stop: prompt.stop,
        onText: (t) => { target.alts[target.altIdx] = cleanReply(t, ch.name, userName); paintStreaming(target); },
      });
      syncComposer(); // generate() is busy now → show Stop
      const { text } = await pending;
      const final = cleanReply(text, ch.name, userName);
      if (final) target.alts[target.altIdx] = final;
      else throw new Error("No reply came back. Try rerolling.");
    } catch (err) {
      if (!msgText(target)) {
        if (target.alts.length > 1) { target.alts.pop(); target.altIdx = target.alts.length - 1; }
        else chat.messages.splice(chat.messages.indexOf(target), 1);
      }
      toast(err.message, { type: "error", ms: 5000 });
    } finally {
      unsub();
      streamingId = null;
      touchChat(chat);
      if (list.isConnected) { idleStatus(); render(); toBottom(); }
    }
  }

  /* ---------- Scene (small tabbed sheet) ---------- */
  function openScene(startTab = 0) {
    const saveSoon = debounce(() => touchChat(chat), 300);
    const styleTab = () => {
      const direction = h("textarea", { class: "input", rows: 2, value: chat.direction,
        placeholder: `e.g. ${ch.name.split(" ")[0]} finally opens up`,
        onInput: () => { chat.direction = direction.value; saveSoon(); } });
      autosize(direction, 160);
      return h("div", { class: "form" },
        field("Style", segmented([["roleplay", "Roleplay"], ["texting", "Texting"]], chat.mode, (v) => { chat.mode = v; saveSoon(); render(); idleStatus(); })),
        field("Reply length", segmented([["short", "Short"], ["medium", "Medium"], ["long", "Long"]], chat.length, (v) => { chat.length = v; saveSoon(); })),
        field("Direction", direction, "Optional nudge for the next replies."));
    };
    const toneTab = () => h("div", { class: "form" }, toneSliders(chat.tone, saveSoon));
    const memoryTab = () => {
      const memory = h("textarea", { class: "input", rows: 5, value: chat.memory,
        placeholder: `e.g. ${userName} told ${ch.name.split(" ")[0]} about their sister. They kissed once and haven't talked about it.`,
        onInput: () => { chat.memory = memory.value; saveSoon(); } });
      autosize(memory, 260);
      return h("div", { class: "form" }, field("Things to never forget", memory, `${ch.name} only sees the latest part of the chat. Facts here are always remembered.`));
    };
    const t = tabs([{ label: "Style", render: styleTab }, { label: "Tone", render: toneTab }, { label: "Memory", render: memoryTab }], startTab);
    sheet({ title: "Scene", body: h("div", {}, t.bar, t.panel), onClose: () => { touchChat(chat); render(); } });
  }

  /* ---------- ⋯ menu ---------- */
  function openMenu(anchor) {
    popover(anchor, [
      { label: "Scene & tone", icon: "sliders", onClick: () => openScene(0) },
      { label: "Memory", icon: "bookmark", onClick: () => openScene(2) },
      "-",
      { label: "New chat", icon: "plus", onClick: () => startNewChat(ch) },
      { label: `View ${ch.name.split(" ")[0]}`, icon: "user", onClick: () => go(`#/c/${ch.id}`) },
      { label: "What the AI sees", icon: "eye", onClick: showPrompt },
      { label: "Export as text", icon: "download", onClick: exportChat },
      "-",
      { label: "Delete chat", icon: "trash", danger: true, onClick: async () => {
        if (await confirmDialog("This conversation will be gone for good.", { title: "Delete chat?", ok: "Delete", danger: true })) {
          deleteChat(chat.id); replaceTo("#/chats");
        }
      } },
    ]);
  }

  function showPrompt() {
    const p = buildChatPrompt({ ch, chat, profile, settings, lore: lib().lore, extraUserText: "(your next message)" });
    sheet({
      title: "What the AI sees", wide: true,
      body: h("div", {},
        h("p", { class: "muted small" }, `Exactly what's sent with your next message. It can see ${p.messages.length - 1} recent turns.`),
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
  view.append(top, scroller, statusCard, composer);
  return view;
}

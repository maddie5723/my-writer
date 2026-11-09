/* =========================================================
   chat.js — immersive chat / scene with one or more characters
   plus an optional Narrator. Styled like a messaging app.
   ========================================================= */
import { h, icon, iconBtn, avatar, formatRP, toast, sheet, confirmDialog, promptDialog, autosize, field, segmented, toggle, downloadFile, debounce, popover, tabs, haptic, imageToDataURL } from "./ui.js";
import { go, goBack, replaceTo, empty, page, toneSliders, modelStatusCard } from "./layout.js";
import { getChat, getCharacter, getProfile, getSettings, lib, touchChat, deleteChat, normalizeMessage, msgText, createChat } from "./store.js";
import { buildChatPrompt, buildSummaryPrompt, cleanReply, temperatureFor, pickSpeaker, mentioned, bannedHit, speakerName, firstName, fill } from "./prompts.js";
import { generate, stopGenerating, isBusy, onStatus, ensureEngine } from "./ai.js";

export const THEME_LABELS = {
  default: "Default", neon: "Motel Neon", road: "Open Road", whiskey: "Whiskey & Leather",
  salt: "Salt Line", rain: "Rainy Night", candle: "Candlelight",
};

/** Start a fresh chat with the same people (used by profile page & menus) */
export function newChatLike(cast, { narrator = false } = {}) {
  const first = cast[0];
  const user = getProfile().name || "User";
  const greetings = [first.greeting, ...(first.greetings || [])].filter((g) => g?.trim()).map((g) => fill(g, first.name, user));
  const chat = createChat(first, greetings, { cast: cast.map((c) => c.id), narrator });
  go(`#/chat/${chat.id}`);
  return chat;
}

export function renderChat(chatId) {
  const chat = getChat(chatId);
  const cast = () => chat?.cast.map(getCharacter).filter(Boolean) || [];
  if (!chat || !cast().length) return page({ title: "Chat not found", back: "#/chats", body: empty("🫥", "This chat doesn't exist anymore.") });

  const profile = getProfile();
  const settings = getSettings();
  const userName = profile.name?.trim() || "User";
  const isGroup = () => cast().length > 1 || chat.narrator;
  let editingId = null;     // message being edited
  let streamingId = null;   // message currently being written
  let elCache = new Map();  // message id -> { sig, el }: reuse unchanged messages between redraws
  let summarizing = false;  // background memory update (never blocks the user)
  const busyForUser = () => isBusy() && !summarizing;
  /** If memory is updating in the background, stop it so the user's action goes first */
  async function yieldToUser() {
    if (!summarizing) return;
    await stopGenerating();
    for (let i = 0; i < 50 && isBusy(); i++) await new Promise((r) => setTimeout(r, 40));
  }
  const seen = new Set();   // already on screen → don't re-animate
  const view = h("section", { class: "view chat" });

  /* ---------- Header ---------- */
  const status = h("div", { class: "chat-status" });
  const setStatus = (text, live = false) => { status.textContent = text; status.classList.toggle("live", live); };
  const idleStatus = () => setStatus(isGroup() ? `${cast().length} ${cast().length === 1 ? "character" : "characters"}${chat.narrator ? " + Narrator" : ""}` : chat.mode === "texting" ? "Texting" : "Roleplay");
  const who = h("button", { class: "chat-who", type: "button", onClick: () => (isGroup() ? openScene(0) : go(`#/c/${cast()[0].id}`)) });
  const drawHeader = () => {
    const c = cast();
    who.replaceChildren(
      c.length > 1 ? h("div", { class: "stack-avatars" }, c.slice(0, 3).map((x) => avatar(x, "xs"))) : avatar(c[0], "sm"),
      h("div", { class: "chat-who-text" }, h("b", {}, c.length > 1 ? namesLine(c) : c[0].name), status));
    idleStatus();
  };
  const top = h("header", { class: "topbar chat-top" },
    iconBtn("back", "Back", () => goBack("#/chats"), "ghost back-btn"),
    who,
    iconBtn("more", "Chat options", (e) => openMenu(e.currentTarget), "ghost"));

  /* ---------- Messages ---------- */
  const list = h("div", { class: "messages", role: "log", "aria-live": "polite" });
  const intro = h("div", { class: "chat-intro" });
  const drawIntro = () => {
    const c = cast();
    intro.replaceChildren(
      c.length > 1 ? h("div", { class: "stack-avatars big" }, c.slice(0, 4).map((x) => avatar(x, "lg"))) : avatar(c[0], "lg"),
      h("b", {}, c.length > 1 ? namesLine(c) : c[0].name),
      c[0].scenario ? h("div", { class: "muted small" }, fill(c[0].scenario, c[0].name, userName).slice(0, 180)) : c[0].summary ? h("div", { class: "muted small" }, c[0].summary.slice(0, 160)) : null);
  };
  const statusCard = modelStatusCard({ onRetry: () => ensureEngine(settings.model).catch(() => {}) });
  const inner = h("div", { class: "chat-inner" }, intro, list);
  const scroller = h("div", { class: "chat-scroll" }, inner);

  let stick = true;
  scroller.addEventListener("scroll", () => { stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80; }, { passive: true });
  const toBottom = (force = false) => { if (force || stick) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; }); };

  const speakerOf = (m) => (m.speaker === "narrator" ? "narrator" : cast().find((c) => c.id === m.speaker) || cast()[0]);

  function bubblesFor(m) {
    const text = msgText(m);
    if (!text && m.id === streamingId) return [h("div", { class: "bubble typing", "aria-label": "typing" }, h("i"), h("i"), h("i"))];
    const parts = chat.mode === "texting" && m.role === "assistant" && m.speaker !== "narrator"
      ? text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
      : [text];
    return parts.map((p) => h("div", { class: "bubble", html: formatRP(p) }));
  }

  function messageMenu(m, anchor, isLast) {
    const bot = m.role === "assistant";
    popover(anchor, [
      { label: "Copy", icon: "copy", onClick: () => { navigator.clipboard?.writeText(msgText(m)); toast("Copied"); } },
      { label: "Edit", icon: "edit", onClick: () => { editingId = m.id; render(); } },
      bot && isLast ? { label: "Reroll", icon: "refresh", onClick: () => reply({ regen: m }) } : null,
      bot ? { label: "Don't do this…", icon: "x", onClick: () => dontDoThis(m, isLast) } : null,
      "-",
      { label: "Delete", icon: "trash", danger: true, onClick: () => { chat.messages.splice(chat.messages.indexOf(m), 1); touchChat(chat); render(); } },
    ], { align: m.role === "user" ? "end" : "start" });
  }

  async function dontDoThis(m, isLast) {
    const what = await promptDialog("What didn't you like?", { placeholder: "e.g. Don't call me kid", ok: isLast ? "Save & rewrite" : "Save" });
    if (!what) return;
    chat.avoid = [chat.avoid, what].filter(Boolean).join("\n");
    touchChat(chat);
    toast("Got it — they won't do that again in this chat");
    if (isLast) reply({ regen: m });
  }

  function messageEl(m, i, { isLast, lastInGroup, firstInGroup }) {
    const mine = m.role === "user";
    const sp = mine ? null : speakerOf(m);
    const narr = sp === "narrator";
    const cls = ["msg", mine ? "user" : narr ? "narr" : "bot", seen.has(m.id) ? "" : "new", lastInGroup ? "last" : "", firstInGroup ? "first" : ""].join(" ");
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

    if (!mine && !narr && isGroup() && firstInGroup) wrap.append(h("div", { class: "speaker" }, sp.name));
    if (!mine && !narr) wrap.append(lastInGroup ? avatar(sp, "xs") : h("span", { class: "avatar-gap" }));
    const bubbles = h("div", { class: "bubbles", onClick: (e) => {
      if (m.id === streamingId || busyForUser()) return;
      messageMenu(m, e.target.closest(".bubble") || e.currentTarget, isLast);
    } }, bubblesFor(m));
    wrap.append(bubbles);

    // versions (swipe alternate replies / opening lines) + reroll on the latest reply
    if (!mine && m.id !== streamingId && (m.alts.length > 1 || (isLast && !isBusy()))) {
      wrap.append(h("div", { class: "msg-tools" },
        m.alts.length > 1 ? iconBtn("chevronLeft", "Previous version", () => { m.altIdx = (m.altIdx - 1 + m.alts.length) % m.alts.length; touchChat(chat); render(); }, "ghost tiny") : null,
        m.alts.length > 1 ? h("span", { class: "alt-count" }, `${m.altIdx + 1}/${m.alts.length}`) : null,
        m.alts.length > 1 ? iconBtn("chevronRight", "Next version", () => { m.altIdx = (m.altIdx + 1) % m.alts.length; touchChat(chat); render(); }, "ghost tiny") : null,
        isLast && !isBusy() ? iconBtn("refresh", "Reroll", () => reply({ regen: m }), "ghost tiny") : null));
    }
    return wrap;
  }

  function render() {
    const c = cast();
    const { firstVisibleIndex } = buildChatPrompt({ chat, cast: c, speaker: c[0], profile, settings, lore: lib().lore });
    const msgs = chat.messages;
    const key = (m) => (m.role === "user" ? "u" : m.speaker || c[0].id);
    const castSig = `${chat.cast.join(",")}|${chat.narrator}|${c.map((x) => x.name + x.avatar.length).join(",")}`;
    const fresh = new Map();
    const nodes = [];
    msgs.forEach((m, i) => {
      if (i === firstVisibleIndex && i > 0) {
        const remembered = chat.summarizedUpTo >= firstVisibleIndex - 3;
        nodes.push(h("button", { class: "memory-line", type: "button", onClick: () => openScene(3) },
          h("span", {}, remembered ? "Older messages are saved in the story summary" : "They can't see above here · add key facts to Memory")));
      }
      const opts = {
        isLast: i === msgs.length - 1,
        firstInGroup: !msgs[i - 1] || key(msgs[i - 1]) !== key(m),
        lastInGroup: !msgs[i + 1] || key(msgs[i + 1]) !== key(m),
      };
      const sig = [m.role, m.speaker, m.altIdx, m.alts.length, msgText(m), opts.isLast, opts.firstInGroup, opts.lastInGroup,
        editingId === m.id, streamingId === m.id, busyForUser(), chat.mode, castSig].join("\u0001");
      const hit = elCache.get(m.id);
      if (hit && hit.sig === sig) { hit.el.classList.remove("new"); nodes.push(hit.el); fresh.set(m.id, hit); return; }
      const el = messageEl(m, i, opts);
      fresh.set(m.id, { sig, el });
      nodes.push(el);
    });
    elCache = fresh;
    list.replaceChildren(...nodes);
    if (!msgs.length) {
      list.append(h("div", { class: "chat-empty muted small" },
        isGroup() ? "Say something, or tap someone below to have them start." : `Say hi to ${firstName(c[0].name)}.`));
    }
    applyLook();
    drawCastBar();
    syncComposer();
  }

  /** Colors / background only — no need to rebuild messages */
  let shownBg = null;
  function applyLook() {
    view.classList.toggle("texting", chat.mode === "texting");
    view.dataset.theme = chat.theme;
    if (shownBg !== chat.bg) {
      shownBg = chat.bg;
      scroller.style.backgroundImage = chat.bg ? `linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.55)), url("${chat.bg}")` : "";
    }
    view.classList.toggle("has-bg", !!chat.bg);
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

  /* ---------- Cast bar: tap someone to have them respond ---------- */
  const castBar = h("div", { class: "cast-bar", role: "toolbar", "aria-label": "Who responds" });
  function drawCastBar() {
    const busy = busyForUser();
    const c = cast();
    castBar.replaceChildren(
      ...c.map((x) => h("button", { class: "cast-btn", type: "button", disabled: busy, title: `${x.name} responds`, onClick: () => { haptic(); reply({ speaker: x }); } },
        avatar(x, "xs"), h("span", {}, firstName(x.name)))),
      chat.narrator && chat.mode !== "texting" ? h("button", { class: "cast-btn narr", type: "button", disabled: busy, title: "Narrator describes what happens", onClick: () => { haptic(); reply({ speaker: "narrator" }); } },
        h("span", { class: "narr-ic" }, "📖"), h("span", {}, "Narrator")) : null,
      h("button", { class: "cast-btn add", type: "button", disabled: busy, "aria-label": "Add someone to the scene", onClick: (e) => addMenu(e.currentTarget) }, icon("plus", 18)));
  }

  function addMenu(anchor) {
    const others = lib().characters.filter((x) => !chat.cast.includes(x.id));
    popover(anchor, [
      !chat.narrator && chat.mode !== "texting" ? { label: "Add Narrator", icon: "book", onClick: () => { chat.narrator = true; touchChat(chat); drawHeader(); render(); toast("Narrator joined — tap 📖 to set the scene"); } } : null,
      ...others.slice(0, 8).map((x) => ({ label: `Add ${x.name}`, icon: "user", onClick: () => addToCast(x) })),
      others.length > 8 ? { label: "More…", icon: "users", onClick: () => openScene(0) } : null,
      !others.length && chat.narrator ? { label: "Make a new character", icon: "plus", onClick: () => go("#/c/new") } : null,
    ], { align: "end", title: "Add to the scene" });
  }
  function addToCast(x) {
    chat.cast.push(x.id); touchChat(chat); drawHeader(); drawIntro(); render();
    toast(`${x.name} joined the scene`);
  }

  /* ---------- Composer ---------- */
  const input = h("textarea", { class: "composer-input", rows: 1, placeholder: "Message", "aria-label": "Your message", enterkeyhint: settings.enterToSend ? "send" : "enter" });
  const fit = autosize(input, 150);
  const sendBtn = h("button", { class: "send-btn", type: "button", "aria-label": "Send", onClick: () => (busyForUser() ? stopGenerating() : send()) }, icon("send", 18));
  const plusBtn = iconBtn("plus", "More options", (e) => popover(e.currentTarget, [
    { label: "Keep going", icon: "forward", onClick: () => reply({ cont: true }) },
    { label: "Style & length", icon: "sliders", onClick: () => openScene(1) },
    { label: "Tone", icon: "sparkles", onClick: () => openScene(2) },
    { label: "Memory", icon: "bookmark", onClick: () => openScene(3) },
    { label: "Theme", icon: "image", onClick: () => openScene(4) },
  ], { align: "start" }), "plus-btn");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && settings.enterToSend) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", syncComposer);
  input.addEventListener("focus", () => toBottom(true));

  function syncComposer() {
    const busy = busyForUser();
    sendBtn.replaceChildren(icon(busy ? "stop" : "send", 18));
    sendBtn.setAttribute("aria-label", busy ? "Stop" : "Send");
    sendBtn.classList.toggle("stop", busy);
    sendBtn.classList.toggle("ready", busy || !!input.value.trim());
    plusBtn.disabled = busy;
    castBar.querySelectorAll("button").forEach((b) => { b.disabled = busy; });
  }
  const composer = h("div", { class: "composer-wrap" }, castBar, h("div", { class: "composer" }, plusBtn, h("div", { class: "composer-field" }, input, sendBtn)));

  /* ---------- Sending & replying ---------- */
  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (busyForUser()) { toast("Still writing… tap ■ to stop."); return; }
    haptic();
    chat.messages.push(normalizeMessage({ role: "user", content: text }));
    input.value = ""; fit();
    touchChat(chat);
    stick = true;
    reply({ speaker: pickSpeaker(chat, cast(), text), chain: true });
  }

  /**
   * speaker: character or "narrator"; regen: message to rewrite; cont: same speaker keeps going;
   * chain: allow one other character to jump in if they were called out.
   */
  async function reply({ speaker = null, regen = null, cont = false, chain = false } = {}) {
    if (busyForUser()) { toast("Still writing… tap ■ to stop."); return; }
    await yieldToUser();
    navigator.storage?.persist?.().catch(() => {});
    const c = cast();
    const lastBot = [...chat.messages].reverse().find((m) => m.role === "assistant");
    if (regen) speaker = speakerOf(regen);
    else if (cont) speaker = lastBot ? speakerOf(lastBot) : c[0];
    speaker = speaker || c[0];
    const isNarr = speaker === "narrator";
    const sName = isNarr ? "Narrator" : speaker.name;
    const others = c.filter((x) => x !== speaker).map((x) => x.name);

    let target = regen;
    if (target) { target.alts.push(""); target.altIdx = target.alts.length - 1; }
    else { target = normalizeMessage({ role: "assistant", content: "", speaker: isNarr ? "narrator" : speaker.id }); chat.messages.push(target); }

    streamingId = target.id;
    render(); toBottom(true);
    setStatus(isNarr ? "narrating…" : `${firstName(sName)} is typing…`, true);
    const unsub = onStatus((s) => { if (s.state === "loading") setStatus(`waking up the AI… ${Math.round(s.progress * 100)}%`, true); });

    let final = "";
    try {
      // Try up to 3 times if a banned word sneaks in
      let extraDirection = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = { ...chat, messages: chat.messages.slice(0, chat.messages.indexOf(target)), direction: [chat.direction, extraDirection].filter(Boolean).join(" ") };
        const prompt = buildChatPrompt({
          chat: before, cast: c, speaker, profile, settings, lore: lib().lore,
          extraUserText: cont ? `(Continue — ${sName} keeps going from where they left off, without repeating anything.)` : (!before.messages.length || before.messages[before.messages.length - 1].role !== "user") ? (isNarr ? "(Narrator, describe what happens next.)" : `(${sName} speaks up.)`) : null,
        });
        const pending = generate({
          settings,
          messages: prompt.messages,
          maxTokens: prompt.maxTokens,
          temperature: temperatureFor(settings.temp, chat.tone),
          stop: prompt.stop,
          onText: (t) => { target.alts[target.altIdx] = cleanReply(t, sName, userName, others); paintStreaming(target); },
        });
        syncComposer();
        const { text, stopped } = await pending;
        final = cleanReply(text, sName, userName, others);
        const bad = !stopped && bannedHit(final, profile);
        if (!bad) break;
        if (attempt < 2) {
          setStatus("rewriting…", true);
          extraDirection = `Absolutely do not use the word "${bad}".`;
          target.alts[target.altIdx] = "";
          paintStreaming(target);
        }
      }
      if (final) target.alts[target.altIdx] = final;
      else throw new Error("No reply came back. Try rerolling.");
    } catch (err) {
      if (!msgText(target)) {
        if (target.alts.length > 1) { target.alts.pop(); target.altIdx = target.alts.length - 1; }
        else chat.messages.splice(chat.messages.indexOf(target), 1);
      }
      toast(err.message, { type: "error", ms: 5000 });
      final = "";
    } finally {
      unsub();
      streamingId = null;
      touchChat(chat);
      if (list.isConnected) { idleStatus(); render(); toBottom(); }
    }

    // Someone got called out by name → let them answer (once)
    if (final && chain && chat.chimeIn && !isNarr && c.length > 1) {
      const called = mentioned(final, c.filter((x) => x !== speaker));
      if (called.length) { await reply({ speaker: called[0] }); return; }
    }
    if (final) await maybeSummarize();
  }

  /* ---------- Automatic memory ---------- */
  async function maybeSummarize() {
    const c = cast();
    const { firstVisibleIndex } = buildChatPrompt({ chat, cast: c, speaker: c[0], profile, settings, lore: lib().lore });
    const every = settings.provider === "online" ? 6 : 10; // the phone AI is slower, so batch more at once
    if (firstVisibleIndex - chat.summarizedUpTo < every || isBusy()) return; // not enough new history has scrolled out of view
    // summarize a little past the cut-off, so the gap the summary itself takes up stays covered
    const job = buildSummaryPrompt({ chat, cast: c, profile, settings, upTo: Math.max(firstVisibleIndex, Math.min(chat.messages.length - 4, firstVisibleIndex + 6)) });
    summarizing = true;
    if (list.isConnected) { setStatus("updating memory…", true); syncComposer(); drawCastBar(); }
    try {
      const { text, stopped } = await generate({ settings, messages: job.messages, maxTokens: 320, temperature: 0.3 });
      if (!stopped && text.trim()) {
        chat.summary = text.trim();
        chat.summarizedUpTo = job.upTo;
        touchChat(chat);
      }
    } catch { /* memory is best-effort; try again next time */ }
    summarizing = false;
    if (list.isConnected && !isBusy()) { idleStatus(); render(); }
  }

  /* ---------- Scene sheet (Cast · Style · Tone · Memory · Theme) ---------- */
  function openScene(startTab = 0) {
    const saveSoon = debounce(() => touchChat(chat), 300);

    const castTab = () => {
      const wrap = h("div", { class: "form" });
      const draw = () => {
        const inScene = cast();
        const others = lib().characters.filter((x) => !chat.cast.includes(x.id));
        wrap.replaceChildren(
          h("div", { class: "group" }, inScene.map((x) => h("div", { class: "cast-row-item" },
            avatar(x, "sm"), h("span", { class: "grow" }, x.name),
            inScene.length > 1 ? h("button", { class: "text-btn danger", type: "button", onClick: () => { chat.cast = chat.cast.filter((id) => id !== x.id); saveSoon(); draw(); drawHeader(); drawIntro(); render(); } }, "Remove") : null))),
          others.length ? h("div", { class: "group-title" }, "Add to scene") : null,
          others.length ? h("div", { class: "group" }, others.map((x) => h("button", { class: "cast-row-item as-btn", type: "button", onClick: () => { addToCast(x); draw(); } },
            avatar(x, "sm"), h("span", { class: "grow" }, x.name), icon("plus", 18)))) : null,
          h("div", { class: "group pad" },
            toggle(chat.narrator, (v) => { chat.narrator = v; saveSoon(); drawHeader(); render(); }, "📖 Narrator"),
            h("div", { class: "field-hint" }, "Describes the setting, sounds and what everyone does, like a book.")),
          inScene.length > 1 ? h("div", { class: "group pad" },
            toggle(chat.chimeIn, (v) => { chat.chimeIn = v; saveSoon(); }, "Let others jump in"),
            h("div", { class: "field-hint" }, "If someone gets called out by name, they answer on their own.")) : null);
      };
      draw();
      return wrap;
    };

    const styleTab = () => {
      const direction = h("textarea", { class: "input", rows: 2, value: chat.direction,
        placeholder: "e.g. Things get tense. Someone's hiding something.",
        onInput: () => { chat.direction = direction.value; saveSoon(); } });
      autosize(direction, 160);
      return h("div", { class: "form" },
        field("Style", segmented([["roleplay", "Story"], ["texting", "Texting"]], chat.mode, (v) => { chat.mode = v; saveSoon(); idleStatus(); requestAnimationFrame(() => setTimeout(render)); }), // show the tap first, then redraw
          chat.mode === "texting" ? "Like a real text thread — no actions or narration." : "Actions in *asterisks*, dialogue in quotes."),
        field("Reply length", segmented([["short", "Short"], ["medium", "Medium"], ["long", "Long"]], chat.length, (v) => { chat.length = v; saveSoon(); })),
        field("Direction", direction, "Optional nudge for where things go next."));
    };

    const toneTab = () => h("div", { class: "form" }, toneSliders(chat.tone, saveSoon));

    const memoryTab = () => {
      const ta = (key, rows, placeholder) => {
        const t = h("textarea", { class: "input", rows, value: chat[key], placeholder, onInput: () => { chat[key] = t.value; saveSoon(); } });
        autosize(t, 260);
        return t;
      };
      return h("div", { class: "form" },
        field("Always remember", ta("memory", 3, `e.g. ${userName} is new to hunting. They found the journal in the trunk.`), "Facts that should never be forgotten."),
        field("Story so far (automatic)", ta("summary", 4, "Fills in on its own as the story gets long. You can edit it."), "Older parts of the chat get summarized here automatically."),
        field("Don't do this in this chat", ta("avoid", 3, "One per line, e.g.\nDon't call me kid\nNo one dies"), "Hard rules for this chat. Your always-rules live in Me → Profile."));
    };

    const themeTab = () => {
      const wrap = h("div", { class: "form" });
      const fileInput = h("input", { type: "file", accept: "image/*", hidden: true, onChange: async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { chat.bg = await imageToDataURL(f, 900); touchChat(chat); applyLook(); draw(); } catch (err) { toast(err.message, { type: "error" }); }
      } });
      const draw = () => wrap.replaceChildren(
        h("div", { class: "theme-grid" }, Object.entries(THEME_LABELS).map(([k, label]) => h("button", {
          class: `theme-swatch ${chat.theme === k ? "on" : ""}`, type: "button", "data-theme": k,
          onClick: () => { chat.theme = k; touchChat(chat); applyLook(); draw(); },
        }, h("span", { class: "theme-preview" }, h("i"), h("i")), h("span", {}, label)))),
        h("div", { class: "row" },
          h("button", { class: "btn ghost grow", type: "button", onClick: () => fileInput.click() }, icon("image", 18), chat.bg ? "Change background" : "Background photo"),
          chat.bg ? h("button", { class: "btn danger-ghost", type: "button", onClick: () => { chat.bg = ""; touchChat(chat); applyLook(); draw(); } }, "Remove") : null),
        fileInput);
      draw();
      return wrap;
    };

    const t = tabs([
      { label: "Cast", render: castTab },
      { label: "Style", render: styleTab },
      { label: "Tone", render: toneTab },
      { label: "Memory", render: memoryTab },
      { label: "Theme", render: themeTab },
    ], startTab);
    sheet({ title: "Scene", body: h("div", {}, t.bar, t.panel), onClose: () => { touchChat(chat); drawHeader(); render(); } });
  }

  /* ---------- ⋯ menu ---------- */
  function openMenu(anchor) {
    const c = cast();
    popover(anchor, [
      { label: "Scene settings", icon: "sliders", onClick: () => openScene(0) },
      { label: "Add someone", icon: "users", onClick: () => openScene(0) },
      { label: "Memory", icon: "bookmark", onClick: () => openScene(3) },
      { label: "Theme", icon: "image", onClick: () => openScene(4) },
      "-",
      { label: "New chat", icon: "plus", onClick: () => newChatLike(c, { narrator: chat.narrator }) },
      c.length === 1 ? { label: `View ${firstName(c[0].name)}`, icon: "user", onClick: () => go(`#/c/${c[0].id}`) } : null,
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
    const c = cast();
    const sp = pickSpeaker(chat, c, "");
    const p = buildChatPrompt({ chat, cast: c, speaker: sp, profile, settings, lore: lib().lore, extraUserText: "(your next message)" });
    sheet({
      title: "What the AI sees", wide: true,
      body: h("div", {},
        h("p", { class: "muted small" }, `What's sent with your next message (if ${sp.name} answers). It can see ${p.messages.length - 1} recent turns.`),
        h("pre", { class: "prompt-view" }, p.messages.map((m) => `▌${m.role.toUpperCase()}\n${m.content}`).join("\n\n"))),
    });
  }

  function exportChat() {
    const c = cast();
    const lines = chat.messages.map((m) => `${m.role === "user" ? userName : speakerName(m, c)}:\n${msgText(m)}\n`);
    downloadFile(lines.join("\n"), `${namesLine(c)}-chat-${chat.createdAt.slice(0, 10)}.txt`.replace(/[^\w.&, -]+/g, "_"), "text/plain");
  }

  /* ---------- Assemble ---------- */
  chat.messages.forEach((m) => seen.add(m.id));
  drawHeader();
  drawIntro();
  render();
  requestAnimationFrame(() => toBottom(true));
  view.append(top, scroller, statusCard, composer);
  return view;
}

export function namesLine(cast) {
  const n = cast.map((c) => firstName(c.name));
  return n.length <= 2 ? n.join(" & ") : `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}`;
}

/* =========================================================
   app.js — app shell: theme, tab bar, router and the Chats tab.
   ========================================================= */
import { h, icon, iconBtn, avatar, toast, timeAgo, popover, haptic, sheet, toggle } from "./ui.js";
import { page, empty, noteRoute, resetStack } from "./layout.js";
import { getProfile, lib, recentChats, getCharacter, msgText } from "./store.js";
import { renderCharacters, renderCharacter, renderCharacterEditor, addSampleCharacter, openLatestChat, pickImportFile } from "./characters.js";
import { renderChat, newChatLike, namesLine } from "./chat.js";
import { renderStories, renderStory } from "./writer.js";
import { renderLore } from "./lore.js";
import { renderMe, renderMeProfile, renderMeLook, renderMeModel, renderMeData } from "./settings.js";
import { onStatus } from "./ai.js";

/* ---------- Theme ---------- */
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
export function applyTheme() {
  const p = getProfile();
  const root = document.documentElement;
  const theme = p.theme === "system" ? (darkMQ.matches ? "dark" : "light") : p.theme;
  root.dataset.theme = theme;
  root.style.setProperty("--accent", p.accent);
  const n = parseInt(p.accent.replace("#", ""), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  root.style.setProperty("--accent-ink", lum > 0.55 ? "#0f1511" : "#ffffff");
  root.dataset.read = p.readingFont;
  root.dataset.size = p.textSize;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0f1210" : "#f6f4ef");
}
darkMQ.addEventListener("change", applyTheme);

/* ---------- Chats tab (home) ---------- */
function renderChats() {
  const L = lib();
  const chats = recentChats().filter((c) => c.cast.some(getCharacter) && c.messages.length);

  const newMenu = (btn) => popover(btn, [
    L.characters.length ? { label: "New scene", icon: "users", onClick: newScene } : null,
    { label: "New character", icon: "plus", onClick: () => (location.hash = "#/c/new") },
    { label: "New story", icon: "pen", onClick: () => (location.hash = "#/stories") },
    { label: "Import characters", icon: "upload", onClick: pickImportFile },
    L.characters.length ? null : { label: "Add sample character", icon: "sparkles", onClick: addSampleCharacter },
  ]);
  const plus = iconBtn("plus", "New", (e) => newMenu(e.currentTarget), "ghost");

  // "Start a chat" strip, like stories on Instagram
  const strip = L.characters.length ? h("div", { class: "strip" },
    h("a", { class: "strip-item", href: "#/c/new" }, h("div", { class: "avatar lg add" }, icon("plus", 24)), h("span", {}, "New")),
    L.characters.map((c) => h("button", { class: "strip-item", type: "button", onClick: () => openLatestChat(c) },
      avatar(c, "lg ring"), h("span", {}, c.name.split(" ")[0])))) : null;

  const row = (c) => {
    const cast = c.cast.map(getCharacter).filter(Boolean);
    const last = c.messages[c.messages.length - 1];
    const who = last.role === "user" ? "You: " : cast.length > 1 || c.narrator ? `${last.speaker === "narrator" ? "Narrator" : (cast.find((x) => x.id === last.speaker) || cast[0]).name.split(" ")[0]}: ` : "";
    return h("a", { class: "convo", href: `#/chat/${c.id}` },
      cast.length > 1 ? h("div", { class: "stack-avatars md" }, cast.slice(0, 2).map((x) => avatar(x, "sm"))) : avatar(cast[0], "md"),
      h("div", { class: "convo-text" },
        h("div", { class: "convo-top" }, h("b", {}, cast.length > 1 ? namesLine(cast) : cast[0].name), h("span", {}, timeAgo(c.updatedAt))),
        h("div", { class: "convo-last" }, `${who}${msgText(last).replace(/[*]/g, "").replace(/\s+/g, " ").slice(0, 120)}`)));
  };

  let body;
  if (!L.characters.length) {
    body = empty("💬", "No chats yet",
      "Make a character to talk to. Or meet Wren, a sample character, to see how it works.",
      [h("a", { class: "btn primary wide", href: "#/c/new" }, "Create a character"),
        h("button", { class: "btn ghost wide", type: "button", onClick: addSampleCharacter }, "Meet Wren")]);
  } else if (!chats.length) {
    body = [strip, h("p", { class: "hint-center muted" }, "Tap someone above to start chatting.")];
  } else {
    body = [strip, h("div", { class: "convos" }, chats.map(row))];
  }

  return page({ title: "Chats", large: true, actions: [plus], body });
}

/* ---------- New group scene: pick the cast ---------- */
function newScene() {
  const chars = lib().characters;
  const picked = new Set();
  let narrator = true;
  const start = h("button", { class: "btn primary wide", type: "button", disabled: true, onClick: () => {
    const cast = chars.filter((c) => picked.has(c.id));
    s.close();
    newChatLike(cast, { narrator });
  } }, "Start scene");
  const sync = () => { start.disabled = !picked.size; start.textContent = picked.size ? `Start scene with ${picked.size}` : "Pick at least one"; };
  const s = sheet({
    title: "New scene",
    body: h("div", { class: "form" },
      h("p", { class: "muted small" }, "Pick who's in it. In the chat, tap anyone's photo to have them respond, or 📖 for the Narrator."),
      h("div", { class: "cast-pick" }, chars.map((c) => {
        const b = h("button", { class: "cast-opt", type: "button", "aria-pressed": "false", onClick: () => {
          picked.has(c.id) ? picked.delete(c.id) : picked.add(c.id);
          b.classList.toggle("on", picked.has(c.id)); b.setAttribute("aria-pressed", String(picked.has(c.id))); sync();
        } }, avatar(c, "sm"), h("span", {}, c.name), icon("check", 18));
        return b;
      })),
      h("div", { class: "group pad" }, toggle(narrator, (v) => { narrator = v; }, "📖 Include a Narrator"))),
    actions: [start],
  });
  sync();
}

/* ---------- Router ---------- */
const ROUTES = [
  [/^#\/(chats)?$/, () => renderChats(), "chats"],
  [/^#\/characters$/, () => renderCharacters(), "characters"],
  [/^#\/c\/new$/, () => renderCharacterEditor(null), null],
  [/^#\/c\/(\w+)\/edit$/, (m) => renderCharacterEditor(m[1]), null],
  [/^#\/c\/(\w+)$/, (m) => renderCharacter(m[1]), null, "characters"],
  [/^#\/chat\/(\w+)$/, (m) => renderChat(m[1]), null],
  [/^#\/stories$/, () => renderStories(), "stories"],
  [/^#\/story\/(\w+)$/, (m) => renderStory(m[1]), null],
  [/^#\/me$/, () => renderMe(), "me"],
  [/^#\/me\/profile$/, () => renderMeProfile(), null, "me"],
  [/^#\/me\/look$/, () => renderMeLook(), null, "me"],
  [/^#\/me\/model$/, () => renderMeModel(), null, "me"],
  [/^#\/me\/data$/, () => renderMeData(), null, "me"],
  [/^#\/lore$/, () => renderLore(), null, "me"],
];
// links from the previous version
const OLD = { "#/home": "#/chats", "#/write": "#/stories", "#/you": "#/me" };

const TABS = [
  ["chats", "#/chats", "message", "Chats"],
  ["characters", "#/characters", "users", "Characters"],
  ["stories", "#/stories", "pen", "Stories"],
  ["me", "#/me", "user", "Me"],
];

const viewHost = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
let current = null;
let currentTab = null;

tabbar.replaceChildren(
  h("div", { class: "brand", "aria-hidden": "true" }, h("img", { src: "icons/icon.svg", alt: "" })),
  ...TABS.map(([key, href, ic, label]) => h("a", {
    class: "tab", href, "data-tab": key,
    onClick: (e) => {
      haptic(5);
      // tapping the tab you're on scrolls to top
      if (key === currentTab && location.hash === href) { e.preventDefault(); viewHost.querySelector(".view-body")?.scrollTo({ top: 0, behavior: "smooth" }); }
    },
  }, icon(ic, 24), h("span", {}, label))));

function route() {
  let hash = location.hash || "#/chats";
  if (OLD[hash]) { location.replace(OLD[hash]); return; }
  let match = null, tab = null, owner = null, render = null;
  for (const [re, fn, t, o] of ROUTES) { match = hash.match(re); if (match) { render = fn; tab = t; owner = t || o; break; } }
  if (!render) { location.replace("#/chats"); return; }

  current?.onLeave?.();
  const dir = tab ? "tab" : noteRoute(hash);
  if (tab) resetStack(hash);
  const view = render(match);
  view.classList.add(dir === "tab" ? (currentTab === tab ? "enter-none" : "enter-fade") : dir === "back" ? "enter-back" : "enter-push");
  current = view;
  currentTab = tab;
  viewHost.replaceChildren(view);
  document.body.classList.toggle("immersive", !owner);
  tabbar.querySelectorAll(".tab").forEach((a) => a.classList.toggle("on", a.dataset.tab === owner));
}

/** Re-draw the current screen in place (after saves from sheets etc.) */
export function rerender() {
  const y = viewHost.querySelector(".view-body")?.scrollTop || 0;
  current?.onLeave?.();
  const hash = location.hash || "#/chats";
  for (const [re, fn] of ROUTES) {
    const m = hash.match(re);
    if (m) { current = fn(m); current.classList.add("enter-none"); viewHost.replaceChildren(current); break; }
  }
  viewHost.querySelector(".view-body")?.scrollTo?.(0, y);
}

window.addEventListener("hashchange", route);
window.addEventListener("mw:profile", () => { applyTheme(); rerender(); });
window.addEventListener("mw:storage-error", () =>
  toast("Storage is full. Export a backup, then delete old chats or use smaller pictures.", { type: "error", ms: 7000 }));

/* ---------- Global model progress line ---------- */
const topProgress = document.getElementById("top-progress");
onStatus((s) => {
  topProgress.hidden = s.state !== "loading";
  topProgress.firstElementChild.style.width = `${Math.round((s.progress || 0) * 100)}%`;
});

/* ---------- Boot ---------- */
applyTheme();
route();

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
}

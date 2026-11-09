/* =========================================================
   app.js — app shell: theme, tab bar, router and Home.
   ========================================================= */
import { h, icon, avatar, toast, timeAgo } from "./ui.js";
import { page, section, empty, noteRoute } from "./layout.js";
import { getProfile, lib, recentChats, getCharacter, msgText } from "./store.js";
import { renderCharacters, renderCharacter, renderCharacterEditor, addSampleCharacter } from "./characters.js";
import { renderChat } from "./chat.js";
import { renderStories, renderStory } from "./writer.js";
import { renderLore } from "./lore.js";
import { renderSettings } from "./settings.js";
import { onStatus } from "./ai.js";

/* ---------- Theme ---------- */
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
export function applyTheme() {
  const p = getProfile();
  const root = document.documentElement;
  const theme = p.theme === "system" ? (darkMQ.matches ? "dark" : "light") : p.theme;
  root.dataset.theme = theme;
  root.style.setProperty("--accent", p.accent);
  // readable text on top of the accent color
  const n = parseInt(p.accent.replace("#", ""), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  root.style.setProperty("--accent-ink", lum > 0.55 ? "#0f1511" : "#ffffff");
  root.dataset.read = p.readingFont;
  root.dataset.size = p.textSize;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0f1210" : "#f6f4ef");
}
darkMQ.addEventListener("change", applyTheme);

/* ---------- Home ---------- */
const MOODS = [
  "writing softly-lit chaos…", "plotting slow-burn trouble…", "banter first, feelings later…",
  "coffee, commas, and chemistry…", "one more chapter, then bed…", "the plot thickens…",
];

function renderHome() {
  const p = getProfile();
  const L = lib();
  const hr = new Date().getHours();
  const greet = hr < 5 ? "Up late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const chats = recentChats().filter((c) => getCharacter(c.characterId) && c.messages.length).slice(0, 6);
  const stories = [...L.stories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);

  const hero = h("div", { class: "home-hero" },
    h("h1", { class: "display" }, `${greet}, ${p.name || "writer"}`),
    h("p", { class: "muted mood" }, MOODS[Math.floor(Math.random() * MOODS.length)]));

  const chatRow = (c) => {
    const ch = getCharacter(c.characterId);
    const last = c.messages[c.messages.length - 1];
    return h("a", { class: "convo", href: `#/chat/${c.id}` },
      avatar(ch, "md"),
      h("div", { class: "convo-text" },
        h("div", { class: "row between" }, h("b", {}, ch.name), h("span", { class: "muted small" }, timeAgo(c.updatedAt))),
        h("div", { class: "convo-last" }, `${last.role === "user" ? "You: " : ""}${msgText(last).replace(/\s+/g, " ").slice(0, 110)}`)));
  };

  const people = L.characters.length
    ? h("div", { class: "people" },
      L.characters.slice(0, 12).map((c) => h("a", { class: "person", href: `#/c/${c.id}` }, avatar(c, "lg"), h("span", {}, c.name.split(" ")[0]))),
      h("a", { class: "person new", href: "#/c/new" }, h("div", { class: "avatar lg add" }, icon("plus", 26)), h("span", {}, "New")))
    : null;

  const onboarding = !L.characters.length ? h("div", { class: "card onboard" },
    h("h2", { class: "display small" }, "Welcome to your writing room ✨"),
    h("p", { class: "muted" }, "Everything here stays on this device, including the AI. Start by making a character to chat with, or meet a sample one to see how a good character card is put together."),
    h("div", { class: "row wrap" },
      h("a", { class: "btn primary", href: "#/c/new" }, icon("plus", 18), "Create a character"),
      h("button", { class: "btn ghost", type: "button", onClick: addSampleCharacter }, "Meet Wren (sample)"),
      h("a", { class: "btn ghost", href: "#/you" }, "Set your name"))) : null;

  return page({
    title: "", large: true, cls: "home",
    body: [
      hero,
      onboarding,
      people ? section("Characters", people, h("a", { class: "link", href: "#/characters" }, "See all")) : null,
      chats.length ? section("Pick up where you left off", h("div", { class: "convos" }, chats.map(chatRow))) : null,
      section("Stories", stories.length
        ? h("div", { class: "story-grid compact" }, stories.map((s) => h("a", { class: "story-card", href: `#/story/${s.id}` },
          h("div", { class: "story-card-title" }, s.title || "Untitled story"),
          h("div", { class: "story-card-snip" }, (s.content || s.premise || "Nothing written yet.").slice(-140)),
          h("div", { class: "story-card-meta" }, h("span", {}, timeAgo(s.updatedAt))))))
        : h("a", { class: "card ghost-card", href: "#/write" }, icon("pen", 20), h("span", {}, "Start a story with your characters")),
      stories.length ? h("a", { class: "link", href: "#/write" }, "All stories") : null),
    ],
  });
}

/* ---------- Router ---------- */
const ROUTES = [
  [/^#\/(home)?$/, () => renderHome(), "home"],
  [/^#\/characters$/, () => renderCharacters(), "characters"],
  [/^#\/c\/new$/, () => renderCharacterEditor(null), null],
  [/^#\/c\/(\w+)\/edit$/, (m) => renderCharacterEditor(m[1]), null],
  [/^#\/c\/(\w+)$/, (m) => renderCharacter(m[1]), "characters"],
  [/^#\/chat\/(\w+)$/, (m) => renderChat(m[1]), null],
  [/^#\/write$/, () => renderStories(), "write"],
  [/^#\/story\/(\w+)$/, (m) => renderStory(m[1]), null],
  [/^#\/lore$/, () => renderLore(), "lore"],
  [/^#\/you$/, () => renderSettings(), "you"],
];

const TABS = [
  ["home", "#/home", "home", "Home"],
  ["characters", "#/characters", "users", "Characters"],
  ["write", "#/write", "pen", "Write"],
  ["lore", "#/lore", "book", "Lore"],
  ["you", "#/you", "user", "You"],
];

const viewHost = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
let current = null;

tabbar.replaceChildren(
  h("div", { class: "brand", "aria-hidden": "true" }, h("img", { src: "icons/icon.svg", alt: "" })),
  ...TABS.map(([key, href, ic, label]) => h("a", { class: "tab", href, "data-tab": key }, icon(ic, 22), h("span", {}, label))));

function route() {
  const hash = location.hash || "#/home";
  let match = null, tab = null, render = null;
  for (const [re, fn, t] of ROUTES) { match = hash.match(re); if (match) { render = fn; tab = t; break; } }
  if (!render) { location.replace("#/home"); return; }

  current?.onLeave?.();
  noteRoute(hash);
  const view = render(match);
  current = view;
  viewHost.replaceChildren(view);
  document.body.classList.toggle("immersive", !tab);
  tabbar.querySelectorAll(".tab").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  // scroll each fresh tab view to the top
  view.querySelector(".view-body")?.scrollTo?.(0, 0);
}

/** Re-draw the current screen in place (after saves from sheets etc.) */
export function rerender() {
  const scroller = viewHost.querySelector(".view-body");
  const y = scroller?.scrollTop || 0;
  current?.onLeave?.();
  current = null;
  const hash = location.hash || "#/home";
  for (const [re, fn] of ROUTES) {
    const m = hash.match(re);
    if (m) { current = fn(m); viewHost.replaceChildren(current); break; }
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
document.body.classList.add("ready");

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

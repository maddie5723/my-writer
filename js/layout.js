/* =========================================================
   layout.js — shared page chrome & navigation helpers.
   ========================================================= */
import { h, iconBtn, icon, fillRange } from "./ui.js";
import { TONE_META, toneWord } from "./prompts.js";
import { onStatus } from "./ai.js";

/* ---------- Navigation with a tiny in-app history stack ---------- */
const stack = [];
let replacing = false;
/** Navigate without leaving the current page in history (after save/delete) */
export function replaceTo(hash) { replacing = true; location.replace(hash); }
/** Returns "back" | "forward" so the router can slide the right way */
export function noteRoute(hash) {
  if (replacing) { replacing = false; stack[stack.length - 1] = hash; return "back"; }
  if (stack.length > 1 && stack[stack.length - 2] === hash) { stack.pop(); return "back"; }
  if (stack[stack.length - 1] !== hash) stack.push(hash);
  return "forward";
}
export const resetStack = (hash) => { stack.length = 0; stack.push(hash); };
export const go = (hash) => { location.hash = hash; };
/** Back button: real history if we came from inside the app, otherwise a sensible parent */
export function goBack(fallback = "#/chats") {
  if (stack.length > 1) history.back();
  else { stack.length = 0; location.replace(fallback); }
}

/* ---------- Page frame ----------
   large: big title that scrolls away (tab roots)
   back:  fallback route for the ‹ button
   left:  custom left element (e.g. a "Cancel" button) */
export function page({ title, subtitle, back, left, actions = [], body, cls = "", large = false, under = null }) {
  const small = h("div", { class: "topbar-title" },
    h("h1", {}, title || ""),
    subtitle ? h("div", { class: "topbar-sub" }, subtitle) : null);
  const top = h("header", { class: `topbar ${large ? "is-large" : ""}` },
    left || (back ? iconBtn("back", "Back", () => goBack(back), "ghost back-btn") : h("span", { class: "topbar-spacer" })),
    small,
    h("div", { class: "topbar-actions" }, actions));
  const bigTitle = large ? h("h1", { class: "large-title" }, title) : null;
  const scroller = h("div", { class: "view-body" }, h("div", { class: "container" }, bigTitle, body));
  if (large) {
    // show the small centered title once the big one scrolls away (iOS style)
    scroller.addEventListener("scroll", () => top.classList.toggle("scrolled", scroller.scrollTop > 36), { passive: true });
  }
  return h("section", { class: `view ${cls}` }, top, under, scroller);
}

export function section(title, children, action) {
  return h("section", { class: "block" },
    title ? h("div", { class: "block-head" }, h("h2", {}, title), action || null) : null,
    children);
}

export function empty(emoji, title, text, actions = []) {
  return h("div", { class: "empty" },
    h("div", { class: "empty-emoji", "aria-hidden": "true" }, emoji),
    h("h3", {}, title),
    text ? h("p", { class: "muted" }, text) : null,
    actions.length ? h("div", { class: "stack" }, actions) : null);
}

/* ---------- Tone sliders (words, not just numbers) ---------- */
export function toneSliders(tone, onChange) {
  return h("div", { class: "tones" }, Object.entries(TONE_META).map(([k, m]) => {
    const val = h("span", { class: "tone-val" }, toneWord(k, tone[k]));
    const input = h("input", {
      type: "range", min: 0, max: 10, step: 0.5, value: tone[k], "aria-label": m.label,
      onInput: () => { tone[k] = +input.value; val.textContent = toneWord(k, tone[k]); onChange?.(tone); },
    });
    return h("div", { class: "tone" },
      h("div", { class: "tone-head" }, h("span", { class: "tone-emoji", "aria-hidden": "true" }, m.emoji), h("span", { class: "tone-label" }, m.label), val),
      fillRange(input),
      h("div", { class: "tone-ends" }, h("span", {}, m.low), h("span", {}, m.high)));
  }));
}

/* ---------- Live model status card (download progress / errors) ---------- */
export function modelStatusCard({ onRetry } = {}) {
  const bar = h("div", { class: "progress-fill" });
  const text = h("div", { class: "status-text" });
  const retry = h("button", { class: "btn small ghost", type: "button", onClick: () => onRetry?.() }, "Try again");
  const settingsBtn = h("a", { class: "btn small ghost", href: "#/me/model" }, "Change model");
  const card = h("div", { class: "model-status", hidden: true },
    h("div", { class: "row" }, icon("cpu", 18), text),
    h("div", { class: "progress" }, bar),
    h("div", { class: "row status-actions" }, retry, settingsBtn));
  let first = true;
  const unsub = onStatus((s) => {
    if (!first && !card.isConnected) { unsub(); return; }
    first = false;
    const show = s.state === "loading" || s.state === "error";
    card.hidden = !show;
    card.classList.toggle("error", s.state === "error");
    text.textContent = s.text || "";
    bar.style.width = `${Math.round((s.progress || 0) * 100)}%`;
    card.querySelector(".progress").hidden = s.state !== "loading";
    card.querySelector(".status-actions").hidden = s.state !== "error";
  });
  return card;
}

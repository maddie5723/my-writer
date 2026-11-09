/* =========================================================
   layout.js — shared page chrome & navigation helpers.
   ========================================================= */
import { h, iconBtn, icon } from "./ui.js";
import { TONE_META, toneWord } from "./prompts.js";
import { onStatus, status } from "./ai.js";

/* ---------- Navigation with a tiny in-app history stack ---------- */
const stack = [];
export function noteRoute(hash) {
  if (stack.length > 1 && stack[stack.length - 2] === hash) stack.pop();
  else if (stack[stack.length - 1] !== hash) stack.push(hash);
}
export const go = (hash) => { location.hash = hash; };
/** Back button: real history if we came from inside the app, otherwise a sensible parent */
export function goBack(fallback = "#/home") {
  if (stack.length > 1) history.back();
  else { stack.length = 0; location.replace(fallback); }
}

/* ---------- Page frame ---------- */
export function page({ title, subtitle, back, actions = [], body, cls = "", large = false, titleEl = null }) {
  const top = h("header", { class: `topbar ${large ? "large" : ""}` },
    back ? iconBtn("back", "Back", () => goBack(back), "ghost back-btn") : null,
    titleEl || h("div", { class: "topbar-title" },
      h("h1", {}, title),
      subtitle ? h("div", { class: "topbar-sub" }, subtitle) : null),
    h("div", { class: "topbar-actions" }, actions));
  const scroller = h("div", { class: "view-body" }, h("div", { class: "container" }, body));
  return h("section", { class: `view ${cls}` }, top, scroller);
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
    actions.length ? h("div", { class: "row center wrap" }, actions) : null);
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
      input,
      h("div", { class: "tone-ends" }, h("span", {}, m.low), h("span", {}, m.high)));
  }));
}

/* ---------- Live model status card (download progress / errors) ---------- */
export function modelStatusCard({ onRetry } = {}) {
  const bar = h("div", { class: "progress-fill" });
  const text = h("div", { class: "status-text" });
  const retry = h("button", { class: "btn small ghost", type: "button", onClick: () => onRetry?.() }, "Try again");
  const settingsBtn = h("a", { class: "btn small ghost", href: "#/you" }, "Settings");
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

export const modelBusyText = () => (status.state === "loading" ? `${Math.round(status.progress * 100)}%` : "");

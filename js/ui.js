/* =========================================================
   ui.js — tiny DOM toolkit: element builder, icons, toasts,
   sheets (dialogs), avatars and roleplay text formatting.
   Everything user-written goes in via textContent or is
   escaped first, so names with quotes/brackets never break
   the page.
   ========================================================= */

/** Create an element: h("div", {class:"x", onClick}, child, "text") */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v; // only ever used with trusted/escaped strings
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (["value", "checked", "disabled", "readOnly", "selected"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Icons (simple line icons, 24x24) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11.5h13V9"/><path d="M10 20.5v-6h4v6"/>',
  users: '<circle cx="9" cy="8" r="3.6"/><path d="M2.5 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M16 4.6a3.6 3.6 0 0 1 0 6.8"/><path d="M21.5 20.5c0-3-1.8-5.4-4.4-6.2"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  book: '<path d="M4 19V5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H20"/><path d="M8 7h8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  send: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  more: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5"/><path d="M20 3.5v5h-5"/>',
  edit: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3.5 6h17"/><path d="M8.5 6V4h7v2"/><path d="M6 6l1 14.5h10L18 6"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  message: '<path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.6A8.5 8.5 0 1 1 20.5 12Z"/>',
  forward: '<path d="M5 5l9 7-9 7Z"/><path d="M18 5v14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M4.5 20h15"/>',
  upload: '<path d="M12 16V5"/><path d="M7 9.5l5-5 5 5"/><path d="M4.5 20h15"/>',
  bookmark: '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4Z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement("span");
  span.className = "ic";
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return span;
}

/** Round icon-only button with an accessible label */
export function iconBtn(name, label, onClick, cls = "") {
  return h("button", { class: `icon-btn ${cls}`, type: "button", "aria-label": label, title: label, onClick }, icon(name));
}

/* ---------- Text helpers ---------- */
export function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Turn roleplay text into pretty HTML:
 *   *leans closer*  -> italic, softer "action" text
 *   "Hey."          -> speech
 *   **bold**        -> bold
 */
export function formatRP(text = "") {
  // one pass, so the markup we add can never be re-matched by a later rule
  return esc(text).replace(
    /\*\*([^*\n]+)\*\*|\*([^*\n][^*]*?)\*|(“[^”]*”|"[^"\n]*")/g,
    (m, bold, act, say) =>
      bold ? `<strong>${bold}</strong>` : act ? `<em class="act">${act}</em>` : `<span class="say">${say}</span>`);
}

export function initials(name = "?") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A stable, pleasant gradient picked from the name */
export function nameHue(name = "") {
  let x = 0;
  for (const c of name) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 360;
}

export function avatar(ch, cls = "") {
  if (ch?.avatar) {
    return h("img", { class: `avatar ${cls}`, src: ch.avatar, alt: "", loading: "lazy", decoding: "async" });
  }
  const hue = nameHue(ch?.name || "");
  return h("div", {
    class: `avatar avatar-initials ${cls}`,
    style: { background: `linear-gradient(140deg, hsl(${hue} 32% 42%), hsl(${(hue + 40) % 360} 30% 24%))` },
    "aria-hidden": "true",
  }, initials(ch?.name || "?"));
}

export function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Grow a textarea with its content */
export function autosize(ta, max = 9999) {
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight + 2, max) + "px";
  };
  ta.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return fit;
}

export function debounce(fn, ms = 400) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- Toasts ---------- */
export function toast(message, { type = "info", ms = 2600 } = {}) {
  let host = document.getElementById("toasts");
  if (!host) { host = h("div", { id: "toasts", "aria-live": "polite" }); document.body.append(host); }
  const t = h("div", { class: `toast ${type}` }, message);
  host.append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- Sheets (bottom sheet on phones, modal on desktop) ---------- */
export function sheet({ title, body, actions = [], onClose, wide = false } = {}) {
  const dlg = h("dialog", { class: `sheet ${wide ? "wide" : ""}` });
  const close = () => { if (dlg.open) dlg.close(); };
  const head = h("div", { class: "sheet-head" },
    h("div", { class: "sheet-grip", "aria-hidden": "true" }),
    h("h2", { class: "sheet-title" }, title || ""),
    iconBtn("x", "Close", close, "ghost"));
  const content = h("div", { class: "sheet-body" }, body);
  const foot = actions.length ? h("div", { class: "sheet-foot" }, actions) : null;
  dlg.append(...[head, content, foot].filter(Boolean));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // tap backdrop
  dlg.addEventListener("close", () => { onClose?.(); setTimeout(() => dlg.remove(), 250); });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close, content };
}

export function confirmDialog(message, { title = "Are you sure?", ok = "OK", cancel = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const s = sheet({
      title,
      body: h("p", { class: "muted" }, message),
      actions: [
        h("button", { class: "btn ghost", type: "button", onClick: () => s.close() }, cancel),
        h("button", { class: `btn ${danger ? "danger" : "primary"}`, type: "button", onClick: () => { result = true; s.close(); } }, ok),
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(title, { value = "", placeholder = "", ok = "Save" } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = h("input", { class: "input", value, placeholder });
    const submit = () => { result = input.value.trim(); s.close(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    const s = sheet({
      title,
      body: input,
      actions: [
        h("button", { class: "btn ghost", type: "button", onClick: () => s.close() }, "Cancel"),
        h("button", { class: "btn primary", type: "button", onClick: submit }, ok),
      ],
      onClose: () => resolve(result),
    });
    setTimeout(() => input.focus(), 50);
  });
}

/* ---------- Form building blocks ---------- */
export function field(label, control, hint) {
  return h("label", { class: "field" },
    h("span", { class: "field-label" }, label),
    hint ? h("span", { class: "field-hint" }, hint) : null,
    control);
}

export function segmented(options, value, onChange) {
  const wrap = h("div", { class: "seg", role: "radiogroup" });
  const render = (v) => {
    wrap.replaceChildren(...options.map(([val, label]) =>
      h("button", {
        type: "button", role: "radio", "aria-checked": String(val === v),
        class: val === v ? "on" : "",
        onClick: () => { render(val); onChange(val); },
      }, label)));
  };
  render(value);
  return wrap;
}

export function toggle(checked, onChange, label) {
  const input = h("input", { type: "checkbox", checked, onChange: () => onChange(input.checked) });
  return h("label", { class: "toggle" }, h("span", {}, label), input, h("span", { class: "toggle-ui", "aria-hidden": "true" }));
}

export function downloadFile(content, name, type = "application/json") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read an image file and shrink it so it doesn't eat all of localStorage */
export function imageToDataURL(file, max = 384) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), hgt = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = hgt;
      c.getContext("2d").drawImage(img, 0, 0, w, hgt);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image")); };
    img.src = url;
  });
}

/* ---------- Haptics (Android; harmless elsewhere) ---------- */
export function haptic(ms = 8) { try { navigator.vibrate?.(ms); } catch { /* ignore */ } }

/* ---------- Pop-up menu anchored to a button (instead of a full sheet) ---------- */
let openPop = null;
export function closePopover() {
  if (!openPop) return;
  const { menu, scrim, onKey } = openPop;
  openPop = null;
  document.removeEventListener("keydown", onKey);
  menu.classList.add("out"); scrim.remove();
  setTimeout(() => menu.remove(), 140);
}
/**
 * items: [{ label, icon, onClick, danger }] or "-" for a divider.
 */
export function popover(anchor, items, { align = "end", title } = {}) {
  closePopover();
  haptic();
  const list = items.filter(Boolean);
  const menu = h("div", { class: "popover", role: "menu" },
    title ? h("div", { class: "pop-title" }, title) : null,
    list.map((it) => it === "-"
      ? h("div", { class: "pop-sep", role: "separator" })
      : h("button", {
        class: `pop-item ${it.danger ? "danger" : ""}`, type: "button", role: "menuitem",
        onClick: () => { closePopover(); it.onClick(); },
      }, h("span", {}, it.label), it.icon ? icon(it.icon, 19) : null)));
  const scrim = h("div", { class: "pop-scrim", onClick: closePopover, onTouchmove: closePopover });
  document.body.append(scrim, menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = align === "end" ? r.right - mw : r.left;
  left = Math.min(Math.max(10, left), innerWidth - mw - 10);
  let top = r.bottom + 6, fromTop = true;
  if (top + mh > innerHeight - 10) { top = Math.max(10, r.top - mh - 6); fromTop = false; }
  Object.assign(menu.style, { left: `${left}px`, top: `${top}px`, transformOrigin: `${align === "end" ? "right" : "left"} ${fromTop ? "top" : "bottom"}` });

  const onKey = (e) => { if (e.key === "Escape") closePopover(); };
  document.addEventListener("keydown", onKey);
  openPop = { menu, scrim, onKey };
  menu.querySelector(".pop-item")?.focus({ preventScroll: true });
}
window.addEventListener("hashchange", closePopover);

/* ---------- Tabs inside a screen or sheet ---------- */
export function tabs(items, initial = 0) {
  const bar = h("div", { class: "subtabs", role: "tablist" });
  const panel = h("div", { class: "subtab-panel" });
  let cur = -1;
  const select = (i) => {
    if (i === cur) return;
    cur = i;
    [...bar.children].forEach((b, j) => { b.classList.toggle("on", j === i); b.setAttribute("aria-selected", String(j === i)); });
    panel.replaceChildren(items[i].render());
    panel.scrollTop = 0;
  };
  items.forEach((it, i) => bar.append(h("button", { type: "button", role: "tab", onClick: () => { haptic(5); select(i); } }, it.label)));
  select(initial);
  return { bar, panel, select };
}

/** iOS-settings style grouped list row */
export function navRow({ icon: ic, label, detail, href, onClick, danger }) {
  const inner = [
    ic ? h("span", { class: "nav-row-ic" }, icon(ic, 19)) : null,
    h("span", { class: "nav-row-label" }, label),
    detail ? h("span", { class: "nav-row-detail" }, detail) : null,
    href || onClick ? icon("chevronRight", 18) : null,
  ];
  return href
    ? h("a", { class: `nav-row ${danger ? "danger" : ""}`, href }, inner)
    : h("button", { class: `nav-row ${danger ? "danger" : ""}`, type: "button", onClick }, inner);
}
export const group = (...rows) => h("div", { class: "group" }, rows);

/** Colour a range slider's track up to the thumb */
export function fillRange(el) {
  const upd = () => {
    const min = +el.min || 0, max = +el.max || 100;
    el.style.setProperty("--fill", `${((+el.value - min) / (max - min)) * 100}%`);
  };
  el.addEventListener("input", upd);
  upd();
  return el;
}

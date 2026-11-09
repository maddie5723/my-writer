/* =========================================================
   lore.js — world info that gets added to the AI's notes
   automatically when its keywords come up.
   ========================================================= */
import { h, icon, toast, sheet, confirmDialog, autosize, field, segmented, toggle } from "./ui.js";
import { page, empty } from "./layout.js";
import { lib, saveLore, deleteLore, normalizeLore } from "./store.js";
import { rerender } from "./app.js";

export function renderLore() {
  const entries = lib().lore;

  const card = (e) => h("button", { class: `lore-card ${e.enabled ? "" : "off"}`, type: "button", onClick: () => editLore(e) },
    h("div", { class: "row between" },
      h("div", { class: "lore-title" }, e.title),
      h("span", { class: `badge ${e.mode === "always" ? "gold" : ""}` }, !e.enabled ? "Off" : e.mode === "always" ? "Always on" : "On keywords")),
    e.keywords.length ? h("div", { class: "chips" }, e.keywords.slice(0, 6).map((k) => h("span", { class: "chip" }, k))) : null,
    h("div", { class: "lore-snip" }, e.content.slice(0, 160) || "No details yet."));

  return page({
    title: "Lorebook", large: true,
    actions: [h("button", { class: "btn primary small", type: "button", onClick: () => editLore() }, icon("plus", 18), "New")],
    body: [
      h("p", { class: "muted intro" }, "Places, history, factions, rules of magic… When an entry's keywords show up in a chat or story, the AI quietly gets that entry as background notes."),
      entries.length
        ? h("div", { class: "lore-grid" }, entries.map(card))
        : empty("📚", "Your world, written down", "Add an entry for anything the AI should know about your setting.",
          [h("button", { class: "btn primary", type: "button", onClick: () => editLore() }, "Add first entry")]),
    ],
  });
}

function editLore(existing = null) {
  const e = structuredClone(existing || normalizeLore({ title: "" }));
  if (!existing) e.title = "";

  const title = h("input", { class: "input", placeholder: "e.g. The Gilded Quarter", value: e.title, onInput: () => { e.title = title.value; } });
  const keys = h("input", { class: "input", placeholder: "gilded quarter, the quarter, guild", value: e.keywords.join(", "),
    onInput: () => { e.keywords = keys.value.split(",").map((s) => s.trim()).filter(Boolean); } });
  const content = h("textarea", { class: "input", rows: 5, value: e.content, placeholder: "What should the AI know? Keep it factual and tight.",
    onInput: () => { e.content = content.value; } });
  autosize(content, 360);

  const s = sheet({
    title: existing ? "Edit entry" : "New entry",
    body: h("div", { class: "form" },
      field("Title", title),
      field("When to include", segmented([["keywords", "When keywords appear"], ["always", "Always"]], e.mode, (v) => { e.mode = v; })),
      field("Keywords", keys, "Comma separated. Matched as whole words, not case-sensitive."),
      field("Details", content),
      toggle(e.enabled, (v) => { e.enabled = v; }, "Enabled")),
    actions: [
      existing ? h("button", { class: "btn danger-ghost", type: "button", onClick: async () => {
        if (await confirmDialog(`"${existing.title}" will be deleted.`, { title: "Delete entry?", ok: "Delete", danger: true })) {
          deleteLore(existing.id); s.close(); rerender(); toast("Deleted");
        }
      } }, "Delete") : null,
      h("span", { class: "grow" }),
      h("button", { class: "btn primary", type: "button", onClick: () => {
        if (!e.title.trim()) { toast("Give it a title", { type: "error" }); title.focus(); return; }
        saveLore(e); s.close(); rerender(); toast("Saved");
      } }, "Save"),
    ].filter(Boolean),
  });
}

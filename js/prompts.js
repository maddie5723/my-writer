/* =========================================================
   prompts.js — how characters, stories, tone and lore get
   turned into instructions for the model.

   Why characters now feel more like themselves:
   1. The model is told its NAME and who YOU are (old version never sent the name!).
   2. "How they talk" + example lines anchor the voice.
   3. A short reminder rides along with your latest message, which is
      where small models pay the most attention.
   4. History is trimmed to fit the 4k memory so the character sheet is
      never pushed out by a long chat.
   5. If the model starts writing YOUR lines, that part is cut off.
   ========================================================= */
import { CONTEXT_TOKENS } from "./ai.js";
import { msgText } from "./store.js";

/* ---------- Tone sliders → plain words the model understands ---------- */
export const TONE_META = {
  heat: { label: "Romance", emoji: "❤️", low: "Wholesome", high: "Spicy" },
  realism: { label: "Realism", emoji: "🧭", low: "Stylized", high: "Grounded" },
  violence: { label: "Violence", emoji: "🗡️", low: "Implied", high: "Graphic" },
  creativity: { label: "Creativity", emoji: "✨", low: "Predictable", high: "Surprising" },
};

const pick = (v, steps) => steps[Math.min(steps.length - 1, Math.floor((v / 10.0001) * steps.length))];

export function toneWord(key, v) {
  const words = {
    heat: ["Wholesome", "Sweet", "Flirty", "Steamy", "Spicy"],
    realism: ["Cinematic", "Stylized", "Balanced", "Grounded", "Documentary"],
    violence: ["Off-screen", "Implied", "Moderate", "Intense", "Graphic"],
    creativity: ["Literal", "Steady", "Balanced", "Inventive", "Wild"],
  };
  return pick(v, words[key]);
}

function toneInstructions(t) {
  return [
    pick(t.heat, [
      "Romance: none beyond friendly warmth.",
      "Romance: sweet and light; small moments of affection at most.",
      "Romance: flirting and chemistry are welcome; keep intimate moments brief or fade to black.",
      "Romance: sensual tension is welcome and intimate moments can be described with feeling.",
      "Romance: explicit intimacy between the consenting adults is allowed when the scene genuinely leads there.",
    ]),
    pick(t.realism, [
      "Realism: larger than life and cinematic; dramatic beats and heightened emotion are fine.",
      "Realism: a little stylized; vivid but believable.",
      "Realism: believable people with a touch of drama.",
      "Realism: grounded; people react the way real people do, with real hesitation and imperfection.",
      "Realism: fully grounded and documentary-like; mundane details, awkward pauses, no movie clichés.",
    ]),
    pick(t.violence, [
      "Violence: keep any violence off-screen.",
      "Violence: imply it; no injuries described.",
      "Violence: it can happen on-page without lingering on gore.",
      "Violence: intense and visceral when the story calls for it.",
      "Violence: graphic detail is allowed when the story calls for it.",
    ]),
    pick(t.creativity, [
      "Creativity: stay literal and predictable; follow the user's lead exactly.",
      "Creativity: mostly follow the user's lead, with small touches of your own.",
      "Creativity: follow the user's lead but add your own ideas and details.",
      "Creativity: take initiative; introduce complications, choices and surprises.",
      "Creativity: be bold and surprising; drive the story in unexpected directions.",
    ]),
  ].join("\n");
}

/** Slider "creativity" nudges the base temperature from Settings */
export function temperatureFor(base, tone) {
  return Math.min(1.35, Math.max(0.3, base + (tone.creativity - 5) * 0.05));
}

/* ---------- Helpers ---------- */
export const estTokens = (s = "") => Math.ceil(s.length / 3.6) + 4;

/** Supports the common {{char}} / {{user}} placeholders */
export function fill(text = "", charName = "", userName = "") {
  return String(text)
    .replace(/\{\{\s*char\s*\}\}/gi, charName)
    .replace(/\{\{\s*user\s*\}\}/gi, userName)
    .replace(/<(BOT|CHAR)>/g, charName)
    .replace(/<USER>/g, userName);
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lore entries that are "always on" or whose keywords appear in recent text */
export function matchLore(entries, recentText) {
  const hay = recentText.toLowerCase();
  const hits = entries.filter((e) => e.enabled && e.content.trim() && (
    e.mode === "always" ||
    e.keywords.some((k) => k && new RegExp(`(^|\\W)${reEscape(k.toLowerCase())}(\\W|$)`).test(hay))
  ));
  let used = 0;
  const out = [];
  for (const e of hits) {
    const block = `• ${e.title}: ${e.content.trim()}`;
    if (used + block.length > 2200) break;
    out.push(block); used += block.length;
  }
  return out;
}

/** Build a system prompt from sections, trimming the least important first if it's too long */
function assemble(sections, maxChars) {
  const live = sections.filter((s) => s.body && s.body.trim());
  const total = () => live.reduce((n, s) => n + s.title.length + s.body.length + 4, 0);
  const byLowPriority = [...live].sort((a, b) => a.priority - b.priority);
  for (const s of byLowPriority) {
    if (total() <= maxChars) break;
    if (s.priority >= 9) continue; // never trim core rules/identity
    const over = total() - maxChars;
    const keep = Math.max(0, s.body.length - over - 20);
    s.body = keep > 80 ? s.body.slice(0, keep).replace(/\s+\S*$/, "") + " …" : "";
  }
  return live.filter((s) => s.body).map((s) => (s.title ? `## ${s.title}\n${s.body.trim()}` : s.body.trim())).join("\n\n");
}

const LENGTHS = {
  roleplay: {
    short: { tokens: 160, rule: "Keep replies short: 1–3 sentences." },
    medium: { tokens: 320, rule: "Reply in one or two paragraphs." },
    long: { tokens: 600, rule: "Write a rich reply of two to four paragraphs." },
  },
  texting: {
    short: { tokens: 80, rule: "Send one short text." },
    medium: { tokens: 150, rule: "Send one to three short texts." },
    long: { tokens: 260, rule: "Send a few texts; it's fine to ramble a little if that's in character." },
  },
};

/* ---------- Chat prompt ---------- */
export function buildChatPrompt({ ch, chat, profile, settings, lore, extraUserText = null }) {
  const name = ch.name;
  const user = profile.name?.trim() || "User";
  const f = (t) => fill(t, name, user);
  const mode = chat.mode;
  const len = LENGTHS[mode][chat.length];
  const maxTokens = len.tokens;

  const recent = [...chat.messages.slice(-4).map(msgText), extraUserText || ""].join("\n");
  const loreHits = matchLore(lore, recent + "\n" + chat.direction);

  const formatRule = mode === "texting"
    ? `This is a text-message conversation on your phones. Reply exactly the way ${name} texts: their slang, their punctuation habits, emoji only if it suits them. No narration, no actions, no asterisks. Separate multiple texts with a blank line.`
    : `Describe ${name}'s actions, expressions and body language in *asterisks* and put spoken words in "quotes". Show feelings through behavior and subtext, not by announcing them.`;

  const rules = [
    `- You ARE ${name}. Stay in character no matter what. React the way ${name} genuinely would, with their own opinions, moods, flaws and agenda — not as a helpful assistant.`,
    `- Never write ${user}'s dialogue, actions, thoughts or feelings. Stop at a natural point where it's ${user}'s turn.`,
    `- Keep ${name}'s voice consistent with "How ${name} talks" and the example lines below.`,
    `- ${formatRule}`,
    `- ${len.rule}`,
    "- Move the scene forward. Don't repeat earlier lines or phrases. Don't summarize.",
    "- No meta commentary, disclaimers, or mentions of being an AI.",
    settings.profanity === "allow" ? `- Swearing is fine when it fits ${name}; don't overdo it.` : "- Avoid profanity.",
  ].join("\n");

  const sections = [
    { title: "", priority: 10, body: `You are ${name}, in a private, fictional, ongoing roleplay with ${user}. You write only ${name}'s side.` },
    { title: `Who ${name} is`, priority: 9, body: f(ch.summary) },
    { title: `${name}'s personality`, priority: 8, body: f(ch.personality) },
    { title: `How ${name} talks`, priority: 8, body: f(ch.speech) },
    { title: `${name}'s appearance`, priority: 4, body: f(ch.appearance) },
    { title: `About ${user}`, priority: 6, body: f(profile.persona) },
    { title: "The situation", priority: 7, body: f(ch.scenario) },
    { title: `What ${name} remembers`, priority: 8, body: f(chat.memory) },
    { title: "World notes", priority: 3, body: loreHits.join("\n") },
    { title: `Examples of ${name}'s voice (for style only — don't repeat them)`, priority: 5, body: f(ch.examples) },
    { title: "Tone", priority: 9, body: toneInstructions(chat.tone) },
    { title: "Writing style", priority: 6, body: [f(ch.style), settings.globalStyle].filter(Boolean).join("\n") },
    { title: "Content boundaries", priority: 9, body: f(ch.boundaries) },
    { title: "Rules", priority: 10, body: rules },
  ];

  // Budget: 4096 total = system + history + reply + a little slack
  const budget = CONTEXT_TOKENS - maxTokens - 96;
  const system = assemble(sections, Math.floor(budget * 0.5 * 3.6));

  // Reminder rides with the latest user turn (WebLLM only allows one system message, at the top)
  const voiceCue = (f(ch.speech) || f(ch.personality)).replace(/\s+/g, " ").slice(0, 180);
  const reminder = `[Reply as ${name} only${voiceCue ? ` — remember: ${voiceCue}` : ""}. Don't write ${user}'s part.${chat.direction ? ` Direction for this reply: ${chat.direction}` : ""}]`;

  // Turn stored messages into model turns (merge same-role neighbours; must end with a user turn)
  const raw = chat.messages.map((m) => ({ role: m.role, content: msgText(m) || "…" }));
  if (extraUserText) raw.push({ role: "user", content: extraUserText });
  if (!raw.length || raw[raw.length - 1].role !== "user") raw.push({ role: "user", content: "(Continue.)" });

  let room = budget - estTokens(system) - estTokens(reminder);
  const kept = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    const cost = estTokens(raw[i].content);
    if (cost > room && kept.length) break;
    kept.unshift(raw[i]);
    room -= cost;
  }
  const droppedCount = raw.length - kept.length;
  if (kept[0]?.role === "assistant") kept.unshift({ role: "user", content: "(The scene begins.)" });

  const merged = [];
  for (const m of kept) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ ...m });
  }
  merged[merged.length - 1].content += "\n\n" + reminder;

  return {
    messages: [{ role: "system", content: system }, ...merged],
    maxTokens,
    // index of the first stored message the model can still "see" (for the memory divider)
    firstVisibleIndex: droppedCount,
    stop: [`\n${user}:`, `\n**${user}**:`, "\nUser:", "<|im_end|>"],
    system,
  };
}

/** Clean up a reply: drop "Name:" prefixes and anything where it starts speaking for the user */
export function cleanReply(text, charName, userName) {
  let t = text;
  const names = [charName, charName.split(/\s+/)[0]].filter(Boolean).map(reEscape).join("|");
  t = t.replace(new RegExp(`^\\s*\\**(${names})\\**\\s*:\\s*`, "i"), "");
  t = t.replace(/^\s*\[(Reply as|Direction)[^\]]*\]\s*/i, "");
  const userLine = new RegExp(`\\n\\s*\\**(${reEscape(userName)}|User|You)\\**\\s*:`, "i");
  const cut = t.search(userLine);
  if (cut > 0) t = t.slice(0, cut);
  return t.replace(/\s+$/, "").replace(/^\s+/, "");
}

/* ---------- Story prompt ---------- */
const CHUNKS = {
  short: { tokens: 450, words: "about 300 words" },
  medium: { tokens: 900, words: "about 600 words" },
  long: { tokens: 1500, words: "about 1,000 words" },
};

export function buildStoryPrompt({ story, cast, profile, settings, lore, continuing }) {
  const user = profile.name?.trim() || "the reader";
  const chunk = CHUNKS[story.chunk];
  const povText = { first: "first person (\"I\")", second: "second person (\"you\")", third: "third person" }[story.pov];

  const castText = cast.map((c) => {
    const f = (t) => fill(t, c.name, user);
    return [
      `### ${c.name}`,
      c.summary && f(c.summary),
      c.personality && `Personality: ${f(c.personality)}`,
      c.speech && `Voice: ${f(c.speech)}`,
      c.appearance && `Looks: ${f(c.appearance)}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const loreHits = matchLore(lore, [story.premise, story.direction, story.content.slice(-1500)].join("\n"));

  const sections = [
    { title: "", priority: 10, body: "You are a skilled fiction writer. Write immersive, vivid prose with natural dialogue, sensory detail and subtext. Characters must sound like themselves." },
    { title: "Format", priority: 10, body: `Write in ${povText}, ${story.tense} tense. Write ${chunk.words}. Output only the story text — no titles, notes, or commentary.` },
    { title: "Premise / outline", priority: 9, body: story.premise },
    { title: "Characters", priority: 8, body: castText },
    { title: "World notes", priority: 4, body: loreHits.join("\n") },
    { title: "Tone", priority: 9, body: toneInstructions(story.tone) },
    { title: "Style", priority: 6, body: [story.style, settings.globalStyle].filter(Boolean).join("\n") },
    { title: "Content", priority: 9, body: "All characters are adults (21+) and everything is consensual." + (settings.profanity === "allow" ? " Swearing is fine when natural." : " Avoid profanity.") },
  ];

  const budget = CONTEXT_TOKENS - chunk.tokens - 96;
  const system = assemble(sections, Math.floor(budget * 0.45 * 3.6));

  let userMsg;
  const dir = story.direction?.trim() ? `\n\nWhat should happen next: ${story.direction.trim()}` : "";
  if (continuing && story.content.trim()) {
    const room = (budget - estTokens(system) - 120) * 3.6;
    let tail = story.content.slice(-Math.max(400, Math.floor(room)));
    if (tail.length < story.content.length) tail = "…" + tail.replace(/^\S*\s/, "");
    userMsg = `Here is the story so far (the most recent part):\n\n${tail}\n\nContinue the story from exactly where it stops, with the next paragraphs. Don't repeat or summarize what already happened.${dir}`;
  } else {
    userMsg = `Write the opening of this story${story.title ? `, titled "${story.title}"` : ""}.${dir}`;
  }

  return {
    messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
    maxTokens: chunk.tokens,
  };
}

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
import { contextTokens } from "./ai.js";
import { msgText } from "./store.js";

/* ---------- Tone sliders → plain words the model understands ---------- */
export const TONE_META = {
  heat: { label: "Romance", emoji: "❤️", low: "Wholesome", high: "Spicy" },
  realism: { label: "Realism", emoji: "🧭", low: "Stylized", high: "Grounded" },
  violence: { label: "Violence", emoji: "🗡️", low: "Implied", high: "Graphic" },
  creativity: { label: "Creativity", emoji: "✨", low: "Predictable", high: "Surprising" },
  warmth: { label: "Warmth toward you", emoji: "🧡", low: "Guarded", high: "Smitten", chatOnly: true },
};

const pick = (v, steps) => steps[Math.min(steps.length - 1, Math.floor((v / 10.0001) * steps.length))];

export function toneWord(key, v) {
  const words = {
    heat: ["Wholesome", "Sweet", "Flirty", "Steamy", "Spicy"],
    realism: ["Cinematic", "Stylized", "Balanced", "Grounded", "Documentary"],
    violence: ["Off-screen", "Implied", "Moderate", "Intense", "Graphic"],
    creativity: ["Literal", "Steady", "Balanced", "Inventive", "Wild"],
    warmth: ["Guarded", "Friendly", "Warm", "Affectionate", "Smitten"],
  };
  return pick(v, words[key]);
}

/** How the character treats the user (chats only) */
function warmthInstruction(v, user, pr = { obj: "them" }) {
  return pick(v, [
    `Warmth toward ${user}: guarded and prickly; trust has to be earned. Never cruel.`,
    `Warmth toward ${user}: friendly and easygoing, with some teasing.`,
    `Warmth toward ${user}: warm. Teasing is affectionate, never mean. Whatever mood the character is in, it's aimed at the situation, never at ${user}. Small kindnesses show they care.`,
    `Warmth toward ${user}: openly affectionate and soft with ${pr.obj}, protective, tuned in to how ${user} is doing. Banter is playful and loving.`,
    `Warmth toward ${user}: completely gone for ${pr.obj}. They soften the second ${user} is around and can't hide how much they adore ${pr.obj}, while still being fully themselves.`,
  ]);
}

function toneInstructions(t, user = null, pr) {
  return [
    user ? warmthInstruction(t.warmth ?? 6, user, pr) : null,
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
  ].filter(Boolean).join("\n");
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


/* ---------- Who's who ---------- */
export const firstName = (n = "") => n.trim().split(/\s+/)[0] || n;

/** "Maddie is 25 years old (she/her)" + a rule so nobody treats an adult like a kid */
export function userIdentity(profile) {
  const user = profile.name?.trim() || "User";
  const bits = [];
  if (profile.age) bits.push(`${profile.age} years old`);
  if (profile.pronouns) bits.push(`uses ${profile.pronouns} pronouns`);
  const line = bits.length ? `${user} ${bits.join(" and ")}.` : "";
  const adult = profile.age ? `Treat ${user} as the ${profile.age}-year-old adult they are.` : "";
  return { user, line, adult };
}

/** subject / object / possessive / reflexive pronouns for the user (falls back to they) */
export function userPronouns(profile) {
  const p = String(profile.pronouns || "").toLowerCase();
  if (/\bshe\b|\bher\b/.test(p)) return { subj: "she", obj: "her", poss: "her", self: "herself" };
  if (/\bhe\b|\bhim\b/.test(p)) return { subj: "he", obj: "him", poss: "his", self: "himself" };
  return { subj: "they", obj: "them", poss: "their", self: "themself" };
}

/** Everything the user never wants, from Me, the characters and this chat */
export function avoidList({ profile, cast = [], chat }) {
  const lines = [];
  const user = profile.name?.trim() || "User";
  const add = (t, f = (x) => x) => String(t || "").split(/\n+/).map((x) => f(x.trim())).filter(Boolean).forEach((x) => lines.push(x.replace(/^[-•*]\s*/, "")));
  add(fill(profile.avoid, "", user));
  cast.forEach((c) => add(fill(c.avoid, c.name, user), (x) => (x ? `${c.name}: ${x}` : "")));
  add(fill(chat?.avoid, cast[0]?.name || "", user));
  const banned = bannedWords(profile);
  if (banned.length) lines.push(`Never use these words: ${banned.join(", ")}.`);
  return lines;
}
export const bannedWords = (profile) => String(profile.banned || "").split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

/** Returns the first banned word found in text, or null */
export function bannedHit(text, profile) {
  for (const w of bannedWords(profile)) {
    if (new RegExp(`(^|[^\\p{L}])${reEscape(w)}([^\\p{L}]|$)`, "iu").test(text)) return w;
  }
  return null;
}

/** Cast members whose name (or first name) appears in text */
export function mentioned(text, cast) {
  return cast.filter((c) => new RegExp(`(^|[^\\p{L}])(${reEscape(c.name)}|${reEscape(firstName(c.name))})([^\\p{L}]|$)`, "iu").test(text));
}

/** Who should answer the user's message? Someone they named, else whoever spoke last */
export function pickSpeaker(chat, cast, userText = "") {
  if (cast.length <= 1) return cast[0];
  const named = mentioned(userText, cast);
  if (named.length) return named[0];
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m.role === "assistant" && m.speaker && m.speaker !== "narrator") {
      const c = cast.find((x) => x.id === m.speaker);
      if (c) return c;
    }
  }
  return cast[0];
}

export function speakerName(m, cast) {
  if (m.speaker === "narrator") return "Narrator";
  return (cast.find((c) => c.id === m.speaker) || cast[0])?.name || "Character";
}

/** How freely characters can talk (Me → AI model → Swearing) */
export function swearRule(settings) {
  if (settings.profanity === "avoid") return "- Avoid profanity.";
  if (settings.profanity === "unfiltered") return "- Don't censor how characters talk: swearing, crude humor, innuendo and dirty jokes are welcome whenever they fit the character.";
  return "- Characters swear naturally, as much as they really would. Don't tone it down.";
}

/* Slow-burn stages: how far the relationship has gone. The user moves it forward. */
export const ARC_LABELS = { friends: "Friends", tension: "Tension", confessed: "Confessed", together: "Together" };
const ARC_TEXT = {
  friends: "Best friends. Comfortable, teasing and fiercely loyal, with years of history and inside jokes. Any attraction stays hidden: a look that lingers a beat too long, protectiveness that's a little too much, something almost said and then joked away. Nothing romantic happens yet.",
  tension: "The tension is getting hard to ignore. Almost-moments, jealousy they won't admit to, touches that last a second too long, late-night talks that get too close and get deflected. Neither of them has said it out loud yet.",
  confessed: "The feelings are out in the open now. It's new, nervous and intense; they're figuring out what this is without losing the friendship. Show the vulnerability and the years of history behind it.",
  together: "They're together. Comfortable and affectionate but still completely themselves: banter, inside jokes, protectiveness, and the danger of the job never goes away.",
};

const LENGTHS = {
  prose: {
    short: { tokens: 240, rule: "Write one rich paragraph." },
    medium: { tokens: 440, rule: "Write two or three paragraphs, like part of a fanfic chapter." },
    long: { tokens: 760, rule: "Write a full scene of four or more paragraphs." },
  },
  roleplay: {
    short: { tokens: 160, rule: "Keep it short: 1–3 sentences." },
    medium: { tokens: 320, rule: "Write one or two paragraphs." },
    long: { tokens: 600, rule: "Write a rich passage of two to four paragraphs." },
  },
  texting: {
    short: { tokens: 80, rule: "Send one short text." },
    medium: { tokens: 150, rule: "Send one to three short texts." },
    long: { tokens: 260, rule: "Send a few texts; it's fine to ramble a little if that's in character." },
  },
};

/* ---------- Chat / scene prompt ----------
   speaker: a character from cast, or "narrator" */
export function buildChatPrompt({ chat, cast, speaker, profile, settings, lore, extraUserText = null }) {
  const isNarrator = speaker === "narrator";
  const me = isNarrator ? null : (speaker || cast[0]);
  const name = isNarrator ? "the Narrator" : me.name;
  const { user, line: userLine, adult } = userIdentity(profile);
  const pr = userPronouns(profile);
  const group = cast.length > 1 || chat.narrator;
  const f = (t, c = me || cast[0]) => fill(t, c?.name || "", user);
  const mode = isNarrator ? "roleplay" : chat.mode;
  const len = LENGTHS[mode][chat.length];
  const maxTokens = len.tokens;
  const others = cast.filter((c) => c !== me);
  const avoids = avoidList({ profile, cast, chat });

  const recent = [...chat.messages.slice(-4).map(msgText), extraUserText || ""].join("\n");
  const loreHits = matchLore(lore, recent + "\n" + chat.direction);

  /* who is in the scene */
  const castSections = [];
  if (!group) {
    castSections.push(
      { title: `Who ${me.name} is`, priority: 9, body: f(me.summary) },
      { title: `${me.name}'s personality`, priority: 8, body: f(me.personality) },
      { title: `How ${me.name} talks`, priority: 8, body: f(me.speech) },
      { title: `${me.name}'s appearance`, priority: 4, body: f(me.appearance) },
      { title: `Examples of ${me.name}'s voice (for style only — don't repeat them)`, priority: 5, body: f(me.examples) });
  } else {
    // the current speaker's sheet is kept most complete; others can be trimmed first
    for (const c of [me, ...others].filter(Boolean)) {
      const isMe = c === me;
      castSections.push({
        title: c.name + (isMe ? " (writing as them this turn)" : ""),
        priority: isMe ? 8 : 6,
        body: [
          f(c.summary, c),
          c.personality && `Personality: ${f(c.personality, c)}`,
          c.speech && `How they talk: ${f(c.speech, c)}`,
          c.appearance && `Looks: ${f(c.appearance, c)}`,
        ].filter(Boolean).join("\n"),
      });
      if (c.examples) castSections.push({ title: `Examples of ${c.name}'s voice (style only)`, priority: isMe ? 5 : 2, body: f(c.examples, c) });
    }
  }

  const formatRule = mode === "prose"
    ? `Write like a chapter of a fanfic, told in second person present tense from ${user}'s point of view ("you" = ${user}). Weave together the setting, small sensory details, ${name}'s body language and what he or she is clearly feeling but not saying, and ${name}'s dialogue in "quotes". Never decide what ${user} says, does, thinks or chooses beyond what ${pr.subj} wrote; you can describe what ${pr.subj} sees, hears and feels around ${pr.obj}. End on a beat that invites ${pr.obj} to respond.`
    : isNarrator
    ? `Write as the Narrator: third person, present tense. Describe the setting, atmosphere, sounds, smells, tension, and what the cast visibly does. At most a line or two of dialogue from the cast. Never write ${user}'s words, actions or feelings. End on a moment that invites ${user} to act.`
    : mode === "texting"
      ? `This is a text-message conversation. Write exactly the way ${name} texts: their slang, punctuation habits, emoji only if it suits them. No narration, no actions, no asterisks. Separate multiple texts with a blank line.`
      : `Describe ${name}'s actions, expressions and body language in *asterisks* and put spoken words in "quotes". Show feelings through behavior and subtext, not by announcing them.`;

  const rules = [
    isNarrator
      ? `- You are the Narrator of this story. You are not a character and you never speak to ${user} directly.`
      : `- You ARE ${name}. Stay in character no matter what. React the way ${name} genuinely would, with their own opinions, moods, flaws and agenda — not as a helpful assistant.`,
    group && !isNarrator ? `- Write ONLY ${name}'s message this turn. Other people in the scene can be mentioned through ${name}'s eyes, but never write their dialogue.` : null,
    mode === "prose"
      ? `- Never write ${user}'s dialogue or decide ${pr.poss} actions or choices. Stop at a natural point where it's ${user}'s turn.`
      : `- Never write ${user}'s dialogue, actions, thoughts or feelings. Stop at a natural point where it's ${user}'s turn.`,
    `- ${formatRule}`,
    `- ${len.rule}`,
    "- Move the story forward. Don't repeat earlier lines or phrases. Don't summarize.",
    "- No meta commentary, disclaimers, or mentions of being an AI.",
    swearRule(settings),
    chat.thoughts && !isNarrator && mode !== "texting"
      ? `- ${chat.thoughts >= 2 ? "In most replies" : "Now and then"}, reveal ${name}'s private thoughts in double parentheses, like ((She has no idea what she does to me.)). ` +
        `Only things ${name} would never say out loud; short, raw and honest. Show them especially in romantic, tense or intimate moments: what ${name} wants, what scares them, what ${user} does to them.`
      : null,
  ].filter(Boolean).join("\n");

  const intro = mode === "prose" && !group
    ? `This is a private, immersive, fanfic-style story co-written with ${user}, who plays ${pr.self}. You write ${name}'s words and actions and narrate the world around them. You write only ${name}'s side; ${user} writes ${pr.poss} own.`
    : group
    ? `This is a private, fictional, immersive interactive story with ${user}. Cast: ${cast.map((c) => c.name).join(", ")}${chat.narrator ? ", plus a Narrator" : ""}. ${user} plays ${pr.self}. Each turn you write as exactly one of them, as instructed at the end of ${user}'s latest message.`
    : `You are ${name}, in a private, fictional, ongoing roleplay with ${user}. You write only ${name}'s side.`;

  const boundaries = [...new Set(cast.map((c) => f(c.boundaries, c)).filter(Boolean))].join("\n");

  const sections = [
    { title: "", priority: 10, body: intro },
    ...castSections,
    { title: `About ${user}`, priority: 9, body: [userLine, adult, f(profile.persona)].filter(Boolean).join(" ") },
    { title: chat.premise ? "Background" : "The situation", priority: chat.premise ? 5 : 7, body: f(cast[0]?.scenario, cast[0]) },
    { title: chat.title ? `This storyline: ${chat.title}` : "This storyline", priority: 9, body: f(chat.premise, cast[0]) },
    { title: `Where ${me ? me.name : "they"} and ${user} are right now`, priority: 9, body: chat.arc && ARC_TEXT[chat.arc] ? `${ARC_TEXT[chat.arc]} Let romance build slowly and naturally and never jump past this stage; ${user} decides when things move forward.` : "" },
    { title: "The story so far", priority: 9, body: chat.summary },
    { title: "Remember", priority: 8, body: f(chat.memory) },
    { title: "World notes", priority: 3, body: f(loreHits.join("\n")) },
    { title: "Tone", priority: 9, body: toneInstructions(chat.tone, isNarrator ? null : user, pr) },
    { title: "Writing style", priority: 6, body: [...new Set(cast.map((c) => f(c.style, c)).filter(Boolean)), settings.globalStyle].filter(Boolean).join("\n") },
    { title: "Content boundaries", priority: 9, body: boundaries },
    { title: `Hard rules from ${user} — never break these`, priority: 10, body: avoids.map((a) => `- ${a}`).join("\n") },
    { title: "Rules", priority: 10, body: rules },
  ];

  const budget = contextTokens(settings) - maxTokens - 96;
  const system = assemble(sections, Math.floor(budget * 0.5 * 3.6));

  // A short reminder rides with the latest user turn (models pay most attention there)
  const voiceCue = me ? (f(me.speech) || f(me.personality)).replace(/\s+/g, " ").slice(0, 160) : "";
  const avoidCue = avoids.join(" ").replace(/\s+/g, " ").slice(0, 220);
  const reminder = "[" + [
    isNarrator ? "Now write the Narrator's next passage only: describe what happens next" : `Now write ${name}'s next message only${voiceCue ? ` (voice: ${voiceCue})` : ""}`,
    `Don't write ${user}'s part${group && !isNarrator ? " or anyone else's" : ""}`,
    avoidCue ? `Never: ${avoidCue}` : "",
    chat.thoughts && !isNarrator && mode !== "texting" ? `Put ${name}'s private thoughts inside ((double parentheses))` : "",
    chat.direction ? `Direction: ${chat.direction}` : "",
  ].filter(Boolean).join(". ") + ".]";

  // Stored messages → model turns. In group scenes, label who said what.
  const label = (m) => {
    const t = msgText(m) || "…";
    if (m.kind === "pov") return `(${speakerName(m, cast)}'s POV interlude) ${t}`;
    if (m.kind === "skip") return `(Scene change) ${t}`;
    if (m.role === "user" || !group) return t;
    return m.speaker === "narrator" ? `(Narrator) ${t}` : `${speakerName(m, cast)}: ${t}`;
  };
  const raw = chat.messages.map((m) => ({ role: m.role, content: label(m) }));
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
  const droppedCount = Math.max(0, chat.messages.length - (kept.length - (raw.length - chat.messages.length)));
  if (kept[0]?.role === "assistant") kept.unshift({ role: "user", content: "(The scene begins.)" });

  const merged = [];
  for (const m of kept) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ ...m });
  }
  merged[merged.length - 1].content += "\n\n" + reminder;

  const stop = [`\n${user}:`, "\nUser:", ...others.slice(0, 2).map((c) => `\n${firstName(c.name)}:`)];
  return {
    messages: [{ role: "system", content: system }, ...merged],
    maxTokens,
    firstVisibleIndex: droppedCount, // first stored message the model can still "see"
    stop,
    system,
  };
}

/** Clean up a reply: drop "Name:" prefixes and anything where it starts writing for someone else */
export function cleanReply(text, speakerName, userName, otherNames = []) {
  let t = text;
  const own = [speakerName, firstName(speakerName), "Narrator"].filter(Boolean).map(reEscape).join("|");
  t = t.replace(new RegExp(`^\\s*(\\((${own})\\)|\\**(${own})\\**\\s*:)\\s*`, "i"), "");
  t = t.replace(/^\s*\[(Now write|Reply as|Direction)[^\]]*\]\s*/i, "");
  const cutNames = [userName, "User", "You", ...otherNames.flatMap((n) => [n, firstName(n)])].filter(Boolean).map(reEscape).join("|");
  const cut = t.search(new RegExp(`\\n\\s*(\\**(${cutNames})\\**\\s*:|\\(Narrator\\))`, "i"));
  if (cut > 0) t = t.slice(0, cut);
  return t.trim();
}

/* ---------- "Surprise me": fresh storyline ideas ---------- */
export function buildIdeasPrompt({ ch, profile, avoidTitles = [] }) {
  const { user } = userIdentity(profile);
  const f = (t) => fill(t, ch.name, user);
  const about = [
    `${ch.name}: ${f(ch.summary)}`,
    ch.personality && `Personality: ${f(ch.personality).slice(0, 900)}`,
    ch.scenario && `Their situation: ${f(ch.scenario)}`,
    profile.persona && `About ${user}: ${f(profile.persona).slice(0, 600)}`,
  ].filter(Boolean).join("\n");
  return {
    messages: [
      { role: "system", content: "You suggest storyline ideas for an immersive, ongoing interactive story. Reply with JSON only." },
      { role: "user", content:
        `${about}\n\nSuggest 3 fresh storyline ideas for a new story between ${user} and ${ch.name}.\n` +
        "- Grounded and specific, like a real moment from their lives, not a cliché trope.\n" +
        "- Avoid: fake dating, only one bed, amnesia, love potions, 'trapped in an elevator', and anything too cheesy.\n" +
        "- Mix the moods: one cozy or everyday, one with danger or a case, one emotional.\n" +
        "- Each premise is 1-2 sentences and leaves room for the story to unfold.\n" +
        (avoidTitles.length ? `- Don't repeat these: ${avoidTitles.join("; ")}.\n` : "") +
        'Reply as a JSON array like [{"title": "...", "premise": "..."}].' },
    ],
  };
}

/** Pull [{title, premise}] out of the AI's reply, even if it adds extra text */
export function parseIdeas(text) {
  const tryJSON = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : Array.isArray(v?.ideas) ? v.ideas : null; } catch { return null; } };
  let list = tryJSON(text);
  if (!list) { const m = text.match(/\[[\s\S]*\]/); if (m) list = tryJSON(m[0]); }
  if (!list) {
    // fallback: "1. Title: premise" lines
    list = text.split(/\n+/).map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "")).map((l) => {
      const m = l.match(/^\**([^*:]{3,60})\**\s*[:—-]\s*(.{20,})$/);
      return m ? { title: m[1].trim(), premise: m[2].trim() } : null;
    }).filter(Boolean);
  }
  return list
    .filter((x) => x && (x.title || x.premise))
    .map((x) => ({ title: String(x.title || "Untitled").trim().slice(0, 60), premise: String(x.premise || x.description || "").trim() }))
    .filter((x) => x.premise)
    .slice(0, 3);
}

/* ---------- Automatic memory: fold old messages into "the story so far" ---------- */
export function buildSummaryPrompt({ chat, cast, profile, settings, upTo }) {
  const { user } = userIdentity(profile);
  const room = (contextTokens(settings) - 700) * 3.2;
  const lines = [];
  let used = 0, end = chat.summarizedUpTo;
  for (let i = chat.summarizedUpTo; i < upTo; i++) {
    const m = chat.messages[i];
    const line = `${m.role === "user" ? user : speakerName(m, cast)}: ${msgText(m)}`;
    if (used + line.length > room && lines.length) break;
    lines.push(line); used += line.length; end = i + 1;
  }
  return {
    upTo: end,
    messages: [
      { role: "system", content: `You keep a running summary of an interactive story so its characters never forget what happened. Write in past tense, third person, as compact notes. Keep: key events, relationships and how they changed, promises, secrets, injuries, places, names, and how ${user} feels. Leave out small talk. At most 200 words. Output only the summary.` },
      { role: "user", content: `Summary so far:\n${chat.summary || "(nothing yet)"}\n\nWhat happened next:\n${lines.join("\n")}\n\nWrite the updated summary.` },
    ],
  };
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
    { title: "World notes", priority: 4, body: fill(loreHits.join("\n"), cast[0]?.name || "", user) },
    { title: "Tone", priority: 9, body: toneInstructions(story.tone) },
    { title: "Style", priority: 6, body: [story.style, settings.globalStyle].filter(Boolean).join("\n") },
    { title: "Content", priority: 9, body: "All characters are adults (21+) and everything is consensual." + " " + swearRule(settings).replace(/^- /, "") },
  ];

  const budget = contextTokens(settings) - chunk.tokens - 96;
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

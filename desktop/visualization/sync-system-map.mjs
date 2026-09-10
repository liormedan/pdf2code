/**
 * Build `system-map.json` out of the documents that are already the truth.
 *
 *     node sync-system-map.mjs            # write the map
 *     node sync-system-map.mjs --check    # fail if the written map is out of date
 *
 * **The map must never be a second place where status lives.** A diagram that says a
 * sprint is done, drawn by hand, is a diagram that will one day disagree with the backlog
 * — and the one people look at is the pretty one. So nothing here is typed: sprints,
 * blockers, checklist counts and decisions are read out of the five documents, and the
 * only hand-written half is `system-map.authored.json`, which describes the architecture
 * and carries no status at all.
 *
 * **It reads structure, never prose.** Headings, tables and checkboxes are facts a parser
 * can hold. A sentence is not. A script that inferred "this sprint sounds finished" from a
 * paragraph would be inventing exactly the thing this file exists to prevent, so when a
 * document stops having the shape this expects, the answer is a failure and not a guess.
 *
 * ## What it refuses to do
 *
 * Every check below was written because two documents really did disagree, or could:
 *
 *  - a sprint whose blocker id names nothing in the blockers table
 *  - a sprint marked done that delegation.md still lists as waiting on the user
 *  - an open decision that blocks a sprint number nobody has
 *  - weights that do not add up to a hundred
 *  - the same blocker id meaning two different things in two files — which is true right
 *    now between backlog.md and built.md, and is why built.md has to declare that its
 *    numbering is the one from before the reorganisation
 *  - an authored process that no link connects, or a link naming a process that is absent
 *
 * On any of them it exits non-zero and says which document to look at. **A map that is
 * merely absent costs a minute. A map that is confidently wrong costs a decision.**
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DESKTOP = join(HERE, "..");
const OUT = join(HERE, "system-map.json");
const AUTHORED = join(HERE, "system-map.authored.json");

/** The five, and nothing else. A source added here is a source the map may cite. */
const SOURCES = [
  "delegation.md",
  "architecture.md",
  "backlog.md",
  "built.md",
  "decisions.md",
];

const problems = [];
const refuse = (where, what) => problems.push({ where, what });

const read = (name) => readFileSync(join(DESKTOP, name), "utf8");
const documents = Object.fromEntries(SOURCES.map((name) => [name, read(name)]));

// ---------------------------------------------------------------------------------------
// backlog.md — the authority on sprints and on the live blockers.
// ---------------------------------------------------------------------------------------

/**
 * `## ספרינט 6 — CI ואוטומציית בנייה · 10% 🟡`
 *
 * The tail after the weight is where the state lives, and it takes four shapes rather than
 * one: a tick, a half-done circle, `· חסום על ח2`, or `· **שלך**`. Parsed as alternatives
 * instead of normalised into a single word, because collapsing "blocked on the pricing
 * decision" and "waiting for you to click" into one colour is how a map starts lying.
 */
const SPRINT = /^## ספרינט (\d+) — (.+?) · (\d+)%(.*)$/gm;

const sprints = [];
for (const [, number, name, weight, tail] of documents["backlog.md"].matchAll(SPRINT)) {
  const blockedOn = tail.match(/חסום על (ח\d+)/)?.[1] ?? null;
  const mine = !/\*\*שלך\*\*/.test(tail);

  let status = "open";
  if (tail.includes("✅")) status = "done";
  else if (tail.includes("🟡")) status = "partly";
  else if (blockedOn) status = "blocked";

  sprints.push({
    number: Number(number),
    name: name.trim(),
    weight: Number(weight),
    status,
    blockedOn,
    owner: mine ? "engineering" : "you",
  });
}

if (sprints.length === 0) {
  refuse("backlog.md", "no sprint headings matched — the document's shape changed");
}

/**
 * Checklist items, per sprint, in three buckets rather than two.
 *
 * An unticked box does not always mean unfinished work. Two of them in this backlog are
 * decisions: "drag out of the window — **rejected**" and "keyboard pass — **moved to
 * sprint 9**". Counting those as open would show a finished sprint with work left in it,
 * and the reader would be right to distrust the map rather than the box.
 *
 * The markers are matched literally and narrowly — a rejection or a move says so in bold,
 * in words the backlog already uses. This is the one place prose is read, and it decides
 * which of two counters to add to rather than what any status is.
 */
const DEFERRED = /נדחת[הו]|עבר[הו]? לספרינט|במכוון/;

const lines = documents["backlog.md"].split("\n");
let current = null;
for (const line of lines) {
  const heading = line.match(/^## ספרינט (\d+) /);
  if (heading) {
    current = sprints.find((sprint) => sprint.number === Number(heading[1])) ?? null;
    if (current) current.items = { done: [], open: [], deferred: [] };
    continue;
  }
  if (!current?.items) continue;

  const item = line.match(/^- \[([ x])\] (.+)$/i);
  if (!item) continue;
  const text = item[2].replace(/\*\*/g, "").trim();

  if (item[1].toLowerCase() === "x") current.items.done.push(text);
  else if (DEFERRED.test(text)) current.items.deferred.push(text);
  else current.items.open.push(text);
}

// A sprint cannot be finished and still hold work. If one does, either the tick or the box
// is wrong, and guessing which would put the wrong one on a map people plan from.
for (const sprint of sprints) {
  if (sprint.status === "done" && (sprint.items?.open.length ?? 0) > 0) {
    refuse(
      "backlog.md",
      `sprint ${sprint.number} is marked ✅ but still has ${sprint.items.open.length} ` +
        `unticked item(s) that are not marked rejected or moved: ` +
        `"${sprint.items.open[0].slice(0, 60)}"`,
    );
  }
}

const total = sprints.reduce((sum, sprint) => sum + sprint.weight, 0);
if (sprints.length > 0 && total !== 100) {
  refuse("backlog.md", `the sprint weights add up to ${total}%, not 100%`);
}

/** `| ח1 | **name** — detail | blocks | who |` */
const BLOCKER = /^\| (ח\d+) \| \*\*(.+?)\*\*(.*?) \| (.+?) \| (.+?) \|$/gm;
const blockers = [];
for (const [, id, name, detail, blocks, who] of documents["backlog.md"].matchAll(BLOCKER)) {
  blockers.push({
    id,
    name,
    detail: detail.replace(/^\s*—\s*/, "").trim(),
    blocks: blocks.trim(),
    who: who.trim(),
  });
}

// built.md carries a table with the same column shape and the same ids meaning different
// things — ח1 is the identity decision in one and the machine's commit limit in the other.
// Merging them would produce a map with two ח1. It declares itself historical; if that
// declaration ever disappears, this stops and says so rather than merging them anyway.
if (!/המספור כאן הוא של התוכנית שלפני/.test(documents["built.md"])) {
  refuse(
    "built.md",
    "its blocker ids collide with backlog.md's and it no longer says its numbering is " +
      "the pre-6.9 one — so there is no way to tell which ח1 a reader means",
  );
}

for (const sprint of sprints) {
  if (sprint.blockedOn && !blockers.some((blocker) => blocker.id === sprint.blockedOn)) {
    refuse(
      "backlog.md",
      `sprint ${sprint.number} says it is blocked on ${sprint.blockedOn}, ` +
        `which is not in the blockers table`,
    );
  }
}

// ---------------------------------------------------------------------------------------
// delegation.md §7 — what is waiting on the user, by sprint.
// ---------------------------------------------------------------------------------------

/** `| 7 | **זהות** | what I need | what happens after |` */
const WAITING = /^\| (\d+|—) \| \*\*(.+?)\*\* \| (.+?) \| (.+?) \|$/gm;
const waiting = [];
for (const [, number, what, need, after] of documents["delegation.md"].matchAll(WAITING)) {
  waiting.push({
    sprint: number === "—" ? null : Number(number),
    what,
    need: need.trim(),
    after: after.trim(),
  });
}

if (waiting.length === 0) {
  refuse("delegation.md", "§7 has no rows — either nothing is blocked, or the table moved");
}

/**
 * §2's closing line: `**1–6 אני, 7–8 קטגוריה ב, 9–10 קטגוריה ג.**`
 *
 * The one sentence in delegation.md structured enough to check against. Category ג is the
 * work nobody here can do at all, so a sprint that falls in that range and does not say
 * **שלך** in the backlog is two documents disagreeing about who is holding it — which is
 * the precise confusion the whole delegation document was written to end. It caught
 * sprint 10 the first time this ran.
 */
const ranges = documents["delegation.md"].match(
  /\*\*(\d+)–(\d+) אני, (\d+)–(\d+) קטגוריה ב, (\d+)–(\d+) קטגוריה ג\.\*\*/,
);
if (!ranges) {
  refuse("delegation.md", "§2 no longer states the sprint ranges, so ownership cannot be checked");
} else {
  const [, , , , , yoursFrom, yoursTo] = ranges.map(Number);
  for (const sprint of sprints) {
    const shouldBeYours = sprint.number >= yoursFrom && sprint.number <= yoursTo;
    if (shouldBeYours && sprint.owner !== "you") {
      refuse(
        "backlog.md",
        `delegation.md §2 puts sprint ${sprint.number} in category ג (yours), ` +
          `but its backlog heading does not say **שלך**`,
      );
    }
    if (!shouldBeYours && sprint.owner === "you") {
      refuse(
        "backlog.md",
        `sprint ${sprint.number} says **שלך**, but delegation.md §2 puts it in ${yoursFrom}–${yoursTo}`,
      );
    }
  }
}

for (const row of waiting) {
  if (row.sprint === null) continue;
  const sprint = sprints.find((item) => item.number === row.sprint);
  if (!sprint) {
    refuse("delegation.md", `§7 waits on sprint ${row.sprint}, which backlog.md does not have`);
    continue;
  }
  // The contradiction worth catching: one document calls it finished while the other says
  // it is still waiting on a person. Sprint 6 is legitimately both — its code is done and
  // its signing step is not — and `partly` is exactly how the backlog says so.
  if (sprint.status === "done") {
    refuse(
      "delegation.md",
      `§7 says sprint ${row.sprint} is waiting on you (${row.what}), ` +
        `but backlog.md marks it ✅`,
    );
  }
}

// ---------------------------------------------------------------------------------------
// decisions.md — what was settled, and what is still open.
// ---------------------------------------------------------------------------------------

const decided = [];
const open = [];
const [, settledText = "", openText = ""] =
  documents["decisions.md"].match(/## הוכרע\n([\s\S]*?)\n## פתוח[^\n]*\n([\s\S]*)$/) ?? [];

if (!settledText || !openText) {
  refuse("decisions.md", "could not find both a הוכרע section and a פתוח section");
}

for (const [, title, date, who] of settledText.matchAll(/^### (.+?) · ([\d.]+) · (.+)$/gm)) {
  decided.push({ title: title.trim(), date, who: who.trim() });
}

for (const [, index, title, tail] of openText.matchAll(/^### (\d+)\. (.+?) · (.+)$/gm)) {
  const numbers = [...tail.matchAll(/ספרינט[ים]* (\d+)/g)].map((match) => Number(match[1]));
  open.push({
    index: Number(index),
    title: title.trim(),
    blocks: numbers,
    urgent: /\*\*דחוף/.test(tail),
    moot: /התייתר|לא חוסם עוד/.test(tail),
  });

  for (const number of numbers) {
    const sprint = sprints.find((item) => item.number === number);
    if (!sprint) {
      refuse("decisions.md", `open decision ${index} blocks sprint ${number}, which does not exist`);
    } else if (sprint.status === "done") {
      refuse(
        "decisions.md",
        `open decision ${index} blocks sprint ${number}, which backlog.md marks ✅`,
      );
    }
  }
}

if (decided.length === 0) refuse("decisions.md", "no settled decisions matched");

// ---------------------------------------------------------------------------------------
// The authored half, validated rather than trusted.
// ---------------------------------------------------------------------------------------

const authored = JSON.parse(readFileSync(AUTHORED, "utf8"));
const ids = new Set(authored.processes.map((process) => process.id));

for (const link of authored.links) {
  for (const end of [link.from, link.to]) {
    if (!ids.has(end)) refuse("system-map.authored.json", `a link names process "${end}"`);
  }
}
for (const id of ids) {
  const connected = authored.links.some((link) => link.from === id || link.to === id);
  if (!connected) refuse("system-map.authored.json", `process "${id}" is connected to nothing`);
}
for (const capability of authored.capabilities) {
  if (!ids.has(capability.where)) {
    refuse("system-map.authored.json", `capability "${capability.name}" lives in "${capability.where}"`);
  }
}
// A citation is the difference between a map and a drawing. Every authored claim names the
// document it paraphrases, and the name has to be one this script actually read — plus the
// audit, which is the one document allowed to describe something not yet built.
const CITABLE = new Set([...SOURCES, "workbench-audit.md"]);
for (const item of [...authored.forbidden, ...authored.capabilities, ...authored.processes, ...authored.links]) {
  if (item.source && !CITABLE.has(item.source)) {
    refuse("system-map.authored.json", `cites "${item.source}", which is not one of the sources`);
  }
}

// ---------------------------------------------------------------------------------------
// Progress — two numbers, and the one the documents already state.
// ---------------------------------------------------------------------------------------

/**
 * Closed weight and reached weight are not the same figure, and the map shows both.
 *
 * Sprint 6 is `partly`: everything buildable in it is built, and its signing step waits on
 * a certificate nobody here can buy. Counting it as nothing understates the work; counting
 * it as done overstates it. delegation.md §14 already states a headline number, so that
 * number is **checked** against the sum here rather than restated — a percentage on a map
 * that disagrees with the percentage in the document is the whole failure this file exists
 * to prevent, and it would be the most quoted number on the screen.
 */
const weightOf = (status) =>
  sprints.filter((sprint) => sprint.status === status).reduce((sum, s) => sum + s.weight, 0);

const progress = {
  closed: weightOf("done"),
  reached: weightOf("done") + weightOf("partly"),
  done: sprints.filter((sprint) => sprint.status === "done").length,
  total: sprints.length,
};

const stated = documents["delegation.md"].match(/\*\*(\d+)% — ספרינטים/);
if (!stated) {
  refuse("delegation.md", "§14 no longer states a headline percentage to check against");
} else if (Number(stated[1]) !== progress.reached) {
  refuse(
    "delegation.md",
    `§14 says ${stated[1]}%, and the sprint weights in backlog.md add up to ` +
      `${progress.reached}% (${progress.closed}% closed plus a partly-closed sprint)`,
  );
}

// ---------------------------------------------------------------------------------------
// Emit, or refuse.
// ---------------------------------------------------------------------------------------

if (problems.length > 0) {
  console.log("system map — refused, and nothing was written\n");
  for (const problem of problems) console.log(`  ${problem.where}: ${problem.what}`);
  console.log(
    "\nA map that is merely missing costs a minute. One that is confidently wrong costs\n" +
      "a decision. Fix the document, then run this again.",
  );
  process.exit(1);
}

const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

const map = {
  // No timestamp, on purpose: a generated file with a clock in it differs from itself on
  // every run, and `--check` could never tell "out of date" from "regenerated a second
  // later". The source digests carry the same information and hold still.
  generatedBy: "desktop/visualization/sync-system-map.mjs",
  sources: SOURCES.map((name) => ({ file: `desktop/${name}`, sha256: digest(documents[name]) })),
  processes: authored.processes,
  links: authored.links,
  flow: authored.flow,
  forbidden: authored.forbidden,
  capabilities: authored.capabilities,
  sprints,
  blockers,
  waitingOnYou: waiting,
  decisions: { decided, open },
  progress,
};

const text = JSON.stringify(map, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let existing = null;
  try {
    existing = readFileSync(OUT, "utf8");
  } catch {
    console.log("system map — system-map.json is missing. Run `npm run map:sync`.");
    process.exit(1);
  }
  if (existing !== text) {
    console.log(
      "system map — out of date.\n\n" +
        "  A document changed and the map did not. Run `npm run map:sync` and look at the\n" +
        "  diff before committing it — a map moving on its own is worth a glance.",
    );
    process.exit(1);
  }
  console.log(
    `system map — up to date: ${map.processes.length} processes, ${map.sprints.length} sprints, ` +
      `${map.blockers.length} blockers, ${map.decisions.open.length} open decisions`,
  );
  process.exit(0);
}

writeFileSync(OUT, text, "utf8");
console.log(
  `system map — wrote ${map.sprints.length} sprints, ${map.blockers.length} blockers, ` +
    `${map.capabilities.length} capabilities, ${map.decisions.open.length} open decisions`,
);

// Vercel, without the CLI.
//
// The token this project uses is scoped to the pdf2code project rather than to the whole
// account, which is the right shape for it — a leaked project token cannot touch the other
// ten projects. The Vercel CLI cannot use one: every command begins by resolving the
// authenticated *user*, and a project token has no user, so `vercel whoami` answers "User
// not found" and each subcommand fails before it starts. The REST API has no such
// requirement, and serves everything the CLI was being asked for here.
//
// The token is read from .env.local and never printed. That is not decoration: `vercel ls`
// ends its output with "To display the next page, run vercel ls --token <the token>", which
// is how the previous one ended up in a transcript and had to be revoked. Nothing here
// echoes a command line.
//
// Usage:
//   node scripts/vercel.mjs status              latest deployments, newest first
//   node scripts/vercel.mjs env                 variable names and which environments
//   node scripts/vercel.mjs logs [id|url]       build log for a deployment (default: latest)
//   node scripts/vercel.mjs watch               poll until the newest deployment settles

import { readFileSync } from "node:fs";

const PROJECT = "pdf2code";
const TEAM = "team_E2hQk1d9WG9kMA7eixFijsvm";

function token() {
  let file;
  try {
    file = readFileSync(".env.local", "utf8");
  } catch {
    fail("No .env.local. The token lives there as a VERCEL_TOKEN= line.");
  }
  // The trailing \r matters: the file has Windows line endings, and a carriage return
  // silently invalidates the token — the API answers 403 with no hint as to why.
  const value = file.match(/^VERCEL_TOKEN=(.*)$/m)?.[1]?.trim();
  if (!value) fail("No VERCEL_TOKEN in .env.local.");
  return value;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function api(path) {
  const response = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // 404 on a user endpoint is the expected shape for a project-scoped token, not a fault.
    fail(`${response.status} on ${path.split("?")[0]} — ${body?.error?.message ?? "no detail"}`);
  }
  return body;
}

const q = (extra = "") => `projectId=${PROJECT}&teamId=${TEAM}${extra}`;

async function deployments(limit = 8) {
  const { deployments } = await api(`/v6/deployments?${q(`&limit=${limit}`)}`);
  return deployments ?? [];
}

const age = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

async function status() {
  const list = await deployments();
  console.log(`\n  ${PROJECT} — newest first\n`);
  for (const d of list) {
    const sha = d.meta?.githubCommitSha?.slice(0, 7) ?? "-";
    const subject = (d.meta?.githubCommitMessage ?? "").split("\n")[0].slice(0, 46);
    console.log(
      `  ${d.state.padEnd(9)} ${(d.target ?? "preview").padEnd(11)} ${age(d.createdAt).padStart(4)}  ${sha}  ${subject}`,
    );
  }
  console.log();
}

async function env() {
  const { envs } = await api(`/v9/projects/${PROJECT}/env?teamId=${TEAM}`);
  console.log(`\n  ${PROJECT} — environment variables (names only; values are never read)\n`);
  for (const v of envs ?? []) console.log(`  ${v.key.padEnd(34)} ${v.target.join(", ")}`);
  // Production-only is correct while everything ships from main. The moment a pull request
  // matters, its preview has no SESSION_SECRET and no Firebase, so sign-in dies there.
  const previews = (envs ?? []).filter((v) => v.target.includes("preview")).length;
  if (previews === 0) console.log(`\n  none apply to preview — sign-in and conversion will not work on PR previews`);
  console.log();
}

async function logs(which) {
  let id = which;
  if (!id || id === "latest") id = (await deployments(1))[0]?.uid;
  else if (id.includes(".")) id = (await deployments(20)).find((d) => d.url === id.replace(/^https?:\/\//, ""))?.uid;
  if (!id) fail("No such deployment.");

  const events = await api(`/v2/deployments/${id}/events?teamId=${TEAM}&limit=200`);
  console.log();
  for (const e of Array.isArray(events) ? events : []) {
    const text = (e.payload?.text ?? e.text ?? "").replace(/\[[0-9;]*m/g, "").trimEnd();
    if (text) console.log(`  ${text}`);
  }
  console.log();
}

/** Poll until the newest deployment stops moving. Used right after a push. */
async function watch() {
  for (let i = 0; i < 40; i++) {
    const d = (await deployments(1))[0];
    if (!d) fail("No deployments.");
    const sha = d.meta?.githubCommitSha?.slice(0, 7) ?? "-";
    if (d.state !== "BUILDING" && d.state !== "QUEUED" && d.state !== "INITIALIZING") {
      console.log(`\n  ${d.state}  ${sha}  https://${d.url}\n`);
      process.exit(d.state === "READY" ? 0 : 1);
    }
    console.log(`  ${d.state.toLowerCase()}… ${sha}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  fail("Still building after ten minutes.");
}

const [command = "status", argument] = process.argv.slice(2);
const commands = { status, env, logs: () => logs(argument), watch };
if (!commands[command]) fail(`Unknown command "${command}". One of: ${Object.keys(commands).join(", ")}`);
await commands[command]();

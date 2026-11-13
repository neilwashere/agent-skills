#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function exclusionPath() {
  const explicitPath = process.env.PI_MODEL_EXCLUSIONS_PATH?.trim();
  if (explicitPath) return path.resolve(explicitPath);

  const explicitRoot = process.env.PI_SUBAGENTS_TEMP_ROOT?.trim();
  if (explicitRoot)
    return path.join(path.resolve(explicitRoot), "model-exclusions.json");

  const uid = process.getuid?.();
  const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
  const scope =
    uid === undefined
      ? `home-${String(home).replace(/[^a-zA-Z0-9._-]/g, "_")}`
      : `uid-${uid}`;
  return path.join(
    os.tmpdir(),
    `pi-subagents-${scope}`,
    "model-exclusions.json",
  );
}

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: unblock.mjs list | all | model <provider/model> | provider <provider>",
  );
  process.exit(2);
}

function readStore(file) {
  if (!fs.existsSync(file)) return { version: 1, exclusions: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Cannot parse model exclusion store ${file}:`, error.message);
    process.exit(1);
  }
  if (data?.version !== 1 || !Array.isArray(data.exclusions)) {
    console.error(`Unsupported or malformed model exclusion store: ${file}`);
    process.exit(1);
  }
  return data;
}

function writeStore(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

function display(entries) {
  if (entries.length === 0) {
    console.log("No cached model exclusions.");
    return;
  }
  for (const entry of entries) {
    const target = entry.modelId
      ? `${entry.provider ? `${entry.provider}/` : ""}${entry.modelId}`
      : `${entry.provider}/*`;
    const expiry = Number.isFinite(entry.expiresAt)
      ? new Date(entry.expiresAt).toISOString()
      : "invalid expiry";
    console.log(
      `${target}\t${entry.reason ?? "unknown reason"}\texpires ${expiry}`,
    );
  }
}

const args = process.argv.slice(2);
let command = args[0] ?? "list";
let target = args[1];
if (command.includes("/") && args.length === 1) {
  target = command;
  command = "model";
}
if (!new Set(["list", "all", "model", "provider"]).has(command)) usage();
if ((command === "model" || command === "provider") && !target)
  usage(`Missing ${command} target.`);
if ((command === "list" || command === "all") && args.length > 1)
  usage(`The ${command} command takes no target.`);
if (args.length > 2) usage("Too many arguments.");

const file = exclusionPath();
const store = readStore(file);
if (command === "list") {
  console.log(`Store: ${file}`);
  display(store.exclusions);
  process.exit(0);
}

const knownThinking = /:(?:off|minimal|low|medium|high|xhigh|max)$/;
let matches;
let description;
if (command === "all") {
  matches = () => true;
  description = "all model exclusions";
} else if (command === "provider") {
  matches = (entry) => entry.provider === target;
  description = `provider ${target}`;
} else {
  const normalized = target.replace(knownThinking, "");
  const slash = normalized.indexOf("/");
  if (slash <= 0 || slash === normalized.length - 1)
    usage("A model target must be provider/model.");
  const provider = normalized.slice(0, slash);
  const modelId = normalized.slice(slash + 1);
  matches = (entry) =>
    (entry.modelId === modelId &&
      (!entry.provider || entry.provider === provider)) ||
    (entry.modelId === undefined && entry.provider === provider);
  description = normalized;
}

const removed = store.exclusions.filter(matches);
store.exclusions = store.exclusions.filter((entry) => !matches(entry));
if (removed.length > 0) writeStore(file, store);
console.log(
  `Cleared ${removed.length} exclusion${removed.length === 1 ? "" : "s"} for ${description}.`,
);
if (removed.some((entry) => entry.modelId === undefined)) {
  console.log("This included a provider-wide exclusion.");
}
console.log(`Store: ${file}`);
console.log(
  "Run /reload in every active Pi session before launching another subagent.",
);

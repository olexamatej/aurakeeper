#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(repoRoot, "examples/registry.json");
const endpoint =
  process.env.AURAKEEPER_ENDPOINT ?? "http://127.0.0.1:3000/v1/logs/errors";

function usage() {
  return "Usage: make run <example-id>\n\nSet AURAKEEPER_API_TOKEN to send events to a project.";
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function loadRegistry() {
  return JSON.parse(await readFile(registryPath, "utf8"));
}

function spawnExample(example) {
  const [file, ...args] = example.command;
  return spawn(file, args, {
    cwd: resolve(repoRoot, example.cwd),
    env: {
      ...process.env,
      AURAKEEPER_ENDPOINT: endpoint,
      EXPO_PUBLIC_AURAKEEPER_ENDPOINT: endpoint,
      EXPO_PUBLIC_AURAKEEPER_API_TOKEN: process.env.AURAKEEPER_API_TOKEN,
      PYTHONPATH: [
        resolve(repoRoot, "connectors/python"),
        process.env.PYTHONPATH,
      ].filter(Boolean).join(":"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeChunk(prefix, chunk) {
  String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      console.log(`${prefix}${line}`);
    });
}

async function main() {
  const id = process.argv[2] ?? process.env.EXAMPLE;

  if (!id) {
    console.error(usage());
    process.exit(2);
  }

  if (!process.env.AURAKEEPER_API_TOKEN) {
    console.error("AURAKEEPER_API_TOKEN is required.");
    process.exit(2);
  }

  const registry = await loadRegistry();
  const example = registry.find((entry) => entry.id === id);

  if (!example) {
    console.error(`Unknown example: ${id}`);
    console.error(`Available examples: ${registry.map((entry) => entry.id).join(", ")}`);
    process.exit(2);
  }

  console.log(`Running ${example.name} example.`);
  console.log(`Endpoint: ${endpoint}`);
  if (example.manual) {
    console.log(example.manual);
  }

  const child = spawnExample(example);
  child.stdout.on("data", (chunk) => writeChunk("stdout: ", chunk));
  child.stderr.on("data", (chunk) => writeChunk("stderr: ", chunk));

  let triggerStatus;
  if (example.triggerUrl) {
    await sleep(example.readyDelayMs ?? 1000);
    try {
      const response = await fetch(example.triggerUrl);
      triggerStatus = response.status;
      console.log(`Triggered ${example.triggerUrl} -> ${response.status}`);
    } catch (error) {
      console.error(`Trigger failed: ${error.message}`);
    }
    child.kill("SIGTERM");
  }

  const exitCode = await new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolveExit(124);
    }, example.timeoutMs ?? 15000);

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolveExit(code ?? (signal ? 128 : 0));
    });
  });

  const allowed = example.successExitCodes ?? [0];
  if (!allowed.includes(exitCode) && !example.triggerUrl) {
    process.exit(exitCode || 1);
  }

  if (example.triggerUrl && triggerStatus === undefined) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

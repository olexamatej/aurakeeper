#!/usr/bin/env node
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(repoRoot, "examples/registry.json");
const defaultEndpoint = "http://127.0.0.1:3000/v1/logs/errors";
const endpoint =
  typeof process.env.AURAKEEPER_ENDPOINT === "string" &&
  process.env.AURAKEEPER_ENDPOINT.trim().length > 0
    ? process.env.AURAKEEPER_ENDPOINT
    : defaultEndpoint;

function usage() {
  return "Usage: make run <example-id>\n\nSet AURAKEEPER_API_TOKEN to send events to a project.";
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function trimCommand(command) {
  return command.filter((value) => value && String(value).trim().length > 0);
}

async function isExecutable(filePath) {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command) {
  if (!command || String(command).trim().length === 0) {
    return false;
  }

  if (command.includes("/")) {
    return isExecutable(command);
  }

  const pathValue = process.env.PATH ?? "";
  if (!pathValue) {
    return false;
  }

  const pathEntries = pathValue.split(delimiter).filter(Boolean);
  const pathExtensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((extension) => extension.toLowerCase())
      : [""];

  for (const directory of pathEntries) {
    if (process.platform === "win32") {
      const normalizedCommand = command.toLowerCase();
      const hasExtension = pathExtensions.some((extension) =>
        normalizedCommand.endsWith(extension),
      );
      const candidates = hasExtension
        ? [command]
        : [command, ...pathExtensions.map((extension) => `${command}${extension}`)];
      for (const candidate of candidates) {
        if (await isExecutable(join(directory, candidate))) {
          return true;
        }
      }
      continue;
    }

    if (await isExecutable(join(directory, command))) {
      return true;
    }
  }

  return false;
}

async function ensureRequiredCommands(example) {
  const requiredCommands =
    Array.isArray(example.requiredCommands) && example.requiredCommands.length > 0
      ? example.requiredCommands
      : [example.command[0]];

  const missingCommands = [];
  for (const command of requiredCommands) {
    if (!(await commandExists(command))) {
      missingCommands.push(command);
    }
  }

  if (missingCommands.length > 0) {
    console.error(
      `Missing required command(s) for ${example.id}: ${missingCommands.join(", ")}.`,
    );
    process.exit(2);
  }
}

function runCommand(command, options) {
  const [file, ...args] = trimCommand(command);
  if (!file) {
    return Promise.resolve({ ok: false, code: 2 });
  }

  return new Promise((resolveCommand) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "inherit", "inherit"],
    });

    let settled = false;
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveCommand(result);
    };

    child.on("error", (error) => {
      console.error(`Failed to start command ${[file, ...args].join(" ")}: ${error.message}`);
      settle({ ok: false, code: 127 });
    });

    child.on("close", (code, signal) => {
      settle({
        ok: code === 0,
        code: code ?? (signal ? 128 : 1),
      });
    });
  });
}

async function ensureSetup(example, env) {
  if (!Array.isArray(example.setupCommand) || example.setupCommand.length === 0) {
    return;
  }

  const setupCwd = resolve(repoRoot, example.cwd);
  const nodeModulesPath = resolve(setupCwd, "node_modules");
  try {
    const statResult = await stat(nodeModulesPath);
    if (statResult.isDirectory()) {
      return;
    }
  } catch {
    // Install dependencies when node_modules is absent.
  }

  console.log(`Running setup for ${example.id}: ${example.setupCommand.join(" ")}`);
  const setupResult = await runCommand(example.setupCommand, {
    cwd: setupCwd,
    env,
  });

  if (!setupResult.ok) {
    console.error(`Setup failed for ${example.id} (exit code ${setupResult.code}).`);
    process.exit(setupResult.code || 1);
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function triggerWithRetry(example) {
  const readyDelayMs = example.readyDelayMs ?? 1000;
  const retryDelayMs = example.triggerRetryDelayMs ?? 500;
  const requestTimeoutMs = example.triggerRequestTimeoutMs ?? 3000;
  const triggerTimeoutMs = example.triggerTimeoutMs ?? Math.max(readyDelayMs + 10000, 12000);
  const deadline = Date.now() + triggerTimeoutMs;

  await sleep(readyDelayMs);

  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fetchWithTimeout(example.triggerUrl, requestTimeoutMs);
    } catch (error) {
      lastError = error;
      await sleep(retryDelayMs);
    }
  }

  throw new Error(
    `Timed out waiting for ${example.triggerUrl}. Last error: ${lastError?.message ?? "unknown"}`,
  );
}

function terminateExampleProcess(child, signal) {
  if (!child.pid) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to direct child signal when process groups are unavailable.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // Ignore failures when process already exited.
  }
}

async function loadRegistry() {
  return JSON.parse(await readFile(registryPath, "utf8"));
}

function spawnExample(example) {
  const [file, ...args] = example.command;
  return spawn(file, args, {
    cwd: resolve(repoRoot, example.cwd),
    env: example.env ?? process.env,
    detached: process.platform !== "win32",
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

  const exampleEnv = {
    ...process.env,
    AURAKEEPER_ENDPOINT: endpoint,
    EXPO_PUBLIC_AURAKEEPER_ENDPOINT: endpoint,
    EXPO_PUBLIC_AURAKEEPER_API_TOKEN: process.env.AURAKEEPER_API_TOKEN,
    PYTHONPATH: [resolve(repoRoot, "connectors/python"), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(":"),
  };

  await ensureRequiredCommands(example);
  await ensureSetup(example, exampleEnv);

  const child = spawnExample({ ...example, env: exampleEnv });
  child.stdout.on("data", (chunk) => writeChunk("stdout: ", chunk));
  child.stderr.on("data", (chunk) => writeChunk("stderr: ", chunk));

  let triggerStatus;
  if (example.triggerUrl) {
    try {
      const response = await triggerWithRetry(example);
      triggerStatus = response.status;
      console.log(`Triggered ${example.triggerUrl} -> ${response.status}`);
    } catch (error) {
      console.error(`Trigger failed: ${error.message}`);
    }
    terminateExampleProcess(child, "SIGTERM");
  }

  const exitCode = await new Promise((resolveExit) => {
    let settled = false;
    const settle = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveExit(code);
    };

    const timeout = setTimeout(() => {
      terminateExampleProcess(child, "SIGTERM");
      setTimeout(() => {
        terminateExampleProcess(child, "SIGKILL");
      }, 1000).unref();
      settle(124);
    }, example.timeoutMs ?? 15000);

    child.on("error", (error) => {
      console.error(`Failed to start example process: ${error.message}`);
      settle(127);
    });

    child.on("close", (code, signal) => {
      settle(code ?? (signal ? 128 : 0));
    });
  });

  if (example.manual && !example.triggerUrl && exitCode === 124) {
    console.log("Manual example started successfully and was stopped after timeout.");
    return;
  }

  if (example.triggerUrl && triggerStatus === undefined) {
    process.exit(1);
  }

  if (example.triggerUrl) {
    process.exit(0);
  }

  const allowed = example.successExitCodes ?? [0];
  if (!allowed.includes(exitCode)) {
    process.exit(exitCode || 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

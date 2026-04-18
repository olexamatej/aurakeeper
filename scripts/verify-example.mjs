#!/usr/bin/env node
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(repoRoot, "examples/registry.json");

async function isExecutable(filePath) {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command) {
  const pathValue = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      if (await isExecutable(join(directory, `${command}${extension}`))) {
        return true;
      }
    }
  }

  return false;
}

function runCommand(command, cwd, env) {
  return new Promise((resolveCommand) => {
    const [file, ...args] = command;
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      console.error(`Failed to start ${file}: ${error.message}`);
      resolveCommand(127);
    });

    child.on("close", (code) => {
      resolveCommand(code ?? 1);
    });
  });
}

async function ensureSetup(example, cwd, env) {
  if (!Array.isArray(example.setupCommand)) {
    return;
  }

  try {
    const nodeModules = await stat(resolve(cwd, "node_modules"));
    if (nodeModules.isDirectory()) {
      return;
    }
  } catch {
    // Continue with setup.
  }

  const setupExit = await runCommand(example.setupCommand, cwd, env);
  if (setupExit !== 0) {
    process.exit(setupExit);
  }
}

async function main() {
  const id = process.argv[2] ?? process.env.EXAMPLE;
  if (!id) {
    console.error("Usage: make verify-example <example-id>");
    process.exit(2);
  }

  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const example = registry.find((entry) => entry.id === id);
  if (!example) {
    console.error(`Unknown example: ${id}`);
    process.exit(2);
  }

  if (!Array.isArray(example.verifyCommand)) {
    console.error(`Example ${id} has no verifyCommand.`);
    process.exit(2);
  }

  for (const command of example.requiredCommands ?? [example.verifyCommand[0]]) {
    if (!(await commandExists(command))) {
      console.error(`Missing required command for ${id}: ${command}`);
      process.exit(2);
    }
  }

  const cwd = resolve(repoRoot, example.cwd);
  const env = {
    ...process.env,
    PYTHONPATH: [resolve(repoRoot, "connectors/python"), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(":"),
  };

  await ensureSetup(example, cwd, env);
  process.exit(await runCommand(example.verifyCommand, cwd, env));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

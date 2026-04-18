import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ExampleDefinition = {
  id: string;
  name: string;
  description: string;
  cwd: string;
  command: string[];
  triggerUrl?: string;
  readyDelayMs?: number;
  timeoutMs?: number;
  successExitCodes?: number[];
  manual?: string;
};

export type ExampleRunStatus = "running" | "completed" | "failed";

export type ExampleRun = {
  id: string;
  exampleId: string;
  status: ExampleRunStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  triggerStatus?: number;
  stdout: string;
  stderr: string;
  error?: string;
  manual?: string;
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_PATH = resolve(REPO_ROOT, "examples/registry.json");
const DEFAULT_ENDPOINT = "http://127.0.0.1:3000/v1/logs/errors";
const MAX_OUTPUT_CHARS = 12000;

const runs = new Map<string, ExampleRun>();
let registryCache: ExampleDefinition[] | undefined;

function createRunId(): string {
  return `run_${Date.now().toString(36)}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function appendOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");

  if (next.length <= MAX_OUTPUT_CHARS) {
    return next;
  }

  return next.slice(next.length - MAX_OUTPUT_CHARS);
}

function serializeExample(example: ExampleDefinition) {
  return {
    id: example.id,
    name: example.name,
    description: example.description,
    manual: example.manual,
  };
}

function finishRun(run: ExampleRun, status: ExampleRunStatus): void {
  run.status = status;
  run.finishedAt = new Date().toISOString();
}

async function loadRegistry(): Promise<ExampleDefinition[]> {
  if (!registryCache) {
    registryCache = JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as ExampleDefinition[];
  }

  return registryCache;
}

function spawnDefinition(
  example: ExampleDefinition,
  input: {
    apiToken: string;
    endpoint?: string;
  }
): ChildProcessWithoutNullStreams {
  const [file, ...args] = example.command;

  return spawn(file, args, {
    cwd: resolve(REPO_ROOT, example.cwd),
    env: {
      ...process.env,
      AURAKEEPER_API_TOKEN: input.apiToken,
      AURAKEEPER_ENDPOINT: input.endpoint || process.env.AURAKEEPER_ENDPOINT || DEFAULT_ENDPOINT,
      EXPO_PUBLIC_AURAKEEPER_API_TOKEN: input.apiToken,
      EXPO_PUBLIC_AURAKEEPER_ENDPOINT:
        input.endpoint || process.env.AURAKEEPER_ENDPOINT || DEFAULT_ENDPOINT,
      PYTHONPATH: [
        resolve(REPO_ROOT, "connectors/python"),
        process.env.PYTHONPATH,
      ].filter(Boolean).join(":"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function triggerExample(example: ExampleDefinition, run: ExampleRun): Promise<void> {
  if (!example.triggerUrl) {
    return;
  }

  await sleep(example.readyDelayMs ?? 1000);

  try {
    const response = await fetch(example.triggerUrl);
    run.triggerStatus = response.status;
  } catch (error) {
    run.error = `Trigger failed: ${(error as Error).message}`;
  }
}

export async function listExamples() {
  const registry = await loadRegistry();
  return registry.map(serializeExample);
}

export async function startExampleRun(input: {
  exampleId: string;
  apiToken: string;
  endpoint?: string;
}): Promise<ExampleRun> {
  const registry = await loadRegistry();
  const example = registry.find((entry) => entry.id === input.exampleId);

  if (!example) {
    throw new Error(`Unknown example: ${input.exampleId}`);
  }

  const run: ExampleRun = {
    id: createRunId(),
    exampleId: example.id,
    status: "running",
    startedAt: new Date().toISOString(),
    stdout: "",
    stderr: "",
    manual: example.manual,
  };

  runs.set(run.id, run);

  try {
    const child = spawnDefinition(example, input);
    let closed = false;
    const timeout = setTimeout(() => {
      if (!closed) {
        run.error = "Example timed out.";
        child.kill("SIGTERM");
      }
    }, example.timeoutMs ?? 15000);

    child.stdout.on("data", (chunk: Buffer) => {
      run.stdout = appendOutput(run.stdout, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      run.stderr = appendOutput(run.stderr, chunk);
    });

    child.on("error", (error) => {
      run.error = error.message;
      finishRun(run, "failed");
    });

    child.on("close", (exitCode, signal) => {
      closed = true;
      clearTimeout(timeout);
      run.exitCode = exitCode;
      run.signal = signal;

      const allowed = example.successExitCodes ?? [0];
      const ok =
        Boolean(example.triggerUrl && run.triggerStatus !== undefined && !run.error) ||
        allowed.includes(exitCode ?? 0);

      finishRun(run, ok ? "completed" : "failed");
    });

    void triggerExample(example, run).then(() => {
      if (example.triggerUrl) {
        child.kill("SIGTERM");
      }
    });
  } catch (error) {
    run.error = (error as Error).message;
    finishRun(run, "failed");
  }

  return run;
}

export function getExampleRun(runId: string): ExampleRun | undefined {
  return runs.get(runId);
}

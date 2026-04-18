import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";

import { runHookAgent } from "../lib/codex.js";
import { inspectProject } from "../lib/project.js";

type HookPreference = "auto" | "template" | "project_specific";
type HookProvider = "aurakeeper" | "sentry";
const NOTE_WRAP_WIDTH = 88;

export type RunHookCommandOptions = {
  providerOverride?: HookProvider;
  introText?: string;
  outroText?: string;
};

function splitLongToken(token: string, width: number): string[] {
  if (token.length <= width) {
    return [token];
  }

  const parts: string[] = [];
  let remaining = token;

  while (remaining.length > width) {
    const slice = remaining.slice(0, width);
    const breakIndex = Math.max(
      slice.lastIndexOf("/"),
      slice.lastIndexOf("\\"),
      slice.lastIndexOf("-"),
      slice.lastIndexOf("_"),
      slice.lastIndexOf("."),
      slice.lastIndexOf(",")
    );

    const index = breakIndex > Math.floor(width / 3) ? breakIndex + 1 : width;
    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index);
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

function wrapLine(line: string, width = NOTE_WRAP_WIDTH): string[] {
  if (line.length === 0) {
    return [""];
  }

  const indent = line.match(/^\s*/)?.[0] ?? "";
  const content = line.slice(indent.length).trim();
  const contentWidth = Math.max(12, width - indent.length);

  if (content.length === 0) {
    return [indent];
  }

  const tokens = content
    .split(/\s+/)
    .flatMap((token) => splitLongToken(token, contentWidth));
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = current.length === 0 ? token : `${current} ${token}`;
    if (candidate.length <= contentWidth) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      lines.push(`${indent}${current}`);
    }
    current = token;
  }

  if (current.length > 0) {
    lines.push(`${indent}${current}`);
  }

  return lines;
}

function formatNoteBlock(lines: string[]): string {
  return lines
    .flatMap((line) => wrapLine(line))
    .join("\n");
}

function usage(): string {
  return [
    "Usage: aurakeeper hook [--provider aurakeeper|sentry]",
    "",
    "Options:",
    "  --provider <name>   Hook provider to install",
  ].join("\n");
}

function parseProviderArg(argv: string[]): HookProvider | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--provider") {
      const value = argv[index + 1];
      if (value === "aurakeeper" || value === "sentry") {
        return value;
      }

      throw new Error("Expected --provider to be one of: aurakeeper, sentry.");
    }

    if (arg.startsWith("--provider=")) {
      const value = arg.slice("--provider=".length);
      if (value === "aurakeeper" || value === "sentry") {
        return value;
      }

      throw new Error("Expected --provider to be one of: aurakeeper, sentry.");
    }
  }

  return null;
}

function assertNotCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Hook setup cancelled.");
    process.exit(0);
  }

  return value as T;
}

function buildPrompt(input: {
  cwd: string;
  projectName: string;
  provider: HookProvider;
  hookPreference: HookPreference;
  ingestionConfig: {
    endpoint: string | null;
    apiToken: string | null;
  };
  inspection: Awaited<ReturnType<typeof inspectProject>>;
  playbook: string;
}): string {
  const ingestionLines =
    input.provider === "aurakeeper" &&
    (input.ingestionConfig.endpoint || input.ingestionConfig.apiToken)
      ? [
          "User-supplied ingestion setup:",
          `- Endpoint: ${input.ingestionConfig.endpoint ?? "not provided"}`,
          `- API token: ${input.ingestionConfig.apiToken ?? "not provided"}`,
          "- Treat these as setup inputs only. Do not hardcode or commit secrets into tracked files.",
          "- If local persistence is helpful, prefer ignored env files or leave a clear next step instead.",
          "",
        ]
      : [];

  const providerInstructions =
    input.provider === "sentry"
      ? [
          "Install Sentry-based error capture instead of AuraKeeper runtime hooks.",
          "Use the smallest framework-appropriate Sentry integration for the detected stack.",
          "Use environment variables for Sentry credentials and configuration, especially `SENTRY_DSN`.",
          "Do not add AuraKeeper ingestion hooks unless the project already depends on them and the user explicitly asked for both.",
          "If documentation or setup changes are needed, explain how this Sentry-based setup can feed AuraKeeper through the existing Sentry source integration.",
        ]
      : [
          "Install AuraKeeper error capture hooks for the current project.",
          "Use environment variables for AuraKeeper credentials and configuration, especially `AURAKEEPER_API_TOKEN` and `AURAKEEPER_ENDPOINT` when needed.",
          "Any AuraKeeper hook you install must send `POST /v1/logs/errors` payloads that comply with the `ErrorLogRequest` schema from `openapi.yaml`.",
          "Treat `openapi.yaml` as the source of truth if existing code, examples, or assumptions disagree.",
          "The payload must include: `occurredAt`, `level`, `platform`, `service`, `source`, and `error`.",
          "The `service` object must include `name`.",
          "The `source` object must include `runtime` and `language`; `framework` and `component` are optional.",
          "The `error` object must include `message`; `type`, `code`, `stack`, `handled`, and `details` are optional.",
          "Put extra debugging metadata under `error.details` or `context`; do not invent top-level fields outside the schema.",
          "Send the project token via `X-API-Token` or `Authorization: Bearer <token>`, not inside the JSON body.",
          "Make sure the installed hook can actually read the project's `.env` values at runtime.",
          "Prefer integrating at an entrypoint that already loads `.env`; if the project does not do that yet, add the smallest conventional `.env` loading step needed for the hook to see `AURAKEEPER_ENDPOINT` and `AURAKEEPER_API_TOKEN`.",
        ];

  return [
    "You are the AuraKeeper hook installer agent.",
    "Work inside the target repository and make the smallest safe integration that adds the requested error capture path to the current project.",
    "You may reuse the premade hook patterns from the playbook or create a project-specific implementation when the project structure requires it.",
    "Prefer the user's existing conventions, scripts, dependency manager, and startup path.",
    "Do not hardcode secrets. Use environment variables for all tokens and endpoints.",
    "If documentation or setup changes are needed, update them.",
    "Return only a JSON object matching the provided schema.",
    "",
    `Hook provider: ${input.provider}`,
    `Hook preference: ${input.hookPreference}`,
    "",
    ...providerInstructions,
    "",
    ...ingestionLines,
    "Project inspection:",
    "```json",
    JSON.stringify(input.inspection, null, 2),
    "```",
    "",
    "Error log endpoint contract excerpt:",
    "```text",
    "POST /v1/logs/errors",
    "Required payload fields: occurredAt, level, platform, service, source, error",
    "service.name is required",
    "source.runtime and source.language are required",
    "error.message is required",
    "context is optional and may contain request/user/session/device/correlationId/tags",
    "additionalProperties is false at the top level, so do not send unknown top-level keys",
    "the installed hook must run in a process that can read the project's .env-backed AuraKeeper variables",
    "```",
    "",
    "Hook playbook:",
    "```markdown",
    input.playbook.replaceAll("```", "\\`\\`\\`"),
    "```",
    "",
    "Concrete requirements:",
    `- Target directory: ${input.cwd}`,
    `- Project name: ${input.projectName}`,
    "- Add or modify the minimum number of files needed for a working hook.",
    "- Explain any follow-up steps in the JSON nextSteps array.",
    "- Use template-based integration when it fits cleanly; otherwise write the project-specific implementation directly.",
  ].join("\n");
}

export async function runHookCommand(
  options: RunHookCommandOptions = {}
): Promise<void> {
  const providerArg =
    options.providerOverride ?? parseProviderArg(process.argv.slice(3));

  intro(options.introText ?? "AuraKeeper hook");

  const cwd = process.cwd();
  const inspection = await inspectProject(cwd);

  const detectionLines = formatNoteBlock([
    `Project: ${inspection.projectName}`,
    `Directory: ${inspection.cwd}`,
    `Package manager: ${inspection.packageManager ?? "unknown"}`,
    `Manifests: ${inspection.manifests.length > 0 ? inspection.manifests.join(", ") : "none detected"}`,
    `Detected stacks: ${
      inspection.detections.length > 0
        ? inspection.detections
            .map((entry) => `${entry.framework ? `${entry.framework} ` : ""}${entry.language}`)
            .join(", ")
        : "unknown"
    }`,
  ]);

  note(detectionLines, "Inspection");

  const projectName = assertNotCancelled(
    await text({
      message: "Service name to use for the hook",
      initialValue: inspection.projectName,
      placeholder: inspection.projectName,
      validate(value) {
        return value.trim().length > 0 ? undefined : "Service name is required.";
      },
    })
  );

  const provider = providerArg
    ? providerArg
    : assertNotCancelled(
        await select<HookProvider>({
          message: "Which hook provider should the installer add?",
          initialValue: "aurakeeper",
          options: [
            {
              value: "aurakeeper",
              label: "AuraKeeper",
              hint: "Install our direct runtime hooks.",
            },
            {
              value: "sentry",
              label: "Sentry",
              hint: "Install Sentry instead of AuraKeeper hooks.",
            },
          ],
        })
      );

  const hookPreference = assertNotCancelled(
    await select<HookPreference>({
      message: "How should the installer approach this project?",
      initialValue: "auto",
      options: [
        {
          value: "auto",
          label: "Auto",
          hint: "Let the agent choose between premade and custom integration.",
        },
        {
          value: "template",
          label: "Prefer templates",
          hint: "Use premade hook patterns when possible.",
        },
        {
          value: "project_specific",
          label: "Prefer project-specific",
          hint: "Favor a custom integration for this codebase.",
        },
      ],
    })
  );

  const configureIngestion =
    provider === "aurakeeper"
      ? assertNotCancelled(
          await confirm({
            message: "Provide ingestion endpoint settings now?",
            initialValue: false,
          })
        )
      : false;

  let ingestionEndpoint: string | null = null;
  let ingestionApiToken: string | null = null;

  if (configureIngestion) {
    ingestionEndpoint = assertNotCancelled(
      await text({
        message: "Ingestion endpoint URL",
        placeholder: "https://api.example.com/v1/logs/errors",
        validate(value) {
          if (value.trim().length === 0) {
            return "Endpoint URL is required when this step is enabled.";
          }

          try {
            const url = new URL(value.trim());
            return url.protocol === "http:" || url.protocol === "https:"
              ? undefined
              : "Endpoint URL must use http or https.";
          } catch {
            return "Enter a valid URL.";
          }
        },
      })
    ).trim();

    ingestionApiToken = assertNotCancelled(
      await text({
        message: "Ingestion API token",
        placeholder: "ak_...",
        validate(value) {
          return value.trim().length > 0
            ? undefined
            : "API token is required when this step is enabled.";
        },
      })
    ).trim();
  }

  const proceed = assertNotCancelled(
    await confirm({
      message: `Run the hook agent in ${resolve(cwd)}?`,
      initialValue: true,
    })
  );

  if (!proceed) {
    cancel("Hook setup cancelled.");
    return;
  }

  const playbook = await readFile(
    resolve(import.meta.dirname, "../../templates/hook-playbook.md"),
    "utf8"
  );

  const installSpinner = spinner();
  installSpinner.start("Running AuraKeeper hook agent");

  try {
    const result = await runHookAgent({
      cwd,
      prompt: buildPrompt({
        cwd,
        projectName: projectName.trim(),
        provider,
        hookPreference,
        ingestionConfig: {
          endpoint: ingestionEndpoint,
          apiToken: ingestionApiToken,
        },
        inspection,
        playbook,
      }),
    });

    installSpinner.stop("Hook agent completed");

    const changedFiles =
      result.filesChanged.length > 0
        ? [
            "Changed files:",
            ...result.filesChanged.map((filePath) => `- ${relative(cwd, filePath) || filePath}`),
          ]
        : ["Changed files: none reported"];

    note(
      formatNoteBlock([
        result.summary ?? "No summary returned.",
        `Strategy: ${result.strategy ?? "unknown"}`,
        `Detected stack: ${result.detectedStack ?? "unknown"}`,
        ...changedFiles,
      ]),
      "Result"
    );

    if (result.nextSteps.length > 0) {
      note(formatNoteBlock(result.nextSteps.map((step) => `- ${step}`)), "Next steps");
    }

    outro(options.outroText ?? "AuraKeeper hook installed.");
  } catch (error) {
    installSpinner.stop("Hook agent failed");
    throw error;
  }
}

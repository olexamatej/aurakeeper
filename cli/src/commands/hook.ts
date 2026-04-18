import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

export async function runHookCommand(): Promise<void> {
  const providerArg = parseProviderArg(process.argv.slice(3));

  intro("AuraKeeper hook");

  const cwd = process.cwd();
  const inspection = await inspectProject(cwd);

  const detectionLines = [
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
  ].join("\n");

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

    note(
      [
        result.summary ?? "No summary returned.",
        `Strategy: ${result.strategy ?? "unknown"}`,
        `Detected stack: ${result.detectedStack ?? "unknown"}`,
        `Changed files: ${result.filesChanged.length > 0 ? result.filesChanged.join(", ") : "none reported"}`,
      ].join("\n"),
      "Result"
    );

    if (result.nextSteps.length > 0) {
      note(result.nextSteps.join("\n"), "Next steps");
    }

    outro("AuraKeeper hook installed.");
  } catch (error) {
    installSpinner.stop("Hook agent failed");
    throw error;
  }
}

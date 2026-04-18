import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import type {
  ProjectVerificationConfig,
  TechnologyProfile,
  TechnologyProfileContext,
  VerificationCommand,
} from "./types";

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(rootPath: string): Promise<PackageJson | undefined> {
  try {
    return JSON.parse(await readFile(join(rootPath, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function detectPackageManager(rootPath: string): Promise<PackageManager> {
  if ((await pathExists(join(rootPath, "bun.lock"))) || (await pathExists(join(rootPath, "bun.lockb")))) {
    return "bun";
  }

  if (await pathExists(join(rootPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (await pathExists(join(rootPath, "yarn.lock"))) {
    return "yarn";
  }

  return "npm";
}

function packageRunCommand(packageManager: PackageManager, script: string): string {
  if (packageManager === "npm") {
    return `npm run ${script}`;
  }

  if (packageManager === "yarn") {
    return `yarn ${script}`;
  }

  return `${packageManager} run ${script}`;
}

function installCommand(packageManager: PackageManager, hasPackageLock: boolean): string {
  if (packageManager === "bun") {
    return "bun install --frozen-lockfile";
  }

  if (packageManager === "pnpm") {
    return "pnpm install --frozen-lockfile";
  }

  if (packageManager === "yarn") {
    return "yarn install --frozen-lockfile";
  }

  return hasPackageLock ? "npm ci" : "npm install";
}

function command(
  id: string,
  commandText: string,
  phase: VerificationCommand["phase"],
  timeoutMs?: number
): VerificationCommand {
  return {
    id,
    command: commandText,
    phase,
    suite: phase === "setup" ? undefined : phase,
    source: "profile",
    timeoutMs,
    network: phase === "setup" ? "enabled" : "disabled",
  };
}

function configuredCommands(
  config: ProjectVerificationConfig,
  phase: VerificationCommand["phase"]
): VerificationCommand[] {
  const commands =
    phase === "setup"
      ? config.commands?.setup
      : phase === "targeted"
        ? config.commands?.targeted
        : phase === "standard"
          ? config.commands?.standard
          : phase === "fuzz"
            ? config.commands?.fuzz
            : config.commands?.full;

  return (commands ?? []).map((entry, index) => ({
    id: `config:${phase}:${index + 1}`,
    command: entry,
    phase,
    suite: phase === "setup" ? undefined : phase,
    source: "config",
    network: phase === "setup" ? "enabled" : "disabled",
  }));
}

function scriptCommand(
  packageManager: PackageManager,
  scriptName: string,
  phase: VerificationCommand["phase"]
): VerificationCommand {
  return command(
    `profile:${phase}:${scriptName}`,
    packageRunCommand(packageManager, scriptName),
    phase
  );
}

function hasDependency(packageJson: PackageJson | undefined, dependencyName: string): boolean {
  return Boolean(
    packageJson?.dependencies?.[dependencyName] ||
      packageJson?.devDependencies?.[dependencyName]
  );
}

async function nodeCommands(context: TechnologyProfileContext): Promise<VerificationCommand[]> {
  const packageJson = await readPackageJson(context.rootPath);
  const packageManager = await detectPackageManager(context.rootPath);
  const hasPackageLock = await pathExists(join(context.rootPath, "package-lock.json"));
  const scripts = packageJson?.scripts ?? {};
  const commands: VerificationCommand[] = [];

  commands.push(
    ...configuredCommands(context.config, "setup"),
    command("profile:setup:install", installCommand(packageManager, hasPackageLock), "setup")
  );

  if (context.config.commands?.replay) {
    commands.push({
      id: "config:targeted:replay",
      command: context.config.commands.replay,
      phase: "targeted",
      suite: "targeted",
      source: "config",
      network: "disabled",
    });
  }

  commands.push(...configuredCommands(context.config, "targeted"));
  commands.push(...configuredCommands(context.config, "standard"));

  for (const scriptName of ["test", "typecheck", "lint", "build"]) {
    if (scripts[scriptName]) {
      commands.push(scriptCommand(packageManager, scriptName, "standard"));
    }
  }

  if (context.config.commands?.test) {
    commands.push({
      id: "config:standard:test",
      command: context.config.commands.test,
      phase: "standard",
      suite: "standard",
      source: "config",
      network: "disabled",
    });
  }

  if (context.config.commands?.typecheck) {
    commands.push({
      id: "config:standard:typecheck",
      command: context.config.commands.typecheck,
      phase: "standard",
      suite: "standard",
      source: "config",
      network: "disabled",
    });
  }

  if (context.config.commands?.lint) {
    commands.push({
      id: "config:standard:lint",
      command: context.config.commands.lint,
      phase: "standard",
      suite: "standard",
      source: "config",
      network: "disabled",
    });
  }

  if (context.config.commands?.build) {
    commands.push({
      id: "config:standard:build",
      command: context.config.commands.build,
      phase: "standard",
      suite: "standard",
      source: "config",
      network: "disabled",
    });
  }

  commands.push(...configuredCommands(context.config, "fuzz"));

  if (scripts.smoke) {
    commands.push(scriptCommand(packageManager, "smoke", "fuzz"));
  }

  if (scripts.fuzz) {
    commands.push(scriptCommand(packageManager, "fuzz", "fuzz"));
  }

  commands.push(...configuredCommands(context.config, "full"));

  return commands;
}

async function hasNextFiles(rootPath: string): Promise<boolean> {
  if (
    (await pathExists(join(rootPath, "next.config.js"))) ||
    (await pathExists(join(rootPath, "next.config.mjs"))) ||
    (await pathExists(join(rootPath, "next.config.ts")))
  ) {
    return true;
  }

  try {
    const entries = await readdir(rootPath);
    return entries.includes("app") || entries.includes("pages");
  } catch {
    return false;
  }
}

function changedRuntimeFiles(context: TechnologyProfileContext): string[] {
  return context.changedFiles.filter((filePath) => {
    const extension = extname(filePath);
    return [".js", ".mjs", ".cjs"].includes(extension);
  });
}

function importSmokeCommand(files: string[]): string | undefined {
  if (files.length === 0) {
    return undefined;
  }

  const quotedFiles = JSON.stringify(files.map((file) => `./${file}`));

  return `node -e 'const files = ${quotedFiles}; (async () => { for (const file of files) { await import(file); } })()'`;
}

export const genericProfile: TechnologyProfile = {
  id: "generic",
  displayName: "Generic",
  defaultDockerImage: "ubuntu:24.04",
  async detect() {
    return 1;
  },
  async buildCommands(context) {
    return [
      ...configuredCommands(context.config, "setup"),
      ...configuredCommands(context.config, "targeted"),
      ...configuredCommands(context.config, "standard"),
      ...configuredCommands(context.config, "fuzz"),
      ...configuredCommands(context.config, "full"),
    ];
  },
};

export const nodeProfile: TechnologyProfile = {
  id: "node",
  displayName: "Node.js",
  defaultDockerImage: "node:22-bookworm-slim",
  async detect(rootPath) {
    return (await pathExists(join(rootPath, "package.json"))) ? 60 : 0;
  },
  buildCommands: nodeCommands,
};

export const nextProfile: TechnologyProfile = {
  id: "next",
  displayName: "Next.js",
  defaultDockerImage: "node:22-bookworm-slim",
  async detect(rootPath) {
    const packageJson = await readPackageJson(rootPath);

    if (hasDependency(packageJson, "next") || (await hasNextFiles(rootPath))) {
      return 90;
    }

    return 0;
  },
  async buildCommands(context) {
    const commands = await nodeCommands(context);
    const packageJson = await readPackageJson(context.rootPath);
    const packageManager = await detectPackageManager(context.rootPath);

    if (!packageJson?.scripts?.build && hasDependency(packageJson, "next")) {
      commands.push(command("profile:standard:next-build", "npx next build", "standard"));
    }

    const importCommand = importSmokeCommand(
      changedRuntimeFiles(context).map((filePath) => relative(context.rootPath, join(context.rootPath, filePath)))
    );

    if (importCommand) {
      commands.push(command("profile:fuzz:changed-module-import", importCommand, "fuzz"));
    }

    if (packageJson?.scripts?.["next:smoke"]) {
      commands.push({
        id: "profile:fuzz:next-smoke",
        command: packageRunCommand(packageManager, "next:smoke"),
        phase: "fuzz",
        suite: "fuzz",
        source: "profile",
        network: "disabled",
      });
    }

    return commands;
  },
};

export const builtInProfiles: TechnologyProfile[] = [
  nextProfile,
  nodeProfile,
  genericProfile,
];

export function getProfileById(id: string): TechnologyProfile | undefined {
  return builtInProfiles.find((profile) => profile.id === id);
}

export async function selectTechnologyProfile(
  rootPath: string,
  explicitProfiles?: string[]
): Promise<TechnologyProfile> {
  if (explicitProfiles && explicitProfiles.length > 0) {
    const profile = explicitProfiles
      .map(getProfileById)
      .find((entry): entry is TechnologyProfile => Boolean(entry));

    return profile ?? genericProfile;
  }

  const scored = await Promise.all(
    builtInProfiles.map(async (profile) => ({
      profile,
      score: await profile.detect(rootPath),
    }))
  );

  scored.sort((left, right) => right.score - left.score);

  return scored[0]?.score > 0 ? scored[0].profile : genericProfile;
}

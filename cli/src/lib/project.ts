import { access, readFile, readdir } from "node:fs/promises";
import { constants, type Dirent } from "node:fs";
import { basename, join } from "node:path";

type Detection = {
  language: string;
  framework?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type ProjectInspection = {
  cwd: string;
  projectName: string;
  packageManager?: string;
  manifests: string[];
  detections: Detection[];
};

export type HookDetection = {
  installed: boolean;
  evidence: string[];
};

const AURAKEEPER_ENV_VARIABLES = [
  "AURAKEEPER_ENDPOINT",
  "AURAKEEPER_API_TOKEN",
  "EXPO_PUBLIC_AURAKEEPER_ENDPOINT",
  "EXPO_PUBLIC_AURAKEEPER_API_TOKEN",
  "NEXT_PUBLIC_AURAKEEPER_ENDPOINT",
  "NEXT_PUBLIC_AURAKEEPER_API_TOKEN",
  "VITE_AURAKEEPER_ENDPOINT",
  "VITE_AURAKEEPER_API_TOKEN",
] as const;

const HOOK_MARKERS = [
  "AURAKEEPER_ENDPOINT",
  "AURAKEEPER_API_TOKEN",
  "createAuraKeeper",
  "@aurakeeper/",
  "AuraKeeper.createAuraKeeper",
] as const;

const HOOK_SCAN_DIRECTORIES = ["."] as const;

const HOOK_SCAN_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".env",
  ".yaml",
  ".yml",
]);

const HOOK_SCAN_IGNORE = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "build",
  "node_modules",
]);
const MAX_HOOK_SCAN_FILES = 200;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function hasSupportedExtension(fileName: string): boolean {
  for (const extension of HOOK_SCAN_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

async function collectFilesForHookScan(
  cwd: string,
  relativeDir: string,
  files: string[]
): Promise<void> {
  if (files.length >= MAX_HOOK_SCAN_FILES) {
    return;
  }

  const absoluteDir = join(cwd, relativeDir);
  let entries: Dirent<string>[];

  try {
    entries = await readdir(absoluteDir, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_HOOK_SCAN_FILES) {
      return;
    }

    const nextRelativePath =
      relativeDir === "." ? entry.name : join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      if (HOOK_SCAN_IGNORE.has(entry.name)) {
        continue;
      }

      await collectFilesForHookScan(cwd, nextRelativePath, files);
      continue;
    }

    if (entry.isFile() && hasSupportedExtension(entry.name)) {
      files.push(nextRelativePath);
    }
  }
}

export async function detectAuraKeeperHook(cwd: string): Promise<HookDetection> {
  const evidence = new Set<string>();
  const packageJson = await readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(join(cwd, "package.json"));

  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  for (const dependencyName of Object.keys(dependencies)) {
    if (
      dependencyName.startsWith("@aurakeeper/") ||
      dependencyName === "aurakeeper"
    ) {
      evidence.add(`package.json dependency: ${dependencyName}`);
    }
  }

  const filesToScan: string[] = [];

  for (const relativeDir of HOOK_SCAN_DIRECTORIES) {
    await collectFilesForHookScan(cwd, relativeDir, filesToScan);

    if (filesToScan.length >= MAX_HOOK_SCAN_FILES) {
      break;
    }
  }

  for (const relativePath of filesToScan) {
    let contents: string;

    try {
      contents = await readFile(join(cwd, relativePath), "utf8");
    } catch {
      continue;
    }

    const marker = HOOK_MARKERS.find((candidate) => contents.includes(candidate));

    if (marker) {
      evidence.add(`${relativePath}: ${marker}`);
    }
  }

  return {
    installed: evidence.size > 0,
    evidence: Array.from(evidence).slice(0, 10),
  };
}

export async function detectAuraKeeperEnvVariables(cwd: string): Promise<string[]> {
  const envVariables = new Set<string>([
    "AURAKEEPER_ENDPOINT",
    "AURAKEEPER_API_TOKEN",
  ]);
  const filesToScan: string[] = [];

  for (const relativeDir of HOOK_SCAN_DIRECTORIES) {
    await collectFilesForHookScan(cwd, relativeDir, filesToScan);

    if (filesToScan.length >= MAX_HOOK_SCAN_FILES) {
      break;
    }
  }

  for (const relativePath of filesToScan) {
    let contents: string;

    try {
      contents = await readFile(join(cwd, relativePath), "utf8");
    } catch {
      continue;
    }

    for (const variableName of AURAKEEPER_ENV_VARIABLES) {
      if (contents.includes(variableName)) {
        envVariables.add(variableName);
      }
    }
  }

  return Array.from(envVariables);
}

async function detectPackageManager(cwd: string): Promise<string | undefined> {
  const candidates: Array<[string, string]> = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
  ];

  for (const [file, packageManager] of candidates) {
    if (await fileExists(join(cwd, file))) {
      return packageManager;
    }
  }

  return undefined;
}

export async function inspectProject(cwd: string): Promise<ProjectInspection> {
  const manifests = [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Gemfile",
    "composer.json",
    "go.mod",
    "pom.xml",
    "Cargo.toml",
    ".csproj",
  ];

  const foundManifests: string[] = [];
  const detections: Detection[] = [];

  for (const manifest of manifests) {
    if (manifest === ".csproj") {
      continue;
    }

    if (await fileExists(join(cwd, manifest))) {
      foundManifests.push(manifest);
    }
  }

  const packageJson = await readJson<{ name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    join(cwd, "package.json")
  );

  if (packageJson) {
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (deps.next) {
      detections.push({
        language: "typescript",
        framework: "next.js",
        confidence: "high",
        reason: "Detected next dependency in package.json",
      });
    } else if (deps.react) {
      detections.push({
        language: "typescript",
        framework: "react",
        confidence: "medium",
        reason: "Detected react dependency in package.json",
      });
    } else {
      detections.push({
        language: "javascript",
        confidence: "medium",
        reason: "Detected package.json",
      });
    }
  }

  if (await fileExists(join(cwd, "pyproject.toml")) || await fileExists(join(cwd, "requirements.txt"))) {
    detections.push({
      language: "python",
      confidence: "medium",
      reason: "Detected Python project manifest",
    });
  }

  if (await fileExists(join(cwd, "Gemfile"))) {
    detections.push({
      language: "ruby",
      confidence: "medium",
      reason: "Detected Gemfile",
    });
  }

  if (await fileExists(join(cwd, "composer.json"))) {
    detections.push({
      language: "php",
      confidence: "medium",
      reason: "Detected composer.json",
    });
  }

  if (await fileExists(join(cwd, "go.mod"))) {
    detections.push({
      language: "go",
      confidence: "medium",
      reason: "Detected go.mod",
    });
  }

  if (await fileExists(join(cwd, "pom.xml"))) {
    detections.push({
      language: "java",
      confidence: "medium",
      reason: "Detected pom.xml",
    });
  }

  return {
    cwd,
    projectName: packageJson?.name ?? basename(cwd),
    packageManager: await detectPackageManager(cwd),
    manifests: foundManifests,
    detections,
  };
}

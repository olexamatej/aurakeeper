import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
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

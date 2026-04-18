import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { selectExecutionBackend } from "./orchestrator";
import { nodeProfile } from "./profiles";
import { applyWorkerPatch, cleanupWorkspace, createArtifactsDir, prepareWorkspace } from "./workspace";

describe("execution backend selection", () => {
  test("selects docker for production repair attempts", () => {
    const decision = selectExecutionBackend({
      dockerAvailable: true,
      environment: "production",
      trustLevel: "untrusted",
      requiredSuites: ["targeted"],
    });

    expect(decision).toMatchObject({
      status: "selected",
      backend: "docker",
      fallback: false,
    });
  });

  test("selects local for trusted local development runs", () => {
    const decision = selectExecutionBackend({
      dockerAvailable: true,
      environment: "local",
      trustLevel: "trusted",
      requiredSuites: ["standard"],
    });

    expect(decision).toMatchObject({
      status: "selected",
      backend: "local",
      fallback: false,
    });
  });

  test("falls back to local when docker is unavailable and project is trusted", () => {
    const decision = selectExecutionBackend({
      dockerAvailable: false,
      environment: "production",
      trustLevel: "trusted",
      requiredSuites: ["standard"],
      config: {
        execution: {
          allowedBackends: ["docker", "local"],
        },
      },
    });

    expect(decision).toMatchObject({
      status: "selected",
      backend: "local",
      fallback: true,
    });
  });

  test("blocks untrusted projects when docker is unavailable", () => {
    const decision = selectExecutionBackend({
      dockerAvailable: false,
      environment: "production",
      trustLevel: "untrusted",
      requiredSuites: ["standard"],
    });

    expect(decision).toMatchObject({
      status: "blocked",
      fallback: false,
    });
  });
});

describe("technology profiles", () => {
  test("maps node package scripts to standard verification commands", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "aurakeeper-node-profile-"));

    try {
      await writeFile(
        join(rootPath, "package.json"),
        JSON.stringify({
          scripts: {
            test: "node test.js",
            lint: "eslint .",
            build: "tsc",
          },
        })
      );

      const commands = await nodeProfile.buildCommands({
        rootPath,
        changedFiles: [],
        selectedSuites: ["standard"],
        config: {},
      });

      expect(commands.map((command) => command.command)).toContain("npm run test");
      expect(commands.map((command) => command.command)).toContain("npm run lint");
      expect(commands.map((command) => command.command)).toContain("npm run build");
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

describe("local workspace safety", () => {
  test("applies worker patches only inside the temp workspace", async () => {
    const sourcePath = await mkdtemp(join(tmpdir(), "aurakeeper-source-"));
    const artifactsDir = await createArtifactsDir();

    try {
      await mkdir(join(sourcePath, "src"));
      await writeFile(join(sourcePath, "src", "value.txt"), "old\n");

      const patch = `diff --git a/src/value.txt b/src/value.txt
--- a/src/value.txt
+++ b/src/value.txt
@@ -1 +1 @@
-old
+new
`;
      const workspace = await prepareWorkspace({
        backend: "local",
        request: {
          repairAttemptId: "attempt_test",
          repository: {
            checkoutPath: sourcePath,
          },
          patch,
          keepWorkspace: true,
        },
        profile: nodeProfile,
        config: {},
        artifactsDir,
      });

      const result = await applyWorkerPatch(workspace, {
        repairAttemptId: "attempt_test",
        repository: {
          checkoutPath: sourcePath,
        },
        patch,
      });

      expect(result.applied).toBe(true);
      expect(await readFile(join(sourcePath, "src", "value.txt"), "utf8")).toBe("old\n");
      expect(await readFile(join(workspace.workspacePath, "src", "value.txt"), "utf8")).toBe("new\n");

      await cleanupWorkspace({
        ...workspace,
        keepWorkspace: false,
      });
    } finally {
      await rm(sourcePath, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});

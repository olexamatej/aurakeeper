import type {
  BackendSelectionDecision,
  BackendSelectionInput,
  ExecutionBackendId,
  ExecutionBackendPreference,
  VerificationEnvironment,
} from "./types";

const DEFAULT_BACKENDS: ExecutionBackendId[] = ["docker", "local"];

function includesBackend(
  backends: ExecutionBackendId[],
  backend: ExecutionBackendId
): boolean {
  return backends.includes(backend);
}

function isDockerPreferredEnvironment(environment: VerificationEnvironment): boolean {
  return environment === "production" || environment === "hosted";
}

function choosePreferredBackend(input: BackendSelectionInput): ExecutionBackendPreference {
  if (input.requestedBackend && input.requestedBackend !== "auto") {
    return input.requestedBackend;
  }

  const configured = input.config?.execution?.preferredBackend;

  if (configured && configured !== "auto") {
    return configured;
  }

  const environment =
    input.environment ?? input.config?.execution?.environment ?? "production";
  const trustLevel = input.trustLevel ?? input.config?.execution?.trustLevel ?? "untrusted";

  if (input.config?.execution?.requiresDocker) {
    return "docker";
  }

  if (isDockerPreferredEnvironment(environment) || trustLevel === "untrusted") {
    return "docker";
  }

  return "local";
}

function isBackendAvailable(backend: ExecutionBackendId, dockerAvailable: boolean): boolean {
  if (backend === "docker") {
    return dockerAvailable;
  }

  return true;
}

export function selectExecutionBackend(
  input: BackendSelectionInput
): BackendSelectionDecision {
  const allowedBackends = input.config?.execution?.allowedBackends ?? DEFAULT_BACKENDS;
  const preferred = choosePreferredBackend(input);
  const trustLevel = input.trustLevel ?? input.config?.execution?.trustLevel ?? "untrusted";

  if (!includesBackend(allowedBackends, preferred)) {
    return {
      status: "blocked",
      reason: `Preferred backend '${preferred}' is not allowed by project policy.`,
      fallback: false,
    };
  }

  if (isBackendAvailable(preferred, input.dockerAvailable)) {
    return {
      status: "selected",
      backend: preferred,
      reason: `Selected '${preferred}' from orchestrator policy.`,
      fallback: false,
    };
  }

  if (
    preferred === "docker" &&
    trustLevel === "trusted" &&
    includesBackend(allowedBackends, "local")
  ) {
    return {
      status: "selected",
      backend: "local",
      reason:
        "Docker is unavailable, project is trusted, and local execution is allowed.",
      fallback: true,
    };
  }

  return {
    status: "blocked",
    reason:
      preferred === "docker"
        ? "Docker is unavailable and no safe fallback is allowed."
        : `Preferred backend '${preferred}' is unavailable.`,
    fallback: false,
  };
}

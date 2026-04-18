"use strict";

var childProcess = require("node:child_process");
var os = require("node:os");
var path = require("node:path");

function AuraKeeperCliConnector(options) {
  if (!options || !options.endpoint) {
    throw new Error("AuraKeeperCliConnector requires an endpoint.");
  }

  if (!options.apiToken) {
    throw new Error("AuraKeeperCliConnector requires an apiToken.");
  }

  if (!options.serviceName) {
    throw new Error("AuraKeeperCliConnector requires a serviceName.");
  }

  this.options = options;
  this.pendingRequests = new Set();
  this.installed = false;
  this.listeners = {};
  this.fatalDrainInProgress = false;
}

AuraKeeperCliConnector.prototype.install = function install() {
  if (this.installed) {
    return this;
  }

  if (this.options.captureUncaught !== false) {
    this.listeners.uncaughtException = this.handleUncaughtException.bind(this);
    process.on("uncaughtException", this.listeners.uncaughtException);
  }

  if (this.options.captureRejections !== false) {
    this.listeners.unhandledRejection = this.handleUnhandledRejection.bind(this);
    process.on("unhandledRejection", this.listeners.unhandledRejection);
  }

  this.installed = true;
  return this;
};

AuraKeeperCliConnector.prototype.uninstall = function uninstall() {
  if (!this.installed) {
    return this;
  }

  if (this.listeners.uncaughtException) {
    removeProcessListener("uncaughtException", this.listeners.uncaughtException);
  }

  if (this.listeners.unhandledRejection) {
    removeProcessListener("unhandledRejection", this.listeners.unhandledRejection);
  }

  this.listeners = {};
  this.installed = false;
  return this;
};

AuraKeeperCliConnector.prototype.captureException = function captureException(
  error,
  overrides
) {
  var payload = this.buildPayload(error, overrides || {});

  if (!payload) {
    return Promise.resolve(null);
  }

  return this.track(this.send(payload));
};

AuraKeeperCliConnector.prototype.captureMessage = function captureMessage(
  message,
  overrides
) {
  var syntheticError = new Error(String(message));
  syntheticError.name = "Error";
  return this.captureException(syntheticError, overrides);
};

AuraKeeperCliConnector.prototype.captureCommandFailure =
  function captureCommandFailure(commandResult, overrides) {
    var normalizedCommand = normalizeCommandFailure(
      commandResult,
      (overrides && overrides.outputLimit) || this.options.outputLimit
    );
    var commandOverrides = mergeObjects(overrides, {
      handled:
        overrides && typeof overrides.handled === "boolean"
          ? overrides.handled
          : true,
      level:
        overrides && overrides.level
          ? overrides.level
          : normalizedCommand.level || "error",
      details: mergeObjects(
        overrides && overrides.details,
        normalizedCommand.details
      ),
      context: mergeObjects(
        overrides && overrides.context,
        normalizedCommand.context
      ),
    });

    return this.captureException(normalizedCommand.error, commandOverrides);
  };

AuraKeeperCliConnector.prototype.flush = function flush() {
  return Promise.allSettled(Array.from(this.pendingRequests));
};

AuraKeeperCliConnector.prototype.handleUncaughtException =
  function handleUncaughtException(error) {
    this.captureException(error, {
      handled: false,
      level: "critical",
    })
      .catch(this.handleTransportFailure.bind(this))
      .finally(
        function onFinally() {
          this.finishFatal(error, "uncaughtException");
        }.bind(this)
      );
  };

AuraKeeperCliConnector.prototype.handleUnhandledRejection =
  function handleUnhandledRejection(reason) {
    var normalized = normalizeUnknownError(reason, "Unhandled promise rejection");

    this.captureException(normalized.error, {
      handled: false,
      level: "error",
      details: mergeObjects(normalized.details, {
        rejection: true,
      }),
    })
      .catch(this.handleTransportFailure.bind(this))
      .finally(
        function onFinally() {
          this.finishFatal(normalized.error, "unhandledRejection");
        }.bind(this)
      );
  };

AuraKeeperCliConnector.prototype.finishFatal = function finishFatal(error, kind) {
  var normalized = normalizeUnknownError(error, "Fatal CLI error");

  if (this.options.exitOnFatal === false || this.fatalDrainInProgress) {
    return;
  }

  this.fatalDrainInProgress = true;

  Promise.resolve(this.flush())
    .catch(function ignoreFlushFailure() {
      return undefined;
    })
    .finally(
      function onFinally() {
        this.uninstall();

        if (typeof this.options.onFatal === "function") {
          this.options.onFatal(normalized.error, kind);
          return;
        }

        if (!process.exitCode) {
          process.exitCode = 1;
        }

        setImmediate(function rethrowFatalError() {
          throw normalized.error;
        });
      }.bind(this)
    );
};

AuraKeeperCliConnector.prototype.handleTransportFailure =
  function handleTransportFailure(error) {
    if (typeof this.options.onTransportError === "function") {
      this.options.onTransportError(error);
      return;
    }

    if (typeof console !== "undefined" && console.error) {
      console.error("AuraKeeper CLI connector failed to send error log.", error);
    }
  };

AuraKeeperCliConnector.prototype.buildPayload = function buildPayload(
  error,
  overrides
) {
    var normalized = normalizeUnknownError(error, "Unknown CLI error");
    var mergedDetails = mergeObjects(normalized.details, overrides.details);
    var mergedContext = this.buildContext(overrides);
    var payload = {
      eventId: overrides.eventId || generateEventId(),
      occurredAt: overrides.occurredAt || new Date().toISOString(),
      level: overrides.level || "error",
      platform: overrides.platform || this.options.platform || "cli",
      environment: overrides.environment || this.options.environment,
      service: compactObject(
        mergeObjects(
          {
            name: this.options.serviceName,
            version: this.options.serviceVersion,
            instanceId: this.options.instanceId,
          },
          overrides.service
        )
      ),
      source: compactObject(
        mergeObjects(
          {
            runtime: "node",
            language: this.options.language || "javascript",
            framework: this.options.framework,
            component: this.options.component || detectComponent(),
          },
          overrides.source
        )
      ),
      error: compactObject({
        type: overrides.type || normalized.error.name || "Error",
        message:
          overrides.message || normalized.error.message || "Unknown CLI error",
        code: overrides.code || readErrorCode(error),
        stack: overrides.stack || normalized.error.stack,
        handled:
          typeof overrides.handled === "boolean" ? overrides.handled : true,
        details: hasOwnKeys(mergedDetails) ? mergedDetails : undefined,
      }),
      context: hasOwnKeys(mergedContext) ? mergedContext : undefined,
    };

    if (typeof this.options.beforeSend === "function") {
      var nextPayload = this.options.beforeSend(payload);

      if (nextPayload === false || nextPayload == null) {
        return null;
      }

      payload = nextPayload;
    }

    return pruneEmpty(compactObject(payload));
  };

AuraKeeperCliConnector.prototype.buildContext = function buildContext(overrides) {
  var optionContext = this.options.context || {};
  var overrideContext = overrides.context || {};
  var baseCliContext = this.options.captureProcessContext === false
    ? {}
    : collectCliContext(this.options);
  var gitContext = this.options.captureGitContext === false
    ? {}
    : collectGitContext(this.options);
  var tags = []
    .concat(this.options.tags || [])
    .concat(optionContext.tags || [])
    .concat(overrideContext.tags || [])
    .concat(overrides.tags || []);

  return pruneEmpty(
    mergeObjects(baseCliContext, gitContext, optionContext, overrideContext, {
      request: mergeObjects(
        optionContext.request,
        overrideContext.request,
        overrides.request
      ),
      user: mergeObjects(optionContext.user, overrideContext.user, overrides.user),
      session: mergeObjects(
        baseCliContext.session,
        optionContext.session,
        overrideContext.session,
        overrides.session
      ),
      device: mergeObjects(
        baseCliContext.device,
        optionContext.device,
        overrideContext.device,
        overrides.device
      ),
      repository: mergeObjects(
        gitContext.repository,
        optionContext.repository,
        overrideContext.repository,
        overrides.repository
      ),
      process: mergeObjects(
        baseCliContext.process,
        optionContext.process,
        overrideContext.process,
        overrides.process
      ),
      correlationId:
        overrides.correlationId ||
        overrideContext.correlationId ||
        optionContext.correlationId,
      tags: tags.length ? uniqueStrings(tags) : undefined,
    })
  );
};

AuraKeeperCliConnector.prototype.send = function send(payload) {
  var transport = this.options.transport || defaultTransport;

  return Promise.resolve(
    transport({
      endpoint: this.options.endpoint,
      apiToken: this.options.apiToken,
      payload: payload,
      headers: this.options.headers || {},
      fetch: this.options.fetch,
    })
  );
};

AuraKeeperCliConnector.prototype.track = function track(promise) {
  var pending = Promise.resolve(promise).finally(
    function cleanup() {
      this.pendingRequests.delete(pending);
    }.bind(this)
  );

  this.pendingRequests.add(pending);
  return pending;
};

function createAuraKeeperCliConnector(options) {
  return new AuraKeeperCliConnector(options);
}

function defaultTransport(config) {
  var fetchImpl = config.fetch || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error(
      "AuraKeeper requires fetch. Provide options.fetch or options.transport when fetch is unavailable."
    );
  }

  return fetchImpl(config.endpoint, {
    method: "POST",
    headers: mergeObjects(
      {
        "content-type": "application/json",
        "X-API-Token": config.apiToken,
      },
      config.headers
    ),
    body: JSON.stringify(config.payload),
    keepalive: true,
  }).then(function handleResponse(response) {
    if (response && response.ok) {
      return response;
    }

    if (!response || typeof response.text !== "function") {
      throw new Error("AuraKeeper request failed.");
    }

    return response.text().then(function onResponseText(text) {
      throw new Error(
        "AuraKeeper request failed with status " +
          response.status +
          ": " +
          text
      );
    });
  });
}

function collectCliContext(options) {
  var cwd = options.cwd || safeGetCwd();
  var argv = Array.isArray(options.argv) ? options.argv.slice() : process.argv.slice();
  var command =
    options.command ||
    buildCommandString(argv.length ? argv.slice(2) : []) ||
    buildCommandString(argv);

  return pruneEmpty({
    session: {
      cwd: cwd,
      argv: argv,
      command: command,
      packageManager:
        options.packageManager ||
        detectPackageManager(process.env) ||
        undefined,
      pid: typeof process.pid === "number" ? process.pid : undefined,
    },
    device: options.captureDeviceContext === false
      ? undefined
      : {
          hostname: safeCall(os.hostname),
          platform: process.platform,
          arch: process.arch,
          release: safeCall(os.release),
        },
    process: {
      title: process.title,
      execPath: process.execPath,
      nodeVersion: process.version,
    },
  });
}

function collectGitContext(options) {
  var cwd = options.cwd || safeGetCwd();
  var topLevel = runGitCommand(cwd, ["rev-parse", "--show-toplevel"]);

  if (!topLevel.ok || !topLevel.stdout) {
    return {};
  }

  var root = topLevel.stdout.trim();
  var branch = runGitCommand(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  var commit = runGitCommand(root, ["rev-parse", "HEAD"]);
  var status = runGitCommand(root, ["status", "--porcelain"]);
  var statusOutput = status.ok ? status.stdout.trim() : "";
  var dirtyLines = statusOutput ? statusOutput.split("\n").filter(Boolean) : [];

  return pruneEmpty({
    repository: {
      root: root,
      branch: branch.ok ? branch.stdout.trim() : undefined,
      commit: commit.ok ? commit.stdout.trim() : undefined,
      isDirty: dirtyLines.length ? true : false,
      dirtySummary: dirtyLines.length
        ? dirtyLines.slice(0, 20)
        : undefined,
    },
  });
}

function runGitCommand(cwd, args) {
  try {
    var result = childProcess.spawnSync("git", args, {
      cwd: cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1500,
    });

    return {
      ok: !result.error && result.status === 0,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  } catch (error) {
    return {
      ok: false,
      error: error,
      stdout: "",
      stderr: "",
    };
  }
}

function normalizeCommandFailure(commandResult, outputLimit) {
  var normalized = isObject(commandResult) ? commandResult : {};
  var command =
    normalized.command ||
    buildCommandString(normalized.argv) ||
    buildCommandString(normalized.args) ||
    undefined;
  var exitCode = readNumber(normalized.exitCode, normalized.status);
  var signal = readString(normalized.signal);
  var stdout = limitText(readMaybeString(normalized.stdout), outputLimit);
  var stderr = limitText(readMaybeString(normalized.stderr), outputLimit);
  var combinedOutput = limitText(readMaybeString(normalized.output), outputLimit);
  var nestedError = normalized.error;
  var message = normalized.message;

  if (!message) {
    message = "Command failed";

    if (command) {
      message += ": " + command;
    }

    if (typeof exitCode === "number") {
      message += " (exit code " + exitCode + ")";
    } else if (signal) {
      message += " (signal " + signal + ")";
    }
  }

  var error =
    nestedError instanceof Error ? nestedError : new Error(message || "Command failed");

  if (!error.message) {
    error.message = message || "Command failed";
  }

  var failureDetails = compactObject({
    command: command,
    exitCode: exitCode,
    signal: signal,
    stdout: stdout,
    stderr: stderr,
    output: combinedOutput,
  });

  return {
    error: error,
    level: exitCode === 0 ? "warning" : "error",
    details: {
      failedCommand: failureDetails,
    },
    context: {
      session: compactObject({
        cwd: normalized.cwd,
        command: command,
      }),
    },
  };
}

function normalizeUnknownError(value, fallbackMessage) {
  if (value instanceof Error) {
    return {
      error: value,
      details: undefined,
    };
  }

  if (isObject(value) && typeof value.message === "string") {
    var errorLike = new Error(value.message);
    errorLike.name =
      typeof value.name === "string" && value.name ? value.name : "Error";
    errorLike.stack =
      typeof value.stack === "string" ? value.stack : errorLike.stack;

    return {
      error: errorLike,
      details: sanitizeJson(value),
    };
  }

  var message =
    typeof value === "string" && value ? value : fallbackMessage || "Unknown error";
  var normalizedError = new Error(message);

  return {
    error: normalizedError,
    details:
      typeof value === "undefined"
        ? undefined
        : {
            originalValue: sanitizeJson(value),
          },
  };
}

function readErrorCode(error) {
  if (error && typeof error.code === "string") {
    return error.code;
  }

  return undefined;
}

function detectComponent() {
  if (process.argv[1]) {
    return path.basename(process.argv[1]);
  }

  if (process.title) {
    return process.title;
  }

  return "cli";
}

function detectPackageManager(env) {
  if (!env) {
    return undefined;
  }

  if (typeof env.npm_config_user_agent === "string") {
    if (env.npm_config_user_agent.indexOf("pnpm") !== -1) {
      return "pnpm";
    }

    if (env.npm_config_user_agent.indexOf("yarn") !== -1) {
      return "yarn";
    }

    if (env.npm_config_user_agent.indexOf("bun") !== -1) {
      return "bun";
    }

    if (env.npm_config_user_agent.indexOf("npm") !== -1) {
      return "npm";
    }
  }

  if (typeof env.npm_execpath === "string") {
    if (env.npm_execpath.indexOf("pnpm") !== -1) {
      return "pnpm";
    }

    if (env.npm_execpath.indexOf("yarn") !== -1) {
      return "yarn";
    }

    if (env.npm_execpath.indexOf("bun") !== -1) {
      return "bun";
    }

    if (env.npm_execpath.indexOf("npm") !== -1) {
      return "npm";
    }
  }

  return undefined;
}

function buildCommandString(argv) {
  if (!Array.isArray(argv) || !argv.length) {
    return undefined;
  }

  return argv
    .map(function quoteArg(value) {
      var stringValue = String(value);

      if (/^[A-Za-z0-9_./:@=-]+$/.test(stringValue)) {
        return stringValue;
      }

      return JSON.stringify(stringValue);
    })
    .join(" ");
}

function generateEventId() {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return "evt_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function removeProcessListener(eventName, listener) {
  if (typeof process.off === "function") {
    process.off(eventName, listener);
    return;
  }

  if (typeof process.removeListener === "function") {
    process.removeListener(eventName, listener);
  }
}

function limitText(value, maxLength) {
  if (typeof value !== "string") {
    return undefined;
  }

  if (!maxLength || value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength) + "\n...[truncated]";
}

function readMaybeString(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return undefined;
}

function readNumber() {
  var values = Array.prototype.slice.call(arguments);
  var index;

  for (index = 0; index < values.length; index += 1) {
    if (typeof values[index] === "number" && !Number.isNaN(values[index])) {
      return values[index];
    }
  }

  return undefined;
}

function readString(value) {
  return typeof value === "string" && value ? value : undefined;
}

function safeGetCwd() {
  try {
    return process.cwd();
  } catch (error) {
    return undefined;
  }
}

function safeCall(fn) {
  try {
    return typeof fn === "function" ? fn() : undefined;
  } catch (error) {
    return undefined;
  }
}

function uniqueStrings(values) {
  var output = [];
  var seen = new Set();

  values.forEach(function each(value) {
    if (typeof value !== "string" || !value) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    output.push(value);
  });

  return output;
}

function compactObject(value) {
  if (!isObject(value)) {
    return value;
  }

  var output = {};

  Object.keys(value).forEach(function eachKey(key) {
    if (typeof value[key] !== "undefined") {
      output[key] = value[key];
    }
  });

  return output;
}

function pruneEmpty(value) {
  if (Array.isArray(value)) {
    var nextArray = value
      .map(function eachItem(entry) {
        return pruneEmpty(entry);
      })
      .filter(function filterEmpty(entry) {
        return typeof entry !== "undefined";
      });

    return nextArray.length ? nextArray : undefined;
  }

  if (!isObject(value)) {
    return value;
  }

  var output = {};

  Object.keys(value).forEach(function eachKey(key) {
    var nextValue = pruneEmpty(value[key]);

    if (typeof nextValue === "undefined") {
      return;
    }

    if (isObject(nextValue) && !Object.keys(nextValue).length) {
      return;
    }

    output[key] = nextValue;
  });

  return Object.keys(output).length ? output : undefined;
}

function mergeObjects() {
  var output = {};
  var index;
  var source;

  for (index = 0; index < arguments.length; index += 1) {
    source = arguments[index];

    if (!isObject(source)) {
      continue;
    }

    Object.keys(source).forEach(function eachKey(key) {
      output[key] = source[key];
    });
  }

  return output;
}

function hasOwnKeys(value) {
  return isObject(value) && Object.keys(value).length > 0;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeJson(value) {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(function eachItem(entry) {
      return sanitizeJson(entry);
    });
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (value instanceof Error) {
    return compactObject({
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code,
    });
  }

  if (!isObject(value)) {
    return String(value);
  }

  var output = {};

  Object.keys(value).forEach(function eachKey(key) {
    output[key] = sanitizeJson(value[key]);
  });

  return output;
}

module.exports = {
  AuraKeeperCliConnector: AuraKeeperCliConnector,
  createAuraKeeperCliConnector: createAuraKeeperCliConnector,
};

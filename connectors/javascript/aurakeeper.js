(function (globalScope, factory) {
  var exported = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }

  globalScope.AuraKeeper = exported;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function AuraKeeperConnector(options) {
    if (!options || !options.endpoint) {
      throw new Error("AuraKeeperConnector requires an endpoint.");
    }

    if (!options.apiToken) {
      throw new Error("AuraKeeperConnector requires an apiToken.");
    }

    if (!options.serviceName) {
      throw new Error("AuraKeeperConnector requires a serviceName.");
    }

    this.options = options;
    this.pendingRequests = new Set();
    this.installed = false;
    this.listeners = {};
  }

  AuraKeeperConnector.prototype.install = function install() {
    if (this.installed) {
      return this;
    }

    if (isBrowserRuntime() && this.options.captureBrowser !== false) {
      this.listeners.browserError = this.handleBrowserError.bind(this);
      this.listeners.browserRejection = this.handleBrowserRejection.bind(this);

      globalThis.addEventListener("error", this.listeners.browserError);
      globalThis.addEventListener(
        "unhandledrejection",
        this.listeners.browserRejection
      );
    }

    if (isNodeRuntime() && this.options.captureNode !== false) {
      this.listeners.nodeException = this.handleNodeException.bind(this);
      this.listeners.nodeRejection = this.handleNodeRejection.bind(this);

      process.on("uncaughtException", this.listeners.nodeException);
      process.on("unhandledRejection", this.listeners.nodeRejection);
    }

    this.installed = true;
    return this;
  };

  AuraKeeperConnector.prototype.uninstall = function uninstall() {
    if (!this.installed) {
      return this;
    }

    if (this.listeners.browserError) {
      globalThis.removeEventListener("error", this.listeners.browserError);
    }

    if (this.listeners.browserRejection) {
      globalThis.removeEventListener(
        "unhandledrejection",
        this.listeners.browserRejection
      );
    }

    if (this.listeners.nodeException) {
      removeProcessListener("uncaughtException", this.listeners.nodeException);
    }

    if (this.listeners.nodeRejection) {
      removeProcessListener("unhandledRejection", this.listeners.nodeRejection);
    }

    this.listeners = {};
    this.installed = false;
    return this;
  };

  AuraKeeperConnector.prototype.captureException = function captureException(
    error,
    overrides
  ) {
    var payload = this.buildPayload(error, overrides || {});

    if (!payload) {
      return Promise.resolve(null);
    }

    return this.track(this.send(payload));
  };

  AuraKeeperConnector.prototype.captureMessage = function captureMessage(
    message,
    overrides
  ) {
    var syntheticError = new Error(String(message));
    syntheticError.name = "Error";

    return this.captureException(syntheticError, overrides);
  };

  AuraKeeperConnector.prototype.flush = function flush() {
    return Promise.allSettled(Array.from(this.pendingRequests));
  };

  AuraKeeperConnector.prototype.handleBrowserError = function handleBrowserError(
    event
  ) {
    var error =
      event && event.error
        ? event.error
        : new Error((event && event.message) || "Unhandled browser error");
    var details = {
      filename: event && event.filename ? event.filename : undefined,
      line: event && typeof event.lineno === "number" ? event.lineno : undefined,
      column:
        event && typeof event.colno === "number" ? event.colno : undefined,
    };

    this.captureException(error, {
      handled: false,
      level: "error",
      platform: this.options.platform || "web",
      source: {
        runtime: "browser",
      },
      details: compactObject(details),
    }).catch(this.handleTransportFailure.bind(this));
  };

  AuraKeeperConnector.prototype.handleBrowserRejection =
    function handleBrowserRejection(event) {
      var normalized = normalizeUnknownError(
        event ? event.reason : undefined,
        "Unhandled promise rejection"
      );

      this.captureException(normalized.error, {
        handled: false,
        level: "error",
        platform: this.options.platform || "web",
        source: {
          runtime: "browser",
        },
        details: mergeObjects(normalized.details, {
          rejection: true,
        }),
      }).catch(this.handleTransportFailure.bind(this));
    };

  AuraKeeperConnector.prototype.handleNodeException = function handleNodeException(
    error
  ) {
    this.captureException(error, {
      handled: false,
      level: "critical",
      platform: this.options.platform || "backend",
      source: {
        runtime: "node",
      },
    }).catch(this.handleTransportFailure.bind(this));
  };

  AuraKeeperConnector.prototype.handleNodeRejection = function handleNodeRejection(
    reason
  ) {
    var normalized = normalizeUnknownError(reason, "Unhandled promise rejection");

    this.captureException(normalized.error, {
      handled: false,
      level: "error",
      platform: this.options.platform || "backend",
      source: {
        runtime: "node",
      },
      details: mergeObjects(normalized.details, {
        rejection: true,
      }),
    }).catch(this.handleTransportFailure.bind(this));
  };

  AuraKeeperConnector.prototype.handleTransportFailure =
    function handleTransportFailure(error) {
      if (typeof this.options.onTransportError === "function") {
        this.options.onTransportError(error);
        return;
      }

      if (typeof console !== "undefined" && console.error) {
        console.error("AuraKeeper failed to send error log.", error);
      }
    };

  AuraKeeperConnector.prototype.buildPayload = function buildPayload(
    error,
    overrides
  ) {
    var normalized = normalizeUnknownError(error, "Unknown error");
    var mergedDetails = mergeObjects(normalized.details, overrides.details);
    var mergedContext = this.buildContext(overrides);
    var payload = {
      eventId: overrides.eventId || generateEventId(),
      occurredAt: overrides.occurredAt || new Date().toISOString(),
      level: overrides.level || "error",
      platform: overrides.platform || this.options.platform || detectPlatform(),
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
            runtime: detectRuntime(),
            language: this.options.language || "javascript",
            framework: this.options.framework,
            component: this.options.component,
          },
          overrides.source
        )
      ),
      error: compactObject({
        type: overrides.type || normalized.error.name || "Error",
        message:
          overrides.message || normalized.error.message || "Unknown error",
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

  AuraKeeperConnector.prototype.buildContext = function buildContext(overrides) {
    var optionContext = this.options.context || {};
    var overrideContext = overrides.context || {};
    var tags = []
      .concat(this.options.tags || [])
      .concat(optionContext.tags || [])
      .concat(overrideContext.tags || [])
      .concat(overrides.tags || []);

    return pruneEmpty(
      mergeObjects(optionContext, overrideContext, {
        request: mergeObjects(
          optionContext.request,
          overrideContext.request,
          overrides.request
        ),
        user: mergeObjects(optionContext.user, overrideContext.user, overrides.user),
        session: mergeObjects(
          optionContext.session,
          overrideContext.session,
          overrides.session
        ),
        device: mergeObjects(
          optionContext.device,
          overrideContext.device,
          overrides.device
        ),
        correlationId:
          overrides.correlationId ||
          overrideContext.correlationId ||
          optionContext.correlationId,
        tags: tags.length ? uniqueStrings(tags) : undefined,
      })
    );
  };

  AuraKeeperConnector.prototype.send = function send(payload) {
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

  AuraKeeperConnector.prototype.track = function track(promise) {
    var pending = Promise.resolve(promise).finally(
      function cleanup() {
        this.pendingRequests.delete(pending);
      }.bind(this)
    );

    this.pendingRequests.add(pending);
    return pending;
  };

  function createAuraKeeperConnector(options) {
    return new AuraKeeperConnector(options);
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

  function detectPlatform() {
    if (isBrowserRuntime()) {
      return "web";
    }

    if (isNodeRuntime()) {
      return "backend";
    }

    return "worker";
  }

  function detectRuntime() {
    if (isBrowserRuntime()) {
      return "browser";
    }

    if (isNodeRuntime()) {
      return "node";
    }

    return "javascript";
  }

  function isBrowserRuntime() {
    return (
      typeof globalThis !== "undefined" &&
      typeof globalThis.addEventListener === "function" &&
      typeof globalThis.document !== "undefined"
    );
  }

  function isNodeRuntime() {
    return (
      typeof process !== "undefined" &&
      process &&
      typeof process.on === "function" &&
      process.release &&
      process.release.name === "node"
    );
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

    var nextObject = {};

    Object.keys(value).forEach(function eachKey(key) {
      var nextValue = pruneEmpty(value[key]);

      if (typeof nextValue !== "undefined") {
        nextObject[key] = nextValue;
      }
    });

    return Object.keys(nextObject).length ? nextObject : undefined;
  }

  function hasOwnKeys(value) {
    return isObject(value) && Object.keys(value).length > 0;
  }

  function mergeObjects() {
    var merged = {};

    for (var index = 0; index < arguments.length; index += 1) {
      var current = arguments[index];

      if (!isObject(current)) {
        continue;
      }

      Object.keys(current).forEach(function eachKey(key) {
        if (typeof current[key] !== "undefined") {
          merged[key] = current[key];
        }
      });
    }

    return merged;
  }

  function isObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
  }

  function sanitizeJson(value) {
    return sanitizeJsonValue(value, new Set(), 0);
  }

  function sanitizeJsonValue(value, seen, depth) {
    if (value == null) {
      return value;
    }

    if (depth >= 6) {
      return "[MaxDepth]";
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "function") {
      return "[Function]";
    }

    if (value instanceof Error) {
      return compactObject({
        name: value.name,
        message: value.message,
        stack: value.stack,
        code: readErrorCode(value),
      });
    }

    if (Array.isArray(value)) {
      return value.map(function eachArrayItem(entry) {
        return sanitizeJsonValue(entry, seen, depth + 1);
      });
    }

    if (!isObject(value)) {
      return String(value);
    }

    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    var output = {};

    Object.keys(value).forEach(function eachObjectKey(key) {
      output[key] = sanitizeJsonValue(value[key], seen, depth + 1);
    });

    seen.delete(value);
    return output;
  }

  return {
    AuraKeeperConnector: AuraKeeperConnector,
    createAuraKeeperConnector: createAuraKeeperConnector,
  };
});

(function (globalScope, factory) {
  var exported = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }

  globalScope.AuraKeeperReactNative = exported;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function factory() {
    "use strict";

    function AuraKeeperReactNativeConnector(options) {
      if (!options || !options.endpoint) {
        throw new Error("AuraKeeperReactNativeConnector requires an endpoint.");
      }

      if (!options.apiToken) {
        throw new Error("AuraKeeperReactNativeConnector requires an apiToken.");
      }

      if (!options.serviceName) {
        throw new Error(
          "AuraKeeperReactNativeConnector requires a serviceName."
        );
      }

      this.options = options;
      this.installed = false;
      this.pendingRequests = new Set();
      this.listeners = {};
      this.cachedReactNative = undefined;
    }

    AuraKeeperReactNativeConnector.prototype.install = function install() {
      if (this.installed) {
        return this;
      }

      if (this.options.captureReactNative !== false) {
        this.installGlobalErrorHandler();
      }

      this.installed = true;
      return this;
    };

    AuraKeeperReactNativeConnector.prototype.uninstall = function uninstall() {
      if (!this.installed) {
        return this;
      }

      if (
        this.listeners.globalErrorUtils &&
        this.listeners.globalErrorUtils.errorUtils &&
        typeof this.listeners.globalErrorUtils.errorUtils.setGlobalHandler ===
          "function" &&
        typeof this.listeners.globalErrorUtils.previousHandler === "function"
      ) {
        this.listeners.globalErrorUtils.errorUtils.setGlobalHandler(
          this.listeners.globalErrorUtils.previousHandler
        );
      }

      this.listeners = {};
      this.installed = false;
      return this;
    };

    AuraKeeperReactNativeConnector.prototype.installGlobalErrorHandler =
      function installGlobalErrorHandler() {
        var self = this;
        var errorUtils = getGlobalErrorUtils();

        if (
          !errorUtils ||
          typeof errorUtils.getGlobalHandler !== "function" ||
          typeof errorUtils.setGlobalHandler !== "function"
        ) {
          return;
        }

        var previousHandler = errorUtils.getGlobalHandler();

        this.listeners.globalErrorUtils = {
          errorUtils: errorUtils,
          previousHandler: previousHandler,
        };

        errorUtils.setGlobalHandler(function onGlobalError(error, isFatal) {
          self
            .captureException(error, {
              handled: false,
              level: isFatal ? "critical" : "error",
              platform: self.options.platform || "mobile",
              source: compactObject({
                runtime: "react-native",
                language: self.options.language || "javascript",
                framework: self.options.framework || "react-native",
                component: self.options.component,
              }),
              details: mergeObjects(
                {
                  fatal: !!isFatal,
                  hook: "ErrorUtils",
                  jsEngine: detectJsEngine(),
                },
                self.options.globalErrorDetails
              ),
            })
            .catch(self.handleTransportFailure.bind(self));

          if (
            self.options.callPreviousHandler !== false &&
            typeof previousHandler === "function"
          ) {
            previousHandler(error, isFatal);
          }
        });
      };

    AuraKeeperReactNativeConnector.prototype.captureException =
      function captureException(error, overrides) {
        var payload = this.buildPayload(error, overrides || {});

        if (!payload) {
          return Promise.resolve(null);
        }

        return this.track(this.send(payload));
      };

    AuraKeeperReactNativeConnector.prototype.captureMessage =
      function captureMessage(message, overrides) {
        var syntheticError = new Error(String(message));
        syntheticError.name = "Error";

        return this.captureException(syntheticError, overrides);
      };

    AuraKeeperReactNativeConnector.prototype.flush = function flush() {
      return Promise.allSettled(Array.from(this.pendingRequests));
    };

    AuraKeeperReactNativeConnector.prototype.buildPayload = function buildPayload(
      error,
      overrides
    ) {
      var normalized = normalizeUnknownError(error, "Unknown React Native error");
      var mergedDetails = mergeObjects(normalized.details, overrides.details);
      var payload = {
        eventId: overrides.eventId || generateEventId(),
        occurredAt: overrides.occurredAt || new Date().toISOString(),
        level: overrides.level || "error",
        platform: overrides.platform || this.options.platform || "mobile",
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
              framework: this.options.framework || "react-native",
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
        context: this.buildContext(overrides),
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

    AuraKeeperReactNativeConnector.prototype.buildContext = function buildContext(
      overrides
    ) {
      var optionContext = this.options.context || {};
      var overrideContext = overrides.context || {};
      var runtimeContext = this.buildRuntimeContext();
      var tags = []
        .concat(this.options.tags || [])
        .concat(optionContext.tags || [])
        .concat(overrideContext.tags || [])
        .concat(overrides.tags || []);
      var mergedContext = mergeObjects(optionContext, overrideContext, {
        request: mergeObjects(
          optionContext.request,
          overrideContext.request,
          overrides.request
        ),
        user: mergeObjects(
          optionContext.user,
          overrideContext.user,
          overrides.user
        ),
        session: mergeObjects(
          runtimeContext.session,
          optionContext.session,
          overrideContext.session,
          overrides.session
        ),
        device: mergeObjects(
          runtimeContext.device,
          optionContext.device,
          overrideContext.device,
          overrides.device
        ),
        correlationId:
          overrides.correlationId ||
          overrideContext.correlationId ||
          optionContext.correlationId,
        tags: tags.length ? uniqueStrings(tags) : undefined,
      });

      return hasOwnKeys(mergedContext) ? pruneEmpty(mergedContext) : undefined;
    };

    AuraKeeperReactNativeConnector.prototype.buildRuntimeContext =
      function buildRuntimeContext() {
        var reactNative = this.resolveReactNative();
        var platform = reactNative && reactNative.Platform;
        var dimensions = reactNative && reactNative.Dimensions;
        var appState = reactNative && reactNative.AppState;
        var nativeModules = reactNative && reactNative.NativeModules;
        var platformConstants =
          (platform && platform.constants) ||
          (nativeModules && nativeModules.PlatformConstants) ||
          {};
        var windowMetrics =
          dimensions && typeof dimensions.get === "function"
            ? safeDimensionsGet(dimensions, "window")
            : undefined;
        var screenMetrics =
          dimensions && typeof dimensions.get === "function"
            ? safeDimensionsGet(dimensions, "screen")
            : undefined;

        return pruneEmpty({
          session: compactObject({
            appState:
              appState && typeof appState.currentState === "string"
                ? appState.currentState
                : undefined,
            jsEngine: detectJsEngine(),
          }),
          device: compactObject({
            os: platform && platform.OS ? platform.OS : undefined,
            osVersion:
              platform && typeof platform.Version !== "undefined"
                ? String(platform.Version)
                : undefined,
            brand:
              readFirstString(platformConstants, ["Brand", "brand"]) ||
              undefined,
            manufacturer:
              readFirstString(platformConstants, [
                "Manufacturer",
                "manufacturer",
              ]) || undefined,
            model:
              readFirstString(platformConstants, ["Model", "model"]) ||
              undefined,
            interfaceIdiom:
              readFirstString(platformConstants, [
                "interfaceIdiom",
                "InterfaceIdiom",
              ]) || undefined,
            isPad:
              typeof platformConstants.interfaceIdiom === "string"
                ? platformConstants.interfaceIdiom === "pad"
                : undefined,
            isTV:
              typeof platformConstants.uiMode === "string"
                ? platformConstants.uiMode === "tv"
                : undefined,
            uiMode:
              readFirstString(platformConstants, ["uiMode"]) || undefined,
            window: normalizeDimensionMetrics(windowMetrics),
            screen: normalizeDimensionMetrics(screenMetrics),
          }),
        });
      };

    AuraKeeperReactNativeConnector.prototype.resolveReactNative =
      function resolveReactNative() {
        if (this.options.reactNative && isObject(this.options.reactNative)) {
          return this.options.reactNative;
        }

        if (typeof this.cachedReactNative !== "undefined") {
          return this.cachedReactNative;
        }

        try {
          this.cachedReactNative = require("react-native");
        } catch (error) {
          this.cachedReactNative = null;
        }

        return this.cachedReactNative;
      };

    AuraKeeperReactNativeConnector.prototype.send = function send(payload) {
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

    AuraKeeperReactNativeConnector.prototype.track = function track(promise) {
      var pending = Promise.resolve(promise).finally(
        function cleanup() {
          this.pendingRequests.delete(pending);
        }.bind(this)
      );

      this.pendingRequests.add(pending);
      return pending;
    };

    AuraKeeperReactNativeConnector.prototype.handleTransportFailure =
      function handleTransportFailure(error) {
        if (typeof this.options.onTransportError === "function") {
          this.options.onTransportError(error);
          return;
        }

        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("AuraKeeper failed to send error log.", error);
        }
      };

    function createAuraKeeperReactNativeConnector(options) {
      return new AuraKeeperReactNativeConnector(options);
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

    function getGlobalErrorUtils() {
      if (typeof globalThis === "undefined" || !globalThis) {
        return null;
      }

      if (globalThis.ErrorUtils && isObject(globalThis.ErrorUtils)) {
        return globalThis.ErrorUtils;
      }

      if (globalThis.global && isObject(globalThis.global.ErrorUtils)) {
        return globalThis.global.ErrorUtils;
      }

      return null;
    }

    function detectRuntime() {
      if (isReactNativeRuntime()) {
        return "react-native";
      }

      return "javascript";
    }

    function isReactNativeRuntime() {
      return (
        typeof navigator !== "undefined" &&
        navigator &&
        navigator.product === "ReactNative"
      );
    }

    function detectJsEngine() {
      if (typeof HermesInternal !== "undefined") {
        return "hermes";
      }

      if (typeof _v8runtime !== "undefined") {
        return "v8";
      }

      if (typeof globalThis !== "undefined" && globalThis.JSCExecutor) {
        return "jsc";
      }

      return undefined;
    }

    function safeDimensionsGet(dimensions, name) {
      try {
        return dimensions.get(name);
      } catch (error) {
        return undefined;
      }
    }

    function normalizeDimensionMetrics(metrics) {
      if (!isObject(metrics)) {
        return undefined;
      }

      return compactObject({
        width:
          typeof metrics.width === "number" ? roundMetric(metrics.width) : undefined,
        height:
          typeof metrics.height === "number"
            ? roundMetric(metrics.height)
            : undefined,
        scale:
          typeof metrics.scale === "number" ? roundMetric(metrics.scale) : undefined,
        fontScale:
          typeof metrics.fontScale === "number"
            ? roundMetric(metrics.fontScale)
            : undefined,
      });
    }

    function roundMetric(value) {
      return Math.round(value * 1000) / 1000;
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
      if (!error || typeof error !== "object") {
        return undefined;
      }

      if (typeof error.code === "string") {
        return error.code;
      }

      if (typeof error.errorCode === "string") {
        return error.errorCode;
      }

      return undefined;
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

    function readFirstString(source, keys) {
      if (!isObject(source)) {
        return undefined;
      }

      for (var index = 0; index < keys.length; index += 1) {
        var value = source[keys[index]];

        if (typeof value === "string" && value) {
          return value;
        }
      }

      return undefined;
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

      if (typeof value === "symbol") {
        return String(value);
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
      AuraKeeperReactNativeConnector: AuraKeeperReactNativeConnector,
      createAuraKeeperReactNativeConnector: createAuraKeeperReactNativeConnector,
    };
  }
);

"use strict";

const { createAuraKeeperConnector } = loadJavaScriptConnector();

function AuraKeeperNextJsConnector(options) {
  const normalizedOptions = normalizeOptions(options || {});

  this.options = normalizedOptions;
  this.connector = createAuraKeeperConnector(normalizedOptions);
}

AuraKeeperNextJsConnector.prototype.install = function install() {
  this.connector.install();
  return this;
};

AuraKeeperNextJsConnector.prototype.uninstall = function uninstall() {
  this.connector.uninstall();
  return this;
};

AuraKeeperNextJsConnector.prototype.flush = function flush() {
  return this.connector.flush();
};

AuraKeeperNextJsConnector.prototype.captureException =
  function captureException(error, overrides) {
    const nextOverrides = normalizeCaptureOverrides(this.options, error, overrides);
    return this.connector.captureException(error, nextOverrides);
  };

AuraKeeperNextJsConnector.prototype.captureMessage = function captureMessage(
  message,
  overrides
) {
  const syntheticError = new Error(String(message));
  syntheticError.name = "Error";

  return this.captureException(syntheticError, overrides);
};

AuraKeeperNextJsConnector.prototype.captureClientError =
  function captureClientError(error, errorInfo, overrides) {
    const normalizedOverrides = mergeObjects(overrides, {
      handled:
        overrides && typeof overrides.handled === "boolean"
          ? overrides.handled
          : true,
      source: mergeObjects(
        {
          runtime: "browser",
          component:
            overrides && overrides.component ? overrides.component : "client",
        },
        overrides && overrides.source
      ),
      details: mergeObjects(
        overrides && overrides.details,
        errorInfo && typeof errorInfo.componentStack === "string"
          ? {
              componentStack: errorInfo.componentStack,
            }
          : undefined
      ),
    });

    return this.captureException(error, normalizedOverrides);
  };

AuraKeeperNextJsConnector.prototype.wrapRouteHandler =
  function wrapRouteHandler(handler, defaults) {
    const connector = this;
    const routeDefaults = defaults || {};

    return async function wrappedAuraKeeperRouteHandler(request, routeContext) {
      try {
        return await handler.apply(this, arguments);
      } catch (error) {
        try {
          const routeComponent =
            routeDefaults.component ||
            (routeDefaults.source && routeDefaults.source.component) ||
            inferComponentFromRouteContext(routeContext) ||
            "app-router";

          await connector.captureException(
            error,
            mergeObjects(routeDefaults, {
              handled: false,
              request: request,
              route:
                routeDefaults.route || inferRouteFromRequest(request) || undefined,
              source: mergeObjects(routeDefaults.source, {
                component: routeComponent,
              }),
              details: mergeObjects(routeDefaults.details, {
                routeParams:
                  routeContext &&
                  isObject(routeContext.params) &&
                  Object.keys(routeContext.params).length
                    ? sanitizeJson(routeContext.params)
                    : undefined,
              }),
            })
          );
        } catch (captureError) {
          handleTransportFailure(connector.options, captureError);
        }

        throw error;
      }
    };
  };

function createAuraKeeperNextJsConnector(options) {
  return new AuraKeeperNextJsConnector(options);
}

function loadJavaScriptConnector() {
  try {
    return require("@aurakeeper/javascript-connector");
  } catch (packageError) {
    try {
      return require("../javascript/aurakeeper");
    } catch (workspaceError) {
      workspaceError.cause = packageError;
      throw workspaceError;
    }
  }
}

function normalizeOptions(options) {
  const buildId = firstString(options.buildId, detectBuildId());
  const tags = uniqueStrings([].concat(options.tags || [], "nextjs"));
  const normalized = mergeObjects(options, {
    framework: options.framework || "next.js",
    platform: options.platform || "web",
    serviceVersion: options.serviceVersion || buildId,
    captureNode:
      typeof options.captureNode === "boolean" ? options.captureNode : false,
    tags: tags,
  });

  normalized._auraKeeperNextJsBuildId = buildId;
  return normalized;
}

function normalizeCaptureOverrides(options, error, overrides) {
  const nextOverrides = overrides || {};
  const requestContext = normalizeRequestContext(nextOverrides.request);
  const route = firstString(
    nextOverrides.route,
    requestContext.path,
    readBrowserPathname()
  );
  const source = mergeObjects(
    {
      runtime: detectNextRuntime(),
      framework: "next.js",
    },
    nextOverrides.source
  );
  const details = mergeObjects(nextOverrides.details, {
    route: route,
    buildId: firstString(
      nextOverrides.buildId,
      options._auraKeeperNextJsBuildId,
      detectBuildId()
    ),
    digest: readErrorDigest(error, nextOverrides),
  });

  return mergeObjects(nextOverrides, {
    request: mergeObjects(requestContext, nextOverrides.requestContext),
    source: source,
    details: details,
  });
}

function normalizeRequestContext(request) {
  if (!request) {
    return readBrowserRequestContext();
  }

  const method =
    typeof request.method === "string" && request.method ? request.method : undefined;
  const urlString =
    typeof request.url === "string" && request.url ? request.url : undefined;
  const parsedUrl = parseUrl(urlString);
  const headers = request.headers;

  if (
    !method &&
    !urlString &&
    !parsedUrl &&
    !headers &&
    isObject(request) &&
    !Array.isArray(request)
  ) {
    return compactObject(request);
  }

  return compactObject({
    method: method,
    path:
      firstString(
        request.path,
        request.pathname,
        parsedUrl && parsedUrl.pathname
      ) || undefined,
    url: urlString,
    requestId: readHeader(headers, [
      "x-request-id",
      "x-vercel-id",
      "x-correlation-id",
    ]),
    host: firstString(
      request.host,
      readHeader(headers, ["x-forwarded-host", "host", ":authority"]),
      parsedUrl && parsedUrl.host
    ),
  });
}

function readBrowserRequestContext() {
  if (typeof globalThis === "undefined" || !globalThis.location) {
    return undefined;
  }

  return compactObject({
    method: "GET",
    path: globalThis.location.pathname,
    url: globalThis.location.href,
    host: globalThis.location.host,
  });
}

function inferRouteFromRequest(request) {
  const requestContext = normalizeRequestContext(request);
  return requestContext && requestContext.path ? requestContext.path : undefined;
}

function inferComponentFromRouteContext(routeContext) {
  if (
    routeContext &&
    isObject(routeContext.params) &&
    Object.keys(routeContext.params).length
  ) {
    return "app-router-dynamic-route";
  }

  return undefined;
}

function detectBuildId() {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.__NEXT_DATA__ &&
    typeof globalThis.__NEXT_DATA__.buildId === "string" &&
    globalThis.__NEXT_DATA__.buildId
  ) {
    return globalThis.__NEXT_DATA__.buildId;
  }

  if (
    typeof process !== "undefined" &&
    process &&
    process.env &&
    typeof process.env.NEXT_BUILD_ID === "string" &&
    process.env.NEXT_BUILD_ID
  ) {
    return process.env.NEXT_BUILD_ID;
  }

  return undefined;
}

function detectNextRuntime() {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.document !== "undefined"
  ) {
    return "browser";
  }

  if (
    typeof process !== "undefined" &&
    process &&
    process.env &&
    process.env.NEXT_RUNTIME === "edge"
  ) {
    return "edge";
  }

  if (
    typeof process !== "undefined" &&
    process &&
    process.release &&
    process.release.name === "node"
  ) {
    return "node";
  }

  return "javascript";
}

function readErrorDigest(error, overrides) {
  if (overrides && typeof overrides.digest === "string" && overrides.digest) {
    return overrides.digest;
  }

  if (error && typeof error.digest === "string" && error.digest) {
    return error.digest;
  }

  return undefined;
}

function readBrowserPathname() {
  if (typeof globalThis === "undefined" || !globalThis.location) {
    return undefined;
  }

  return globalThis.location.pathname;
}

function readHeader(headers, names) {
  if (!headers || !Array.isArray(names)) {
    return undefined;
  }

  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    let value;

    if (typeof headers.get === "function") {
      value = headers.get(name);
    } else if (isObject(headers)) {
      value = headers[name];

      if (typeof value === "undefined") {
        value = headers[name.toLowerCase()];
      }
    }

    if (Array.isArray(value)) {
      value = value[0];
    }

    if (typeof value === "string" && value) {
      return value;
    }
  }

  return undefined;
}

function handleTransportFailure(options, error) {
  if (options && typeof options.onTransportError === "function") {
    options.onTransportError(error);
    return;
  }

  if (typeof console !== "undefined" && console.error) {
    console.error("AuraKeeper failed to send error log.", error);
  }
}

function parseUrl(value) {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  try {
    return new URL(value, "http://localhost");
  } catch (error) {
    return undefined;
  }
}

function firstString() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];

    if (typeof value === "string" && value) {
      return value;
    }
  }

  return undefined;
}

function uniqueStrings(values) {
  const output = [];
  const seen = new Set();

  values.forEach(function each(value) {
    if (typeof value !== "string" || !value || seen.has(value)) {
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

  const output = {};

  Object.keys(value).forEach(function eachKey(key) {
    if (typeof value[key] !== "undefined") {
      output[key] = value[key];
    }
  });

  return Object.keys(output).length ? output : undefined;
}

function mergeObjects() {
  const merged = {};

  for (let index = 0; index < arguments.length; index += 1) {
    const current = arguments[index];

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
  if (value == null) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeJson);
  }

  if (!isObject(value)) {
    return String(value);
  }

  const output = {};

  Object.keys(value).forEach(function eachKey(key) {
    output[key] = sanitizeJson(value[key]);
  });

  return output;
}

module.exports = {
  AuraKeeperNextJsConnector: AuraKeeperNextJsConnector,
  createAuraKeeperNextJsConnector: createAuraKeeperNextJsConnector,
};

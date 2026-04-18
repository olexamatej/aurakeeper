(function initBrowserExample() {
  var statusNode = document.getElementById("status");
  var handledButton = document.getElementById("capture-handled");
  var rejectionButton = document.getElementById("trigger-rejection");
  var endpoint =
    window.AURAKEEPER_ENDPOINT || "http://127.0.0.1:3000/v1/logs/errors";
  var apiToken = window.AURAKEEPER_API_TOKEN || "";
  var isConfigured = apiToken.length > 0;

  function updateStatus(message) {
    statusNode.textContent = message;
  }

  function setButtonsDisabled(disabled) {
    handledButton.disabled = disabled;
    rejectionButton.disabled = disabled;
  }

  if (!isConfigured) {
    setButtonsDisabled(true);
    updateStatus(
      "Set window.AURAKEEPER_API_TOKEN before using this example."
    );
    return;
  }

  var connector = AuraKeeper.createAuraKeeperConnector({
    endpoint: endpoint,
    apiToken: apiToken,
    serviceName: "generic-browser-app",
    serviceVersion: "2026.04.18",
    environment: "development",
    framework: "vanilla-js",
    component: "example-page",
    tags: ["frontend", "browser-example"],
    context: {
      session: {
        source: "examples/browser",
      },
    },
  });

  connector.install();
  window.browserAuraKeeper = connector;

  document
    .getElementById("capture-handled")
    .addEventListener("click", function onHandledClick() {
      try {
        throw new Error("Handled browser example error");
      } catch (error) {
        connector
          .captureException(error, {
            handled: true,
            request: {
              method: "GET",
              path: window.location.pathname,
            },
            user: {
              id: "demo-user-42",
              email: "demo@example.com",
            },
            session: {
              activeView: "examples-browser",
            },
            details: {
              action: "capture-handled",
            },
          })
          .then(function onCaptured() {
            updateStatus(
              "Handled browser error captured at " +
                new Date().toISOString()
            );
          })
          .catch(function onCaptureError(captureError) {
            updateStatus(
              "Capture failed: " + (captureError && captureError.message)
            );
          });
      }
    });

  document
    .getElementById("trigger-rejection")
    .addEventListener("click", function onRejectionClick() {
      updateStatus("Triggering unhandled rejection...");
      Promise.reject(new Error("Unhandled browser example rejection"));
    });

  setButtonsDisabled(false);
  updateStatus(
    "Browser connector installed and ready to send to AuraKeeper."
  );
})();

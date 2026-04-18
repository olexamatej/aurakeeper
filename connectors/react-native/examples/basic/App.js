import React, { useEffect, useState } from "react";
import {
  AppState,
  Button,
  Dimensions,
  NativeModules,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

const {
  createAuraKeeperReactNativeConnector,
} = require("../../aurakeeper");

const endpoint = "https://api.example.com/v1/logs/errors";
const apiToken = "replace-with-real-api-token";
const isConfigured =
  endpoint !== "https://api.example.com/v1/logs/errors" &&
  apiToken !== "replace-with-real-api-token";

const connector = createAuraKeeperReactNativeConnector({
  endpoint,
  apiToken,
  serviceName: "generic-react-native-app",
  serviceVersion: "1.0.0",
  environment: "development",
  component: "example-screen",
  tags: ["mobile", "react-native-example"],
  reactNative: {
    AppState,
    Dimensions,
    NativeModules,
    Platform,
  },
  context: {
    session: {
      source: "examples/basic",
    },
  },
});

export default function App() {
  const [status, setStatus] = useState(
    isConfigured
      ? "Connector ready. Use the buttons below to send sample events."
      : "Replace the placeholder endpoint and API token in App.js before using this example."
  );

  useEffect(function installConnector() {
    if (!isConfigured) {
      return undefined;
    }

    connector.install();

    return function cleanupConnector() {
      connector.uninstall();
      connector.flush();
    };
  }, []);

  async function captureHandledError() {
    try {
      throw new Error("Handled React Native example error");
    } catch (error) {
      try {
        await connector.captureException(error, {
          handled: true,
          level: "error",
          request: {
            method: "TAP",
            path: "example-screen/capture-handled",
          },
          user: {
            id: "demo-user-42",
          },
          session: {
            activeScreen: "ExampleScreen",
          },
          details: {
            action: "capture-handled",
          },
        });

        setStatus("Handled error captured at " + new Date().toISOString());
      } catch (captureError) {
        setStatus(
          "Capture failed: " +
            (captureError && captureError.message
              ? captureError.message
              : "unknown error")
        );
      }
    }
  }

  async function captureMessage() {
    try {
      await connector.captureMessage("Manual message capture from React Native", {
        handled: true,
        level: "warning",
        request: {
          method: "TAP",
          path: "example-screen/capture-message",
        },
        details: {
          action: "capture-message",
        },
      });

      setStatus("Message captured at " + new Date().toISOString());
    } catch (captureError) {
      setStatus(
        "Capture failed: " +
          (captureError && captureError.message
            ? captureError.message
            : "unknown error")
      );
    }
  }

  function triggerUnhandledError() {
    setStatus("Triggering unhandled JavaScript exception...");

    setTimeout(function onTimeout() {
      throw new Error("Unhandled React Native example error");
    }, 0);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>AuraKeeper React Native Example</Text>
        <Text style={styles.description}>
          This screen demonstrates manual capture and global JavaScript error
          capture for the React Native connector.
        </Text>
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={styles.statusValue}>{status}</Text>
        </View>
        <View style={styles.actions}>
          <Button
            disabled={!isConfigured}
            title="Capture handled error"
            onPress={captureHandledError}
          />
          <View style={styles.spacer} />
          <Button
            disabled={!isConfigured}
            title="Capture message"
            onPress={captureMessage}
          />
          <View style={styles.spacer} />
          <Button
            disabled={!isConfigured}
            title="Trigger unhandled error"
            onPress={triggerUnhandledError}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4f7fb",
  },
  container: {
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#14213d",
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    lineHeight: 22,
    color: "#33415c",
    marginBottom: 20,
  },
  statusCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    shadowColor: "#14213d",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: {
      width: 0,
      height: 6,
    },
    elevation: 2,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#526277",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  statusValue: {
    fontSize: 15,
    lineHeight: 22,
    color: "#14213d",
  },
  actions: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
  },
  spacer: {
    height: 12,
  },
});

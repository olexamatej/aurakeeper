import React, { useEffect, useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, View } from "react-native";

const {
  createAuraKeeperReactNativeConnector,
} = require("../../aurakeeper");

const endpoint = process.env.EXPO_PUBLIC_AURAKEEPER_ENDPOINT;
const apiToken = process.env.EXPO_PUBLIC_AURAKEEPER_API_TOKEN;
const isConfigured = Boolean(endpoint && apiToken);

const connector = isConfigured
  ? createAuraKeeperReactNativeConnector({
      endpoint,
      apiToken,
      serviceName: "react-native-basic-example",
      serviceVersion: "0.1.0",
      environment: process.env.EXPO_PUBLIC_APP_ENV || "development",
      component: "basic-example",
      tags: ["expo", "react-native"],
    })
  : null;

export default function App() {
  const [status, setStatus] = useState(
    isConfigured
      ? "Configured from Expo env. Use the button below to throw an unhandled error."
      : "Set EXPO_PUBLIC_AURAKEEPER_ENDPOINT and EXPO_PUBLIC_AURAKEEPER_API_TOKEN before running."
  );

  useEffect(function installConnector() {
    if (!connector) {
      return undefined;
    }

    connector.install();

    return function cleanupConnector() {
      connector.uninstall();
      connector.flush();
    };
  }, []);

  function triggerUnhandledError() {
    setStatus("Triggering unhandled JavaScript exception...");

    setTimeout(function onTimeout() {
      throw new Error("Unhandled Expo example error");
    }, 0);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>AuraKeeper React Native Example</Text>
        <Text style={styles.description}>
          This app reads its endpoint and token from Expo env vars and uses a
          single button to throw an unhandled JavaScript error.
        </Text>
        <Text style={styles.status}>{status}</Text>
        <Button
          disabled={!isConfigured}
          title="Trigger unhandled error"
          onPress={triggerUnhandledError}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
    justifyContent: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111827",
  },
  description: {
    fontSize: 16,
    lineHeight: 22,
    color: "#374151",
  },
  status: {
    fontSize: 14,
    lineHeight: 20,
    color: "#111827",
  },
});

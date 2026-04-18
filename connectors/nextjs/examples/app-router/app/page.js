"use client";

export default function Page() {
  function triggerRouteError() {
    window.location.assign("/api/demo?fail=1");
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>AuraKeeper Next.js App Router Example</h1>
      <p style={styles.text}>
        Set <code>AURAKEEPER_ENDPOINT</code> and{" "}
        <code>AURAKEEPER_API_TOKEN</code>, then use the button below to hit the
        demo route.
      </p>
      <button type="button" onClick={triggerRouteError} style={styles.button}>
        Trigger route error
      </button>
    </main>
  );
}

const styles = {
  main: {
    fontFamily: "system-ui, sans-serif",
    padding: "24px",
  },
  title: {
    fontSize: "28px",
    margin: "0 0 12px",
  },
  text: {
    fontSize: "16px",
    lineHeight: 1.5,
    margin: "0 0 16px",
    maxWidth: "48rem",
  },
  button: {
    border: "1px solid #111827",
    borderRadius: "6px",
    background: "#111827",
    color: "#ffffff",
    padding: "10px 14px",
    cursor: "pointer",
  },
};

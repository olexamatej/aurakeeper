package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	aurakeeper "github.com/aurakeeper/aurakeeper/connectors/go"
)

func main() {
	endpoint := envOrDefault("AURAKEEPER_ENDPOINT", "http://127.0.0.1:3000/v1/logs/errors")
	apiToken := os.Getenv("AURAKEEPER_API_TOKEN")
	if apiToken == "" {
		log.Fatal("set AURAKEEPER_API_TOKEN before running this example")
	}
	appPort := envOrDefault("AURAKEEPER_APP_PORT", "8080")
	panicPath := normalizePath(envOrDefault("AURAKEEPER_PANIC_PATH", "/panic"))

	connector, err := aurakeeper.New(aurakeeper.Options{
		Endpoint:       endpoint,
		APIToken:       apiToken,
		ServiceName:    "go-runtime-example",
		ServiceVersion: "1.0.0",
		Environment:    "development",
		Framework:      "net/http",
		Component:      "example-server",
		Tags:           []string{"backend", "go-example"},
		Context: map[string]any{
			"session": map[string]any{
				"source": "examples/http",
			},
		},
		OnTransportError: func(err error) {
			log.Printf("capture failed: %v", err)
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(writer, "Visit %s to trigger a runtime panic\n", panicPath)
	})
	mux.HandleFunc(panicPath, func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(writer, renderProfile(profileUser{ID: "guest"}))
	})

	log.Printf("Listening on http://127.0.0.1:%s%s", appPort, panicPath)
	log.Fatal(http.ListenAndServe(":"+appPort, connector.Middleware(mux)))
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func normalizePath(value string) string {
	if value == "" {
		return "/panic"
	}
	if !strings.HasPrefix(value, "/") {
		return "/" + value
	}
	return value
}

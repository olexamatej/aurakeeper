package main

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"

	aurakeeper "github.com/aurakeeper/aurakeeper/connectors/go"
)

func main() {
	endpoint := os.Getenv("AURAKEEPER_ENDPOINT")
	apiToken := os.Getenv("AURAKEEPER_API_TOKEN")
	if endpoint == "" || apiToken == "" {
		log.Fatal("set AURAKEEPER_ENDPOINT and AURAKEEPER_API_TOKEN before running this example")
	}

	connector, err := aurakeeper.New(aurakeeper.Options{
		Endpoint:       endpoint,
		APIToken:       apiToken,
		ServiceName:    "go-http-example",
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
		fmt.Fprintln(writer, "Visit /handled or /panic")
	})
	mux.HandleFunc("/handled", func(writer http.ResponseWriter, request *http.Request) {
		_, err := connector.CaptureHTTPError(request.Context(), errors.New("handled example error"), request, aurakeeper.CaptureOptions{
			Level:   "error",
			Handled: aurakeeper.Bool(true),
			Details: map[string]any{
				"route": "/handled",
			},
			User: map[string]any{
				"id": "example-user",
			},
		})
		if err != nil {
			http.Error(writer, err.Error(), http.StatusBadGateway)
			return
		}
		fmt.Fprintln(writer, "Handled error sent to AuraKeeper.")
	})
	mux.HandleFunc("/panic", func(http.ResponseWriter, *http.Request) {
		panic("panic example")
	})

	log.Println("Listening on http://127.0.0.1:8080")
	log.Fatal(http.ListenAndServe(":8080", connector.Middleware(mux)))
}

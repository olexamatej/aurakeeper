require "aurakeeper"

connector = AuraKeeper.create_aurakeeper_connector(
  endpoint: ENV.fetch("AURAKEEPER_ENDPOINT", "https://api.example.com/v1/logs/errors"),
  api_token: ENV.fetch("AURAKEEPER_API_TOKEN", "replace-me"),
  service_name: "ruby-standalone",
  service_version: "0.1.0",
  environment: ENV.fetch("RACK_ENV", "development"),
  framework: "stdlib",
  component: "example",
  tags: ["backend", "ruby"],
  context: {
    device: {
      hostname: ENV["HOSTNAME"]
    }
  }
)

connector.install

begin
  raise ArgumentError, "Handled example failure"
rescue => error
  response = connector.capture_exception(
    error,
    handled: true,
    level: "error",
    correlation_id: "example-job-123",
    request: {
      method: "RUN",
      path: "/examples/standalone"
    },
    details: {
      example: true
    }
  )

  p(response)
end

connector.close

require "aurakeeper"

api_token = ENV["AURAKEEPER_API_TOKEN"]

unless api_token
  warn "Set AURAKEEPER_API_TOKEN before running this example."
  exit 1
end

connector = AuraKeeper.create_aurakeeper_connector(
  endpoint: ENV.fetch("AURAKEEPER_ENDPOINT", "http://127.0.0.1:3000/v1/logs/errors"),
  api_token: api_token,
  service_name: "ruby-standalone",
  service_version: "0.1.0",
  environment: ENV.fetch("RACK_ENV", "development"),
  framework: "stdlib",
  component: "uncaught-example",
  tags: ["backend", "ruby"],
  context: {
    device: {
      hostname: ENV["HOSTNAME"]
    }
  }
)

connector.install

raise ArgumentError, "Uncaught Ruby example failure"

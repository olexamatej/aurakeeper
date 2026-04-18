Gem::Specification.new do |spec|
  spec.name = "aurakeeper"
  spec.version = "0.1.0"
  spec.authors = ["OpenAI Codex"]
  spec.summary = "AuraKeeper Ruby connector"
  spec.description = "Stdlib-only Ruby connector for AuraKeeper error ingestion"
  spec.homepage = "https://example.com/aurakeeper"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.0"

  spec.files = Dir[
    "README.md",
    "lib/aurakeeper.rb",
    "examples/standalone/main.rb"
  ]
  spec.require_paths = ["lib"]
end

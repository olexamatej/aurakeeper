require "date"
require "json"
require "net/http"
require "securerandom"
require "time"
require "uri"

module AuraKeeper
  VERSION = "0.1.0"

  def self.create_aurakeeper_connector(**kwargs)
    Connector.new(**kwargs)
  end

  class Connector
    MAX_SANITIZE_DEPTH = 6

    def initialize(
      endpoint:,
      api_token:,
      service_name:,
      service_version: nil,
      environment: nil,
      platform_name: nil,
      framework: nil,
      component: nil,
      instance_id: nil,
      tags: nil,
      context: nil,
      headers: nil,
      timeout: 5.0,
      transport: nil,
      before_send: nil,
      on_transport_error: nil,
      capture_uncaught: true
    )
      raise ArgumentError, "AuraKeeper::Connector requires an endpoint." if blank?(endpoint)
      raise ArgumentError, "AuraKeeper::Connector requires an api_token." if blank?(api_token)
      raise ArgumentError, "AuraKeeper::Connector requires a service_name." if blank?(service_name)

      @endpoint = endpoint
      @api_token = api_token
      @service_name = service_name
      @service_version = service_version
      @environment = environment
      @platform_name = platform_name
      @framework = framework
      @component = component
      @instance_id = instance_id
      @tags = Array(tags).compact
      @context = context.is_a?(Hash) ? context.dup : {}
      @headers = headers.is_a?(Hash) ? headers.dup : {}
      @timeout = timeout
      @transport = transport || method(:default_transport)
      @before_send = before_send
      @on_transport_error = on_transport_error
      @capture_uncaught = capture_uncaught
      @installed = false
      @uncaught_hook_registered = false
    end

    def install
      register_uncaught_hook if @capture_uncaught
      @installed = true
      self
    end

    def uninstall
      @installed = false
      self
    end

    def close
      uninstall
    end

    def flush
      []
    end

    def capture_exception(error, overrides = nil, **kwargs)
      payload = build_payload(error, overrides, **kwargs)
      return nil if payload.nil?

      deliver(payload)
    end

    def capture_message(message, overrides = nil, **kwargs)
      capture_exception(RuntimeError.new(String(message)), overrides, **kwargs)
    end

    def build_payload(error, overrides = nil, **kwargs)
      override_values = merge_hashes(overrides, kwargs)
      normalized = normalize_unknown_error(error, "Unknown error")
      merged_details = sanitize_json(
        merge_hashes(
          normalized[:details],
          get_alias(override_values, :details)
        )
      )
      merged_context = sanitize_json(build_context(override_values))

      payload = {
        "eventId" => coalesce(
          get_alias(override_values, :event_id, :eventId),
          SecureRandom.uuid
        ),
        "occurredAt" => coalesce(
          get_alias(override_values, :occurred_at, :occurredAt),
          Time.now.utc.iso8601
        ),
        "level" => coalesce(get_alias(override_values, :level), "error"),
        "platform" => coalesce(
          get_alias(override_values, :platform),
          @platform_name,
          "backend"
        ),
        "environment" => coalesce(get_alias(override_values, :environment), @environment),
        "service" => compact_object(
          sanitize_json(
            merge_hashes(
              {
                "name" => @service_name,
                "version" => @service_version,
                "instanceId" => @instance_id
              },
              get_alias(override_values, :service)
            )
          )
        ),
        "source" => compact_object(
          sanitize_json(
            merge_hashes(
              {
                "runtime" => detect_runtime,
                "language" => "ruby",
                "framework" => @framework,
                "component" => @component
              },
              get_alias(override_values, :source)
            )
          )
        ),
        "error" => compact_object(
          {
            "type" => coalesce(get_alias(override_values, :type), normalized[:error_type], "Exception"),
            "message" => coalesce(get_alias(override_values, :message), normalized[:message], "Unknown error"),
            "code" => coalesce(get_alias(override_values, :code), read_error_code(error)),
            "stack" => coalesce(get_alias(override_values, :stack), normalized[:stack]),
            "handled" => coalesce(get_alias(override_values, :handled), true),
            "details" => has_keys?(merged_details) ? merged_details : nil
          }
        ),
        "context" => has_keys?(merged_context) ? merged_context : nil
      }

      if @before_send
        next_payload = @before_send.call(payload)
        return nil if next_payload.nil? || next_payload == false

        payload = next_payload
      end

      prune_empty(compact_object(payload))
    end

    private

    def build_context(overrides)
      override_values = overrides || {}
      option_context = @context
      override_context = get_alias(override_values, :context) || {}
      tags = unique_strings(
        @tags +
        Array(get_alias(option_context, :tags)) +
        Array(get_alias(override_context, :tags)) +
        Array(get_alias(override_values, :tags))
      )

      prune_empty(
        merge_hashes(
          option_context,
          override_context,
          {
            request: merge_hashes(
              get_alias(option_context, :request),
              get_alias(override_context, :request),
              get_alias(override_values, :request)
            ),
            user: merge_hashes(
              get_alias(option_context, :user),
              get_alias(override_context, :user),
              get_alias(override_values, :user)
            ),
            session: merge_hashes(
              get_alias(option_context, :session),
              get_alias(override_context, :session),
              get_alias(override_values, :session)
            ),
            device: merge_hashes(
              get_alias(option_context, :device),
              get_alias(override_context, :device),
              get_alias(override_values, :device)
            ),
            correlationId: coalesce(
              get_alias(override_values, :correlation_id, :correlationId),
              get_alias(override_context, :correlation_id, :correlationId),
              get_alias(option_context, :correlation_id, :correlationId)
            ),
            tags: tags.empty? ? nil : tags
          }
        )
      )
    end

    def deliver(payload)
      @transport.call(
        {
          endpoint: @endpoint,
          api_token: @api_token,
          apiToken: @api_token,
          payload: payload,
          headers: @headers.dup,
          timeout: @timeout
        }
      )
    end

    def register_uncaught_hook
      return if @uncaught_hook_registered

      @uncaught_hook_registered = true
      at_exit do
        next unless @installed && @capture_uncaught

        error = $ERROR_INFO
        next if error.nil? || error.is_a?(SystemExit) || error.is_a?(SignalException)

        send_automatic_exception(
          error,
          handled: false,
          level: "critical",
          platform: @platform_name || "backend",
          source: { runtime: detect_runtime }
        )
      end
    end

    def send_automatic_exception(error, **kwargs)
      payload = build_payload(error, nil, **kwargs)
      return if payload.nil?

      deliver(payload)
    rescue StandardError => transport_error
      if @on_transport_error
        @on_transport_error.call(transport_error)
      else
        warn("AuraKeeper failed to send error log. #{transport_error}")
      end
    end

    def default_transport(config)
      uri = URI.parse(config[:endpoint])
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = config[:timeout]
      http.read_timeout = config[:timeout]

      request = Net::HTTP::Post.new(
        uri.request_uri.empty? ? "/" : uri.request_uri,
        {
          "Content-Type" => "application/json",
          "X-API-Token" => config[:api_token]
        }.merge(config[:headers] || {})
      )
      request.body = JSON.generate(config[:payload])

      response = http.request(request)
      status = response.code.to_i
      raw_body = response.body.to_s

      raise RuntimeError, "AuraKeeper request failed with status #{status}: #{raw_body}" unless status.between?(200, 299)
      return { "status" => status } if raw_body.empty?

      content_type = response["content-type"].to_s
      return JSON.parse(raw_body) if content_type.include?("application/json")

      { "status" => status, "body" => raw_body }
    rescue SocketError, SystemCallError, Timeout::Error, JSON::ParserError => e
      raise RuntimeError, "AuraKeeper request failed: #{e.message}"
    end

    def normalize_unknown_error(value, fallback_message)
      if value.is_a?(Exception)
        return {
          error_type: value.class.name || "Exception",
          message: value.message.to_s.empty? ? fallback_message : value.message.to_s,
          stack: (value.backtrace || []).join("\n"),
          details: nil
        }
      end

      if value.is_a?(Hash) && !get_alias(value, :message).to_s.empty?
        return {
          error_type: get_alias(value, :name) || "Error",
          message: get_alias(value, :message),
          stack: get_alias(value, :stack),
          details: sanitize_json(value)
        }
      end

      if value.is_a?(String) && !value.empty?
        return {
          error_type: "Error",
          message: value,
          stack: nil,
          details: nil
        }
      end

      {
        error_type: "Error",
        message: fallback_message,
        stack: nil,
        details: value.nil? ? nil : { originalValue: sanitize_json(value) }
      }
    end

    def read_error_code(error)
      if error.respond_to?(:code)
        code = error.code
        return code.to_s unless code.nil? || code.to_s.empty?
      end

      if error.is_a?(Hash)
        code = get_alias(error, :code)
        return code.to_s unless code.nil? || code.to_s.empty?
      end

      nil
    end

    def detect_runtime
      (defined?(RUBY_ENGINE) ? RUBY_ENGINE : "ruby").to_s.downcase
    end

    def get_alias(hash, *keys)
      return nil unless hash.is_a?(Hash)

      keys.each do |key|
        return hash[key] if hash.key?(key)

        string_key = key.to_s
        return hash[string_key] if hash.key?(string_key)

        symbol_key = string_key.to_sym
        return hash[symbol_key] if hash.key?(symbol_key)
      end

      nil
    end

    def merge_hashes(*hashes)
      hashes.each_with_object({}) do |hash, merged|
        next unless hash.is_a?(Hash)

        hash.each do |key, value|
          merged[key] = value
        end
      end
    end

    def compact_object(hash)
      hash.each_with_object({}) do |(key, value), compacted|
        compacted[key] = value unless value.nil?
      end
    end

    def prune_empty(value)
      case value
      when Hash
        value.each_with_object({}) do |(key, child), pruned|
          next if child.nil?

          next_child = prune_empty(child)
          next if next_child.respond_to?(:empty?) && next_child.empty?

          pruned[key] = next_child
        end
      when Array
        value.filter_map do |child|
          next if child.nil?

          next_child = prune_empty(child)
          next if next_child.respond_to?(:empty?) && next_child.empty?

          next_child
        end
      else
        value
      end
    end

    def sanitize_json(value, depth = 0)
      return "[Truncated]" if depth >= MAX_SANITIZE_DEPTH

      case value
      when nil, String, Integer, Float, TrueClass, FalseClass
        value
      when Symbol
        value.to_s
      when Time, DateTime, Date
        value.iso8601
      when Array
        value.map { |item| sanitize_json(item, depth + 1) }
      when Hash
        value.each_with_object({}) do |(key, child), result|
          result[key.to_s] = sanitize_json(child, depth + 1)
        end
      when Exception
        {
          "class" => value.class.name,
          "message" => value.message,
          "backtrace" => sanitize_json(value.backtrace, depth + 1)
        }
      else
        value.respond_to?(:to_h) ? sanitize_json(value.to_h, depth + 1) : value.to_s
      end
    end

    def has_keys?(value)
      value.is_a?(Hash) && !value.empty?
    end

    def unique_strings(values)
      values.each_with_object([]) do |value, result|
        next if value.nil?

        string_value = value.to_s
        next if string_value.empty? || result.include?(string_value)

        result << string_value
      end
    end

    def coalesce(*values)
      values.find { |value| !value.nil? }
    end

    def blank?(value)
      value.nil? || value.to_s.empty?
    end
  end
end

package aurakeeper

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"runtime/debug"
	"strings"
	"time"
)

const maxSanitizeDepth = 6

type Options struct {
	Endpoint         string
	APIToken         string
	ServiceName      string
	ServiceVersion   string
	Environment      string
	Platform         string
	Framework        string
	Component        string
	InstanceID       string
	Tags             []string
	Context          map[string]any
	Headers          map[string]string
	HTTPClient       *http.Client
	Timeout          time.Duration
	OnTransportError func(error)
}

type CaptureOptions struct {
	EventID       string
	OccurredAt    time.Time
	Level         string
	Platform      string
	Type          string
	Message       string
	Code          string
	Stack         string
	Handled       *bool
	Details       map[string]any
	Context       map[string]any
	Request       map[string]any
	User          map[string]any
	Session       map[string]any
	Device        map[string]any
	CorrelationID string
	Tags          []string
}

type Connector struct {
	options Options
	client  *http.Client
}

type ErrorLogRequest struct {
	EventID     string            `json:"eventId,omitempty"`
	OccurredAt  string            `json:"occurredAt"`
	Level       string            `json:"level"`
	Platform    string            `json:"platform"`
	Environment string            `json:"environment,omitempty"`
	Service     ServiceDescriptor `json:"service"`
	Source      ErrorSource       `json:"source"`
	Error       ErrorPayload      `json:"error"`
	Context     map[string]any    `json:"context,omitempty"`
}

type ServiceDescriptor struct {
	Name       string `json:"name"`
	Version    string `json:"version,omitempty"`
	InstanceID string `json:"instanceId,omitempty"`
}

type ErrorSource struct {
	Runtime   string `json:"runtime"`
	Language  string `json:"language"`
	Framework string `json:"framework,omitempty"`
	Component string `json:"component,omitempty"`
}

type ErrorPayload struct {
	Type    string         `json:"type,omitempty"`
	Message string         `json:"message"`
	Code    string         `json:"code,omitempty"`
	Stack   string         `json:"stack,omitempty"`
	Handled *bool          `json:"handled,omitempty"`
	Details map[string]any `json:"details,omitempty"`
}

type ErrorLogAccepted struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	ReceivedAt string `json:"receivedAt"`
}

func New(options Options) (*Connector, error) {
	if options.Endpoint == "" {
		return nil, errors.New("aurakeeper: endpoint is required")
	}
	if options.APIToken == "" {
		return nil, errors.New("aurakeeper: api token is required")
	}
	if options.ServiceName == "" {
		return nil, errors.New("aurakeeper: service name is required")
	}

	client := options.HTTPClient
	if client == nil {
		timeout := options.Timeout
		if timeout <= 0 {
			timeout = 5 * time.Second
		}
		client = &http.Client{Timeout: timeout}
	}

	options.Tags = append([]string(nil), options.Tags...)
	options.Context = cloneMap(options.Context)
	options.Headers = cloneStringMap(options.Headers)

	return &Connector{
		options: options,
		client:  client,
	}, nil
}

func Bool(value bool) *bool {
	return &value
}

func (c *Connector) CaptureError(ctx context.Context, err error, options CaptureOptions) (*ErrorLogAccepted, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	payload := c.BuildPayload(err, options)
	return c.send(ctx, payload)
}

func (c *Connector) CaptureMessage(ctx context.Context, message string, options CaptureOptions) (*ErrorLogAccepted, error) {
	options.Message = message
	if options.Type == "" {
		options.Type = "Error"
	}
	return c.CaptureError(ctx, nil, options)
}

func (c *Connector) CaptureHTTPError(ctx context.Context, err error, request *http.Request, options CaptureOptions) (*ErrorLogAccepted, error) {
	options.Request = mergeMaps(RequestContext(request), options.Request)
	if options.CorrelationID == "" {
		options.CorrelationID = correlationIDFromRequest(request)
	}
	return c.CaptureError(ctx, err, options)
}

func (c *Connector) BuildPayload(err error, options CaptureOptions) ErrorLogRequest {
	handled := true
	if options.Handled != nil {
		handled = *options.Handled
	}

	occurredAt := options.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = time.Now().UTC()
	}

	errorType := firstNonEmpty(options.Type, typeName(err), "Error")
	message := firstNonEmpty(options.Message, errorMessage(err), "Unknown error")
	stack := firstNonEmpty(options.Stack, stackTrace(err))
	code := firstNonEmpty(options.Code, errorCode(err))
	details := sanitizeMap(mergeMaps(errorDetails(err), options.Details))
	contextValues := c.buildContext(options)

	payload := ErrorLogRequest{
		EventID:     firstNonEmpty(options.EventID, newEventID()),
		OccurredAt:  occurredAt.UTC().Format(time.RFC3339),
		Level:       firstNonEmpty(options.Level, "error"),
		Platform:    firstNonEmpty(options.Platform, c.options.Platform, "backend"),
		Environment: c.options.Environment,
		Service: ServiceDescriptor{
			Name:       c.options.ServiceName,
			Version:    c.options.ServiceVersion,
			InstanceID: c.options.InstanceID,
		},
		Source: ErrorSource{
			Runtime:   "go",
			Language:  "go",
			Framework: c.options.Framework,
			Component: c.options.Component,
		},
		Error: ErrorPayload{
			Type:    errorType,
			Message: message,
			Code:    code,
			Stack:   stack,
			Handled: &handled,
			Details: details,
		},
		Context: contextValues,
	}

	if len(payload.Error.Details) == 0 {
		payload.Error.Details = nil
	}
	if len(payload.Context) == 0 {
		payload.Context = nil
	}

	return payload
}

func (c *Connector) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		recorder := &statusRecorder{ResponseWriter: writer}

		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}
			if recovered == http.ErrAbortHandler {
				panic(recovered)
			}

			capture := CaptureOptions{
				Level:         "critical",
				Handled:       Bool(false),
				Type:          "panic",
				Message:       fmt.Sprint(recovered),
				Stack:         string(debug.Stack()),
				Request:       RequestContext(request),
				CorrelationID: correlationIDFromRequest(request),
				Details: map[string]any{
					"panic": true,
				},
			}

			if errorValue, ok := recovered.(error); ok {
				capture.Type = typeName(errorValue)
				capture.Message = errorValue.Error()
				capture.Code = errorCode(errorValue)
				capture.Details = mergeMaps(errorDetails(errorValue), capture.Details)
			} else if recovered != nil {
				capture.Details["panicValue"] = sanitizeValue(recovered, 0, map[uintptr]struct{}{})
			}

			if _, err := c.CaptureError(request.Context(), nil, capture); err != nil {
				if c.options.OnTransportError != nil {
					c.options.OnTransportError(err)
				}
			}

			if !recorder.wroteHeader {
				http.Error(recorder, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			}
		}()

		next.ServeHTTP(recorder, request)
	})
}

func RequestContext(request *http.Request) map[string]any {
	if request == nil {
		return nil
	}

	values := map[string]any{
		"method":     request.Method,
		"path":       request.URL.Path,
		"host":       request.Host,
		"scheme":     requestScheme(request),
		"url":        request.URL.String(),
		"remoteAddr": request.RemoteAddr,
		"userAgent":  request.UserAgent(),
	}

	if requestID := requestIDFromRequest(request); requestID != "" {
		values["requestId"] = requestID
	}

	return sanitizeMap(values)
}

func (c *Connector) send(ctx context.Context, payload ErrorLogRequest) (*ErrorLogAccepted, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("aurakeeper: encode payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.options.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("aurakeeper: build request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Token", c.options.APIToken)
	for key, value := range c.options.Headers {
		req.Header.Set(key, value)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("aurakeeper: send request: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("aurakeeper: read response: %w", err)
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("aurakeeper: request failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	if len(bytes.TrimSpace(responseBody)) == 0 {
		return &ErrorLogAccepted{}, nil
	}

	var accepted ErrorLogAccepted
	if err := json.Unmarshal(responseBody, &accepted); err != nil {
		return nil, fmt.Errorf("aurakeeper: decode response: %w", err)
	}

	return &accepted, nil
}

func (c *Connector) buildContext(options CaptureOptions) map[string]any {
	base := mergeMaps(c.options.Context, options.Context)

	requestValues := mergeMaps(mapFromContext(c.options.Context, "request"), mapFromContext(options.Context, "request"), options.Request)
	userValues := mergeMaps(mapFromContext(c.options.Context, "user"), mapFromContext(options.Context, "user"), options.User)
	sessionValues := mergeMaps(mapFromContext(c.options.Context, "session"), mapFromContext(options.Context, "session"), options.Session)
	deviceValues := mergeMaps(mapFromContext(c.options.Context, "device"), mapFromContext(options.Context, "device"), options.Device)
	tags := uniqueStrings(c.options.Tags, stringsFromContext(c.options.Context, "tags"), stringsFromContext(options.Context, "tags"), options.Tags)

	if len(requestValues) > 0 {
		base["request"] = requestValues
	} else {
		delete(base, "request")
	}
	if len(userValues) > 0 {
		base["user"] = userValues
	} else {
		delete(base, "user")
	}
	if len(sessionValues) > 0 {
		base["session"] = sessionValues
	} else {
		delete(base, "session")
	}
	if len(deviceValues) > 0 {
		base["device"] = deviceValues
	} else {
		delete(base, "device")
	}
	if len(tags) > 0 {
		base["tags"] = tags
	} else {
		delete(base, "tags")
	}

	if correlationID := firstNonEmpty(options.CorrelationID, stringFromContext(options.Context, "correlationId"), stringFromContext(c.options.Context, "correlationId")); correlationID != "" {
		base["correlationId"] = correlationID
	} else {
		delete(base, "correlationId")
	}

	return sanitizeMap(base)
}

func cloneMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func mergeMaps(values ...map[string]any) map[string]any {
	merged := map[string]any{}
	for _, value := range values {
		for key, item := range value {
			if item != nil {
				merged[key] = item
			}
		}
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}

func mapFromContext(context map[string]any, key string) map[string]any {
	if context == nil {
		return nil
	}
	value, ok := context[key]
	if !ok {
		return nil
	}
	sanitized, ok := sanitizeValue(value, 0, map[uintptr]struct{}{}).(map[string]any)
	if !ok {
		return nil
	}
	return sanitized
}

func stringFromContext(context map[string]any, key string) string {
	if context == nil {
		return ""
	}
	value, ok := context[key]
	if !ok {
		return ""
	}
	text, ok := sanitizeValue(value, 0, map[uintptr]struct{}{}).(string)
	if !ok {
		return ""
	}
	return text
}

func stringsFromContext(context map[string]any, key string) []string {
	if context == nil {
		return nil
	}
	value, ok := context[key]
	if !ok {
		return nil
	}

	sanitized := sanitizeValue(value, 0, map[uintptr]struct{}{})
	items, ok := sanitized.([]any)
	if !ok {
		return nil
	}

	output := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if ok && text != "" {
			output = append(output, text)
		}
	}
	return output
}

func uniqueStrings(groups ...[]string) []string {
	seen := map[string]struct{}{}
	output := []string{}

	for _, group := range groups {
		for _, item := range group {
			if item == "" {
				continue
			}
			if _, exists := seen[item]; exists {
				continue
			}
			seen[item] = struct{}{}
			output = append(output, item)
		}
	}

	return output
}

func errorDetails(err error) map[string]any {
	if err == nil {
		return nil
	}
	unwrapped := errors.Unwrap(err)
	if unwrapped == nil {
		return nil
	}
	return map[string]any{
		"cause": unwrapped.Error(),
	}
}

func errorMessage(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func errorCode(err error) string {
	if err == nil {
		return ""
	}

	type codeCarrier interface {
		Code() string
	}
	if value, ok := err.(codeCarrier); ok {
		return value.Code()
	}

	field := reflect.Indirect(reflect.ValueOf(err))
	if field.IsValid() && field.Kind() == reflect.Struct {
		codeField := field.FieldByName("Code")
		if codeField.IsValid() && codeField.Kind() == reflect.String {
			return codeField.String()
		}
	}

	return ""
}

func typeName(err error) string {
	if err == nil {
		return ""
	}
	typ := reflect.TypeOf(err)
	if typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	if typ.Name() != "" {
		return typ.Name()
	}
	return strings.TrimPrefix(reflect.TypeOf(err).String(), "*")
}

func stackTrace(err error) string {
	if err == nil {
		return ""
	}
	return string(debug.Stack())
}

func requestIDFromRequest(request *http.Request) string {
	return firstNonEmpty(
		request.Header.Get("X-Request-Id"),
		request.Header.Get("X-Request-ID"),
		request.Header.Get("Request-Id"),
	)
}

func correlationIDFromRequest(request *http.Request) string {
	return firstNonEmpty(
		request.Header.Get("X-Correlation-Id"),
		request.Header.Get("X-Correlation-ID"),
		requestIDFromRequest(request),
	)
}

func requestScheme(request *http.Request) string {
	if request == nil {
		return ""
	}
	if forwarded := request.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		return forwarded
	}
	if request.URL.Scheme != "" {
		return request.URL.Scheme
	}
	if request.TLS != nil {
		return "https"
	}
	return "http"
}

func sanitizeMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return nil
	}
	sanitized, ok := sanitizeValue(values, 0, map[uintptr]struct{}{}).(map[string]any)
	if !ok || len(sanitized) == 0 {
		return nil
	}
	return sanitized
}

func sanitizeValue(value any, depth int, seen map[uintptr]struct{}) any {
	if value == nil {
		return nil
	}
	if depth >= maxSanitizeDepth {
		return "[MaxDepth]"
	}

	switch typed := value.(type) {
	case string:
		return typed
	case bool:
		return typed
	case int:
		return typed
	case int8:
		return typed
	case int16:
		return typed
	case int32:
		return typed
	case int64:
		return typed
	case uint:
		return typed
	case uint8:
		return typed
	case uint16:
		return typed
	case uint32:
		return typed
	case uint64:
		return typed
	case float32:
		return typed
	case float64:
		return typed
	case time.Time:
		return typed.UTC().Format(time.RFC3339)
	case []byte:
		return string(typed)
	case error:
		return map[string]any{
			"name":    typeName(typed),
			"message": typed.Error(),
		}
	}

	if stringer, ok := value.(fmt.Stringer); ok {
		return stringer.String()
	}

	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.Pointer:
		if rv.IsNil() {
			return nil
		}
		ptr := rv.Pointer()
		if ptr != 0 {
			if _, exists := seen[ptr]; exists {
				return "[Circular]"
			}
			seen[ptr] = struct{}{}
			defer delete(seen, ptr)
		}
		return sanitizeValue(rv.Elem().Interface(), depth+1, seen)
	case reflect.Map:
		if rv.IsNil() {
			return nil
		}
		ptr := rv.Pointer()
		if ptr != 0 {
			if _, exists := seen[ptr]; exists {
				return "[Circular]"
			}
			seen[ptr] = struct{}{}
			defer delete(seen, ptr)
		}
		output := map[string]any{}
		iter := rv.MapRange()
		for iter.Next() {
			output[fmt.Sprint(iter.Key().Interface())] = sanitizeValue(iter.Value().Interface(), depth+1, seen)
		}
		return output
	case reflect.Slice, reflect.Array:
		if rv.Kind() == reflect.Slice && rv.IsNil() {
			return nil
		}
		if rv.Kind() == reflect.Slice {
			ptr := rv.Pointer()
			if ptr != 0 {
				if _, exists := seen[ptr]; exists {
					return "[Circular]"
				}
				seen[ptr] = struct{}{}
				defer delete(seen, ptr)
			}
		}
		output := make([]any, 0, rv.Len())
		for index := 0; index < rv.Len(); index++ {
			output = append(output, sanitizeValue(rv.Index(index).Interface(), depth+1, seen))
		}
		return output
	case reflect.Struct:
		raw, err := json.Marshal(value)
		if err == nil {
			var decoded any
			if json.Unmarshal(raw, &decoded) == nil {
				return sanitizeValue(decoded, depth+1, seen)
			}
		}
	case reflect.Func:
		return "[Function]"
	}

	return fmt.Sprint(value)
}

func newEventID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("event_%d", time.Now().UnixNano())
	}
	buffer[6] = (buffer[6] & 0x0f) | 0x40
	buffer[8] = (buffer[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		buffer[0:4],
		buffer[4:6],
		buffer[6:8],
		buffer[8:10],
		buffer[10:16],
	)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

type statusRecorder struct {
	http.ResponseWriter
	wroteHeader bool
}

func (recorder *statusRecorder) WriteHeader(statusCode int) {
	recorder.wroteHeader = true
	recorder.ResponseWriter.WriteHeader(statusCode)
}

func (recorder *statusRecorder) Write(body []byte) (int, error) {
	recorder.wroteHeader = true
	return recorder.ResponseWriter.Write(body)
}

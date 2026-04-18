require_relative "profile"

actual = render_profile({ id: "guest" })
expected = "Profile: GUEST"

if actual != expected
  warn "expected #{expected.inspect}, got #{actual.inspect}"
  exit 1
end

puts "ruby profile tests passed"

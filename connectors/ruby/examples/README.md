# Ruby Examples

Run the standalone example from this directory with Ruby:

```sh
AURAKEEPER_API_TOKEN=your-token ruby standalone/main.rb
```

Optional:

```sh
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
  AURAKEEPER_API_TOKEN=your-token \
  ruby standalone/main.rb
```

The example installs the connector and renders a profile object missing nested
profile data. That realistic bug raises an uncaught exception so the `at_exit`
hook can send the runtime error to AuraKeeper.

The verification command currently fails until the guest fallback is fixed:

```sh
ruby standalone/profile_test.rb
```

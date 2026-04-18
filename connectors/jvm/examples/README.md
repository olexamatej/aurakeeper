# Examples

- [`standalone/Main.java`](./standalone/Main.java): broken profile renderer that
  installs the default handler and sends the runtime exception to AuraKeeper

Run it from `connectors/jvm`:

```bash
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
AURAKEEPER_API_TOKEN=your-token \
mvn -q -f pom.xml compile
javac -cp target/classes -d target/examples examples/standalone/Main.java
java -cp target/classes:target/examples Main
```

The verification command currently fails until the guest fallback is fixed:

```bash
bash connectors/jvm/examples/standalone/run.sh --verify
```

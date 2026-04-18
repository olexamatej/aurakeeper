# Examples

- [`standalone/Main.java`](./standalone/Main.java): uncaught runtime exception
  example that installs the default handler and sends to AuraKeeper

Run it from `connectors/jvm`:

```bash
AURAKEEPER_ENDPOINT=http://127.0.0.1:3000/v1/logs/errors \
AURAKEEPER_API_TOKEN=your-token \
mvn -q -f pom.xml compile
javac -cp target/classes -d target/examples examples/standalone/Main.java
java -cp target/classes:target/examples Main
```

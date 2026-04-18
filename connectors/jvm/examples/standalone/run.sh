set -eu

cd "$(dirname "$0")/../.."

mvn -q package
mkdir -p /tmp/aurakeeper-jvm-example/out
javac --release 11 -cp target/classes -d /tmp/aurakeeper-jvm-example/out examples/standalone/Main.java
java -cp /tmp/aurakeeper-jvm-example/out:target/classes Main

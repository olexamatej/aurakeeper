const { renderProfile } = require("./profile");

const actual = renderProfile({ id: "guest" });
const expected = "Profile: GUEST";

if (actual !== expected) {
  throw new Error(`Expected ${expected}, got ${actual}`);
}

console.log("react-native profile tests passed");

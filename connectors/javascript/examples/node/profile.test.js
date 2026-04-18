"use strict";

const assert = require("node:assert/strict");
const { renderWelcome } = require("./profile");

assert.equal(
  renderWelcome({ id: "guest" }),
  "Welcome, GUEST",
  "users without a profile should render a stable guest fallback",
);

console.log("profile tests passed");

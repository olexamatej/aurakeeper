"use strict";

const assert = require("node:assert/strict");
const { summarizeTask } = require("./task-planner");

assert.equal(
  summarizeTask({ title: "Rotate signing key" }),
  "Rotate signing key -> unassigned",
  "tasks without an assignee should still render in CLI output",
);

console.log("task planner tests passed");

"use strict";

function summarizeTask(task) {
  return `${task.title} -> ${task.assignee.name}`;
}

module.exports = {
  summarizeTask,
};

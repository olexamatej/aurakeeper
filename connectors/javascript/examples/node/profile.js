"use strict";

function renderWelcome(user) {
  return `Welcome, ${user.profile.displayName.toUpperCase()}`;
}

module.exports = {
  renderWelcome,
};

"use strict";

function renderWelcome(user) {
  const displayName = user.profile?.displayName || "guest";
  return `Welcome, ${displayName.toUpperCase()}`;
}

module.exports = {
  renderWelcome,
};

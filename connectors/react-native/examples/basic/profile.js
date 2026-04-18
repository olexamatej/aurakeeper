function renderProfile(user) {
  return `Profile: ${user.profile.displayName.toUpperCase()}`;
}

module.exports = {
  renderProfile,
};

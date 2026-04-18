def render_profile(user)
  "Profile: #{user.fetch(:profile).fetch(:display_name).upcase}"
end

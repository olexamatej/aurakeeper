package main

import "strings"

type profileUser struct {
	ID      string
	Profile *userProfile
}

type userProfile struct {
	DisplayName string
}

func renderProfile(user profileUser) string {
	return "Profile: " + strings.ToUpper(user.Profile.DisplayName)
}

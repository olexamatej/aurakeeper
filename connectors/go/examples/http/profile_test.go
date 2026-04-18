package main

import "testing"

func TestRenderProfileFallback(t *testing.T) {
	got := renderProfile(profileUser{ID: "guest"})
	want := "Profile: GUEST"

	if got != want {
		t.Fatalf("renderProfile() = %q, want %q", got, want)
	}
}

package main

import (
	"net"
	"testing"

	"github.com/pion/stun/v3"
)

func TestGetenvFallback(t *testing.T) {
	t.Setenv("STUN_LITE_TEST_ENV", "")
	if got := getenv("STUN_LITE_TEST_ENV", ":3478"); got != ":3478" {
		t.Fatalf("expected default, got %q", got)
	}
	t.Setenv("STUN_LITE_TEST_ENV", "127.0.0.1:9999")
	if got := getenv("STUN_LITE_TEST_ENV", ":3478"); got != "127.0.0.1:9999" {
		t.Fatalf("expected env value, got %q", got)
	}
}

func TestBuildBindingResponse(t *testing.T) {
	req := stun.MustBuild(stun.TransactionID, stun.BindingRequest)
	ua := &net.UDPAddr{IP: net.ParseIP("203.0.113.10"), Port: 54321}

	raw, ok, err := buildBindingResponse(req.Raw, ua)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatalf("expected stun binding request to be accepted")
	}

	var resp stun.Message
	resp.Raw = raw
	if err := resp.Decode(); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Type.Method != stun.MethodBinding || resp.Type.Class != stun.ClassSuccessResponse {
		t.Fatalf("unexpected response type: %v", resp.Type)
	}

	var mapped stun.XORMappedAddress
	if err := mapped.GetFrom(&resp); err != nil {
		t.Fatalf("missing XOR-MAPPED-ADDRESS: %v", err)
	}
	if mapped.Port != ua.Port || !mapped.IP.Equal(ua.IP) {
		t.Fatalf("mapped address mismatch: got %s:%d want %s:%d", mapped.IP, mapped.Port, ua.IP, ua.Port)
	}
}

func TestBuildBindingResponseRejectsGarbage(t *testing.T) {
	ua := &net.UDPAddr{IP: net.ParseIP("203.0.113.10"), Port: 54321}
	raw, ok, err := buildBindingResponse([]byte{1, 2, 3}, ua)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok || raw != nil {
		t.Fatalf("expected invalid request to be ignored")
	}
}

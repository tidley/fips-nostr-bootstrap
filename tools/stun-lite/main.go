package main

import (
	"log"
	"net"
	"os"

	"github.com/pion/stun/v3"
)

func main() {
	addr := getenv("STUN_ADDR", ":3478")
	pc, err := net.ListenPacket("udp4", addr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	defer pc.Close()
	log.Printf("stun-lite listening on %s", addr)

	buf := make([]byte, 1500)
	for {
		n, raddr, err := pc.ReadFrom(buf)
		if err != nil {
			log.Printf("read: %v", err)
			continue
		}
		ua, ok := raddr.(*net.UDPAddr)
		if !ok {
			continue
		}

		respRaw, ok, err := buildBindingResponse(buf[:n], ua)
		if err != nil {
			log.Printf("build: %v", err)
			continue
		}
		if !ok {
			continue
		}
		if _, err := pc.WriteTo(respRaw, raddr); err != nil {
			log.Printf("write: %v", err)
			continue
		}
		log.Printf("binding %s -> %s:%d", raddr.String(), ua.IP.String(), ua.Port)
	}
}

func buildBindingResponse(raw []byte, ua *net.UDPAddr) ([]byte, bool, error) {
	var req stun.Message
	req.Raw = append([]byte(nil), raw...)
	if err := req.Decode(); err != nil {
		return nil, false, nil
	}
	if req.Type.Method != stun.MethodBinding || req.Type.Class != stun.ClassRequest {
		return nil, false, nil
	}

	resp, err := stun.Build(stun.TransactionID, stun.BindingSuccess, &stun.XORMappedAddress{IP: ua.IP, Port: ua.Port}, stun.Fingerprint)
	if err != nil {
		return nil, false, err
	}
	return resp.Raw, true, nil
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

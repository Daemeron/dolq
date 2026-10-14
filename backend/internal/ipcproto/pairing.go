package ipcproto

import (
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// LoadOrCreateToken returns the access token stored at file, creating a
// random one (owner-only) on first use, so a fresh install needs no setup.
func LoadOrCreateToken(file string) (string, error) {
	if b, err := os.ReadFile(file); err == nil {
		if t := strings.TrimSpace(string(b)); t != "" {
			return t, nil
		}
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(file, []byte(token+"\n"), 0o600); err != nil {
		return "", err
	}
	return token, nil
}

// PairingLink is what a client pastes to connect: address, token and, for a
// self-signed certificate, its fingerprint, so there is nothing to confirm.
// Because the fingerprint travels with the token it is verified out of band.
// tls=0 marks a backend served without TLS, so the client does not try it.
func PairingLink(host string, port int, token, fingerprint string, tls bool) string {
	q := url.Values{}
	q.Set("token", token)
	if !tls {
		q.Set("tls", "0")
	}
	if fingerprint != "" {
		q.Set("fp", fingerprint)
	}
	return "dolq://" + net.JoinHostPort(host, strconv.Itoa(port)) + "?" + q.Encode()
}

// LANHosts lists this machine's non-loopback IPv4 addresses, the ones a client
// on the same network would use.
func LANHosts() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var hosts []string
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() && ipn.IP.To4() != nil {
			hosts = append(hosts, ipn.IP.String())
		}
	}
	return hosts
}

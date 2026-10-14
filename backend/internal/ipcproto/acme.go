package ipcproto

import (
	"crypto/tls"

	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"
)

const letsEncryptStaging = "https://acme-staging-v02.api.letsencrypt.org/directory"

// ACMEConfig returns a TLS config that obtains and renews a Let's Encrypt
// certificate for domain on demand. Validation uses TLS-ALPN-01 on the same
// listener, so the listener must be reachable from the internet on port 443
// (a container or router may map another local port to it). Certificates and
// the account key are cached under cacheDir. The staging CA issues untrusted
// certs, for trying the setup without hitting production rate limits.
func ACMEConfig(domain, email, cacheDir string, staging bool) *tls.Config {
	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(domain),
		Cache:      autocert.DirCache(cacheDir),
		Email:      email,
	}
	if staging {
		m.Client = &acme.Client{DirectoryURL: letsEncryptStaging}
	}
	cfg := m.TLSConfig()
	cfg.MinVersion = tls.VersionTLS12
	return cfg
}

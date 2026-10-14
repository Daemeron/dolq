package main

import (
	"errors"
	"reflect"
	"testing"
)

func TestPlan(t *testing.T) {
	// defaults mirrors the flag defaults: -tls and -token on, everything else off.
	defaults := options{tls: true, token: true}
	with := func(f func(*options)) options { o := defaults; f(&o); return o }

	tests := []struct {
		name string
		o    options
		env  map[string]string
		goos string
		want listenPlan
		err  error
	}{
		{
			name: "local default unix socket",
			o:    defaults, goos: "linux",
			want: listenPlan{network: "unix", tempSocket: true, useToken: true},
		},
		{
			name: "explicit socket",
			o:    with(func(o *options) { o.socket = "/run/d.sock" }), goos: "darwin",
			want: listenPlan{network: "unix", path: "/run/d.sock", useToken: true},
		},
		{
			name: "explicit socket keeps DOLQ_TOKEN",
			o:    with(func(o *options) { o.socket = "/run/d.sock" }), goos: "linux",
			env:  map[string]string{"DOLQ_TOKEN": "t"},
			want: listenPlan{network: "unix", path: "/run/d.sock", useToken: true, token: "t"},
		},
		{
			name: "windows default is a named pipe",
			o:    defaults, goos: "windows",
			want: listenPlan{network: "pipe", path: `\\.\pipe\dolq-42`, useToken: true},
		},
		{
			name: "windows explicit socket stays unix",
			o:    with(func(o *options) { o.socket = `C:\d.sock` }), goos: "windows",
			want: listenPlan{network: "unix", path: `C:\d.sock`, useToken: true},
		},
		{
			name: "local ignores tls, token and secure flags",
			o:    with(func(o *options) { o.tls, o.token, o.secure = false, false, true }), goos: "linux",
			want: listenPlan{network: "unix", tempSocket: true, useToken: true, secureOnly: true},
		},
		{
			name: "addr wins over socket and pipe",
			o:    with(func(o *options) { o.addr, o.socket = "0.0.0.0:6789", "/run/d.sock" }), goos: "windows",
			want: listenPlan{network: "tcp", path: "0.0.0.0:6789", useToken: true, loadToken: true, useTLS: true, pairing: true, allowPlain: true},
		},
		{
			name: "tcp default: generated token, self-signed TLS, plain allowed",
			o:    with(func(o *options) { o.addr = "0.0.0.0:6789" }), goos: "linux",
			want: listenPlan{network: "tcp", path: "0.0.0.0:6789", useToken: true, loadToken: true, useTLS: true, pairing: true, allowPlain: true},
		},
		{
			name: "tcp with DOLQ_TOKEN",
			o:    with(func(o *options) { o.addr = "0.0.0.0:6789" }), goos: "linux",
			env:  map[string]string{"DOLQ_TOKEN": "t"},
			want: listenPlan{network: "tcp", path: "0.0.0.0:6789", useToken: true, token: "t", useTLS: true, pairing: true, allowPlain: true},
		},
		{
			name: "tcp explicit cert pair",
			o:    with(func(o *options) { o.addr, o.tlsCert, o.tlsKey = ":6789", "c.pem", "k.pem" }), goos: "linux",
			want: listenPlan{network: "tcp", path: ":6789", useToken: true, loadToken: true, useTLS: true, certFile: "c.pem", keyFile: "k.pem", pairing: true, allowPlain: true},
		},
		{
			name: "tcp half a cert pair falls back to the default pair",
			o:    with(func(o *options) { o.addr, o.tlsCert = ":6789", "c.pem" }), goos: "linux",
			want: listenPlan{network: "tcp", path: ":6789", useToken: true, loadToken: true, useTLS: true, pairing: true, allowPlain: true},
		},
		{
			name: "tcp acme",
			o:    with(func(o *options) { o.addr, o.acmeDomain, o.tlsCert, o.tlsKey = ":443", "d.example", "c.pem", "k.pem" }), goos: "linux",
			want: listenPlan{network: "tcp", path: ":443", useToken: true, loadToken: true, useTLS: true, acme: true, pairing: true, allowPlain: true},
		},
		{
			name: "acme ignored without tls",
			o:    with(func(o *options) { o.addr, o.acmeDomain, o.tls = "127.0.0.1:6789", "d.example", false }), goos: "linux",
			want: listenPlan{network: "tcp", path: "127.0.0.1:6789", useToken: true, loadToken: true, pairing: true},
		},
		{
			name: "tcp -secure",
			o:    with(func(o *options) { o.addr, o.secure = ":6789", true }), goos: "linux",
			want: listenPlan{network: "tcp", path: ":6789", useToken: true, loadToken: true, useTLS: true, secureOnly: true, pairing: true},
		},
		{
			name: "tcp DOLQ_SECURE=1",
			o:    with(func(o *options) { o.addr = ":6789" }), goos: "linux",
			env:  map[string]string{"DOLQ_SECURE": "1"},
			want: listenPlan{network: "tcp", path: ":6789", useToken: true, loadToken: true, useTLS: true, secureOnly: true, pairing: true},
		},
		{
			name: "DOLQ_SECURE other than 1 is off",
			o:    with(func(o *options) { o.addr = ":6789" }), goos: "linux",
			env:  map[string]string{"DOLQ_SECURE": "true"},
			want: listenPlan{network: "tcp", path: ":6789", useToken: true, loadToken: true, useTLS: true, pairing: true, allowPlain: true},
		},
		{
			name: "tcp -token=false drops DOLQ_TOKEN, no plain fallback, no pairing",
			o:    with(func(o *options) { o.addr, o.token = ":6789", false }), goos: "linux",
			env:  map[string]string{"DOLQ_TOKEN": "t"},
			want: listenPlan{network: "tcp", path: ":6789", useTLS: true, noTokenWarning: true},
		},
		{
			name: "tcp -tls=false on loopback: no warning",
			o:    with(func(o *options) { o.addr, o.tls = "127.0.0.1:6789", false }), goos: "linux",
			want: listenPlan{network: "tcp", path: "127.0.0.1:6789", useToken: true, loadToken: true, pairing: true},
		},
		{
			name: "tcp -tls=false on localhost: no warning",
			o:    with(func(o *options) { o.addr, o.tls = "localhost:6789", false }), goos: "linux",
			want: listenPlan{network: "tcp", path: "localhost:6789", useToken: true, loadToken: true, pairing: true},
		},
		{
			name: "tcp -tls=false on a public address warns",
			o:    with(func(o *options) { o.addr, o.tls = "0.0.0.0:6789", false }), goos: "linux",
			want: listenPlan{network: "tcp", path: "0.0.0.0:6789", useToken: true, loadToken: true, pairing: true, plainWarning: true},
		},
		{
			name: "tcp -tls=false -token=false",
			o:    with(func(o *options) { o.addr, o.tls, o.token = "[::1]:6789", false, false }), goos: "linux",
			want: listenPlan{network: "tcp", path: "[::1]:6789", noTokenWarning: true},
		},
		{
			name: "-secure with -tls=false",
			o:    with(func(o *options) { o.addr, o.secure, o.tls = ":6789", true, false }), goos: "linux",
			err: errSecureConflict,
		},
		{
			name: "-secure with -token=false",
			o:    with(func(o *options) { o.addr, o.secure, o.token = ":6789", true, false }), goos: "linux",
			err: errSecureConflict,
		},
		{
			name: "DOLQ_SECURE with -tls=false -token=false",
			o:    with(func(o *options) { o.addr, o.tls, o.token = ":6789", false, false }), goos: "linux",
			env: map[string]string{"DOLQ_SECURE": "1"},
			err: errSecureConflict,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := plan(tt.o, func(k string) string { return tt.env[k] }, tt.goos, 42)
			if !errors.Is(err, tt.err) {
				t.Fatalf("err = %v, want %v", err, tt.err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("plan =\n %+v\nwant\n %+v", got, tt.want)
			}
		})
	}
}

# Runs dolqd standalone, listening on TCP instead of the Unix socket it uses
# when Electron spawns it locally - what a Dolq client points its "Remote
# Backend" URL (Preferences) at. Build/run from the repo root:
#   docker compose up -d
# or directly:
#   docker build -t dolqd -f backend/Dockerfile backend
#   docker run -p 6789:6789 -v dolq-data:/data dolqd
#
# modernc.org/sqlite (backend/go.mod) is pure Go, so CGO_ENABLED=0 needs
# nothing extra - no gcc/musl-dev stage required for the history DB.
#
# /data also holds the generated access token (token) and self-signed TLS
# certificate (tls-cert.pem / tls-key.pem); the pairing link printed at startup
# (docker logs) carries the token and the certificate's fingerprint.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /dolqd ./cmd/dolqd

FROM alpine:3.20
# a fixed uid so volumes and Kubernetes securityContext can refer to it
RUN adduser -D -u 10001 -h /data dolq
COPY --from=build /dolqd /usr/local/bin/dolqd
USER dolq
VOLUME /data
EXPOSE 6789
ENTRYPOINT ["dolqd", "-addr", "0.0.0.0:6789", "-db", "/data/history.db"]

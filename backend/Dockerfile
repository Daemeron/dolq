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
# certificate (tls-cert.pem / tls-key.pem), owner-only (uid 10001), and XDCC
# downloads (downloads/). The pairing link, logged on first start or with
# -print-pairing (docker logs), carries the token and certificate fingerprint.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# the release workflow passes the release version; a local build reports "dev"
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o /dolqd ./cmd/dolqd

FROM alpine:3.24
# a fixed uid so volumes and Kubernetes securityContext can refer to it
RUN adduser -D -u 10001 -h /data dolq && apk add --no-cache su-exec tzdata
COPY --from=build /dolqd /usr/local/bin/dolqd
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# No USER here: the entrypoint starts as root to take over the data folder, then runs dolqd as PUID:PGID (default dolq, 10001).
# tells dolqd it runs in a container, so it can warn about a folder that is not a mounted volume
ENV DOLQ_CONTAINER=1
VOLUME /data
EXPOSE 6789
ENTRYPOINT ["docker-entrypoint.sh", "dolqd", "-addr", "0.0.0.0:6789", "-db", "/data/history.db"]

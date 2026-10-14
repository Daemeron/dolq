# Running dolqd on Kubernetes (e.g. a NAS)

Runs the Dolq backend (`dolqd`) as a single always-on pod, so IRC sessions and
history live on your NAS and any Dolq client on your network attaches to them.
Works on k3s, TrueNAS SCALE, Synology/QNAP container platforms, or any cluster.

Connections are encrypted (TLS) and need an access token. Both are created for
you on first start; you pair a client by pasting one link.

## 1. Get the image

Each release publishes a multi-arch image (amd64 and arm64, so it fits Intel and
ARM NASes alike) to `ghcr.io/daemeron/dolqd`; the manifests use it by default,
so there is nothing to build. Tags: `latest`, `0.1.5`, `0.1`. Pin a version in
`kustomization.yaml` (`images:`) rather than running `latest` unattended.

If the cluster cannot pull it (the package is private until its visibility is
set to public under the repository's **Packages** settings, or you run your own
changes), build and push your own:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -t registry.nas.local:5000/dolqd:latest --push backend
```

then point `images:` in `kustomization.yaml` at it. On a single-node k3s you can
skip the registry: `docker save dolqd:latest | sudo k3s ctr images import -`.

## 2. Configure

1. `configmap.yaml`: set `DOLQ_PUBLIC_HOST` to your NAS's name or LAN IP. It is
   only used to build the pairing link.
2. `kustomization.yaml`: optionally pin a version or use your own image (`images:`).
3. `pvc.yaml`: optionally set `storageClassName` and the size. It holds the
   history database, the access token, the TLS certificate and XDCC downloads
   (`/data/downloads`; size it for those).

## 3. Deploy

```sh
kubectl apply -k deploy/kubernetes
kubectl -n dolq rollout status deploy/dolqd
```

## 4. Pair a client

```sh
kubectl -n dolq logs deploy/dolqd | grep dolq://
```

Copy the `dolq://…` link, then in Dolq open **Preferences → Connect to a remote
backend** and paste it into **Pairing Link**. The link carries the address, the
access token and the certificate's fingerprint, so there is nothing else to
type or confirm. Save and restart Dolq. Keep the link private: it contains the
token.

`dolqd` logs the link only when it first generates the token (never if you set
it with the `dolqd-token` Secret); later starts log a hint instead. To print it
again, add `-print-pairing` to the container's args for one start:

```sh
kubectl -n dolq patch deploy dolqd --type json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"-print-pairing"}]'
kubectl -n dolq rollout status deploy/dolqd
kubectl -n dolq logs deploy/dolqd | grep dolq://
kubectl apply -k deploy/kubernetes   # back to the manifests' args
```

## Options

- **Choose the token yourself** instead of a generated one:
  `kubectl -n dolq create secret generic dolqd-token --from-literal=token="$(openssl rand -hex 32)"`
  then `kubectl -n dolq rollout restart deploy/dolqd`.
- **LoadBalancer instead of NodePort** (MetalLB, k3s servicelb): edit
  `service.yaml` as its comment says and set `DOLQ_PUBLIC_PORT` to `6789`.
- **Reachable from the internet with a domain name:** add
  `-acme-domain your.domain` to the container `args` for an automatic Let's
  Encrypt certificate (the name must point at you and port 443 must reach the
  pod, e.g. `nodePort`/load balancer on 443). Pair with a link that has no
  fingerprint, since a CA-issued certificate needs none. Try `-acme-staging`
  first.
- **Run without encryption or a token** (a network you fully trust, or an
  existing setup you have not re-paired yet): the manifests pass `-secure`,
  which refuses plain connections; remove it to accept them again. TLS and the
  token are independent switches on `dolqd`: `-tls=false` serves plain TCP
  (behind a TLS-terminating proxy or tunnel) and `-token=false` drops the
  access token (anyone who can reach the port can use it). Use them in `args`
  instead of `-secure`, which cannot be combined with either. In Dolq, untick
  **Encrypt the connection** and/or leave the token empty to match; it asks
  you to confirm each time it connects.
- **Rotate the token or certificate:** delete `token` / `tls-cert.pem` /
  `tls-key.pem` from the PVC (or change the secret) and restart; paste the new
  pairing link into each client (print it as in step 4 if the token was kept
  or set by the secret).

## Notes

- It is deliberately a single replica with `Recreate` updates: `dolqd` holds
  the IRC connections and a SQLite file, so two copies would conflict.
- Back up the PVC to keep your history.
- XDCC downloads are saved on the PVC under `/data/downloads`, whatever
  download folder a client's Preferences name. To put them elsewhere (e.g. a
  NAS share), mount that volume and set `DOLQ_DOWNLOAD_DIR` (or
  `-download-dir`) to its path; it must be writable by uid 10001.
- The pod runs as a non-root user with a read-only root filesystem and no
  extra capabilities.

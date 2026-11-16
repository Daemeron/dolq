#!/bin/sh
# Started as root, this takes over the data and download folders that Docker created for a bind mount, which belong to
# root, and then runs dolqd as the dolq user (10001). A folder that belongs to someone else, such as an existing share on
# the NAS, is left as it is, and only warned about: it is not this script's to change the owner of.
# Started as another user already, as Kubernetes does with runAsUser, it just runs dolqd.
set -eu
if [ "$(id -u)" = 0 ]; then
  for dir in /data "${DOLQ_DOWNLOAD_DIR:-}"; do
    [ -n "$dir" ] && [ -d "$dir" ] || continue
    owner="$(stat -c %u "$dir")"
    if [ "$owner" = 0 ]; then
      chown 10001:10001 "$dir"
    elif [ "$owner" != 10001 ]; then
      echo "warning: $dir belongs to user $owner, not 10001: dolqd cannot write there unless it is made writable for 10001, or the container is run as user $owner" >&2
    fi
  done
  exec su-exec 10001:10001 "$@"
fi
exec "$@"

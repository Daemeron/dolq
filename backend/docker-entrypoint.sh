#!/bin/sh
# Started as root, this takes over the data and download folders that Docker created for a bind mount, which belong to
# root, and then runs dolqd as PUID:PGID (default 10001:10001). A folder that belongs to someone else, such as an existing
# share on the NAS, is left as it is, and only warned about unless PUID is that someone: it is not this script's to
# change the owner of. Started as another user already, as Kubernetes does with runAsUser, it just runs dolqd.
set -eu
if [ "$(id -u)" = 0 ]; then
  uid="${PUID:-10001}"
  gid="${PGID:-10001}"
  case "$uid$gid" in
    *[!0-9]* | '')
      echo "error: PUID and PGID must be numbers, not '$uid' and '$gid'" >&2
      exit 1
      ;;
  esac
  for dir in /data "${DOLQ_DOWNLOAD_DIR:-}"; do
    [ -n "$dir" ] && [ -d "$dir" ] || continue
    owner="$(stat -c %u "$dir")"
    if [ "$owner" = 0 ]; then
      chown "$uid:$gid" "$dir"
    elif [ "$owner" != "$uid" ]; then
      echo "warning: $dir belongs to user $owner, not $uid: dolqd cannot write there unless it is made writable for $uid, or PUID is set to $owner" >&2
    fi
  done
  exec su-exec "$uid:$gid" "$@"
fi
exec "$@"

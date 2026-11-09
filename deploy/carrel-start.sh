#!/bin/sh
# carrel-deployd runs this from the release directory on every deploy and
# rollback. It points the Compose stack in /opt/winlab-portal at the image in
# VERSION, reports ready once web is healthy, then follows the web logs.
# The unit needs Type=notify and NotifyAccess=all (see README, Deploy).
set -eu

version=$(cat VERSION)
# The release carries the stack's compose.yaml, so the repo is its source.
# An older release (a rollback) has none and keeps the one in place.
if [ -f compose.yaml ]; then
  cp compose.yaml /opt/winlab-portal/compose.yaml.new
  mv /opt/winlab-portal/compose.yaml.new /opt/winlab-portal/compose.yaml
fi
cd /opt/winlab-portal

tmp=$(mktemp .env.XXXXXX)
sed "s/^PORTAL_VERSION=.*/PORTAL_VERSION=$version/" .env >"$tmp"
mv "$tmp" .env

docker compose pull --quiet migrate web
docker compose up -d --wait web
systemd-notify --ready
# Each deploy leaves its image behind; 11-04 they filled the disk and
# Postgres stopped. Keep this one and the 2 newest others for a rollback.
docker images ghcr.io/nycu-winlab/portal --format '{{.Tag}}' |
  grep -vx -e "$version" -e main | tail -n +3 |
  while read -r tag; do
    docker rmi "ghcr.io/nycu-winlab/portal:$tag" >/dev/null 2>&1 || true
  done
docker image prune -f >/dev/null 2>&1 || true
exec docker compose logs -f --since 1s web

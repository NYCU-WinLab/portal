#!/bin/sh
# Installs or updates the player as a systemd service, from this folder.
# First install: MUSIC_URL, PLAYER_TOKEN and HOMEPOD_NAME in the environment
# (HOMEPOD_HOST optional) write /etc/winlab-music-player.env; later runs keep it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=/opt/winlab-music-player
envfile=/etc/winlab-music-player.env

id music >/dev/null 2>&1 || useradd --system --home-dir "$root" --shell /usr/sbin/nologin music
install -d -m 755 "$root" "$root/bin"
install -m 644 "$here/player.py" "$here/requirements.txt" "$root/"

if [ ! -x "$root/venv/bin/python" ]; then
  python3 -m venv "$root/venv"
fi
"$root/venv/bin/pip" install --quiet --upgrade pip
"$root/venv/bin/pip" install --quiet --upgrade -r "$root/requirements.txt"

# yt-dlp needs a JavaScript runtime to read YouTube; Deno is a single binary.
if [ ! -x "$root/bin/deno" ]; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/deno.zip" https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$tmp/deno.zip" "$root/bin"
  chmod 755 "$root/bin/deno"
  rm -rf "$tmp"
fi

if [ ! -f "$envfile" ]; then
  umask 077
  cat > "$envfile" <<ENV
MUSIC_URL=${MUSIC_URL:?set MUSIC_URL}
PLAYER_TOKEN=${PLAYER_TOKEN:?set PLAYER_TOKEN}
HOMEPOD_NAME=${HOMEPOD_NAME:?set HOMEPOD_NAME}
HOMEPOD_HOST=${HOMEPOD_HOST:-}
ENV
fi

install -m 644 "$here/winlab-music-player.service" "$here/winlab-music-ytdlp.service" "$here/winlab-music-ytdlp.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now winlab-music-ytdlp.timer
systemctl enable winlab-music-player.service
systemctl restart winlab-music-player.service
systemctl --no-pager --lines=0 status winlab-music-player.service

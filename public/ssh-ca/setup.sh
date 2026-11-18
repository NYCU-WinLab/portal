#!/bin/sh
# Set up WinLab SSH certificates on this computer (macOS or Linux).
# 1. Installs the step CLI (Homebrew, or the official release into ~/.local/bin).
# 2. Trusts the lab CA https://ca.winlab.tw (pinned root fingerprint).
# 3. Adds one block to ~/.ssh/config: before connecting to a lab host, ssh runs
#    ~/.step/winlab-ssh-login, which calls `step ssh login` (a no-op while the agent
#    holds a valid certificate) and skips machines without a browser.
# Safe to run again.
set -eu
FP=3caa3c7b7198b8c235398b62302e65a695eddc9a7c830bc9b040c7f257767870
VER=0.30.2
HOSTS="${WINLAB_SSH_HOSTS:-carrel.winlab.tw,*.winlab.tw}"

if ! command -v step >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install step
  else
    os=$(uname -s | tr A-Z a-z)
    case $(uname -m) in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;; esac
    f="step_${os}_${VER}_${arch}.tar.gz"
    url="https://github.com/smallstep/cli/releases/download/v${VER}"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    curl -fsSL -o "$tmp/$f" "$url/$f"
    curl -fsSL -o "$tmp/checksums.txt" "$url/checksums.txt"
    if command -v sha256sum >/dev/null 2>&1; then sum="sha256sum"; else sum="shasum -a 256"; fi
    (cd "$tmp" && grep " $f\$" checksums.txt | $sum -c - >/dev/null)
    tar -xzf "$tmp/$f" -C "$tmp"
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$tmp/step_${VER}/bin/step" "$HOME/.local/bin/step"
    PATH="$HOME/.local/bin:$PATH"
    echo "installed step to ~/.local/bin (add it to PATH if 'step' is not found)"
  fi
fi

step ca bootstrap --ca-url https://ca.winlab.tw --fingerprint "$FP" --force >/dev/null
STEP=$(command -v step)

# ssh runs this before connecting. It never blocks ssh for long: no browser
# (headless Linux) means skip, and a sign-in left open is stopped after 120 s.
HOOK="$HOME/.step/winlab-ssh-login"
mkdir -p "$HOME/.step"
cat > "$HOOK" <<HOOKEOF
#!/bin/sh
case "\$(uname -s)" in
  Darwin) ;;
  *) [ -n "\${DISPLAY:-}\${WAYLAND_DISPLAY:-}" ] || exit 0 ;;
esac
"$STEP" ssh login --provisioner winlab >/dev/null 2>&1 </dev/null &
pid=\$!
( sleep 120; kill \$pid 2>/dev/null ) >/dev/null 2>&1 &
watch=\$!
wait \$pid 2>/dev/null
kill \$watch 2>/dev/null
pkill -P \$watch 2>/dev/null
exit 0
HOOKEOF
chmod 755 "$HOOK"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
CFG="$HOME/.ssh/config"
touch "$CFG"
BEGIN="# >>> winlab ssh certificate >>>"
END="# <<< winlab ssh certificate <<<"
tmp_cfg=$(mktemp)
awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1;next} $0==e{skip=0;gap=1;next} gap&&$0==""{gap=0;next} {gap=0} !skip' "$CFG" > "$tmp_cfg"
{
  echo "$BEGIN"
  echo "Match final host $HOSTS exec \"$HOOK\""
  echo "$END"
  echo
  cat "$tmp_cfg"
} > "$CFG"
rm -f "$tmp_cfg"
chmod 600 "$CFG"
echo "done: the next ssh to $HOSTS signs you in through Keycloak when needed"

#!/bin/sh
set -eu

REPO="${VIBE_AGENT_REPO:-vibec-studios/vibe-launcher}"
API_URL="${VIBE_AGENT_API_URL:-https://api.github.com/repos/$REPO/releases?per_page=100}"
DOWNLOAD_URL="${VIBE_AGENT_DOWNLOAD_URL:-https://github.com/$REPO/releases/download}"
DOCS_URL="https://github.com/$REPO/blob/main/docs/REMOTE-AGENT-INSTALL.md"
ROOT="${VIBE_AGENT_ROOT:-}"
BIN_PATH="/usr/local/bin/vibe-agent"
DATA_DIR="/var/lib/vibe-agent"
CONF_DIR="/etc/vibe-agent"
CONF_FILE="$CONF_DIR/agent.env"
UNIT_PATH="/etc/systemd/system/vibe-agent.service"
SERVICE_USER="vibe-agent"
DEFAULT_PORT=25580
MC_PORT=25565

MODE=install
VERSION="${VIBE_AGENT_VERSION:-}"
PORT_ARG=""
PORT="$DEFAULT_PORT"
DRY_RUN="${VIBE_AGENT_DRY_RUN:-0}"
PURGE=0
PAIR=1
SUDO=""
TMP=""
TAG=""
TARGET=""
ASSET=""
NEW_VERSION=""
UPDATE=0
BIN_CHANGED=1
UNIT_CHANGED=1
HAS_SYSTEMD=0
RUNNING=0
PAIR_OUTPUT=""
STAGED=""

B=""
G=""
Y=""
R=""
D=""
N=""

setup_output() {
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    B=$(printf '\033[1m')
    G=$(printf '\033[32m')
    Y=$(printf '\033[33m')
    R=$(printf '\033[31m')
    D=$(printf '\033[2m')
    N=$(printf '\033[0m')
  fi
}

say() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
ok() { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*" >&2; }
die() {
  printf '%sFehler:%s %s\n' "$R" "$N" "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Vibe Server Agent – Installation für Linux (x64/arm64)

  curl -fsSL https://vibe.axolite.app/agent/install.sh | sh
  curl -fsSL https://vibe.axolite.app/agent/install.sh | sh -s -- [Optionen]

Optionen:
  --version <v>   bestimmte Version installieren (z. B. 0.1.0), Standard: neueste
  --port <n>      Port für Launcher/Panel (Standard $DEFAULT_PORT, nur bei Neuinstallation oder Änderung)
  --no-pair       keinen Kopplungscode erzeugen
  --uninstall     Agent entfernen (Server-Daten bleiben erhalten)
  --purge         mit --uninstall: auch alle Daten und den Benutzer $SERVICE_USER löschen
  --dry-run       Probelauf: nichts am System ändern, Dateien landen in einem Temp-Ordner
  -h, --help      diese Hilfe

Erneut ausführen = Update auf die neueste Version (Einstellungen und Server bleiben).
Anleitung: $DOCS_URL
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        [ $# -ge 2 ] || die "--version braucht einen Wert"
        VERSION="$2"
        shift 2
        ;;
      --version=*)
        VERSION="${1#*=}"
        shift
        ;;
      --port)
        [ $# -ge 2 ] || die "--port braucht einen Wert"
        PORT_ARG="$2"
        shift 2
        ;;
      --port=*)
        PORT_ARG="${1#*=}"
        shift
        ;;
      --no-pair)
        PAIR=0
        shift
        ;;
      --uninstall)
        MODE=uninstall
        shift
        ;;
      --purge)
        PURGE=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "Unbekannte Option: $1 (Hilfe: --help)" ;;
    esac
  done
  if [ -n "$PORT_ARG" ]; then
    case "$PORT_ARG" in
      '' | *[!0-9]*) die "Ungültiger Port: $PORT_ARG" ;;
    esac
    if [ "$PORT_ARG" -lt 1 ] || [ "$PORT_ARG" -gt 65535 ]; then
      die "Ungültiger Port: $PORT_ARG"
    fi
  fi
  if [ "$PURGE" = 1 ] && [ "$MODE" != uninstall ]; then
    die "--purge geht nur zusammen mit --uninstall"
  fi
}

has() { command -v "$1" >/dev/null 2>&1; }

sys() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s[Probelauf] %s%s\n' "$D" "$*" "$N"
    return 0
  fi
  $SUDO "$@"
}

fs() { $SUDO "$@"; }

setup_privileges() {
  if [ "$DRY_RUN" = 1 ]; then
    if [ -z "$ROOT" ]; then
      ROOT=$(mktemp -d "${TMPDIR:-/tmp}/vibe-agent-dryrun.XXXXXX")
    fi
    say "${Y}Probelauf:${N} Es wird nichts am System geändert. Dateien landen in $ROOT"
    return 0
  fi
  if [ "$(id -u)" = 0 ]; then
    return 0
  fi
  if has sudo; then
    SUDO=sudo
    say "Für die Einrichtung werden Administratorrechte gebraucht – ggf. fragt sudo gleich nach deinem Passwort."
    sudo -v || die "Ohne Administratorrechte geht es nicht. Melde dich als root an oder nutze ein Konto mit sudo."
    return 0
  fi
  die "Bitte als root ausführen (sudo ist nicht installiert)."
}

detect_platform() {
  [ "$(uname -s)" = Linux ] || die "Dieses Skript ist für Linux. Windows: install.ps1, sonst Docker – siehe $DOCS_URL"
  case "$(uname -m)" in
    x86_64 | amd64) TARGET="x86_64-unknown-linux-musl" ;;
    aarch64 | arm64) TARGET="aarch64-unknown-linux-musl" ;;
    *) die "Nicht unterstützte Architektur: $(uname -m) (unterstützt: x86_64, aarch64)" ;;
  esac
  ASSET="vibe-agent-$TARGET"
  if [ "$DRY_RUN" = 1 ] || { [ -d /run/systemd/system ] && has systemctl; }; then
    HAS_SYSTEMD=1
  fi
}

fetch() {
  if has curl; then
    curl -fsSL --retry 3 --connect-timeout 15 -A "vibe-agent-installer" -o "$2" "$1"
  elif has wget; then
    wget -q -U "vibe-agent-installer" -O "$2" "$1"
  else
    die "Weder curl noch wget gefunden. Installiere eins davon (z. B. apt install curl)."
  fi
}

sha256_of() {
  if has sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  elif has shasum; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif has openssl; then
    openssl dgst -sha256 -r "$1" | awk '{print $1}'
  else
    die "Kein Programm für SHA256 gefunden (sha256sum, shasum oder openssl)."
  fi
}

resolve_tag() {
  if [ -n "$VERSION" ]; then
    v="${VERSION#agent-}"
    TAG="agent-v${v#v}"
    return 0
  fi
  step "Suche die neueste Agent-Version …"
  fetch "$API_URL" "$TMP/releases.json" || die "Release-Liste nicht erreichbar ($API_URL). Internet/DNS prüfen."
  TAG=$(grep -o '"tag_name"[[:space:]]*:[[:space:]]*"agent-v[^"]*"' "$TMP/releases.json" |
    head -n 1 | sed 's/.*"\(agent-v[^"]*\)"$/\1/')
  [ -n "$TAG" ] || die "Noch kein Agent-Release (Tag agent-v…) gefunden."
}

download_binary() {
  step "Lade $ASSET ($TAG) …"
  fetch "$DOWNLOAD_URL/$TAG/SHA256SUMS" "$TMP/SHA256SUMS" || die "SHA256SUMS für $TAG nicht gefunden."
  fetch "$DOWNLOAD_URL/$TAG/$ASSET" "$TMP/$ASSET" || die "$ASSET für $TAG nicht gefunden."
  expected=$(awk -v a="$ASSET" '$2 == a || $2 == "*" a {print tolower($1); exit}' "$TMP/SHA256SUMS")
  [ -n "$expected" ] || die "$ASSET fehlt in SHA256SUMS."
  actual=$(sha256_of "$TMP/$ASSET" | tr 'A-F' 'a-f')
  [ "$expected" = "$actual" ] || die "Prüfsumme stimmt nicht (erwartet $expected, erhalten $actual). Download abgebrochen."
  ok "Prüfsumme (SHA256) stimmt"
  fs mkdir -p "$ROOT$(dirname "$BIN_PATH")"
  STAGED="$ROOT$BIN_PATH.new"
  fs cp "$TMP/$ASSET" "$STAGED"
  fs chmod 755 "$STAGED"
  if ! NEW_VERSION=$("$STAGED" --version 2>/dev/null | head -n 1) || [ -z "$NEW_VERSION" ]; then
    die "Das heruntergeladene Programm startet nicht auf diesem System ($(uname -m))."
  fi
  if [ -f "$ROOT$BIN_PATH" ]; then
    UPDATE=1
    if [ "$(sha256_of "$ROOT$BIN_PATH")" = "$actual" ]; then
      BIN_CHANGED=0
    fi
  fi
}

nologin_shell() {
  for s in /usr/sbin/nologin /sbin/nologin /usr/bin/false /bin/false; do
    if [ -x "$s" ]; then
      printf '%s' "$s"
      return 0
    fi
  done
  printf '/bin/false'
}

ensure_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    return 0
  fi
  step "Lege Systembenutzer $SERVICE_USER an …"
  shell=$(nologin_shell)
  if has useradd; then
    sys useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell "$shell" "$SERVICE_USER"
  elif has adduser; then
    sys addgroup -S "$SERVICE_USER"
    sys adduser -S -D -H -h "$DATA_DIR" -s "$shell" -G "$SERVICE_USER" "$SERVICE_USER"
  else
    die "Weder useradd noch adduser gefunden."
  fi
}

ensure_dirs() {
  fs mkdir -p "$ROOT$DATA_DIR" "$ROOT$CONF_DIR"
  sys chown "$SERVICE_USER:$SERVICE_USER" "$ROOT$DATA_DIR"
  fs chmod 750 "$ROOT$DATA_DIR"
}

put_file() {
  fs cp "$1" "$ROOT$2.new"
  fs chmod "$3" "$ROOT$2.new"
  fs mv -f "$ROOT$2.new" "$ROOT$2"
}

write_config() {
  if [ -f "$ROOT$CONF_FILE" ]; then
    current=$(sed -n 's/^VIBE_AGENT_PORT=//p' "$ROOT$CONF_FILE" | tail -n 1)
    PORT="${current:-$DEFAULT_PORT}"
    if [ -n "$PORT_ARG" ] && [ "$PORT_ARG" != "$PORT" ]; then
      grep -v '^VIBE_AGENT_PORT=' "$ROOT$CONF_FILE" >"$TMP/agent.env" || true
      printf 'VIBE_AGENT_PORT=%s\n' "$PORT_ARG" >>"$TMP/agent.env"
      put_file "$TMP/agent.env" "$CONF_FILE" 644
      PORT="$PORT_ARG"
      UNIT_CHANGED=1
      ok "Port auf $PORT geändert"
    fi
    return 0
  fi
  PORT="${PORT_ARG:-$DEFAULT_PORT}"
  cat >"$TMP/agent.env" <<EOF
VIBE_AGENT_DATA_DIR=$DATA_DIR
VIBE_AGENT_PORT=$PORT
VIBE_AGENT_BIND=0.0.0.0
EOF
  put_file "$TMP/agent.env" "$CONF_FILE" 644
  ok "Einstellungen: $CONF_FILE"
}

write_unit() {
  cat >"$TMP/vibe-agent.service" <<EOF
[Unit]
Description=Vibe Server Agent
Documentation=$DOCS_URL
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=-$CONF_FILE
Environment=VIBE_AGENT_DATA_DIR=$DATA_DIR
WorkingDirectory=$DATA_DIR
ExecStart=$BIN_PATH run
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=90
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
  if [ -f "$ROOT$UNIT_PATH" ] && cmp -s "$TMP/vibe-agent.service" "$ROOT$UNIT_PATH"; then
    UNIT_CHANGED=0
    return 0
  fi
  fs mkdir -p "$ROOT$(dirname "$UNIT_PATH")"
  put_file "$TMP/vibe-agent.service" "$UNIT_PATH" 644
  UNIT_CHANGED=1
}

service_active() {
  [ "$DRY_RUN" = 1 ] && return 1
  systemctl is-active --quiet vibe-agent.service
}

as_agent() {
  if [ "$DRY_RUN" = 1 ]; then
    env VIBE_AGENT_DATA_DIR="$ROOT$DATA_DIR" VIBE_AGENT_PORT="$PORT" "$ROOT$BIN_PATH" "$@"
  elif [ "$(id -u)" = 0 ] && has runuser; then
    runuser -u "$SERVICE_USER" -- env VIBE_AGENT_DATA_DIR="$DATA_DIR" VIBE_AGENT_PORT="$PORT" "$BIN_PATH" "$@"
  elif has sudo; then
    sudo -u "$SERVICE_USER" env VIBE_AGENT_DATA_DIR="$DATA_DIR" VIBE_AGENT_PORT="$PORT" "$BIN_PATH" "$@"
  else
    env VIBE_AGENT_DATA_DIR="$DATA_DIR" VIBE_AGENT_PORT="$PORT" "$BIN_PATH" "$@"
  fi
}

activate_binary() {
  fs mv -f "$STAGED" "$ROOT$BIN_PATH"
  STAGED=""
  ok "Programm: $BIN_PATH"
}

install_with_systemd() {
  was_active=0
  if service_active; then
    was_active=1
  fi
  if [ "$BIN_CHANGED" = 1 ]; then
    if [ "$was_active" = 1 ]; then
      step "Stoppe den laufenden Agent (Minecraft-Server werden sauber beendet) …"
      sys systemctl stop vibe-agent.service
    fi
    activate_binary
  else
    ok "Programm ist schon aktuell ($NEW_VERSION)"
  fi
  write_unit
  if [ "$UNIT_CHANGED" = 1 ]; then
    sys systemctl daemon-reload
  fi
  sys systemctl enable vibe-agent.service >/dev/null 2>&1 || sys systemctl enable vibe-agent.service
  if [ "$BIN_CHANGED" = 1 ] || [ "$UNIT_CHANGED" = 1 ] || [ "$was_active" = 0 ]; then
    step "Starte den Dienst vibe-agent …"
    sys systemctl restart vibe-agent.service
  fi
  wait_ready
}

wait_ready() {
  tries=0
  while [ "$tries" -lt 30 ]; do
    if as_agent status >/dev/null 2>&1; then
      RUNNING=1
      ok "Agent läuft"
      return 0
    fi
    tries=$((tries + 1))
    sleep 1
  done
  warn "Der Agent antwortet noch nicht. Log ansehen: sudo journalctl -u vibe-agent -n 50 --no-pager"
}

install_without_systemd() {
  if [ "$BIN_CHANGED" = 1 ]; then
    activate_binary
  fi
  warn "Kein systemd gefunden – der Agent wurde nicht als Dienst eingerichtet."
  say "  Manuell starten:  sudo -u $SERVICE_USER env VIBE_AGENT_DATA_DIR=$DATA_DIR $BIN_PATH run"
  say "  Oder Docker nutzen (startet automatisch): $DOCS_URL#docker"
}

do_pair() {
  [ "$PAIR" = 1 ] || return 0
  [ "$RUNNING" = 1 ] || return 0
  if PAIR_OUTPUT=$(as_agent pair 2>&1); then
    return 0
  fi
  warn "Kopplungscode konnte nicht erzeugt werden: $PAIR_OUTPUT"
  PAIR_OUTPUT=""
}

local_ip() {
  ip_addr=""
  if has ip; then
    ip_addr=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1)
  fi
  if [ -z "$ip_addr" ] && has hostname; then
    ip_addr=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  printf '%s' "${ip_addr:-<Server-IP>}"
}

firewall_hint() {
  fw=""
  if has ufw && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    fw=ufw
  elif has firewall-cmd && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    fw=firewalld
  fi
  say ""
  say "${B}Firewall${N} (es wurde nichts geöffnet):"
  say "  Über die Vibe-Verbindung brauchst du keine Portfreigabe."
  say "  Für die direkte Verbindung (Launcher/Panel) und Spieler ohne Vibe-Tunnel:"
  case "$fw" in
    ufw)
      say "    sudo ufw allow $PORT/tcp"
      say "    sudo ufw allow $MC_PORT/tcp"
      ;;
    firewalld)
      say "    sudo firewall-cmd --permanent --add-port=$PORT/tcp --add-port=$MC_PORT/tcp"
      say "    sudo firewall-cmd --reload"
      ;;
    *)
      say "    Ports $PORT/tcp (Agent) und $MC_PORT/tcp (Minecraft) freigeben."
      ;;
  esac
  say "  Bei Cloud-Anbietern (Hetzner, Oracle, AWS …) zusätzlich die Firewall im Webinterface prüfen."
}

summary() {
  addr=$(local_ip)
  line="────────────────────────────────────────────────────────────"
  say ""
  say "$G$line$N"
  if [ "$UPDATE" = 1 ]; then
    say "  ${B}Vibe Agent aktualisiert:${N} $NEW_VERSION"
  else
    say "  ${B}Vibe Agent installiert:${N} $NEW_VERSION"
  fi
  say ""
  if [ -n "$PAIR_OUTPUT" ]; then
    say "  ${B}Kopplungscode:${N}"
    printf '%s\n' "$PAIR_OUTPUT" | sed 's/^/    /'
    say ""
  elif [ "$PAIR" = 1 ]; then
    say "  Kopplungscode erzeugen:  sudo -u $SERVICE_USER env VIBE_AGENT_DATA_DIR=$DATA_DIR vibe-agent pair"
    say ""
  fi
  say "  ${B}Panel:${N}        https://$addr:$PORT"
  say "  ${B}Im Launcher:${N}  Server → Remote-Server hinzufügen → Adresse $addr:$PORT + Code"
  say "  ${D}Der Browser warnt beim ersten Öffnen (eigenes Zertifikat) – vergleiche den Fingerprint.${N}"
  say ""
  say "  Status:       sudo systemctl status vibe-agent"
  say "  Log:          sudo journalctl -u vibe-agent -f"
  say "  Update:       Befehl von eben erneut ausführen"
  say "  Entfernen:    curl -fsSL https://vibe.axolite.app/agent/install.sh | sh -s -- --uninstall"
  say "  Server-Daten: $DATA_DIR"
  say "$G$line$N"
}

uninstall() {
  step "Entferne den Vibe Agent …"
  if [ -f "$ROOT$UNIT_PATH" ]; then
    sys systemctl disable --now vibe-agent.service || true
    fs rm -f "$ROOT$UNIT_PATH"
    sys systemctl daemon-reload || true
  fi
  fs rm -f "$ROOT$BIN_PATH"
  ok "Dienst und Programm entfernt"
  if [ "$PURGE" = 1 ]; then
    fs rm -rf "$ROOT$DATA_DIR" "$ROOT$CONF_DIR"
    if id "$SERVICE_USER" >/dev/null 2>&1; then
      if has userdel; then
        sys userdel "$SERVICE_USER" || true
      elif has deluser; then
        sys deluser "$SERVICE_USER" || true
      fi
    fi
    ok "Daten ($DATA_DIR), Einstellungen und Benutzer $SERVICE_USER gelöscht"
  else
    say "Server-Daten und Einstellungen bleiben erhalten: $DATA_DIR, $CONF_DIR"
    say "Alles löschen: curl -fsSL https://vibe.axolite.app/agent/install.sh | sh -s -- --uninstall --purge"
  fi
}

cleanup() {
  if [ -n "$STAGED" ] && [ -f "$STAGED" ]; then
    $SUDO rm -f "$STAGED" || true
  fi
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then
    rm -rf "$TMP"
  fi
}

main() {
  parse_args "$@"
  setup_output
  detect_platform
  setup_privileges
  if [ "$MODE" = uninstall ]; then
    uninstall
    return 0
  fi
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/vibe-agent-install.XXXXXX")
  trap cleanup EXIT INT TERM
  resolve_tag
  download_binary
  ensure_user
  ensure_dirs
  write_config
  if [ "$HAS_SYSTEMD" = 1 ]; then
    install_with_systemd
  else
    install_without_systemd
  fi
  do_pair
  firewall_hint
  summary
}

main "$@"

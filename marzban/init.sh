#!/usr/bin/env bash
#
# Panel bootstrap. Runs as the `marzban-init` one-shot BEFORE the panel container, from the same
# image, on the same volume, and exits. Everything the operator would otherwise do by hand after the
# first boot happens here, exactly once, and is idempotent on every run after that.
#
# ## Why the order below is not negotiable
#
# Marzban parses XRAY_JSON at IMPORT time (app/xray/__init__.py: `config = XRayConfig(XRAY_JSON)` at
# module scope), and BOTH `alembic upgrade head` and `marzban-cli` import the whole `app` package to
# reach the database. So neither the migration nor the admin creation will run at all until a valid
# xray config exists on disk. Render first, migrate second, create admins third.
#
# ## Why the config is generated here and not committed
#
# The REALITY private key is a secret. Generating it on first boot and keeping it on the volume gives
# the same "pre-baked, never touched again" behaviour without putting a key in git. It is written
# once: a rerun that regenerated keys would invalidate every client already handed out.
#
# Set REALITY_PRIVATE_KEY in .env to pin a key you generated yourself instead.

set -euo pipefail

log() { printf 'marzban-init: %s\n' "$*"; }
die() {
	printf 'marzban-init: FATAL: %s\n' "$*" >&2
	exit 1
}

# ---------------------------------------------------------------------------------------------
# 0. Preflight
#
# The domain lives in four variables across one .env, and the app half of it is frozen into the
# image at build time (Dockerfile: vite inlines $env/static/private). A mismatch between the proxy's
# domain and the app's own idea of its URL is invisible until a real person hits a broken QR, so it
# is worth failing the deploy over.
# ---------------------------------------------------------------------------------------------

: "${APP_DOMAIN:?APP_DOMAIN is required}"
: "${SUB_DOMAIN:?SUB_DOMAIN is required}"
: "${MARZBAN_ADMIN_USERNAME:?MARZBAN_ADMIN_USERNAME is required}"
: "${MARZBAN_ADMIN_PASSWORD:?MARZBAN_ADMIN_PASSWORD is required}"
: "${XRAY_JSON:?XRAY_JSON is required}"

# Trailing slashes are legal in a URL and fatal in a string comparison.
strip_slash() { printf '%s' "${1%%/}"; }

[ "$(strip_slash "${PUBLIC_APP_URL:-}")" = "https://${APP_DOMAIN}" ] ||
	die "PUBLIC_APP_URL (${PUBLIC_APP_URL:-unset}) must be https://${APP_DOMAIN}"
[ "$(strip_slash "${MARZBAN_SUB_URL_PREFIX:-}")" = "https://${SUB_DOMAIN}" ] ||
	die "MARZBAN_SUB_URL_PREFIX (${MARZBAN_SUB_URL_PREFIX:-unset}) must be https://${SUB_DOMAIN}"
[ "$(strip_slash "${XRAY_SUBSCRIPTION_URL_PREFIX:-}")" = "https://${SUB_DOMAIN}" ] ||
	die "XRAY_SUBSCRIPTION_URL_PREFIX (${XRAY_SUBSCRIPTION_URL_PREFIX:-unset}) must be https://${SUB_DOMAIN}"

# passlib hands the password to bcrypt, which refuses anything longer. The failure would otherwise
# surface as a ValueError traceback halfway through this script.
[ "${#MARZBAN_ADMIN_PASSWORD}" -le 72 ] || die 'MARZBAN_ADMIN_PASSWORD must be at most 72 bytes (bcrypt limit)'

log "domains check out: app=${APP_DOMAIN} sub=${SUB_DOMAIN}"

# ---------------------------------------------------------------------------------------------
# 1. Xray config
# ---------------------------------------------------------------------------------------------

TEMPLATE="${XRAY_TEMPLATE:-/etc/marzban/xray_config.template.json}"
[ -f "$TEMPLATE" ] || die "template not found at $TEMPLATE"

mkdir -p "$(dirname "$XRAY_JSON")"

if [ -f "$XRAY_JSON" ]; then
	log "$XRAY_JSON already exists — keeping it, keys and all"
else
	log 'no xray config yet: generating REALITY keys and rendering the template'

	# xray v24.12.31 prints exactly two lines: "Private key: <k>" / "Public key: <k>", base64
	# RawURL (43 chars, no padding). Never pass --std-encoding: the config parser decodes
	# privateKey with RawURLEncoding and would reject a standard-base64 key.
	if [ -n "${REALITY_PRIVATE_KEY:-}" ]; then
		PRIVATE_KEY="$REALITY_PRIVATE_KEY"
		log 'using REALITY_PRIVATE_KEY from the environment'
	else
		PRIVATE_KEY="$(xray x25519 | sed -n 's/^Private key: //p')"
	fi
	[ -n "$PRIVATE_KEY" ] || die 'could not obtain a REALITY private key'

	# ALWAYS derived, never taken from a second variable. Marzban does not check that the pair
	# matches: a mismatched publicKey yields a running core, valid-looking links and clients that
	# can never connect, with no error logged anywhere.
	PUBLIC_KEY="$(xray x25519 -i "$PRIVATE_KEY" | sed -n 's/^Public key: //p')"
	[ -n "$PUBLIC_KEY" ] || die 'could not derive the REALITY public key from the private key'

	# Exactly 16 hex chars (8 bytes). Xray PANICS on anything longer than 16 — a Go index-out-of-
	# range, not a clean error — and rejects odd lengths.
	SHORT_ID="${REALITY_SHORT_ID:-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')}"

	# python3 rather than sed: the substitutions land in typed JSON positions (port is a number,
	# serverNames is an array) and a text template that has to stay valid JSON cannot express that.
	REALITY_PORT="${REALITY_PORT:-8443}" \
		REALITY_DEST="${REALITY_DEST:-gateway.icloud.com:443}" \
		REALITY_SERVER_NAMES="${REALITY_SERVER_NAMES:-gateway.icloud.com}" \
		PRIVATE_KEY="$PRIVATE_KEY" PUBLIC_KEY="$PUBLIC_KEY" SHORT_ID="$SHORT_ID" \
		TEMPLATE="$TEMPLATE" TARGET="$XRAY_JSON" \
		python3 <<-'PY'
			import json, os

			with open(os.environ['TEMPLATE']) as f:
			    config = json.load(f)

			inbound = config['inbounds'][0]
			inbound['port'] = int(os.environ['REALITY_PORT'])

			reality = inbound['streamSettings']['realitySettings']
			reality['dest'] = os.environ['REALITY_DEST']
			# Exact strings — this Xray build looks server names up in a map, so no wildcards.
			reality['serverNames'] = [n.strip() for n in os.environ['REALITY_SERVER_NAMES'].split(',') if n.strip()]
			reality['privateKey'] = os.environ['PRIVATE_KEY']
			reality['publicKey'] = os.environ['PUBLIC_KEY']
			reality['shortIds'] = [os.environ['SHORT_ID']]

			target = os.environ['TARGET']
			with open(target, 'w') as f:
			    json.dump(config, f, indent=2)
			    f.write('\n')
			os.chmod(target, 0o600)
			print(f"marzban-init: wrote {target} (port {inbound['port']}, dest {reality['dest']})")
		PY
fi

# A config Xray refuses is an import-time crash in the panel, i.e. a container that never serves
# HTTP and only leaves a traceback in the log. Catching it here turns that into a readable failure
# of a one-shot that nothing else has started behind yet.
log 'validating the rendered config with xray'
xray run -test -c "$XRAY_JSON" || die "xray rejected $XRAY_JSON (see the output above)"

# The tag the app sends must byte-match a tag in this file, spaces included, or every POST /api/user
# comes back 422 — which the job queue then retries five times and gives up on, long after the money
# was taken. MARZBAN_INBOUND_TAGS is the app's side of that contract, so compare the two here.
XRAY_JSON="$XRAY_JSON" TAGS="${MARZBAN_INBOUND_TAGS:-}" python3 <<-'PY' || die 'inbound tag mismatch'
	import json, os, sys

	with open(os.environ['XRAY_JSON']) as f:
	    config = json.load(f)

	present = {i.get('tag') for i in config['inbounds']}
	wanted = [t.strip() for t in os.environ['TAGS'].split(',') if t.strip()]
	missing = [t for t in wanted if t not in present]

	if missing:
	    print(f"marzban-init: MARZBAN_INBOUND_TAGS names {missing} but the config has {sorted(present)}", file=sys.stderr)
	    sys.exit(1)
	print(f'marzban-init: inbound tags match: {wanted}')
PY

# ---------------------------------------------------------------------------------------------
# 2. Database
#
# The image's own CMD runs `alembic upgrade head; python main.py` with a semicolon, so a failed
# migration is swallowed and the panel starts against a stale schema. Running it here instead makes
# the failure fatal, and `service_completed_successfully` keeps the panel and this one-shot from
# ever holding the same SQLite file open at once.
# ---------------------------------------------------------------------------------------------

log 'applying panel migrations'
alembic upgrade head

# ---------------------------------------------------------------------------------------------
# 3. Admins
#
# Two accounts, deliberately: a sudo one for the operator's dashboard (reachable only through an SSH
# tunnel) and a non-sudo one for the app. CLAUDE.md 2 — handing the app a superadmin token makes
# every app-side bug a panel-wide one.
#
# SUDO_USERNAME/SUDO_PASSWORD are NOT used for this. Those grant a sudo login that exists only in
# the environment, with no database row: it cannot be revoked from the panel, and any VPN user
# created through it is stored with admin_id NULL.
# ---------------------------------------------------------------------------------------------

# `marzban-cli` exits 255 with `Admin "x" already exists!` on stderr, and 255 for real failures too.
# Only the message separates them, so it is what we match on.
create_admin() {
	local username="$1" sudo_flag="$2" password="$3" output status

	set +e
	output="$(MARZBAN_ADMIN_PASSWORD="$password" marzban-cli admin create \
		--username "$username" "$sudo_flag" --telegram-id 0 --discord-webhook "" 2>&1)"
	status=$?
	set -e

	if [ "$status" -eq 0 ]; then
		log "created admin ${username} (${sudo_flag})"
	elif printf '%s' "$output" | grep -q 'already exists'; then
		log "admin ${username} already exists — left untouched"
	else
		printf '%s\n' "$output" >&2
		die "could not create admin ${username} (exit ${status})"
	fi
}

create_admin "$MARZBAN_ADMIN_USERNAME" --no-sudo "$MARZBAN_ADMIN_PASSWORD"

if [ -n "${MARZBAN_SUDO_USERNAME:-}" ] && [ -n "${MARZBAN_SUDO_PASSWORD:-}" ]; then
	[ "${#MARZBAN_SUDO_PASSWORD}" -le 72 ] || die 'MARZBAN_SUDO_PASSWORD must be at most 72 bytes (bcrypt limit)'
	[ "$MARZBAN_SUDO_USERNAME" != "$MARZBAN_ADMIN_USERNAME" ] ||
		die 'MARZBAN_SUDO_USERNAME and MARZBAN_ADMIN_USERNAME must differ — the app must not hold a sudo account'
	create_admin "$MARZBAN_SUDO_USERNAME" --sudo "$MARZBAN_SUDO_PASSWORD"
else
	log 'no MARZBAN_SUDO_USERNAME/PASSWORD set — skipping the dashboard admin'
fi

# ---------------------------------------------------------------------------------------------
# 4. Advisory checks
#
# Neither of these should stop a deploy, and both are silent in production if left unchecked.
# ---------------------------------------------------------------------------------------------

# An unreachable `dest` does not stop Xray: it starts, reports healthy, and fails every single
# client handshake with "REALITY: failed to dial dest". Nothing in the panel surfaces that.
DEST="${REALITY_DEST:-gateway.icloud.com:443}" python3 <<-'PY' || true
	import os, socket, sys

	host, _, port = os.environ['DEST'].rpartition(':')
	try:
	    socket.create_connection((host, int(port)), 5).close()
	    print(f'marzban-init: REALITY dest {host}:{port} is reachable')
	except OSError as exc:
	    print(f'marzban-init: WARNING: REALITY dest {host}:{port} is unreachable ({exc}). '
	          'Xray will start anyway and every client handshake will fail.', file=sys.stderr)
PY

# The default host row Marzban creates carries the literal {SERVER_IP}, resolved once at panel boot
# by an outbound call to api4.ipify.org / icanhazip / ifconfig.io. With egress blocked that silently
# falls back to 127.0.0.1 and every subscription link points at the client's own machine.
python3 <<-'PY' || true
	import socket, sys, urllib.request

	try:
	    ip = urllib.request.urlopen('http://api4.ipify.org/', timeout=5).read().decode().strip()
	    print(f'marzban-init: public IP resolves to {ip} — subscription links will use it')
	except Exception as exc:
	    print(f'marzban-init: WARNING: cannot resolve the public IP ({exc}). Marzban falls back to '
	          '127.0.0.1 and every subscription link will be broken. Check egress from this host.',
	          file=sys.stderr)
PY

log 'done'

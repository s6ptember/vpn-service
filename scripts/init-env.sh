#!/usr/bin/env bash
#
# Creates .env from .env.example and fills in everything a machine can generate: the session secret
# and both Marzban passwords. What it cannot know — the domain, the bot, the Stripe keys — is left
# as it is in the example, and the script prints exactly which lines still need a human.
#
# Refuses to touch an existing .env. That file is the deploy's only source of secrets, and half of
# it is already frozen into the built image; overwriting it silently would lock the app out of its
# own panel and out of every session cookie it has issued.
#
# Usage: scripts/init-env.sh

set -euo pipefail

# Before the first file is created, not after: .env and every .env.tmp below hold the session
# signing key and two panel passwords, and a `chmod` at the end would leave them world-readable for
# the whole run — and permanently if the run aborts partway.
umask 077

cd "$(dirname "$0")/.."

die() {
	printf 'init-env: %s\n' "$*" >&2
	exit 1
}

[ -f .env.example ] || die '.env.example not found — run this from the repository'
[ -f .env ] && die '.env already exists. Delete it yourself if you really mean to start over.'

command -v openssl >/dev/null 2>&1 || die 'openssl is required'

# 32 bytes of hex. config.ts rejects anything shorter than 64 characters, which is the same number
# said in the other unit.
SESSION_SECRET="$(openssl rand -hex 32)"
# Hex rather than base64 on purpose: these values travel through docker compose interpolation, where
# a `$` in a password is a substitution and quietly mangles the credential. Hex has no `$`.
# 24 bytes is 48 characters, comfortably under bcrypt's 72-byte ceiling.
MARZBAN_ADMIN_PASSWORD="$(openssl rand -hex 24)"
MARZBAN_SUDO_PASSWORD="$(openssl rand -hex 24)"

# `key=` only at the start of a line, and only the first occurrence: the example carries the same
# words inside comments, and awk keeps this readable where a sed pipeline would not.
fill() {
	awk -v key="$1" -v value="$2" '
		!done && index($0, key "=") == 1 { print key "=" value; done = 1; next }
		{ print }
	' "$3"
}

cp .env.example .env
for pair in \
	"SESSION_SECRET=$SESSION_SECRET" \
	"MARZBAN_ADMIN_PASSWORD=$MARZBAN_ADMIN_PASSWORD" \
	"MARZBAN_SUDO_PASSWORD=$MARZBAN_SUDO_PASSWORD"; do
	key="${pair%%=*}"
	value="${pair#*=}"
	fill "$key" "$value" .env >.env.tmp && mv .env.tmp .env
done

# It holds the session signing key and two panel passwords.
chmod 600 .env

cat <<'EOF'
init-env: wrote .env with a generated SESSION_SECRET and both Marzban passwords.

Still yours to fill in, and the deploy will refuse to start without them:

  APP_DOMAIN, SUB_DOMAIN, ACME_EMAIL   the two subdomains, with live A records
  PUBLIC_APP_URL                       https://<APP_DOMAIN>
  MARZBAN_SUB_URL_PREFIX               https://<SUB_DOMAIN>
  TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET
  ADMIN_CHAT_ID                        your own numeric Telegram id
  MARZBAN_SUDO_USERNAME                leave empty to skip the dashboard account
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RETURN_DEEPLINK

Then: docker compose build && docker compose up -d
EOF

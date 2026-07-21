#!/usr/bin/env bash
#
# The deploy. Use this instead of `docker compose build && docker compose up -d`, for two reasons
# that both fail silently otherwise.
#
# ## 1. A bare `docker compose build` ignores .env
#
# .dockerignore keeps .env out of the build context, and BuildKit deliberately keeps the contents of
# a `--mount=type=secret` out of the cache key. So an .env-only edit changes nothing BuildKit can
# see, the build is a cache hit, and the image keeps the OLD inlined secrets and the OLD domain —
# while every log line says the build succeeded. Rotating a Stripe key or changing the domain would
# appear to work and would not.
#
# Passing a hash of .env as a build arg makes the file part of the cache key, so the build rebuilds
# exactly when .env actually changed.
#
# ## 2. `docker compose ps` hides the one-shots
#
# All three one-shots have exited by the time anyone looks, and `ps` without `-a` lists running
# containers only. A marzban-check that failed — meaning payments will succeed and access will not
# be issued — looks identical to a deploy with no problems at all: absent.
#
# Usage: scripts/deploy.sh [--no-cache]

set -euo pipefail

cd "$(dirname "$0")/.."

log() { printf '\033[1mdeploy:\033[0m %s\n' "$*"; }
die() {
	printf 'deploy: FATAL: %s\n' "$*" >&2
	exit 1
}

[ -f .env ] || die '.env not found — run scripts/init-env.sh first'

# sha256sum on Linux, shasum on macOS. The deploy host is Linux; the fallback keeps the script
# usable from a workstation.
if command -v sha256sum >/dev/null 2>&1; then
	DOTENV_HASH="$(sha256sum .env | cut -c1-16)"
elif command -v shasum >/dev/null 2>&1; then
	DOTENV_HASH="$(shasum -a 256 .env | cut -c1-16)"
else
	die 'neither sha256sum nor shasum found'
fi
export DOTENV_HASH

log "building (.env fingerprint ${DOTENV_HASH})"
docker compose build "$@"

log 'starting the stack'
docker compose up -d

# The one-shots are the deploy's actual verdict. `wait` blocks until each has exited and returns its
# exit code, which is the difference between a deploy that reported success and a deploy that was
# successful.
log 'waiting for the one-shots'
STATUS=0
for service in app-migrate marzban-init marzban-check; do
	code=0
	docker compose wait "$service" >/dev/null 2>&1 || code=$?
	# `compose wait` returns the container's own exit code, so a non-zero here is the service's.
	if [ "$code" -eq 0 ]; then
		log "  ${service}: ok"
	else
		printf 'deploy:   %s: FAILED (exit %s)\n' "$service" "$code" >&2
		docker compose logs --tail 30 "$service" >&2
		STATUS=1
	fi
done

if [ "$STATUS" -ne 0 ]; then
	cat >&2 <<-'EOF'

		deploy: the stack is up but NOT verified. Until the failure above is fixed, a customer can
		pay and receive no access: the app takes money on its own, and provisioning is what needs
		the panel.
	EOF
	exit 1
fi

docker compose ps -a
log 'done — the app, the panel and the app-to-panel path all check out'

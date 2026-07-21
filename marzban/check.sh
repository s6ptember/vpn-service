#!/usr/bin/env bash
#
# Post-boot assertion. Runs as the `marzban-check` one-shot AFTER the panel reports healthy, from
# the same image, and exits.
#
# It answers the one question the healthcheck cannot: can the APPLICATION actually use this panel?
# The panel being up says nothing about whether the account exists, whether its password still
# matches, or whether the inbound the app names is one the panel serves. Every one of those failures
# surfaces as a 401 or a 422 on `subscription.provision` — i.e. after the customer has paid.
#
# It reads the CURRENT .env, while the app holds what was inlined into its image at build time.
# Those agree because scripts/deploy.sh rebuilds whenever .env changes (the DOTENV_HASH build arg);
# a deploy that skips the script can drift, and then this check is testing the wrong credentials.
#
# Nothing depends on this service: the app must survive a dead panel (jobs retry), so gating app
# startup on the panel would trade a recoverable outage for an unrecoverable one. Failure shows up
# as a non-zero one-shot — which is why scripts/deploy.sh waits on it rather than leaving it to
# `docker compose ps`, where an exited container is invisible without `-a`.

set -euo pipefail

: "${MARZBAN_API_URL:?MARZBAN_API_URL is required}"
: "${MARZBAN_ADMIN_USERNAME:?MARZBAN_ADMIN_USERNAME is required}"
: "${MARZBAN_ADMIN_PASSWORD:?MARZBAN_ADMIN_PASSWORD is required}"

MARZBAN_INBOUND_TAGS="${MARZBAN_INBOUND_TAGS:-}" python3 <<-'PY'
	import json, os, sys, time, urllib.error, urllib.parse, urllib.request

	BASE = os.environ['MARZBAN_API_URL'].rstrip('/')
	USERNAME = os.environ['MARZBAN_ADMIN_USERNAME']


	def fail(message):
	    print(f'marzban-check: FATAL: {message}', file=sys.stderr)
	    sys.exit(1)


	def token():
	    """The panel's token endpoint is an OAuth2 password form, not JSON."""
	    body = urllib.parse.urlencode({
	        'username': USERNAME,
	        'password': os.environ['MARZBAN_ADMIN_PASSWORD'],
	    }).encode()
	    request = urllib.request.Request(
	        f'{BASE}/api/admin/token',
	        data=body,
	        headers={'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json'},
	    )
	    with urllib.request.urlopen(request, timeout=10) as response:
	        return json.load(response)['access_token']


	# The panel is healthy but its first request can still land while alembic and the Xray core are
	# settling, and the JWT signing key is read from the database. Retry rather than flap the deploy.
	deadline = time.monotonic() + 60
	while True:
	    try:
	        access_token = token()
	        break
	    except urllib.error.HTTPError as exc:
	        if exc.code == 401:
	            fail(
	                f'the panel refused MARZBAN_ADMIN_USERNAME="{USERNAME}". The account does not exist '
	                'with this password.\n'
	                '  If you rotated MARZBAN_ADMIN_PASSWORD, do it in this order — the running app '
	                'still holds the OLD password, inlined at build time, and is provisioning fine '
	                'right now:\n'
	                '    1. docker compose build          (with the new .env; scripts/deploy.sh does this)\n'
	                '    2. docker compose stop marzban\n'
	                f'    3. docker compose run --rm marzban-init marzban-cli admin delete -u {USERNAME} -y\n'
	                '    4. docker compose up -d marzban-init && docker compose start marzban\n'
	                '  Deleting the admin before step 1 breaks a system that currently works.'
	            )
	        fail(f'POST /api/admin/token answered {exc.code}: {exc.read().decode()[:200]}')
	    except OSError as exc:
	        if time.monotonic() > deadline:
	            fail(f'the panel never answered at {BASE} within 60s ({exc})')
	        time.sleep(2)

	print(f'marzban-check: the app account "{USERNAME}" authenticates against {BASE}')


	def authorized(path):
	    request = urllib.request.Request(
	        f'{BASE}{path}',
	        headers={'authorization': f'Bearer {access_token}', 'accept': 'application/json'},
	    )
	    with urllib.request.urlopen(request, timeout=10) as response:
	        return json.load(response)


	# CLAUDE.md 2 requires the app to hold a NON-SUDO account. init.sh only sets --no-sudo when it
	# creates the row, and it treats "already exists" as success — so on any volume where this
	# username was ever created as sudo, the requirement silently does not hold. GET /api/admin
	# returns the caller's own record, so this is a direct check rather than an inference.
	try:
	    if authorized('/api/admin').get('is_sudo') is not False:
	        fail(
	            f'the app account "{USERNAME}" is a SUDO admin. CLAUDE.md 2 requires a non-sudo account: '
	            'a superadmin token makes every app-side bug a panel-wide one. Recreate it — '
	            f'`docker compose run --rm marzban-init marzban-cli admin delete -u {USERNAME} -y`, '
	            'then re-run marzban-init, which passes --no-sudo.'
	        )
	    print(f'marzban-check: "{USERNAME}" is non-sudo, as CLAUDE.md 2 requires')
	except urllib.error.HTTPError as exc:
	    fail(f'GET /api/admin answered {exc.code}: {exc.read().decode()[:200]}')

	# Best-effort: the tag the app sends has to exist as MARZBAN sees it, not merely as the config
	# file spells it. init.sh compares the file; this compares the running panel. Some builds keep
	# /api/inbounds behind sudo, so a 403 here is not a failure.
	wanted = [t.strip() for t in os.environ['MARZBAN_INBOUND_TAGS'].split(',') if t.strip()]
	if wanted:
	    try:
	        payload = authorized('/api/inbounds')
	        present = {inbound.get('tag') for group in payload.values() for inbound in group}
	        missing = [tag for tag in wanted if tag not in present]
	        if missing:
	            fail(
	                f'the panel serves inbounds {sorted(present)} but the app is configured for {missing}. '
	                'Every POST /api/user would answer 422 and no paid subscription would ever provision.'
	            )
	        print(f'marzban-check: inbound tags live in the panel: {wanted}')
	    except urllib.error.HTTPError as exc:
	        print(
	            f'marzban-check: skipped the inbound check, GET /api/inbounds answered {exc.code}',
	            file=sys.stderr,
	        )

	print('marzban-check: done')
PY

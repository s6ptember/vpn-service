#!/usr/bin/env bash
#
# Post-boot assertion. Runs as the `marzban-check` one-shot AFTER the panel reports healthy, from
# the same image, and exits.
#
# It answers the one question the healthcheck cannot: can the APPLICATION actually use this panel?
# The panel being up says nothing about whether the account the app was built with still exists with
# the password the app was built with. That pair drifts in exactly one situation — MARZBAN_ADMIN_
# PASSWORD is rotated in .env while the admin row keeps the old hash — and the symptom is a 401 on
# `subscription.provision`, which happens after the customer has already paid.
#
# Nothing depends on this service: the app must survive a dead panel (jobs retry), so gating app
# startup on the panel would trade a recoverable outage for an unrecoverable one. Failure shows up
# as a non-zero one-shot in `docker compose ps`.

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
	                'with this password. If you rotated MARZBAN_ADMIN_PASSWORD, the existing admin row '
	                'still holds the old one: delete it with '
	                f'`docker compose exec marzban marzban-cli admin delete -u {USERNAME}` and re-run '
	                '`docker compose up -d marzban-init`.'
	            )
	        fail(f'POST /api/admin/token answered {exc.code}: {exc.read().decode()[:200]}')
	    except OSError as exc:
	        if time.monotonic() > deadline:
	            fail(f'the panel never answered at {BASE} within 60s ({exc})')
	        time.sleep(2)

	print(f'marzban-check: the app account "{USERNAME}" authenticates against {BASE}')

	# Best-effort: the tag the app sends has to exist as MARZBAN sees it, not merely as the config
	# file spells it. init.sh compares the file; this compares the running panel. Some builds keep
	# /api/inbounds behind sudo, so a 403 here is not a failure.
	wanted = [t.strip() for t in os.environ['MARZBAN_INBOUND_TAGS'].split(',') if t.strip()]
	if wanted:
	    request = urllib.request.Request(
	        f'{BASE}/api/inbounds',
	        headers={'authorization': f'Bearer {access_token}', 'accept': 'application/json'},
	    )
	    try:
	        with urllib.request.urlopen(request, timeout=10) as response:
	            payload = json.load(response)
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

# syntax=docker/dockerfile:1.7

# One pinned base for both stages, never `latest` (tech.md 2 forbids it for Marzban; house style).
# This is load-bearing, not cosmetic: better-sqlite3 is a native module and the .node binary built
# in the builder is COPIED, not rebuilt. Runtime must therefore be the same node ABI and the same
# libc. A single ARG makes that a structural guarantee instead of two tags drifting apart.
# Alpine (musl) holds here because both stages share this value; node:22-bookworm-slim would only
# be needed if the runtime base differed from the builder's.
ARG NODE_IMAGE=node:22.22-alpine3.24

FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# better-sqlite3 publishes no musl prebuild, so prebuild-install falls through to node-gyp and it
# compiles from source. Without this toolchain `npm ci` fails on alpine.
RUN apk add --no-cache build-base python3

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# container.ts opens SQLite at module scope (`const db = createDb(config.DATABASE_PATH)`), and
# SvelteKit's postbuild `analyse` step imports the server bundle — so `vite build` genuinely
# connects to the database. better-sqlite3 refuses to create the parent directory, so without this
# the build dies with "Cannot open database because the directory does not exist".
RUN mkdir -p /data

# config.ts reads $env/static/private, and vite inlines those as string literals at BUILD time.
# Two consequences, both verified against @sveltejs/kit/src/core/env.js:
#   1. Without real values the build fails outright — the names are not exported at all.
#   2. Whatever is inlined here WINS FOREVER. env_file at runtime cannot override it.
# So .env must be present now, mounted as a BuildKit secret: it stays out of the layers and out of
# the build context. Build with:  docker compose build   (compose passes the secret; see the file)
# Trade-off the lead must accept: build/ ends up holding the secret values, which makes this image
# a secret-bearing artifact. Build it on the host that owns .env and never push it to a registry.
#
# The two inline vars are load-bearing and override the mounted .env. Vite's loadEnv applies
# process.env AFTER the .env file, so process.env wins — that is what makes this work:
#
#   NODE_ENV=production — .env carries NODE_ENV=development for local dev. Leaking that into the
#   image is a security hole, not an inefficiency: esm-env resolves DEV=true, and SvelteKit guards
#   its CSRF origin check with `if (!DEV)`, so the check is dead-code-eliminated out of the bundle.
#   Sessions are sameSite:'none' by necessity (tech.md 9), meaning the browser attaches the session
#   cookie to cross-site POSTs — the origin check is the only thing left stopping them. tech.md 9
#   requires it stay on. Set here, not via `ENV`, because `ENV NODE_ENV=production` would make the
#   `npm ci` above skip devDependencies and the build would fail with vite missing.
#
#   DATABASE_PATH — .env points at ./data/app.db for local dev. Inlined, that resolves to
#   /app/data/app.db inside the container: the app's writable layer, not the app-data volume that
#   app-migrate just migrated. The app would boot against an empty, table-less database and lose it
#   on every recreate. env_file cannot fix this after the fact; only the build-time value counts.
RUN --mount=type=secret,id=dotenv,target=/app/.env,required=true \
	NODE_ENV=production DATABASE_PATH=/data/app.db npm run build

# scripts/*.ts are TypeScript and import src/, while tsx is a devDependency that the prune below
# removes. Compiling them here beats keeping tsx at runtime: that would drag a bundler, its esbuild
# binary and the whole TypeScript source tree into production for one-shots that run for a second.
# Prod deps stay external and resolve from node_modules; only our own code is inlined.
# --no-install: esbuild is only a transitive dep (of vite and tsx), never a direct one. Without this
# flag a dependency bump that drops it turns into npx silently fetching an unpinned esbuild from the
# network into a build that has the real .env mounted. Fail loudly instead.
#
# seed.ts rides along for the `seed` compose profile (staging fixtures). It is never run in
# production — it inserts two fake users — but leaving it out of the image would mean a second build
# variant just for staging.
RUN npx --no-install esbuild scripts/migrate.ts scripts/seed.ts \
	--bundle --platform=node --format=esm --target=node22 \
	--packages=external --outdir=build-scripts

# Drops devDependencies while keeping the better_sqlite3.node compiled above.
RUN npm prune --omit=dev


FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Authoritative for build-scripts/migrate.js, which reads process.env directly. config.ts does not
# read this at runtime — its value was inlined at build time above, to the same path on purpose.
ENV DATABASE_PATH=/data/app.db

# Owned by `node` BEFORE the volume mounts. Docker seeds a fresh named volume from the image's
# mountpoint, ownership included; if /data only came into being at mount time it would be root:root
# and this container, which runs as `node`, could not write to it — app-migrate would die on
# SQLITE_CANTOPEN and take the whole stack's startup gate with it.
RUN mkdir -p /data && chown node:node /data

# node:*-alpine already ships an unprivileged `node` user; reusing it beats inventing one.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/build-scripts ./build-scripts
# migrate resolves its migrations folder as './drizzle', relative to this WORKDIR.
COPY --chown=node:node drizzle ./drizzle
# Carries "type": "module", without which build-scripts/migrate.js is parsed as CommonJS.
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# GET / renders the shell without a session by design (tech.md 9), so it probes liveness without a
# new route and without a contract. node's own fetch keeps curl out of the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/index.js"]

# Install and run

## Prerequisites

- **Node.js 20 or newer** (`node --version`). Node 24 also works.
- **npm** (ships with Node).
- Nothing else: no database server, no compilers, no build tools, no network
  access at runtime.

The app uses only Node built-in modules, so there is no third-party runtime
dependency and nothing to compile.

## 1. Install

From the project root:

```bash
sh install.sh
```

This runs `npm install` (the project declares no dependencies — this just
populates the lockfile artefacts), creates `data/`, and seeds the demo board.
It never starts the server and never needs `sudo`. Re-running it is safe: the
seed only inserts what is missing.

## 2. Seed (already done by step 1)

The install script runs the seed for you. To run it again on its own:

```bash
node seed.js
```

The seed writes `data/db.json` with 3 piers, 77 weekly crossings (including one
inactive sailing), 4 notices (3 published, 1 draft), 5 deck requests in mixed
states and the two staff accounts. The same seed runs automatically on the
server's boot path, so a fresh clone that skips this step still comes up
populated.

## 3. Run

```bash
node .
```

or the equivalent `npm start` (npm falls back to `node server.js` when no scripts are declared).

The server binds `0.0.0.0:3000` by default and prints:

```
Ferry Timetable Notice Board listening on 0.0.0.0:3000 — 3 piers, 77 crossings, 4 notices seeded.
```

Override the port with the `PORT` environment variable if 3000 is taken:

```bash
PORT=8080 node .
```

## 4. Sign in

Open <http://localhost:3000/login>.

| Email | Role | Password |
| ----- | ---- | -------- |
| cenius@cenius.ai | admin | cenius |
| demo@ferryboard.app | staff | FerryDemo123! |

The sign-in card lists both and can fill the form for you.

## 5. Tests

The project declares no npm scripts on purpose (`node .` is the whole start
command). Run the suite with Node's built-in test runner:

```bash
node --test tests/
```

This runs the `node:test` suite in `tests/`, which boots the server in-process
against a throwaway data directory.

## Optional configuration

Copy `.env.example` to `.env` if you want to change defaults — but note the
server reads settings from the process environment, so export them or use a
tool that does. Every setting has a working default; the app never requires a
`.env` file.

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Interface to bind |
| `SESSION_TTL_MINUTES` | `720` | Staff session lifetime |
| `DATA_DIR` | `./data` | Where `db.json` lives |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS so the session cookie gains `Secure` |
| `DEMO_STAFF_PASSWORD` | demo fallback | Password seeded for `cenius@cenius.ai` |
| `DEMO_ALT_STAFF_PASSWORD` | `FerryDemo123!` (demo fallback) | Password seeded for `demo@ferryboard.app` |

## Resetting the demo data

Stop the server and delete `data/db.json`; the next start recreates and re-seeds
it. Bookings, notices and crossings created through the app are lost with it.

## Troubleshooting

- **`EADDRINUSE` on start** — another process holds the port. Run
  `PORT=3001 node .` or stop the other process.
- **Node version error during install** — upgrade to Node 20 or newer.
- **Empty board** — delete `data/db.json` and restart; the seed repopulates on
  boot.

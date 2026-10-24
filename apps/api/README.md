# @av2i/api

The platform's server: accounts, sessions, IAM-style permissions and an audit log, backed by PostgreSQL. It also serves the built
studio. The design is [DD-021](../../docs/design/decisions.md).

## Run it

With Docker, from the repository root:

```bash
cp .env.example .env   # set POSTGRES_PASSWORD, optionally ADMIN_INITIAL_PASSWORD
docker compose up -d
```

Open `http://localhost:3000` and sign in as `admin` / `admin` (or the password you set in `ADMIN_INITIAL_PASSWORD`). You are asked to
change the password before anything else works.

For development you need a PostgreSQL and Node 24 or later (it runs the `.ts` files directly):

```bash
docker run -d --name av2i-pg -e POSTGRES_USER=av2i -e POSTGRES_PASSWORD=av2i -e POSTGRES_DB=av2i -p 127.0.0.1:55432:5432 postgres:18
DATABASE_URL=postgres://av2i:av2i@127.0.0.1:55432/av2i pnpm api     # the API on :3000
pnpm studio                                                          # the studio on :5173, proxying /api to :3000
```

## Settings (environment)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | where it listens |
| `ADMIN_INITIAL_PASSWORD` | `admin` | password of `admin` on the first start of an empty database |
| `SESSION_IDLE_MINUTES` | `480` | a session ends after this long without use |
| `SESSION_MAX_HOURS` | `168` | a session ends this long after sign in, used or not |
| `STATIC_DIR` | unset | folder with the built studio (the image sets it) |
| `TRUST_PROXY` | `false` | read the client address and protocol from `X-Forwarded-*`; set it behind a reverse proxy that does HTTPS |

Put a reverse proxy with HTTPS in front of any installation others can reach: the password travels in the sign in request.

## Tests

The tests create a throwaway database in a PostgreSQL they can reach (`TEST_DATABASE_URL`, by default the `av2i-pg` container above)
and drop it afterwards. When no PostgreSQL answers, the API tests are skipped with a warning.

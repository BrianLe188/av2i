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
cp .env.example .env     # DATABASE_URL already points at the container above
pnpm run api             # the API on :3000; it reads .env at the repository root
pnpm studio              # the studio on :5173, proxying /api to :3000
```

## Settings (environment)

The API reads `.env` at the repository root if it exists (`.env` is not committed). A variable set in the shell wins over the file.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | where it listens |
| `ADMIN_INITIAL_PASSWORD` | `admin` | password of `admin` on the first start of an empty database |
| `SESSION_IDLE_MINUTES` | `480` | a session ends after this long without use |
| `SESSION_MAX_HOURS` | `168` | a session ends this long after sign in, used or not |
| `STATIC_DIR` | unset | folder with the built studio (the image sets it) |
| `TRUST_PROXY` | `false` | read the client address and protocol from `X-Forwarded-*`; set it behind a reverse proxy that does HTTPS |
| `STATE_ENCRYPTION_KEY` | unset | 32 random bytes in base64 (`openssl rand -base64 32`) that encrypt OpenTofu state and stored plans. Without it runs are refused. Keep a copy: state cannot be read without it |
| `TOFU_BIN` | `tofu` | the OpenTofu binary (the image has it) |
| `RUN_WITH_SERVER_IDENTITY` | `false` | development only: a project with no AWS connection runs with the server's own `AWS_*` |
| `RUN_TIMEOUT_MINUTES` | `30` | a run that takes longer is stopped (55 at most: assumed-role keys last an hour) |
| `RUN_WORKERS` | `2` | how many runs may work at once; each project runs one at a time |
| `RUNS_DIR` | system temp folder | temporary folders of runs and the provider cache |
| `RUNNER_API_URL` | `http://127.0.0.1:<PORT>` | how the tofu process reaches this server's state backend |

The server's own AWS identity (an instance role or container role on AWS; elsewhere `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of an IAM user
that may only call `sts:AssumeRole`) is used for one thing: to assume the role of a project's AWS connection (DD-025). The tofu process gets only the
temporary keys of that role, never the server's own, and nothing else of the server's environment (DD-023).

Put a reverse proxy with HTTPS in front of any installation others can reach: the password travels in the sign in request.

## Calling the API from a script

Make a token on the account page (Token API), then send it as a bearer secret; no cookie and no `X-Requested-With` header are needed.

```bash
curl -H "Authorization: Bearer $AV2I_TOKEN" http://localhost:3000/api/projects
```

A token has the rights of the person who made it, or fewer if it was given a scope. It cannot create tokens or change the password.

## Tests

The tests create a throwaway database in a PostgreSQL they can reach (`TEST_DATABASE_URL`, by default the `av2i-pg` container above)
and drop it afterwards. When no PostgreSQL answers, the API tests are skipped with a warning.

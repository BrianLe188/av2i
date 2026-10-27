# Apply with approval (R2b)

Status: decided (owner, 27 October 2026: all eight questions answered as recommended). Part of DD-023 (see DD-026 in `decisions.md`). Builds on R1 (plans,
state) and R2a (connections, DD-025).

R1 and R2a can plan. R2b is the first step that **changes AWS**: it applies exactly the plan a person looked at, keeps the state right
when something goes wrong, and makes sure a risky plan needs more than one click.

## 1. What the user sees

1. **Plan** as today. A plan that succeeded shows what it will do and, below it, an **Apply** panel.
2. The panel says in words whether the plan can be applied now, or why not ("the design changed after this plan: run a plan again").
3. **Approval.** By default the person who presses *Apply* is the approver (needs `run:Apply`). If the project asks for **two people**, someone
   else with `run:Approve` presses *Approve* first; only then *Apply* opens (for anyone with `run:Apply`, the planner included).
4. **A plan that deletes or replaces anything** shows a red box naming those resources, and *Apply* asks for the project name to be typed. It
   needs `run:ApplyDestructive` as well; without it the button is closed and says why.
5. **Apply** is a run like a plan: queued, running, a live log, then "N added, N changed, N destroyed". Its connection is the plan's, and it
   assumes the connection's **apply role**.
6. A plan can be applied **once**, within 24 hours, while nothing it depends on has changed. After that: *Run plan again*.
7. **If an apply created things but the state could not be saved**, the run is red with "resources were created but the state was not saved",
   the project is **locked against new runs**, and the panel offers *Restore into state* and *Download*.

## 2. When a plan may be applied

A plan run (`kind = plan`, `status = succeeded`, plan file stored) can be applied only when **all** hold; the server checks every one when
the request arrives, and the studio shows the same list beforehand (`blockers`):

| Code | Condition |
|---|---|
| `already_applied` | no apply run of this plan is queued, running or succeeded (one per plan, enforced by a unique index) |
| `plan_expired` | the plan finished less than 24 hours ago |
| `design_changed` | the Terraform files the project's design generates now hash like the ones the plan was made from |
| `variables_changed` | the stamp of the variables (DD-024) is the one the plan was queued with |
| `connection_changed` | the project's connection is the plan's connection |
| `no_apply_role` | that connection has an apply role |
| `state_changed` | the newest state serial is the one seen at plan time (OpenTofu checks this too and refuses a stale plan file) |
| `rescue_pending` | the project has no unresolved state rescue (section 6) |
| `not_approved` | with two people required, someone other than the planner approved |
| `confirm_required` | for a destructive plan, the typed name equals the project's name |
| `forbidden` | `run:Apply`, and `run:ApplyDestructive` when destructive (and a **session**, see 9) |

**The design hash changes meaning.** R1 hashed the design JSON, which includes node positions: moving a box would make a plan stale. From
R2b a run also stores `files_hash`, the hash of the generated `.tf` files (sorted names and contents); that is what "the design changed"
means. `design_hash` stays for the record.

## 3. How apply runs

An apply is a run row of its own, `kind = apply`, pointing at its plan (`plan_run_id`), queued and taken by the same workers (one run per
project at a time, so an apply never overlaps a plan).

```
claim ─▶ assume the connection's APPLY role ─▶ write the plan's files (from the plan run's stored design) and backend.tf
      ─▶ write plan.bin (decrypted) ─▶ tofu init ─▶ tofu apply -input=false -no-color -lock=true plan.bin
      ─▶ read the result ─▶ finish (see 5, 6) ─▶ delete the folder
```

- The files come from the **plan run's own design copy**, after the `design_changed` check; the plan file is applied with exactly the
  configuration it was made from. No `TF_VAR` is given: a saved plan already holds the values (and the variables stamp has been checked).
- State is read and written through the same `http` backend as before.
- The summary of an apply is read from OpenTofu's last line (`Apply complete! Resources: …`) and kept in `runs.summary`.
- **Apply cannot be cancelled** once running (stopping it half way is the dangerous thing); a queued apply can.

## 4. Time, shutdown and the one-hour limit

- **Time limit.** `RUN_APPLY_TIMEOUT_MINUTES`, 55 by default (not above 55: the keys of an assumed role last an hour). A plan keeps
  `RUN_TIMEOUT_MINUTES` (30).
- **A stopped apply is stopped gently.** At the limit the process gets `SIGINT` (OpenTofu finishes what is in flight and writes the state);
  only after a **grace of 5 minutes** is it killed. A plan keeps 10 seconds.
- **Server shutdown.** `docker stop` and `SIGTERM` wait for a running apply to finish; the compose file gets `stop_grace_period: 10m`, and the
  README says that a shorter value risks killing an apply. After the grace period the platform is killed and the next start treats the run as
  interrupted (below).
- **Longer than an hour.** An apply that needs more than the keys last (a big CloudFront or RDS design) will fail half way. That is a known limit
  of assuming a role from a role; refreshing the keys during a run is future work (it needs a credential helper for the provider).

## 5. Checking state writes (the serial and lineage rules)

OpenTofu checks lineage and serial itself. The platform now checks them too, because it is the only place that sees every writer. A `POST` of a
state is refused unless:

1. the run is an **apply** (a plan never writes: 403 `plan_cannot_write`), and its secret is valid;
2. the **lock is held** by this run (`lock_required` / 423 otherwise): `state_locks` gets `run_id`;
3. the **lineage** equals the lineage of the newest stored state (409 `lineage_mismatch`); the first write of a project sets it;
4. the **serial** is greater than the newest one (409 `serial_regressed`). Equal is accepted only when the content is identical (a retried
   request: answered 200 and nothing is stored again); equal with other content is 409 `serial_conflict`.

The version row now takes its `run_id` from the run that signed in (not "the running run of the project").

## 6. `errored.tfstate`: never lose what an apply created

When OpenTofu applied something but its write to the backend failed (an error from 5, a stopped database), it leaves `errored.tfstate` in its
folder. The runner deletes the folder at the end, so today that file would be lost with the only record of what was created.

- **Before the folder goes**, an apply run looks for `errored.tfstate`. If it is there:
  1. it is sealed with the state key and stored in a new table `state_rescues` (project, run, serial, lineage, the sealed state);
  2. if the database cannot take it, it is written sealed to `RUNS_DIR/rescue/<run>.tfstate` (never swept) and the log says where;
  3. the run is marked `failed` with a message that says resources were created and the state was not saved.
- **Folders get the run's id** in their name (`run-<run id>-xxxxxx`), so that after a crash the startup sweep can salvage an `errored.tfstate`
  into `state_rescues` before it deletes the folder, instead of deleting it.
- **A project with an unresolved rescue cannot start any run** (`rescue_pending`): planning without that state would try to create everything
  again and fail with "already exists".
- **Resolving it** (new action `state:Write`, session only, audited):
  - *Restore*: the rescued state becomes a new version if lineage matches and its serial is greater than the newest; otherwise the person is
    told why and can only download it.
  - *Download* (needs `state:Read`): the plain state file, audited (`state.rescue_downloaded`), to import by hand.
  - *Dismiss*: the person types the project name; the rescue stays stored but no longer blocks.
- A server restart during an apply marks the run `interrupted` with a message about the possible loss of state, keeps the lock released as today,
  and the project gets a **warning** that a plan is needed first (it will show what happened).

## 7. Data

Migration `0007_apply.sql`:

```sql
alter table runs add column plan_run_id uuid references runs (id) on delete set null;   -- an apply's plan
alter table runs add column files_hash text;                                              -- of the generated .tf files
create unique index runs_one_apply_per_plan on runs (plan_run_id)
  where kind = 'apply' and status in ('queued', 'running', 'succeeded');

create table run_approvals (
  run_id uuid not null references runs (id) on delete cascade,     -- the plan run
  user_id uuid references users (id) on delete set null,
  username text not null,
  at timestamptz not null default now(),
  primary key (run_id, username)
);

alter table projects add column require_approval boolean not null default false;
alter table state_locks add column run_id uuid references runs (id) on delete set null;

create table state_rescues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  run_id uuid references runs (id) on delete set null,
  serial integer not null,
  lineage text not null,
  key_id text not null, nonce bytea not null, data bytea not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz, resolved_by uuid references users (id) on delete set null,
  resolution text check (resolution in ('restored', 'dismissed'))
);
```

`runs.kind` already allows `apply` (migration 0004). `runs.status` gets `interrupted` (check constraint widened). Approvals are by name so they
survive the removal of an account.

## 8. API

| Call | Needs | Notes |
|---|---|---|
| `POST /api/runs/:id/apply` body `{confirmName?}` | `run:Apply` (+ `run:ApplyDestructive`), session | creates the apply run (201) or answers 409 with `code` and all `blockers` |
| `POST /api/runs/:id/approve` | `run:Approve`, session | on a plan run; with two people required the approver must not be the planner (`self_approval`) |
| `DELETE /api/runs/:id/approve` | session | takes back one's own approval |
| `GET /api/runs/:id` | `project:Read` | a plan now has `apply: { blockers, needsApproval, destructive, expiresAt, approvals[] }` and `can: { approve, apply, applyDestructive }`; an apply has `planRunId` |
| `PUT /api/projects/:id/settings` body `{requireApproval}` | `project:Share` | switching it off is the same permission as switching it on |
| `GET /api/projects/:id/state-rescues` | `state:Read` | no state in the answer |
| `GET /api/state-rescues/:id/download` | `state:Read`, session | the state file; audited |
| `POST /api/state-rescues/:id/restore` | `state:Write`, session | checks lineage and serial; 409 with the reason |
| `POST /api/state-rescues/:id/dismiss` body `{confirmName}` | `state:Write`, session | |
| `POST /api/projects/:id/runs` | as before | also refuses with `rescue_pending` |
| `POST|GET /api/state/:id` | run secret | the checks of section 5 |

Audit: `run.apply_queued`, `run.approved`, `run.approval_withdrawn`, `run.apply_finished` (counts), `project.settings_changed`,
`state.rescued`, `state.rescue_restored`, `.rescue_dismissed`, `.rescue_downloaded`. Never a state, a plan or a secret.

## 9. Who may do what

New action **`state:Write`** (on a project). `run:Approve`, `run:Apply`, `run:ApplyDestructive` and `state:Read` exist (DD-023). The owner has
Plan, Approve, Apply, `state:Read` and `variable:Write`; **not** `ApplyDestructive` and not `state:Write`: those come by policy.

**Apply, approve, restore and dismiss are for a person at the keyboard**: they need a session, an API token is refused (`session_required`), like
changing a password. A leaked CI token cannot change infrastructure. (Allowing a scoped token for CI is a later, separate decision.)

## 10. Studio

- The Plan dialog's run view gets an **Apply panel** under the summary: the blockers in words, the approvals ("approved by Binh, 14:02"),
  the buttons *Approve* / *Withdraw* / *Apply* (or *Approve and apply* when one person decides), the expiry ("valid until 14:30 tomorrow"),
  and a *Run plan again* when it is stale or expired.
- A **destructive** plan: the resources that go are listed in red; *Apply* opens a confirmation with the typed project name.
- The run list shows *Plan* and *Apply* badges; an apply links to its plan. After a successful apply the summary says
  "N added, N changed, N destroyed".
- A **rescue banner** on a project with an unresolved rescue (in the dialog and at the top of the canvas): what happened, *Restore*, *Download*,
  *Dismiss*.
- A small **settings** row in the dialog for people who may share the project: *Two people must approve*.
- Vietnamese and English like the rest.

## 11. Code

- `runs/apply.ts`: `applyBlockers(...)` (one function used by the request and by `GET /api/runs/:id`), `filesHash(design)`.
- `runs/runner.ts`: the apply path, gentle stop with a long grace, the folder name with the run id, rescue of `errored.tfstate`, the apply
  summary; `runs/rescue.ts`: store, restore, dismiss, startup salvage; `runs/queue.ts`: nothing but the new kind.
- `routes/state.ts`: the checks of section 5 and the run identity from the secret; `routes/runs.ts`: apply, approve, the detail of a plan;
  `routes/rescues.ts`; the project settings route.
- `packages/authz`: `state:Write`. `compose.yaml`: `stop_grace_period`. README: the two time limits, shutdown.
- Studio: `ApplyPanel`, `RescueBanner`, the dialog and the run list.

## 12. Tests

- Pure: `applyBlockers` for every code; `filesHash` ignores node positions and changes with a generated resource.
- State routes: no write for a plan run; write without the lock; lineage mismatch; serial lower, equal-identical, equal-different; the first
  write; the run id on the version.
- Apply API with the fake tofu: every blocker; destructive needs the permission and the typed name; four-eyes (planner cannot approve,
  another can, withdraw); one apply per plan (a second request is refused while the first is queued, running or done); a token is refused;
  the apply run uses the apply role (fake gateway); an apply of a plan-only connection is refused.
- Rescue: a fake tofu that leaves `errored.tfstate` → stored sealed, run failed, project locked, restore checks, download audited,
  dismiss needs the name; the startup salvage finds a folder by run id; the file fallback when the database refuses.
- Real OpenTofu through Moto (manual, as before): plan, apply, plan again shows **no changes** (proves the state), change the design a little and
  see only that in the plan, remove a resource and see the destructive guard. The rescue is provoked for real without any fault switch: store a
  state with another lineage first, so that the server refuses OpenTofu's write and OpenTofu leaves `errored.tfstate`.
- Moto does not implement every service (no CloudFront, RDS only in part): the real check uses the VPC and EC2 sample.

## 13. Not in R2b

`destroy`; applying with an API token (CI); refreshing assumed-role keys during a long apply; a state viewer and history screen (R3); the S3
backend (R3); drift reports; `moved` blocks for the address change of DD-022 (a destructive plan will show it; see question 8); a least-privilege
apply policy (R2a note).

## 14. Questions for the owner (all answered as recommended)

1. **Apply, approve and restore need a person's session, not an API token** (recommended)?
2. **Switching "two people" on or off needs `project:Share`** (owner-level) (recommended)?
3. **Apply time limit 55 minutes with a 5 minute graceful stop**, shutdown waits for it, `stop_grace_period: 10m` (recommended)?
4. **A project with an unresolved state rescue cannot start any run** (recommended)?
5. **"The design changed" is judged by the hash of the generated files**, so moving a box does not make a plan stale (recommended)?
6. **A new action `state:Write`** for restoring or dismissing a rescue, not given to the owner by default (recommended)?
7. **One person: the click on Apply is the approval. Two people: someone else approves first, then anyone with `run:Apply` applies** (recommended)?
8. **`moved` blocks for the DD-022 address change: not in R2b, as its own piece afterwards** (recommended; a destructive plan already warns), or now?

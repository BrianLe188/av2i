# Requests: asking for an apply to be approved (DD-027)

Status: decided (owner, 28 October 2026: the proposal and its six answers accepted as recommended). Replaces the "two people" switch of
[apply-and-approval.md](apply-and-approval.md) (DD-026, section 2 and 9); everything else in that design stands.

## 1. Why

With the switch, even the owner who made a plan could not approve it (`self_approval`), and a project either asked for two people or for none.
Real teams work as pull requests do: a member does the work and **asks**, someone with the authority **decides**, and they **talk** about it.
The platform now has a **Requests** page, a small ticket system in which "approve this apply" is the first kind.

## 2. The flow

1. A member who may plan (`run:Plan`) plans. When the plan is done and they may not apply it themselves, the plan panel offers **Send for approval**
   (with an optional note). That creates **request #n** of the project.
2. The people who may approve (`run:Approve`; the owner has it) see it under **Requests → Waiting for me**, with a red count in the menu, and in the
   project's plan dialog. They read the plan (the same panel in both places), talk in the request, and press **Approve** or **Reject** (a reason is
   required).
3. When it is approved, **the requester or the approver applies that plan** (typed project name if it deletes or replaces anything). The approval
   covers **that plan only**: it does not give the member `run:Apply` for anything else.
4. A person who **may do both** (`run:Apply` and `run:Approve`, the owner) applies their own plan at once: nobody asks themselves. The same holds
   for a member's plan the owner presses Apply on: pressing Apply is the approval.

```
Waiting ──approve──▶ Approved ──apply succeeded──▶ Applied
   │                    │
   ├─reject / withdraw──┴────────────────────────▶ Closed (rejected | withdrawn)
```

Four states. A plan that went out of date (24 hours, the design, a variable, the connection or the state changed) does not change the state; the
request shows **Out of date** and the requester can **put a newer plan into the same request** (the approval is cleared, the talk stays), like pushing
a commit to a pull request.

## 3. Rules

| Rule | |
|---|---|
| Who may send | `run:Plan`, on a plan that succeeded and is still usable; one waiting or approved request per plan |
| Who may approve or reject | `run:Approve`, never the requester; **a plan that deletes or replaces needs the approver to hold `run:ApplyDestructive`** |
| Who may withdraw | the requester, while it is waiting or approved |
| Who may apply | `run:Apply` **and** `run:Approve` (directly), or the requester, the approver or anyone with `run:Apply` once the request is approved |
| Who may comment | whoever may read the project |
| Who sees a request | whoever may read the project |
| Session | sending, approving, rejecting, withdrawing, putting a plan in, applying: a person's session, not an API token |

Everything of DD-026 section 2 still blocks an apply (age, files, variables, connection, state, rescue). `not_approved` is no longer a state of the plan:
the apply route decides by the rule above.

## 4. Data (migration `0008_requests.sql`)

```sql
alter table projects add column request_seq integer not null default 0;     -- numbers #1, #2 ... per project
alter table projects drop column require_approval;                          -- replaced by the rule above
drop table run_approvals;                                                    -- never released

create table requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  number integer not null,
  kind text not null check (kind in ('apply')),
  plan_run_id uuid references runs (id) on delete set null,                  -- the plan under review; replaced by a newer one
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'applied', 'closed')),
  close_reason text check (close_reason in ('rejected', 'withdrawn')),
  requester_id uuid references users (id) on delete set null, requester text not null,
  decided_by_id uuid references users (id) on delete set null, decided_by text, decided_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create unique index requests_one_live_per_plan on requests (plan_run_id) where status in ('waiting', 'approved');

create table request_events (                                                -- the timeline and the talk
  id bigint generated always as identity primary key,
  request_id uuid not null references requests (id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references users (id) on delete set null, actor text not null,
  kind text not null check (kind in ('requested', 'comment', 'approved', 'rejected', 'withdrawn', 'replanned', 'applied', 'apply_failed')),
  body text,
  data jsonb not null default '{}'
);
```

Names are kept as text so that history survives the removal of an account. The `kind` column is the extension point (a later kind such as "access
request" adds a value and its screens); there is no workflow engine.

## 5. API

| Call | Needs | |
|---|---|---|
| `POST /api/runs/:id/request` `{note?}` | `run:Plan` | sends the plan; 201 |
| `GET /api/requests?scope=awaiting\|mine\|project&projectId=` | signed in | the list (only projects the person may read) |
| `GET /api/requests/summary` | signed in | `{awaiting, mine}` for the menu |
| `GET /api/requests/:id` | `project:Read` | the request, its timeline, the plan and the apply state, and what the person may do |
| `POST /api/requests/:id/approve` | `run:Approve` | not the requester; destructive needs `run:ApplyDestructive` |
| `POST /api/requests/:id/reject` `{note}` | `run:Approve` | the reason is required |
| `POST /api/requests/:id/withdraw` | the requester | |
| `POST /api/requests/:id/comments` `{body}` | `project:Read` | plain text, up to 5000 characters |
| `POST /api/requests/:id/replan` `{planRunId}` | the requester | puts a newer, successful plan of the project into the request |
| `POST /api/runs/:id/apply` | see section 3 | as before, with the new rule |

`GET /api/runs/:id` for a plan also says which request covers it, what the person may do (`can.applyNow`, `can.request`, `can.approve`), and which of
their requests a newer plan could replace. Removed: the approve and withdraw routes of a plan, the project setting `requireApproval`.

The runner closes the loop: when an apply of a plan finishes, its request becomes **applied** (or gets an `apply_failed` entry and stays approved,
shown as out of date because the state moved).

## 6. Studio

- **Requests** in the menu with the count of requests waiting for the person. Tabs **Waiting for me** (default) and **Sent by me**; a row shows the
  number, the project, the state, who, when, and a one-line size of the plan; a red mark when it deletes or replaces.
- **A request** shows its header and state, the plan (the same panel as in the dialog), the actions, and below them the **timeline** and the
  **comment box**: the sent note, comments, approvals, applies, in order.
- **The plan dialog** keeps the plan and its apply panel; the panel now says what comes next (*Send for approval*, *Waiting for approval, open request
  #3*, *Approved by Alice: Apply*), has Approve and Reject for approvers, and the button to put this plan into a waiting request. The "two people"
  switch is gone.
- Vietnamese and English.

## 7. Not now

Email or other notifications (the count and the list are the notification); editing or deleting a comment; mentions and reactions; other kinds of
request; a share role for planners (members get `run:Plan` by policy, as the owner decides).

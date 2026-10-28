# Project page and members (DD-028)

Status: decided (owner, 28 October 2026: the proposal and its five answers accepted as recommended).

## 1. Why

Permissions that belong to one project (who may plan it, approve, apply, see its state) could only be granted by a policy on every project, because sharing
had two roles, viewer and editor. Now **system permissions** (users, groups, policies, audit, AWS connections, creating projects) stay on users and groups, and
**project permissions are granted in the project**, on a page of its own, before the canvas.

## 2. The project page

- `/projects/:id` is the **project page** (inside the menu layout); the canvas is `/projects/:id/design`. The canvas's back button returns to the page; the
  page has **Open canvas** and, for people who may plan, apply or approve, **Plan and apply** (it opens the canvas with the Plan dialog).
- Tabs: **Overview** (name, owner, dates, region, size of the design, the **AWS connection** of the project, a warning when a state rescue waits),
  **Members**, **Requests** (the project's requests).
- The Share button of the canvas and its dialog are gone: they are the Members tab now. The AWS connection is chosen on the Overview; the Plan dialog only
  shows it.

## 3. Members

Members are users or groups, each with a **role** that stands for a set of project permissions, or a **custom** set.

| Role | Project permissions |
|---|---|
| Viewer | `project:Read` |
| Editor | read, `project:Write` |
| Runner | read, `run:Plan`, `state:Read` |
| Approver | read, `run:Approve`, `state:Read` |
| Maintainer | read, write, `project:Share`, `run:Plan`, `run:Approve`, `run:Apply`, `state:Read`, `variable:Write` |
| Custom | any of the 11 project permissions: the above plus `project:Delete`, `run:ApplyDestructive`, `state:Write` |

- The **owner** is the fixed first row and holds all 11 (the typed project name still guards a destructive apply, and a plan that deletes still needs its
  approver to hold `run:ApplyDestructive`: the owner now does).
- **You can grant only what you hold in the project**, and a custom set always includes `project:Read`. Changing or removing a member needs `project:Share`.
- A person who is in several places (themselves, a group) holds the union. A Deny in a policy still wins.
- The list of members is visible to whoever may read the project; managing it needs `project:Share`.

## 4. The AWS connection

`connection:Use` is needed to **choose** the connection of a project (it decides which accounts a person may point a project at), not for every member who
plans. Whoever holds `run:Plan` in the project plans against the project's connection. Rows of the older rule (a run refused with `connection_forbidden`) go.

## 5. Data (migration `0009_members.sql`)

`project_shares.actions text[]` holds the permissions; `role` stays as the label (`viewer`, `editor`, `runner`, `approver`, `maintainer`, `custom`). Existing
rows get the actions of their role. The evaluation reads `actions`.

## 6. API

`GET /api/projects/:id/shares` (readers) answers the members, the roles with their actions, the 11 permissions, and which of them the caller holds.
`PUT /api/projects/:id/shares` takes `{user|group, role, actions?}` (`actions` for `custom`); `DELETE .../shares/:id` as before. `GET /api/projects/:id`
also gives `createdAt`.

## 7. Not now

Per-member expiry, invitations by email, and the system-permission picker with direct permissions for users and groups (the next steps, DD-028 follow-ups).

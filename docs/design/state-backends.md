# State: viewing it, and keeping it elsewhere (DD-032, R3)

Status: decided (owner, 29 October 2026: the plan and its five answers accepted as recommended). Two steps, one commit each.

## R3a: the state viewer (state kept by the platform)

- `state_versions` gets `resources`, `outputs`, `bytes`, written when a version is stored (and worked out on first read for older rows).
- A project's **State** tab (for whoever holds `state:Read`): the versions (serial, time, the run and the person behind it, resources, size); one version shows its
  resources (address, type, provider, id) and its outputs, with a filter; one resource shows its attributes; two versions give a diff (resources added, removed,
  changed).
- **Sensitive values are hidden.** OpenTofu keeps passwords in clear in a state. The viewer drops the paths the state itself marks `sensitive_attributes`, a sensitive
  output's value, and, as a second net, values under keys that look like `password`, `secret`, `token`, `private_key`, `access_key`, `credential`.
- **The full state** (clear text) can be downloaded only with **`state:Write`** and a person's session, and the download is audited. The download of a rescued
  state (R2b) now needs `state:Write` too.
- The project page tells where the state is kept.

## R3b: S3 (or an S3-compatible server) as the place of the state

- `projects.state_backend`: the platform (default) or `s3` with bucket, key, region, encryption (and optional KMS key), and optional `endpoint` and `usePathStyle` for
  S3-compatible servers. The credentials are the keys of the project's AWS connection: the platform keeps no new secret.
- The runner writes `backend.tf` from the project's backend (a run keeps the backend it was queued with). A **plan on S3 runs `-lock=false`**, so the plan role stays
  read-only (the platform runs one thing at a time in a project); an apply uses S3's own lock file.
- A **Check** button assumes the plan role and verifies the bucket is reachable, **versioning is on**, and the key can be read. The platform generates the S3 policy
  for the plan and apply roles.
- **Moving the state** between the platform and S3 is a run of its own, `migrate`: initialise with the old backend, switch `backend.tf`, `init -migrate-state
  -force-copy`, read the state back from the new place and compare lineage and serial with the old, and only then record the new backend on the project. A failure
  leaves the old backend. It needs `state:Write`, the project name typed, no other run in progress and no rescue pending, and runs with the apply role. The old versions
  stay in the platform. A project with no state yet changes backend directly.
- The viewer reads an S3 state through the plan role (`GetObject`, and `ListObjectVersions` for the history when versioning is on).
- On S3 the platform does not check serial and lineage on write (OpenTofu does), and a rescued state can be downloaded but not pushed back by the platform.

## Not now

Other backends (GCS, Azure, PostgreSQL, a third-party `http`); `tofu state mv`, `rm` and `import`; force-unlock; drift reports; removing old state versions.

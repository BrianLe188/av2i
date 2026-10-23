# Studio: the web canvas (milestone M6)

The first interface runs entirely in the browser on the same engine as the CLI (DD-005). It lives in `apps/studio`.

## Scope of the first version

- Services: the nine that have rules today (VPC, subnet, internet gateway, NAT gateway, Elastic IP, route table, S3 gateway
  endpoint, security group, EC2). The palette, the property forms and the connection rules are read from the registry, so a
  new service appears when its spec file is added.
- Persistence: the design is a `design.json` file the user opens and saves; a draft is kept in `localStorage` (decision
  DD-006 defers a server). Language, theme and the open tab are kept there too.
- Not in the first version: accounts, sharing, cost estimates, import from existing Terraform, services outside the nine,
  automatic layout.

## Screen

Top bar (name, undo, redo, open, save, templates, language, theme, export), palette on the left, canvas in the middle,
inspector on the right, and a bottom panel with three tabs: problems, Terraform, plan.

## Flow

1. Start blank, from a template or from a saved file. The draft of the last session is offered first.
2. Drag a service from the palette. Dropping on a container makes the node its child. The drop is refused, with the reason,
   when the matrix does not allow that service in that container.
3. Draw a connection from one node to another. Only pairs the matrix allows are accepted; the mechanism is chosen from the
   pair (route, route-association, sg-attach, eip-attach). A route gets the default destination `0.0.0.0/0` for gateways.
4. Edit properties in the inspector. Forms come from the service's `properties`; types the form cannot show (lists of
   objects, maps, policy documents) are edited as JSON.
5. Every change re-runs normalize, the rules and the generator. Findings are listed with their fix; selecting one selects
   its nodes on the canvas. Nodes carry a badge for the worst finding.
6. Nodes and edges the engine adds (the Elastic IP of a NAT gateway, containment) appear faded with the reason and cannot be
   edited.
7. The Terraform tab shows the files, grouped by resource, and each resource says which node caused it; selecting a resource
   selects the node, and the plan tab lists the same resources. With an error finding the generator is not run, the tab lists
   the errors instead (as the CLI does).
8. Export downloads a zip of the `.tf` files (DD-010: files only, no credentials, no apply). Save downloads `design.json`.

## Design choices

- Undo and redo keep snapshots of the design; every edit is also expressible as patch operations (DD-008).
- A node's `position` is relative to its parent. Containers have a `size`; both are layout only and never affect rules or
  output.
- The pure logic (what may be dropped where, which pairs may connect, default edge properties, the property form model) lives
  in `src/logic` without React, and is unit-tested.

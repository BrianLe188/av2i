# Studio: the web canvas (milestone M6)

The first interface runs entirely in the browser on the same engine as the CLI (DD-005). It lives in `apps/studio`.

## Scope of the first version

- Services: the twenty that have rules today: the nine of the network and compute groups (VPC, subnet, internet gateway, NAT
  gateway, Elastic IP, route table, S3 gateway endpoint, security group, EC2) and, since M3, ECS (cluster and service are two
  palette entries), ECR, Lambda, RDS, S3, IAM role, IAM policy and, since M4, ALB, ACM, Route 53 and CloudFront. The palette, the property forms and the connection rules are read from the registry, so a
  new service appears when its spec file is added.
- Persistence: the design is a `design.json` file the user opens and saves; a draft is kept in `localStorage` (decision
  DD-006 defers a server). Language, theme and the open tab are kept there too.
- Not in the first version: accounts, sharing, cost estimates, import from existing Terraform, services outside the twenty,
  automatic layout.

## Screen

Top bar (name, undo, redo, open, save, templates, language, theme, export), palette on the left, canvas in the middle,
inspector on the right, and a bottom panel with three tabs: problems, Terraform, plan.

## Flow

1. Start blank, from a template or from a saved file. The draft of the last session is offered first.
2. Drag a service from the palette. Dropping on a container makes the node its child. The drop is refused, with the reason,
   when the matrix does not allow that service in that container.
3. Draw a connection from one node to another. Only pairs the matrix allows are accepted; the mechanism is chosen from the
   pair (route, route-association, sg-attach, eip-attach, image-source, network-access, assume-role, grant, db-subnet-group, and a
   containment line from a subnet to an ECS service or a Lambda function, which adds a subnet, DD-014). A route gets the default
   destination `0.0.0.0/0` for gateways. The inspector of a connection edits what it carries: the role slot of an assume-role, the
   level of a grant, the port and groups of a network access, the port, health check path and target group of a listener-target, the name of an alias record for a load balancer, and the access of a CloudFront origin.
4. Edit properties in the inspector. Forms come from the service's `properties`; types the form cannot show (lists of
   objects, maps, policy documents) are edited as JSON.
5. Every change re-runs normalize, the rules and the generator. Findings are listed with their fix; selecting one selects
   its nodes on the canvas. Nodes carry a badge for the worst finding.
6. Nodes and edges the engine adds (the Elastic IP of a NAT gateway, the required roles of a service or function, containment) appear faded with the reason and cannot be
   edited.
7. The Terraform tab shows the files, grouped by resource, and each resource says which node caused it; selecting a resource
   selects the node, and the plan tab lists the same resources. With an error finding the generator is not run, the tab lists
   the errors instead (as the CLI does).
8. Export downloads a zip of the `.tf` files and, when the design has roles, `deployer-policy.json` (DD-010, DD-020: files only, no credentials, no apply). Save downloads `design.json`.

## Design choices

- The interface is built from shadcn/ui components (`apps/studio/src/components/ui`, style new-york, base colour neutral, Tailwind v4, Radix and lucide icons), configured by `apps/studio/components.json`; more are added with `npx shadcn@latest add <name>` from `apps/studio`. Colours come from the shadcn tokens in `src/index.css` (light and dark, the `dark` class on the root), plus `warning`, `info` and `success`; the canvas follows them through React Flow's `colorMode`. A property left empty means "use the default", which Radix `Select` cannot hold as an empty value, so `ui/option-select.tsx` wraps it with a sentinel. Notices are `sonner` toasts. Service colours live in `src/logic/colors.ts`.
- Undo and redo keep snapshots of the design; every edit is also expressible as patch operations (DD-008).
- A node's `position` is relative to its parent. Containers have a `size`; both are layout only and never affect rules or
  output.
- The pure logic (what may be dropped where, which pairs may connect, default edge properties, the property form model) lives
  in `src/logic` without React, and is unit-tested.

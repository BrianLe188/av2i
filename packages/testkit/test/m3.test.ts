import { describe, expect, it } from "vitest";
import { getRegistry } from "@av2i/registry";
import { SLOTS, accesses, effectiveEgress, effectiveIngress, normalize, requiredManaged, Graph } from "@av2i/engine";
import { generate } from "@av2i/generator";
import { applyPatch, type Design, type PatchOp } from "@av2i/model";
import { runRules } from "@av2i/rules";
import { executableScenarios, firedRules } from "../src/index.ts";

const base = executableScenarios().find((s) => s.id === "container-backend")!.design;
const patched = (...patch: PatchOp[]): Design => applyPatch(base, patch);
const graphOf = (d: Design) => new Graph(normalize(d));

describe("tables that mirror the specification", () => {
  it("every role slot is a row of assume-role", () => {
    const rows = (getRegistry().mechanisms["assume-role"] as any).consumers as { service: string; trust_principal: string }[];
    expect(SLOTS.map((s) => `${s.service} ${s.trust}`).sort()).toEqual(rows.map((r) => `${r.service} ${r.trust_principal}`).sort());
  });

  it("the required managed policies are the ones assume-role lists", () => {
    const rows = (getRegistry().mechanisms["assume-role"] as any).consumers as { id: string; required_managed_policies: string[] }[];
    const text = (id: string) => rows.find((r) => r.id === id)!.required_managed_policies.join(" ");
    expect(text("ecs-task-execution")).toContain("AmazonECSTaskExecutionRolePolicy");
    expect(requiredManaged("ecs", "execution", false)[0]).toContain("AmazonECSTaskExecutionRolePolicy");
    expect(text("lambda-execution")).toContain("AWSLambdaVPCAccessExecutionRole");
    expect(requiredManaged("lambda", "execution", true).join(" ")).toContain("AWSLambdaVPCAccessExecutionRole");
    expect(requiredManaged("lambda", "execution", false).join(" ")).not.toContain("VPCAccess");
  });

  it("grant statements use the actions of the grant registry", () => {
    const rows = (getRegistry().mechanisms.grant as any).targets as { id: string; levels: Record<string, { statements: { actions: string[] }[] }> }[];
    const files = generate(base)["iam.tf"]!;
    const s3 = rows.find((r) => r.id === "s3")!;
    for (const a of s3.levels.readwrite!.statements.flatMap((s) => s.actions)) expect(files).toContain(`"${a}"`);
  });
});

describe("derived roles", () => {
  it("a function and a service get the roles their slots need", () => {
    const g = graphOf(base);
    expect(g.rolesOf("fn").map((r) => r.slot)).toEqual(["execution"]);
    expect(g.rolesOf("web").map((r) => r.slot).sort()).toEqual(["execution", "task"]);
    expect(g.rolesOf("fn")[0]!.role.origin).toBe("generated");
  });

  it("a role the design draws into a required slot replaces the derived one", () => {
    const g = graphOf(patched({ op: "add-node", node: { key: "mine", label: "Mine", service: "iam-role", props: { name: "mine" } } }, { op: "add-edge", edge: { id: "e_mine", mechanism: "assume-role", from: "mine", to: "fn", props: { slot: "execution" } } }));
    expect(g.rolesOf("fn").map((r) => r.role.key)).toEqual(["mine"]);
  });

  it("a role no workload assumes is not emitted", () => {
    const files = generate(patched({ op: "remove-edge", mechanism: "assume-role", from: "task_role", to: "web" }));
    expect(files["iam.tf"]).not.toContain('"aws_iam_role" "task_role"');
    expect(files["iam.tf"]).not.toContain("task_role_grants");
  });

  it("an ECS task role trusts only tasks of this account", () => {
    const iam = generate(base)["iam.tf"]!;
    expect(iam).toContain("aws:SourceAccount");
    expect(iam).toContain("data.aws_caller_identity.current.account_id");
  });
});

describe("network access", () => {
  it("opens the database port to the callers' groups", () => {
    const g = graphOf(base);
    expect(accesses(g).map((a) => `${a.callerSg}>${a.calleeSg}:${a.port}`).sort()).toEqual(["sg_fn>sg_db:5432", "sg_task>sg_db:5432"]);
    expect(effectiveIngress(g, "sg_db").map((r) => r.referenced_security_group_id).sort()).toEqual(["sg_fn", "sg_task"]);
  });

  it("uses the engine default port and the configured one", () => {
    expect(accesses(graphOf(patched({ op: "set", node: "db", path: "props.engine", value: "mysql" }))).every((a) => a.port === 3306)).toBe(true);
    expect(accesses(graphOf(patched({ op: "set", node: "db", path: "props.port", value: 6543 }))).every((a) => a.port === 6543)).toBe(true);
  });

  it("adds an egress rule only to a group that restricts egress", () => {
    expect(effectiveEgress(graphOf(base), "sg_task").map((r) => r.generated)).toEqual(["default-egress"]);
    const restricted = graphOf(patched({ op: "set", node: "sg_task", path: "props.egress_rules", value: [] }));
    expect(effectiveEgress(restricted, "sg_task").map((r) => r.referenced_security_group_id)).toContain("sg_db");
  });

  it("needs a group on each side, named when there are several", () => {
    const two = patched({ op: "add-node", node: { key: "sg_b", label: "b", service: "security-group", parent: "vpc", props: { name: "b-sg", description: "second" } } }, { op: "add-edge", edge: { id: "e_b", mechanism: "sg-attach", from: "sg_b", to: "db" } });
    expect(accesses(graphOf(two)).length).toBe(0);
    const named = applyPatch(two, [{ op: "remove-edge", mechanism: "network-access", from: "web", to: "db" }, { op: "add-edge", edge: { id: "e_named", mechanism: "network-access", from: "web", to: "db", props: { callee_sg: "sg_b" } } }]);
    expect(accesses(graphOf(named)).map((a) => a.calleeSg)).toEqual(["sg_b"]);
  });
});

describe("generated Terraform", () => {
  it("never writes a database password into a file", () => {
    const files = generate(patched({ op: "set", node: "db", path: "props.password", value: "Sup3rSecretPass" }));
    expect(Object.values(files).join("\n")).not.toContain("Sup3rSecretPass");
    expect(files["variables.tf"]).toContain('variable "db_password"');
    expect(files["database.tf"]).toContain("var.db_password");
  });

  it("keeps the stronger of two grants on one bucket", () => {
    const iam = generate(patched({ op: "add-edge", edge: { id: "e_read", mechanism: "grant", from: "task_role", to: "files", props: { level: "read" } } }))["iam.tf"]!;
    expect(iam).toContain("s3:PutObject");
    expect(iam.match(/S3ReadwriteFiles"/g)?.length).toBe(1);
  });

  it("gives a Lambda image function the pull permission through its role", () => {
    const d = patched({ op: "unset", node: "fn", path: "props.filename" }, { op: "unset", node: "fn", path: "props.handler" }, { op: "unset", node: "fn", path: "props.runtime" }, { op: "add-edge", edge: { id: "e_img", mechanism: "image-source", from: "repo", to: "fn" } });
    const files = generate(d);
    expect(files["compute.tf"]).toContain('package_type  = "Image"');
    expect(files["iam.tf"]).toContain("ecr:GetAuthorizationToken");
  });

  it("names a service's subnets in the order of the design", () => {
    expect(generate(base)["compute.tf"]).toContain("subnets          = [aws_subnet.app_a.id, aws_subnet.app_b.id]");
  });
});

describe("rules that need a large input", () => {
  const fires = (rule: string, ...patch: PatchOp[]) => firedRules(patched(...patch)).includes(rule);

  it("VAL-047 limits a lifecycle policy to 50 rules", () => {
    const rule = (n: number) => ({ rulePriority: n, description: "x", selection: { tagStatus: "untagged", countType: "sinceImagePushed", countUnit: "days", countNumber: 1 }, action: { type: "expire" } });
    expect(fires("VAL-047", { op: "set", node: "repo", path: "props.lifecycle_policy", value: { rules: Array.from({ length: 51 }, (_, i) => rule(i + 1)) } })).toBe(true);
    expect(fires("VAL-047", { op: "set", node: "repo", path: "props.lifecycle_policy", value: { rules: Array.from({ length: 50 }, (_, i) => rule(i + 1)) } })).toBe(false);
  });

  it("VAL-108 limits the inline policies of a role to 10,240 characters", () => {
    const doc = (n: number) => ({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: ["a".repeat(n)] }] });
    expect(fires("VAL-108", { op: "set", node: "task_role", path: "props.raw_policy", value: doc(11000) })).toBe(true);
    expect(fires("VAL-108", { op: "set", node: "task_role", path: "props.raw_policy", value: doc(100) })).toBe(false);
  });

  it("SEC-041 flags a role shared by services of different kinds", () => {
    const shared = patched({ op: "add-edge", edge: { id: "e_share", mechanism: "assume-role", from: "task_role", to: "db", props: { slot: "monitoring" } } });
    expect(firedRules(shared)).toContain("SEC-041");
  });

  it("VAL-121 counts the roles a design emits against the account quota", () => {
    const many = Array.from({ length: 1001 }, (_, i): PatchOp[] => [
      { op: "add-node", node: { key: `r${i}`, label: "r", service: "iam-role", props: { name: `role-${i}` } } },
      { op: "add-edge", edge: { id: `e_r${i}`, mechanism: "assume-role", from: `r${i}`, to: "web", props: { slot: "task" } } },
    ]).flat();
    expect(firedRules(patched(...many))).toContain("VAL-121");
    expect(firedRules(base)).not.toContain("VAL-121");
  });

  it("no rule fires on a design with no node of its kind", () => {
    const empty: Design = { schema: 1, name: "empty", settings: { region: "ap-southeast-1" }, nodes: [], edges: [] };
    expect(runRules(empty, getRegistry())).toEqual([]);
  });
});

describe("AMI lookup (D-014)", () => {
  const ec2 = executableScenarios().find((s) => s.id === "ec2-in-vpc")!.design;
  const look = (...p: PatchOp[]) => generate(applyPatch(ec2, [{ op: "unset", node: "app", path: "props.ami" }, ...p]))["compute.tf"]!;

  it("writes the AMI that is given and no data source", () => {
    expect(generate(ec2)["compute.tf"]).toMatch(/ami\s+= "ami-0123456789abcdef0"/);
    expect(generate(ec2)["compute.tf"]).not.toContain("aws_ami");
  });

  it("looks up the newest Amazon Linux 2023 image for x86 by default and ignores later images", () => {
    const out = look();
    expect(out).toContain('data "aws_ami" "amazon_linux_2023_x86_64"');
    expect(out).toContain("al2023-ami-2023.*-x86_64");
    expect(out).toContain("ignore_changes = [ami]");
  });

  it("picks the Arm image for Graviton instance types and the owner of the family", () => {
    const out = look({ op: "set", node: "app", path: "props.ami_family", value: "ubuntu-24-04" }, { op: "set", node: "app", path: "props.instance_type", value: "t4g.micro" });
    expect(out).toContain("ubuntu-noble-24.04-arm64-server-*");
    expect(out).toContain('"099720109477"');
  });

  it("recognises Arm families only", async () => {
    const { isArm } = await import("../../generator/src/ami.ts");
    for (const t of ["t4g.micro", "m7g.large", "c6gn.xlarge", "a1.medium"]) expect(isArm(t), t).toBe(true);
    for (const t of ["t3.micro", "m5.large", "g5.xlarge", "c5d.large"]) expect(isArm(t), t).toBe(false);
  });
});

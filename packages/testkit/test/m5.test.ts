import { describe, expect, it } from "vitest";
import { generate } from "@av2i/generator";
import { applyPatch, type Design, type PatchOp } from "@av2i/model";
import { executableScenarios, firedRules } from "../src/index.ts";

const api = executableScenarios().find((s) => s.id === "serverless-backend")!.design;
const patched = (...p: PatchOp[]): Design => applyPatch(api, p);
const policyOf = (d: Design) => JSON.parse(generate(d)["deployer-policy.json"]!) as { Statement: { Sid: string; Action: string | string[]; Resource: string | string[]; Condition?: any }[] };

describe("customer managed policies", () => {
  it("are created and attached to the role that holds them", () => {
    const iam = generate(api)["iam.tf"]!;
    expect(iam).toContain('resource "aws_iam_policy" "audit"');
    expect(iam).toContain('resource "aws_iam_role_policy_attachment" "data_role_audit"');
    expect(iam).toContain("aws_iam_policy.audit.arn");
  });

  it("make a function wait for their attachment", () => {
    expect(generate(api)["compute.tf"]).toContain("aws_iam_role_policy_attachment.data_role_audit");
  });

  it("count towards the 20 policies of a role", () => {
    const many = Array.from({ length: 19 }, (_, i): PatchOp => ({ op: "add-node", node: { key: `p${i}`, label: "p", service: "iam-policy", props: { name: `p-${i}`, policy: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::b/*"] }] } } } }));
    const attach = Array.from({ length: 19 }, (_, i): PatchOp => ({ op: "add-edge", edge: { id: `e_p${i}`, mechanism: "grant", from: "data_role", to: `p${i}` } }));
    expect(firedRules(patched(...many, ...attach))).toContain("VAL-107");
    expect(firedRules(api)).not.toContain("VAL-107");
  });

  it("VAL-108 limits a customer policy to 6,144 characters", () => {
    const big = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: ["a".repeat(7000)] }] };
    expect(firedRules(patched({ op: "set", node: "audit", path: "props.policy", value: big }))).toContain("VAL-108");
  });
});

describe("the deployer policy", () => {
  it("is not written for a design without roles", () => {
    expect(generate(executableScenarios().find((s) => s.id === "ec2-in-vpc")!.design)["deployer-policy.json"]).toBeUndefined();
  });

  it("scopes role actions to the roles of this design", () => {
    const manage = policyOf(api).Statement.find((s) => s.Sid === "ManageRolesOfThisDesign")!;
    expect(manage.Resource).toEqual(["arn:aws:iam::*:role/api-data", "arn:aws:iam::*:role/role-edge-fn"]);
    expect(JSON.stringify(manage.Resource)).not.toContain('"*"');
  });

  it("limits PassRole to the services the roles are passed to", () => {
    const pass = policyOf(api).Statement.find((s) => s.Sid === "PassRolesToTheirServices")!;
    expect(pass.Condition.StringEquals["iam:PassedToService"]).toEqual(["lambda.amazonaws.com"]);
  });

  it("limits attaching to the managed policies the design uses", () => {
    const attach = policyOf(api).Statement.find((s) => s.Sid === "AttachOnlyThePoliciesOfThisDesign")!;
    const allowed: string[] = attach.Condition.ArnLike["iam:PolicyARN"];
    expect(allowed).toContain("arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole");
    expect(allowed).toContain("arn:aws:iam::*:policy/api-audit");
    expect(allowed).not.toContain("arn:aws:iam::aws:policy/AdministratorAccess");
  });

  it("covers instance profiles and customer policies when the design has them", () => {
    const sids = policyOf(api).Statement.map((s) => s.Sid);
    expect(sids).toContain("ManageCustomerPoliciesOfThisDesign");
    const withInstance = patched(
      { op: "add-node", node: { key: "inst", label: "I", service: "ec2", parent: "priv_a", props: { ami: "ami-0123456789abcdef0", instance_type: "t3.micro", metadata_options: { http_tokens: "required" }, root_block_device: { encrypted: true } } } },
      { op: "add-edge", edge: { id: "e_sg_i", mechanism: "sg-attach", from: "sg_fn", to: "inst" } },
      { op: "add-edge", edge: { id: "e_role_i", mechanism: "assume-role", from: "data_role", to: "inst" } },
    );
    expect(policyOf(withInstance).Statement.map((s) => s.Sid)).toContain("ManageInstanceProfiles");
    expect(policyOf(withInstance).Statement.find((s) => s.Sid === "PassRolesToTheirServices")!.Condition.StringEquals["iam:PassedToService"]).toEqual(["ec2.amazonaws.com", "lambda.amazonaws.com"]);
  });

  it("does not list a role nothing assumes", () => {
    const d = patched({ op: "add-node", node: { key: "idle", label: "I", service: "iam-role", props: { name: "idle-role" } } });
    expect(JSON.stringify(policyOf(d))).not.toContain("idle-role");
  });
});

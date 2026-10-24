import { policyNameOf, roleNameOf, slotFor, type Graph } from "@av2i/engine";
import { isEmitted, managedOf } from "./iam.ts";

/**
 * The IAM permissions whoever applies the generated files needs (decision D-028), as a policy to review. They are scoped to
 * the roles, instance profiles and policies of this design, `iam:PassRole` is limited to the service each role is passed to,
 * and attaching a managed policy is limited to the policies the design uses, so the deployer cannot raise its own permissions
 * through them. The platform does not create the deployer and never holds its credentials (DD-010). Returns null when the
 * design needs no IAM permissions.
 */
export function deployerPolicy(g: Graph): string | null {
  const roles = g.nodesOf("iam-role").filter((r) => isEmitted(g, r));
  const policies = g.nodesOf("iam-policy");
  const profiles = g.edges("assume-role").filter((e) => g.node(e.to)?.service === "ec2" && roles.some((r) => r.key === e.from));
  if (!roles.length && !policies.length) return null;

  const arn = (kind: string, name: string) => `arn:aws:iam::*:${kind}/${name}`;
  const roleArns = roles.map((r) => arn("role", roleNameOf(r)));
  const statements: Record<string, unknown>[] = [];
  if (roles.length) {
    statements.push({
      Sid: "ManageRolesOfThisDesign",
      Effect: "Allow",
      Action: ["iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy"],
      Resource: roleArns,
    });
    const attachable = [...new Set([...roles.flatMap((r) => managedOf(g, r)), ...policies.map((p) => arn("policy", policyNameOf(p)))])].sort();
    if (attachable.length) {
      statements.push({ Sid: "AttachOnlyThePoliciesOfThisDesign", Effect: "Allow", Action: ["iam:AttachRolePolicy", "iam:DetachRolePolicy"], Resource: roleArns, Condition: { ArnLike: { "iam:PolicyARN": attachable } } });
    }
    const principals = [...new Set(roles.flatMap((r) => g.consumersOf(r.key).flatMap((c) => (c.slot ? [slotFor(c.consumer.service, c.slot)?.trust] : []))).filter((x): x is string => !!x))].sort();
    statements.push({ Sid: "PassRolesToTheirServices", Effect: "Allow", Action: "iam:PassRole", Resource: roleArns, Condition: { StringEquals: { "iam:PassedToService": principals } } });
  }
  if (profiles.length) {
    statements.push({
      Sid: "ManageInstanceProfiles",
      Effect: "Allow",
      Action: ["iam:CreateInstanceProfile", "iam:DeleteInstanceProfile", "iam:GetInstanceProfile", "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile", "iam:TagInstanceProfile"],
      Resource: [...new Set(profiles.map((e) => arn("instance-profile", String(e.to).replace(/_/g, "-"))))],
    });
  }
  if (policies.length) {
    statements.push({
      Sid: "ManageCustomerPoliciesOfThisDesign",
      Effect: "Allow",
      Action: ["iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions", "iam:CreatePolicyVersion", "iam:DeletePolicyVersion", "iam:TagPolicy"],
      Resource: policies.map((p) => arn("policy", policyNameOf(p))),
    });
  }
  return JSON.stringify({ Version: "2012-10-17", Statement: statements }, null, 2) + "\n";
}

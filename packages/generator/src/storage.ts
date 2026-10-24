import type { Value } from "@av2i/model";
import { call, ref, type Block, type Expr } from "./hcl.ts";
import { blocksOf, resource, toExpr, type PlanCtx } from "./ctx.ts";

const obj = (v: Value | undefined): Record<string, Value> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Value>) : {});

/**
 * S3 buckets with the safe defaults of decision D-016: every Block Public Access flag on, ACLs off, versioning on and
 * default encryption, each as its own resource because the inline arguments of the bucket are deprecated. ECR
 * repositories with their one lifecycle policy.
 */
export function planStorage(c: PlanCtx): void {
  const { g, add } = c;
  for (const n of g.nodesOf("s3")) {
    const id = ref(`aws_s3_bucket.${n.key}.id`);
    add("storage.tf", resource("aws_s3_bucket", n.key, [["bucket", n.props.bucket as string], ...c.optional(n, ["force_destroy", "object_lock_enabled"]), c.tags(n)]), n.key);

    const pab = obj(n.props.public_access_block);
    const flag = (k: string): [string, Expr] => [k, typeof pab[k] === "boolean" ? (pab[k] as boolean) : true];
    add("storage.tf", resource("aws_s3_bucket_public_access_block", n.key, [["bucket", id], flag("block_public_acls"), flag("block_public_policy"), flag("ignore_public_acls"), flag("restrict_public_buckets")]), n.key);

    const ownership = obj(n.props.ownership_controls).object_ownership;
    add("storage.tf", resource("aws_s3_bucket_ownership_controls", n.key, [["bucket", id]], [{ type: "rule", labels: [], args: [["object_ownership", typeof ownership === "string" ? ownership : "BucketOwnerEnforced"]] }]), n.key);

    const status = obj(n.props.versioning).status;
    add("storage.tf", resource("aws_s3_bucket_versioning", n.key, [["bucket", id]], [{ type: "versioning_configuration", labels: [], args: [["status", typeof status === "string" ? status : "Enabled"]] }]), n.key);

    const enc = obj(n.props.encryption);
    const algorithm = typeof enc.sse_algorithm === "string" ? enc.sse_algorithm : "AES256";
    const byDefault: [string, Expr][] = [["sse_algorithm", algorithm]];
    if (typeof enc.kms_master_key_id === "string") byDefault.push(["kms_master_key_id", enc.kms_master_key_id]);
    const rule: Block = { type: "rule", labels: [], args: typeof enc.bucket_key_enabled === "boolean" ? [["bucket_key_enabled", enc.bucket_key_enabled]] : [], blocks: [{ type: "apply_server_side_encryption_by_default", labels: [], args: byDefault }] };
    add("storage.tf", resource("aws_s3_bucket_server_side_encryption_configuration", n.key, [["bucket", id]], [rule]), n.key);

    const rules = n.props.lifecycle_rules;
    if (Array.isArray(rules) && rules.length) {
      add("storage.tf", resource("aws_s3_bucket_lifecycle_configuration", n.key, [["bucket", id], ["depends_on", [ref(`aws_s3_bucket_versioning.${n.key}`)]]], blocksOf("rule", rules)), n.key);
    }
  }

  for (const n of g.nodesOf("ecr")) {
    const scan = obj(n.props.image_scanning_configuration).scan_on_push;
    const blocks: Block[] = [];
    if (typeof scan === "boolean") blocks.push({ type: "image_scanning_configuration", labels: [], args: [["scan_on_push", scan]] });
    blocks.push(...blocksOf("encryption_configuration", n.props.encryption_configuration ?? null));
    add("storage.tf", resource("aws_ecr_repository", n.key, [["name", (n.props.name as string | undefined) ?? n.key.replace(/_/g, "-")], ...c.optional(n, ["image_tag_mutability", "force_delete"]), c.tags(n)], blocks), n.key);
    const policy = n.props.lifecycle_policy;
    if (policy !== undefined && policy !== null && policy !== "") {
      const doc = (typeof policy === "string" ? JSON.parse(policy) : policy) as Value;
      add("storage.tf", resource("aws_ecr_lifecycle_policy", n.key, [["repository", ref(`aws_ecr_repository.${n.key}.name`)], ["policy", call("jsonencode", toExpr(doc))]]), n.key);
    }
  }
}

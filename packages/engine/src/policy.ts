import type { NormalizedNode, Value } from "@av2i/model";
import { Graph } from "./graph.ts";

/** A reference to a Terraform attribute inside a statement; the generator turns it into an expression. */
export interface TfRef { $ref: string }
/** A string that mixes text and references, written as the Terraform template body, such as `${aws_s3_bucket.x.arn}/*`. */
export interface TfTemplate { $template: string }

export interface Statement {
  Sid?: string;
  Effect: string;
  Principal?: Value | TfRef;
  Action: Value;
  Resource: Value | TfRef | TfTemplate | (TfRef | TfTemplate)[];
  Condition?: Value | { [k: string]: Value | TfRef | { [k: string]: Value | TfRef } };
}

const pascal = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((x) => x[0]!.toUpperCase() + x.slice(1)).join("");

export const ACCOUNT = "data.aws_caller_identity.current.account_id";

/** Statements the relations require on a bucket: CloudFront through origin access control, and ALB access logs. */
export function generatedStatements(g: Graph, bucket: NormalizedNode): Statement[] {
  const out: Statement[] = [];
  const arn = `aws_s3_bucket.${bucket.key}.arn`;
  for (const e of g.edges("origin")) {
    if (e.to !== bucket.key || e.props?.access === "none" || e.props?.website_endpoint === true) continue;
    out.push({
      Sid: `AllowCloudFront${pascal(e.from)}`,
      Effect: "Allow",
      Principal: { Service: "cloudfront.amazonaws.com" },
      Action: "s3:GetObject",
      Resource: { $template: `\${${arn}}/*` },
      Condition: { StringEquals: { "AWS:SourceArn": { $ref: `aws_cloudfront_distribution.${e.from}.arn` } } },
    });
  }
  for (const e of g.edges("resource-policy")) {
    const alb = g.node(e.from);
    if (e.to !== bucket.key || alb?.service !== "alb" || g.prop(alb.key, "access_logs.enabled") !== true) continue;
    const prefix = g.prop(alb.key, "access_logs.prefix");
    out.push({
      Sid: `AllowAlbLogs${pascal(e.from)}`,
      Effect: "Allow",
      Principal: { Service: "logdelivery.elasticloadbalancing.amazonaws.com" },
      Action: "s3:PutObject",
      Resource: { $template: `\${${arn}}/${typeof prefix === "string" && prefix ? `${prefix}/` : ""}AWSLogs/\${${ACCOUNT}}/*` },
    });
  }
  return out.sort((a, b) => String(a.Sid).localeCompare(String(b.Sid)));
}

/** Statements the user wrote in the bucket's `bucket_policy`. */
export function userStatements(bucket: NormalizedNode): Statement[] {
  let doc: unknown = bucket.props.bucket_policy;
  if (typeof doc === "string") {
    try { doc = JSON.parse(doc); } catch { return []; }
  }
  const s = (doc as { Statement?: unknown } | undefined)?.Statement;
  return (Array.isArray(s) ? s : s ? [s] : []) as Statement[];
}

/** The one policy a bucket gets (relations/resource-policy.md, merge_rule): the user's statements, then the generated ones ordered by Sid. */
export const bucketPolicy = (g: Graph, bucket: NormalizedNode): Statement[] => [...userStatements(bucket), ...generatedStatements(g, bucket)];

import { GetBucketVersioningCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromContainerMetadata, fromEnv, fromInstanceMetadata } from "@aws-sdk/credential-providers";

import type { S3Backend } from "./runs/backend.ts";

type Provider = ReturnType<typeof fromEnv>;

export type Source = "env" | "container" | "instance";

/**
 * The server's own AWS identity, from the same sources a process on this machine can reach: the AWS_* variables, the container role of
 * ECS, or the instance role of EC2. Profiles and credential files are left out on purpose: a run has its own empty home folder.
 */
export function serverCredentials(env: NodeJS.ProcessEnv = process.env): { source: Source; provider: Provider } {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return { source: "env", provider: fromEnv() };
  if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI) return { source: "container", provider: fromContainerMetadata({ timeout: 1500, maxRetries: 0 }) };
  return { source: "instance", provider: fromInstanceMetadata({ timeout: 1500, maxRetries: 0 }) };
}

export interface Keys {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date | null;
}

export type Identity = { ok: true; account: string; arn: string } | { ok: false; reason: "none" | "error"; message: string };

export type Assumed =
  | { ok: true; keys: Keys; arn: string; account: string }
  // `trust`: the role did not let this server in (or the ExternalId differs: AWS does not say which); `base`: the server's own
  // key is missing or not valid; `other`: anything else
  | { ok: false; code: "trust" | "base" | "other"; message: string };

export interface AssumeRequest {
  roleArn: string;
  externalId: string;
  sessionName: string;
}

/** Everything the platform asks AWS: kept behind one interface so tests can stand in for AWS. */
export interface AwsGateway {
  /** who the server is (no keys), or who the given temporary keys are */
  identity(keys?: Keys): Promise<Identity & { source?: Source }>;
  assume(req: AssumeRequest): Promise<Assumed>;
  /** looks at the bucket of an S3 state backend with the given keys (or the server's own): can it be reached, is it versioned, is the file there */
  s3Check(keys: Keys | undefined, b: S3Backend): Promise<S3Check>;
  /** the state file of an S3 backend as it is now, or null when there is none */
  s3Read(keys: Keys | undefined, b: S3Backend): Promise<{ text: string; modifiedAt: Date | null } | null>;
}

export interface S3Check { bucket: { ok: boolean; message?: string }; versioning: { ok: boolean; status: "Enabled" | "Suspended" | "Off" | "unknown"; message?: string }; object: { ok: boolean; exists: boolean; message?: string } }

const region = (env: NodeJS.ProcessEnv) => env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1";
const client = (credentials: Provider | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }, env: NodeJS.ProcessEnv) =>
  new STSClient({ credentials, region: region(env), maxAttempts: 1, requestHandler: { requestTimeout: 6000, connectionTimeout: 2500 } });

const s3Client = (keys: Keys | undefined, b: S3Backend, env: NodeJS.ProcessEnv) =>
  new S3Client({
    region: b.region, maxAttempts: 1, requestHandler: { requestTimeout: 8000, connectionTimeout: 3000 },
    credentials: keys ? { accessKeyId: keys.accessKeyId, secretAccessKey: keys.secretAccessKey, sessionToken: keys.sessionToken } : serverCredentials(env).provider,
    ...(b.endpoint ? { endpoint: b.endpoint } : {}), ...(b.usePathStyle ? { forcePathStyle: true } : {}),
  });
const problem = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "failed");

export function realGateway(env: NodeJS.ProcessEnv = process.env): AwsGateway {
  const base = () => serverCredentials(env);
  return {
    async identity(keys) {
      const { source, provider } = base();
      // asking for the credentials first tells "nothing configured" (no variables, no role answering) from a call that AWS refused
      if (!keys) {
        try { await provider(); } catch (e) { return { ok: false, reason: "none", message: e instanceof Error ? e.message.slice(0, 300) : "No credentials." }; }
      }
      const sts = client(keys ?? provider, env);
      try {
        const r = await sts.send(new GetCallerIdentityCommand({}));
        return { ok: true, account: r.Account ?? "", arn: r.Arn ?? "", ...(keys ? {} : { source }) };
      } catch (e) {
        return { ok: false, reason: "error", message: e instanceof Error ? e.message.slice(0, 300) : "failed" };
      } finally {
        sts.destroy();
      }
    },

    async s3Check(keys, b) {
      const s3 = s3Client(keys, b, env);
      const out: S3Check = { bucket: { ok: false }, versioning: { ok: false, status: "unknown" }, object: { ok: false, exists: false } };
      try {
        try { await s3.send(new HeadBucketCommand({ Bucket: b.bucket })); out.bucket = { ok: true }; } catch (e) { out.bucket = { ok: false, message: problem(e) }; return out; }
        try {
          const v = await s3.send(new GetBucketVersioningCommand({ Bucket: b.bucket }));
          const status = v.Status === "Enabled" ? "Enabled" : v.Status === "Suspended" ? "Suspended" : "Off";
          out.versioning = { ok: status === "Enabled", status };
        } catch (e) { out.versioning = { ok: false, status: "unknown", message: problem(e) }; }
        try { await s3.send(new HeadObjectCommand({ Bucket: b.bucket, Key: b.key })); out.object = { ok: true, exists: true }; } catch (e) {
          out.object = (e as { name?: string }).name === "NotFound" || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404 ? { ok: true, exists: false } : { ok: false, exists: false, message: problem(e) };
        }
        return out;
      } finally { s3.destroy(); }
    },

    async s3Read(keys, b) {
      const s3 = s3Client(keys, b, env);
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: b.bucket, Key: b.key }));
        return { text: (await r.Body?.transformToString("utf8")) ?? "", modifiedAt: r.LastModified ?? null };
      } catch (e) {
        if ((e as { name?: string }).name === "NoSuchKey") return null;
        throw new Error(problem(e));
      } finally { s3.destroy(); }
    },

    async assume(req) {
      const sts = client(base().provider, env);
      try {
        const r = await sts.send(new AssumeRoleCommand({ RoleArn: req.roleArn, RoleSessionName: req.sessionName, ExternalId: req.externalId, DurationSeconds: 3600 }));
        const c = r.Credentials;
        if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) return { ok: false, code: "other", message: "AWS answered without keys." };
        return { ok: true, keys: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration ?? null }, arn: r.AssumedRoleUser?.Arn ?? "", account: accountOf(req.roleArn) };
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        const message = e instanceof Error ? e.message.slice(0, 300) : "failed";
        if (name === "AccessDenied" || name === "AccessDeniedException") return { ok: false, code: "trust", message };
        if (["ExpiredToken", "ExpiredTokenException", "InvalidClientTokenId", "SignatureDoesNotMatch", "CredentialsProviderError"].includes(name) || /instance metadata|Could not load credentials/i.test(message)) return { ok: false, code: "base", message };
        return { ok: false, code: "other", message };
      } finally {
        sts.destroy();
      }
    },
  };
}

export const ROLE_ARN = /^arn:aws(-[a-z]+)*:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/;
export const accountOf = (arn: string): string => /^arn:aws(?:-[a-z]+)*:iam::(\d{12}):/.exec(arn)?.[1] ?? "";

/**
 * What goes into a trust policy for this server. An IAM user is its ARN; a role answers `sts:GetCallerIdentity` as an `assumed-role`
 * ARN, which is turned into the role's own ARN. STS leaves a role's path out, so such a role is flagged: the person must check the path.
 */
export function principalOf(identityArn: string): { principal: string; pathWarning: boolean } {
  const m = /^arn:(aws(?:-[a-z]+)*):sts::(\d{12}):assumed-role\/([^/]+)\//.exec(identityArn);
  if (m) return { principal: `arn:${m[1]}:iam::${m[2]}:role/${m[3]}`, pathWarning: true };
  return { principal: identityArn, pathWarning: false };
}

/** The name of a session, as CloudTrail will show it: who asked and for which run (at most 64 characters, the ones AWS allows). */
export function sessionName(username: string, runId: string): string {
  const user = username.replace(/[^\w+=,.@-]/g, "_");
  return `av2i-${user}-${runId.slice(0, 8)}`.slice(0, 64);
}

export function trustPolicy(principal: string, externalId: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { AWS: principal }, Action: "sts:AssumeRole", Condition: { StringEquals: { "sts:ExternalId": externalId } } }],
  }, null, 2) + "\n";
}

/** Read-only rights for the services the platform draws; the managed `ReadOnlyAccess` is the simple alternative. */
export function planPolicy(): string {
  const read = (prefix: string, verbs = ["Describe*", "List*", "Get*"]) => verbs.map((v) => `${prefix}:${v}`);
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Sid: "ReadWhatTheDesignDraws",
      Effect: "Allow",
      Action: [
        ...read("ec2"), ...read("rds", ["Describe*", "ListTagsForResource"]), ...read("s3", ["Get*", "List*"]), ...read("iam", ["Get*", "List*"]),
        ...read("elasticloadbalancing"), ...read("ecs"), ...read("ecr"), ...read("lambda", ["Get*", "List*"]), ...read("route53", ["Get*", "List*"]),
        ...read("cloudfront", ["Get*", "List*"]), ...read("acm", ["Describe*", "List*", "Get*"]), ...read("logs", ["Describe*", "List*"]),
        ...read("kms", ["Describe*", "List*", "Get*"]), "secretsmanager:DescribeSecret", ...read("wafv2", ["Get*", "List*"]),
      ],
      Resource: "*",
    }],
  }, null, 2) + "\n";
}

/** The AWS settings that are not credentials and may reach a run; the keys of the assumed role are added by the caller. */
const SETTINGS = /^(AWS_REGION|AWS_DEFAULT_REGION|AWS_ENDPOINT_URL(_[A-Z0-9_]+)?|AWS_CA_BUNDLE|AWS_USE_FIPS_ENDPOINT|AWS_USE_DUALSTACK_ENDPOINT)$/;

/** The environment of a run's process for one identity: the settings, plus the temporary keys of the role (never the server's own). */
export function awsEnv(keys: Keys | null, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && SETTINGS.test(k)) out[k] = v;
  if (keys) Object.assign(out, { AWS_ACCESS_KEY_ID: keys.accessKeyId, AWS_SECRET_ACCESS_KEY: keys.secretAccessKey, AWS_SESSION_TOKEN: keys.sessionToken });
  return out;
}

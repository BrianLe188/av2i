import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromContainerMetadata, fromEnv, fromInstanceMetadata } from "@aws-sdk/credential-providers";

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
}

const region = (env: NodeJS.ProcessEnv) => env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1";
const client = (credentials: Provider | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }, env: NodeJS.ProcessEnv) =>
  new STSClient({ credentials, region: region(env), maxAttempts: 1, requestHandler: { requestTimeout: 6000, connectionTimeout: 2500 } });

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

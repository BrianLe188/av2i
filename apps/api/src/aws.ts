import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { fromContainerMetadata, fromEnv, fromInstanceMetadata } from "@aws-sdk/credential-providers";

type Provider = ReturnType<typeof fromEnv>;

/**
 * The server's own AWS identity, from the same sources the tofu process can see: the AWS_* variables, the container role of ECS,
 * or the instance role of EC2. Profiles and credential files are left out on purpose: a run has its own empty home folder.
 */
export function serverCredentials(env: NodeJS.ProcessEnv = process.env): Provider | null {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return fromEnv();
  if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI) return fromContainerMetadata({ timeout: 1500, maxRetries: 0 });
  return fromInstanceMetadata({ timeout: 1500, maxRetries: 0 });
}

export type Identity = { ok: true; account: string; arn: string } | { ok: false; reason: "none" | "error"; message: string };

/** Who the server is in AWS (`sts:GetCallerIdentity`), or why it cannot say. */
export async function callerIdentity(env: NodeJS.ProcessEnv = process.env): Promise<Identity> {
  const credentials = serverCredentials(env);
  if (!credentials) return { ok: false, reason: "none", message: "No credentials." };
  // asking for the credentials first tells "nothing configured" (no variables, no role answering) from a call that AWS refused
  try {
    await credentials();
  } catch (e) {
    return { ok: false, reason: "none", message: e instanceof Error ? e.message.slice(0, 300) : "No credentials." };
  }
  const sts = new STSClient({ credentials, region: env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1", maxAttempts: 1, requestHandler: { requestTimeout: 4000, connectionTimeout: 2000 } });
  try {
    const r = await sts.send(new GetCallerIdentityCommand({}));
    return { ok: true, account: r.Account ?? "", arn: r.Arn ?? "" };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message.slice(0, 300) : "failed" };
  } finally {
    sts.destroy();
  }
}

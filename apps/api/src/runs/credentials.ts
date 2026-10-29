import type { AwsGateway } from "../aws.ts";
import { awsEnv, sessionName } from "../aws.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";

export interface RunIdentity {
  /** the AWS part of the tofu process's environment */
  env: NodeJS.ProcessEnv;
  /** values to mask in the log */
  secrets: string[];
  /** one line for the top of the log */
  summary: string;
  roleArn: string | null;
  account: string | null;
}

/** What to tell a person when a role cannot be assumed; the code is what the gateway could tell apart. */
export function assumeProblem(code: "trust" | "base" | "other", roleArn: string, message: string): string {
  if (code === "trust") return `The role ${roleArn} did not let this server in: check its trust policy (the principal of this server and the ExternalId of the connection).`;
  if (code === "base") return `The server's own AWS identity is missing or not valid, so it could not assume ${roleArn}. (${message})`;
  return `AWS refused to let the server assume ${roleArn}: ${message}`;
}

/**
 * The identity a run takes (DD-025). A run of a project with a connection assumes that connection's role (plan or apply) with the server's
 * own identity and gets only the temporary keys; the server's own keys never reach the tofu process. A project with no connection runs
 * as the server itself only when the server was told to (development).
 */
export async function runIdentity(deps: { db: Db; config: Config; aws: AwsGateway }, run: { id: string; kind: "plan" | "apply" | "migrate"; connection_id: string | null; created_by: string | null }): Promise<RunIdentity> {
  const { db, config, aws } = deps;
  if (!run.connection_id) {
    if (!config.runWithServerIdentity) throw new Error("This project has no AWS connection. Choose one before running.");
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && /^AWS_/.test(k)) env[k] = v;
    return { env, secrets: [], summary: "Running as the server's own AWS identity (RUN_WITH_SERVER_IDENTITY).", roleArn: null, account: null };
  }
  const c = await db.selectFrom("aws_connections").select(["name", "plan_role_arn", "apply_role_arn", "external_id"]).where("id", "=", run.connection_id).executeTakeFirst();
  if (!c) throw new Error("The AWS connection of this run no longer exists.");
  const roleArn = run.kind !== "plan" ? c.apply_role_arn : c.plan_role_arn;
  if (!roleArn) throw new Error(`The connection "${c.name}" has no apply role, so it can only plan.`);
  const user = run.created_by ? (await db.selectFrom("users").select("username").where("id", "=", run.created_by).executeTakeFirst())?.username : undefined;
  const session = sessionName(user ?? "platform", run.id);
  const r = await aws.assume({ roleArn, externalId: c.external_id, sessionName: session });
  if (!r.ok) throw new Error(assumeProblem(r.code, roleArn, r.message));
  const account = /:(\d{12}):/.exec(roleArn)?.[1] ?? null;
  const until = r.keys.expiration ? `, keys valid until ${r.keys.expiration.toISOString()}` : "";
  return {
    env: awsEnv(r.keys),
    secrets: [r.keys.accessKeyId, r.keys.secretAccessKey, r.keys.sessionToken],
    summary: `Assumed ${roleArn} as session ${session} (connection "${c.name}"${until}).`,
    roleArn,
    account,
  };
}

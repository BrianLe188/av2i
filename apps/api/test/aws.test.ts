import { describe, expect, it } from "vitest";
import { accountOf, awsEnv, planPolicy, principalOf, ROLE_ARN, sessionName, trustPolicy } from "../src/aws.ts";

describe("role ARNs", () => {
  it("accepts a role ARN with or without a path, and refuses anything else", () => {
    for (const ok of ["arn:aws:iam::123456789012:role/plan", "arn:aws:iam::123456789012:role/team/path/plan-role", "arn:aws-cn:iam::123456789012:role/x", "arn:aws-us-gov:iam::123456789012:role/x"]) expect(ROLE_ARN.test(ok), ok).toBe(true);
    for (const bad of ["", "role/plan", "arn:aws:iam::12345:role/x", "arn:aws:iam::123456789012:user/x", "arn:aws:iam::123456789012:role/", "arn:aws:s3:::bucket", "arn:aws:iam::123456789012:role/a b"]) expect(ROLE_ARN.test(bad), bad).toBe(false);
  });
  it("reads the account from the ARN", () => {
    expect(accountOf("arn:aws:iam::123456789012:role/x")).toBe("123456789012");
    expect(accountOf("nonsense")).toBe("");
  });
});

describe("the principal of this server", () => {
  it("keeps an IAM user as it is and turns an assumed role into the role ARN, flagging the lost path", () => {
    expect(principalOf("arn:aws:iam::111122223333:user/av2i")).toEqual({ principal: "arn:aws:iam::111122223333:user/av2i", pathWarning: false });
    expect(principalOf("arn:aws:sts::111122223333:assumed-role/av2i-server/i-0abc")).toEqual({ principal: "arn:aws:iam::111122223333:role/av2i-server", pathWarning: true });
    expect(principalOf("arn:aws-cn:sts::111122223333:assumed-role/r/s").principal).toBe("arn:aws-cn:iam::111122223333:role/r");
  });
});

describe("session names", () => {
  it("uses only the characters AWS allows and at most 64", () => {
    expect(sessionName("alice", "0123456789abcdef")).toBe("av2i-alice-01234567");
    const odd = sessionName("a b/c\\d*é" + "x".repeat(100), "0123456789abcdef");
    expect(odd).toMatch(/^[\w+=,.@-]{1,64}$/);
    expect(odd.length).toBe(64);
  });
});

describe("generated policies", () => {
  it("makes a trust policy that names the principal and requires the ExternalId", () => {
    const p = JSON.parse(trustPolicy("arn:aws:iam::111122223333:role/av2i-server", "abc123"));
    expect(p.Statement[0]).toMatchObject({ Effect: "Allow", Principal: { AWS: "arn:aws:iam::111122223333:role/av2i-server" }, Action: "sts:AssumeRole", Condition: { StringEquals: { "sts:ExternalId": "abc123" } } });
  });
  it("makes a plan policy that only reads", () => {
    const actions: string[] = JSON.parse(planPolicy()).Statement.flatMap((s: { Action: string[] }) => s.Action);
    expect(actions.length).toBeGreaterThan(10);
    expect(actions.every((a) => /:(Describe|List|Get)/.test(a))).toBe(true);
    expect(actions.some((a) => /Create|Put|Delete|Update|Attach|Pass/.test(a))).toBe(false);
  });
});

describe("the AWS environment of a run", () => {
  it("never copies the server's keys, only settings, and adds the temporary keys", () => {
    const server = { AWS_ACCESS_KEY_ID: "AKIASERVER", AWS_SECRET_ACCESS_KEY: "s", AWS_SESSION_TOKEN: "t", AWS_PROFILE: "p", AWS_REGION: "eu-west-1", AWS_ENDPOINT_URL: "http://x", AWS_ENDPOINT_URL_S3: "http://s3", AWS_CA_BUNDLE: "/ca" };
    expect(awsEnv(null, server)).toEqual({ AWS_REGION: "eu-west-1", AWS_ENDPOINT_URL: "http://x", AWS_ENDPOINT_URL_S3: "http://s3", AWS_CA_BUNDLE: "/ca" });
    const e = awsEnv({ accessKeyId: "ASIAX", secretAccessKey: "sec", sessionToken: "tok", expiration: null }, server);
    expect(e).toMatchObject({ AWS_ACCESS_KEY_ID: "ASIAX", AWS_SECRET_ACCESS_KEY: "sec", AWS_SESSION_TOKEN: "tok", AWS_REGION: "eu-west-1" });
    expect(e.AWS_PROFILE).toBeUndefined();
  });
});

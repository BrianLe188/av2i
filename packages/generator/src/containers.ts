import type { Value } from "@av2i/model";
import { call, ref, type Block, type Expr } from "./hcl.ts";
import { blocksOf, hyphen, resource, template, toExpr, type PlanCtx } from "./ctx.ts";
import { roleDependencies, roleRef } from "./iam.ts";

/** `repository_url:tag` of the ECR repository connected to a consumer, else the image written on the node. */
function imageOf(c: PlanCtx, key: string, tag: unknown, fallback: unknown): Expr | undefined {
  const repo = c.g.imageOf(key);
  if (repo) return template(`\${aws_ecr_repository.${repo.key}.repository_url}:${typeof tag === "string" && tag ? tag : "latest"}`);
  return typeof fallback === "string" && fallback ? fallback : undefined;
}

/**
 * ECS on Fargate: a cluster per cluster node, and for each service node the task definition and the service. The
 * provider's defaults that do not suit the platform (desired count 0, launch type EC2, the VPC default group) are
 * always written out (decision D-005, services/ecs.md). Container definitions come from a structured subset (D-013).
 * Lambda functions, in a VPC when they sit in subnets.
 */
export function planContainers(c: PlanCtx): void {
  const { g, add } = c;
  for (const n of g.nodesOf("ecs")) {
    const name = (n.props.name as string | undefined) ?? hyphen(n.key);
    if (n.props.part === "cluster") {
      const blocks: Block[] = [];
      if (typeof n.props.container_insights === "string") blocks.push({ type: "setting", labels: [], args: [["name", "containerInsights"], ["value", n.props.container_insights]] });
      add("compute.tf", resource("aws_ecs_cluster", n.key, [["name", name], c.tags(n)], blocks), n.key);
      continue;
    }
    const containerName = (n.props.container_name as string | undefined) ?? hyphen(n.key);
    const container: Record<string, Expr> = { name: containerName };
    const image = imageOf(c, n.key, n.props.image_tag, n.props.image);
    if (image) container.image = image;
    container.essential = true;
    if (typeof n.props.container_port === "number") container.portMappings = [{ containerPort: n.props.container_port, protocol: "tcp" }];
    const env = n.props.environment;
    if (env !== null && typeof env === "object" && !Array.isArray(env) && Object.keys(env).length) {
      container.environment = Object.entries(env as Record<string, Value>).map(([k, v]) => ({ name: k, value: String(v) }));
    }
    const taskArgs: [string, Expr][] = [
      ["family", name],
      ["requires_compatibilities", ["FARGATE"]],
      ["network_mode", "awsvpc"],
      ["cpu", String(n.props.cpu ?? "256")],
      ["memory", String(n.props.memory ?? "512")],
    ];
    const exec = roleRef(g, n.key, "execution");
    if (exec) taskArgs.push(["execution_role_arn", exec]);
    const task = roleRef(g, n.key, "task");
    if (task) taskArgs.push(["task_role_arn", task]);
    taskArgs.push(["container_definitions", call("jsonencode", [container])]);
    add("compute.tf", resource("aws_ecs_task_definition", n.key, taskArgs), n.key);

    const cluster = typeof n.props.cluster === "string" ? g.node(n.props.cluster) : undefined;
    const args: [string, Expr][] = [["name", name]];
    if (cluster) args.push(["cluster", ref(`aws_ecs_cluster.${cluster.key}.id`)]);
    args.push(["task_definition", ref(`aws_ecs_task_definition.${n.key}.arn`)], ["desired_count", typeof n.props.desired_count === "number" ? n.props.desired_count : 1]);
    const strategy = n.props.capacity_provider_strategy;
    if (!strategy) args.push(["launch_type", "FARGATE"]);
    if (n.props.enable_execute_command === true) args.push(["enable_execute_command", true]);
    const blocks: Block[] = [];
    const sgs = g.securityGroupsOf(n.key);
    blocks.push({
      type: "network_configuration",
      labels: [],
      args: [
        ["subnets", g.subnetsOf(n.key).map((s) => ref(`aws_subnet.${s.key}.id`))],
        ["security_groups", sgs.map((s) => ref(`aws_security_group.${s.key}.id`))],
        ["assign_public_ip", n.props.assign_public_ip === true],
      ],
    });
    if (strategy) blocks.push(...blocksOf("capacity_provider_strategy", strategy as Value));
    const deps = roleDependencies(g, n.key);
    if (deps.length) args.push(["depends_on", deps]);
    add("compute.tf", resource("aws_ecs_service", n.key, args, blocks), n.key);
  }

  for (const n of g.nodesOf("lambda")) {
    const p = n.props;
    const args: [string, Expr][] = [["function_name", (p.function_name as string | undefined) ?? hyphen(n.key)]];
    const role = roleRef(g, n.key, "execution");
    if (role) args.push(["role", role]);
    const image = imageOf(c, n.key, p.image_tag, undefined);
    if (image) args.push(["package_type", "Image"], ["image_uri", image]);
    else {
      args.push(...c.optional(n, ["filename", "s3_bucket", "s3_key", "handler", "runtime"]));
    }
    args.push(...c.optional(n, ["architectures", "memory_size", "timeout", "reserved_concurrent_executions", "layers"]));
    const blocks: Block[] = [];
    if (typeof p.ephemeral_storage_size === "number") blocks.push({ type: "ephemeral_storage", labels: [], args: [["size", p.ephemeral_storage_size]] });
    const vars = p.environment_variables;
    if (vars !== null && typeof vars === "object" && !Array.isArray(vars) && Object.keys(vars).length) {
      blocks.push({ type: "environment", labels: [], args: [["variables", toExpr(vars as Value)]] });
    }
    const subnets = g.subnetsOf(n.key);
    if (subnets.length) {
      blocks.push({
        type: "vpc_config",
        labels: [],
        args: [
          ["subnet_ids", subnets.map((s) => ref(`aws_subnet.${s.key}.id`))],
          ["security_group_ids", g.securityGroupsOf(n.key).map((s) => ref(`aws_security_group.${s.key}.id`))],
        ],
      });
    }
    args.push(c.tags(n));
    const deps = roleDependencies(g, n.key);
    if (deps.length) args.push(["depends_on", deps]);
    add("compute.tf", resource("aws_lambda_function", n.key, args, blocks), n.key);
  }
}

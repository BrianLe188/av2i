import type { Value } from "@av2i/model";
import { ref, type Block, type Expr } from "./hcl.ts";
import { hyphen, resource, type PlanCtx } from "./ctx.ts";
import { roleRef } from "./iam.ts";

/**
 * A DB instance with the safe defaults of decision D-017: storage encrypted, the master password kept by RDS in
 * Secrets Manager, seven days of backups, not publicly accessible and a final snapshot. The DB subnet group is created
 * from the subnets the instance spans (relations/db-subnet-group.md). A password written on the node never reaches the
 * file: it becomes a sensitive variable.
 */
export function planDatabase(c: PlanCtx): void {
  const { g, add } = c;
  for (const n of g.nodesOf("rds")) {
    const subnets = g.subnetsOf(n.key);
    const groupName = hyphen(n.key);
    add("database.tf", resource("aws_db_subnet_group", n.key, [["name", groupName], ["subnet_ids", subnets.map((s) => ref(`aws_subnet.${s.key}.id`))], c.tags(n)]), n.key);

    const identifier = (n.props.identifier as string | undefined) ?? groupName;
    const p = n.props;
    const args: [string, Expr][] = [["identifier", identifier], ["engine", p.engine as string]];
    const opt = (keys: string[]) => args.push(...c.optional(n, keys));
    opt(["engine_version"]);
    args.push(["instance_class", p.instance_class as string], ["allocated_storage", p.allocated_storage as number]);
    opt(["max_allocated_storage", "storage_type"]);
    args.push(["storage_encrypted", typeof p.storage_encrypted === "boolean" ? p.storage_encrypted : true]);
    opt(["kms_key_id", "db_name"]);
    args.push(["username", p.username as string]);
    if (typeof p.password === "string" && p.password !== "") {
      args.push(["password", ref(`var.${n.key}_password`)]);
      add("variables.tf", { type: "variable", labels: [`${n.key}_password`], args: [["type", ref("string")], ["sensitive", true]] }, n.key);
    } else {
      args.push(["manage_master_user_password", p.manage_master_user_password === false ? false : true]);
    }
    args.push(["db_subnet_group_name", ref(`aws_db_subnet_group.${n.key}.name`)]);
    const sgs = g.securityGroupsOf(n.key);
    if (sgs.length) args.push(["vpc_security_group_ids", sgs.map((s) => ref(`aws_security_group.${s.key}.id`))]);
    args.push(["publicly_accessible", p.publicly_accessible === true]);
    opt(["multi_az", "availability_zone", "port"]);
    args.push(["backup_retention_period", typeof p.backup_retention_period === "number" ? p.backup_retention_period : 7]);
    opt(["backup_window", "maintenance_window"]);
    args.push(["deletion_protection", p.deletion_protection === true]);
    const skip = p.skip_final_snapshot === true;
    args.push(["skip_final_snapshot", skip]);
    if (!skip) args.push(["final_snapshot_identifier", (p.final_snapshot_identifier as string | undefined) ?? `${identifier}-final`]);
    opt(["auto_minor_version_upgrade", "apply_immediately", "iam_database_authentication_enabled", "performance_insights_enabled", "copy_tags_to_snapshot"]);
    if (typeof p.monitoring_interval === "number" && p.monitoring_interval > 0) {
      args.push(["monitoring_interval", p.monitoring_interval]);
      const role = roleRef(g, n.key, "monitoring");
      if (role) args.push(["monitoring_role_arn", role]);
    }
    args.push(c.tags(n));
    add("database.tf", resource("aws_db_instance", n.key, args), n.key);
  }
}

export type { Block, Value };

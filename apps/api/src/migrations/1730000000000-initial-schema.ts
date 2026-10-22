import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Written with the Table API (not raw SQL) so it runs on both sql.js and PostgreSQL.
 * Databases created before migrations existed (by `synchronize`) already have these tables; skip them.
 */
export class InitialSchema1730000000000 implements MigrationInterface {
  name = 'InitialSchema1730000000000';

  private columns(q: QueryRunner) {
    const pg = q.connection.options.type === 'postgres';
    return {
      id: { name: 'id', type: pg ? 'uuid' : 'varchar', isPrimary: true, isGenerated: true, generationStrategy: 'uuid' as const },
      timestamp: (name: string) => ({
        name,
        type: pg ? 'timestamp' : 'datetime',
        default: pg ? 'now()' : "datetime('now')",
        isNullable: false,
      }),
    };
  }

  async up(q: QueryRunner) {
    const { id, timestamp } = this.columns(q);

    if (!(await q.hasTable('users'))) {
      await q.createTable(
        new Table({
          name: 'users',
          columns: [
            id,
            { name: 'githubId', type: 'varchar', isUnique: true },
            { name: 'login', type: 'varchar' },
            { name: 'name', type: 'varchar', isNullable: true },
            { name: 'avatarUrl', type: 'varchar', isNullable: true },
            timestamp('createdAt'),
          ],
        }),
      );
    }

    if (!(await q.hasTable('projects'))) {
      await q.createTable(
        new Table({
          name: 'projects',
          columns: [
            id,
            { name: 'ownerId', type: 'varchar', isNullable: true },
            { name: 'name', type: 'varchar' },
            { name: 'region', type: 'varchar', default: "'us-east-1'" },
            { name: 'graph', type: 'text' },
            timestamp('createdAt'),
            timestamp('updatedAt'),
          ],
          indices: [{ columnNames: ['ownerId'] }],
        }),
      );
    }

    if (!(await q.hasTable('project_versions'))) {
      await q.createTable(
        new Table({
          name: 'project_versions',
          columns: [
            id,
            { name: 'projectId', type: q.connection.options.type === 'postgres' ? 'uuid' : 'varchar' },
            { name: 'label', type: 'varchar', isNullable: true },
            { name: 'region', type: 'varchar', default: "'us-east-1'" },
            { name: 'graph', type: 'text' },
            timestamp('createdAt'),
          ],
          indices: [{ columnNames: ['projectId'] }],
          foreignKeys: [
            { columnNames: ['projectId'], referencedTableName: 'projects', referencedColumnNames: ['id'], onDelete: 'CASCADE' },
          ],
        }),
      );
    }
  }

  async down(q: QueryRunner) {
    await q.dropTable('project_versions', true);
    await q.dropTable('projects', true);
    await q.dropTable('users', true);
  }
}

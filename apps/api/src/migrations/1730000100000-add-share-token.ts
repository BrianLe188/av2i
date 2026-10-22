import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/** Read-only share links: a secret token on the project, unique when set. */
export class AddShareToken1730000100000 implements MigrationInterface {
  name = 'AddShareToken1730000100000';

  async up(q: QueryRunner) {
    const table = await q.getTable('projects');
    if (table?.findColumnByName('shareToken')) return;
    await q.addColumn('projects', new TableColumn({ name: 'shareToken', type: 'varchar', isNullable: true }));
    await q.createIndex('projects', new TableIndex({ columnNames: ['shareToken'], isUnique: true }));
  }

  async down(q: QueryRunner) {
    const table = await q.getTable('projects');
    const index = table?.indices.find((i) => i.columnNames.includes('shareToken'));
    if (index) await q.dropIndex('projects', index);
    await q.dropColumn('projects', 'shareToken');
  }
}

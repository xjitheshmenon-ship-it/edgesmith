const { loadModule, parseSync } = require('pgsql-parser');
const fs = require('fs');

async function main() {
  await loadModule();
  const sql = fs.readFileSync(__dirname + '/../migrations/001_init_schema.sql', 'utf8');
  const result = parseSync(sql);
  const stmts = result.stmts || result;
  console.log('Total top-level statements:', stmts.length);

  const tables = new Set();
  const dupes = [];
  let createTableCount = 0;
  let createIndexCount = 0;
  let alterCount = 0;
  let insertCount = 0;

  stmts.forEach((s) => {
    const stmt = s.stmt;
    if (stmt.CreateStmt) {
      createTableCount++;
      const name = stmt.CreateStmt.relation.relname;
      if (tables.has(name)) dupes.push(name);
      tables.add(name);
    } else if (stmt.IndexStmt) {
      createIndexCount++;
    } else if (stmt.AlterTableStmt) {
      alterCount++;
    } else if (stmt.InsertStmt) {
      insertCount++;
    }
  });

  console.log('CREATE TABLE statements:', createTableCount);
  console.log('CREATE INDEX statements:', createIndexCount);
  console.log('ALTER TABLE statements:', alterCount);
  console.log('INSERT statements:', insertCount);
  console.log('Unique table names:', tables.size);
  console.log('Duplicate table names:', dupes.length ? dupes : 'none');
  console.log('');
  console.log('Tables:', [...tables].sort().join(', '));
}

main().catch((e) => {
  console.error('VALIDATION FAILED:', e.message);
  process.exit(1);
});

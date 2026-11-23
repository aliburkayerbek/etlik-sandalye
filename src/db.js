const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 10 });

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// Tek bağlantı üzerinde transaction
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function audit(db, { userId = null, action, chairId = null, loanId = null, detail = null }) {
  await db.query(
    'INSERT INTO audit_log (user_id, action, chair_id, loan_id, detail) VALUES ($1,$2,$3,$4,$5)',
    [userId, action, chairId, loanId, detail ? JSON.stringify(detail) : null]
  );
}

module.exports = { pool, migrate, tx, audit };

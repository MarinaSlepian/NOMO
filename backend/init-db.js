import pg from 'pg';

const pool = new pg.Pool({
  connectionString: 'postgresql://nomo_db_user:BJ2nlfcsSWjqz2Wg6cx517ABTB2NGbHw@dpg-d13gkph5pdvs73dp102g-a.oregon-postgres.render.com:5432/nomo_db?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

const init = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_counters (
        option_id INT PRIMARY KEY,
        count INT NOT NULL DEFAULT 0
      );
    `);

    await pool.query(`
      INSERT INTO usage_counters (option_id, count) VALUES
      (1, 0), (2, 0), (3, 0), (4, 0), (5, 0)
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Table created and counters initialized.');
  } catch (err) {
    console.error('❌ Error initializing DB:', err);
  } finally {
    await pool.end();
  }
};

init();

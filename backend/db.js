import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://nomo_db_user:BJ2nlfcsSWjqz2Wg6cx517ABTB2NGbHw@dpg-d13gkph5pdvs73dp102g-a.oregon-postgres.render.com:5432/nomo_db?sslmode=require',
  ssl: { rejectUnauthorized: false },
});
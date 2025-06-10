// usage-db.js
import { pool } from './db.js';

// Increment the counter for a given optionId
export async function incrementCounter(optionId) {
  if (![1, 2, 3, 4, 5].includes(optionId)) {
    throw new Error('Invalid option ID');
  }

  await pool.query(
    'UPDATE usage_counters SET count = count + 1 WHERE option_id = $1',
    [optionId]
  );
}

// Optional: Get current counts
export async function getAllCounters() {
  const result = await pool.query(
    'SELECT option_id, count FROM usage_counters ORDER BY option_id'
  );
  return result.rows;
}
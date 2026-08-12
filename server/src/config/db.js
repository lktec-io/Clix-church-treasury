import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  connectionLimit: env.db.connectionLimit,
  decimalNumbers: false, // keep DECIMAL columns as strings — never let mysql2 coerce money to JS floats
  dateStrings: true,
  namedPlaceholders: true,
});

export async function withConnection(fn) {
  const connection = await pool.getConnection();
  try {
    return await fn(connection);
  } finally {
    connection.release();
  }
}

export async function withTransaction(fn) {
  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

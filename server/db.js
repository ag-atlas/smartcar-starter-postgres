'use strict';

// TODO: Store tokens securely with encryption.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Initialize database schema
 */
const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_tokens (
        vehicle_id VARCHAR(255) PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expiration TIMESTAMP WITH TIME ZONE NOT NULL,
        refresh_expiration TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database schema initialized');
  } finally {
    client.release();
  }
};

/**
 * Save or update vehicle tokens
 * @param {string} vehicleId 
 * @param {object} tokens - { accessToken, refreshToken, expiration, refreshExpiration }
 */
const saveVehicleTokens = async (vehicleId, tokens) => {
  const { accessToken, refreshToken, expiration, refreshExpiration } = tokens;
  await pool.query(
    `INSERT INTO vehicle_tokens (vehicle_id, access_token, refresh_token, expiration, refresh_expiration, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (vehicle_id) 
     DO UPDATE SET 
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expiration = EXCLUDED.expiration,
       refresh_expiration = EXCLUDED.refresh_expiration,
       updated_at = CURRENT_TIMESTAMP`,
    [vehicleId, accessToken, refreshToken, expiration, refreshExpiration]
  );
};

/**
 * Get tokens for a specific vehicle
 * @param {string} vehicleId 
 * @returns {object|null} tokens or null if not found
 */
const getVehicleTokens = async (vehicleId) => {
  const result = await pool.query(
    'SELECT * FROM vehicle_tokens WHERE vehicle_id = $1',
    [vehicleId]
  );
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    vehicleId: row.vehicle_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiration: new Date(row.expiration),
    refreshExpiration: new Date(row.refresh_expiration),
  };
};

/**
 * Get all stored vehicle IDs
 * @returns {Array} list of vehicle IDs with valid refresh tokens
 */
const getAllStoredVehicles = async () => {
  const result = await pool.query(
    `SELECT vehicle_id FROM vehicle_tokens 
     WHERE refresh_expiration > CURRENT_TIMESTAMP`
  );
  return result.rows.map(row => row.vehicle_id);
};

/**
 * Delete tokens for a vehicle
 * @param {string} vehicleId 
 */
const deleteVehicleTokens = async (vehicleId) => {
  await pool.query(
    'DELETE FROM vehicle_tokens WHERE vehicle_id = $1',
    [vehicleId]
  );
};

/**
 * Delete all vehicle tokens
 */
const deleteAllVehicleTokens = async () => {
  await pool.query('DELETE FROM vehicle_tokens');
};

module.exports = {
  pool,
  initializeDatabase,
  saveVehicleTokens,
  getVehicleTokens,
  getAllStoredVehicles,
  deleteVehicleTokens,
  deleteAllVehicleTokens,
};

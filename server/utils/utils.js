'use strict';
const smartcar = require('smartcar');
const jwt = require('jsonwebtoken');
const { get } = require('lodash');
const { vehicleProperties } = require('./vehicleProperties');
const { getVehicleTokens, saveVehicleTokens, getAllStoredVehicles } = require('../db');

// Auth client reference for token refresh
let authClient = null;

/**
 * Set the Smartcar auth client (called from index.js)
 * @param {object} client - Smartcar AuthClient instance
 */
const setAuthClient = (client) => {
  authClient = client;
};

/**
 * Helper function that returns smartcar vehicle instance.
 *
 * @param {string} vehicleId
 * @param {string} accessToken
 * @param {string} [unitSystem=metric] metric or imperial
 * @returns {object} vehicle
 */
const createSmartcarVehicle = (
  vehicleId,
  accessToken,
  unitSystem = 'metric',
) => {
  return new smartcar.Vehicle(vehicleId, accessToken, { unitSystem });
};

/**
 * Refresh tokens using the refresh token
 * @param {string} refreshToken 
 * @returns {object} new access object
 */
const refreshTokens = async (refreshToken) => {
  if (!authClient) {
    throw new Error('Auth client not initialized');
  }
  const newAccess = await authClient.exchangeRefreshToken(refreshToken);
  return newAccess;
};

/**
 * Get valid access token for a vehicle, refreshing if necessary
 * @param {string} vehicleId 
 * @returns {object} tokens object with accessToken
 */
const getAccessForVehicle = async (vehicleId) => {
  const tokens = await getVehicleTokens(vehicleId);
  if (!tokens) {
    throw new Error(`No tokens found for vehicle ${vehicleId}`);
  }

  // Check if access token is expired (with 5 minute buffer)
  const now = new Date();
  const expirationBuffer = 5 * 60 * 1000; // 5 minutes
  const isExpired = tokens.expiration.getTime() - expirationBuffer < now.getTime();

  if (isExpired) {
    // Check if refresh token is still valid
    if (tokens.refreshExpiration.getTime() < now.getTime()) {
      throw new Error('Refresh token expired, please reconnect vehicle');
    }

    // Refresh the tokens
    const newAccess = await refreshTokens(tokens.refreshToken);
    
    // Update tokens in database
    await saveVehicleTokens(vehicleId, {
      accessToken: newAccess.accessToken,
      refreshToken: newAccess.refreshToken,
      expiration: newAccess.expiration,
      refreshExpiration: newAccess.refreshExpiration,
    });

    return { accessToken: newAccess.accessToken };
  }

  return { accessToken: tokens.accessToken };
};

/**
 * Helper function that extracts the access object from session cookie or database.
 * Tries cookie first, then falls back to database for any stored vehicle.
 *
 * @param {object} req
 * @returns {object} access object with the accessToken field
 */
const getAccess = async (req) => {
  // First try to get from cookie (existing session)
  const accessCookie = req.cookies?.['my-starter-app'];
  if (accessCookie) {
    try {
      const access = jwt.verify(accessCookie, process.env.JWT_SECRET_KEY);
      // Check if token is still valid
      const now = new Date();
      const expirationBuffer = 5 * 60 * 1000; // 5 minutes
      if (new Date(access.expiration).getTime() - expirationBuffer > now.getTime()) {
        return access;
      }
      // Token from cookie is expired, try to refresh using stored refresh token
    } catch (err) {
      // Cookie invalid, fall through to database lookup
    }
  }

  // Try to get tokens from database
  const storedVehicleIds = await getAllStoredVehicles();
  if (storedVehicleIds.length > 0) {
    // Use the first vehicle's tokens (they're all from the same auth session)
    return await getAccessForVehicle(storedVehicleIds[0]);
  }

  throw new Error('No valid access token found. Please connect your vehicle.');
};

/**
 * Function to get vehicle attributes: id, make, model, year.
 *
 * @param {Array} vehicleIds list of vehicle ids
 * @param {string} accessToken 
 * @returns {object} vehicle attributes: id, make, model, year
 */
const getVehiclesWithAttributes = async (vehicleIds, accessToken) => {
  const vehiclePromises = vehicleIds.map((vehicleId) => {
    const vehicle = createSmartcarVehicle(vehicleId, accessToken);
    return vehicle.attributes();
  })
  const settlements = await Promise.allSettled(vehiclePromises);
  // TODO: handle case where attributes() throws error but we still have the vehicleId
  const vehiclesWithAttributes = settlements.map((settlement) => handleSettlement(settlement))
  return vehiclesWithAttributes;
}

/**
 * Helper function to process settled promise
 *
 * @param {object} settlement
 * @param {string} path gets value at path of settled promise
 * @param {string} errorMessage custom error message if promise is rejected
 * @param {Function} process cb function to process output
 * @returns {any}
 */
const handleSettlement = (settlement, path, errorMessage = 'Information unavailable', process) => {
  if (settlement.status === 'rejected') {
    // TODO: Implement backend error handling with settlement.reason 
    return {error: errorMessage}
  }
  let value;
  // use lodash to get nested fields
  if (path) {
    value = get(settlement.value, path);
  } else {
    let { meta, ...remainingValue } = settlement.value;
    value = remainingValue;
  }

  if (process) {
    value = process(value);
  }
  return value;
}

// You'll want to reserve this method for fetching vehicle info for the first time (onboarding)
// You may want to store this information in a database to avoid excessive api calls to Smartcar and to the vehicle
// To update data that may have gone stale, you can poll data or use our webhooks


/**
 * Helper function to process settled promise
 *
 * @param {string} vehicleId 
 * @param {string} accessToken
 * @param {Array} requestedProperties list of desired vehicle properties
 * @param {string} unitSystem imperial or metric
 * @param {string} [make] required only for brand-specific endpoints 
 * @returns {object} vehicle properties matching requestedProperties
 * 
 * You'll want to reserve this method for fetching vehicle info for the first time (onboarding)
 * And store this information in a database to avoid excessive api calls to Smartcar and to the vehicle
 * To update data that may have gone stale, you can poll data or use our webhooks
 */
const getVehicleInfo = async (vehicleId, accessToken, requestedProperties = [], unitSystem, make) => {
  const vehicleInfo = {
    id: vehicleId,
    make,
  };
  const vehicle = createSmartcarVehicle(vehicleId, accessToken, unitSystem);
  
  // Generate list of vehicle endpoints
  const endpoints = [];
  const supportedProperties = [];
  requestedProperties.forEach(requestedProperty => {
    const { supportedMakes, endpoint} = vehicleProperties[requestedProperty];
    let newEndpoint;
    if (supportedMakes && !supportedMakes.includes(make)) return;

    if (supportedMakes && supportedMakes.includes(make)) {
      newEndpoint = endpoint(make);
    } else {
      newEndpoint= endpoint;
    }
    supportedProperties.push(requestedProperty);

    if(newEndpoint && !endpoints.includes(newEndpoint)) endpoints.push(newEndpoint);
  })

  // Make batch requests, optimized to lessen load on vehicle battery
  const batchResponse = await vehicle.batch(endpoints);

  // process batchResponse, populate response body
  supportedProperties.forEach(property => {
    const { process } = vehicleProperties[property];
    const value = process(batchResponse, make);
    // omit properties with permission errors (likely incompatible endpoint)
    if (value.error && value.error.type === 'PERMISSION') return;

    vehicleInfo[property] = value;
  })
  return vehicleInfo;
}


module.exports = {
  createSmartcarVehicle,
  getAccess,
  getAccessForVehicle,
  getVehicleInfo,
  getVehiclesWithAttributes,
  handleSettlement,
  refreshTokens,
  setAuthClient,
};

/**
* @file auth.ts
* @description API Authentication Module.
* This module handles API key generation, cryptographic SHA-256 hashing for secure storage,
* and request authentication by validating the 'x-api-key' header against the PostgreSQL database.
*/

import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { pool } from './db.js';
import {HttpError} from './errors.js';

/**
* Hashes a raw API Key using SHA-256 for secure database storage and comparison.
*/
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
* Generates a new cryptographically secure random API Key with an 'mk_' prefix.
*/
export const newApiKey = () => 'mk_' + randomBytes(24).toString('hex');

/**
* Resolves the calling account from the x-api-key header.
* Throws a 401 HttpError if the key is missing, empty, or invalid.
*/

export async function authenticate(req: FastifyRequest): Promise<{ accountId: string}> {
  // Extract the x-api-key header from the incoming request headers   
  const key = req.headers['x-api-key'];

  // Validate that the header exists and is a non-empty string
  if (typeof key !== 'string' || key.length === 0) {
     throw new HttpError(401, 'missing_api_key' , 'x-api-key header is required');
  }

  // Query the database for the account matching the SHA-256 hash of API Key.
  const {rows} = await pool.query('SELECT id FROM accounts WHERE api_key_hash = $1', [
   hashKey(key),
  ]);

  // If no matching account is found, reject the request with a 401 Unauthorized error
  if (rows.length === 0 ){
    throw new HttpError(401, 'invalid_api_key', 'Invalid API Key');
  }

  // Return the account ID for use in subsequent request handlers
  return {accountId: rows[0].id};
  }
    
	

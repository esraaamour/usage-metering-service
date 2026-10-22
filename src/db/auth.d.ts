/**
* @file auth.ts
* @description API Authentication Module.
* This module handles API key generation, cryptographic SHA-256 hashing for secure storage,
* and request authentication by validating the 'x-api-key' header against the PostgreSQL database.
*/
import type { FastifyRequest } from 'fastify';
/**
* Hashes a raw API Key using SHA-256 for secure database storage and comparison.
*/
export declare const hashKey: (key: string) => string;
/**
* Generates a new cryptographically secure random API Key with an 'mk_' prefix.
*/
export declare const newApiKey: () => string;
/**
* Resolves the calling account from the x-api-key header.
* Throws a 401 HttpError if the key is missing, empty, or invalid.
*/
export declare function authenticate(req: FastifyRequest): Promise<{
    accountId: string;
}>;
//# sourceMappingURL=auth.d.ts.map
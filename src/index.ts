/**
 * @file index.ts
 * @description Application Entry Point.
 * Creates the Fastify server, registers a global error handler that converts application errors
 * into uniform JSON responses, mounts all API route modules under their /api prefixes,
 * and starts listening for incoming HTTP requests.
 */

import Fastify from 'fastify';
import dotenv from 'dotenv';
import { z } from 'zod';

import accountsRoutes from './routes/accounts.js';
import usersRoutes from './routes/users.js';
import plansRoutes from './routes/plans.js';
import assignmentsRoutes from './routes/assignments.js';
import usageRoutes from './routes/usage.js';
import { HttpError } from './db/errors.js';

// Load environment variables from the .env file (PORT, DATABASE_URL, ...)
dotenv.config();

// Create the Fastify instance with built-in request logging enabled
const server = Fastify({ logger: true });

// Turn HttpError and validation errors into proper JSON responses (401, 404, 409, 400...).
server.setErrorHandler((err, _req, reply) => {
  const e = err as any;

  // Known application errors: use the status code and error code defined when the error was thrown
  if (err instanceof HttpError) {
    const status = e.status ?? e.statusCode ?? 500;
    return reply.status(status).send({ error: { code: e.code, message: err.message } });
  }

  // Zod schema validation failures: respond with 400 and the list of validation issues
  if (err instanceof z.ZodError) {
    return reply.status(400).send({
      error: { code: 'validation_error', message: 'Invalid request', details: err.issues },
    });
  }

  // Unexpected errors: log the details server-side, but return a generic message to the client
  server.log.error(err);
  return reply.status(e.statusCode ?? 500).send({
    error: { code: 'internal', message: 'Internal error' },
  });
});

// Simple health-check endpoint to confirm the service is up
server.get('/', async () => ({ status: 'OK', message: 'Usage Metering Service is running!' }));

// Register each route module under its own URL prefix
server.register(accountsRoutes, { prefix: '/api/accounts' });
server.register(usersRoutes, { prefix: '/api/users' });
server.register(plansRoutes, { prefix: '/api/plans' });
server.register(assignmentsRoutes, { prefix: '/api/assignments' });
server.register(usageRoutes, { prefix: '/api/usage' });

// Start the HTTP server on PORT (default 3000), listening on all network interfaces
const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server is running on port ${port}`);
  } catch (err) {
    // Fail fast: log the error and exit if the server can't start (e.g. port already in use)
    server.log.error(err);
    process.exit(1);
  }
};

start();

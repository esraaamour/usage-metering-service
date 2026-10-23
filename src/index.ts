import Fastify from 'fastify';
import dotenv from 'dotenv';
import { z } from 'zod';

import accountsRoutes from './routes/accounts.js';
import usersRoutes from './routes/users.js';
import plansRoutes from './routes/plans.js';
import assignmentsRoutes from './routes/assignments.js';
import usageRoutes from './routes/usage.js';
import { HttpError } from './db/errors.js';

dotenv.config();

const server = Fastify({ logger: true });

// Turn HttpError and validation errors into proper JSON responses (401, 404, 409, 400...).
server.setErrorHandler((err, _req, reply) => {
  const e = err as any;
  if (err instanceof HttpError) {
    const status = e.status ?? e.statusCode ?? 500;
    return reply.status(status).send({ error: { code: e.code, message: err.message } });
  }
  if (err instanceof z.ZodError) {
    return reply.status(400).send({
      error: { code: 'validation_error', message: 'Invalid request', details: err.issues },
    });
  }
  server.log.error(err);
  return reply.status(e.statusCode ?? 500).send({
    error: { code: 'internal', message: 'Internal error' },
  });
});

server.get('/', async () => ({ status: 'OK', message: 'Usage Metering Service is running!' }));

server.register(accountsRoutes, { prefix: '/api/accounts' });
server.register(usersRoutes, { prefix: '/api/users' });
server.register(plansRoutes, { prefix: '/api/plans' });
server.register(assignmentsRoutes, { prefix: '/api/assignments' });
server.register(usageRoutes, { prefix: '/api/usage' });

const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server is running on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

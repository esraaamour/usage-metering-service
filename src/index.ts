import Fastify from 'fastify';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const server = Fastify({
  logger: true,
});

// Default health check route to verify the server is running
server.get('/', async (request, reply) => {
  return { status: 'OK', message: 'Usage Metering Service is running!' };
});

// Function to start the Fastify server
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

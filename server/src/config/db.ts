import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.MONGODB_URI) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Copy server/.env.example to server/.env and configure it.');
  }
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });
  logger.info({ db: mongoose.connection.name }, 'connected to MongoDB');
  // Make sure unique indexes (SKUs, slugs, order numbers, webhook ids) exist before serving traffic.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

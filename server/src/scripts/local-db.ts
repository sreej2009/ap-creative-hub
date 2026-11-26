/**
 * Local development database (no MongoDB install needed).
 * Starts a single-node replica set — so transactions work exactly like on
 * Atlas — with data persisted in server/.local-db/.
 *
 *   npm run db:local
 *   # then in server/.env:
 *   MONGODB_URI=mongodb://127.0.0.1:27017/ap-creative-hub?replicaSet=local
 *
 * For development only. Use MongoDB Atlas (or another managed replica set) in production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const dbPath = path.resolve(process.cwd(), '.local-db');
fs.mkdirSync(dbPath, { recursive: true });
// Port: LOCAL_DB_PORT, else the port in server/.env's local MONGODB_URI, else 27017.
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const uriPort = process.env.MONGODB_URI?.match(/^mongodb:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//)?.[1];
const port = Number(process.env.LOCAL_DB_PORT ?? uriPort ?? 27017);

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'local', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath }],
});

console.log(`\nLocal MongoDB replica set running.\n  URI: mongodb://127.0.0.1:${port}/ap-creative-hub?replicaSet=local\n  Data: ${dbPath}\nPress Ctrl+C to stop.\n`);

const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

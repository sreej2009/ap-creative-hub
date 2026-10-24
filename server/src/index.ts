import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { razorpayStatus } from './integrations/razorpay.js';
import { startJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';
import { notifications } from './services/notification.service.js';
import { integrationStatus } from './services/settings.service.js';

async function main() {
  await connectDb();
  const app = createApp();
  // Express 5 passes bind errors (e.g. EADDRINUSE) to this callback instead of throwing.
  const server = app.listen(env.PORT, (err?: Error) => {
    if (err) {
      logger.fatal({ err }, `could not listen on port ${env.PORT}`);
      process.exit(1);
    }
    logger.info(`A&P Creative Hub API listening on http://localhost:${env.PORT}`);
    const status = integrationStatus();
    for (const [name, s] of Object.entries(status)) {
      logger.info(`${name}: ${s.configured ? 'configured' : `not configured — ${'reason' in s ? s.reason : ''}`}`);
    }
    const rp = razorpayStatus();
    if (rp.configured && rp.mode === 'live') logger.warn('Razorpay LIVE mode is enabled. Real payments will be taken.');
  });
  const stopJobs = env.RUN_JOBS ? startJobs() : () => undefined;

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopJobs();
    server.close();
    await notifications.flush();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});

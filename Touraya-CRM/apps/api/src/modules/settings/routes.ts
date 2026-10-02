import type { FastifyPluginAsync } from 'fastify';
import { settingsSchema } from '@touraya/shared';
import { getSettings, saveSettings } from './service';

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  // Quick comments, cancel reasons and the call policy are needed by every agent.
  app.get('/settings', { preHandler: app.requireAuth }, async () => getSettings(app.db));

  app.put('/settings', { preHandler: app.requirePermission('settings.manage') }, async (request) =>
    saveSettings(app.db, settingsSchema.parse(request.body)),
  );
};

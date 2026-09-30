import type { FastifyPluginAsync } from 'fastify';
import { settingsSchema } from '@touraya/shared';
import { getSettings, saveSettings, toPublicSettings } from './service';

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  // Quick comments are needed by every agent; the rest is admin-only.
  app.get('/settings', { preHandler: app.requireAuth }, async () => toPublicSettings(await getSettings(app.db, app.secrets)));

  app.put('/settings', { preHandler: app.requirePermission('settings.manage') }, async (request) => {
    const input = settingsSchema.parse(request.body);
    return toPublicSettings(await saveSettings(app.db, app.secrets, input));
  });
};

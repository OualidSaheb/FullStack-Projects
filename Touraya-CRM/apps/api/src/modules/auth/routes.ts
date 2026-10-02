import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { loginSchema, ROLE_PERMISSIONS } from '@touraya/shared';
import { users } from '../../db/schema';
import { SESSION_COOKIE } from '../../lib/auth';
import { verifyPassword } from '../../lib/crypto';
import { HttpError } from '../../lib/errors';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password } = loginSchema.parse(req.body);
    const [user] = await app.db.select().from(users).where(eq(users.email, email));
    if (!user || !user.active || user.deletedAt || !(await verifyPassword(password, user.passwordHash)))
      throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
    await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await app.startSession(reply, user.id);
    return { ok: true };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.requireAuth }, async (req) => ({
    ...req.user,
    permissions: ROLE_PERMISSIONS[req.user.role],
  }));
};

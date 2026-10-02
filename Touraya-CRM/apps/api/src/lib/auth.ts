import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { can, type Permission, type Role } from '@touraya/shared';
import { users } from '../db/schema';
import { forbidden, HttpError } from './errors';

export const SESSION_COOKIE = 'touraya_session';
const SESSION_DAYS = 14;

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number };
    user: SessionUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: preHandlerAsyncHookHandler;
    requirePermission: (permission: Permission) => preHandlerAsyncHookHandler;
    startSession: (reply: FastifyReply, userId: number) => Promise<void>;
    forgetUser: (userId: number) => void;
  }
}

/**
 * Signed-in users, kept a few seconds so a page that fires several requests
 * does not read the same user row each time (each read is a trip to the database).
 * Any change to a user (role, deactivation, removal) forgets them at once.
 */
const USER_TTL_MS = 30_000;

export const authPlugin = fp(async (app) => {
  const userCache = new Map<number, { user: SessionUser | null; at: number }>();
  const secure = app.config.NODE_ENV === 'production';
  await app.register(cookie);
  await app.register(jwt, {
    secret: app.config.APP_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { expiresIn: `${SESSION_DAYS}d` },
    // The user is re-read (cached briefly, forgotten on any change) so role changes / deactivation apply immediately.
    formatUser: (payload) => ({ id: payload.sub }) as unknown as SessionUser,
  });

  async function authenticate(request: FastifyRequest) {
    try {
      await request.jwtVerify();
    } catch {
      throw new HttpError(401, 'يرجى تسجيل الدخول');
    }
    const id = request.user.id;
    let cached = userCache.get(id);
    if (!cached || Date.now() - cached.at > USER_TTL_MS) {
      const [u] = await app.db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, id));
      cached = { user: u?.active && !u.deletedAt ? { id: u.id, name: u.name, email: u.email, role: u.role } : null, at: Date.now() };
      userCache.set(id, cached);
    }
    if (!cached.user) throw new HttpError(401, 'الحساب غير مفعل');
    request.user = { ...cached.user };
  }

  app.decorate('requireAuth', authenticate);
  app.decorate('forgetUser', (userId: number) => void userCache.delete(userId));
  app.decorate('requirePermission', (permission: Permission) => async (request: FastifyRequest) => {
    await authenticate(request);
    if (!can(request.user.role, permission)) throw forbidden();
  });
  app.decorate('startSession', async (reply: FastifyReply, userId: number) => {
    const token = await reply.jwtSign({ sub: userId });
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: SESSION_DAYS * 24 * 3600,
    });
  });
});

export function assertCan(user: SessionUser, permission: Permission) {
  if (!can(user.role, permission)) throw forbidden();
}

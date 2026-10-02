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
  }
}

export const authPlugin = fp(async (app) => {
  const secure = app.config.NODE_ENV === 'production';
  await app.register(cookie);
  await app.register(jwt, {
    secret: app.config.APP_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { expiresIn: `${SESSION_DAYS}d` },
    // Re-read the user on every request so role changes / deactivation apply immediately.
    formatUser: (payload) => ({ id: payload.sub }) as unknown as SessionUser,
  });

  async function authenticate(request: FastifyRequest) {
    try {
      await request.jwtVerify();
    } catch {
      throw new HttpError(401, 'يرجى تسجيل الدخول');
    }
    const [user] = await app.db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, request.user.id));
    if (!user?.active || user.deletedAt) throw new HttpError(401, 'الحساب غير مفعل');
    request.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  app.decorate('requireAuth', authenticate);
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

import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { QUEUE_STATUSES, userCreateSchema, userUpdateSchema, type UserDTO } from '@touraya/shared';
import { orders, users } from '../../db/schema';
import { hashPassword } from '../../lib/crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';

const idParams = z.object({ id: z.coerce.number().int() });

export const toUserDTO = (u: typeof users.$inferSelect): UserDTO => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
});

export const userRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: app.requirePermission('users.manage') };

  // Every signed-in user can list colleagues (assignment filter, activity log names).
  app.get('/users', { preHandler: app.requireAuth }, async () =>
    (await app.db.select().from(users).where(isNull(users.deletedAt)).orderBy(asc(users.id))).map(toUserDTO),
  );

  app.post('/users', manage, async (req) => {
    const { password, ...input } = userCreateSchema.parse(req.body);
    const [exists] = await app.db.select({ id: users.id }).from(users).where(and(eq(users.email, input.email), isNull(users.deletedAt)));
    if (exists) throw conflict('البريد مستعمل من قبل');
    const [u] = await app.db.insert(users).values({ ...input, passwordHash: await hashPassword(password) }).returning();
    return toUserDTO(u!);
  });

  app.put('/users/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const { password, ...input } = userUpdateSchema.parse(req.body);
    if (id === req.user.id && (input.active === false || (input.role && input.role !== 'admin')))
      throw badRequest('لا يمكنك إلغاء صلاحياتك بنفسك');
    const [u] = await app.db
      .update(users)
      .set({ ...input, ...(password ? { passwordHash: await hashPassword(password) } : {}), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!u) throw notFound();
    return toUserDTO(u);
  });

  /**
   * Removes an employee: no more login, hidden from lists and assignment.
   * Their name stays in the activity log and statistics of past orders.
   */
  app.delete('/users/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    if (id === req.user.id) throw badRequest('لا يمكنك حذف حسابك');
    const [u] = await app.db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (!u) throw notFound();
    await app.db.transaction(async (tx) => {
      // Free the e-mail so the same person can be added again later.
      await tx.update(users).set({ deletedAt: new Date(), active: false, email: `${u.email}#deleted-${u.id}` }).where(eq(users.id, id));
      // Their open (not yet confirmed) orders go back to the shared queue.
      await tx
        .update(orders)
        .set({ assignedToId: null, lockedById: null, lockedUntil: null })
        .where(and(eq(orders.assignedToId, id), inArray(orders.status, QUEUE_STATUSES)));
    });
    return { ok: true };
  });
};

import type { FastifyPluginAsync } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { productSchema, type ProductDTO } from '@touraya/shared';
import { products } from '../../db/schema';
import { notFound } from '../../lib/errors';

const idParams = z.object({ id: z.coerce.number().int() });
const toDTO = ({ createdAt: _c, updatedAt: _u, ...p }: typeof products.$inferSelect): ProductDTO => p;

export const productRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: app.requirePermission('products.manage') };

  app.get('/products', { preHandler: app.requireAuth }, async () =>
    (await app.db.select().from(products).orderBy(asc(products.id))).map(toDTO),
  );

  app.post('/products', manage, async (req) => {
    const [p] = await app.db.insert(products).values(productSchema.parse(req.body)).returning();
    return toDTO(p!);
  });

  app.put('/products/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const [p] = await app.db.update(products).set({ ...productSchema.parse(req.body), updatedAt: new Date() }).where(eq(products.id, id)).returning();
    if (!p) throw notFound();
    return toDTO(p);
  });

  // Products are deactivated rather than deleted so existing orders keep their offer.
};

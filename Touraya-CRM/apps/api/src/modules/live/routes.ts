import type { FastifyPluginAsync } from 'fastify';

/**
 * Server-Sent Events: the browser keeps one connection open and is told the
 * moment an order arrives or changes (sound + notification), instead of
 * waiting for the next refresh. Pure HTTP, works behind any proxy.
 */
export const liveRoutes: FastifyPluginAsync = async (app) => {
  const open = new Set<() => void>();
  app.addHook('onClose', async () => open.forEach((close) => close()));

  app.get('/events/stream', { preHandler: app.requirePermission('orders.view') }, async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('ready', { at: new Date().toISOString() });

    const unsubscribe = [
      app.events.on('order.created', (p) => send('order.created', p)),
      app.events.on('order.status_changed', (p) => send('order.status_changed', p)),
    ];
    // Comment line every 25 s: keeps proxies from closing an idle connection.
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const close = () => {
      clearInterval(ping);
      unsubscribe.forEach((off) => off());
      open.delete(close);
      if (!res.writableEnded) res.end();
    };
    open.add(close);
    req.raw.on('close', close);
  });
};

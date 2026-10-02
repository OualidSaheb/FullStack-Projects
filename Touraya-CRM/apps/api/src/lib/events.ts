import { EventEmitter } from 'node:events';
import type { OrderStatus } from '@touraya/shared';

/**
 * In-process domain events, emitted after the transaction commits.
 * Extension point for automations: AI calling agent, SMS/WhatsApp, notifications…
 * Subscribers must never throw into the request (errors are logged).
 */
export interface DomainEvents {
  'order.created': { orderId: string; sourceId: number | null };
  'order.status_changed': { orderId: string; from: OrderStatus; to: OrderStatus; actorId: number | null };
}

export class EventBus {
  private emitter = new EventEmitter();

  constructor(private onError: (err: unknown, event: string) => void = () => {}) {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof DomainEvents>(event: K, handler: (payload: DomainEvents[K]) => void | Promise<void>) {
    this.emitter.on(event, (payload: DomainEvents[K]) => {
      Promise.resolve()
        .then(() => handler(payload))
        .catch((err) => this.onError(err, event));
    });
  }

  emit<K extends keyof DomainEvents>(event: K, payloads: DomainEvents[K] | DomainEvents[K][]) {
    for (const p of Array.isArray(payloads) ? payloads : [payloads]) this.emitter.emit(event, p);
  }
}

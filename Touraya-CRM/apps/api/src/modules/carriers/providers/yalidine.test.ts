import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCarrierConfig, type ExportableOrder } from '@touraya/shared';
import type { LoadedCarrier } from '../types';
import { resetYalidineGates, yalidine } from './yalidine';

const carrier: LoadedCarrier = { id: 1, name: 'Yalidine', provider: 'yalidine', apiEnabled: true, credentials: { apiId: 'id', apiToken: 'token' }, config: defaultCarrierConfig('yalidine') };
const order = (reference: string): ExportableOrder => ({
  id: reference, reference, customerName: 'Nadia Mohellebi', phone: '0770211672', phoneAlt: null, wilayaCode: 16, communeName: 'Alger Centre',
  address: null, productCarrierName: 'p 2pcs 3500', units: 2, price: 3500, itemsLabel: '', deliveryType: 'home', stopdeskId: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetYalidineGates();
});

describe('Yalidine parcels: weight', () => {
  it('sends no dimensions (Yalidine would mark the parcel over 5 kg), and adds the smallest ones only to parcels refused for it', async () => {
    const bodies: Record<string, unknown>[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>[];
      bodies.push(sent);
      const answer = Object.fromEntries(sent.map((p) =>
        p.order_id === 'TR-2' && !('weight' in p) ? [p.order_id, { success: false, message: 'The weight field is required.' }] : [p.order_id, { success: true, tracking: `yal-${p.order_id}` }]));
      return new Response(JSON.stringify(answer), { status: 200 });
    }));
    const results = await yalidine.createParcels(carrier, [order('TR-1'), order('TR-2')]);
    expect(results).toEqual([{ reference: 'TR-1', ok: true, tracking: 'yal-TR-1' }, { reference: 'TR-2', ok: true, tracking: 'yal-TR-2' }]);
    expect(bodies[0]!.every((p) => !('weight' in p) && !('length' in p))).toBe(true);
    // Only the refused parcel is sent again (never a parcel twice), as a small one (1 kg).
    expect(bodies[1]).toEqual([expect.objectContaining({ order_id: 'TR-2', weight: 1, length: 1, width: 1, height: 1 })]);
  });

  it('a weight set in the extra fields is sent as is', async () => {
    let sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ 'TR-3': { success: true, tracking: 'yal-3' } }), { status: 200 });
    }));
    await yalidine.createParcels({ ...carrier, config: { ...carrier.config, parcelDefaults: { weight: 6 } } }, [order('TR-3')]);
    expect(sent[0]).toMatchObject({ weight: 6 });
  });
});

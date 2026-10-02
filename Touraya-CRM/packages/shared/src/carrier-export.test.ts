import { describe, expect, it } from 'vitest';
import { buildExportRow, DEFAULT_EXPORT_COLUMNS, validateForCarrier, type ExportableOrder } from './carrier-export';

const order: ExportableOrder = {
  id: 'x',
  reference: 'TR-00012',
  customerName: 'Karim Ben Ali',
  phone: '0556251779',
  phoneAlt: null,
  wilayaCode: 16,
  communeName: 'Bab Ezzouar',
  address: null,
  productCarrierName: 'p 3pcs 4999',
  units: 3,
  price: 4999,
  itemsLabel: 'L noir + L gris + L bleu',
  deliveryType: 'home',
  stopdeskId: null,
};

describe('carrier export', () => {
  it('builds a Yalidine row with the agreed constants', () => {
    const headers = DEFAULT_EXPORT_COLUMNS.map((c) => c.header.split('\n')[0]);
    const row = Object.fromEntries(buildExportRow({ ...order, phoneAlt: '0661122334' }, DEFAULT_EXPORT_COLUMNS).map((v, i) => [headers[i], v]));
    expect(row).toMatchObject({
      'Wilaya de départ': 'Alger',
      nom: 'Karim Ben Ali',
      prénom: '/',
      téléphone: '0556251779,0661122334',
      adresse: 'Bab Ezzouar',
      'commune (nom)': 'Bab Ezzouar',
      'wilaya (nom)': 'Alger',
      numero_commande: 'TR-00012',
      produit: 'p 3pcs 4999',
      prix: 4999,
      'Assurer le colis ?': 'non',
      'valeur déclarée': 4999,
      'poids (en KG)': 0,
      'livraison gratuite': '',
    });
    expect(headers).toHaveLength(20);
  });

  it('validates required carrier fields', () => {
    expect(validateForCarrier(order)).toEqual([]);
    expect(validateForCarrier({ ...order, communeName: 'Oran', productCarrierName: null })).toHaveLength(2);
    expect(validateForCarrier({ ...order, deliveryType: 'stopdesk' })).toEqual(['رقم مكتب Stop desk ناقص']);
  });
});

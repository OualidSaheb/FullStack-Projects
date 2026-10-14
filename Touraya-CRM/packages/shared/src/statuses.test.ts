import { describe, expect, it } from 'vitest';
import { statusFromYalidine } from './statuses';

describe('Yalidine statuses', () => {
  it('maps every Yalidine tracking status, accents and case aside', () => {
    const cases: [string, string | null][] = [
      ['Pas encore expédié', 'sent_to_carrier'],
      ['Prêt à expédier', 'sent_to_carrier'],
      ['Ramassé', 'carrier_received'],
      ['Centre', 'carrier_received'],
      ['Reçu à Wilaya', 'carrier_received'],
      ['En attente du client', 'at_desk'],
      ['Sorti en livraison', 'out_for_delivery'],
      ['Tentative échouée', 'delivery_failed'],
      ['En alerte', 'delivery_failed'],
      ['Echèc livraison', 'delivery_failed'],
      ['Livré', 'delivered'],
      ['LIVRE', 'delivered'],
      ['Retour vers centre', 'returned'],
      ['Retourné au vendeur', 'returned'],
      ['Retour à retirer', 'returned'],
      ['Something new', null],
    ];
    for (const [label, status] of cases) expect([label, statusFromYalidine(label)]).toEqual([label, status]);
  });
});

import { getWilaya } from './geo';
import { isValidPhone } from './phone';

/**
 * Delivery-company file (Yalidine bulk import). Columns are a configurable
 * profile: each column takes either an order field or a constant, so the file
 * can follow the carrier template without code changes.
 */
export interface ExportableOrder {
  id: string;
  reference: string;
  customerName: string;
  phone: string | null;
  phoneAlt: string | null;
  wilayaCode: number | null;
  communeName: string | null;
  address: string | null;
  productCarrierName: string | null;
  quantity: number;
  price: number;
  size: string | null;
  colors: string | null;
}

export const EXPORT_FIELDS = {
  order_id: { label: 'رقم الطلبية', get: (o: ExportableOrder) => o.reference },
  firstname: { label: 'الاسم', get: (o: ExportableOrder) => splitName(o.customerName)[0] },
  familyname: { label: 'اللقب', get: (o: ExportableOrder) => splitName(o.customerName)[1] },
  full_name: { label: 'الاسم الكامل', get: (o: ExportableOrder) => o.customerName },
  contact_phone: { label: 'الهاتف', get: (o: ExportableOrder) => o.phone ?? '' },
  contact_phone_2: { label: 'هاتف احتياطي', get: (o: ExportableOrder) => o.phoneAlt ?? '' },
  phones: { label: 'الهواتف (مفصولة بفاصلة)', get: (o: ExportableOrder) => [o.phone, o.phoneAlt].filter(Boolean).join(',') },
  to_wilaya_name: { label: 'ولاية الوصول', get: (o: ExportableOrder) => getWilaya(o.wilayaCode)?.name ?? '' },
  to_wilaya_code: { label: 'رمز الولاية', get: (o: ExportableOrder) => o.wilayaCode ?? '' },
  to_commune_name: { label: 'البلدية', get: (o: ExportableOrder) => o.communeName ?? '' },
  address: { label: 'العنوان', get: (o: ExportableOrder) => o.address || o.communeName || '' },
  product_list: { label: 'المنتج (الاسم المشفر)', get: (o: ExportableOrder) => o.productCarrierName ?? '' },
  price: { label: 'السعر', get: (o: ExportableOrder) => o.price },
  declared_value: { label: 'القيمة المصرح بها', get: (o: ExportableOrder) => o.price },
  quantity: { label: 'الكمية', get: (o: ExportableOrder) => o.quantity },
  size: { label: 'المقاس', get: (o: ExportableOrder) => o.size ?? '' },
  colors: { label: 'الألوان', get: (o: ExportableOrder) => o.colors ?? '' },
} as const;

export type ExportFieldKey = keyof typeof EXPORT_FIELDS;

export type ExportColumn =
  | { header: string; field: ExportFieldKey }
  | { header: string; value: string | number };

/** Mirrors the carrier import template (integrations/yalidine/import-template.xlsx). */
export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Wilaya de départ', value: 'Alger' },
  { header: 'nom', field: 'full_name' },
  { header: 'prénom', value: '/' },
  { header: 'téléphone\n(si plusieurs numéro,\nséparez les par une virgule)', field: 'phones' },
  { header: 'adresse', field: 'address' },
  { header: 'commune (nom)', field: 'to_commune_name' },
  { header: 'wilaya (nom)', field: 'to_wilaya_name' },
  { header: "STOP DESK\n(si oui mettez\nl'ID du stopdesk)", value: '' },
  { header: 'numero_commande', field: 'order_id' },
  { header: 'produit', field: 'product_list' },
  { header: 'prix', field: 'price' },
  { header: 'Assurer le colis ?\n(oui ou non)\nvoir condition dans le site', value: 'non' },
  { header: 'valeur déclarée\n(la valeur du contenu du colis)', field: 'declared_value' },
  { header: 'longueur (en CM)\nfacultatif sauf\nsi surpoids', value: 0 },
  { header: 'largeur (en CM)\nfacultatif sauf\nsi surpoids', value: 0 },
  { header: 'hauteur (en CM)\nfacultatif sauf\nsi surpoids', value: 0 },
  { header: 'poids (en KG)\nfacultatif sauf\nsi surpoids', value: 0 },
  { header: 'livraison gratuite\n(si oui mettez OUI\nsinon laissez vide)', value: '' },
  { header: 'FAIRE UN ECHANGE?\n(si oui mettez OUI\nsinon laissez vide)', value: '' },
  { header: 'OBJET A RECUPERER', value: '' },
];

export function splitName(fullName: string): [string, string] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ['', ''];
  if (parts.length === 1) return [parts[0]!, parts[0]!];
  return [parts[0]!, parts.slice(1).join(' ')];
}

export function buildExportRow(order: ExportableOrder, columns: ExportColumn[]): (string | number)[] {
  return columns.map((c) => ('field' in c ? EXPORT_FIELDS[c.field].get(order) : c.value));
}

/** Problems that would make the carrier reject the parcel. Empty array = ready. */
export function validateForCarrier(o: ExportableOrder): string[] {
  const errors: string[] = [];
  if (!o.customerName.trim()) errors.push('اسم الزبون ناقص');
  if (!o.phone || !isValidPhone(o.phone)) errors.push('رقم الهاتف غير صالح');
  if (!getWilaya(o.wilayaCode)) errors.push('الولاية غير محددة');
  if (!o.communeName) errors.push('البلدية غير محددة');
  else if (!getWilaya(o.wilayaCode)?.communes.some((c) => c.name === o.communeName))
    errors.push('البلدية غير موجودة في قائمة الولاية');
  if (!o.productCarrierName) errors.push('المنتج بدون اسم مشفر');
  if (!(o.price > 0)) errors.push('السعر غير صحيح');
  return errors;
}

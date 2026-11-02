export const ROLES = ['admin', 'manager', 'agent', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'مدير النظام',
  manager: 'مسؤول',
  agent: 'موظف تأكيد',
  viewer: 'مشاهد فقط',
};

export const PERMISSIONS = [
  'orders.view',
  'orders.edit',
  'orders.status',
  'orders.status.any', // set system statuses (shipping, delivered…) by hand
  'orders.assign',
  'orders.comment',
  'orders.delete',
  'orders.purge',
  'shipping.export',
  'shipping.send', // send confirmed orders to the carrier (API) — agents too when the setting allows it
  'returns.manage',
  'inventory.view',
  'inventory.manage',
  'customers.blacklist',
  'stats.view',
  'stats.carrier', // the delivery company's real figures (its own account)
  'products.manage',
  'users.manage',
  'sources.manage',
  'settings.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const AGENT: Permission[] = ['orders.view', 'orders.edit', 'orders.status', 'orders.comment', 'inventory.view'];
const MANAGER: Permission[] = [
  ...AGENT,
  'orders.status.any',
  'orders.assign',
  'orders.delete',
  'shipping.export',
  'shipping.send',
  'returns.manage',
  'inventory.view',
  'inventory.manage',
  'customers.blacklist',
  'stats.view',
  'stats.carrier',
  'products.manage',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  manager: MANAGER,
  agent: AGENT,
  viewer: ['orders.view', 'inventory.view'],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** What can be granted to one person on top of their role (Admin > employees). */
export const GRANTABLE_PERMISSIONS: { permission: Permission; label: string }[] = [
  { permission: 'stats.carrier', label: 'إحصائيات شركة التوصيل (الحساب الفعلي)' },
  { permission: 'stats.view', label: 'كل الإحصائيات' },
  { permission: 'shipping.send', label: 'إرسال الطلبيات لشركة التوصيل' },
  { permission: 'returns.manage', label: 'المرتجعات' },
  { permission: 'inventory.manage', label: 'تعديل المخزون' },
];

/** Permissions an admin can grant to agents from the settings (on top of their role). */
export function settingsPermissions(role: Role, settings: { agentsCanShip?: boolean }): Permission[] {
  return role === 'agent' && settings.agentsCanShip ? ['shipping.send'] : [];
}

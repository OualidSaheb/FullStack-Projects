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
  'returns.manage',
  'inventory.view',
  'inventory.manage',
  'customers.blacklist',
  'stats.view',
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
  'returns.manage',
  'inventory.view',
  'inventory.manage',
  'customers.blacklist',
  'stats.view',
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

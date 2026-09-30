import { NavLink, Navigate, useParams } from 'react-router';
import { FileInput, ListChecks, Package, Settings2, Sheet, Truck, Users } from 'lucide-react';
import type { Permission } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/ui';
import { ImportTab } from './import-tab';
import { MappingTab } from './mapping-tab';
import { ProductsTab } from './products-tab';
import { SettingsTab } from './settings-tab';
import { SourcesTab } from './sources-tab';
import { UsersTab } from './users-tab';
import { YalidineTab } from './yalidine-tab';

const TABS: { key: string; label: string; icon: typeof Sheet; permission: Permission; element: () => React.ReactNode }[] = [
  { key: 'sources', label: 'المصادر', icon: Sheet, permission: 'sources.manage', element: () => <SourcesTab /> },
  { key: 'fields', label: 'أسئلة Facebook', icon: ListChecks, permission: 'sources.manage', element: () => <MappingTab /> },
  { key: 'import', label: 'استيراد القديم', icon: FileInput, permission: 'sources.manage', element: () => <ImportTab /> },
  { key: 'products', label: 'العروض', icon: Package, permission: 'products.manage', element: () => <ProductsTab /> },
  { key: 'users', label: 'الموظفون', icon: Users, permission: 'users.manage', element: () => <UsersTab /> },
  { key: 'yalidine', label: 'Yalidine', icon: Truck, permission: 'settings.manage', element: () => <YalidineTab /> },
  { key: 'settings', label: 'إعدادات عامة', icon: Settings2, permission: 'settings.manage', element: () => <SettingsTab /> },
];

export function AdminPage() {
  const { tab } = useParams();
  const can = useCan();
  const tabs = TABS.filter((t) => can(t.permission));
  const current = tabs.find((t) => t.key === tab);
  if (!current) return tabs[0] ? <Navigate to={`/admin/${tabs[0].key}`} replace /> : <Navigate to="/orders" replace />;

  return (
    <div className="space-y-5">
      <PageHeader title="الإدارة والإعدادات" />
      <nav className="flex gap-1 overflow-x-auto border-b border-line scroll-thin">
        {tabs.map(({ key, label, icon: Icon }) => (
          <NavLink
            key={key}
            to={`/admin/${key}`}
            className={({ isActive }) =>
              cn('-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition', isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      {current.element()}
    </div>
  );
}

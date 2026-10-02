import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bell, BellOff, Boxes, ClipboardList, LogOut, Menu, Moon, PhoneCall, Settings2, Sun, Trash2, Truck, Undo2, X } from 'lucide-react';
import { ROLE_LABELS, type Permission } from '@touraya/shared';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/queries';
import { useLiveEvents, useNotifyPref } from '@/lib/live';
import { PageLoader } from './ui';
import { SyncAlert } from './sync-alert';

const NAV: { to: string; label: string; short: string; icon: typeof ClipboardList; permission: Permission; mobile?: boolean }[] = [
  { to: '/work', label: 'وضع الاتصال', short: 'اتصال', icon: PhoneCall, permission: 'orders.status', mobile: true },
  { to: '/orders', label: 'الطلبيات', short: 'الطلبيات', icon: ClipboardList, permission: 'orders.view', mobile: true },
  { to: '/shipping', label: 'التوصيل', short: 'التوصيل', icon: Truck, permission: 'shipping.export', mobile: true },
  { to: '/returns', label: 'المرتجعات', short: 'مرتجعات', icon: Undo2, permission: 'returns.manage' },
  { to: '/inventory', label: 'المخزون', short: 'المخزون', icon: Boxes, permission: 'inventory.view', mobile: true },
  { to: '/stats', label: 'الإحصائيات', short: 'إحصائيات', icon: BarChart3, permission: 'stats.view' },
  { to: '/trash', label: 'المحذوفات', short: 'محذوفات', icon: Trash2, permission: 'orders.delete' },
  { to: '/admin', label: 'الإدارة والإعدادات', short: 'الإدارة', icon: Settings2, permission: 'sources.manage' },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
  }, [dark]);
  return [dark, setDark] as const;
}

export function AppShell() {
  const { data: me, error, isLoading } = useMe();
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [dark, setDark] = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notify, toggleNotify] = useNotifyPref();
  useLiveEvents(Boolean(me), notify);

  useEffect(() => {
    const onExpired = () => {
      qc.clear();
      navigate('/login', { replace: true });
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [navigate, qc]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
  if (!me) return <PageLoader />;

  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    navigate('/login');
  };

  const mobileNav = NAV.filter((n) => n.mobile && can(n.permission));
  const sidebar = (
    <nav className="flex h-full flex-col gap-1 bg-ink p-3 text-slate-300">
      <div className="mb-5 flex items-center gap-2.5 px-2 pt-2">
        <div className="grid size-9 place-items-center rounded-xl bg-indigo-500 text-lg font-bold text-white">T</div>
        <div>
          <p className="font-bold text-white">Touraya</p>
          <p className="text-[11px] text-slate-400">إدارة الطلبيات</p>
        </div>
      </div>
      {NAV.filter((n) => can(n.permission)).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
              isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#818cf8]' : 'hover:bg-white/5 hover:text-white',
            )
          }
        >
          <Icon className="size-[18px]" />
          {label}
        </NavLink>
      ))}
      <div className="mt-auto space-y-2 border-t border-white/10 pt-3">
        <div className="px-2">
          <p className="truncate text-sm font-medium text-white">{me.name}</p>
          <p className="text-xs text-slate-400">{ROLE_LABELS[me.role]}</p>
        </div>
        <div className="flex gap-1">
          <button onClick={toggleNotify} title={notify ? 'إيقاف صوت وإشعار الطلبيات الجديدة' : 'تفعيل صوت وإشعار الطلبيات الجديدة'} className="flex items-center justify-center rounded-lg px-2 py-2 text-xs hover:bg-white/5 hover:text-white">
            {notify ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </button>
          <button onClick={() => setDark(!dark)} className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-white/5 hover:text-white">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {dark ? 'فاتح' : 'داكن'}
          </button>
          <button onClick={logout} className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-white/5 hover:text-white">
            <LogOut className="size-4" />
            خروج
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-ink/50 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-64" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 lg:hidden">
          <button onClick={() => setMobileOpen(!mobileOpen)} aria-label="القائمة" className="rounded-lg p-1.5 hover:bg-subtle">
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="flex-1 font-bold">Touraya</span>
          <button onClick={toggleNotify} aria-label="صوت الطلبيات الجديدة" className="rounded-lg p-1.5 hover:bg-subtle">
            {notify ? <Bell className="size-5" /> : <BellOff className="size-5 text-faint" />}
          </button>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-3 pb-20 scroll-thin sm:p-4 lg:p-6 lg:pb-6">
          <SyncAlert />
          <Outlet />
        </main>
        {/* Phone navigation: the main screens one thumb away. */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}>
          {mobileNav.map(({ to, short, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => cn('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive ? 'text-primary' : 'text-muted')}>
              <Icon className="size-5" />
              {short}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

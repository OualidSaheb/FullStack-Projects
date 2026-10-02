import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './components/app-shell';
import { LoginPage } from './pages/login';
import { OrdersPage } from './features/orders/orders-page';
import { WorkPage } from './features/work/work-page';

/** Agent screens load first; manager/admin pages are fetched on demand (smaller first load on phones). */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/orders" replace /> },
      { path: 'work', element: <WorkPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'trash', element: <OrdersPage trash /> },
      { path: 'shipping', lazy: async () => ({ Component: (await import('./features/shipping/shipping-page')).ShippingPage }) },
      { path: 'returns', lazy: async () => ({ Component: (await import('./features/shipping/returns-page')).ReturnsPage }) },
      { path: 'inventory', lazy: async () => ({ Component: (await import('./features/inventory/inventory-page')).InventoryPage }) },
      { path: 'stats', lazy: async () => ({ Component: (await import('./features/stats/stats-page')).StatsPage }) },
      { path: 'admin', element: <Navigate to="/admin/catalog" replace /> },
      { path: 'admin/:tab', lazy: async () => ({ Component: (await import('./features/admin/admin-page')).AdminPage }) },
      { path: '*', element: <Navigate to="/orders" replace /> },
    ],
  },
]);

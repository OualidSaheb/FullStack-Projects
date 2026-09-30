import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './components/app-shell';
import { LoginPage } from './pages/login';
import { OrdersPage } from './features/orders/orders-page';
import { ShippingPage } from './features/shipping/shipping-page';
import { StatsPage } from './features/stats/stats-page';
import { AdminPage } from './features/admin/admin-page';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/orders" replace /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'trash', element: <OrdersPage trash /> },
      { path: 'shipping', element: <ShippingPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'admin', element: <Navigate to="/admin/sources" replace /> },
      { path: 'admin/:tab', element: <AdminPage /> },
      { path: '*', element: <Navigate to="/orders" replace /> },
    ],
  },
]);

import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { StoreLayout } from './components/store/Layout';
import { PageLoader } from './components/ui/Feedback';
import { AccountLayout, AccountOrder, Addresses, Orders as AccountOrders, Profile } from './pages/account/Account';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/store/Auth';
import Cart from './pages/store/Cart';
import Checkout from './pages/store/Checkout';
import Home from './pages/store/Home';
import { Contact, Faq, PrivacyPolicy, ReturnsPolicy, ShippingPolicy, Terms } from './pages/store/Info';
import NotFound from './pages/store/NotFound';
import ProductDetail from './pages/store/ProductDetail';
import Shop from './pages/store/Shop';
import Track, { TrackLanding } from './pages/store/Track';
import Wishlist from './pages/store/Wishlist';

// Admin code is split into its own chunks.
const AdminLayout = lazy(() => import('./components/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminOrders = lazy(() => import('./pages/admin/Orders'));
const AdminOrderDetail = lazy(() => import('./pages/admin/OrderDetail'));
const AdminProducts = lazy(() => import('./pages/admin/Products'));
const ProductForm = lazy(() => import('./pages/admin/ProductForm'));
const Categories = lazy(() => import('./pages/admin/Categories'));
const Inventory = lazy(() => import('./pages/admin/Inventory'));
const Customers = lazy(() => import('./pages/admin/Customers'));
const CustomerDetail = lazy(() => import('./pages/admin/Customers').then((m) => ({ default: m.CustomerDetail })));
const Coupons = lazy(() => import('./pages/admin/Coupons'));
const Messages = lazy(() => import('./pages/admin/Logs').then((m) => ({ default: m.Messages })));
const Notifications = lazy(() => import('./pages/admin/Logs').then((m) => ({ default: m.Notifications })));
const Settings = lazy(() => import('./pages/admin/Settings'));

const S = (node: ReactNode) => <Suspense fallback={<PageLoader />}>{node}</Suspense>;

const router = createBrowserRouter([
  {
    element: <StoreLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'shop', element: <Shop /> },
      { path: 'shop/:slug', element: <Shop /> },
      { path: 'search', element: <Shop mode="search" /> },
      { path: 'product/:slug', element: <ProductDetail /> },
      { path: 'wishlist', element: <Wishlist /> },
      { path: 'cart', element: <Cart /> },
      { path: 'checkout', element: <Checkout /> },
      { path: 'track', element: <TrackLanding /> },
      { path: 'track/:orderNumber', element: <Track /> },
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
      { path: 'forgot-password', element: <ForgotPassword /> },
      { path: 'reset-password', element: <ResetPassword /> },
      {
        path: 'account',
        element: <AccountLayout />,
        children: [
          { index: true, element: <Profile /> },
          { path: 'addresses', element: <Addresses /> },
          { path: 'orders', element: <AccountOrders /> },
          { path: 'orders/:orderNumber', element: <AccountOrder /> },
        ],
      },
      { path: 'contact', element: <Contact /> },
      { path: 'faq', element: <Faq /> },
      { path: 'shipping', element: <ShippingPolicy /> },
      { path: 'returns', element: <ReturnsPolicy /> },
      { path: 'privacy', element: <PrivacyPolicy /> },
      { path: 'terms', element: <Terms /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: 'admin/login', element: S(<AdminLogin />) },
  {
    path: 'admin',
    element: S(<AdminLayout />),
    children: [
      { index: true, element: S(<Dashboard />) },
      { path: 'orders', element: S(<AdminOrders />) },
      { path: 'orders/:id', element: S(<AdminOrderDetail />) },
      { path: 'products', element: S(<AdminProducts />) },
      { path: 'products/new', element: S(<ProductForm />) },
      { path: 'products/:id', element: S(<ProductForm />) },
      { path: 'categories', element: S(<Categories />) },
      { path: 'inventory', element: S(<Inventory />) },
      { path: 'customers', element: S(<Customers />) },
      { path: 'customers/:id', element: S(<CustomerDetail />) },
      { path: 'coupons', element: S(<Coupons />) },
      { path: 'messages', element: S(<Messages />) },
      { path: 'notifications', element: S(<Notifications />) },
      { path: 'settings', element: S(<Settings />) },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import LoginPage from "./pages/LoginPage";
import AuthCallback from "./pages/AuthCallback";
import DashboardPage from "./pages/DashboardPage";
import DirectoryPage from "./pages/DirectoryPage";
import CardsPage from "./pages/CardsPage";
import AssetsPage from "./pages/AssetsPage";
import BrandingPage from "./pages/BrandingPage";
import ProductsPage from "./pages/ProductsPage";
import AssetTrackerPage from "./pages/AssetTrackerPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import CrmPage from "./pages/CrmPage";
import CampaignsPage from "./pages/CampaignsPage";
import QRCodesPage from "./pages/QRCodesPage";
import LandingPagesPage from "./pages/LandingPagesPage";
import LandingBuilderPage from "./pages/LandingBuilderPage";
import SignaturesPage from "./pages/SignaturesPage";
import ShortenerPage from "./pages/ShortenerPage";
import TransfersPage from "./pages/TransfersPage";
import PublicCardPage from "./pages/public/PublicCardPage";
import PublicLandingPage from "./pages/public/PublicLandingPage";
import PublicTransferPage from "./pages/public/PublicTransferPage";
import PublicDocPage from "./pages/public/PublicDocPage";

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      {/* Public, unauthenticated routes */}
      <Route path="/c/:slug" element={<PublicCardPage />} />
      <Route path="/p/:slug" element={<PublicLandingPage />} />
      <Route path="/t/:token" element={<PublicTransferPage />} />
      <Route path="/b/:id" element={<PublicDocPage base="brochures" />} />
      <Route path="/a/:id" element={<PublicDocPage base="assets" />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {loading ? (
        <Route path="*" element={<Loading />} />
      ) : !user ? (
        <>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      ) : (
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/marketing-assets" element={<AssetsPage />} />
          <Route path="/assets" element={<Navigate to="/marketing-assets" replace />} />
          <Route path="/branding" element={<BrandingPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/asset-tracker" element={<AssetTrackerPage />} />
          <Route path="/crm" element={<CrmPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/qrcodes" element={<QRCodesPage />} />
          <Route path="/landing-pages" element={<LandingPagesPage />} />
          <Route path="/landing-pages/:id/edit" element={<LandingBuilderPage />} />
          <Route path="/signatures" element={<SignaturesPage />} />
          <Route path="/shortener" element={<ShortenerPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      )}
    </Routes>
  );
}

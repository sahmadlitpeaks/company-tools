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
import QRCodesPage from "./pages/QRCodesPage";
import LandingPagesPage from "./pages/LandingPagesPage";
import LandingBuilderPage from "./pages/LandingBuilderPage";
import SignaturesPage from "./pages/SignaturesPage";
import ShortenerPage from "./pages/ShortenerPage";
import TransfersPage from "./pages/TransfersPage";
import PublicCardPage from "./pages/public/PublicCardPage";
import PublicLandingPage from "./pages/public/PublicLandingPage";
import PublicTransferPage from "./pages/public/PublicTransferPage";

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      {/* Public, unauthenticated routes */}
      <Route path="/c/:slug" element={<PublicCardPage />} />
      <Route path="/p/:slug" element={<PublicLandingPage />} />
      <Route path="/t/:token" element={<PublicTransferPage />} />
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
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/branding" element={<BrandingPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/qrcodes" element={<QRCodesPage />} />
          <Route path="/landing-pages" element={<LandingPagesPage />} />
          <Route path="/landing-pages/:id/edit" element={<LandingBuilderPage />} />
          <Route path="/signatures" element={<SignaturesPage />} />
          <Route path="/shortener" element={<ShortenerPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}

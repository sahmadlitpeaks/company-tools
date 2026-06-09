import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Protected from "./auth/Protected";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import { ForcePasswordChange } from "./components/ChangePassword";
import LoginPage from "./pages/LoginPage";
import AuthCallback from "./pages/AuthCallback";
import DashboardPage from "./pages/DashboardPage";
import DirectoryPage from "./pages/DirectoryPage";
import CardsPage from "./pages/CardsPage";
import AssetsPage from "./pages/AssetsPage";
import BrandingPage from "./pages/BrandingPage";
import ProductsPage from "./pages/ProductsPage";
import SharedPage from "./pages/SharedPage";
import TasksPage from "./pages/TasksPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import ServiceDeskPage from "./pages/ServiceDeskPage";
import KnowledgePage from "./pages/KnowledgePage";
import AnnouncementsPage from "./pages/AnnouncementsPage";
import LeavePage from "./pages/LeavePage";
import AuditPage from "./pages/AuditPage";
import PeopleOpsPage from "./pages/PeopleOpsPage";
import WorkLogPage from "./pages/WorkLogPage";
import MyDocsPage from "./pages/MyDocsPage";
import HubPage from "./pages/HubPage";
import AssetTrackerPage from "./pages/AssetTrackerPage";
import PhoneLinesPage from "./pages/PhoneLinesPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import ProfilePage from "./pages/ProfilePage";
import OrgChartPage from "./pages/OrgChartPage";
import PerformancePage from "./pages/PerformancePage";
import HrDashboardPage from "./pages/HrDashboardPage";
import DepartmentsPage from "./pages/DepartmentsPage";
import BrandsPage from "./pages/BrandsPage";
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
      ) : user.must_change_password ? (
        <Route path="*" element={<ForcePasswordChange />} />
      ) : (
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route
            path="/directory"
            element={<Protected module="directory"><DirectoryPage /></Protected>}
          />
          <Route
            path="/cards"
            element={<Protected module="cards"><CardsPage /></Protected>}
          />
          <Route
            path="/marketing-assets"
            element={<Protected module="marketing_assets"><AssetsPage /></Protected>}
          />
          <Route path="/assets" element={<Navigate to="/marketing-assets" replace />} />
          <Route
            path="/branding"
            element={<Protected module="branding"><BrandingPage /></Protected>}
          />
          <Route
            path="/products"
            element={<Protected module="products"><ProductsPage /></Protected>}
          />
          <Route
            path="/shared"
            element={<Protected module="shared"><SharedPage /></Protected>}
          />
          <Route
            path="/asset-tracker"
            element={<Protected module="asset_tracker"><AssetTrackerPage /></Protected>}
          />
          <Route
            path="/phone-lines"
            element={<Protected module="asset_tracker"><PhoneLinesPage /></Protected>}
          />
          <Route
            path="/subscriptions"
            element={<Protected module="subscriptions"><SubscriptionsPage /></Protected>}
          />
          <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
          <Route path="/people/:id" element={<Protected><ProfilePage /></Protected>} />
          <Route
            path="/org-chart"
            element={<Protected module="people_ops"><OrgChartPage /></Protected>}
          />
          <Route path="/performance" element={<Protected><PerformancePage /></Protected>} />
          <Route path="/hr" element={<Protected module="hr"><HrDashboardPage /></Protected>} />
          <Route
            path="/tasks"
            element={<Protected module="tasks"><TasksPage /></Protected>}
          />
          <Route
            path="/approvals"
            element={<Protected module="approvals"><ApprovalsPage /></Protected>}
          />
          <Route
            path="/leave"
            element={<Protected module="approvals"><LeavePage /></Protected>}
          />
          <Route
            path="/service-desk"
            element={<Protected module="service_desk"><ServiceDeskPage /></Protected>}
          />
          <Route
            path="/knowledge"
            element={<Protected module="knowledge"><KnowledgePage /></Protected>}
          />
          <Route
            path="/announcements"
            element={<Protected module="announcements"><AnnouncementsPage /></Protected>}
          />
          <Route
            path="/people-ops"
            element={<Protected module="people_ops"><PeopleOpsPage /></Protected>}
          />
          <Route path="/hub" element={<Protected><HubPage /></Protected>} />
          <Route
            path="/work-log"
            element={<Protected module="worklog"><WorkLogPage /></Protected>}
          />
          <Route
            path="/my-docs"
            element={<Protected module="workspace"><MyDocsPage /></Protected>}
          />
          <Route
            path="/crm"
            element={<Protected module="crm"><CrmPage /></Protected>}
          />
          <Route
            path="/campaigns"
            element={<Protected module="campaigns"><CampaignsPage /></Protected>}
          />
          <Route
            path="/qrcodes"
            element={<Protected module="qrcodes"><QRCodesPage /></Protected>}
          />
          <Route
            path="/landing-pages"
            element={<Protected module="landing_pages"><LandingPagesPage /></Protected>}
          />
          <Route
            path="/landing-pages/:id/edit"
            element={<Protected module="landing_pages"><LandingBuilderPage /></Protected>}
          />
          <Route
            path="/signatures"
            element={<Protected module="signatures"><SignaturesPage /></Protected>}
          />
          <Route
            path="/shortener"
            element={<Protected module="shortener"><ShortenerPage /></Protected>}
          />
          <Route
            path="/transfers"
            element={<Protected module="transfers"><TransfersPage /></Protected>}
          />
          <Route
            path="/brands"
            element={<Protected adminOnly><BrandsPage /></Protected>}
          />
          <Route
            path="/departments"
            element={<Protected adminOnly><DepartmentsPage /></Protected>}
          />
          <Route
            path="/audit"
            element={<Protected adminOnly><AuditPage /></Protected>}
          />
          <Route
            path="/settings"
            element={<Protected adminOnly><SettingsPage /></Protected>}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      )}
    </Routes>
  );
}

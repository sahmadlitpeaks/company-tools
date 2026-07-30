import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Protected from "./auth/Protected";
import { Loading } from "./components/ui";

const Layout = lazy(() => import("./components/Layout"));
const ForcePasswordChange = lazy(() => import("./components/ForcePasswordChangeRoute"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const DirectoryPage = lazy(() => import("./pages/DirectoryPage"));
const CardsPage = lazy(() => import("./pages/CardsPage"));
const AssetsPage = lazy(() => import("./pages/AssetsPage"));
const BrandingPage = lazy(() => import("./pages/BrandingPage"));
const ProductsPage = lazy(() => import("./pages/ProductsPage"));
const SharedPage = lazy(() => import("./pages/SharedPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const RoutineChecksPage = lazy(() => import("./pages/RoutineChecksPage"));
const ChecklistTemplatesPage = lazy(() => import("./pages/ChecklistTemplatesPage"));
const ApprovalsPage = lazy(() => import("./pages/ApprovalsPage"));
const ServiceDeskPage = lazy(() => import("./pages/ServiceDeskPage"));
const KnowledgePage = lazy(() => import("./pages/KnowledgePage"));
const AnnouncementsPage = lazy(() => import("./pages/AnnouncementsPage"));
const LeavePage = lazy(() => import("./pages/LeavePage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const PeopleOpsPage = lazy(() => import("./pages/PeopleOpsPage"));
const WorkLogPage = lazy(() => import("./pages/WorkLogPage"));
const MyDocsPage = lazy(() => import("./pages/MyDocsPage"));
const HubPage = lazy(() => import("./pages/HubPage"));
const AssetTrackerPage = lazy(() => import("./pages/AssetTrackerPage"));
const PhoneLinesPage = lazy(() => import("./pages/PhoneLinesPage"));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const OrgChartPage = lazy(() => import("./pages/OrgChartPage"));
const PerformancePage = lazy(() => import("./pages/PerformancePage"));
const HrDashboardPage = lazy(() => import("./pages/HrDashboardPage"));
const CustomFieldsAdminPage = lazy(() => import("./pages/CustomFieldsAdminPage"));
const AutomationsPage = lazy(() => import("./pages/AutomationsPage"));
const TimePage = lazy(() => import("./pages/TimePage"));
const InboxPage = lazy(() => import("./pages/InboxPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const RecruitingPage = lazy(() => import("./pages/RecruitingPage"));
const PayrollPage = lazy(() => import("./pages/PayrollPage"));
const BenefitsPage = lazy(() => import("./pages/BenefitsPage"));
const EngagementPage = lazy(() => import("./pages/EngagementPage"));
const ExpensesPage = lazy(() => import("./pages/ExpensesPage"));
const TrainingPage = lazy(() => import("./pages/TrainingPage"));
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
const WebhooksPage = lazy(() => import("./pages/WebhooksPage"));
const ApprovalWorkflowsPage = lazy(() => import("./pages/ApprovalWorkflowsPage"));
const ApiTokensPage = lazy(() => import("./pages/ApiTokensPage"));
const DepartmentsPage = lazy(() => import("./pages/DepartmentsPage"));
const CompaniesPage = lazy(() => import("./pages/CompaniesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const CrmPage = lazy(() => import("./pages/CrmPage"));
const CampaignsPage = lazy(() => import("./pages/CampaignsPage"));
const QRCodesPage = lazy(() => import("./pages/QRCodesPage"));
const LandingPagesPage = lazy(() => import("./pages/LandingPagesPage"));
const LandingBuilderPage = lazy(() => import("./pages/LandingBuilderPage"));
const SignaturesPage = lazy(() => import("./pages/SignaturesPage"));
const ShortenerPage = lazy(() => import("./pages/ShortenerPage"));
const TransfersPage = lazy(() => import("./pages/TransfersPage"));
const CafePage = lazy(() => import("./pages/CafePage"));
const BookingsPage = lazy(() => import("./pages/BookingsPage"));
const PublicCardPage = lazy(() => import("./pages/public/PublicCardPage"));
const PublicLandingPage = lazy(() => import("./pages/public/PublicLandingPage"));
const PublicTransferPage = lazy(() => import("./pages/public/PublicTransferPage"));
const PublicDocPage = lazy(() => import("./pages/public/PublicDocPage"));
const VisitorsPage = lazy(() => import("./pages/VisitorsPage"));
const PublicVisitorPage = lazy(() => import("./pages/public/PublicVisitorPage"));
const PurchasesPage = lazy(() => import("./pages/PurchasesPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const IdeasPage = lazy(() => import("./pages/IdeasPage"));
const AiHelpPage = lazy(() => import("./pages/AiHelpPage"));
const LostFoundPage = lazy(() => import("./pages/LostFoundPage"));

function StandaloneRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-svh place-items-center p-6">
          <div className="w-full max-w-md">
            <Loading />
          </div>
        </main>
      }
    >
      {children}
    </Suspense>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/visit/:token" element={<StandaloneRoute><PublicVisitorPage /></StandaloneRoute>} />
      {/* Public, unauthenticated routes */}
      <Route path="/c/:slug" element={<StandaloneRoute><PublicCardPage /></StandaloneRoute>} />
      <Route path="/p/:slug" element={<StandaloneRoute><PublicLandingPage /></StandaloneRoute>} />
      <Route path="/t/:token" element={<StandaloneRoute><PublicTransferPage /></StandaloneRoute>} />
      <Route path="/b/:id" element={<StandaloneRoute><PublicDocPage base="brochures" /></StandaloneRoute>} />
      <Route path="/a/:id" element={<StandaloneRoute><PublicDocPage base="assets" /></StandaloneRoute>} />
      <Route path="/auth/callback" element={<StandaloneRoute><AuthCallback /></StandaloneRoute>} />

      {loading ? (
        <Route path="*" element={<Loading />} />
      ) : !user ? (
        <>
          <Route path="/login" element={<StandaloneRoute><LoginPage /></StandaloneRoute>} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      ) : user.must_change_password ? (
        <Route path="*" element={<StandaloneRoute><ForcePasswordChange /></StandaloneRoute>} />
      ) : (
        <Route element={<StandaloneRoute><Layout /></StandaloneRoute>}>
          <Route path="/login" element={<Navigate to="/" replace />} />
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
          <Route path="/hr/custom-fields" element={<Protected module="hr"><CustomFieldsAdminPage /></Protected>} />
          <Route path="/hr/automations" element={<Protected module="hr"><AutomationsPage /></Protected>} />
          <Route path="/reports" element={<Protected module="hr"><ReportsPage /></Protected>} />
          <Route path="/payroll" element={<Protected module="hr"><PayrollPage /></Protected>} />
          <Route path="/benefits" element={<Protected module="hr"><BenefitsPage /></Protected>} />
          <Route path="/engagement" element={<EngagementPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/recruiting" element={<Protected module="recruiting"><RecruitingPage /></Protected>} />
          <Route path="/time" element={<Protected module="attendance"><TimePage /></Protected>} />
          <Route
            path="/tasks"
            element={<Protected module="tasks"><TasksPage /></Protected>}
          />
          <Route
            path="/routine-checks"
            element={<Protected module="routine_checks"><RoutineChecksPage /></Protected>}
          />
          <Route
            path="/checklists"
            element={<Protected module="routine_checks"><ChecklistTemplatesPage /></Protected>}
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
          <Route path="/cafe" element={<Protected module="cafe"><CafePage /></Protected>} />
          <Route path="/bookings" element={<Protected module="bookings"><BookingsPage /></Protected>} />
          <Route path="/visitors" element={<Protected module="visitors"><VisitorsPage /></Protected>} />
          <Route path="/purchases" element={<Protected module="purchases"><PurchasesPage /></Protected>} />
          <Route path="/calendar" element={<Protected module="calendar"><CalendarPage /></Protected>} />
          <Route path="/ideas" element={<Protected module="ideas"><IdeasPage /></Protected>} />
          <Route path="/ai-help" element={<Protected module="ai_help"><AiHelpPage /></Protected>} />
          <Route path="/lost-found" element={<Protected module="lost_found"><LostFoundPage /></Protected>} />
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
          <Route path="/inbox" element={<Protected module="crm"><InboxPage /></Protected>} />
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
            path="/companies"
            element={<Protected adminOnly><CompaniesPage /></Protected>}
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
          <Route
            path="/webhooks"
            element={<Protected adminOnly><WebhooksPage /></Protected>}
          />
          <Route
            path="/approval-workflows"
            element={<Protected adminOnly><ApprovalWorkflowsPage /></Protected>}
          />
          <Route
            path="/api-tokens"
            element={<Protected adminOnly><ApiTokensPage /></Protected>}
          />
          {/* Signing in leaves the browser on /login, which only exists in the
              unauthenticated tree — send it to the dashboard rather than 404. */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      )}
    </Routes>
  );
}

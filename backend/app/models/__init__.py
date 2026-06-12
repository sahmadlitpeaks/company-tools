"""Import all models so Alembic's autogenerate can see them."""
from app.models.user import User  # noqa: F401
from app.models.department import Department  # noqa: F401
from app.models.company import Company  # noqa: F401
from app.models.brand_document import BrandDocument, BrandDocumentVersion  # noqa: F401
from app.models.app_setting import AppSetting  # noqa: F401
from app.models.crm import CrmLead  # noqa: F401
from app.models.campaign import Campaign, CampaignMetric  # noqa: F401
from app.models.card import DigitalCard, CardScan, Lead  # noqa: F401
from app.models.asset import Folder, Asset  # noqa: F401
from app.models.branding import BrandKit, BrandAsset  # noqa: F401
from app.models.product import Product, Brochure  # noqa: F401
from app.models.qrcode import QRCode  # noqa: F401
from app.models.landing import LandingPage, LandingLead  # noqa: F401
from app.models.signature import EmailSignature, SignatureTemplate  # noqa: F401
from app.models.shortlink import ShortLink, LinkClick  # noqa: F401
from app.models.transfer import SecureTransfer  # noqa: F401
from app.models.tracked_asset import (  # noqa: F401
    AssetAttachment,
    AssetCategory,
    AssetEvent,
    AssetLocation,
    TrackedAsset,
)
from app.models.activity import ActivityLog  # noqa: F401
from app.models.notification import Notification  # noqa: F401
from app.models.saved_view import SavedView  # noqa: F401
from app.models.phone_line import PhoneBill, PhoneLine, PhoneLineEvent  # noqa: F401
from app.models.subscription import Subscription, SubscriptionSeat  # noqa: F401
from app.models.hr import (  # noqa: F401
    CompensationRecord,
    EmploymentEvent,
    Holiday,
    HrDocument,
    LeaveType,
    PayBand,
    PerformanceGoal,
    Review,
    ReviewCycle,
    SignatureRequest,
)
from app.models.custom_fields import (  # noqa: F401
    CustomFieldDef,
    CustomFieldValue,
    CustomTableDef,
    CustomTableRow,
)
from app.models.docversion import DocVersion  # noqa: F401
from app.models.people import (  # noqa: F401
    AccessGrant,
    OnboardingJourney,
    OnboardingTask,
    OnboardingTemplate,
    OnboardingTemplateItem,
)
from app.models.worklog import WorkLog  # noqa: F401
from app.models.timekeeping import TimeEntry, Timesheet, WorkSchedule  # noqa: F401
from app.models.intake import IntakeSource, Submission  # noqa: F401
from app.models.workspace import WorkspaceItem  # noqa: F401
from app.models.workplace import (  # noqa: F401
    Announcement,
    AnnouncementRead,
    ApprovalRequest,
    Attachment,
    KnowledgeArticle,
    LeaveBalance,
    Task,
    Ticket,
    TicketComment,
)
from app.models.recruiting import (  # noqa: F401
    Candidate,
    CandidateActivity,
    Interview,
    JobOpening,
    Offer,
)
from app.models.payroll import Payslip, PayrollRun  # noqa: F401
from app.models.benefits import (  # noqa: F401
    BenefitEnrollment,
    BenefitPlan,
    Dependent,
)
from app.models.engagement import (  # noqa: F401
    Kudos,
    Survey,
    SurveyAnswer,
    SurveyQuestion,
    SurveyResponse,
)
from app.models.performance import (  # noqa: F401
    ContinuousFeedback,
    OneOnOne,
    ReviewFeedback,
)
from app.models.webhook import Webhook, WebhookDelivery  # noqa: F401
from app.models.approval_workflow import (  # noqa: F401
    ApprovalStep,
    ApprovalWorkflow,
)
from app.models.field_audit import FieldChange  # noqa: F401
from app.models.expense import ExpenseClaim  # noqa: F401
from app.models.training import (  # noqa: F401
    Certification,
    Course,
    CourseAssignment,
)
from app.models.api_token import ApiToken  # noqa: F401

"""The code-defined permission catalogue (BRD section 7).

Every permission a role may hold is listed here, with the scope it applies to.
Nothing outside this file can invent a permission: roles, grants and overrides
are validated against it on save, so a stored permission always names a check
the code actually performs.

Scopes:

* ``platform`` - held across the whole system (granted through platform roles,
  department roles and per-person overrides). The legacy module keys from
  ``app.core.permissions.MODULES`` are also platform permissions: holding one
  opens that area, exactly as a module grant does today.
* ``project`` - held inside one project (granted through the member's project
  role plus per-member overrides).

A permission is added here in the same change that enforces it.
"""
from dataclasses import dataclass

from app.core.permissions import MODULES


@dataclass(frozen=True)
class PermissionDef:
    key: str
    scope: str  # platform | project
    group: str
    label: str
    description: str


PLATFORM_ACTIONS: list[PermissionDef] = [
    PermissionDef("roles.manage", "platform", "System", "Manage roles",
                  "Create, edit and delete roles, and grant platform roles to people and departments."),
    PermissionDef("projects.create", "platform", "Projects", "Create projects",
                  "Create a new project. The creator becomes its Project Admin."),
    PermissionDef("projects.view_all", "platform", "Projects", "View all projects",
                  "See every project and its issues read-only, without being a member."),
]

PROJECT_PERMISSIONS: list[PermissionDef] = [
    PermissionDef("project.view", "project", "Project", "View project",
                  "See the project, its issues, board and backlog."),
    PermissionDef("project.settings", "project", "Project", "Edit project settings",
                  "Change the project's name, dates, lead, sprint setting and shared team views."),
    PermissionDef("project.archive", "project", "Project", "Archive project",
                  "Archive or restore the project."),
    PermissionDef("members.manage", "project", "Project", "Manage members",
                  "Add and remove members, and change their role and permissions."),
    PermissionDef("issue.create", "project", "Issues", "Create issues",
                  "Create issues. People can always delete issues they created."),
    PermissionDef("issue.edit", "project", "Issues", "Edit any issue",
                  "Edit any issue's fields, links and attachments, and add watchers."),
    PermissionDef("issue.edit_own", "project", "Issues", "Edit own issues",
                  "Edit issues they reported or are assigned to."),
    PermissionDef("issue.delete", "project", "Issues", "Delete any issue",
                  "Delete issues created by anyone."),
    PermissionDef("issue.assign", "project", "Issues", "Assign issues",
                  "Change who an issue is assigned to. People with this or an edit permission can be assignees."),
    PermissionDef("issue.transition", "project", "Issues", "Change issue status",
                  "Move issues between workflow states."),
    PermissionDef("issue.comment", "project", "Issues", "Comment",
                  "Comment on issues."),
    PermissionDef("comment.delete_any", "project", "Issues", "Delete others' comments and attachments",
                  "Remove comments and attachments added by other people."),
    PermissionDef("sprint.manage", "project", "Planning", "Manage sprints",
                  "Create, start, complete, edit and delete sprints."),
    PermissionDef("workflow.configure", "project", "Planning", "Configure workflow",
                  "Edit the project's workflow states, issue types, components and fields."),
    PermissionDef("reports.view", "project", "Planning", "View reports",
                  "See burndown, velocity, workload and activity reports."),
    PermissionDef("decisions.create", "project", "Decisions & requirements", "Create decisions",
                  "Record and edit decisions."),
    PermissionDef("decisions.approve", "project", "Decisions & requirements", "Archive decisions",
                  "Archive closed decisions."),
    PermissionDef("requirements.manage", "project", "Decisions & requirements", "Manage requirements",
                  "Create and edit requirements and their links."),
    PermissionDef("share_links.manage", "project", "Sharing", "Manage share links",
                  "Create and revoke read-only share links for the project."),
    PermissionDef("import.run", "project", "Sharing", "Import from Jira",
                  "Import issues into the project from Jira."),
]

PLATFORM_MODULES: list[PermissionDef] = [
    PermissionDef(key, "platform", "Module access", label, f"Open the {label} area.")
    for key, label in MODULES
]

CATALOG: list[PermissionDef] = PLATFORM_ACTIONS + PLATFORM_MODULES + PROJECT_PERMISSIONS
BY_KEY: dict[str, PermissionDef] = {p.key: p for p in CATALOG}

PLATFORM_ACTION_KEYS: frozenset[str] = frozenset(p.key for p in PLATFORM_ACTIONS)
PLATFORM_MODULE_KEYS: frozenset[str] = frozenset(p.key for p in PLATFORM_MODULES)
PLATFORM_KEYS: frozenset[str] = PLATFORM_ACTION_KEYS | PLATFORM_MODULE_KEYS
PROJECT_KEYS: frozenset[str] = frozenset(p.key for p in PROJECT_PERMISSIONS)

SCOPES = ("platform", "project")


def keys_for_scope(scope: str) -> frozenset[str]:
    return PLATFORM_KEYS if scope == "platform" else PROJECT_KEYS


def ordered(keys, scope: str) -> list[str]:
    """Catalogue order, so stored lists and API output are stable."""
    wanted = set(keys)
    source = PLATFORM_ACTIONS + PLATFORM_MODULES if scope == "platform" else PROJECT_PERMISSIONS
    return [p.key for p in source if p.key in wanted]


# Starter project roles. Their keys match the legacy ``pm_project_members.role``
# values, so every existing membership already points at the right role.
CONTRIBUTOR_PERMISSIONS = [
    "project.view", "issue.create", "issue.edit", "issue.assign", "issue.transition",
    "issue.comment", "reports.view", "decisions.create", "requirements.manage",
]
VIEWER_PERMISSIONS = ["project.view", "issue.comment", "reports.view"]

STARTER_ROLES: list[dict] = [
    {"key": "admin", "scope": "project", "name": "Project Admin",
     "description": "Runs the project: settings, members, sprints and every issue.",
     "permissions": [p.key for p in PROJECT_PERMISSIONS]},
    {"key": "member", "scope": "project", "name": "Contributor",
     "description": "Creates, edits, assigns and moves issues; records decisions and requirements.",
     "permissions": CONTRIBUTOR_PERMISSIONS},
    {"key": "viewer", "scope": "project", "name": "Viewer",
     "description": "Reads the project and comments, for stakeholders and requesters.",
     "permissions": VIEWER_PERMISSIONS},
    {"key": "project_creator", "scope": "platform", "name": "Project Creator",
     "description": "Can create new projects without being a platform administrator.",
     "permissions": ["projects.create"]},
]
STARTER_PROJECT_ROLE_KEYS = ("admin", "member", "viewer")

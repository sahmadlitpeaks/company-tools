"""Workflow and field validation shared by web, imports and MCP."""
import math
from datetime import date

from fastapi import HTTPException

from app.schemas.pm_workspace import WorkspaceConfig


def configuration(project):
    return WorkspaceConfig.model_validate(project.workspace_config or {})


def apply_workspace_fields(project, data, issue=None):
    config = configuration(project)
    states = {state.key: state for state in config.states}
    old_key = (issue.workflow_state or issue.status) if issue else None
    if "workflow_state" in data:
        key = data["workflow_state"]
        if not key or key not in states:
            raise HTTPException(422, "Choose an existing workflow state.")
        state = states[key]
        # Full Edit forms also send the previous reporting category; the
        # selected named state determines the resulting category.
        data["status"] = state.category
    elif "status" in data and (issue is None or data["status"] != issue.status):
        key = data["status"]
        data["workflow_state"] = key
    else:
        key = old_key or "todo"
    if key not in states:
        raise HTTPException(422, "Choose an existing workflow state.")
    if issue and old_key != key:
        allowed = states.get(old_key).allowed_next if old_key in states else None
        if allowed is not None and key not in allowed:
            raise HTTPException(409, "This workflow transition is not allowed.")
    if issue is None:
        data["workflow_state"] = key
        data["status"] = states[key].category
    component = data.get("component", issue.component if issue else None)
    if component and component not in {item.key for item in config.components}:
        raise HTTPException(422, "Choose an existing component.")
    values = data.get("custom_fields", issue.custom_fields if issue else {}) or {}
    if len(values) > 30:
        raise HTTPException(422, "Too many custom fields.")
    fields = {field.key: field for field in config.fields}
    if any(key not in fields for key in values):
        raise HTTPException(422, "Unknown custom field.")
    for key, field in fields.items():
        value = values.get(key)
        empty = value is None or value == ""
        if empty:
            if field.required:
                raise HTTPException(422, f"{field.name} is required.")
            continue
        valid = True
        if field.kind == "text":
            valid = isinstance(value, str) and len(value) <= 4000
        elif field.kind == "number":
            valid = type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e12
        elif field.kind == "checkbox":
            valid = isinstance(value, bool)
        elif field.kind == "select":
            valid = value in field.options
        elif field.kind == "date":
            try:
                valid = isinstance(value, str) and date.fromisoformat(value).isoformat() == value
            except (ValueError, TypeError):
                valid = False
        if not valid:
            raise HTTPException(422, f"Enter a valid value for {field.name}.")
    if "custom_fields" in data or issue is None:
        data["custom_fields"] = values


def default_board_settings(sprints_enabled=True):
    return {"layout": "board", "board_type": "scrum" if sprints_enabled else "kanban"}

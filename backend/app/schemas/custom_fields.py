import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict


class FieldDefBase(BaseModel):
    section: str = "custom"
    key: str
    label: str
    field_type: str = "text"
    options: list[str] | None = None
    required: bool = False
    sensitive: bool = False
    sort: int = 0


class FieldDefCreate(FieldDefBase):
    pass


class FieldDefUpdate(BaseModel):
    section: str | None = None
    label: str | None = None
    field_type: str | None = None
    options: list[str] | None = None
    required: bool | None = None
    sensitive: bool | None = None
    sort: int | None = None
    active: bool | None = None


class FieldDefOut(FieldDefBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entity: str
    active: bool


class TableColumn(BaseModel):
    key: str
    label: str
    type: str = "text"
    options: list[str] | None = None


class TableDefBase(BaseModel):
    key: str
    label: str
    columns: list[TableColumn] = []
    sensitive: bool = False
    sort: int = 0


class TableDefCreate(TableDefBase):
    pass


class TableDefUpdate(BaseModel):
    label: str | None = None
    columns: list[TableColumn] | None = None
    sensitive: bool | None = None
    sort: int | None = None
    active: bool | None = None


class TableDefOut(TableDefBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    active: bool


class CustomSchema(BaseModel):
    fields: list[FieldDefOut] = []
    tables: list[TableDefOut] = []


# ---- per-employee values ----
class FieldValueOut(BaseModel):
    def_id: uuid.UUID
    key: str
    label: str
    section: str
    field_type: str
    options: list[str] | None = None
    sensitive: bool
    value: Any | None = None


class TableRowOut(BaseModel):
    id: uuid.UUID
    data: dict
    sort: int


class TableValuesOut(BaseModel):
    table_id: uuid.UUID
    key: str
    label: str
    columns: list[TableColumn] = []
    sensitive: bool
    rows: list[TableRowOut] = []


class CustomValuesOut(BaseModel):
    fields: list[FieldValueOut] = []
    tables: list[TableValuesOut] = []
    can_edit: bool = False


class FieldValuesIn(BaseModel):
    # def_id (str) -> value
    values: dict[uuid.UUID, Any]


class TableRowIn(BaseModel):
    data: dict
    sort: int = 0

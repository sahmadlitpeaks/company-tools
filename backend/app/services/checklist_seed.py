"""Starter checklist templates.

The IT round is a faithful transcription of the paper *Morning IT Checks
Report* so the team can validate the app against the form they already know.
The Facilities and Lab rounds exist to show the same machinery covering other
departments — different teams, schedules, response types and photo rules, no
code changes.

Seeded on demand via ``POST /api/checklist-templates/samples`` so nothing
appears in a database unless an admin asks for it.
"""

# The seven things checked in a fully-equipped meeting room, in form order.
_FULL_ROOM = [
    "TV",
    "Yealink WPP30 Wireless Presentation Pod",
    "Windows + K (Shared Screen)",
    "WiFi Connection TV",
    "Desk Phone",
    "Printer",
    "iOS Shared",
]
# Most rooms have no dedicated printer.
_ROOM = [c for c in _FULL_ROOM if c != "Printer"]
_ROOM_NO_POD = [c for c in _ROOM if not c.startswith("Yealink")]

# Building-level sweeps that close out each building on the form.
_SWEEPS = ["Check All Printers", "Check All Access Points"]

# Rooms whose every checkpoint must be evidenced with a photo.
_PHOTO_REQUIRED_SECTIONS = {
    "HQ Building / Dr T's Office (Inside)",
    "HQ Building / Dr T's Meeting Room",
}

# (section, [checkpoints]) in the order they appear on the paper form.
_IT_SECTIONS: list[tuple[str, list[str]]] = [
    ("HQ Building / Dr T's Office (Inside)", _FULL_ROOM),
    ("HQ Building / Dr T's Meeting Room", _FULL_ROOM),
    ("HQ Building / Upstairs", ["Check All Printers & Access Points"]),
    ("HQ Building / HQ Meeting Room", _ROOM),
    ("HQ Building / Family Lounge Room", _ROOM_NO_POD),
    ("HQ Building / VP Lounge Room", _ROOM_NO_POD),
    ("HQ Building / Family Meeting Room", _ROOM),
    ("HQ Building / Cafe", ["Cafe Phone"]),
    ("HQ Building", _SWEEPS),
    ("DNA Building / DNA Meeting Room", _ROOM),
    ("DNA Building / Proteomics Meeting Room", _ROOM),
    ("DNA Building", _SWEEPS),
    ("Agiomix Building / Genomics Meeting Room", _ROOM),
    ("Agiomix Building", _SWEEPS),
    ("Precision Wellness / Reception", ["TV", "WiFi Connection TV", "Desk Phone", "Printer"]),
    (
        "Precision Wellness / Upstairs Corridor TV",
        ["TV", "Windows + K (Shared Screen)", "WiFi Connection TV", "iOS Shared"],
    ),
    ("Precision Wellness", _SWEEPS),
]

# Page 5 of the form: every printer, by department and location. Link these to
# Asset Tracker records (item.asset_id) once the printers are in the inventory —
# then an Issue carries the asset straight into the ticket.
_PRINTERS: list[tuple[str, str]] = [
    ("Lab printer 1", "Agiomix Upstairs Lab"),
    ("Lab printer 2", "Agiomix Upstairs Lab"),
    ("Lab printer 3", "Agiomix Upstairs Lab"),
    ("HP-DXB-AGMX-RL", "Agiomix Upstairs Lab outside"),
    ("RICOH-DXB-AGMX-CA", "Agiomix Upstairs Corridor Area"),
    ("HP-DXB-AGMX-CRA", "Agiomix Corridor Area"),
    ("Dr T", "HQ Upstairs Dr T Office"),
    ("HP-DXB-HQ-NASSIM", "HQ Upstairs Nassim Outside Office"),
    ("HP-DXB-HQ-CS", "HQ-CS Office"),
    ("HQ-RICOH-CS Printer", "HQ-CS Office"),
    ("HQ-RICOH-Café", "HQ-RICOH-Café"),
    ("HP-DXB-HQ-HR", "DNA HR Office"),
    ("HP-DXB-DNA-FINANCE", "DNA Finance Office"),
    ("HP-DXB-DNA-PM", "DNA Corridor area"),
    ("HP-DXB-Wellness-RE", "Precision Wellness Reception"),
    ("HP-DXB-PHCX-Recep", "Precision Health Clinic Reception"),
    ("HP-DXB-TP360-1", "TP-Office No. 2206"),
    ("HP-DXB-TP360-2", "TP-Office No. 2212"),
    ("HP-DXB-LME", "LME-Office-Warehouse"),
]


def _it_items() -> list[dict]:
    items: list[dict] = []
    for section, checkpoints in _IT_SECTIONS:
        for title in checkpoints:
            items.append(
                {
                    "section": section,
                    "title": title,
                    "response_type": "ok_issue",
                    # Dr T's office and meeting room require photo evidence on
                    # every checkpoint.
                    "photo_required": section in _PHOTO_REQUIRED_SECTIONS,
                    "auto_ticket_on_issue": True,
                    "ticket_priority": "normal",
                }
            )
    for name, location in _PRINTERS:
        items.append(
            {
                "section": "Printer Check — All Locations",
                "title": f"{name} ({location})",
                "response_type": "ok_issue",
                "photo_required": False,
                "auto_ticket_on_issue": True,
                "ticket_priority": "normal",
            }
        )
    for i, item in enumerate(items):
        item["sort"] = i
    return items


def _facilities_items() -> list[dict]:
    """A different department, exercising readings and photo evidence."""
    spec: list[tuple[str, str, str, bool]] = [
        # (section, title, response_type, photo_required)
        ("HQ Building / Reception", "Entrance doors & access control", "ok_issue", False),
        ("HQ Building / Reception", "Lighting", "ok_issue", False),
        ("HQ Building / Washrooms", "Cleanliness", "ok_issue", True),
        ("HQ Building / Washrooms", "Consumables stocked", "ok_issue", False),
        ("HQ Building / Server Room", "Room temperature (°C)", "number", False),
        ("HQ Building / Server Room", "UPS status panel", "ok_issue", True),
        ("HQ Building / Kitchen", "Water dispenser", "ok_issue", False),
        ("HQ Building / Fire safety", "Extinguishers in place & in date", "ok_issue", False),
        ("HQ Building / Fire safety", "Emergency exits clear", "ok_issue", True),
        ("Grounds", "Parking & signage", "ok_issue", False),
        ("Grounds", "Waste collection done", "done", False),
        ("Handover", "Notes for the next shift", "text", False),
    ]
    return [
        {
            "section": section,
            "title": title,
            "response_type": rtype,
            "photo_required": photo,
            "auto_ticket_on_issue": True,
            "ticket_priority": "normal",
            "sort": i,
        }
        for i, (section, title, rtype, photo) in enumerate(spec)
    ]


def _lab_items() -> list[dict]:
    """A weekly round, showing a non-daily schedule and numeric readings."""
    spec: list[tuple[str, str, str, bool]] = [
        ("Genomics Lab", "Freezer −80 °C reading", "number", True),
        ("Genomics Lab", "Fridge 4 °C reading", "number", False),
        ("Genomics Lab", "Eyewash station flushed", "done", False),
        ("Genomics Lab", "Sharps bins below fill line", "ok_issue", False),
        ("Proteomics Lab", "Fume hood airflow", "ok_issue", False),
        ("Proteomics Lab", "Chemical spill kit sealed", "ok_issue", True),
        ("Proteomics Lab", "Calibration log signed", "done", False),
    ]
    return [
        {
            "section": section,
            "title": title,
            "response_type": rtype,
            "photo_required": photo,
            "auto_ticket_on_issue": True,
            "ticket_priority": "high",
            "sort": i,
        }
        for i, (section, title, rtype, photo) in enumerate(spec)
    ]


def starter_templates() -> list[dict]:
    """Template payloads matching :class:`ChecklistTemplateCreate`.

    ``department`` is a *name* the seeder resolves to an id — a starter round
    must ship routed to a department rota, or the runs it generates are visible
    only to managers and the team it was written for never sees them.
    """
    return [
        {
            "name": "Morning IT Checks",
            "department": "IT",
            "description": (
                "Daily walk-through of every building: meeting-room AV, phones, "
                "printers, access points and cameras. Transcribed from the paper "
                "Morning IT Checks Report."
            ),
            "team": "it",
            "schedule": "daily",
            "due_time": "09:00",
            "grace_minutes": 60,
            "requires_verification": True,
            "items": _it_items(),
        },
        {
            "name": "Facilities Daily Walk-through",
            "department": "Operations",
            "description": (
                "Daily building round: access, lighting, washrooms, server-room "
                "temperature, fire safety and grounds."
            ),
            "team": "facilities",
            "schedule": "weekdays",
            "due_time": "08:30",
            "grace_minutes": 90,
            "requires_verification": True,
            "items": _facilities_items(),
        },
        {
            "name": "Weekly Lab Safety Round",
            "department": "Operations",
            "description": (
                "Weekly lab sweep: cold-storage readings, safety equipment and "
                "calibration logs."
            ),
            "team": "other",
            "schedule": "weekly",
            "days_of_week": [1],
            "due_time": "11:00",
            "grace_minutes": 240,
            "requires_verification": True,
            "items": _lab_items(),
        },
    ]

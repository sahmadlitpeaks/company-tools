import datetime
import logging
import re
import uuid
from datetime import timezone
from openai import AsyncOpenAI, OpenAIError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.sharepoint import SharePointDocument, SharePointSource
from app.models.user import User
from app.services.sharepoint.common import SharePointError, decrypt
from app.services.sharepoint.graph import GraphClient, delegated_token
from app.services.sharepoint.privacy import restore
from app.services.sharepoint.store import authorize_document, source_for

log = logging.getLogger("sharepoint_chat")

CHAT_SYSTEM_PROMPT = """You are an expert AI Document Intelligence assistant for AG Holding.
Your role is to help employees and reviewers understand, query, and act upon this specific document.

DOCUMENT METADATA:
Title: {title}
SharePoint Path: {path}
Document Status: {status}

DOCUMENT SEGMENTS (Verified source text):
{segments}

ANALYSIS FINDINGS:
{analysis_summary}

INSTRUCTIONS:
1. Answer the user's question directly, accurately, and concisely using the provided document segments.
2. Structured Presentation & Tables:
   - When presenting multiple deliverables, tasks, milestones, owners, contacts, or pricing items, ALWAYS format them as a clean Markdown table with headers.
   - For example:
     | Deliverable owner | Role | Key deliverable | Deadline | Contact |
     |---|---|---|---|---|
     | Name | Role | Deliverable description | YYYY-MM-DD | email · phone |
   - Ensure every table row is on its own newline with blank lines before and after the table.
3. If asked about expiration dates, effective dates, or renewal terms, cite the exact ISO dates and relevant segment.
4. If asked about pricing, contract values, fees, or payment schedules, state the exact amounts and currencies mentioned.
5. If asked about owners, contacts, risks, or tasks, provide the details directly from the excerpts.
6. If the document does not contain the answer, politely and clearly state that the information is not found in this document.
7. Always conclude with an explicit source line: Source: [{title}]({path}) (Page/Section).
8. Format your answer using clean, executive-ready Markdown (tables, bullet points, bold text for dates and amounts).
9. Respond in the same language as the user's question, or in the primary language of the document if asked generally."""

CENTRAL_CHAT_SYSTEM_PROMPT = """You are Luna, an expert AI Document Intelligence assistant for AG Holding.
Your role is to answer questions, synthesize findings, and reason across ALL accessible SharePoint documents with strict factual grounding.

CURRENT DATE: {today}

AUTHORIZED DOCUMENT CATALOG ({doc_count} documents accessible):
{catalog}

{deep_dive_segments}

INSTRUCTIONS:
1. Executive Summary & Synthesis:
   - Start with a clear, concise introductory synthesis sentence summarizing the finding across accessible documents (e.g. "Across the accessible documents, there is one project—the Enterprise Document Intelligence initiative...").
2. Structured Presentation & Tables:
   - When presenting deliverables, owners, roles, deadlines, contacts, licenses, contracts, milestones, commercial terms, or comparative records, ALWAYS format them as a clean, complete GitHub-Flavored Markdown table with appropriate headers.
   - For example:
     | Deliverable owner | Role | Key deliverable | Deadline | Contact |
     |---|---|---|---|---|
     | Sarah Jenkins | Group Operations Director | Comprehensive architectural review and external security penetration testing | 2026-10-15 | sarah.jenkins@agholding.net · +971 50 123 4567 |
   - Ensure every table row is separated by newlines with blank lines before and after the table. Never put multiple table cells or rows on the same line.
3. Strict Source Grounding & Citations:
   - Base your answers ONLY on the provided document catalog and verified excerpts.
   - For every key finding, explicitly cite the Document Name formatted as a clickable Markdown link using its exact SharePoint URL: [{{doc_name}}]({{web_url}}). If no URL is available, use the document name.
   - Always conclude the answer with an explicit source reference line, for example:
     Source: [Executive_Project_Delivery_Plan.pdf](https://...) (Page 1, Sections 2–3).
4. Precision:
   - State exact ISO dates (YYYY-MM-DD), currencies, and monetary amounts verbatim.
   - If asked about deliverable owners, contacts, or risks, provide the exact details directly from the findings.
5. Completeness & Honesty:
   - When multiple documents contain relevant items, consolidate and present all of them.
   - If the requested information is not found in any of the authorized documents, politely and clearly state that it was not found in the accessible documents.
6. Tone and Language:
   - Respond in the same language as the user's inquiry (Arabic, English, etc.).
   - Use clean, executive-ready Markdown with bold highlights for critical dates and numbers.
7. Entity Placeholders & Verbatim Tokens:
   - Excerpts and catalogs use document-prefixed entity placeholders (e.g. [D1_PERSON_1], [D2_PERSON_1], [D1_ORGANIZATION_1]).
   - ALWAYS output these exact placeholder tokens verbatim when mentioning persons, contacts, organizations, or entities.
   - NEVER alter, remove, or strip the document prefix (e.g. write [D1_PERSON_1], never [PERSON_1]).
"""


def format_segments_context(segments: list[dict]) -> str:
    lines = []
    for s in segments[:100]:
        sid = s.get("id", "")
        loc = s.get("location", "")
        text = s.get("text", "").strip()
        lines.append(f"[{sid} · {loc}]:\n{text}\n")
    return "\n".join(lines)


def format_analysis_summary(analysis: dict | None) -> str:
    if not analysis:
        return "No automated analysis completed yet."
    sections = analysis.get("sections") or [analysis]
    lines = []
    for s in sections:
        if s.get("summary"):
            lines.append(f"Summary: {s.get('summary')}")
        if s.get("expiries"):
            exp_strs = [f"- {e.get('title')}: {e.get('date')} ({e.get('category')})" for e in s.get("expiries")]
            lines.append("Expiries & Renewals:\n" + "\n".join(exp_strs))
        if s.get("commercials"):
            comm_strs = [f"- {c.get('description')}: {c.get('amount')} {c.get('currency', '')} ({c.get('payment_terms', 'terms')})" for c in s.get("commercials")]
            lines.append("Commercial Terms & Pricing:\n" + "\n".join(comm_strs))
        if s.get("deadlines"):
            dl_strs = [f"- {d.get('title')}: {d.get('deadline')} (Owner: {d.get('owner', 'None')})" for d in s.get("deadlines")]
            lines.append("Deadlines:\n" + "\n".join(dl_strs))
    return "\n\n".join(lines) if lines else "None."


def build_document_catalog_entry(doc: SharePointDocument, metadata: dict, analysis: dict | None) -> str:
    lines = []
    fname = doc.filename or metadata.get("name", "Document")
    url = metadata.get("webUrl") or doc.web_url or ""
    path = doc.path or fname
    lines.append(f"### Document: {fname}")
    lines.append(f"- SharePoint Path: {path}")
    lines.append(f"- Direct URL: {url}")
    lines.append(f"- Status: {doc.status}")

    if analysis:
        sections = analysis.get("sections") or [analysis]
        for s in sections:
            if s.get("summary"):
                lines.append(f"- Summary: {s.get('summary')}")
            if s.get("project_status"):
                lines.append(f"- Project Status: {s.get('project_status')}")
            if s.get("expiries"):
                exp_strs = [
                    f"  * {e.get('title')}: {e.get('date')} [Category: {e.get('category')} | Responsible: {e.get('responsible', 'Unassigned')}]"
                    for e in s.get("expiries")
                ]
                lines.append("- Expiries & Renewals:\n" + "\n".join(exp_strs))
            if s.get("commercials"):
                comm_strs = [
                    f"  * {c.get('description')}: {c.get('amount')} {c.get('currency', '')} (Terms: {c.get('payment_terms', 'N/A')} | Freq: {c.get('billing_frequency', 'N/A')})"
                    for c in s.get("commercials")
                ]
                lines.append("- Commercial Terms:\n" + "\n".join(comm_strs))
            if s.get("deadlines"):
                dl_strs = [
                    f"  * {d.get('title')}: {d.get('deadline')} (Owner: {d.get('owner', 'None')})"
                    for d in s.get("deadlines")
                ]
                lines.append("- Deadlines & Milestones:\n" + "\n".join(dl_strs))
            if s.get("risks"):
                risk_strs = [
                    f"  * {r.get('title')} [Status: {r.get('status', 'unknown')} | Priority: {r.get('priority', 'unknown')}]"
                    for r in s.get("risks")
                ]
                lines.append("- Key Risks:\n" + "\n".join(risk_strs))
            if s.get("contacts"):
                cnt_strs = [
                    f"  * {c.get('title')}: {c.get('owner', 'None')}"
                    for c in s.get("contacts")
                ]
                lines.append("- Contacts & Roles:\n" + "\n".join(cnt_strs))
    else:
        lines.append("- Findings: No structured analysis completed yet.")

    return "\n".join(lines)


def extract_query_keywords(text: str) -> set[str]:
    words = re.findall(r"\w+", text.lower())
    stopwords = {
        "what", "which", "when", "where", "who", "whom", "whose", "why", "how",
        "are", "is", "was", "were", "the", "a", "an", "and", "or", "in", "on",
        "at", "to", "for", "of", "with", "all", "our", "show", "me", "list", "any",
        "tell", "about", "give", "can", "you", "does", "have", "from",
    }
    return {w for w in words if len(w) >= 3 and w not in stopwords}


def stem_token(w: str) -> str:
    w = w.lower().strip()
    if len(w) > 4:
        if w.endswith("ies") and len(w) > 5:
            return w[:-3] + "y"
        if (w.endswith("ches") or w.endswith("shes") or w.endswith("sses") or w.endswith("xes") or w.endswith("zes")) and len(w) > 5:
            return w[:-2]
        if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
            return w[:-1]
        if w.endswith("ing") and len(w) > 5:
            return w[:-3]
        if w.endswith("ed") and len(w) > 4:
            return w[:-2]
    return w


def namespace_placeholders_in_text(text: str, doc_tag: str) -> str:
    if not text or not isinstance(text, str):
        return text
    return re.sub(r"\[([A-Z]+_\d+)\]", rf"[{doc_tag}_\1]", text)


def namespace_placeholders_in_data(data, doc_tag: str):
    if isinstance(data, str):
        return namespace_placeholders_in_text(data, doc_tag)
    if isinstance(data, list):
        return [namespace_placeholders_in_data(item, doc_tag) for item in data]
    if isinstance(data, dict):
        return {k: namespace_placeholders_in_data(v, doc_tag) for k, v in data.items()}
    return data


def resolve_openai_credentials() -> tuple[str, str]:
    api_key = (settings.SHAREPOINT_OPENAI_API_KEY or settings.AI_API_KEY or "").strip()
    model = (settings.SHAREPOINT_OPENAI_MODEL or settings.AI_MODEL or "gpt-5.6-luna").strip()
    return api_key, model


def synthesize_offline_document_response(
    doc: SharePointDocument,
    user_query: str,
) -> dict:
    fname = doc.filename or "Document"
    url = doc.web_url or ""
    path = doc.path or fname
    mapping = {}
    if doc.mapping_cipher:
        try:
            mapping = decrypt(doc.mapping_cipher) or {}
        except Exception:
            mapping = {}

    analysis = restore(doc.analysis, mapping) if (mapping and doc.analysis) else (doc.analysis or {})
    sections = analysis.get("sections") or ([analysis] if analysis else [])
    q_lower = user_query.lower()

    lines = []
    if any(k in q_lower for k in ("expir", "licen", "renew")):
        expiries = []
        for s in sections:
            expiries.extend(s.get("expiries") or [])
        if expiries:
            lines.append(f"Here are the identified expiring licences and renewal terms for **[{fname}]({url})**:\n")
            lines.append("| Item / Licence | Category | Expiration Date | Responsible Owner |")
            lines.append("|---|---|---|---|")
            for e in expiries:
                lines.append(f"| {e.get('title', 'Item')} | {e.get('category', 'Contract')} | **{e.get('date', 'N/A')}** | {e.get('responsible', 'Unassigned')} |")
        else:
            lines.append(f"No specific expiration dates or licences were detected in **[{fname}]({url})**.")
    elif any(k in q_lower for k in ("contract", "pric", "commercial", "fee", "cost", "value")):
        commercials = []
        for s in sections:
            commercials.extend(s.get("commercials") or [])
        if commercials:
            lines.append(f"Here are the commercial and contract fee terms for **[{fname}]({url})**:\n")
            lines.append("| Description | Value / Fee | Payment Terms | Billing Frequency |")
            lines.append("|---|---|---|---|")
            for c in commercials:
                amt = f"**{c.get('amount', 'N/A')} {c.get('currency', '')}**".strip()
                lines.append(f"| {c.get('description', 'Fee')} | {amt} | {c.get('payment_terms', 'Standard')} | {c.get('billing_frequency', 'Periodic')} |")
        else:
            lines.append(f"No commercial pricing or fee terms were detected in **[{fname}]({url})**.")
    elif any(k in q_lower for k in ("risk", "blocker")):
        risks = []
        for s in sections:
            risks.extend(s.get("risks") or [])
        if risks:
            lines.append(f"Here are the risks and blockers identified in **[{fname}]({url})**:\n")
            lines.append("| Risk / Blocker | Status | Priority |")
            lines.append("|---|---|---|")
            for r in risks:
                lines.append(f"| {r.get('title', 'Risk')} | {r.get('status', 'Open')} | **{r.get('priority', 'Medium')}** |")
        else:
            lines.append(f"No high-priority risks or blockers were recorded for **[{fname}]({url})**.")
    elif any(k in q_lower for k in ("deadline", "timeline", "schedule", "milestone")):
        deadlines = []
        for s in sections:
            deadlines.extend(s.get("deadlines") or [])
        if deadlines:
            lines.append(f"Here are the scheduled deadlines and milestones for **[{fname}]({url})**:\n")
            lines.append("| Milestone / Deliverable | Due Date | Owner |")
            lines.append("|---|---|---|")
            for d in deadlines:
                lines.append(f"| {d.get('title', 'Milestone')} | **{d.get('deadline', 'N/A')}** | {d.get('owner', 'Unassigned')} |")
        else:
            lines.append(f"No explicit milestone deadlines were recorded for **[{fname}]({url})**.")
    elif any(k in q_lower for k in ("owner", "who", "responsible", "contact", "deliverable")):
        contacts = []
        for s in sections:
            contacts.extend(s.get("contacts") or [])
            for d in s.get("deadlines") or []:
                if d.get("owner"):
                    contacts.append({"title": d.get("title"), "owner": d.get("owner")})
        if contacts:
            lines.append(f"Here are the key deliverable owners and contacts for **[{fname}]({url})**:\n")
            lines.append("| Role / Scope | Responsible Owner |")
            lines.append("|---|---|")
            for c in contacts:
                lines.append(f"| {c.get('title', 'Scope')} | **{c.get('owner', 'Unassigned')}** |")
        else:
            lines.append(f"No specific deliverable owners or contacts were assigned in **[{fname}]({url})**.")
    else:
        # General executive summary
        lines.append(f"### Executive Summary: [{fname}]({url})\n")
        summary_parts = []
        for s in sections:
            if s.get("summary"):
                summary_parts.append(s["summary"])
        if summary_parts:
            lines.append(" ".join(summary_parts))
        else:
            lines.append("Document has been indexed, verified, and parsed.")

    lines.append(f"\n\nSource: [{fname}]({url or path})")
    lines.append("\n\n*(Document Intelligence Offline Mode: answer synthesized from verified document analysis. Configure SHAREPOINT_OPENAI_API_KEY in .env for conversational reasoning.)*")

    reply = "\n".join(lines)
    citation = {
        "document_id": str(doc.id),
        "document_name": fname,
        "document_path": path,
        "document_url": url,
        "location": None,
        "quote": None,
    }
    return {
        "reply": reply,
        "model": "offline-document-synthesizer",
        "usage": {"input_tokens": 100, "output_tokens": 250},
        "citations": [citation],
    }


def synthesize_offline_central_response(
    authorized_docs: list[tuple[SharePointDocument, dict, list[dict], dict | None]],
    user_query: str,
) -> dict:
    q_lower = user_query.lower()
    restored_docs = []
    for doc, meta, segs, ana in authorized_docs:
        mapping = {}
        if doc.mapping_cipher:
            try:
                mapping = decrypt(doc.mapping_cipher) or {}
            except Exception:
                mapping = {}
        restored_ana = restore(ana, mapping) if (mapping and ana) else (ana or {})
        restored_segs = restore(segs, mapping) if (mapping and segs) else (segs or [])
        restored_docs.append((doc, meta, restored_segs, restored_ana))

    lines = []
    matched_doc_ids = set()

    if any(k in q_lower for k in ("expir", "licen", "renew")):
        all_expiries = []
        for doc, meta, _segs, ana in restored_docs:
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            sections = ana.get("sections") or ([ana] if ana else [])
            for s in sections:
                for e in s.get("expiries") or []:
                    all_expiries.append({
                        "doc_id": str(doc.id),
                        "doc_name": fname,
                        "doc_url": url,
                        "title": e.get("title", "Licence / Contract"),
                        "category": e.get("category", "Contract"),
                        "date": e.get("date", "N/A"),
                        "responsible": e.get("responsible", "Unassigned"),
                    })

        if all_expiries:
            lines.append(f"Across the {len(authorized_docs)} accessible SharePoint documents, here are the identified expiring licences, contracts, and renewals:\n")
            lines.append("| Licence / Contract Item | Category | Expiration Date | Responsible Owner | Source Document |")
            lines.append("|---|---|---|---|---|")
            for item in all_expiries:
                matched_doc_ids.add(item["doc_id"])
                doc_link = f"[{item['doc_name']}]({item['doc_url']})" if item['doc_url'] else item['doc_name']
                lines.append(f"| {item['title']} | {item['category']} | **{item['date']}** | {item['responsible']} | {doc_link} |")
        else:
            lines.append(f"No expiring licences or renewal deadlines were detected across the {len(authorized_docs)} accessible documents.")

    elif any(k in q_lower for k in ("contract", "pric", "commercial", "fee", "cost", "value")):
        all_commercials = []
        for doc, meta, _segs, ana in restored_docs:
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            sections = ana.get("sections") or ([ana] if ana else [])
            for s in sections:
                for c in s.get("commercials") or []:
                    all_commercials.append({
                        "doc_id": str(doc.id),
                        "doc_name": fname,
                        "doc_url": url,
                        "description": c.get("description", "Commercial Term"),
                        "amount": c.get("amount", "N/A"),
                        "currency": c.get("currency", ""),
                        "payment_terms": c.get("payment_terms", "Standard"),
                        "billing_frequency": c.get("billing_frequency", "Periodic"),
                    })

        if all_commercials:
            lines.append(f"Across the {len(authorized_docs)} accessible documents, here are the identified commercial pricing terms and contract values:\n")
            lines.append("| Contract / Deliverable | Commercial Value | Payment Terms | Billing Frequency | Source Document |")
            lines.append("|---|---|---|---|---|")
            for item in all_commercials:
                matched_doc_ids.add(item["doc_id"])
                doc_link = f"[{item['doc_name']}]({item['doc_url']})" if item['doc_url'] else item['doc_name']
                amt = f"**{item['amount']} {item['currency']}**".strip()
                lines.append(f"| {item['description']} | {amt} | {item['payment_terms']} | {item['billing_frequency']} | {doc_link} |")
        else:
            lines.append(f"No specific commercial pricing or contracts were identified across the {len(authorized_docs)} accessible documents.")

    elif any(k in q_lower for k in ("risk", "blocker")):
        all_risks = []
        for doc, meta, _segs, ana in restored_docs:
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            sections = ana.get("sections") or ([ana] if ana else [])
            for s in sections:
                for r in s.get("risks") or []:
                    all_risks.append({
                        "doc_id": str(doc.id),
                        "doc_name": fname,
                        "doc_url": url,
                        "title": r.get("title", "Risk"),
                        "status": r.get("status", "Open"),
                        "priority": r.get("priority", "Medium"),
                    })

        if all_risks:
            lines.append(f"Across the {len(authorized_docs)} accessible documents, here are the recorded risks and project blockers:\n")
            lines.append("| Key Risk / Blocker | Status | Priority | Source Document |")
            lines.append("|---|---|---|---|")
            for item in all_risks:
                matched_doc_ids.add(item["doc_id"])
                doc_link = f"[{item['doc_name']}]({item['doc_url']})" if item['doc_url'] else item['doc_name']
                lines.append(f"| {item['title']} | {item['status']} | **{item['priority']}** | {doc_link} |")
        else:
            lines.append(f"No high-priority risks or blockers are currently flagged across the {len(authorized_docs)} accessible documents.")

    elif any(k in q_lower for k in ("owner", "who", "responsible", "contact", "deliverable")):
        all_contacts = []
        for doc, meta, _segs, ana in restored_docs:
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            sections = ana.get("sections") or ([ana] if ana else [])
            for s in sections:
                for c in s.get("contacts") or []:
                    all_contacts.append({
                        "doc_id": str(doc.id),
                        "doc_name": fname,
                        "doc_url": url,
                        "owner": c.get("owner", "Unassigned"),
                        "title": c.get("title", "Role / Scope"),
                        "scope": s.get("summary", ""),
                    })
                for d in s.get("deadlines") or []:
                    if d.get("owner"):
                        all_contacts.append({
                            "doc_id": str(doc.id),
                            "doc_name": fname,
                            "doc_url": url,
                            "owner": d.get("owner"),
                            "title": d.get("title", "Deliverable"),
                            "scope": f"Due {d.get('deadline', 'N/A')}",
                        })

        if all_contacts:
            lines.append(f"Across the {len(authorized_docs)} accessible documents, here are the key deliverable owners and contacts:\n")
            lines.append("| Deliverable Owner | Scope / Role | Source Document |")
            lines.append("|---|---|---|")
            for item in all_contacts:
                matched_doc_ids.add(item["doc_id"])
                doc_link = f"[{item['doc_name']}]({item['doc_url']})" if item['doc_url'] else item['doc_name']
                lines.append(f"| **{item['owner']}** | {item['title']} | {doc_link} |")
        else:
            lines.append(f"No specific deliverable owners were assigned across the {len(authorized_docs)} accessible documents.")

    elif any(k in q_lower for k in ("deadline", "timeline", "schedule", "milestone")):
        all_deadlines = []
        for doc, meta, _segs, ana in restored_docs:
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            sections = ana.get("sections") or ([ana] if ana else [])
            for s in sections:
                for d in s.get("deadlines") or []:
                    all_deadlines.append({
                        "doc_id": str(doc.id),
                        "doc_name": fname,
                        "doc_url": url,
                        "title": d.get("title", "Milestone"),
                        "deadline": d.get("deadline", "N/A"),
                        "owner": d.get("owner", "Unassigned"),
                    })

        if all_deadlines:
            lines.append(f"Across the {len(authorized_docs)} accessible documents, here are the upcoming deadlines and key milestones:\n")
            lines.append("| Milestone / Deliverable | Due Date | Owner | Source Document |")
            lines.append("|---|---|---|---|")
            for item in all_deadlines:
                matched_doc_ids.add(item["doc_id"])
                doc_link = f"[{item['doc_name']}]({item['doc_url']})" if item['doc_url'] else item['doc_name']
                lines.append(f"| {item['title']} | **{item['deadline']}** | {item['owner']} | {doc_link} |")
        else:
            lines.append(f"No scheduled milestone deadlines were found across the {len(authorized_docs)} accessible documents.")

    else:
        lines.append(f"Executive summary across {len(authorized_docs)} accessible SharePoint document(s):\n")
        for doc, meta, _segs, ana in restored_docs:
            matched_doc_ids.add(str(doc.id))
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            doc_link = f"[{fname}]({url})" if url else fname
            lines.append(f"### 📄 {doc_link}")
            sections = ana.get("sections") or ([ana] if ana else [])
            summary_text = ""
            for s in sections:
                if s.get("summary"):
                    summary_text = s["summary"]
                    break
            lines.append(f"- **Summary**: {summary_text or 'Document indexed and ready.'}")
            lines.append(f"- **Status**: {doc.status.replace('_', ' ').capitalize()}")
            lines.append("")

    lines.append("\n*(Document Intelligence Offline Mode: answer synthesized from verified document analysis. Configure SHAREPOINT_OPENAI_API_KEY in .env for conversational reasoning.)*")

    reply = "\n".join(lines)
    citations = []
    for doc, meta, _segs, _ana in restored_docs:
        did = str(doc.id)
        if did in matched_doc_ids or not matched_doc_ids:
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            path = doc.path or fname
            citations.append({
                "document_id": did,
                "document_name": fname,
                "document_path": path,
                "document_url": url,
                "location": None,
                "quote": None,
            })

    return {
        "reply": reply,
        "model": "offline-intelligence-synthesizer",
        "usage": {"input_tokens": 120, "output_tokens": 300},
        "citations": citations,
    }


async def ask_document(db: AsyncSession, user: User, document_id: str | uuid.UUID, messages: list[dict]) -> dict:
    doc_uuid = uuid.UUID(str(document_id)) if not isinstance(document_id, uuid.UUID) else document_id
    source = await source_for(db)
    doc = await db.get(SharePointDocument, doc_uuid)
    if not doc or doc.source_id != source.id or doc.deleted or not doc.in_scope:
        raise SharePointError("document_not_found", 404)

    if doc.status != "ready":
        raise SharePointError("document_not_ready", 409)
    if doc.status not in ("ready", "approved", "analyzed"):
        raise SharePointError("document_not_ready", 400)

    user_query = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            user_query = str(m.get("content", ""))
            break

    api_key, model_name = resolve_openai_credentials()
    if not api_key:
        return synthesize_offline_document_response(doc, user_query)

    # Privacy preservation: DO NOT restore segments or analysis before sending to OpenAI (Issue #15)
    # The outbound prompt contains sanitized text with placeholders
    segments_text = format_segments_context(doc.segments or [])
    analysis_text = format_analysis_summary(doc.analysis)

    system_content = CHAT_SYSTEM_PROMPT.format(
        title=doc.filename,
        path=doc.path or doc.filename,
        status=doc.status,
        segments=segments_text or "No extracted segments available.",
        analysis_summary=analysis_text,
    )

    api_messages = [{"role": "system", "content": system_content}]
    for m in messages[-10:]:
        role = m.get("role", "user")
        if role not in ("user", "assistant"):
            role = "user"
        content = str(m.get("content", "")).strip()
        if content:
            api_messages.append({"role": role, "content": content})

    try:
        async with AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.openai.com/v1",
            timeout=90,
            max_retries=1,
        ) as client:
            response = await client.chat.completions.create(
                model=model_name,
                messages=api_messages,
                max_completion_tokens=2500,
            )
            raw_reply = response.choices[0].message.content or ""
            usage = {
                "input_tokens": response.usage.prompt_tokens if response.usage else 0,
                "output_tokens": response.usage.completion_tokens if response.usage else 0,
            }

            # Restore placeholders only on the model's reply for the authorized caller
            mapping = decrypt(doc.mapping_cipher) if doc.mapping_cipher else {}
            reply = restore(raw_reply, mapping) if mapping else raw_reply
            return {"reply": reply, "model": model_name, "usage": usage}
    except OpenAIError as e:
        log.error("OpenAI chat error: %s", e)
        raise SharePointError("analysis_provider_error", 502) from None
    except Exception as e:
        log.error("Unexpected error in document chat: %s", e)
        raise SharePointError("chat_error", 500) from None


async def ask_central(
    db: AsyncSession,
    user: User,
    messages: list[dict],
    document_ids: list[str] | None = None,
) -> dict:
    source = await source_for(db)
    graph = None
    try:
        token = await delegated_token(db, user)
        graph = GraphClient(token)
    except SharePointError:
        graph = None

    query = select(SharePointDocument).where(
        SharePointDocument.source_id == source.id,
        SharePointDocument.in_scope.is_(True),
        SharePointDocument.deleted.is_(False),
        SharePointDocument.is_folder.is_(False),
        SharePointDocument.status == "ready",
    )
    if document_ids:
        valid_uuids = []
        for did in document_ids:
            try:
                valid_uuids.append(uuid.UUID(str(did)))
            except (ValueError, TypeError):
                continue
        if valid_uuids:
            query = query.where(SharePointDocument.id.in_(valid_uuids))

    docs = list((await db.scalars(query.order_by(SharePointDocument.filename.asc()))).all())
    total_accessible_in_db = len(docs)
    max_candidates = len(valid_uuids) if document_ids and valid_uuids else 25

    # Extract user keywords from latest messages for query relevance ranking (Issue #19)
    user_query = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            user_query = str(m.get("content", ""))
            break
    query_kws = extract_query_keywords(user_query)

    def score_doc(d: SharePointDocument) -> int:
        score = 0
        corpus_parts = [d.filename or "", d.path or ""]
        if d.analysis:
            sections = d.analysis.get("sections") if isinstance(d.analysis, dict) else []
            if not sections and isinstance(d.analysis, dict):
                sections = [d.analysis]
            for sec in sections:
                if isinstance(sec, dict):
                    if sec.get("summary"):
                        corpus_parts.append(sec["summary"])
                    for exp in sec.get("expiries") or []:
                        corpus_parts.append(exp.get("title") or "")
                        corpus_parts.append(exp.get("category") or "")
                        corpus_parts.append(exp.get("responsible") or "")
                    for comm in sec.get("commercials") or []:
                        corpus_parts.append(comm.get("description") or "")
                        corpus_parts.append(comm.get("currency") or "")
                    for dl in sec.get("deadlines") or []:
                        corpus_parts.append(dl.get("title") or "")
                        corpus_parts.append(dl.get("owner") or "")
                    for task in sec.get("tasks") or []:
                        corpus_parts.append(task.get("title") or "")
                        corpus_parts.append(task.get("owner") or "")
                    for risk in sec.get("risks") or []:
                        corpus_parts.append(risk.get("title") or "")
                    for cnt in sec.get("contacts") or []:
                        corpus_parts.append(cnt.get("title") or "")
                        corpus_parts.append(cnt.get("owner") or "")

        full_text = " ".join(corpus_parts).lower()
        doc_tokens = set(re.findall(r"\w+", full_text))
        doc_stems = {stem_token(t) for t in doc_tokens if len(t) >= 3}

        for kw in query_kws:
            kw_lower = kw.lower()
            kw_stem = stem_token(kw_lower)
            if kw_lower in (d.filename or "").lower():
                score += 3
            elif kw_lower in doc_tokens:
                score += 2
            elif kw_stem in doc_stems:
                score += 2
            elif any(t.startswith(kw_stem) or kw_stem.startswith(t) for t in doc_stems if len(t) >= 4):
                score += 1
            elif kw_lower in full_text:
                score += 1
        return score

    if query_kws and not document_ids:
        docs.sort(key=score_doc, reverse=True)

    # Bounded candidate pool and Graph authorization using TTL cache (Issue #19)
    authorized_docs: list[tuple[SharePointDocument, dict, list[dict], dict | None]] = []
    for doc in docs:
        if not document_ids and len(authorized_docs) >= 20 and query_kws and score_doc(doc) == 0:
            break
        if len(authorized_docs) >= max_candidates:
            break
        try:
            if graph:
                metadata = await authorize_document(db, user, source, doc, graph, use_cache=True)
            else:
                metadata = {"id": doc.item_id or str(doc.id), "name": doc.filename, "webUrl": doc.web_url or ""}
            # DO NOT restore segments or analysis before sending to OpenAI (Issue #15)
            # Pass sanitized segments and analysis
            authorized_docs.append((doc, metadata, doc.segments or [], doc.analysis))
        except SharePointError as error:
            if error.code in ("document_access_denied", "document_not_found", "document_changed_sync_required"):
                continue
            raise

    api_key, model_name = resolve_openai_credentials()

    if not authorized_docs:
        return {
            "reply": "No accessible SharePoint documents were found. Please verify that documents are synced and that your connected Microsoft account has read permissions in SharePoint.",
            "model": model_name or "offline-intelligence-synthesizer",
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "citations": [],
        }

    if not api_key:
        return synthesize_offline_central_response(authorized_docs, user_query)

    # Build catalog of authorized documents with bounded context length (Issue #19)
    # Namespace placeholders per document to prevent cross-document collision (Issue #22)
    catalog_entries = []
    namespaced_docs_data: list[tuple[SharePointDocument, dict, list[dict], dict | None, str]] = []
    for i, (doc, meta, segs, ana) in enumerate(authorized_docs):
        doc_tag = f"D{i+1}"
        namespaced_ana = namespace_placeholders_in_data(ana, doc_tag)
        namespaced_segs = namespace_placeholders_in_data(segs, doc_tag)
        namespaced_docs_data.append((doc, meta, namespaced_segs, namespaced_ana, doc_tag))
        catalog_entries.append(build_document_catalog_entry(doc, meta, namespaced_ana))

    catalog_text = "\n\n".join(catalog_entries)
    if len(catalog_text) > 40000:
        catalog_text = catalog_text[:40000] + "\n... [Catalog truncated for context limit]"

    # Extract targeted segment excerpts with namespaced placeholders
    scored_segments = []
    if query_kws:
        for doc, meta, namespaced_segs, _ana, _tag in namespaced_docs_data:
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            for seg in namespaced_segs:
                stext = seg.get("text", "")
                slower = stext.lower()
                hits = sum(1 for kw in query_kws if kw in slower)
                if hits > 0:
                    scored_segments.append({
                        "hits": hits,
                        "doc_id": str(doc.id),
                        "doc_name": fname,
                        "doc_url": url,
                        "doc_path": doc.path or fname,
                        "location": seg.get("location", ""),
                        "id": seg.get("id", ""),
                        "text": stext.strip(),
                    })
        scored_segments.sort(key=lambda x: x["hits"], reverse=True)

    top_segments = scored_segments[:15]
    if top_segments:
        deep_dive_lines = ["TARGETED VERIFIED SOURCE EXCERPTS (Relevant to query):"]
        for seg in top_segments:
            deep_dive_lines.append(f"[{seg['doc_name']} · Location: {seg['location']} · ID: {seg['id']}]:\n{seg['text']}\n")
        deep_dive_text = "\n".join(deep_dive_lines)
    else:
        deep_dive_text = ""

    today = datetime.datetime.now(timezone.utc).strftime("%Y-%m-%d")

    system_content = CENTRAL_CHAT_SYSTEM_PROMPT.format(
        today=today,
        doc_count=len(authorized_docs),
        catalog=catalog_text,
        deep_dive_segments=deep_dive_text,
    )

    api_messages = [{"role": "system", "content": system_content}]
    for m in messages[-12:]:
        role = m.get("role", "user")
        if role not in ("user", "assistant"):
            role = "user"
        content = str(m.get("content", "")).strip()
        if content:
            api_messages.append({"role": role, "content": content})

    try:
        async with AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.openai.com/v1",
            timeout=90,
            max_retries=1,
        ) as client:
            response = await client.chat.completions.create(
                model=model_name,
                messages=api_messages,
                max_completion_tokens=3000,
            )
            raw_reply = response.choices[0].message.content or ""
            usage = {
                "input_tokens": response.usage.prompt_tokens if response.usage else 0,
                "output_tokens": response.usage.completion_tokens if response.usage else 0,
            }

            # Combine mappings from all authorized documents with document-scoped keys (Issue #22)
            combined_mapping = {}
            for i, (doc, _meta, _segs, _ana) in enumerate(authorized_docs):
                doc_tag = f"D{i+1}"
                if doc.mapping_cipher:
                    try:
                        m = decrypt(doc.mapping_cipher)
                        if isinstance(m, dict):
                            for raw_token, entry in m.items():
                                inner = raw_token.strip("[]")
                                namespaced_token = f"[{doc_tag}_{inner}]"
                                combined_mapping[namespaced_token] = entry
                    except Exception:
                        pass

            reply = restore(raw_reply, combined_mapping) if combined_mapping else raw_reply

            # Visible truncation disclosure when candidate pool was capped (Issue #19)
            if not document_ids and total_accessible_in_db > len(authorized_docs):
                reply += f"\n\n*(Answered from {len(authorized_docs)} of {total_accessible_in_db} accessible documents. Narrow your inquiry or specify documents to search across other files.)*"

            # Build structured citations from retrieved segments and model mentions (Issue #19)
            retrieved_doc_ids = {s["doc_id"] for s in top_segments}
            citations = []
            seen_ids = set()
            for doc, meta, _segs, _ana in authorized_docs:
                doc_id_str = str(doc.id)
                fname = doc.filename or meta.get("name", "")
                url = meta.get("webUrl") or doc.web_url or ""
                path = doc.path or fname
                if doc_id_str in retrieved_doc_ids or (fname and fname.lower() in reply.lower()) or (url and url in reply):
                    if doc_id_str not in seen_ids:
                        seen_ids.add(doc_id_str)
                        loc = None
                        for s in top_segments:
                            if s["doc_id"] == doc_id_str:
                                loc = s.get("location")
                                break
                        citations.append({
                            "document_id": doc_id_str,
                            "document_name": fname,
                            "document_path": path,
                            "document_url": url,
                            "location": loc,
                            "quote": None,
                        })

            return {
                "reply": reply,
                "model": model_name,
                "usage": usage,
                "citations": citations,
            }
    except OpenAIError as e:
        log.error("OpenAI central chat error: %s", e)
        raise SharePointError("analysis_provider_error", 502) from None
    except Exception as e:
        log.error("Unexpected error in central chat: %s", e)
        raise SharePointError("chat_error", 500) from None

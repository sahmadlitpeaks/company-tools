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


def build_document_catalog_entry(doc: SharePointDocument, metadata: dict, restored_analysis: dict | None) -> str:
    lines = []
    fname = doc.filename or metadata.get("name", "Document")
    url = metadata.get("webUrl") or doc.web_url or ""
    path = doc.path or fname
    lines.append(f"### Document: {fname}")
    lines.append(f"- SharePoint Path: {path}")
    lines.append(f"- Direct URL: {url}")
    lines.append(f"- Status: {doc.status}")

    if restored_analysis:
        sections = restored_analysis.get("sections") or [restored_analysis]
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


def resolve_openai_credentials() -> tuple[str, str]:
    api_key = (settings.SHAREPOINT_OPENAI_API_KEY or settings.AI_API_KEY or "").strip()
    model = (settings.SHAREPOINT_OPENAI_MODEL or settings.AI_MODEL or "gpt-5.6-luna").strip()
    return api_key, model


async def ask_document(db: AsyncSession, user: User, document_id: str | uuid.UUID, messages: list[dict]) -> dict:
    api_key, model_name = resolve_openai_credentials()
    if not api_key:
        raise SharePointError("openai_not_configured", 400)

    doc_uuid = uuid.UUID(str(document_id)) if not isinstance(document_id, uuid.UUID) else document_id
    source = await source_for(db)
    doc = await db.get(SharePointDocument, doc_uuid)
    if not doc or doc.source_id != source.id or doc.deleted or not doc.in_scope:
        raise SharePointError("document_not_found", 404)

    mapping = decrypt(doc.mapping_cipher) if doc.mapping_cipher else {}
    restored_segments = restore(doc.segments or [], mapping)
    restored_analysis = restore(doc.analysis, mapping) if doc.analysis else None

    segments_text = format_segments_context(restored_segments)
    analysis_text = format_analysis_summary(restored_analysis)

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
            reply = response.choices[0].message.content or ""
            usage = {
                "input_tokens": response.usage.prompt_tokens if response.usage else 0,
                "output_tokens": response.usage.completion_tokens if response.usage else 0,
            }
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
    api_key, model_name = resolve_openai_credentials()
    if not api_key:
        raise SharePointError("openai_not_configured", 400)

    source = await source_for(db)
    graph = GraphClient(await delegated_token(db, user))

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

    authorized_docs: list[tuple[SharePointDocument, dict, list[dict], dict | None]] = []
    for doc in docs:
        try:
            metadata = await authorize_document(db, user, source, doc, graph)
            mapping = decrypt(doc.mapping_cipher) if doc.mapping_cipher else {}
            restored_segs = restore(doc.segments or [], mapping)
            restored_ana = restore(doc.analysis, mapping) if doc.analysis else None
            authorized_docs.append((doc, metadata, restored_segs, restored_ana))
        except SharePointError as error:
            if error.code in ("document_access_denied", "document_not_found", "document_changed_sync_required"):
                continue
            raise


    if not authorized_docs:
        return {
            "reply": "No accessible SharePoint documents were found. Please verify that documents are synced and that your connected Microsoft account has read permissions in SharePoint.",
            "model": model_name,
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "citations": [],
        }

    # Build catalog of all authorized documents
    catalog_entries = []
    for doc, meta, _segs, ana in authorized_docs:
        catalog_entries.append(build_document_catalog_entry(doc, meta, ana))
    catalog_text = "\n\n".join(catalog_entries)

    # Extract user keywords from latest messages for targeted segment retrieval
    user_query = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            user_query = str(m.get("content", ""))
            break

    query_kws = extract_query_keywords(user_query)
    scored_segments = []
    if query_kws:
        for doc, meta, segs, _ana in authorized_docs:
            fname = doc.filename or meta.get("name", "Document")
            url = meta.get("webUrl") or doc.web_url or ""
            for seg in segs:
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
            reply = response.choices[0].message.content or ""
            usage = {
                "input_tokens": response.usage.prompt_tokens if response.usage else 0,
                "output_tokens": response.usage.completion_tokens if response.usage else 0,
            }

            # Build structured citations from authorized documents mentioned or cited
            citations = []
            seen_ids = set()
            for doc, meta, _segs, _ana in authorized_docs:
                doc_id_str = str(doc.id)
                fname = doc.filename or meta.get("name", "")
                url = meta.get("webUrl") or doc.web_url or ""
                path = doc.path or fname
                if fname.lower() in reply.lower() or (url and url in reply):
                    if doc_id_str not in seen_ids:
                        seen_ids.add(doc_id_str)
                        # Find if a specific segment location was referenced
                        loc = None
                        for s in top_segments:
                            if s["doc_id"] == doc_id_str and (s["location"].lower() in reply.lower() or s["id"].lower() in reply.lower()):
                                loc = s["location"]
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

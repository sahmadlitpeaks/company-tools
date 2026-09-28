"""Bounded, offline document extraction. No file writes or model downloads."""
import asyncio
import hashlib
import io
import logging
import multiprocessing
import re
import subprocess
import time
import unicodedata
import zipfile
from xml.etree.ElementTree import ParseError

from openpyxl.utils.exceptions import InvalidFileException
from pypdf.errors import PdfReadError

from app.services.sharepoint.common import SharePointError

PLACEHOLDER = re.compile(r"\[(?:[A-Z0-9]+_)?[A-Z]+_\d+\]")
PIPELINE_VERSION = "direct-extraction-v1"


def normalize(text):
    return unicodedata.normalize("NFKC", str(text)).replace("\x00", "")


def _ocr_image(data):
    """Read embedded image text locally, before any content crosses the privacy boundary."""
    def read(pixels):
        try:
            result = subprocess.run(
                ["tesseract", "stdin", "stdout", "-l", "eng+ara", "--psm", "6"],
                input=pixels, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=20, check=False,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            raise SharePointError("ocr_unavailable", 422) from None
        if result.returncode:
            raise SharePointError("ocr_unavailable", 422)
        return result.stdout.decode("utf-8", errors="replace").strip()

    text = read(data)
    if text:
        return text
    # Wide colored heading bars can hide light text from whole-image OCR.
    from PIL import Image, ImageOps
    with Image.open(io.BytesIO(data)) as image:
        if image.width <= image.height * 8:
            return ""
        pieces = []
        for left, right in ((0, image.width // 4), (image.width * 3 // 4, image.width)):
            crop = image.crop((left, image.height // 6, right, image.height * 5 // 6))
            crop = ImageOps.invert(crop.convert("RGB"))
            buffer = io.BytesIO()
            crop.save(buffer, format="PNG")
            value = read(buffer.getvalue())
            if value:
                pieces.append(value)
        return "\n".join(pieces)


def extract(data, extension, maximum):
    """Extract selectable text and embedded image text with bounded local OCR."""
    rows = []
    length = 0

    def add(location, value):
        nonlocal length
        value = normalize(value).strip()
        if not value:
            return
        length += len(value)
        if length > maximum:
            raise SharePointError("text_limit", 422)
        rows.append({"id": f"s{len(rows) + 1}", "location": location, "text": value})

    if extension == "txt":
        encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
        add("Text", data.decode(encoding, errors="strict"))
    elif extension == "pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise SharePointError("encrypted_document", 422)
        if len(reader.pages) > 200:
            raise SharePointError("page_limit", 422)
        ocr_cache = {}
        for index, page in enumerate(reader.pages):
            value = page.extract_text() or ""
            images = page.images
            if len(images) > 100:
                raise SharePointError("image_limit", 422)
            if not value.strip() and not images:
                raise SharePointError("needs_ocr", 422)
            add(f"Page {index + 1}", value)
            for image_index, image in enumerate(images, 1):
                width, height = image.image.size
                if width * height > 10_000_000:
                    raise SharePointError("image_limit", 422)
                key = hashlib.sha256(image.data).digest()
                if key not in ocr_cache:
                    ocr_cache[key] = _ocr_image(image.data)
                visual_text = ocr_cache[key]
                # Small non-text graphics (for example QR codes or logos) are
                # retained in SharePoint, but cannot supply analysis evidence.
                if not visual_text and width * height > 22_500:
                    raise SharePointError("incomplete_visual_content", 422)
                if width * height <= 22_500 and len(visual_text.strip()) < 8:
                    continue
                add(f"Page {index + 1}, image {image_index}", visual_text)
            if not value.strip() and not any(row["location"].startswith(f"Page {index + 1}, image ") for row in rows):
                raise SharePointError("needs_ocr", 422)
    elif extension in ("docx", "xlsx"):
        from defusedxml.ElementTree import fromstring
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 4000 or sum(e.file_size for e in entries) > 80 * 1024 * 1024:
                raise SharePointError("archive_limit", 422)
            for entry in entries:
                if entry.file_size > 20 * 1024 * 1024 or entry.file_size > max(1, entry.compress_size) * 200:
                    raise SharePointError("archive_limit", 422)
                if any(part in entry.filename.lower() for part in ("/media/", "/embeddings/", "vbaproject", "/charts/", "/drawings/")):
                    raise SharePointError("incomplete_visual_content", 422)
                if entry.filename.endswith((".xml", ".rels")):
                    fromstring(archive.read(entry))
            if extension == "docx":
                # Read document + headers/footers/notes/comments in package order.
                # Extract all text nodes, including text inside tables and textboxes.
                names = ["word/document.xml"] + sorted(e.filename for e in entries if re.match(r"word/(header|footer|footnotes|endnotes|comments).*\.xml$", e.filename))
                namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                for part in names:
                    root = fromstring(archive.read(part))
                    for index, paragraph in enumerate(root.iter(namespace + "p")):
                        add(f"{part.removeprefix('word/').removesuffix('.xml')} paragraph {index + 1}", "".join(n.text or "" for n in paragraph.iter(namespace + "t")))
            else:
                from openpyxl import load_workbook
                book = load_workbook(io.BytesIO(data), read_only=True, data_only=False, keep_links=False)
                count = 0
                try:
                    for sheet_index, sheet in enumerate(book.worksheets):
                        # Titles themselves are content and go through the same redaction.
                        add(f"Sheet {sheet_index + 1} title", sheet.title)
                        for row in sheet.iter_rows():
                            for cell in row:
                                count += 1
                                if count > 50000:
                                    raise SharePointError("cell_limit", 422)
                                if cell.data_type == "f":
                                    raise SharePointError("formula_requires_review", 422)
                                if cell.value is not None:
                                    add(f"Sheet {sheet_index + 1}, {cell.coordinate}", cell.value)
                finally:
                    book.close()
    else:
        raise SharePointError("unsupported_type", 422)
    if not rows:
        raise SharePointError("empty_document", 422)
    return rows


class OfflineRecognizer:
    def __init__(self, languages, model_dir):
        self.languages = set(languages)
        self.model_dir = model_dir
        self.pipelines = {}

    def __call__(self, text):
        from langdetect import DetectorFactory, detect_langs
        from langdetect.lang_detect_exception import LangDetectException
        DetectorFactory.seed = 0
        candidates = set()
        # Script detection catches Arabic even when a bilingual page is mostly
        # English. Short labels/names give unreliable statistical predictions.
        if re.search(r"[\u0600-\u06ff]", text):
            candidates.add("ar")
        pieces = [text] + re.findall(r"[A-Za-z\s]{100,}", text)
        for piece in pieces:
            if sum(c.isalpha() for c in piece) < 80:
                continue
            try:
                predictions = detect_langs(piece)
                if predictions and predictions[0].prob >= 0.80:
                    candidates.add(predictions[0].lang)
            except (LangDetectException, Exception):
                pass
        # If languages is explicitly configured and does not contain wildcard/all, enforce candidates match
        if self.languages and "all" not in self.languages and "*" not in self.languages:
            if candidates and not (candidates <= self.languages):
                raise SharePointError("unsupported_language", 422)
        # Short labels/names are ambiguous: fallback to en or configured languages
        if not candidates:
            candidates = set(self.languages) if (self.languages and "all" not in self.languages and "*" not in self.languages) else {"en"}

        spans = []
        for language in sorted(candidates):
            if language in self.languages or "all" in self.languages or "*" in self.languages:
                try:
                    if language not in self.pipelines:
                        import stanza
                        self.pipelines[language] = stanza.Pipeline(
                            lang=language, dir=self.model_dir, processors="tokenize,ner",
                            download_method=None, use_gpu=False, verbose=False,
                        )
                    document = self.pipelines[language](text)
                    for entity in document.ents:
                        if entity.type in {"DATE", "TIME", "ORDINAL", "CARDINAL", "QUANTITY"}:
                            continue
                        kind = {"PER": "PERSON", "PERSON": "PERSON", "ORG": "ORGANIZATION", "GPE": "ADDRESS", "LOC": "ADDRESS", "MONEY": "VALUE", "PERCENT": "VALUE"}.get(entity.type, "CONFIDENTIAL")
                        spans.append((entity.start_char, entity.end_char, kind, True))
                except Exception:
                    raise SharePointError("privacy_model_unavailable", 422) from None
        return spans, candidates


PATTERNS = [
    ("SECRET", False, r"-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----"),
    ("SECRET", False, r"(?i)\b(?:password|passwd|api[_ -]?key|access[_ -]?token|client[_ -]?secret|authorization|secret)\s*[:=]\s*[^\s,;]+"),
    ("SECRET", False, r"\b(?:sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b"),
    ("URL", False, r"(?i)\b(?:https?://|www\.)[^\s<>]+"),
    ("EMAIL", True, r"[\w.+-]+@[\w.-]+\.[^\W\d_]{2,}"),
    ("IBAN", False, r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b"),
    ("PHONE", True, r"(?<!\w)\+?\d[\d ()-]{7,}\d(?!\w)"),
    ("IDENTIFIER", False, r"(?i)\b(?:passport|national[_ -]?id|employee[_ -]?id|رقم\s+الهوية)\s*[:=#]?\s*[\w-]{4,}"),
    ("CONFIDENTIAL", False, PLACEHOLDER.pattern),
]


def sanitize(segments, terms, recognizer):
    mapping, reverse, counts, languages, result = {}, {}, {}, set(), []
    for segment in segments:
        value = normalize(segment["text"])
        spans, detected = recognizer(value)
        languages.update(detected)
        for kind, restorable, pattern in PATTERNS:
            for match in re.finditer(pattern, value):
                if kind == "PHONE" and (
                    re.fullmatch(r"\d{4}-\d{2}-\d{2}", match.group())
                    or re.fullmatch(r"((?:19|20|21)\d{2})\s+\1", match.group())
                ):
                    continue
                spans.append((match.start(), match.end(), kind, restorable))
        for term in terms:
            spans.extend((m.start(), m.end(), term["kind"], True) for m in re.finditer(re.escape(normalize(term["value"])), value, re.IGNORECASE))
        # Union overlapping detections. A secret always dominates a business entity.
        merged = []
        for start, end, kind, restorable in sorted(spans):
            if start < 0 or end > len(value) or end <= start:
                raise SharePointError("invalid_privacy_span", 422)
            if merged and start < merged[-1][1]:
                previous = merged[-1]
                previous[1] = max(previous[1], end)
                if not restorable:
                    previous[2], previous[3] = kind, False
            else:
                merged.append([start, end, kind, restorable])
        parts, offset = [], 0
        for start, end, kind, restorable in merged:
            original = value[start:end]
            key = (kind, original.casefold(), restorable)
            if key not in reverse:
                counts[kind] = counts.get(kind, 0) + 1
                token = f"[{kind}_{counts[kind]}]"
                reverse[key] = token
                mapping[token] = {"value": original if restorable else "[redacted]", "restore": restorable}
            parts.extend((value[offset:start], reverse[key]))
            offset = end
        parts.append(value[offset:])
        # Split only after redaction, on whitespace, so chunk boundaries cannot
        # hide credentials from recognizers or split an identity placeholder.
        sanitized = "".join(parts)
        while sanitized:
            cut = len(sanitized)
            if cut > 3000:
                cut = sanitized.rfind(" ", 0, 3001)
                if cut <= 0:
                    cut = sanitized.find(" ", 3000)
                    if cut < 0:
                        cut = len(sanitized)
                if cut > 10000:
                    raise SharePointError("unbroken_text_limit", 422)
            result.append({"id": f"s{len(result) + 1}", "location": segment["location"], "text": sanitized[:cut]})
            sanitized = sanitized[cut:].lstrip()
    return result, mapping, sorted(languages)


def restore(value, mapping):
    if isinstance(value, str):
        def replacement(match):
            entry = mapping.get(match.group(), {})
            return entry.get("value", "[redacted]") if entry.get("restore") else "[redacted]"
        return PLACEHOLDER.sub(replacement, value)
    if isinstance(value, list):
        return [restore(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k: restore(v, mapping) for k, v in value.items()}
    return value


def _child(pipe, data, extension, maximum):
    logging.disable(logging.CRITICAL)
    try:
        rows = extract(data, extension, maximum)
        segments = []
        for row in rows:
            remaining = row["text"]
            while remaining:
                cut = min(len(remaining), 3000)
                if cut < len(remaining):
                    boundary = remaining.rfind(" ", 0, cut)
                    if boundary > 0:
                        cut = boundary
                segments.append({"id": f"s{len(segments) + 1}", "location": row["location"], "text": remaining[:cut]})
                remaining = remaining[cut:].lstrip()
        pipe.send((True, (segments, {}, [])))
    except SharePointError as error:
        pipe.send((False, error.code))
    except (zipfile.BadZipFile, KeyError, ParseError, InvalidFileException):
        pipe.send((False, "invalid_office_document"))
    except PdfReadError:
        pipe.send((False, "invalid_pdf"))
    except UnicodeError:
        pipe.send((False, "invalid_text_encoding"))
    except Exception:
        pipe.send((False, "extraction_failed"))
    finally:
        pipe.close()


async def preprocess(data, extension, terms=None):
    from app.core.config import settings
    import psutil
    context = multiprocessing.get_context("spawn")
    parent, child = context.Pipe(duplex=False)
    process = context.Process(target=_child, args=(child, data, extension, settings.SHAREPOINT_MAX_TEXT_CHARS))
    process.start()
    child.close()
    started = time.monotonic()
    try:
        while not parent.poll():
            if not process.is_alive():
                raise SharePointError("extraction_failed", 422)
            if time.monotonic() - started > settings.SHAREPOINT_PARSER_TIMEOUT_SECONDS:
                raise SharePointError("parser_timeout", 422)
            if psutil.Process(process.pid).memory_info().rss > 2 * 1024 ** 3:
                raise SharePointError("parser_memory_limit", 422)
            await asyncio.sleep(0.1)
        success, result = parent.recv()
        if not success:
            raise SharePointError(result, 422)
        return result
    except (EOFError, OSError, psutil.NoSuchProcess):
        raise SharePointError("extraction_failed", 422) from None
    finally:
        parent.close()
        if process.is_alive():
            process.terminate()
        await asyncio.to_thread(process.join, 5)
        if process.is_alive():
            process.kill()
            await asyncio.to_thread(process.join, 5)
        process.close()

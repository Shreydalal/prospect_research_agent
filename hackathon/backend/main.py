import os
import json
import re
import asyncio
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse
from dotenv import load_dotenv

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import google.generativeai as genai

# Load environment variables from .env
load_dotenv()

# ─── Config ───────────────────────────────────────────────────────────────────
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
DATA_FILE = Path("results.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

RELEVANT_KEYWORDS = [
    "about", "contact", "services", "service", "solution", "solutions",
    "team", "company", "who-we-are", "what-we-do", "products", "product",
    "pricing", "clients", "customers", "portfolio", "work", "our-work",
    "reach", "connect", "get-in-touch", "careers", "locations", "location",
    "offices", "office", "info", "overview", "mission", "story",
]

# ─── Regex extractors ─────────────────────────────────────────────────────────

EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE,
)
PHONE_RE = re.compile(
    r"(?:(?:\+|00)\d{1,3}[\s\-.]?)?"
    r"(?:\(?\d{1,4}\)?[\s\-.]?)?"
    r"\d{3,5}"
    r"[\s\-.]?\d{3,5}"
    r"(?:[\s\-.]?\d{2,4})?",
    re.IGNORECASE,
)

JUNK_EMAILS = {"example@", "user@", "email@", "test@", "noreply@", "no-reply@"}

BUSINESS_EMAIL_KEYWORDS = [
    "sales", "contact", "support", "info", "help", "hello", "press", "pr"
]


def regex_extract_contacts(text: str) -> tuple[list[str], str]:
    """
    Deterministically extract emails and best phone number from raw text.
    Returns (emails_list, phone_string). Never lets the LLM invent these.
    """
    # Emails — deduplicate, filter obvious placeholders
    raw_emails = EMAIL_RE.findall(text)
    seen: set[str] = set()
    emails: list[str] = []
    for e in raw_emails:
        e_lower = e.lower()
        if e_lower not in seen and not any(e_lower.startswith(j) for j in JUNK_EMAILS):
            seen.add(e_lower)
            emails.append(e)

    # Phones — pick the longest (most digits = most complete number)
    raw_phones = PHONE_RE.findall(text)
    valid_phones = [p.strip() for p in raw_phones if len(re.sub(r"\D", "", p)) >= 7]
    seen_digits: set[str] = set()
    best_phone = ""
    for p in sorted(valid_phones, key=lambda x: len(re.sub(r"\D", "", x)), reverse=True):
        digits = re.sub(r"\D", "", p)
        if digits not in seen_digits:
            seen_digits.add(digits)
            best_phone = p
            break

    # Normalise whitespace
    best_phone = re.sub(r"\s+", " ", best_phone).strip()
    parts = best_phone.split()

    # Clean up trailing repetitions (e.g. "1800 103 1123 1800" -> "1800 103 1123")
    while len(parts) >= 3:
        if parts[-1] == parts[0]:
            parts = parts[:-1]
        elif parts[-1] in ('1800', '1866', '1877', '1888', '800') and len(parts) >= 4:
            parts = parts[:-1]
        else:
            break

    if len(parts) > 4:
        parts = parts[:4]

    best_phone = " ".join(parts)
    return emails, best_phone


def extract_href_contacts(html: str) -> tuple[list[str], list[str]]:
    """
    Extract contacts directly from anchor hrefs:
      <a href="mailto:someone@example.com">
      <a href="tel:+1234567890">
    Returns (emails_list, phones_list).
    """
    emails: list[str] = []
    phones: list[str] = []
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith("mailto:"):
            email = href.replace("mailto:", "").split("?")[0]
            if email:
                emails.append(email)
        elif href.startswith("tel:"):
            phone = href.replace("tel:", "").strip()
            if phone:
                phones.append(phone)
    return emails, phones


def _prioritise_emails(emails: list[str]) -> list[str]:
    """
    Prefer business-role addresses (info@, sales@, contact@, …).
    Falls back to the full list (capped at 5) if none found.
    """
    business = [e for e in emails if any(kw in e.lower() for kw in BUSINESS_EMAIL_KEYWORDS)]
    return business if business else emails[:5]


# ─── App setup ────────────────────────────────────────────────────────────────
app = FastAPI(title="Prospect Research API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Storage helpers ──────────────────────────────────────────────────────────

def load_results() -> list:
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text())
        except Exception:
            return []
    return []


def save_results(results: list) -> None:
    DATA_FILE.write_text(json.dumps(results, indent=2))


def upsert_result(profile: dict) -> None:
    results = load_results()
    for i, r in enumerate(results):
        # Match by source_url (if present) or website_name (if not empty)
        if (r.get("source_url") and r.get("source_url") == profile.get("source_url")) or \
           (r.get("website_name") and r.get("website_name") == profile.get("website_name")):
            results[i] = profile
            save_results(results)
            return
    results.append(profile)
    save_results(results)


# ─── Scraping helpers ─────────────────────────────────────────────────────────

def fuzzy_score(url: str) -> int:
    """Score a URL by likelihood of containing useful company info."""
    path = urlparse(url).path.lower()
    score = sum(1 for kw in RELEVANT_KEYWORDS if kw in path)
    score -= max(0, path.count("/") - 2)
    return score


def clean_html(html: str) -> str:
    """Strip HTML to meaningful text; removes all boilerplate and noise."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "iframe", "img",
                     "svg", "nav", "footer", "header", "aside",
                     "form", "button", "input", "select", "textarea",
                     "meta", "link", "figure", "picture", "video", "audio"]):
        tag.decompose()
    text = soup.get_text(separator=" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:3000]


def extract_meta_fallback(html: str, url: str = "") -> str:
    """
    For JS-heavy sites where body text is minimal, extract server-rendered data:
    - <title>, <meta name="description">, og:description, og:site_name
    - JSON-LD structured data (often contains business info)
    - <noscript> text
    These are present even on React/Next.js pages before hydration.
    """
    soup = BeautifulSoup(html, "html.parser")
    parts: list[str] = []

    if soup.title:
        parts.append(f"Site title: {soup.title.string}")

    for meta in soup.find_all("meta"):
        name = meta.get("name", "") or meta.get("property", "")
        content = meta.get("content", "")
        if name in ("description", "og:description", "og:site_name",
                    "twitter:description", "twitter:title") and content:
            parts.append(f"{name}: {content}")

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            parts.append("Structured data: " + json.dumps(data)[:800])
        except Exception:
            pass

    for ns in soup.find_all("noscript"):
        t = ns.get_text(strip=True)
        if len(t) > 20:
            parts.append(t)

    return " | ".join(parts)


async def fetch_page(client: httpx.AsyncClient, url: str) -> Optional[str]:
    """Fetch a single page. Returns raw HTML or None."""
    try:
        r = await client.get(url, headers=HEADERS, timeout=12, follow_redirects=True)
        ct = r.headers.get("content-type", "")
        if r.status_code == 200 and "text/html" in ct:
            return r.text
    except Exception:
        pass
    return None


async def get_sitemap_url_from_robots(client: httpx.AsyncClient, origin: str) -> Optional[str]:
    """Parse robots.txt and extract Sitemap: directive."""
    try:
        r = await client.get(f"{origin}/robots.txt", headers=HEADERS, timeout=6,
                             follow_redirects=True)
        if r.status_code == 200:
            for line in r.text.splitlines():
                if line.lower().startswith("sitemap:"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return None


async def get_relevant_urls(client: httpx.AsyncClient, base_url: str) -> list[str]:
    """
    Multi-strategy URL discovery:
    1. robots.txt → Sitemap directive
    2. sitemap.xml / sitemap_index.xml
    3. Homepage link extraction + fuzzy scoring
    4. Common path guessing (fallback)
    Contact/about pages are always prioritised at the top of the list.
    """
    parsed = urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    relevant: set[str] = set()

    # Strategy 1 — robots.txt sitemap discovery
    robots_sitemap = await get_sitemap_url_from_robots(client, origin)
    sitemap_candidates = []
    if robots_sitemap:
        sitemap_candidates.append(robots_sitemap)
    sitemap_candidates += [
        f"{origin}/sitemap.xml",
        f"{origin}/sitemap_index.xml",
    ]

    # Strategy 2 — Parse sitemaps
    for sm_url in sitemap_candidates:
        try:
            r = await client.get(sm_url, headers=HEADERS, timeout=8, follow_redirects=True)
            if r.status_code == 200:
                locs = re.findall(r"<loc>(.*?)</loc>", r.text, re.IGNORECASE)
                locs = [l for l in locs if parsed.netloc in l]
                scored = sorted(locs, key=fuzzy_score, reverse=True)
                relevant.update(scored[:6])
                if scored:
                    break
        except Exception:
            pass

    # Strategy 3 — Homepage link extraction
    html = await fetch_page(client, base_url)
    if html:
        soup = BeautifulSoup(html, "html.parser")
        links: list[str] = []
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if href.startswith("http"):
                full = href
            elif href.startswith("/"):
                full = origin + href
            else:
                continue
            if parsed.netloc in urlparse(full).netloc:
                links.append(full)
        scored_links = sorted(set(links), key=fuzzy_score, reverse=True)
        relevant.update(scored_links[:8])

    # Strategy 4 — Common path guesses
    for g in ["/about", "/about-us", "/contact", "/contact-us",
              "/services", "/solutions", "/products", "/team",
              "/get-in-touch", "/reach-us", "/company", "/overview"]:
        relevant.add(origin + g)

    relevant.add(base_url)

    # Prioritise contact / about pages at the front
    must_have = [
        u for u in relevant
        if any(x in urlparse(u).path.lower()
               for x in ["contact", "about", "company", "reach", "connect", "location"])
    ]
    must_have = list(dict.fromkeys(must_have))  # preserve order, deduplicate

    others = [u for u in relevant if u not in must_have]
    final_urls = must_have + sorted(others, key=fuzzy_score, reverse=True)

    return final_urls[:10]


async def scrape_company(url: str) -> dict:
    """Scrape relevant pages. Returns cleaned text, raw text, and href contacts."""
    async with httpx.AsyncClient() as client:
        urls = await get_relevant_urls(client, url)

        tasks = [fetch_page(client, u) for u in urls]
        pages = await asyncio.gather(*tasks)

        combined_clean = ""
        combined_raw = ""
        fetched_urls: list[str] = []
        all_href_emails: list[str] = []
        all_href_phones: list[str] = []

        for page_url, html in zip(urls, pages):
            if not html:
                continue

            # Collect href-based contacts from every page
            h_emails, h_phones = extract_href_contacts(html)
            all_href_emails.extend(h_emails)
            all_href_phones.extend(h_phones)

            cleaned = clean_html(html)

            # JS-rendered fallback: use meta/JSON-LD when body text is sparse
            if len(cleaned) < 500:
                meta_text = extract_meta_fallback(html, page_url)
                if meta_text:
                    cleaned = meta_text

            if len(cleaned) > 80:
                combined_clean += f"\n\n[PAGE: {page_url}]\n{cleaned}"
                combined_raw += f"\n{cleaned}"
                fetched_urls.append(page_url)

        return {
            "text": combined_clean[:6000],
            "raw_text": combined_raw,
            "pages_scraped": fetched_urls,
            "href_emails": list(set(all_href_emails)),
            "href_phones": list(set(all_href_phones)),
        }


# ─── AI enrichment (Gemini Flash) ─────────────────────────────────────────────

SYSTEM_PROMPT = """You are a precise business intelligence analyst. Extract company information ONLY from the provided scraped text.

CRITICAL RULES:
- NEVER fabricate or hallucinate any data
- Do NOT generate emails, phone numbers, or addresses — these are pre-extracted and provided separately
- If a field is not present in the text, return "" (empty string)
- Return ONLY a valid JSON object — no markdown fences, no explanation, no extra text

Output exactly this JSON schema (nothing else):
{
  "website_name": "short brand/site name",
  "company_name": "full legal or trading company name",
  "address": "physical address found in text — if multiple offices exist, return the most complete headquarters address; else \"\"",
  "core_service": "primary service or product in 1 clear sentence",
  "target_customer": "who they serve, inferred from context",
  "probable_pain_point": "1 sentence — key challenge their customers face that this company solves",
  "outreach_opener": " "Write a realistic B2B cold outreach opener. Mention a specific observation about the company and briefly suggest how an external service could help improve efficiency, growth, automation, customer experience, revenue, or operations. Avoid generic compliments."
}"""


def enrich_with_ai(url: str, scraped_text: str) -> dict:
    """Use Gemini Flash to extract structured profile. Contacts are injected separately."""
    genai.configure(api_key=GOOGLE_API_KEY)
    model = genai.GenerativeModel(
        model_name="gemini-flash-latest",
        system_instruction=SYSTEM_PROMPT,
    )

    user_msg = (
        f"Company URL: {url}\n\n"
        f"Scraped website content:\n{scraped_text}\n\n"
        "Extract the company profile JSON. Remember: do NOT include or invent emails/phone numbers."
    )

    response = model.generate_content(user_msg)
    raw = response.text.strip()

    # Strip markdown fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)

    # Extract the first JSON object even if there's trailing prose
    json_match = re.search(r"\{[\s\S]*\}", raw)
    if not json_match:
        raise ValueError("No JSON object found in AI response")

    try:
        return json.loads(json_match.group())
    except json.JSONDecodeError:
        return {k: "" for k in [
            "website_name", "company_name", "address",
            "core_service", "target_customer",
            "probable_pain_point", "outreach_opener",
        ]}


# ─── Main pipeline ─────────────────────────────────────────────────────────────

def build_profile(url: str, scraped: dict) -> dict:
    """
    Full pipeline:
    1. Regex-extract contacts from raw text (never hallucinated).
    2. Merge href-based contacts (mailto:/tel: links).
    3. Prioritise business-role email addresses.
    4. AI extracts all non-contact fields.
    5. Merge into final profile.
    """
    # Step 1: regex contacts from visible text
    regex_emails, phone = regex_extract_contacts(scraped["raw_text"])

    # Step 2: merge with href contacts — strip, deduplicate, drop blanks
    all_emails = list({
        e.strip()
        for e in (regex_emails + scraped.get("href_emails", []))
        if e and e.strip()
    })
    if not phone and scraped.get("href_phones"):
        phone = scraped["href_phones"][0]

    # Step 3: prefer business-role addresses
    emails = _prioritise_emails(all_emails)

    # Step 4: AI handles non-contact fields only
    ai_profile = enrich_with_ai(url, scraped["text"])

    # Step 5: assemble — strict hackathon schema, no extra fields
    profile = {
        "website_name":        ai_profile.get("website_name", ""),
        "company_name":        ai_profile.get("company_name", ""),
        "address":             ai_profile.get("address", ""),
        "mobile_number":       phone,
        "mail":                emails,
        "core_service":        ai_profile.get("core_service", ""),
        "target_customer":     ai_profile.get("target_customer", ""),
        "probable_pain_point": ai_profile.get("probable_pain_point", ""),
        "outreach_opener":     ai_profile.get("outreach_opener", ""),
        "source_url":          url,
    }
    return profile


# ─── API Models ───────────────────────────────────────────────────────────────

class EnrichRequest(BaseModel):
    url: str
    website_name: Optional[str] = ""


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/enrich")
async def enrich(req: EnrichRequest):
    url = req.url.strip()
    if not url.startswith("http"):
        url = "https://" + url

    try:
        scraped = await scrape_company(url)
        if not scraped["text"]:
            raise HTTPException(
                status_code=422,
                detail="Could not scrape any content. Site may be fully JS-rendered or blocked.",
            )

        profile = build_profile(url, scraped)

        if req.website_name:
            profile["website_name"] = req.website_name

        upsert_result(profile)
        return profile

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/results")
def get_results():
    return load_results()


@app.get("/health")
def health():
    return {"status": "ok"}


frontend_path = Path(__file__).parent.parent / "frontend"
dist_path = frontend_path / "dist"

@app.get("/")
def serve_frontend():
    # If built React app index exists, serve it
    index_dist = dist_path / "index.html"
    if index_dist.exists():
        return FileResponse(str(index_dist))
    
    # Fallback to the original HTML
    index = frontend_path / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"message": "API running — visit /docs"}

# Mount assets if build folder exists, otherwise fallback to static
assets_path = dist_path / "assets"
if assets_path.exists():
    app.mount("/assets", StaticFiles(directory=str(assets_path)), name="assets")
if dist_path.exists():
    app.mount("/dist", StaticFiles(directory=str(dist_path)), name="dist")
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")
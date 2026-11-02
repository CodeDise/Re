"""
Content Extraction, Telegraph Instant View, YouTube Transcript & Gemini AI Summarizer
=====================================================================================
1. Clean Web Reader: Scrapes URLs using `trafilatura` (with `readability-lxml` fallback),
   strips ads/trackers, formats clean HTML, and publishes to Telegraph.
2. YouTube Processor: Extracts video metadata & captions via `youtube-transcript-api`
   and builds an executive bullet-point summary with timestamps breakdown.
3. Gemini AI Summarizer: Generates 3-sentence TL;DR, Key Bullet Points, and Estimated
   Read/Watch Time using `google-generativeai`.
4. Clean PDF Exporter: Converts the sanitized article + AI summary into a styled A4 PDF
   using `weasyprint` (with `reportlab` fallback).
"""

import asyncio
import html
import io
import json
import logging
import math
import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from urllib.parse import urlparse, parse_qs

import aiohttp
import google.generativeai as genai
import trafilatura
from bs4 import BeautifulSoup
from readability import Document
from telegraph.aio import Telegraph
from youtube_transcript_api import YouTubeTranscriptApi

from config import Config

logger = logging.getLogger(__name__)

# Configure Google Gemini SDK
if Config.GEMINI_API_KEY:
    genai.configure(api_key=Config.GEMINI_API_KEY)


YOUTUBE_REGEX = re.compile(
    r"(?:https?://)?(?:www\.|m\.)?(?:youtube\.com/(?:watch\?v=|shorts/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


@dataclass
class ExtractedResult:
    url: str
    is_youtube: bool
    title: str
    author_or_channel: str
    clean_text: str
    clean_html: str
    tldr_three_sentences: str
    bullet_points: List[str] = field(default_factory=list)
    timestamps_breakdown: List[str] = field(default_factory=list)
    estimated_read_minutes: int = 3
    telegraph_url: str = ""
    word_count: int = 0


class ExtractorService:
    def __init__(self) -> None:
        self.telegraph = Telegraph(access_token=None)
        self._telegraph_ready = False

    async def init_telegraph(self) -> None:
        """Create an anonymous Telegraph account for publishing Instant View pages."""
        if self._telegraph_ready:
            return
        try:
            await self.telegraph.create_account(
                short_name=Config.TELEGRAPH_SHORT_NAME[:30],
                author_name=Config.TELEGRAPH_AUTHOR_NAME[:120],
            )
            self._telegraph_ready = True
            logger.info("Telegraph Instant View account initialized.")
        except Exception as exc:
            logger.warning("Telegraph account creation warning: %s", exc)

    @staticmethod
    def extract_youtube_id(url: str) -> Optional[str]:
        match = YOUTUBE_REGEX.search(url)
        if match:
            return match.group(1)
        parsed = urlparse(url)
        if "youtube.com" in parsed.netloc:
            qs = parse_qs(parsed.query)
            if "v" in qs and qs["v"]:
                return qs["v"][0][:11]
        return None

    async def _fetch_html(self, url: str) -> str:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(url, allow_redirects=True) as resp:
                resp.raise_for_status()
                return await resp.text(errors="replace")

    def _scrape_article_sync(self, raw_html: str, url: str) -> Dict[str, str]:
        """
        Primary extraction with `trafilatura`, fallback to `readability-lxml`.
        Strips ads, trackers, scripts, and normalizes HTML for Telegraph & PDF.
        """
        metadata = trafilatura.extract_metadata(raw_html, default_url=url)
        title = (metadata.title if metadata and metadata.title else "") or ""
        author = (metadata.author if metadata and metadata.author else "") or urlparse(url).netloc

        extracted_text = trafilatura.extract(
            raw_html,
            url=url,
            include_comments=False,
            include_tables=True,
            include_images=True,
            include_links=True,
            favor_recall=True,
        )

        # Fallback to readability-lxml if trafilatura returns sparse text
        doc = Document(raw_html)
        if not title:
            title = doc.short_title() or urlparse(url).netloc
        summary_html = doc.summary(html_partial=True)

        soup = BeautifulSoup(summary_html, "lxml")
        for bad_tag in soup(["script", "style", "iframe", "form", "nav", "footer", "aside"]):
            bad_tag.decompose()

        if not extracted_text or len(extracted_text.strip()) < 120:
            extracted_text = soup.get_text(separator="\n\n", strip=True)

        # Build Telegraph-compatible subset of HTML tags
        allowed_tags = {"p", "h3", "h4", "blockquote", "ul", "ol", "li", "b", "strong", "i", "em", "a", "img", "pre", "code"}
        clean_nodes: List[str] = []
        for elem in soup.find_all(["h1", "h2", "h3", "h4", "p", "blockquote", "ul", "ol", "pre", "img"]):
            if elem.name in ("h1", "h2"):
                elem.name = "h3"
            if elem.name == "img":
                src = elem.get("src", "")
                if src.startswith("http"):
                    clean_nodes.append(f'<img src="{html.escape(src)}"/>')
                continue
            text_val = elem.get_text(" ", strip=True)
            if len(text_val) < 2:
                continue
            tag = elem.name if elem.name in allowed_tags else "p"
            clean_nodes.append(f"<{tag}>{html.escape(text_val)}</{tag}>")

        if not clean_nodes and extracted_text:
            for para in extracted_text.split("\n\n"):
                if para.strip():
                    clean_nodes.append(f"<p>{html.escape(para.strip())}</p>")

        return {
            "title": title.strip() or "Extracted Web Article",
            "author": author.strip(),
            "text": extracted_text.strip(),
            "html": "\n".join(clean_nodes),
        }

    async def _extract_youtube(self, url: str, video_id: str) -> Dict[str, str]:
        """Extract YouTube video title, author, and timestamped transcript."""
        title = f"YouTube Video ({video_id})"
        author = "YouTube Creator"

        # Fetch oEmbed metadata for accurate video title & channel
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(oembed_url, timeout=10) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        title = data.get("title", title)
                        author = data.get("author_name", author)
        except Exception as exc:
            logger.debug("YouTube oEmbed metadata fallback: %s", exc)

        def _fetch_transcript() -> List[Dict[str, Any]]:
            return YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "en-US", "en-GB", "hi"])

        try:
            transcript_items = await asyncio.to_thread(_fetch_transcript)
        except Exception as exc:
            logger.warning("Transcript fetch issue for %s: %s", video_id, exc)
            transcript_items = []

        formatted_lines: List[str] = []
        html_paragraphs: List[str] = [
            f"<p><b>YouTube Video:</b> <a href='https://www.youtube.com/watch?v={video_id}'>{html.escape(title)}</a></p>",
            f"<p><b>Channel:</b> {html.escape(author)}</p>",
        ]

        for entry in transcript_items:
            seconds = int(entry.get("start", 0))
            mins, secs = divmod(seconds, 60)
            stamp = f"[{mins:02d}:{secs:02d}]"
            snippet = entry.get("text", "").replace("\n", " ").strip()
            if snippet:
                formatted_lines.append(f"{stamp} {snippet}")

        full_transcript = "\n".join(formatted_lines) if formatted_lines else f"Video Title: {title} by {author}."
        # Group transcript lines into readable paragraphs for Telegraph
        chunk_size = 8
        for idx in range(0, len(formatted_lines), chunk_size):
            block = " ".join(formatted_lines[idx : idx + chunk_size])
            html_paragraphs.append(f"<p>{html.escape(block)}</p>")

        return {
            "title": title,
            "author": author,
            "text": full_transcript,
            "html": "\n".join(html_paragraphs),
        }

    async def _summarize_with_gemini(
        self, title: str, content_text: str, is_youtube: bool
    ) -> Dict[str, Any]:
        """
        Send extracted webpage or YouTube transcript to Google Gemini API.
        Produces structured JSON with:
          - tldr_three_sentences (string)
          - bullet_points (list of strings)
          - timestamps_breakdown (list of strings, for YouTube)
        """
        truncated = content_text[:28000]
        mode_instruction = (
            "This content is a timestamped YouTube video transcript. "
            "Provide an executive 3-sentence TL;DR, 5 key takeaways, and a chronological timestamps breakdown."
            if is_youtube
            else "This content is a scraped web article. "
            "Provide a crisp 3-sentence TL;DR and 5 key bullet points capturing the core insights."
        )

        prompt = (
            f"{mode_instruction}\n\n"
            f"Title: {title}\n\n"
            f"Content:\n{truncated}\n\n"
            "Respond strictly in valid JSON with this exact schema:\n"
            "{\n"
            '  "tldr_three_sentences": "Exactly 3 concise, high-signal sentences summarizing the piece.",\n'
            '  "bullet_points": ["Key point 1", "Key point 2", "Key point 3", "Key point 4", "Key point 5"],\n'
            '  "timestamps_breakdown": ["00:00 - Introduction & core premise", "02:15 - Main insight"]\n'
            "}"
        )

        try:
            model = genai.GenerativeModel(
                model_name=Config.GEMINI_MODEL,
                generation_config={"response_mime_type": "application/json"},
            )
            response = await model.generate_content_async(prompt)
            parsed = json.loads(response.text)
            return {
                "tldr_three_sentences": str(parsed.get("tldr_three_sentences", "")).strip(),
                "bullet_points": [str(x) for x in parsed.get("bullet_points", [])[:6]],
                "timestamps_breakdown": [
                    str(x) for x in parsed.get("timestamps_breakdown", [])[:8]
                ],
            }
        except Exception as exc:
            logger.error("Gemini summarization error: %s", exc)
            fallback_tldr = " ".join(content_text.split()[:65]) + "..."
            return {
                "tldr_three_sentences": fallback_tldr,
                "bullet_points": [
                    "Extracted clean reader text stripped of ads and tracking scripts.",
                    f"Source publication: {title}",
                ],
                "timestamps_breakdown": [],
            }

    async def publish_to_telegraph(
        self, title: str, author: str, clean_html: str, source_url: str, tldr: str
    ) -> str:
        """Publish clean HTML and AI TL;DR header to Telegraph for Instant View."""
        await self.init_telegraph()
        header_html = (
            f"<blockquote><b>✨ AI 3-Sentence TL;DR:</b> {html.escape(tldr)}</blockquote>"
            f"<p>🔗 <a href='{html.escape(source_url)}'>Read Original Source</a></p><hr/>"
        )
        full_html = (header_html + clean_html)[:60000]
        try:
            page = await self.telegraph.create_page(
                title=title[:250],
                html_content=full_html,
                author_name=author[:120] or Config.TELEGRAPH_AUTHOR_NAME,
                author_url=source_url if source_url.startswith("http") else None,
            )
            return page.get("url", "")
        except Exception as exc:
            logger.warning("Telegraph publish failed: %s", exc)
            return ""

    async def process_url(self, url: str) -> ExtractedResult:
        """Full pipeline: Scrape URL or YouTube -> Gemini AI Summary -> Telegraph IV Link."""
        yt_id = self.extract_youtube_id(url)
        is_youtube = yt_id is not None

        if is_youtube and yt_id:
            raw_data = await self._extract_youtube(url, yt_id)
        else:
            raw_html = await self._fetch_html(url)
            raw_data = await asyncio.to_thread(self._scrape_article_sync, raw_html, url)

        words = len(raw_data["text"].split())
        read_minutes = max(1, math.ceil(words / 200))

        ai_summary = await self._summarize_with_gemini(
            title=raw_data["title"],
            content_text=raw_data["text"],
            is_youtube=is_youtube,
        )

        telegraph_url = await self.publish_to_telegraph(
            title=raw_data["title"],
            author=raw_data["author"],
            clean_html=raw_data["html"],
            source_url=url,
            tldr=ai_summary["tldr_three_sentences"],
        )

        return ExtractedResult(
            url=url,
            is_youtube=is_youtube,
            title=raw_data["title"],
            author_or_channel=raw_data["author"],
            clean_text=raw_data["text"],
            clean_html=raw_data["html"],
            tldr_three_sentences=ai_summary["tldr_three_sentences"],
            bullet_points=ai_summary["bullet_points"],
            timestamps_breakdown=ai_summary["timestamps_breakdown"],
            estimated_read_minutes=read_minutes,
            telegraph_url=telegraph_url,
            word_count=words,
        )

    @staticmethod
    def render_clean_pdf_sync(result: ExtractedResult) -> bytes:
        """
        Convert ExtractedResult into a clean, print-ready A4 PDF document.
        Uses WeasyPrint first, with ReportLab fallback if system Cairo/Pango libraries are absent.
        """
        bullets_html = "".join(
            f"<li>{html.escape(b)}</li>" for b in result.bullet_points
        )
        timestamps_html = (
            "<h3>⏱ Timestamps Breakdown</h3><ul>"
            + "".join(f"<li>{html.escape(t)}</li>" for t in result.timestamps_breakdown)
            + "</ul>"
            if result.timestamps_breakdown
            else ""
        )

        styled_doc = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    @page {{ size: A4; margin: 20mm 18mm; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; line-height: 1.65; font-size: 11pt; }}
    .header {{ border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }}
    h1 {{ font-size: 20pt; line-height: 1.25; margin: 0 0 8px 0; color: #0f172a; }}
    .meta {{ font-size: 9.5pt; color: #475569; }}
    .summary-box {{ background: #f8fafc; border: 1px solid #cbd5e1; padding: 14px 16px; border-radius: 6px; margin-bottom: 22px; }}
    .summary-box h3 {{ margin-top: 0; font-size: 11.5pt; color: #0f172a; }}
    p {{ margin: 0 0 12px 0; text-align: justify; }}
    img {{ max-width: 100%; height: auto; margin: 12px 0; }}
    blockquote {{ border-left: 3px solid #334155; padding-left: 12px; color: #334155; font-style: italic; }}
  </style>
</head>
<body>
  <div class="header">
    <h1>{html.escape(result.title)}</h1>
    <div class="meta">
      Source: {html.escape(result.url)} &bull; Author: {html.escape(result.author_or_channel)} &bull;
      Est. Read Time: {result.estimated_read_minutes} min ({result.word_count} words)
    </div>
  </div>
  <div class="summary-box">
    <h3>✨ Executive AI TL;DR</h3>
    <p>{html.escape(result.tldr_three_sentences)}</p>
    <h3>📌 Key Takeaways</h3>
    <ul>{bullets_html}</ul>
    {timestamps_html}
  </div>
  <div class="article-body">
    {result.clean_html}
  </div>
</body>
</html>"""

        try:
            from weasyprint import HTML  # type: ignore

            return HTML(string=styled_doc, base_url=result.url).write_pdf()
        except Exception as exc:
            logger.info("Using ReportLab PDF engine fallback: %s", exc)
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.styles import getSampleStyleSheet
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

            buf = io.BytesIO()
            doc = SimpleDocTemplate(buf, pagesize=A4)
            styles = getSampleStyleSheet()
            story = [
                Paragraph(html.escape(result.title), styles["Title"]),
                Spacer(1, 8),
                Paragraph(
                    f"<b>Source:</b> {html.escape(result.url)} | <b>Read Time:</b> {result.estimated_read_minutes} min",
                    styles["Normal"],
                ),
                Spacer(1, 12),
                Paragraph("<b>AI 3-Sentence TL;DR:</b>", styles["Heading3"]),
                Paragraph(html.escape(result.tldr_three_sentences), styles["BodyText"]),
                Spacer(1, 10),
                Paragraph("<b>Key Bullet Points:</b>", styles["Heading3"]),
            ]
            for bp in result.bullet_points:
                story.append(Paragraph(f"• {html.escape(bp)}", styles["BodyText"]))
            story.append(Spacer(1, 14))
            story.append(Paragraph("<b>Clean Extracted Content:</b>", styles["Heading3"]))
            for para in result.clean_text.split("\n\n")[:60]:
                if para.strip():
                    story.append(Paragraph(html.escape(para.strip()), styles["BodyText"]))
                    story.append(Spacer(1, 6))
            doc.build(story)
            return buf.getvalue()


extractor_service = ExtractorService()

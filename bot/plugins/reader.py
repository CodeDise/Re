"""
Clean Web Reader, YouTube Summarizer & PDF Export Plugin (plugins/reader.py)
============================================================================
- Dual Environment Compatibility:
  * Private Messages (PM): Automatically processes any submitted HTTP/HTTPS link.
  * Telegram Groups: Triggered via `/read <URL>` or `/summary <URL>`.
- Enforces Force-Subscribe (FSUB) in PM and daily Free Tier quota limits.
- Publishes clean articles to Telegraph Instant View + Gemini AI Summary.
- Provides `[📥 Export Clean PDF]` inline button which uploads the PDF to
  `Config.LOG_CHANNEL_ID` first and then delivers it to the user.
"""

import asyncio
import hashlib
import html
import logging
import re
from typing import Dict
from pyrogram import Client, filters
from pyrogram.enums import ChatType
from pyrogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)
from config import Config
from database import db
from utils.fsub import force_subscribe
from utils.extractor import extractor_service, ExtractedResult
from utils.logger import log_activity, upload_pdf_to_log_and_deliver

logger = logging.getLogger(__name__)

URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)

# In-memory LRU-style cache keyed by 12-char URL hash for instant PDF export callbacks
EXTRACTED_CACHE: Dict[str, ExtractedResult] = {}


def _hash_url(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]


def _format_summary_response(
    res: ExtractedResult, remaining_quota: int, is_premium: bool
) -> str:
    icon = "🎬" if res.is_youtube else "📰"
    type_label = "YouTube Video Summary" if res.is_youtube else "Clean Reader & AI Summary"

    bullets = "\n".join(f"• {html.escape(bp)}" for bp in res.bullet_points)
    timestamps_section = ""
    if res.is_youtube and res.timestamps_breakdown:
        ts_lines = "\n".join(
            f"  <code>{html.escape(ts)}</code>" for ts in res.timestamps_breakdown
        )
        timestamps_section = f"\n\n⏱ <b>Timestamps Breakdown:</b>\n{ts_lines}"

    iv_line = (
        f"⚡ <b>Instant View:</b> <a href='{html.escape(res.telegraph_url)}'>Open Clean Telegraph Reader</a>\n"
        if res.telegraph_url
        else ""
    )

    quota_footer = (
        "💎 <i>Premium Tier • Unlimited Access</i>"
        if is_premium
        else f"🆓 <i>Free Tier • {remaining_quota}/{Config.FREE_DAILY_LIMIT} daily reads remaining</i>"
    )

    return (
        f"{icon} <b>{html.escape(res.title)}</b>\n"
        f"✍️ <i>{html.escape(res.author_or_channel)}</i>  •  ⏱ <b>~{res.estimated_read_minutes} min read</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{iv_line}"
        f"🔗 <b>Original Source:</b> <a href='{html.escape(res.url)}'>{html.escape(res.url[:55])}</a>\n\n"
        f"✨ <b>Gemini 3-Sentence TL;DR:</b>\n"
        f"<blockquote>{html.escape(res.tldr_three_sentences)}</blockquote>\n\n"
        f"📌 <b>Key Takeaways ({type_label}):</b>\n"
        f"{bullets}"
        f"{timestamps_section}\n\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{quota_footer}"
    )


def _build_article_keyboard(
    url_hash: str, telegraph_url: str, original_url: str
) -> InlineKeyboardMarkup:
    top_row = []
    if telegraph_url:
        top_row.append(
            InlineKeyboardButton("⚡ Telegraph Instant View", url=telegraph_url)
        )
    top_row.append(InlineKeyboardButton("🌐 Original Link", url=original_url))

    return InlineKeyboardMarkup(
        [
            top_row,
            [
                InlineKeyboardButton(
                    "📥 Export Clean PDF", callback_data=f"export_pdf_{url_hash}"
                )
            ],
        ]
    )


async def _handle_url_extraction(client: Client, message: Message, target_url: str) -> None:
    user = message.from_user
    if not user:
        return

    # 1. Check Daily Quota (Free vs. Premium)
    allowed, user_doc, remaining = await db.check_and_consume_quota(
        user.id, user.first_name or "User", user.username
    )
    is_premium = bool(user_doc.get("is_premium"))

    if not allowed:
        await message.reply_text(
            "⚠️ <b>Daily Free Limit Reached!</b>\n\n"
            f"You have used all <b>{Config.FREE_DAILY_LIMIT}/{Config.FREE_DAILY_LIMIT}</b> "
            "free articles/summaries for today.\n\n"
            "💎 <b>Upgrade to CleanReader Premium</b> for:\n"
            "• Unlimited Clean Web Articles & Telegraph Instant Views\n"
            "• Unlimited YouTube Transcript Summaries\n"
            "• Priority Gemini AI Processing & Instant PDF Exports",
            reply_markup=InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton(
                            "💎 Upgrade to Premium", callback_data="nav_premium"
                        )
                    ]
                ]
            ),
            quote=True,
        )
        return

    status_msg = await message.reply_text(
        "⏳ <b>Processing Link...</b>\n"
        "<i>Scraping clean content, stripping trackers & synthesizing with Gemini AI...</i>",
        quote=True,
    )

    try:
        result = await extractor_service.process_url(target_url)
        url_hash = _hash_url(target_url)
        EXTRACTED_CACHE[url_hash] = result

        # Update global metrics in MongoDB
        metric_key = "youtube_summaries" if result.is_youtube else "articles_scraped"
        await db.increment_metric(metric_key)

        response_html = _format_summary_response(result, remaining, is_premium)
        keyboard = _build_article_keyboard(
            url_hash, result.telegraph_url, result.url
        )

        await status_msg.edit_text(
            response_html,
            reply_markup=keyboard,
            disable_web_page_preview=False,
        )

        # Log activity to Config.LOG_CHANNEL_ID
        action_label = (
            "YouTube Video Summary" if result.is_youtube else "Article Scraped"
        )
        await log_activity(
            client=client,
            user=user,
            is_premium=is_premium,
            action=action_label,
            original_url=result.url,
            title=result.title,
            telegraph_url=result.telegraph_url,
            extra_note=f"Est. {result.estimated_read_minutes} min ({result.word_count} words)",
        )
    except Exception as exc:
        logger.exception("Error processing URL %s: %s", target_url, exc)
        await status_msg.edit_text(
            "❌ <b>Extraction Failed</b>\n\n"
            f"Could not extract readable content from:\n<code>{html.escape(target_url[:100])}</code>\n\n"
            f"<i>Reason: {html.escape(str(exc)[:180])}</i>"
        )


@Client.on_message(filters.command(["read", "summary", "summarize"]))
@force_subscribe
async def group_and_pm_read_command(client: Client, message: Message) -> None:
    """
    Handles `/read <URL>` and `/summary <URL>` in both Groups and PMs.
    Also supports replying `/read` to an existing message containing a link.
    """
    target_url = None
    if len(message.command) > 1:
        match = URL_PATTERN.search(" ".join(message.command[1:]))
        if match:
            target_url = match.group(0)

    if not target_url and message.reply_to_message:
        reply_text = (
            message.reply_to_message.text or message.reply_to_message.caption or ""
        )
        match = URL_PATTERN.search(reply_text)
        if match:
            target_url = match.group(0)

    if not target_url:
        await message.reply_text(
            "ℹ️ <b>Usage:</b>\n"
            "• <code>/read https://example.com/article</code>\n"
            "• <code>/summary https://youtube.com/watch?v=...</code>\n"
            "Or reply <code>/read</code> to any message containing a link!",
            quote=True,
        )
        return

    await _handle_url_extraction(client, message, target_url)


@Client.on_message(
    filters.private
    & filters.text
    & ~filters.command(
        [
            "start",
            "help",
            "myaccount",
            "read",
            "summary",
            "summarize",
            "stats",
            "broadcast",
            "addpremium",
            "removepremium",
        ]
    )
)
@force_subscribe
async def pm_direct_url_handler(client: Client, message: Message) -> None:
    """
    In Private Messages, automatically detect and process any URL pasted by the user.
    If the message is not a URL, check if the user is submitting a UPI UTR reference ID.
    """
    text = message.text or ""
    match = URL_PATTERN.search(text)
    if not match:
        # Allow plugins/premium.py to handle UTR text if user has a pending payment plan
        message.continue_propagation()
        return

    await _handle_url_extraction(client, message, match.group(0))


@Client.on_callback_query(filters.regex(r"^export_pdf_([a-f0-9]{12})$"))
@force_subscribe
async def export_pdf_callback_handler(client: Client, callback: CallbackQuery) -> None:
    """
    Converts the clean article into a formatted A4 PDF, uploads it to
    Config.LOG_CHANNEL_ID first, and delivers it to the user.
    """
    user = callback.from_user
    msg = callback.message
    if not user or not msg:
        return

    url_hash = callback.matches[0].group(1)
    cached = EXTRACTED_CACHE.get(url_hash)
    if not cached:
        await callback.answer(
            "⚠️ Session cache expired for this article. Please send the URL again.",
            show_alert=True,
        )
        return

    await callback.answer("📥 Generating Clean PDF Document...", show_alert=False)
    progress = await msg.reply_text("🖨 <i>Rendering clean A4 PDF & archiving...</i>")

    try:
        user_doc = await db.ensure_user(user.id, user.first_name or "User", user.username)
        is_premium = bool(user_doc.get("is_premium"))

        pdf_bytes = await asyncio.to_thread(
            extractor_service.render_clean_pdf_sync, cached
        )
        safe_slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", cached.title[:45]).strip("_") or "Article"
        filename = f"CleanReader_{safe_slug}.pdf"

        await upload_pdf_to_log_and_deliver(
            client=client,
            user=user,
            target_chat_id=msg.chat.id,
            is_premium=is_premium,
            pdf_bytes=pdf_bytes,
            filename=filename,
            title=cached.title,
            original_url=cached.url,
            telegraph_url=cached.telegraph_url,
            reply_to_message_id=msg.id,
        )
        await db.increment_metric("pdfs_exported")
        await progress.delete()
    except Exception as exc:
        logger.exception("PDF export failed: %s", exc)
        await progress.edit_text(
            f"❌ <b>PDF Export Failed:</b> <code>{html.escape(str(exc)[:150])}</code>"
        )

"""
Inline Mode Support Plugin (plugins/inline.py)
==============================================
Allows users to type `@botusername <URL>` in any Telegram chat.
Parses the URL on-the-fly and returns inline query results with clean
Telegraph Instant View and Gemini AI Summary preview cards.
"""

import hashlib
import html
import logging
import re
from pyrogram import Client
from pyrogram.types import (
    InlineQuery,
    InlineQueryResultArticle,
    InputTextMessageContent,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)
from config import Config
from database import db
from utils.extractor import extractor_service
from utils.logger import log_activity

logger = logging.getLogger(__name__)

URL_REGEX = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


@Client.on_inline_query()
async def inline_url_query_handler(client: Client, inline_query: InlineQuery) -> None:
    query_str = (inline_query.query or "").strip()
    user = inline_query.from_user

    if not query_str:
        await inline_query.answer(
            results=[],
            switch_pm_text="Paste any Article or YouTube URL after @botusername",
            switch_pm_parameter="inline_help",
            cache_time=5,
        )
        return

    match = URL_REGEX.search(query_str)
    if not match:
        await inline_query.answer(
            results=[
                InlineQueryResultArticle(
                    id="invalid_url_hint",
                    title="🔗 Paste a valid HTTP/HTTPS URL",
                    description=f"Example: @{Config.BOT_USERNAME} https://paulgraham.com/greatwork.html",
                    input_message_content=InputTextMessageContent(
                        f"💡 Use <code>@{Config.BOT_USERNAME} &lt;URL&gt;</code> to generate an instant clean summary."
                    ),
                )
            ],
            cache_time=5,
        )
        return

    target_url = match.group(0)
    result_id = hashlib.md5(target_url.encode("utf-8")).hexdigest()

    try:
        user_doc = await db.ensure_user(
            user.id, user.first_name or "User", user.username
        )
        is_premium = bool(user_doc.get("is_premium"))

        extracted = await extractor_service.process_url(target_url)
        bullets_formatted = "\n".join(
            f"• {html.escape(b)}" for b in extracted.bullet_points[:4]
        )

        card_message_html = (
            f"⚡ <b>{html.escape(extracted.title)}</b>\n"
            f"⏱ <i>~{extracted.estimated_read_minutes} min read</i>  •  "
            f"✍️ <i>{html.escape(extracted.author_or_channel)}</i>\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            f"✨ <b>3-Sentence TL;DR:</b>\n"
            f"<blockquote>{html.escape(extracted.tldr_three_sentences)}</blockquote>\n\n"
            f"📌 <b>Key Points:</b>\n{bullets_formatted}\n\n"
            + (
                f"📖 <a href='{html.escape(extracted.telegraph_url)}'>Open Telegraph Instant View</a>  |  "
                if extracted.telegraph_url
                else ""
            )
            + f"🔗 <a href='{html.escape(extracted.url)}'>Original Source</a>"
        )

        buttons = []
        if extracted.telegraph_url:
            buttons.append(
                [
                    InlineKeyboardButton(
                        "⚡ Read Clean Instant View", url=extracted.telegraph_url
                    )
                ]
            )
        buttons.append(
            [
                InlineKeyboardButton("🌐 Original URL", url=extracted.url),
                InlineKeyboardButton(
                    "📥 Open in Bot for PDF",
                    url=f"https://t.me/{Config.BOT_USERNAME}?start=inline",
                ),
            ]
        )

        await inline_query.answer(
            results=[
                InlineQueryResultArticle(
                    id=result_id,
                    title=f"⚡ {extracted.title[:70]}",
                    description=f"({extracted.estimated_read_minutes}m read) {extracted.tldr_three_sentences[:120]}",
                    input_message_content=InputTextMessageContent(
                        message_text=card_message_html,
                        disable_web_page_preview=False,
                    ),
                    reply_markup=InlineKeyboardMarkup(buttons),
                )
            ],
            cache_time=300,
            is_personal=True,
        )

        await log_activity(
            client=client,
            user=user,
            is_premium=is_premium,
            action="Inline Mode Summary",
            original_url=extracted.url,
            title=extracted.title,
            telegraph_url=extracted.telegraph_url,
        )
    except Exception as exc:
        logger.warning("Inline extraction error for %s: %s", target_url, exc)
        await inline_query.answer(
            results=[
                InlineQueryResultArticle(
                    id=f"err_{result_id[:10]}",
                    title="⚠️ Could not parse URL in inline window",
                    description="Tap to send this link directly to the bot in PM for full scraping.",
                    input_message_content=InputTextMessageContent(
                        f"/read {html.escape(target_url)}"
                    ),
                )
            ],
            cache_time=5,
        )

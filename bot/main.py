"""
CleanReader & Media Summarizer Bot - Entry Point (main.py)
==========================================================
Initializes the Pyrogram v2.x Client, Motor MongoDB indexes,
Telegraph Instant View account, and background tasks.
"""

import asyncio
import logging
from pyrogram import Client, idle
from pyrogram.enums import ParseMode
from config import Config
from database import db
from utils.extractor import extractor_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("CleanReaderBot")
logging.getLogger("pyrogram").setLevel(logging.WARNING)


async def main() -> None:
    Config.validate()

    # Initialize MongoDB indexes
    await db.initialize_indexes()

    # Initialize Telegraph account for Instant View publishing
    await extractor_service.init_telegraph()

    app = Client(
        name="cleanreader_bot_session",
        api_id=Config.API_ID,
        api_hash=Config.API_HASH,
        bot_token=Config.BOT_TOKEN,
        plugins=dict(root="plugins"),
        parse_mode=ParseMode.HTML,
        workers=16,
    )

    logger.info("Starting CleanReader & Media Summarizer Bot...")
    await app.start()

    me = await app.get_me()
    Config.BOT_USERNAME = me.username or Config.BOT_USERNAME
    logger.info(
        "Bot online as @%s (ID: %s) | FSUB: %s | Log Channel: %s",
        me.username,
        me.id,
        Config.FSUB_CHANNEL_ID,
        Config.LOG_CHANNEL_ID,
    )

    await idle()
    logger.info("Shutting down CleanReader Bot...")
    await app.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped cleanly.")

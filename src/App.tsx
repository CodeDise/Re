import React, { useState, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
import {
  Download,
  Copy,
  Check,
  FileCode,
  Send,
  RefreshCw,
  FileText,
  ExternalLink,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Database,
  CreditCard,
  Layers,
  BookOpen,
  Youtube,
  Sparkles,
  UserCheck,
  Users,
  AtSign,
  Sliders,
  Eye,
  X,
} from 'lucide-react';
import {
  ProcessedArticle,
  generateQrMatrix,
  buildCleanPdfBlob,
} from './utils/pdfAndQr';

interface BotFileItem {
  path: string;
  category: string;
  description: string;
  language: string;
  content: string;
  lines: number;
}

interface ChatInlineButton {
  label: string;
  action: string;
  url?: string;
  variant?: 'default' | 'approve' | 'reject';
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  chatMode: 'pm' | 'group';
  timestamp: string;
  title?: string;
  text: string;
  hasStartBanner?: boolean;
  qrUpiUri?: string;
  qrPlanLabel?: string;
  qrAmount?: number;
  pdfFilename?: string;
  articleData?: ProcessedArticle;
  buttons?: ChatInlineButton[][];
}

interface LogChannelEntry {
  id: string;
  type: 'ACTIVITY_LOG' | 'PDF_EXPORT' | 'PAYMENT_VERIFICATION' | 'ADMIN_EVENT';
  timestamp: string;
  userId: number;
  userName: string;
  username: string;
  isPremium: boolean;
  action: string;
  title: string;
  originalUrl?: string;
  telegraphUrl?: string;
  pdfFilename?: string;
  paymentId?: string;
  planLabel?: string;
  amount?: number;
  days?: number;
  utrOrProof?: string;
  paymentStatus?: 'pending' | 'approved' | 'rejected';
}

interface SimulatedMongoUser {
  user_id: number;
  first_name: string;
  username: string;
  joined_date: string;
  is_premium: boolean;
  premium_expiry: string | null;
  daily_usage_count: number;
  last_usage_date: string;
  total_reads: number;
  pending_payment_plan: '1m' | '3m' | 'lifetime' | null;
}

const SAMPLE_PRESETS: Array<{ label: string; url: string; kind: 'article' | 'youtube' }> = [
  {
    label: 'Paul Graham: How to Do Great Work',
    url: 'https://paulgraham.com/greatwork.html',
    kind: 'article',
  },
  {
    label: 'Python AsyncIO Architecture Guide',
    url: 'https://docs.python.org/3/library/asyncio.html',
    kind: 'article',
  },
  {
    label: 'YouTube: Andrej Karpathy — Intro to Large Language Models',
    url: 'https://www.youtube.com/watch?v=zjkBMFhNj_g',
    kind: 'youtube',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'explorer' | 'simulator' | 'config' | 'architecture'>('explorer');
  const [botFiles, setBotFiles] = useState<BotFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<boolean>(true);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('main.py');
  const [fileSearch, setFileSearch] = useState<string>('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [zipDownloading, setZipDownloading] = useState<boolean>(false);

  // Environment Configurator State
  const [envConfig, setEnvConfig] = useState({
    API_ID: '28491024',
    API_HASH: '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
    BOT_TOKEN: '7192837465:AAH_CleanReaderProductionToken_xYz',
    BOT_USERNAME: 'CleanReaderBot',
    MONGO_URI: 'mongodb+srv://botadmin:password@cluster0.mongodb.net/?retryWrites=true&w=majority',
    DATABASE_NAME: 'cleanreader_bot_db',
    GEMINI_API_KEY: 'AIzaSy_YourGoogleGeminiApiKey',
    GEMINI_MODEL: 'gemini-2.5-flash',
    ADMIN_IDS: '601928374,884920192',
    FSUB_CHANNEL_ID: '-1001987654321',
    FSUB_INVITE_LINK: 'https://t.me/+CleanReaderUpdatesChannel',
    LOG_CHANNEL_ID: '-1001122334455',
    START_IMG_URL: 'https://telegra.ph/file/cleanreader-banner-cover.jpg',
    UPI_ID: 'cleanreader@okaxis',
    UPI_PAYEE_NAME: 'CleanReader Pro Subscriptions',
    FREE_DAILY_LIMIT: '5',
    PLAN_1M_PRICE: '99',
    PLAN_3M_PRICE: '249',
    PLAN_LIFETIME_PRICE: '699',
  });

  // Simulator State
  const [chatEnvironment, setChatEnvironment] = useState<'pm' | 'group' | 'inline'>('pm');
  const [isFsubJoined, setIsFsubJoined] = useState<boolean>(true);
  const [mongoUser, setMongoUser] = useState<SimulatedMongoUser>({
    user_id: 582910421,
    first_name: 'Aarav Sharma',
    username: 'aarav_dev',
    joined_date: '2026-10-15T09:30:00Z',
    is_premium: false,
    premium_expiry: null,
    daily_usage_count: 1,
    last_usage_date: new Date().toISOString().slice(0, 10),
    total_reads: 14,
    pending_payment_plan: null,
  });

  const [globalMetrics, setGlobalMetrics] = useState({
    total_users: 1420,
    premium_users: 186,
    articles_scraped: 8940,
    youtube_summaries: 3412,
    pdfs_exported: 2195,
  });

  const [chatInput, setChatInput] = useState<string>('');
  const [inlineUrlInput, setInlineUrlInput] = useState<string>('https://paulgraham.com/greatwork.html');
  const [inlinePreviewResult, setInlinePreviewResult] = useState<ProcessedArticle | null>(null);
  const [isProcessingUrl, setIsProcessingUrl] = useState<boolean>(false);
  const [instantViewModalArticle, setInstantViewModalArticle] = useState<ProcessedArticle | null>(null);

  const nowTime = () =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-start',
      sender: 'bot',
      chatMode: 'pm',
      timestamp: '10:42',
      hasStartBanner: true,
      title: 'Welcome to CleanReader & Media Summarizer, Aarav Sharma!',
      text: 'Strip ads, popups, and paywalls from any article or extract executive AI takeaways from YouTube videos in seconds.\n\n• Clean Web Reader: Converts cluttered web links into instant Telegraph Instant View pages.\n• YouTube Summarizer: Extracts transcripts, key bullet points & timestamps.\n• Gemini AI Synthesis: 3-sentence TL;DR, key takeaways & estimated read time.\n• One-Click PDF Export: Download formatted, print-ready A4 PDFs.\n\nSend any URL or YouTube link here in PM, or use /read <url> in Groups!',
      buttons: [
        [
          { label: '📖 Help', action: 'nav_help' },
          { label: '💎 Premium Plans', action: 'nav_premium' },
        ],
        [
          { label: '👤 My Account', action: 'nav_account' },
          { label: '➕ Add to Group', action: 'switch_group' },
        ],
        [{ label: '💬 Support', action: 'nav_support' }],
      ],
    },
  ]);

  const [logChannelEntries, setLogChannelEntries] = useState<LogChannelEntry[]>([
    {
      id: 'log-seed-1',
      type: 'ACTIVITY_LOG',
      timestamp: '10:40:12 UTC',
      userId: 582910421,
      userName: 'Aarav Sharma',
      username: 'aarav_dev',
      isPremium: false,
      action: 'Article Scraped',
      title: 'The Architecture of Async Python Applications',
      originalUrl: 'https://docs.python.org/3/library/asyncio.html',
      telegraphUrl: 'https://telegra.ph/The-Architecture-of-Async-Python-11-02',
    },
  ]);

  useEffect(() => {
    async function fetchBotFiles() {
      try {
        setLoadingFiles(true);
        const resp = await fetch('/api/bot-files');
        if (resp.ok) {
          const data = await resp.json();
          setBotFiles(data.files || []);
        }
      } catch (err) {
        console.error('Failed to load bot files:', err);
      } finally {
        setLoadingFiles(false);
      }
    }
    fetchBotFiles();
  }, []);

  const filteredFiles = useMemo(() => {
    if (!fileSearch.trim()) return botFiles;
    const q = fileSearch.toLowerCase();
    return botFiles.filter(
      (f) =>
        f.path.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.content.toLowerCase().includes(q)
    );
  }, [botFiles, fileSearch]);

  const activeFile = useMemo(
    () => botFiles.find((f) => f.path === selectedFilePath) || botFiles[0] || null,
    [botFiles, selectedFilePath]
  );

  const generatedEnvContent = useMemo(() => {
    return `# CleanReader & Media Summarizer Bot - Production .env
API_ID=${envConfig.API_ID}
API_HASH=${envConfig.API_HASH}
BOT_TOKEN=${envConfig.BOT_TOKEN}
BOT_USERNAME=${envConfig.BOT_USERNAME}

MONGO_URI=${envConfig.MONGO_URI}
DATABASE_NAME=${envConfig.DATABASE_NAME}

GEMINI_API_KEY=${envConfig.GEMINI_API_KEY}
GEMINI_MODEL=${envConfig.GEMINI_MODEL}

ADMIN_IDS=${envConfig.ADMIN_IDS}

FSUB_CHANNEL_ID=${envConfig.FSUB_CHANNEL_ID}
FSUB_INVITE_LINK=${envConfig.FSUB_INVITE_LINK}

LOG_CHANNEL_ID=${envConfig.LOG_CHANNEL_ID}

START_IMG_URL=${envConfig.START_IMG_URL}
SUPPORT_CHAT_URL=https://t.me/CleanReaderSupport

FREE_DAILY_LIMIT=${envConfig.FREE_DAILY_LIMIT}
UPI_ID=${envConfig.UPI_ID}
UPI_PAYEE_NAME=${envConfig.UPI_PAYEE_NAME}
CURRENCY_SYMBOL=₹
PLAN_1M_PRICE=${envConfig.PLAN_1M_PRICE}
PLAN_3M_PRICE=${envConfig.PLAN_3M_PRICE}
PLAN_LIFETIME_PRICE=${envConfig.PLAN_LIFETIME_PRICE}
`;
  }, [envConfig]);

  const handleCopyText = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedPath(key);
    setTimeout(() => setCopiedPath(null), 1800);
  };

  const handleDownloadSingleFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').pop() || filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    if (botFiles.length === 0) return;
    setZipDownloading(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder('cleanreader_telegram_bot');
      if (folder) {
        for (const file of botFiles) {
          folder.file(file.path, file.content);
        }
        // Include customized .env from Config Generator
        folder.file('.env', generatedEnvContent);
        folder.file('utils/__init__.py', '"""Utility modules for CleanReader Bot."""\n');
        folder.file('plugins/__init__.py', '"""Pyrogram Plugins for CleanReader Bot."""\n');
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cleanreader_telegram_bot_v2.zip';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipDownloading(false);
    }
  };

  // Simulator Helper: Check Force-Subscribe in PM
  const checkFsubGate = (mode: 'pm' | 'group'): boolean => {
    if (mode === 'pm' && !isFsubJoined) {
      setMessages((prev) => [
        ...prev,
        {
          id: `fsub-block-${Date.now()}`,
          sender: 'bot',
          chatMode: 'pm',
          timestamp: nowTime(),
          title: '🔒 Channel Subscription Required',
          text: `To keep CleanReader & Media Summarizer Bot fast and ad-free, you must join our official channel (${envConfig.FSUB_CHANNEL_ID}) before reading articles, summarizing YouTube videos, or exporting clean PDFs.\n\n1. Tap [Join Official Channel] below.\n2. Tap [Try Again / Refresh] to unlock access.`,
          buttons: [
            [{ label: '📢 Join Official Channel', action: 'fsub_join_channel' }],
            [{ label: '🔄 Try Again / Refresh', action: 'fsub_refresh' }],
          ],
        },
      ]);
      return false;
    }
    return true;
  };

  // Process URL through real backend Gemini endpoint
  const executeUrlProcessing = async (targetUrl: string, mode: 'pm' | 'group') => {
    if (!checkFsubGate(mode)) return;

    const freeLimit = parseInt(envConfig.FREE_DAILY_LIMIT, 10) || 5;
    if (!mongoUser.is_premium && mongoUser.daily_usage_count >= freeLimit) {
      setMessages((prev) => [
        ...prev,
        {
          id: `quota-exceeded-${Date.now()}`,
          sender: 'bot',
          chatMode: mode,
          timestamp: nowTime(),
          title: '⚠️ Daily Free Limit Reached!',
          text: `You have used all ${freeLimit}/${freeLimit} free articles/summaries for today.\n\nUpgrade to CleanReader Premium for:\n• Unlimited Clean Web Articles & Telegraph Instant Views\n• Unlimited YouTube Transcript Summaries\n• Priority Gemini AI Processing & Instant PDF Exports`,
          buttons: [[{ label: '💎 Upgrade to Premium', action: 'nav_premium' }]],
        },
      ]);
      return;
    }

    setIsProcessingUrl(true);
    try {
      const resp = await fetch('/api/process-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to extract URL');
      }

      const article: ProcessedArticle = data;
      const newDailyCount = mongoUser.is_premium
        ? mongoUser.daily_usage_count
        : mongoUser.daily_usage_count + 1;
      const remaining = Math.max(0, freeLimit - newDailyCount);

      setMongoUser((prev) => ({
        ...prev,
        daily_usage_count: newDailyCount,
        total_reads: prev.total_reads + 1,
      }));

      setGlobalMetrics((prev) => ({
        ...prev,
        articles_scraped: article.isYoutube ? prev.articles_scraped : prev.articles_scraped + 1,
        youtube_summaries: article.isYoutube ? prev.youtube_summaries + 1 : prev.youtube_summaries,
      }));

      const bulletsStr = article.bulletPoints.map((b) => `• ${b}`).join('\n');
      const tsStr =
        article.isYoutube && article.timestampsBreakdown.length > 0
          ? `\n\nTimestamps Breakdown:\n${article.timestampsBreakdown.map((t) => `  ${t}`).join('\n')}`
          : '';
      const tierFooter = mongoUser.is_premium
        ? '💎 Premium Tier · Unlimited Access'
        : `🆓 Free Tier · ${remaining}/${freeLimit} daily reads remaining`;

      setMessages((prev) => [
        ...prev,
        {
          id: `article-${Date.now()}`,
          sender: 'bot',
          chatMode: mode,
          timestamp: nowTime(),
          title: `${article.isYoutube ? '🎬' : '📰'} ${article.title}`,
          text: `${article.authorOrChannel} · ~${article.estimatedReadMinutes} min read (${article.wordCount} words)\n\n✨ Gemini 3-Sentence TL;DR:\n"${article.tldrThreeSentences}"\n\n📌 Key Takeaways:\n${bulletsStr}${tsStr}\n\n${tierFooter}`,
          articleData: article,
          buttons: [
            [
              { label: '⚡ Telegraph Instant View', action: 'open_iv' },
              { label: '🌐 Original Link', action: 'open_source', url: article.url },
            ],
            [{ label: '📥 Export Clean PDF', action: 'export_pdf' }],
          ],
        },
      ]);

      // Automatically log to LOG_CHANNEL_ID
      setLogChannelEntries((prev) => [
        {
          id: `log-${Date.now()}`,
          type: 'ACTIVITY_LOG',
          timestamp: new Date().toISOString().slice(11, 19) + ' UTC',
          userId: mongoUser.user_id,
          userName: mongoUser.first_name,
          username: mongoUser.username,
          isPremium: mongoUser.is_premium,
          action: article.isYoutube ? 'YouTube Video Summary' : 'Article Scraped',
          title: article.title,
          originalUrl: article.url,
          telegraphUrl: article.telegraphUrl,
        },
        ...prev,
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'bot',
          chatMode: mode,
          timestamp: nowTime(),
          title: '❌ Extraction Error',
          text: err?.message || 'Could not process URL.',
        },
      ]);
    } finally {
      setIsProcessingUrl(false);
    }
  };

  // Handle Inline Button Clicks in Simulator
  const handleBotButtonAction = (action: string, msg: ChatMessage) => {
    const mode = msg.chatMode;

    if (action === 'fsub_join_channel') {
      setIsFsubJoined(true);
      return;
    }

    if (action === 'fsub_refresh') {
      if (!isFsubJoined) {
        setMessages((prev) => [
          ...prev,
          {
            id: `fsub-still-no-${Date.now()}`,
            sender: 'bot',
            chatMode: 'pm',
            timestamp: nowTime(),
            text: '❌ Verification failed: You still have not joined the channel. Toggle "Joined FSUB Channel" or tap [📢 Join Official Channel] above first.',
          },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `fsub-ok-${Date.now()}`,
          sender: 'bot',
          chatMode: 'pm',
          timestamp: nowTime(),
          hasStartBanner: true,
          title: `✅ Subscription Verified! Welcome, ${mongoUser.first_name}`,
          text: 'You now have full access to CleanReader & Media Summarizer Bot. Paste any article or YouTube link below!',
          buttons: [
            [
              { label: '📖 Help', action: 'nav_help' },
              { label: '💎 Premium Plans', action: 'nav_premium' },
            ],
            [{ label: '👤 My Account', action: 'nav_account' }],
          ],
        },
      ]);
      return;
    }

    if (!checkFsubGate(mode)) return;

    if (action === 'nav_help') {
      setMessages((prev) => [
        ...prev,
        {
          id: `help-${Date.now()}`,
          sender: 'bot',
          chatMode: mode,
          timestamp: nowTime(),
          title: '📖 How to Use CleanReader & Media Summarizer Bot',
          text: `1. Private Messages (PM): Paste any HTTP/HTTPS article URL or YouTube link directly.\n2. Telegram Groups: Send /read <URL> or /summary <URL>.\n3. Inline Mode: Type @${envConfig.BOT_USERNAME} <URL> in any chat.\n4. Clean PDF Export: Tap [📥 Export Clean PDF] below any processed article — the bot archives the PDF to LOG_CHANNEL_ID first and delivers it to you.`,
        },
      ]);
      return;
    }

    if (action === 'nav_account') {
      const freeLimit = parseInt(envConfig.FREE_DAILY_LIMIT, 10) || 5;
      const remaining = Math.max(0, freeLimit - mongoUser.daily_usage_count);
      setMessages((prev) => [
        ...prev,
        {
          id: `acc-${Date.now()}`,
          sender: 'bot',
          chatMode: mode,
          timestamp: nowTime(),
          title: '👤 My CleanReader Account',
          text: `User ID: ${mongoUser.user_id}\nName: ${mongoUser.first_name} (@${mongoUser.username})\nPlan: ${
            mongoUser.is_premium
              ? `💎 Premium Subscriber (Valid until ${mongoUser.premium_expiry?.slice(0, 10)})`
              : '🆓 Free Tier Member'
          }\nDaily Usage: ${
            mongoUser.is_premium
              ? `Unlimited (${mongoUser.daily_usage_count} used today)`
              : `${mongoUser.daily_usage_count} / ${freeLimit} (${remaining} remaining today)`
          }\nTotal Lifetime Reads: ${mongoUser.total_reads}`,
          buttons: mongoUser.is_premium
            ? undefined
            : [[{ label: '💎 Upgrade to Premium', action: 'nav_premium' }]],
        },
      ]);
      return;
    }

    if (action === 'nav_premium') {
      setMessages((prev) => [
        ...prev,
        {
          id: `prem-${Date.now()}`,
          sender: 'bot',
          chatMode: 'pm',
          timestamp: nowTime(),
          title: '💎 CleanReader & Media Summarizer — Premium Plans',
          text: `Unlock distraction-free reading and unlimited Gemini AI summaries:\n• Unlimited Daily Articles & Telegraph Instant Views\n• Unlimited YouTube Transcripts & AI Summaries\n• Unlimited Printable A4 PDF Exports\n\nSelect a Subscription Plan Below:`,
          buttons: [
            [
              { label: `⚡ 1 Month — ₹${envConfig.PLAN_1M_PRICE}`, action: 'buy_plan_1m' },
              { label: `🔥 3 Months — ₹${envConfig.PLAN_3M_PRICE}`, action: 'buy_plan_3m' },
            ],
            [
              {
                label: `👑 Lifetime Pass — ₹${envConfig.PLAN_LIFETIME_PRICE}`,
                action: 'buy_plan_lifetime',
              },
            ],
          ],
        },
      ]);
      return;
    }

    if (action.startsWith('buy_plan_')) {
      const planKey = action.replace('buy_plan_', '') as '1m' | '3m' | 'lifetime';
      const planMap = {
        '1m': { label: '1 Month Pro (30 Days)', amount: parseInt(envConfig.PLAN_1M_PRICE, 10) || 99 },
        '3m': { label: '3 Months Pro (90 Days)', amount: parseInt(envConfig.PLAN_3M_PRICE, 10) || 249 },
        lifetime: {
          label: 'Lifetime Pass',
          amount: parseInt(envConfig.PLAN_LIFETIME_PRICE, 10) || 699,
        },
      };
      const chosen = planMap[planKey];
      const upiUri = `upi://pay?pa=${encodeURIComponent(envConfig.UPI_ID)}&pn=${encodeURIComponent(
        envConfig.UPI_PAYEE_NAME
      )}&am=${chosen.amount}.00&cu=INR&tn=${encodeURIComponent(
        `CleanReader ${chosen.label} UID ${mongoUser.user_id}`
      )}`;

      setMongoUser((prev) => ({ ...prev, pending_payment_plan: planKey }));
      setMessages((prev) => [
        ...prev,
        {
          id: `qr-${Date.now()}`,
          sender: 'bot',
          chatMode: 'pm',
          timestamp: nowTime(),
          title: `🧾 Upgrade to ${chosen.label}`,
          qrUpiUri: upiUri,
          qrPlanLabel: chosen.label,
          qrAmount: chosen.amount,
          text: `Amount Payable: ₹${chosen.amount}.00\nUPI ID: ${envConfig.UPI_ID}\nPayee: ${envConfig.UPI_PAYEE_NAME}\n\n1. Scan the dynamic UPI QR Code above with any UPI App.\n2. Type a 12-digit UTR number in the message box below (or click [Submit Sample UTR Proof]) to forward proof to Admin Log Channel for approval.`,
          buttons: [
            [{ label: '🧾 Submit Sample UTR (431289019283)', action: 'submit_sample_utr' }],
          ],
        },
      ]);
      return;
    }

    if (action === 'submit_sample_utr') {
      submitUtrPaymentProof('UTR 431289019283 (GPay Verified)');
      return;
    }

    if (action === 'switch_group') {
      setChatEnvironment('group');
      return;
    }

    if (action === 'nav_support') {
      setMessages((prev) => [
        ...prev,
        {
          id: `sup-${Date.now()}`,
          sender: 'bot',
          chatMode: mode,
          timestamp: nowTime(),
          text: `💬 CleanReader Support Desk: Reach out at https://t.me/CleanReaderSupport or send your query with /help.`,
        },
      ]);
      return;
    }

    if (action === 'open_iv' && msg.articleData) {
      setInstantViewModalArticle(msg.articleData);
      return;
    }

    if (action === 'open_source' && msg.articleData) {
      window.open(msg.articleData.url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (action === 'export_pdf' && msg.articleData) {
      const { blob, filename } = buildCleanPdfBlob(msg.articleData);
      // 1. First upload document to LOG_CHANNEL_ID (as required by spec #3)
      setLogChannelEntries((prev) => [
        {
          id: `log-pdf-${Date.now()}`,
          type: 'PDF_EXPORT',
          timestamp: new Date().toISOString().slice(11, 19) + ' UTC',
          userId: mongoUser.user_id,
          userName: mongoUser.first_name,
          username: mongoUser.username,
          isPremium: mongoUser.is_premium,
          action: 'PDF Uploaded to Log Channel & Delivered',
          title: msg.articleData!.title,
          originalUrl: msg.articleData!.url,
          telegraphUrl: msg.articleData!.telegraphUrl,
          pdfFilename: filename,
        },
        ...prev,
      ]);

      setGlobalMetrics((prev) => ({ ...prev, pdfs_exported: prev.pdfs_exported + 1 }));

      // 2. Deliver to user in chat and trigger actual PDF download
      setMessages((prev) => [
        ...prev,
        {
          id: `pdf-delivered-${Date.now()}`,
          sender: 'bot',
          chatMode: mode,
          timestamp: nowTime(),
          title: `📕 ${filename}`,
          pdfFilename: filename,
          articleData: msg.articleData,
          text: `Uploaded to LOG_CHANNEL_ID (${envConfig.LOG_CHANNEL_ID}) first and delivered via cached file_id.\nSource: ${msg.articleData!.title}`,
        },
      ]);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const submitUtrPaymentProof = (utrValue: string) => {
    const planKey = mongoUser.pending_payment_plan || '1m';
    const planInfo = {
      '1m': { label: '1 Month Pro', amount: parseInt(envConfig.PLAN_1M_PRICE, 10) || 99, days: 30 },
      '3m': { label: '3 Months Pro', amount: parseInt(envConfig.PLAN_3M_PRICE, 10) || 249, days: 90 },
      lifetime: {
        label: 'Lifetime Pass',
        amount: parseInt(envConfig.PLAN_LIFETIME_PRICE, 10) || 699,
        days: 36500,
      },
    }[planKey];

    const paymentId = Math.random().toString(16).slice(2, 10);
    setMongoUser((prev) => ({ ...prev, pending_payment_plan: null }));

    setMessages((prev) => [
      ...prev,
      {
        id: `user-utr-${Date.now()}`,
        sender: 'user',
        chatMode: 'pm',
        timestamp: nowTime(),
        text: utrValue,
      },
      {
        id: `bot-utr-ack-${Date.now()}`,
        sender: 'bot',
        chatMode: 'pm',
        timestamp: nowTime(),
        title: '✅ Payment Proof Submitted!',
        text: `Reference ID: #${paymentId}\nPlan: ${planInfo.label} (₹${planInfo.amount})\n\nYour UTR/screenshot has been forwarded to LOG_CHANNEL_ID (${envConfig.LOG_CHANNEL_ID}) with [Approve ✅] and [Reject ❌] buttons. Click Approve in the Admin Log Channel panel on the right to test automatic MongoDB upgrade!`,
      },
    ]);

    setLogChannelEntries((prev) => [
      {
        id: `log-pay-${Date.now()}`,
        type: 'PAYMENT_VERIFICATION',
        timestamp: new Date().toISOString().slice(11, 19) + ' UTC',
        userId: mongoUser.user_id,
        userName: mongoUser.first_name,
        username: mongoUser.username,
        isPremium: mongoUser.is_premium,
        action: 'Manual UPI Payment Proof Submitted',
        title: `${planInfo.label} — ₹${planInfo.amount}`,
        paymentId,
        planLabel: planInfo.label,
        amount: planInfo.amount,
        days: planInfo.days,
        utrOrProof: utrValue,
        paymentStatus: 'pending',
      },
      ...prev,
    ]);
  };

  // Handle Admin Approve / Reject in LOG_CHANNEL_ID panel
  const handleAdminPaymentDecision = (entryId: string, decision: 'approved' | 'rejected') => {
    const target = logChannelEntries.find((e) => e.id === entryId);
    if (!target) return;

    setLogChannelEntries((prev) =>
      prev.map((item) => (item.id === entryId ? { ...item, paymentStatus: decision } : item))
    );

    if (decision === 'approved') {
      const days = target.days || 30;
      const expiryDate = new Date(Date.now() + days * 86400 * 1000).toISOString();
      setMongoUser((prev) => ({
        ...prev,
        is_premium: true,
        premium_expiry: expiryDate,
      }));
      setGlobalMetrics((prev) => ({ ...prev, premium_users: prev.premium_users + 1 }));

      setMessages((prev) => [
        ...prev,
        {
          id: `pay-approved-msg-${Date.now()}`,
          sender: 'bot',
          chatMode: 'pm',
          timestamp: nowTime(),
          title: '🎉 Payment Approved — Welcome to CleanReader Premium!',
          text: `Payment Ref: #${target.paymentId}\nPlan Activated: ${target.planLabel} (${days} Days)\nValid Until: ${expiryDate.slice(
            0,
            10
          )}\n\nYour status in MongoDB has been updated to is_premium = true. You now have unlimited articles, YouTube summaries, and PDF exports!`,
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: `pay-rejected-msg-${Date.now()}`,
          sender: 'bot',
          chatMode: 'pm',
          timestamp: nowTime(),
          title: '⚠️ Payment Verification Unsuccessful',
          text: `Your payment submission (Ref #${target.paymentId}) was rejected by an administrator. Please verify your 12-digit UTR number or contact Support.`,
        },
      ]);
    }
  };

  // Handle Chat Input Submission
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = chatInput.trim();
    if (!raw) return;
    setChatInput('');

    const currentMode = chatEnvironment === 'group' ? 'group' : 'pm';
    setMessages((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        sender: 'user',
        chatMode: currentMode,
        timestamp: nowTime(),
        text: raw,
      },
    ]);

    if (raw === '/start') {
      if (!checkFsubGate(currentMode)) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `start-${Date.now()}`,
          sender: 'bot',
          chatMode: currentMode,
          timestamp: nowTime(),
          hasStartBanner: true,
          title: `Welcome to CleanReader & Media Summarizer, ${mongoUser.first_name}!`,
          text: 'Send any article URL or YouTube link to strip ads/trackers, publish a Telegraph Instant View page, and generate a 3-sentence Gemini AI summary.',
          buttons: [
            [
              { label: '📖 Help', action: 'nav_help' },
              { label: '💎 Premium Plans', action: 'nav_premium' },
            ],
            [
              { label: '👤 My Account', action: 'nav_account' },
              { label: '➕ Add to Group', action: 'switch_group' },
            ],
            [{ label: '💬 Support', action: 'nav_support' }],
          ],
        },
      ]);
      return;
    }

    if (raw === '/help') {
      handleBotButtonAction('nav_help', {
        id: 'tmp',
        sender: 'user',
        chatMode: currentMode,
        timestamp: nowTime(),
        text: '',
      });
      return;
    }

    if (raw === '/myaccount') {
      handleBotButtonAction('nav_account', {
        id: 'tmp',
        sender: 'user',
        chatMode: currentMode,
        timestamp: nowTime(),
        text: '',
      });
      return;
    }

    if (raw === '/stats') {
      setMessages((prev) => [
        ...prev,
        {
          id: `stats-${Date.now()}`,
          sender: 'bot',
          chatMode: currentMode,
          timestamp: nowTime(),
          title: '📊 CleanReader Bot — Real-Time System Statistics',
          text: `Total Registered Users: ${globalMetrics.total_users.toLocaleString()}\nPremium Subscribers: ${globalMetrics.premium_users.toLocaleString()}\nFree Tier Users: ${(
            globalMetrics.total_users - globalMetrics.premium_users
          ).toLocaleString()}\nTotal Articles Scraped: ${globalMetrics.articles_scraped.toLocaleString()}\nYouTube AI Summaries: ${globalMetrics.youtube_summaries.toLocaleString()}\nClean PDFs Exported: ${globalMetrics.pdfs_exported.toLocaleString()}`,
        },
      ]);
      return;
    }

    // Group or PM /read <URL> or /summary <URL>
    if (raw.startsWith('/read') || raw.startsWith('/summary')) {
      const urlMatch = raw.match(/https?:\/\/[^\s]+/i);
      if (!urlMatch) {
        setMessages((prev) => [
          ...prev,
          {
            id: `usage-${Date.now()}`,
            sender: 'bot',
            chatMode: currentMode,
            timestamp: nowTime(),
            text: 'ℹ️ Usage: /read https://example.com/article or /summary https://youtube.com/watch?v=...',
          },
        ]);
        return;
      }
      await executeUrlProcessing(urlMatch[0], currentMode);
      return;
    }

    // Direct URL in PM
    const directUrlMatch = raw.match(/https?:\/\/[^\s]+/i);
    if (directUrlMatch) {
      if (currentMode === 'group') {
        setMessages((prev) => [
          ...prev,
          {
            id: `grp-hint-${Date.now()}`,
            sender: 'bot',
            chatMode: 'group',
            timestamp: nowTime(),
            text: `💡 In Telegram Groups, trigger the bot explicitly using /read ${directUrlMatch[0]} or /summary ${directUrlMatch[0]}`,
          },
        ]);
        return;
      }
      await executeUrlProcessing(directUrlMatch[0], 'pm');
      return;
    }

    // Check if user is submitting UTR text for a pending payment plan
    if (mongoUser.pending_payment_plan) {
      submitUtrPaymentProof(raw);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `fallback-${Date.now()}`,
        sender: 'bot',
        chatMode: currentMode,
        timestamp: nowTime(),
        text: 'Send any valid HTTP/HTTPS URL or YouTube link, or use /start, /help, /myaccount, /stats.',
      },
    ]);
  };

  // Handle Inline Query (@CleanReaderBot <URL>)
  const handleRunInlineQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineUrlInput.trim()) return;
    setIsProcessingUrl(true);
    try {
      const resp = await fetch('/api/process-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inlineUrlInput.trim() }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setInlinePreviewResult(data);
        setLogChannelEntries((prev) => [
          {
            id: `log-inline-${Date.now()}`,
            type: 'ACTIVITY_LOG',
            timestamp: new Date().toISOString().slice(11, 19) + ' UTC',
            userId: mongoUser.user_id,
            userName: mongoUser.first_name,
            username: mongoUser.username,
            isPremium: mongoUser.is_premium,
            action: 'Inline Mode Summary (@bot <URL>)',
            title: data.title,
            originalUrl: data.url,
            telegraphUrl: data.telegraphUrl,
          },
          ...prev,
        ]);
      }
    } finally {
      setIsProcessingUrl(false);
    }
  };

  const visibleMessages = useMemo(
    () =>
      messages.filter((m) =>
        chatEnvironment === 'group' ? m.chatMode === 'group' : m.chatMode === 'pm'
      ),
    [messages, chatEnvironment]
  );

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-100 flex flex-col">
      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (4 Single-Line Nav Links) — Zone 3 (1 Primary Action) */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800 bg-[#0f172a]">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('explorer');
          }}
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          CleanReader Bot Architect
        </a>

        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('explorer')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'explorer'
                ? 'text-white border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Codebase Explorer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('simulator')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'simulator'
                ? 'text-white border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Bot & Log Simulator
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'config'
                ? 'text-white border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Config Generator
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('architecture')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'architecture'
                ? 'text-white border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Architecture Guide
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={zipDownloading || loadingFiles}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{zipDownloading ? 'Packaging ZIP...' : 'Download Bot ZIP'}</span>
          </button>
        </div>
      </header>

      {/* Sub-header context bar with unboxed typographic metadata */}
      <div className="px-6 py-3 border-b border-slate-800/80 bg-[#0b1120] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="text-slate-200 font-medium">
            CleanReader & Media Summarizer Bot (PM + Groups)
          </span>
          <span aria-hidden="true">·</span>
          <span>Pyrogram v2.x</span>
          <span aria-hidden="true">·</span>
          <span>Motor Async MongoDB</span>
          <span aria-hidden="true">·</span>
          <span>Google Gemini API</span>
          <span aria-hidden="true">·</span>
          <span>Force-Sub & LOG_CHANNEL_ID Archive</span>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-400 font-mono tabular-nums">
          <span>{botFiles.length} Modules</span>
          <span aria-hidden="true">·</span>
          <span>
            {botFiles.reduce((acc, item) => acc + item.lines, 0).toLocaleString()} Lines of Python
          </span>
        </div>
      </div>

      {/* Main Workspace Viewport */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
        {/* VIEW 1: CODEBASE EXPLORER */}
        {activeTab === 'explorer' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* File Tree Sidebar */}
            <aside className="lg:col-span-4 bg-[#0f172a] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-100">Project File Structure</h2>
                <span className="text-xs text-slate-400 font-mono tabular-nums">
                  /bot/*
                </span>
              </div>

              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Filter files or symbols..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0b1120] border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>

              {loadingFiles ? (
                <div className="space-y-2 py-4">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div key={n} className="h-9 bg-slate-800/50 rounded-lg" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4 max-h-[640px] overflow-y-auto pr-1">
                  {[
                    'Core Architecture',
                    'Middleware & Utilities',
                    'Pyrogram Plugins',
                    'Deployment & Config',
                  ].map((category) => {
                    const group = filteredFiles.filter((f) => f.category === category);
                    if (group.length === 0) return null;
                    return (
                      <div key={category}>
                        <div className="text-[11px] font-medium text-slate-400 mb-1.5 px-2">
                          {category}
                        </div>
                        <div className="space-y-1">
                          {group.map((file) => {
                            const isSelected = activeFile?.path === file.path;
                            return (
                              <button
                                key={file.path}
                                type="button"
                                onClick={() => setSelectedFilePath(file.path)}
                                className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                                  isSelected
                                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                    : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileCode className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                  <span className="text-xs font-mono truncate">{file.path}</span>
                                </div>
                                <span className="text-[11px] text-slate-400 font-mono tabular-nums shrink-0">
                                  {file.lines}L
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('simulator')}
                  className="w-full py-2 px-3 text-xs font-medium text-slate-200 bg-slate-800/90 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Test Bot in Live Simulator →
                </button>
              </div>
            </aside>

            {/* Code Viewer */}
            <section className="lg:col-span-8 bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
              {activeFile ? (
                <>
                  <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-[#0b1120]/60">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-semibold text-white">
                          bot/{activeFile.path}
                        </span>
                        <span className="text-xs text-slate-500" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-xs text-slate-400 font-mono tabular-nums">
                          {activeFile.lines} lines
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{activeFile.description}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyText(activeFile.content, activeFile.path)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {copiedPath === activeFile.path ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy File</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadSingleFile(activeFile.path, activeFile.content)
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download File</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-4 overflow-x-auto max-h-[680px] overflow-y-auto bg-[#090e1a]">
                    <pre className="text-xs font-mono leading-relaxed text-slate-200">
                      {activeFile.content.split('\n').map((line, i) => (
                        <div
                          key={i}
                          className="table-row hover:bg-slate-800/30 transition-colors"
                        >
                          <span className="table-cell pr-4 text-right text-slate-600 select-none tabular-nums w-10">
                            {i + 1}
                          </span>
                          <span className="table-cell whitespace-pre">{line || ' '}</span>
                        </div>
                      ))}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="p-12 text-center text-sm text-slate-400">
                  Select any Python module on the left to inspect its implementation.
                </div>
              )}
            </section>
          </div>
        )}

        {/* VIEW 2: LIVE TELEGRAM BOT & ADMIN LOG CHANNEL SIMULATOR */}
        {activeTab === 'simulator' && (
          <div className="space-y-6">
            {/* Simulator Controls Bar */}
            <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
              {/* Environment Switcher (PM / Group / Inline) */}
              <div className="flex items-center gap-1 p-1 bg-[#0b1120] border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setChatEnvironment('pm')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    chatEnvironment === 'pm'
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Private Chat (PM)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChatEnvironment('group')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    chatEnvironment === 'group'
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Group Chat (/read & /summary)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChatEnvironment('inline')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    chatEnvironment === 'inline'
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <AtSign className="w-3.5 h-3.5" />
                  <span>Inline Mode (@{envConfig.BOT_USERNAME})</span>
                </button>
              </div>

              {/* Force-Subscribe & Quota State Toggles */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsFsubJoined((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isFsubJoined
                      ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
                      : 'bg-amber-950/50 border-amber-700/60 text-amber-300'
                  }`}
                >
                  {isFsubJoined ? (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5" />
                  )}
                  <span>
                    FSUB Channel: {isFsubJoined ? 'Joined (Allowed)' : 'Not Joined (Blocked)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setMongoUser((prev) => ({
                      ...prev,
                      is_premium: false,
                      daily_usage_count: parseInt(envConfig.FREE_DAILY_LIMIT, 10) || 5,
                    }))
                  }
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Simulate 5/5 Free Limit Reached
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setMongoUser((prev) => ({
                      ...prev,
                      daily_usage_count: 0,
                    }))
                  }
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Reset Daily Quota
                </button>
              </div>
            </div>

            {/* Dual-Pane Interactive Workbench */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* LEFT PANE: Telegram Client Simulator */}
              <div className="lg:col-span-7 bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                {/* Telegram Chat Header */}
                <div className="px-4 py-3 border-b border-slate-800 bg-[#0b1120] flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {chatEnvironment === 'pm'
                          ? `@${envConfig.BOT_USERNAME} (Private Chat)`
                          : chatEnvironment === 'group'
                          ? 'Tech Readers & Researchers Group (1,482 members)'
                          : `Inline Query Tester (@${envConfig.BOT_USERNAME} <URL>)`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      <span>User: {mongoUser.first_name}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono tabular-nums">ID {mongoUser.user_id}</span>
                      <span aria-hidden="true"> · </span>
                      <span>
                        {mongoUser.is_premium
                          ? '💎 Premium Tier'
                          : `🆓 Free Tier (${mongoUser.daily_usage_count}/${envConfig.FREE_DAILY_LIMIT} today)`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setChatInput('/start');
                      }}
                      className="px-2.5 py-1 text-xs font-mono text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 rounded border border-sky-500/30 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      /start
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setChatInput('/myaccount');
                      }}
                      className="px-2.5 py-1 text-xs font-mono text-slate-300 bg-slate-800 hover:bg-slate-700 rounded whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      /myaccount
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setChatInput('/stats');
                      }}
                      className="px-2.5 py-1 text-xs font-mono text-slate-300 bg-slate-800 hover:bg-slate-700 rounded whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      /stats
                    </button>
                  </div>
                </div>

                {/* Preset Sample URLs Bar */}
                <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/50 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400 mr-1">Test Real Gemini Extraction:</span>
                  {SAMPLE_PRESETS.map((sample) => (
                    <button
                      key={sample.url}
                      type="button"
                      disabled={isProcessingUrl}
                      onClick={() => {
                        if (chatEnvironment === 'inline') {
                          setInlineUrlInput(sample.url);
                        } else if (chatEnvironment === 'group') {
                          executeUrlProcessing(sample.url, 'group');
                        } else {
                          executeUrlProcessing(sample.url, 'pm');
                        }
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      {sample.kind === 'youtube' ? (
                        <Youtube className="w-3.5 h-3.5 text-rose-400" />
                      ) : (
                        <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                      )}
                      <span>{sample.label}</span>
                    </button>
                  ))}
                </div>

                {/* Inline Mode Sub-View */}
                {chatEnvironment === 'inline' ? (
                  <div className="p-5 space-y-4 min-h-[480px]">
                    <div className="text-xs text-slate-400">
                      Type any URL after <code className="text-sky-300">@{envConfig.BOT_USERNAME}</code> to test{' '}
                      <code className="text-slate-200">plugins/inline.py</code> (<code className="text-slate-200">@Client.on_inline_query()</code>):
                    </div>

                    <form onSubmit={handleRunInlineQuery} className="flex items-center gap-2">
                      <div className="flex-1 flex items-center bg-[#0b1120] border border-slate-800 rounded-lg px-3 py-2">
                        <span className="text-xs font-mono text-sky-400 mr-2 shrink-0">
                          @{envConfig.BOT_USERNAME}
                        </span>
                        <input
                          type="url"
                          value={inlineUrlInput}
                          onChange={(e) => setInlineUrlInput(e.target.value)}
                          placeholder="https://example.com/article"
                          className="w-full text-xs bg-transparent text-slate-100 focus:outline-none font-mono"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isProcessingUrl}
                        className="px-4 py-2 text-xs font-semibold bg-sky-400 text-slate-950 rounded-lg hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {isProcessingUrl ? 'Parsing...' : 'Query Inline'}
                      </button>
                    </form>

                    {inlinePreviewResult ? (
                      <div className="border border-slate-800 rounded-xl p-4 bg-[#0b1120] space-y-3">
                        <div className="text-xs text-slate-400">
                          Inline Query Popup Result (<code className="font-mono">InlineQueryResultArticle</code>):
                        </div>
                        <div className="p-3.5 rounded-lg bg-[#0f172a] border border-slate-800 space-y-2">
                          <div className="text-sm font-semibold text-white">
                            ⚡ {inlinePreviewResult.title}
                          </div>
                          <div className="text-xs text-slate-400">
                            <span>~{inlinePreviewResult.estimatedReadMinutes} min read</span>
                            <span aria-hidden="true"> · </span>
                            <span>{inlinePreviewResult.authorOrChannel}</span>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            {inlinePreviewResult.tldrThreeSentences}
                          </p>
                          <div className="pt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setInstantViewModalArticle(inlinePreviewResult)}
                              className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-md cursor-pointer whitespace-nowrap"
                            >
                              ⚡ Read Clean Instant View
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setChatEnvironment('pm');
                                executeUrlProcessing(inlinePreviewResult.url, 'pm');
                              }}
                              className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                            >
                              📥 Send Card to Chat
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
                        Click "Query Inline" above to generate an on-the-fly Instant View + Gemini TL;DR preview card.
                      </div>
                    )}
                  </div>
                ) : (
                  /* Standard PM & Group Message Stream */
                  <>
                    <div className="p-4 space-y-4 h-[480px] overflow-y-auto bg-[#090e1a]">
                      {visibleMessages.length === 0 && (
                        <div className="p-8 text-center text-xs text-slate-400">
                          Group Chat active. Trigger the bot with{' '}
                          <code className="text-sky-300 font-mono">/read &lt;URL&gt;</code> or{' '}
                          <code className="text-sky-300 font-mono">/summary &lt;URL&gt;</code>, or click one of the preset links above.
                        </div>
                      )}

                      {visibleMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${
                            msg.sender === 'user' ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div
                            className={`max-w-[90%] rounded-xl p-3.5 text-xs leading-relaxed ${
                              msg.sender === 'user'
                                ? 'bg-sky-500 text-slate-950 font-medium'
                                : 'bg-[#0f172a] border border-slate-800 text-slate-200'
                            }`}
                          >
                            {/* Custom /start SVG Graphic Banner (Zero-Broken-Image Policy) */}
                            {msg.hasStartBanner && (
                              <div className="mb-3 rounded-lg overflow-hidden border border-slate-800 bg-gradient-to-br from-slate-900 via-[#0f172a] to-sky-950 p-4">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="text-[11px] font-mono text-sky-400">
                                      START_IMG_URL · TELEGRAM BOT BANNER
                                    </div>
                                    <div className="text-sm font-bold text-white mt-0.5">
                                      CleanReader & Media Summarizer
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-0.5">
                                      Telegraph Instant View · YouTube Transcripts · Gemini AI · Clean PDF
                                    </div>
                                  </div>
                                  <Sparkles className="w-8 h-8 text-sky-400 shrink-0" />
                                </div>
                              </div>
                            )}

                            {/* Dynamic UPI QR Code Card */}
                            {msg.qrUpiUri && (
                              <div className="mb-3 p-3 bg-white rounded-lg text-slate-900 flex items-center gap-4">
                                <svg
                                  viewBox="0 0 21 21"
                                  className="w-24 h-24 shrink-0 border border-slate-200 p-1 rounded"
                                  aria-label="Dynamic UPI Payment QR Code"
                                >
                                  {generateQrMatrix(msg.qrUpiUri).map((row, rIdx) =>
                                    row.map((cell, cIdx) =>
                                      cell ? (
                                        <rect
                                          key={`${rIdx}-${cIdx}`}
                                          x={cIdx}
                                          y={rIdx}
                                          width={1}
                                          height={1}
                                          fill="#0f172a"
                                        />
                                      ) : null
                                    )
                                  )}
                                </svg>
                                <div className="text-[11px] space-y-1">
                                  <div className="font-bold text-slate-900">
                                    {msg.qrPlanLabel}
                                  </div>
                                  <div className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                                    Pay ₹{msg.qrAmount}.00 via UPI
                                  </div>
                                  <div className="font-mono text-[10px] text-slate-500 break-all">
                                    {envConfig.UPI_ID}
                                  </div>
                                </div>
                              </div>
                            )}

                            {msg.title && (
                              <div
                                className={`font-semibold mb-1.5 ${
                                  msg.sender === 'user' ? 'text-slate-950' : 'text-white text-sm'
                                }`}
                              >
                                {msg.title}
                              </div>
                            )}

                            <div className="whitespace-pre-wrap">{msg.text}</div>

                            <div
                              className={`text-[10px] mt-1.5 font-mono tabular-nums ${
                                msg.sender === 'user' ? 'text-slate-900/75 text-right' : 'text-slate-500'
                              }`}
                            >
                              {msg.timestamp}
                            </div>

                            {/* Telegram Inline Keyboard Matrix */}
                            {msg.buttons && msg.buttons.length > 0 && (
                              <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-1.5">
                                {msg.buttons.map((row, rIdx) => (
                                  <div key={rIdx} className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {row.map((btn, bIdx) => (
                                      <button
                                        key={bIdx}
                                        type="button"
                                        onClick={() => handleBotButtonAction(btn.action, msg)}
                                        className="w-full py-1.5 px-2.5 text-xs font-medium text-center text-sky-300 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/70 rounded-md transition-colors whitespace-nowrap truncate cursor-pointer"
                                      >
                                        {btn.label}
                                      </button>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                      {isProcessingUrl && (
                        <div className="p-3.5 rounded-xl bg-[#0f172a] border border-slate-800 text-xs text-slate-300 flex items-center gap-2.5 w-fit">
                          <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                          <span>
                            Scraping clean content, publishing Telegraph IV & summarizing with Gemini AI...
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Message Input Bar */}
                    <form
                      onSubmit={handleSendMessage}
                      className="p-3 border-t border-slate-800 bg-[#0f172a] flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder={
                          chatEnvironment === 'group'
                            ? 'Type /read <URL> or /summary <URL> in group...'
                            : mongoUser.pending_payment_plan
                            ? 'Enter 12-digit UTR number to submit payment proof...'
                            : 'Paste any Article or YouTube URL, or type /start, /help, /stats...'
                        }
                        className="flex-1 bg-[#0b1120] border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                      />
                      <button
                        type="submit"
                        disabled={isProcessingUrl}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-sky-400 text-slate-950 rounded-lg hover:bg-sky-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Send</span>
                      </button>
                    </form>
                  </>
                )}
              </div>

              {/* RIGHT PANE: Admin LOG_CHANNEL_ID Feed & MongoDB State Inspector */}
              <div className="lg:col-span-5 space-y-6">
                {/* LOG_CHANNEL_ID Live Stream */}
                <div className="bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-800 bg-[#0b1120] flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Telegram Log Channel (LOG_CHANNEL_ID)
                      </h3>
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        Channel ID: {envConfig.LOG_CHANNEL_ID} · Auto-archives reads, PDFs & UPI proofs
                      </p>
                    </div>
                  </div>

                  <div className="p-4 space-y-3 max-h-[340px] overflow-y-auto bg-[#090e1a]">
                    {logChannelEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-3 rounded-lg bg-[#0f172a] border border-slate-800 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                          <span className="font-semibold text-sky-300">#{entry.type}</span>
                          <span>{entry.timestamp}</span>
                        </div>

                        <div className="text-slate-300">
                          <span>User: </span>
                          <span className="text-white font-medium">{entry.userName}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono tabular-nums">@{entry.username}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono tabular-nums">ID {entry.userId}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{entry.isPremium ? '💎 Premium' : '🆓 Free'}</span>
                        </div>

                        <div className="text-slate-200">
                          <span className="text-slate-400">Action: </span>
                          <span className="font-medium">{entry.action}</span>
                        </div>

                        <div className="text-slate-300 truncate">
                          <span className="text-slate-400">Content: </span>
                          <span>{entry.title}</span>
                        </div>

                        {entry.pdfFilename && (
                          <div className="text-emerald-300 font-mono text-[11px]">
                            📄 Uploaded Document First: {entry.pdfFilename}
                          </div>
                        )}

                        {entry.type === 'PAYMENT_VERIFICATION' && (
                          <div className="pt-2 mt-2 border-t border-slate-800 space-y-2">
                            <div className="font-mono text-[11px] text-amber-300">
                              UTR / Proof: {entry.utrOrProof} · Ref #{entry.paymentId}
                            </div>
                            {entry.paymentStatus === 'pending' ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleAdminPaymentDecision(entry.id, 'approved')
                                  }
                                  className="flex-1 py-1.5 px-3 text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                                >
                                  Approve ✅
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleAdminPaymentDecision(entry.id, 'rejected')
                                  }
                                  className="flex-1 py-1.5 px-3 text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                                >
                                  Reject ❌
                                </button>
                              </div>
                            ) : (
                              <div className="text-[11px] font-mono uppercase">
                                Status:{' '}
                                <span
                                  className={
                                    entry.paymentStatus === 'approved'
                                      ? 'text-emerald-400'
                                      : 'text-rose-400'
                                  }
                                >
                                  {entry.paymentStatus}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live MongoDB User Document & Admin Controls */}
                <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-sky-400" />
                      <h3 className="text-sm font-semibold text-white">
                        Motor MongoDB State (db.users)
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const expiry = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
                          setMongoUser((prev) => ({
                            ...prev,
                            is_premium: true,
                            premium_expiry: expiry,
                          }));
                        }}
                        className="px-2.5 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded cursor-pointer whitespace-nowrap"
                      >
                        /addpremium 30d
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMongoUser((prev) => ({
                            ...prev,
                            is_premium: false,
                            premium_expiry: null,
                          }));
                        }}
                        className="px-2.5 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-rose-300 rounded cursor-pointer whitespace-nowrap"
                      >
                        /removepremium
                      </button>
                    </div>
                  </div>

                  <pre className="p-3 rounded-lg bg-[#090e1a] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto tabular-nums">
                    {JSON.stringify(mongoUser, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: ENVIRONMENT & CONFIG GENERATOR */}
        {activeTab === 'config' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Environment & Configuration Builder (config.py / .env)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Customize your Telegram Bot credentials, Force-Subscribe channel, Log Channel ID, and UPI details. These values are automatically bundled into your downloadable ZIP archive.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(
                  [
                    ['API_ID', 'Telegram API_ID (my.telegram.org)'],
                    ['API_HASH', 'Telegram API_HASH'],
                    ['BOT_TOKEN', 'BotFather BOT_TOKEN'],
                    ['BOT_USERNAME', 'Bot Username (without @)'],
                    ['MONGO_URI', 'MongoDB Connection URI (Motor)'],
                    ['DATABASE_NAME', 'MongoDB Database Name'],
                    ['ADMIN_IDS', 'Admin User IDs (comma-separated)'],
                    ['FSUB_CHANNEL_ID', 'Force-Sub Channel ID (-100...)'],
                    ['FSUB_INVITE_LINK', 'Force-Sub Invite Link'],
                    ['LOG_CHANNEL_ID', 'Private Activity Log Channel ID'],
                    ['UPI_ID', 'Merchant UPI ID for Premium QR'],
                    ['FREE_DAILY_LIMIT', 'Free Daily Reads/Summaries Limit'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <label className="block text-xs font-medium text-slate-300">
                      {label}
                    </label>
                    <input
                      type="text"
                      value={envConfig[key]}
                      onChange={(e) =>
                        setEnvConfig((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-xs font-mono bg-[#0b1120] border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-400"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 bg-[#0b1120] flex items-center justify-between">
                <span className="text-xs font-mono font-semibold text-white">
                  Generated .env File
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyText(generatedEnvContent, '.env')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    {copiedPath === '.env' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy .env</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadSingleFile('.env', generatedEnvContent)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-400 hover:bg-sky-300 text-slate-950 font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save .env</span>
                  </button>
                </div>
              </div>
              <pre className="p-4 text-xs font-mono text-slate-200 bg-[#090e1a] overflow-x-auto leading-relaxed">
                {generatedEnvContent}
              </pre>
            </div>
          </div>
        )}

        {/* VIEW 4: ARCHITECTURE & DEPLOYMENT GUIDE */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-2">
                <div className="text-xs font-mono text-sky-400">01. Force-Sub Middleware</div>
                <h3 className="text-sm font-semibold text-white">
                  Pre-Execution Channel Verification
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The <code className="text-slate-200">@force_subscribe</code> decorator in{' '}
                  <code className="text-slate-200">utils/fsub.py</code> intercepts PM commands, URL links, and PDF callbacks via{' '}
                  <code className="text-slate-200">client.get_chat_member(Config.FSUB_CHANNEL_ID, user_id)</code>. Unsubscribed users receive the{' '}
                  <code className="text-slate-200">[Join Channel]</code> and{' '}
                  <code className="text-slate-200">[Try Again / Refresh]</code> prompt.
                </p>
              </div>

              <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-2">
                <div className="text-xs font-mono text-sky-400">02. Log-First PDF Pipeline</div>
                <h3 className="text-sm font-semibold text-white">
                  LOG_CHANNEL_ID Archive & File_ID Reuse
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  In <code className="text-slate-200">utils/logger.py</code>,{' '}
                  <code className="text-slate-200">upload_pdf_to_log_and_deliver()</code> uploads every generated WeasyPrint/ReportLab PDF directly into{' '}
                  <code className="text-slate-200">LOG_CHANNEL_ID</code> first with full user metadata, then delivers{' '}
                  <code className="text-slate-200">logged_msg.document.file_id</code> to the user for zero-latency delivery.
                </p>
              </div>

              <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-2">
                <div className="text-xs font-mono text-sky-400">03. UPI QR & Admin Approval</div>
                <h3 className="text-sm font-semibold text-white">
                  Automated MongoDB Entitlements
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <code className="text-slate-200">plugins/premium.py</code> generates a dynamic{' '}
                  <code className="text-slate-200">upi://pay</code> QR code in memory, captures UTR/screenshot proofs in PM, and forwards them to admins with{' '}
                  <code className="text-slate-200">[Approve ✅]</code> &{' '}
                  <code className="text-slate-200">[Reject ❌]</code> callbacks that atomically update Motor MongoDB.
                </p>
              </div>
            </div>

            <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white">
                Production Deployment Commands (VPS / Docker)
              </h3>
              <pre className="p-4 rounded-lg bg-[#090e1a] border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
{`# 1. Unzip the downloaded repository and configure .env
unzip cleanreader_telegram_bot_v2.zip && cd cleanreader_telegram_bot
cp .env.example .env   # (Or use the pre-configured .env included in the ZIP)

# 2. Option A: Run with Docker (Includes Cairo/Pango libraries for WeasyPrint PDF export)
docker build -t cleanreader-bot .
docker run -d --name cleanreader-bot --restart unless-stopped --env-file .env cleanreader-bot

# 3. Option B: Run directly with Python 3.11+ virtualenv
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py`}
              </pre>
            </div>
          </div>
        )}
      </main>

      {/* Telegraph Instant View Reader Modal */}
      {instantViewModalArticle && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-[#0b1120]">
              <div>
                <div className="text-xs font-mono text-sky-400">
                  ⚡ TELEGRAPH INSTANT VIEW PREVIEW
                </div>
                <div className="text-xs text-slate-400 font-mono truncate max-w-md">
                  {instantViewModalArticle.telegraphUrl}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInstantViewModalArticle(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-slate-200">
              <h2 className="text-xl font-bold text-white leading-snug">
                {instantViewModalArticle.title}
              </h2>
              <div className="text-xs text-slate-400">
                <span>{instantViewModalArticle.authorOrChannel}</span>
                <span aria-hidden="true"> · </span>
                <span>{instantViewModalArticle.estimatedReadMinutes} min read</span>
                <span aria-hidden="true"> · </span>
                <span>{instantViewModalArticle.wordCount} words</span>
              </div>

              <div className="p-4 rounded-lg bg-[#0b1120] border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-sky-300">
                  ✨ Gemini 3-Sentence TL;DR
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {instantViewModalArticle.tldrThreeSentences}
                </p>
              </div>

              <div className="space-y-3 text-sm text-slate-200 leading-relaxed">
                {instantViewModalArticle.cleanParagraphs.map((para, idx) => (
                  <p key={idx}>{para}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

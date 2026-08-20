const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// 📊 نظام الكاش
// ==========================================================
class MemoryCache {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 2592000, checkperiod: 86400 });
  }

  match(requestKey) {
    return this.cache.get(requestKey) || null;
  }

  put(requestKey, responseData) {
    this.cache.set(requestKey, responseData);
  }
}

// ==========================================================
// 🛡️ تنويع User-Agents للحماية من الحظر
// ==========================================================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ==========================================================
// 🔑 مصفوفة مفاتيح ScraperAPI (مفتاحين فقط)
// ==========================================================
const SCRAPINGAPI_KEYS = [
  process.env.SCRAPINGAPI_API_KEY || "26617cf864e88b0c2f85ccc8a55155dc",
  process.env.SCRAPINGAPI_API_KEY_BACKUP_1 || "16a5887f2b830c0a6c6a20f00228c0a8"
].filter(Boolean);

// ذاكرة لتتبع وتجاهل المفاتيح التي انتهى رصيدها فعلياً
const DISABLED_KEYS = new Set();

// ==========================================================
// 📊 Rate Limiting (منع التكرار خلال 3 ثوانٍ)
// ==========================================================
const rateLimiter = rateLimit({
  windowMs: 3 * 1000,
  max: 1,
  message: JSON.stringify({
    success: false,
    results: [],
    total: 0,
    error: 'مهلاً! الرجاء الانتظار',
    message: '⏳ يرجى الانتظار 3 ثواني بين عمليات البحث'
  }),
  keyGenerator: (req) => {
    return req.headers['cf-connecting-ip'] || 
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.ip ||
           'anonymous';
  },
  handler: (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(429).send(rateLimiter.message);
  }
});

const cache = new MemoryCache();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// ==========================================================
// 📝 دوال الاستخراج والتنظيف
// ==========================================================
const STOP_WORDS = new Set([
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم', 
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'شيوعا', 'اليمن', 
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false'
]);

function isRealName(name) {
  if (!name || name.length < 3) return false;
  if (/^\+?\d+$/.test(name)) return false;
  if (STOP_WORDS.has(name.trim())) return false;
  return /[\u0600-\u06FFa-zA-Z]/.test(name);
}

function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/عدد\s*السجلات\s*المكتشفة|هذا\s*الاسم\s*هو\s*الأكثر\s*شيوعاً\s*لهذا\s*الرقم|نتائج\s*البحث\s*للرقم|[\\{}{}\[\]"':\-_,\/|\.]/gi, ' ')
    .replace(/\b(عدد|السجلات|المكتشفة|الأكثر|شيوعا|شيوعاً|لهذا|الرقم|يرجى|الانتظار|البحث|نتائج|اسم|الشهرة|هاتف|ثابت)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNamesFromText(text) {
  const names = new Set();
  if (!text) return [];
  
  try {
    const jsonData = typeof text === 'object' ? text : JSON.parse(text);
    const content = jsonData.result || JSON.stringify(jsonData);
    
    const fameMatch = content.match(/اسم الشهرة[:\s]+([^\n]+)/);
    if (fameMatch) {
      let name = cleanExtractedName(fameMatch[1]);
      if (isRealName(name)) names.add(name);
    }
    
    const numberedMatches = content.matchAll(/\d+\s*[-–—]\s*([^\d\n]+)/g);
    for (const match of numberedMatches) {
      let name = cleanExtractedName(match[1]);
      if (isRealName(name)) names.add(name);
    }
  } catch {
    const numberedMatches = text.matchAll(/(\d+)\s*[-–—]\s*([^\d\n<]+)/g);
    for (const match of numberedMatches) {
      let name = cleanExtractedName(match[2]);
      if (isRealName(name)) names.add(name);
    }
  }

  return Array.from(names).slice(0, 200);
}

function detectProvider(cleanPhone) {
  if (/^(77|78)[0-9]{7}$/.test(cleanPhone)) return 'يمن موبايل';
  if (/^(73)[0-9]{7}$/.test(cleanPhone)) return 'YOU';
  if (/^(71)[0-9]{7}$/.test(cleanPhone)) return 'سبأفون';
  if (/^(70)[0-9]{7}$/.test(cleanPhone)) return 'واي';
  return 'رقم دولي';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// ==========================================================
// ⚡ دوال الجلب المتوازية والتدوير الذكي للمفاتيح
// ==========================================================
async function fetchDirectly(targetUrl, headers) {
  const response = await fetchWithTimeout(targetUrl, { method: 'GET', headers }, 3500);
  if (!response.ok) throw new Error('Direct Fetch Failed');
  const text = await response.text();
  const names = extractNamesFromText(text);
  if (names.length === 0) throw new Error('No Names Found');
  return { names, source: 'direct' };
}

async function fetchViaScraperWithFallback(targetUrl, headers) {
  const activeKeys = SCRAPINGAPI_KEYS.filter(key => !DISABLED_KEYS.has(key));

  if (activeKeys.length === 0) throw new Error('All Scraper API Keys Expired or Disabled');

  for (const apiKey of activeKeys) {
    try {
      const scrapingApiUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=false`;
      const response = await fetchWithTimeout(scrapingApiUrl, { method: 'GET', headers }, 5000);
      
      // 1️⃣ التثبت من نفاد الرصيد المباشر (403 أو 401)
      if (response.status === 403 || response.status === 401) {
        const errorBody = await response.text();
        if (errorBody.toLowerCase().includes('quota') || errorBody.toLowerCase().includes('exceeded') || response.status === 401) {
          console.warn(`[ScraperAPI] Quota Exhausted for Key: ${apiKey.substring(0, 8)}... (Disabling)`);
          DISABLED_KEYS.add(apiKey);
        }
        continue;
      }

      // 2️⃣ ضغط الطلبات المتزامنة (429) -> تجاوز للمرة الحالية فقط
      if (response.status === 429) {
        console.warn(`[ScraperAPI] Concurrency Limit Hit for Key: ${apiKey.substring(0, 8)}... (Skipping once)`);
        continue;
      }

      // 3️⃣ استجابة ناجحة
      if (response.ok) {
        const text = await response.text();
        const names = extractNamesFromText(text);
        if (names.length > 0) return { names, source: 'scrapingapi' };
      }
    } catch (err) {
      console.warn(`[ScraperAPI] Network/Timeout Error (${err.message}). Key remains active.`);
    }
  }
  throw new Error('All ScraperAPI Keys Failed');
}

// ==========================================================
// 🚀 Endpoint الرئيسي
// ==========================================================
app.all('/api/search', rateLimiter, async (req, res) => {
  try {
    const query = req.method === 'GET' ? req.query.query : req.body.query;

    if (!query) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
    }

    let cleanPhone = query.trim().replace(/[\s\-\(\)\+]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    const provider = detectProvider(cleanPhone);
    let databasePhone = (provider !== 'رقم دولي' && !cleanPhone.startsWith('0')) ? '0' + cleanPhone : cleanPhone;
    const scrapePhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    const cacheKey = `phone_${databasePhone}`;
    const cachedData = cache.match(cacheKey);

    if (cachedData) {
      return res.status(200).set('X-Cache-Status', 'HIT').json(cachedData);
    }

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
    const targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${Date.now()}`;

    const browserHeaders = {
      'accept': '*/*',
      'accept-language': 'ar,en;q=0.9',
      'referer': dynamicReferer,
      'user-agent': getRandomUserAgent()
    };

    let fetchResult;

    try {
      fetchResult = await Promise.any([
        fetchDirectly(targetUrl, browserHeaders),
        fetchViaScraperWithFallback(targetUrl, browserHeaders)
      ]);
    } catch (e) {
      // فشل المصدرين معاً
    }

    if (!fetchResult || !fetchResult.names || fetchResult.names.length === 0) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'لم يتم العثور على نتائج' });
    }

    const results = fetchResult.names.map(name => ({
      name,
      phone: databasePhone,
      source: fetchResult.source === 'scrapingapi' ? 'ScrapingAPI' : 'مباشر',
      provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      source: fetchResult.source,
      cached_at: new Date().toISOString()
    };

    cache.put(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
    return res.status(500).json({ success: false, results: [], total: 0, error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

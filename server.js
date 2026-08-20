const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "26617cf864e88b0c2f85ccc8a55155dc";
const cache = new MemoryCache();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

const STOP_WORDS = new Set([
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم', 
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'شيوعا', 'اليمن', 
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false'
]);

function isRealName(name) {
  if (!name || name.length < 2) return false;
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

function extractNamesFromJSON(jsonData) {
  const names = new Set();
  try {
    const text = typeof jsonData === 'string' ? jsonData : (jsonData.result || JSON.stringify(jsonData));
    if (text) {
      const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
      if (fameMatch) {
        let name = cleanExtractedName(fameMatch[1]);
        if (isRealName(name)) names.add(name);
      }
      
      const numberedMatches = text.matchAll(/\d+\s*[-–—]\s*([^\d\n]+)/g);
      for (const match of numberedMatches) {
        let name = cleanExtractedName(match[1]);
        if (isRealName(name)) names.add(name);
      }
    }
  } catch (e) {}
  return Array.from(names).slice(0, 200);
}

function extractNamesFromResponse(html) {
  const names = new Set();
  const numberedMatches = html.matchAll(/(\d+)\s*[-–—]\s*([^\d\n<]+)/g);
  for (const match of numberedMatches) {
    let name = cleanExtractedName(match[2]);
    if (isRealName(name)) names.add(name);
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

async function fetchWithTimeout(url, options = {}, signal, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// دالة مساعدة لتنفيذ الطلب واستخراج الأسماء مباشرة
async function attemptFetch(url, options, timeoutMs, isJson = false) {
  const res = await fetchWithTimeout(url, options, null, timeoutMs);
  if (!res.ok) throw new Error('HTTP Error ' + res.status);
  const text = await res.text();
  
  let names = [];
  try {
    names = extractNamesFromJSON(JSON.parse(text));
  } catch {
    names = extractNamesFromResponse(text);
  }
  
  if (names.length === 0) throw new Error('No names found');
  return names;
}

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
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
    };

    let names = [];
    let source = '';

    // 🛡️ المرحلة الأولى: السباق السريع المتوازي
    const abortController = new AbortController();
    
    const directTask = async () => {
      const res = await fetchWithTimeout(targetUrl, { method: 'GET', headers: browserHeaders }, abortController.signal, 5000);
      if (!res.ok) throw new Error('Failed');
      const txt = await res.text();
      let found = [];
      try { found = extractNamesFromJSON(JSON.parse(txt)); } catch { found = extractNamesFromResponse(txt); }
      if (found.length === 0) throw new Error('Empty');
      return { names: found, source: 'direct' };
    };

    const scraperTask = async () => {
      if (!SCRAPINGAPI_API_KEY) throw new Error('No Key');
      const scrapingApiUrl = `https://api.scraperapi.com/?api_key=${SCRAPINGAPI_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=false`;
      const res = await fetchWithTimeout(scrapingApiUrl, { method: 'GET', headers: browserHeaders }, abortController.signal, 8000);
      if (!res.ok) throw new Error('Failed');
      const txt = await res.text();
      let found = [];
      try { found = extractNamesFromJSON(JSON.parse(txt)); } catch { found = extractNamesFromResponse(txt); }
      if (found.length === 0) throw new Error('Empty');
      return { names: found, source: 'scrapingapi' };
    };

    try {
      const fastResult = await Promise.any([directTask(), scraperTask()]);
      abortController.abort();
      names = fastResult.names;
      source = fastResult.source;
    } catch (e) {
      // 🛡️ المرحلة الثانية (المحاولة الإضافية لضمان عدم الضياع):
      // إذا فشلت الحلول السريعة المتوازية، يجرب السيرفر المحاولات المتتالية بإعدادات أعمق

      // 1. إعادة محاولة مباشرة بمهلة أكبر (8 ثوانٍ)
      try {
        names = await attemptFetch(targetUrl, { method: 'GET', headers: browserHeaders }, 8000);
        source = 'direct_retry';
      } catch (retryErr) {
        // 2. إعادة محاولة عبر ScraperAPI مع تفعيل خيار حظر الكوكيز/الحصانة
        if (SCRAPINGAPI_API_KEY) {
          try {
            const fallbackScraperUrl = `https://api.scraperapi.com/?api_key=${SCRAPINGAPI_API_KEY}&url=${encodeURIComponent(targetUrl)}&keep_headers=true`;
            names = await attemptFetch(fallbackScraperUrl, { method: 'GET', headers: browserHeaders }, 12000);
            source = 'scrapingapi_retry';
          } catch (scraperErr) {}
        }
      }
    }

    if (names.length === 0) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'لم يتم العثور على نتائج' });
    }

    const results = names.map(name => ({
      name,
      phone: databasePhone,
      source: source.includes('scrapingapi') ? 'ScrapingAPI' : 'مباشر',
      provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      source,
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

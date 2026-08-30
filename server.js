const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

class MemoryCache {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 172800, checkperiod: 172800 });
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

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/ping', (req, res) => res.status(200).send('OK'));

const COUNTRY_CODES = [
  { code: '967', country: 'اليمن' },
  { code: '966', country: 'السعودية' },
  { code: '20', country: 'مصر' },
  { code: '971', country: 'الإمارات' },
  { code: '965', country: 'الكويت' },
  { code: '968', country: 'عُمان' },
  { code: '974', country: 'قطر' },
  { code: '973', country: 'البحرين' },
  { code: '962', country: 'الأردن' },
  { code: '961', country: 'لبنان' },
  { code: '963', country: 'سوريا' },
  { code: '964', country: 'العراق' },
  { code: '970', country: 'فلسطين' },
  { code: '212', country: 'المغرب' },
  { code: '213', country: 'الجزائر' },
  { code: '216', country: 'تونس' },
  { code: '218', country: 'ليبيا' },
  { code: '249', country: 'السودان' },
  { code: '1', country: 'أمريكا / كندا' },
  { code: '44', country: 'بريطانيا' },
  { code: '90', country: 'تركيا' }
];

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

function detectProviderAndCountry(fullPhone, cleanPhoneYemen) {
  if (cleanPhoneYemen) {
    if (/^(77|78)[0-9]{7}$/.test(cleanPhoneYemen)) return 'يمن موبايل';
    if (/^(73)[0-9]{7}$/.test(cleanPhoneYemen)) return 'YOU';
    if (/^(71)[0-9]{7}$/.test(cleanPhoneYemen)) return 'سبأفون';
    if (/^(70)[0-9]{7}$/.test(cleanPhoneYemen)) return 'واي';
    return 'اليمن';
  }

  for (const item of COUNTRY_CODES) {
    if (fullPhone.startsWith(item.code)) {
      return item.country;
    }
  }

  return 'رقم دولي';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
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

app.all('/api/search', rateLimiter, async (req, res) => {
  try {
    // قبول الطلب باسم query أو phone من GET أو POST
    const originalQuery = req.query.query || req.body.query || req.query.phone || req.body.phone;

    if (!originalQuery) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
    }

    let rawDigits = String(originalQuery).replace(/\D/g, '');

    let provider = '';
    let scrapePhone = '';

    // استخراج آخر 9 أرقام يمنية لتجاوز التكرار المزدوج للمفاتيح
    const yemenMatch = rawDigits.match(/(7[01378]\d{7})$/);

    if (yemenMatch) {
      const cleanYemen = yemenMatch[1];
      provider = detectProviderAndCountry('967' + cleanYemen, cleanYemen);
      scrapePhone = '967' + cleanYemen;
    } else {
      if (rawDigits.startsWith('00')) rawDigits = rawDigits.substring(2);
      provider = detectProviderAndCountry(rawDigits, null);
      scrapePhone = rawDigits;
    }

    // تنظيف مؤكد للموقع الخارجي (أرقام فقط بدون %)
    const cleanScrapePhone = String(scrapePhone).replace(/\D/g, '');

    const cacheKey = `phone_${cleanScrapePhone}`;
    const cachedData = cache.match(cacheKey);

    if (cachedData) {
      return res.status(200).set('X-Cache-Status', 'HIT').json(cachedData);
    }

    let names = [];
    let success = false;
    let source = '';

    const base64Phone = Buffer.from(cleanScrapePhone).toString('base64');
    const dynamicReferer = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
    
    const targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${cleanScrapePhone}&nocache=${Date.now()}`;

    const browserHeaders = {
      'accept': '*/*',
      'accept-language': 'ar,en;q=0.9',
      'referer': dynamicReferer,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
    };

    if (!SCRAPINGAPI_API_KEY) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'مفتاح ScraperAPI غير مضبوط' });
    }

    const scrapingApiUrl = `https://api.scraperapi.com/?api_key=${SCRAPINGAPI_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=false`;

    try {
      const response = await fetchWithTimeout(scrapingApiUrl, { method: 'GET', headers: browserHeaders }, 7000);
      if (response.ok) {
        const responseContent = await response.text();
        let extracted;
        try {
          extracted = extractNamesFromJSON(JSON.parse(responseContent));
        } catch {
          extracted = extractNamesFromResponse(responseContent);
        }
        if (extracted.length > 0) {
          names = extracted;
          success = true;
          source = 'scrapingapi';
        }
      }
    } catch (e) {}

    if (!success || names.length === 0) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'لم يتم العثور على نتائج' });
    }

    // مطابقة النص المسترجع مع المدخل الأصلي للتطبيق
    const results = names.map(name => ({
      name,
      phone: String(originalQuery).trim(), 
      raw_phone: cleanScrapePhone,
      source: 'ScrapingAPI',
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

const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://render-9ujf.onrender.com';

setInterval(async () => {
  try {
    await fetch(`${SERVER_URL}/ping`);
    console.log('⏰ Keep-alive ping sent successfully');
  } catch (err) {
    console.error('⚠️ Keep-alive ping failed:', err.message);
  }
}, 5 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

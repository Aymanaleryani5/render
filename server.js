const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// 📊 نظام الكاش (Memory Cache)
// ==========================================================

class MemoryCache {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 2592000, checkperiod: 86400 });
  }

  async match(requestKey) {
    const entry = this.cache.get(requestKey);
    if (!entry) return null;
    return entry;
  }

  async put(requestKey, responseData) {
    this.cache.set(requestKey, responseData);
  }

  cleanup() {}
}

// ==========================================================
// 📊 نظام تحديد المعدل (Rate Limiting)
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
    res.status(429).json(JSON.parse(rateLimiter.message));
  }
});

// ==========================================================
// 🌐 متغيرات البيئة ومفتاح ScrapingAPI (ScraperAPI)
// ==========================================================
const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "654649b0128a453b96288f7685c28f4f";

const cache = new MemoryCache();

console.log('🚀 جاري تشغيل الخادم...');
console.log(`🐝 ScraperAPI Key: ${SCRAPINGAPI_API_KEY ? '✅ موجود' : '❌ غير موجود'}`);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// ==========================================================
// 📝 دوال استخراج الأسماء (مفتوحة لنتائج أكثر دون حذف)
// ==========================================================

const STOP_WORDS = [
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false', 'error', 'success'
];

function isRealName(name) {
  if (!name || name.length < 2) return false;
  if (/^\+?\d+$/.test(name)) return false;
  if (STOP_WORDS.includes(name.trim().toLowerCase())) return false;
  if (!/[\u0600-\u06FFa-zA-Z]/.test(name)) return false;
  return true;
}

function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/نتائج\s*البحث\s*للرقم/gi, '')
    .replace(/\|{2,}\s*split\s*\|{2,}/gi, '')
    .replace(/\{.*?\}/g, '')
    .replace(/[\\{}[\]"':\-_,\/]/g, ' ')
    .replace(/\b(info|country|n|null|undefined|search|phone)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNamesFromJSON(jsonData) {
  const names = [];
  try {
    const text = typeof jsonData === 'string' ? jsonData : (jsonData.result || JSON.stringify(jsonData));
    if (text) {
      // 1. اسم الشهرة
      const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n"<]+)/);
      if (fameMatch) {
        let name = cleanExtractedName(fameMatch[1]);
        if (isRealName(name)) names.push(name);
      }
      
      // 2. الأسماء المرقّمة
      const numberedMatches = text.match(/\d+\s*[-–—]\s*([^\d\n"<]+)/g);
      if (numberedMatches) {
        numberedMatches.forEach(m => {
          const nameMatch = m.match(/\d+\s*[-–—]\s*([^\d\n"<]+)/);
          if (nameMatch) {
            let name = cleanExtractedName(nameMatch[1]);
            if (isRealName(name)) names.push(name);
          }
        });
      }

      // 3. استخراج كافة التراكيب والكلمات العربية
      const arabicPattern = /[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,4}/g;
      let arabicMatch;
      while ((arabicMatch = arabicPattern.exec(text)) !== null) {
        let name = cleanExtractedName(arabicMatch[0]);
        if (isRealName(name)) names.push(name);
      }
    }
  } catch (e) {
    console.error('خطأ في استخراج الأسماء من JSON:', e);
  }
  return [...new Set(names)].slice(0, 300);
}

function extractNamesFromResponse(html) {
  const names = [];
  
  const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  let match;
  while ((match = numberedPattern.exec(html)) !== null) {
    let name = cleanExtractedName(match[2]);
    if (isRealName(name)) names.push(name);
  }
  
  const arabicPattern = /[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,4}/g;
  let arabicMatch;
  while ((arabicMatch = arabicPattern.exec(html)) !== null) {
    let name = cleanExtractedName(arabicMatch[0]);
    if (isRealName(name)) names.push(name);
  }
  
  return [...new Set(names)].slice(0, 300);
}

function detectProvider(cleanPhone) {
  if (/^(77|78)[0-9]{7}$/.test(cleanPhone)) return 'يمن موبايل';
  if (/^(73)[0-9]{7}$/.test(cleanPhone)) return 'YOU';
  if (/^(71)[0-9]{7}$/.test(cleanPhone)) return 'سبأفون';
  if (/^(70)[0-9]{7}$/.test(cleanPhone)) return 'واي';
  return 'رقم دولي';
}

// ==========================================================
// 🚀 Endpoint الرئيسي
// ==========================================================
app.all('/api/search', rateLimiter, async (req, res) => {
  try {
    let query = req.method === 'GET' ? req.query.query : req.body.query;

    if (!query) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
    }

    let cleanPhone = query.trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    const provider = detectProvider(cleanPhone);
    let databasePhone = provider !== 'رقم دولي' && !cleanPhone.startsWith('0') ? '0' + cleanPhone : cleanPhone;
    const scrapePhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    // 1. الكاش المحلي
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200).set('X-Cache-Status', 'HIT').json(cachedData);
    }

    let names = [];
    let success = false;
    let source = '';
    const timestamp = Date.now();

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://b.raw2fid.net/calle/?res_id=K${base64Phone}%3D%3D`;

    const browserHeaders = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
      'referer': dynamicReferer,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // 2. ScraperAPI (مضبوط لتوفير النقاط والحساب المجاني)
    if (SCRAPINGAPI_API_KEY) {
      try {
        const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;
        
        const scrapingApiUrl = new URL('https://api.scraperapi.com/');
        scrapingApiUrl.searchParams.append('api_key', SCRAPINGAPI_API_KEY);
        scrapingApiUrl.searchParams.append('url', targetUrl);
        scrapingApiUrl.searchParams.append('render', 'false');       // حفظ النقاط المجانية (1 طلب فقط)
        scrapingApiUrl.searchParams.append('keep_headers', 'true'); // تمرير الهيدرات كمتصفح حقيقي

        const response = await fetch(scrapingApiUrl.toString(), {
          method: 'GET',
          headers: browserHeaders
        });

        if (response.ok) {
          const content = await response.text();
          try {
            names = extractNamesFromJSON(JSON.parse(content));
            if (names.length > 0) { success = true; source = 'scrapingapi_json'; }
          } catch (e) {
            names = extractNamesFromResponse(content);
            if (names.length > 0) { success = true; source = 'scrapingapi_html'; }
          }
        }
      } catch (e) {
        console.log('⚠️ خطأ ScraperAPI:', e.message);
      }
    }

    // 3. المحاولة عبر الجلب المباشر في حال عدم إرجاع نتائج
    if (!success || names.length === 0) {
      try {
        const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;
        const response = await fetch(targetUrl, { headers: browserHeaders });

        if (response.ok) {
          const content = await response.text();
          try {
            names = extractNamesFromJSON(JSON.parse(content));
          } catch (e) {
            names = extractNamesFromResponse(content);
          }
          if (names.length > 0) { success = true; source = 'direct_scrape'; }
        }
      } catch (e) {
        console.log('⚠️ فشل الجلب المباشر:', e.message);
      }
    }

    if (!success || names.length === 0) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'لم يتم العثور على نتائج' });
    }

    const results = names.map(name => ({
      name,
      phone: databasePhone,
      source: source.includes('scrapingapi') ? 'ScraperAPI' : 'مباشر',
      provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = { success: true, results, total: results.length, source, cached_at: new Date().toISOString() };
    await cache.put(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
    return res.status(500).json({ success: false, results: [], total: 0, error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 يعمل الخادم على المنفذ ${PORT}`);
});

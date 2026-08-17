const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// 📊 نظام الكاش المحلي (In-Memory Cache) - سريع جداً
// ==========================================================

class MemoryCache {
  constructor() {
    // تخزين لمدة 30 يوم، فحص كل 24 ساعة
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

  async clear() {
    this.cache.flushAll();
  }
}

// ==========================================================
// 📊 نظام تحديد المعدل (Rate Limiting) - للحد من الطلبات المتكررة
// ==========================================================
const rateLimiter = rateLimit({
  windowMs: 2 * 1000, // 2 ثانية
  max: 2, // طلبين كل 2 ثانية (أسرع)
  message: JSON.stringify({
    success: false,
    results: [],
    total: 0,
    error: 'مهلاً! الرجاء الانتظار',
    message: '⏳ يرجى الانتظار 2 ثانية بين عمليات البحث'
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
// 🌐 متغيرات البيئة ومفتاح ScrapingAPI
// ==========================================================
const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "654649b0128a453b96288f7685c28f4f";

const cache = new MemoryCache();

console.log('🚀 جاري تشغيل الخادم...');
console.log(`🐝 ScraperAPI Key: ${SCRAPINGAPI_API_KEY ? '✅ موجود' : '❌ غير موجود'}`);
console.log('⚡ وضع السرعة: مفعل (كاش محلي + استجابة سريعة)');

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// ==========================================================
// 📝 دوال استخراج الأسماء (محسنة للسرعة)
// ==========================================================

// ✅ قائمة الكلمات الممنوعة
const FORBIDDEN_NAMES = [
  'null', 'undefined', 'info', 'country', 'search', 
  'phone', 'true', 'false', 'error', 'success'
];

// ✅ دالة سريعة للتحقق من صحة الاسم
function isRealName(name) {
  if (!name || name.length < 2) return false;
  if (/^\+?\d+$/.test(name)) return false;
  
  const trimmedName = name.trim().toLowerCase();
  for (const forbidden of FORBIDDEN_NAMES) {
    if (trimmedName.includes(forbidden)) return false;
  }
  
  if (!/[\u0600-\u06FFa-zA-Z]/.test(name)) return false;
  return true;
}

// ✅ تنظيف سريع للاسم
function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/نتائج\s*البحث\s*للرقم/gi, '')
    .replace(/\|{2,}\s*split\s*\|{2,}/gi, '')
    .replace(/\{.*?\}/g, '')
    .replace(/[\\{}[\]"':\-_,\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ✅ استخراج الأسماء من JSON (مُحسَّن للسرعة)
function extractNamesFromJSON(jsonData) {
  const names = [];
  try {
    const text = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
    
    // البحث عن الأنماط بسرعة
    const patterns = [
      /اسم الشهرة[:\s]+([^\n"<]+)/,
      /\d+\s*[-–—]\s*([^\d\n"<]+)/g,
      /[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,4}/g
    ];
    
    // استخراج الأسماء المرقمة
    const numberedMatches = text.match(patterns[1]);
    if (numberedMatches) {
      numberedMatches.forEach(m => {
        const match = m.match(/\d+\s*[-–—]\s*([^\d\n"<]+)/);
        if (match) {
          const name = cleanExtractedName(match[1]);
          if (isRealName(name)) names.push(name);
        }
      });
    }
    
    // استخراج الأسماء العربية
    const arabicMatches = text.match(patterns[2]);
    if (arabicMatches) {
      arabicMatches.forEach(name => {
        const clean = cleanExtractedName(name);
        if (isRealName(clean)) names.push(clean);
      });
    }
    
  } catch (e) {
    console.error('خطأ في الاستخراج:', e.message);
  }
  
  // إزالة التكرارات وترتيب سريع
  const unique = [...new Set(names)];
  return unique.sort((a, b) => a.localeCompare(b, 'ar')).slice(0, 300);
}

// ✅ استخراج الأسماء من HTML (مُحسَّن للسرعة)
function extractNamesFromResponse(html) {
  const names = [];
  
  // استخراج الأسماء المرقمة
  const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  let match;
  while ((match = numberedPattern.exec(html)) !== null) {
    const name = cleanExtractedName(match[2]);
    if (isRealName(name)) names.push(name);
  }
  
  // استخراج الأسماء العربية
  const arabicPattern = /[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,4}/g;
  let arabicMatch;
  while ((arabicMatch = arabicPattern.exec(html)) !== null) {
    const name = cleanExtractedName(arabicMatch[0]);
    if (isRealName(name)) names.push(name);
  }
  
  const unique = [...new Set(names)];
  return unique.sort((a, b) => a.localeCompare(b, 'ar')).slice(0, 300);
}

// ✅ كشف مقدم الخدمة
function detectProvider(cleanPhone) {
  if (/^(77|78)[0-9]{7}$/.test(cleanPhone)) return 'يمن موبايل';
  if (/^(73)[0-9]{7}$/.test(cleanPhone)) return 'YOU';
  if (/^(71)[0-9]{7}$/.test(cleanPhone)) return 'سبأفون';
  if (/^(70)[0-9]{7}$/.test(cleanPhone)) return 'واي';
  return 'رقم دولي';
}

// ==========================================================
// 🚀 Endpoint الرئيسي (مُحسَّن للسرعة)
// ==========================================================
app.all('/api/search', rateLimiter, async (req, res) => {
  const startTime = Date.now();
  
  try {
    let query = req.method === 'GET' ? req.query.query : req.body.query;

    if (!query) {
      return res.status(200).json({ 
        success: false, 
        results: [], 
        total: 0, 
        error: 'البحث فارغ',
        responseTime: `${Date.now() - startTime}ms`
      });
    }

    // تنظيف الرقم بسرعة
    let cleanPhone = query.trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    const provider = detectProvider(cleanPhone);
    let databasePhone = provider !== 'رقم دولي' && !cleanPhone.startsWith('0') ? '0' + cleanPhone : cleanPhone;
    const scrapePhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    // 🔍 التحقق من الكاش المحلي (سريع جداً)
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    
    if (cachedData) {
      const responseTime = Date.now() - startTime;
      console.log(`✅ كاش: ${databasePhone} (${responseTime}ms)`);
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('X-Response-Time', `${responseTime}ms`)
        .json({
          ...cachedData,
          cached: true,
          responseTime: `${responseTime}ms`
        });
    }

    // 🌐 البحث عبر ScraperAPI (مع مهلة قصيرة)
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

    // محاولة ScraperAPI مع مهلة 10 ثواني
    if (SCRAPINGAPI_API_KEY) {
      try {
        const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;
        
        const scrapingApiUrl = new URL('https://api.scraperapi.com/');
        scrapingApiUrl.searchParams.append('api_key', SCRAPINGAPI_API_KEY);
        scrapingApiUrl.searchParams.append('url', targetUrl);
        scrapingApiUrl.searchParams.append('render', 'false');
        scrapingApiUrl.searchParams.append('keep_headers', 'true');

        // مهلة 10 ثواني للطلب
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(scrapingApiUrl.toString(), {
          method: 'GET',
          headers: browserHeaders,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

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
        console.log(`⚠️ ScraperAPI (${databasePhone}):`, e.message);
      }
    }

    // محاولة مباشرة إذا فشل ScraperAPI
    if (!success || names.length === 0) {
      try {
        const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(targetUrl, { 
          headers: browserHeaders,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

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
        console.log(`⚠️ مباشر (${databasePhone}):`, e.message);
      }
    }

    // 🚫 لا توجد نتائج
    if (!success || names.length === 0) {
      const responseTime = Date.now() - startTime;
      return res.status(200).json({ 
        success: false, 
        results: [], 
        total: 0, 
        error: 'لم يتم العثور على نتائج',
        responseTime: `${responseTime}ms`
      });
    }

    // ✅ تحضير النتائج
    const results = names.map(name => ({
      name,
      phone: databasePhone,
      source: source.includes('scrapingapi') ? 'ScraperAPI' : 'مباشر',
      provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = { 
      success: true, 
      results, 
      total: results.length, 
      source, 
      cached_at: new Date().toISOString(),
      cached: false
    };

    // 💾 حفظ في الكاش للاستخدام المستقبلي
    await cache.put(cacheKey, finalResponseData);

    const responseTime = Date.now() - startTime;
    console.log(`✅ جديد: ${databasePhone} (${responseTime}ms) - ${results.length} اسم`);

    return res.status(200)
      .set('X-Cache-Status', 'MISS')
      .set('X-Response-Time', `${responseTime}ms`)
      .json({
        ...finalResponseData,
        responseTime: `${responseTime}ms`
      });

  } catch (e) {
    const responseTime = Date.now() - startTime;
    console.error(`❌ خطأ (${responseTime}ms):`, e.message);
    return res.status(500).json({ 
      success: false, 
      results: [], 
      total: 0, 
      error: e.message,
      responseTime: `${responseTime}ms`
    });
  }
});

// ==========================================================
// 🧹 مسح الكاش (Endpoint إضافي)
// ==========================================================
app.post('/api/cache/clear', async (req, res) => {
  await cache.clear();
  res.json({ success: true, message: '🧹 تم مسح الكاش بالكامل' });
});

// ==========================================================
// 📊 حالة الكاش (Endpoint إضافي)
// ==========================================================
app.get('/api/cache/stats', (req, res) => {
  const stats = cache.cache.getStats();
  res.json({
    success: true,
    stats: {
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses,
      ksize: stats.ksize,
      vsize: stats.vsize
    }
  });
});

// ==========================================================
// 🚀 تشغيل الخادم
// ==========================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 يعمل الخادم على المنفذ ${PORT}`);
  console.log(`⚡ وضع السرعة: مفعل`);
  console.log(`📊 الكاش: جاهز (30 يوم تخزين)`);
  console.log(`🔄 Rate Limit: طلبين كل 2 ثانية`);
});

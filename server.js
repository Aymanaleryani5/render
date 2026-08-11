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
// 🌐 متغيرات البيئة ومفتاح ScrapingBee
// ==========================================================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qfcsaiyuyxhibidrrmha.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || "IDUQA2D25IHAQVLA6MJ4MNWERIJTSE1MHME7UBKK85365E5L7IJT3IX5Q33NM2US55IMEH8HB1Y57XF3";

const cache = new MemoryCache();

console.log('🚀 جاري تشغيل الخادم...');

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// ==========================================================
// 📝 دوال تنظيف واستخراج الأسماء المعدلة
// ==========================================================

function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/<[^>]*>/g, '') // إزالة وسوم HTML
    .replace(/[\{\}\[\]"':\-_,\/\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSearchResponse(data) {
  const names = [];
  let content = typeof data === 'string' ? data : JSON.stringify(data);

  // إذا كانت الاستجابة JSON تحتوي على حقل result أو html
  if (typeof data === 'object' && data !== null) {
    if (data.result) content = data.result;
    if (data.html) content = data.html;
  }

  // 1. البحث عن النمط الشائع: أرقام تسلسلية متبوعة بالاسم
  const numberedPattern = /\d+\s*[-–—.]\s*([^\n<"'{}\d]+)/g;
  let match;
  while ((match = numberedPattern.exec(content)) !== null) {
    let cleaned = cleanExtractedName(match[1]);
    if (cleaned.length > 2 && !/^\+?\d+$/.test(cleaned)) {
      names.push(cleaned);
    }
  }

  // 2. البحث عن الأسماء العربية مباشرة
  const arabicPattern = /[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,4}/g;
  while ((match = arabicPattern.exec(content)) !== null) {
    let cleaned = cleanExtractedName(match[0]);
    if (cleaned.length > 2 && !names.includes(cleaned)) {
      names.push(cleaned);
    }
  }

  return [...new Set(names)].slice(0, 200);
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
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'البحث فارغ'
      });
    }

    // تنظيف رقم الهاتف وترتيب الصيغة
    let cleanPhone = query.trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
    
    if (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    const provider = detectProvider(cleanPhone);
    const databasePhone = provider !== 'رقم دولي' && !cleanPhone.startsWith('0') ? '0' + cleanPhone : cleanPhone;
    
    // التنسيق المطلوب للنظام المباشر: +967xxxxxxxxx
    const scrapePhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    // 🛡️ [المستوى 1] الكاش المحلي
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .json(cachedData);
    }

    // 🛡️ [المستوى 2] Supabase
    if (SUPABASE_ANON_KEY) {
      try {
        const dbResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/numbers?phone=eq.${databasePhone}&select=*`,
          {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            }
          }
        );

        if (dbResponse.ok) {
          const existingRecords = await dbResponse.json();
          if (existingRecords && existingRecords.length > 0) {
            const results = existingRecords.map((rec) => ({
              name: rec.name || rec.contact_name || rec.full_name || 'اسم غير معروف',
              phone: rec.phone || databasePhone,
              source: rec.source || 'قاعدة البيانات',
              provider: rec.provider || provider,
              formattedDate: new Date(rec.created_at || Date.now()).toLocaleDateString('ar-EG')
            }));

            const finalResponseData = {
              success: true,
              results,
              total: results.length,
              source: 'supabase_cache',
              cached_at: new Date().toISOString()
            };

            await cache.put(cacheKey, finalResponseData);
            return res.status(200).json(finalResponseData);
          }
        }
      } catch (dbErr) {
        console.error('❌ خطأ في Supabase:', dbErr);
      }
    }

    // 🌐 [المستوى 3] طلب البيانات من النطاق الصحيح (3.nabx.net)
    let names = [];
    let success = false;
    let source = '';
    
    // النطاق الصحيح الشغال لديك
    const targetUrl = `https://3.nabx.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;

    // 1. محاولة الجلب عبر ScrapingBee
    if (SCRAPINGBEE_API_KEY) {
      try {
        console.log(`🐝 جلب عبر ScrapingBee: ${targetUrl}`);
        const scrapingBeeUrl = new URL('https://app.scrapingbee.com/api/v1/');
        scrapingBeeUrl.searchParams.append('api_key', SCRAPINGBEE_API_KEY);
        scrapingBeeUrl.searchParams.append('url', targetUrl);
        scrapingBeeUrl.searchParams.append('render_js', 'false');

        const response = await fetch(scrapingBeeUrl.toString());
        if (response.ok) {
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } catch(e) { data = text; }
          
          names = parseSearchResponse(data);
          if (names.length > 0) {
            success = true;
            source = 'scrapingbee';
          }
        }
      } catch (e) {
        console.error('❌ خطأ في ScrapingBee:', e.message);
      }
    }

    // 2. محاولة الجلب المباشر في حال عدم تفعيل ScrapingBee أو فشله
    if (!success || names.length === 0) {
      try {
        console.log(`🔄 جلب مباشر من: ${targetUrl}`);
        const response = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/html, */*',
            'Referer': 'https://3.nabx.net/'
          }
        });

        if (response.ok) {
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } catch(e) { data = text; }

          names = parseSearchResponse(data);
          if (names.length > 0) {
            success = true;
            source = 'direct';
          }
        }
      } catch (e) {
        console.error('❌ خطأ في الجلب المباشر:', e.message);
      }
    }

    // إرجاع النتيجة إذا لم يتم العثور على أي اسم
    if (!success || names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج'
      });
    }

    // تجهيز الاستجابة النهائية
    const results = names.map(name => ({
      name: name,
      phone: databasePhone,
      source: source === 'scrapingbee' ? 'ScrapingBee' : 'مباشر',
      provider: provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      source: source,
      cached_at: new Date().toISOString()
    };

    await cache.put(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
    console.error('❌ خطأ عام:', e);
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: e.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 تشغيل خادم Node.js على المنفذ ${PORT}`);
});

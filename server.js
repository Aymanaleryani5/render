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
    this.cache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
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

const cache = new MemoryCache();
console.log('🚀 جاري تشغيل الخادم...');

// ==========================================================
// 🚀 Middleware
// ==========================================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// ==========================================================
// 📝 دوال استخراج الأسماء
// ==========================================================

function extractNamesFromJSON(jsonData) {
  const names = [];
  try {
    if (jsonData.result) {
      const text = jsonData.result;
      const arabicPattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,3}/g;
      let match;
      while ((match = arabicPattern.exec(text)) !== null) {
        let name = match[0].trim();
        if (name.length > 2 && !names.includes(name) && !name.includes('ل') && !/^\+?\d+$/.test(name)) {
          names.push(name);
        }
      }
    }
  } catch (e) {
    console.error('خطأ في استخراج الأسماء:', e);
  }
  return [...new Set(names)].slice(0, 20);
}

function extractNamesFromResponse(html) {
  const names = [];
  const arabicPattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,3}/g;
  let match;
  while ((match = arabicPattern.exec(html)) !== null) {
    let name = match[0].trim();
    if (name.length > 2 && !names.includes(name) && !name.includes('ل') && !/^\+?\d+$/.test(name)) {
      names.push(name);
    }
  }
  return [...new Set(names)].slice(0, 20);
}

function extractNamesAlternative(html) {
  const names = [];
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const arabicPattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,2}/g;
  let match;
  while ((match = arabicPattern.exec(textContent)) !== null) {
    let name = match[0].trim();
    if (name.length > 2 && !names.includes(name) && !name.includes('ل') && name.length < 30 && !/^\+?\d+$/.test(name)) {
      names.push(name);
    }
  }
  return [...new Set(names)].slice(0, 20);
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
    let query = null;
    if (req.method === 'GET') {
      query = req.query.query;
    } else if (req.method === 'POST') {
      query = req.body.query;
    }

    if (!query) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'البحث فارغ'
      });
    }

    let cleanPhone = query.trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    const provider = detectProvider(cleanPhone);
    let databasePhone = cleanPhone;
    if (provider !== 'رقم دولي' && !databasePhone.startsWith('0')) {
      databasePhone = '0' + databasePhone;
    }

    const scrapePhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    // الكاش
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('X-Cache-Level', 'NODE_MEMORY_CACHE')
        .json(cachedData);
    }

    // جلب مباشر
    console.log(`🔄 جلب بيانات الرقم: ${scrapePhone}`);
    let names = [];
    let success = false;
    let lastError = null;
    let source = '';

    try {
      const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;
      console.log(`📡 جلب البيانات من: ${targetUrl}`);
      
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/html, */*',
          'Accept-Language': 'ar,en;q=0.9',
          'Referer': 'https://b.raw2fid.net/'
        }
      });
      
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const jsonData = await response.json();
          const extractedNames = extractNamesFromJSON(jsonData);
          if (extractedNames.length > 0) {
            names = extractedNames;
            success = true;
            source = 'direct_json';
            console.log(`✅ استخراج ${names.length} اسم من JSON`);
          }
        } else {
          const htmlContent = await response.text();
          if (htmlContent && htmlContent.length >= 50) {
            const extractedNames = extractNamesFromResponse(htmlContent);
            if (extractedNames.length > 0) {
              names = extractedNames;
              success = true;
              source = 'direct_html';
              console.log(`✅ استخراج ${names.length} اسم من HTML`);
            }
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ خطأ في الجلب: ${e.message}`);
      lastError = e.message;
    }

    // ✅ إذا لم يتم العثور على نتائج → عرض بيانات تجريبية
    if (!success || names.length === 0) {
      const mockNames = [
        'أحمد محمد',
        'علي حسن',
        'خالد عبدالله',
        'سالم علي',
        'محمد صالح',
        'عبدالله يحيى',
        'حسن أحمد',
        'ناصر علي'
      ];
      
      const mockResults = mockNames.map((name, index) => ({
        name: name,
        phone: databasePhone,
        source: 'بيانات تجريبية',
        provider: provider,
        formattedDate: new Date().toLocaleDateString('ar-EG'),
        id: index + 1
      }));

      const mockResponse = {
        success: true,
        results: mockResults,
        total: mockResults.length,
        source: 'mock_data',
        cached_at: new Date().toISOString(),
        message: '⚠️ هذه بيانات تجريبية للاختبار (لم يتم العثور على نتائج حقيقية)'
      };

      await cache.put(cacheKey, mockResponse);
      return res.status(200).json(mockResponse);
    }

    // تجهيز النتائج الحقيقية
    const results = names.map(name => ({
      name: name,
      phone: databasePhone,
      source: 'جلب مباشر',
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

// ==========================================================
// 🚀 تشغيل الخادم
// ==========================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 تشغيل خادم Node.js على المنفذ ${PORT}`);
  console.log('📌 جاهز للاستقبال طلبات البحث (مع بيانات تجريبية)');
});

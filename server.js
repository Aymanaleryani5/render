const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const pLimit = require('p-limit');
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
    return this.cache.get(requestKey) || null;
  }

  async put(requestKey, responseData) {
    this.cache.set(requestKey, responseData);
  }
}

// ==========================================================
// 🛡️ تحديد معدل الطلبات (Rate Limiting)
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
// 🌐 التهيئة والتحكم بالطلبات المتزامنة
// ==========================================================
const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "654649b0128a453b96288f7685c28f4f";
const cache = new MemoryCache();
const limit = pLimit(10);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// ==========================================================
// 📝 دوال استخراج وتنظيف البيانات المحدثة
// ==========================================================
function isRealName(name) {
  if (!name) return false;
  // استبعاد السطور التي تحتوي على رقم هاتف مجرد فقط
  if (/^\+?\d+$/.test(name.trim())) return false;
  return true;
}

function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/<[^>]*>/g, '') // إزالة وسم الـ HTML
    .replace(/[\\{}()\[\]"':_\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNames(rawInput) {
  const names = [];
  if (!rawInput) return names;

  try {
    let text = rawInput;

    // تحويل الاستجابة إلى نص إذا كانت قادمة كـ JSON
    if (typeof rawInput === 'object') {
      text = rawInput.result || JSON.stringify(rawInput);
    } else {
      try {
        const parsed = JSON.parse(rawInput);
        if (parsed && parsed.result) text = parsed.result;
      } catch (e) {}
    }

    // فصل النص الأساسي عن التذييل التحليلي
    const mainPart = text.split('|||SPLIT|||')[0] || text;

    // استخراج اسم الشهرة إذا وجد
    const fameMatch = mainPart.match(/اسم الشهرة[:\s]+([^<\n]+)/);
    if (fameMatch && fameMatch[1]) {
      let fameName = cleanExtractedName(fameMatch[1]);
      if (isRealName(fameName)) names.push(fameName);
    }

    // استخراج كافة السطور المرقّمة مع الإبقاء على الأرقام والرموز داخل الاسم
    const lines = mainPart.split(/\n|<br\s*\/?>/gi);
    lines.forEach(line => {
      let trimmed = line.replace(/<[^>]*>/g, '').trim();
      if (!trimmed || trimmed.startsWith('📋')) return;

      const match = trimmed.match(/^\d+\s*[-–—]\s*(.+)$/);
      if (match && match[1]) {
        let cleanName = cleanExtractedName(match[1]);
        if (isRealName(cleanName) && !names.includes(cleanName)) {
          names.push(cleanName);
        }
      }
    });
  } catch (e) {}

  return names;
}

function detectProvider(cleanPhone) {
  if (/^(77|78)[0-9]{7}$/.test(cleanPhone)) return 'يمن موبايل';
  if (/^(73)[0-9]{7}$/.test(cleanPhone)) return 'YOU';
  if (/^(71)[0-9]{7}$/.test(cleanPhone)) return 'سبأفون';
  if (/^(70)[0-9]{7}$/.test(cleanPhone)) return 'واي';
  return 'رقم دولي';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
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

    // 1. فحص الكاش الفوري
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .json(cachedData);
    }

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
    const timestamp = Date.now();
    const targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;

    const headers = {
      'accept': '*/*',
      'accept-language': 'ar,en-US;q=0.9,en;q=0.8',
      'referer': dynamicReferer,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    const resultData = await limit(async () => {
      let fetchedNames = [];
      let source = '';

      // المحاولة الأولى: جلب مباشر
      try {
        const response = await fetchWithTimeout(targetUrl, { method: 'GET', headers }, 2000);
        if (response.ok) {
          const rawText = await response.text();
          fetchedNames = parseNames(rawText);
          if (fetchedNames.length > 0) source = 'direct';
        }
      } catch (e) {}

      // المحاولة الثانية: ScrapingAPI عند الحاجة
      if (fetchedNames.length === 0 && SCRAPINGAPI_API_KEY) {
        try {
          const scrapingUrl = `https://api.scraperapi.com/?api_key=${SCRAPINGAPI_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=false&premium_proxy=false`;
          const response = await fetchWithTimeout(scrapingUrl, { method: 'GET', headers }, 5000);
          if (response.ok) {
            const rawText = await response.text();
            fetchedNames = parseNames(rawText);
            if (fetchedNames.length > 0) source = 'scrapingapi';
          }
        } catch (e) {}
      }

      return { names: fetchedNames, source };
    });

    if (!resultData.names || resultData.names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج'
      });
    }

    const results = resultData.names.map(name => ({
      name,
      phone: databasePhone,
      source: resultData.source === 'scrapingapi' ? 'ScrapingAPI' : 'مباشر',
      provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      source: resultData.source,
      cached_at: new Date().toISOString()
    };

    await cache.put(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
    return res.status(500).json({ success: false, results: [], total: 0, error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 تم تشغيل الخادم بنجاح على المنفذ ${PORT}`);
});

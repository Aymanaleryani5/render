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
// 🌐 التهيئة والتحكم بالطلبات المتزامنة (10 طلبات في وقت واحد)
// ==========================================================
const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "654649b0128a453b96288f7685c28f4f";
const cache = new MemoryCache();
const limit = pLimit(10); // تحديد الحد الأقصى للطلبات المتزامنة

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// ==========================================================
// 📝 دوال استخراج وتنظيف البيانات
// ==========================================================
const STOP_WORDS = [
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم', 
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'اليمن', 
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false'
];

function isRealName(name) {
  if (!name || name.length < 3) return false;
  if (/^\+?\d+$/.test(name)) return false;
  if (STOP_WORDS.includes(name.trim())) return false;
  if (!/[\u0600-\u06FFa-zA-Z]/.test(name)) return false;
  return true;
}

function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/نتائج\s*البحث\s*للرقم/gi, '')
    .replace(/\|{2,}\s*split\s*\|{2,}/gi, '')
    .replace(/\{.*?\}/g, '')
    .replace(/[\\{}{}\[\]"':\-_,\/]/g, ' ')
    .replace(/\b(info|country|n|null|undefined|الرقم|اسم|search|phone|نتائج|البحث|للرقم|الشهرة|السجلات|المكتشفة|الأكثر|شيوعاً|اليمن|من|هذا|هذه|كان|مع|عن|على|الى|حتى|بين|أو|و|ف|في|إلى|عند|ب|ك|ل|لل|و|ثم|حتى|لكن|ولا|أو|ثم|حيث|بين|عندما|ذلك|هذه|هذا|التي|الذي|الذين|اللاتي|اللواتي|منذ|خلال|بسبب|دون|بينما|حيثما|كلما|متى|أين|كيف|إذا|لن|لم|ما|لا|ليس|سوف|قد|ربما|لعل|ليت|لابد|لعل|لكي|كي|حتّى|حتى)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNames(text) {
  const names = [];
  if (!text) return names;
  
  try {
    const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
    if (fameMatch) {
      let name = cleanExtractedName(fameMatch[1]);
      if (isRealName(name)) names.push(name);
    }
    
    const numberedMatches = text.match(/\d+\s*[-–—]\s*([^\d\n<]+)/g);
    if (numberedMatches) {
      numberedMatches.forEach(m => {
        const nameMatch = m.match(/\d+\s*[-–—]\s*([^\d\n<]+)/);
        if (nameMatch) {
          let name = cleanExtractedName(nameMatch[1]);
          if (isRealName(name) && !names.includes(name)) names.push(name);
        }
      });
    }
  } catch (e) {}

  return [...new Set(names)].slice(0, 200);
}

function detectProvider(cleanPhone) {
  if (/^(77|78)[0-9]{7}$/.test(cleanPhone)) return 'يمن موبايل';
  if (/^(73)[0-9]{7}$/.test(cleanPhone)) return 'YOU';
  if (/^(71)[0-9]{7}$/.test(cleanPhone)) return 'سبأفون';
  if (/^(70)[0-9]{7}$/.test(cleanPhone)) return 'واي';
  return 'رقم دولي';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
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

    // تنفيذ المهمة داخل طابور p-limit
    const resultData = await limit(async () => {
      let fetchedNames = [];
      let source = '';

      // المحاولة الأولى: جلب مباشر
      try {
        const response = await fetchWithTimeout(targetUrl, { method: 'GET', headers }, 1500);
        if (response.ok) {
          const text = await response.text();
          fetchedNames = parseNames(text);
          if (fetchedNames.length > 0) source = 'direct';
        }
      } catch (e) {}

      // المحاولة الثانية: ScrapingAPI عند الحاجة
      if (fetchedNames.length === 0 && SCRAPINGAPI_API_KEY) {
        try {
          const scrapingUrl = `https://api.scraperapi.com/?api_key=${SCRAPINGAPI_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=false&premium_proxy=false`;
          const response = await fetchWithTimeout(scrapingUrl, { method: 'GET', headers }, 4000);
          if (response.ok) {
            const text = await response.text();
            fetchedNames = parseNames(text);
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

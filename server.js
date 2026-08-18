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
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || "0SXVV2GZ5FDJI5FZNPG2KK5L7T2NP1APNA37I18BTMJPIJDRX7RQYTZ81H6O69VMI3L5RV4YQ7E1THAQ";

// 🎯 النطاق المستهدف الجديد
const BASE_HOST = process.env.TARGET_HOST || "3.nabx.net";

const cache = new MemoryCache();

console.log(`🚀 جاري تشغيل الخادم بالسعة المحسنة على النطاق [${BASE_HOST}]...`);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// ==========================================================
// 📝 دوال استخراج وتنظيف الأسماء
// ==========================================================
const STOP_WORDS = new Set([
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم', 
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'اليمن', 
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false'
]);

function isRealName(name) {
  if (!name || name.length < 3) return false;
  if (/^\+?\d+$/.test(name)) return false;
  if (STOP_WORDS.has(name.trim())) return false;
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
    .replace(/\b(info|country|n|null|undefined|الرقم|اسم|search|phone|نتائج|البحث|للرقم|الشهرة|السجلات|المكتشفة|الأكثر|شيوعاً|اليمن|من|هذا|هذه|كان|مع|عن|على|الى|حتى|بين|أو|و|ف|في|إلى|على|عن|من|إلى|عند|ب|ك|ل|لل|و|ثم|حتى|لكن|ولا|أو|ثم|حيث|بين|عندما|ذلك|هذه|هذا|التي|الذي|الذين|اللاتي|اللواتي|منذ|خلال|بسبب|دون|بينما|حيثما|كلما|متى|أين|كيف|إذا|لن|لم|ما|لا|ليس|سوف|قد|ربما|لعل|ليت|لابد|لعل|لكي|كي|حتّى|حتى)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function processContentAndExtractNames(content) {
  const names = [];
  if (!content) return names;

  let text = typeof content === 'object' ? JSON.stringify(content) : content;

  // فحص نمط اسم الشهرة
  const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
  if (fameMatch) {
    let name = cleanExtractedName(fameMatch[1]);
    if (isRealName(name)) names.push(name);
  }

  // فحص الأنماط المرقّمة
  const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  let match;
  while ((match = numberedPattern.exec(text)) !== null) {
    let name = cleanExtractedName(match[2]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
  }

  // فحص الكلمات المفتاحية العامة
  if (names.length === 0) {
    const keywords = ['اسم', 'الاسم', 'name', 'user', 'contact', 'مالك', 'الشهرة'];
    for (const keyword of keywords) {
      const regex = new RegExp(`${keyword}[\\s:]*([^\\n<,]+)`, 'gi');
      while ((match = regex.exec(text)) !== null) {
        let name = cleanExtractedName(match[1]);
        if (isRealName(name) && !names.includes(name)) names.push(name);
      }
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
// ⚡ دوال الجلب مع الحماية والـ Debug
// ==========================================================
async function fetchDirect(targetUrl, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(targetUrl, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`Status ${response.status}`);
    const text = await response.text();

    const extractedNames = processContentAndExtractNames(text);
    if (extractedNames.length === 0) throw new Error('No names found in direct fetch');
    return { names: extractedNames, source: 'direct' };
  } catch (e) {
    clearTimeout(timer);
    console.log(`⚠️ Direct Fetch Failed: ${e.message}`);
    throw e;
  }
}

async function fetchScrapingBee(targetUrl, browserHeaders) {
  const scrapingBeeUrl = new URL('https://app.scrapingbee.com/api/v1/');
  scrapingBeeUrl.searchParams.append('api_key', SCRAPINGBEE_API_KEY);
  scrapingBeeUrl.searchParams.append('url', targetUrl);
  scrapingBeeUrl.searchParams.append('render_js', 'false');
  scrapingBeeUrl.searchParams.append('stealth_proxy', 'true');
  scrapingBeeUrl.searchParams.append('forward_headers', 'true');

  const beeHeaders = {};
  for (const [key, value] of Object.entries(browserHeaders)) {
    beeHeaders[`Spb-${key}`] = value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(scrapingBeeUrl.toString(), {
      method: 'GET',
      headers: beeHeaders,
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`ScrapingBee Status ${response.status}`);
    const text = await response.text();

    const extractedNames = processContentAndExtractNames(text);
    if (extractedNames.length === 0) throw new Error('No names found in ScrapingBee fetch');
    return { names: extractedNames, source: 'scrapingbee' };
  } catch (e) {
    clearTimeout(timer);
    console.log(`⚠️ ScrapingBee Fetch Failed: ${e.message}`);
    throw e;
  }
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

    // 🛡️ [المستوى 1] الكاش المحلي
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('X-Cache-Level', 'NODE_MEMORY_CACHE')
        .json(cachedData);
    }

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://${BASE_HOST}/calle/?res_id=K${base64Phone}%3D%3D`;
    const timestamp = Date.now();
    const targetUrl = `https://${BASE_HOST}/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;

    const browserHeaders = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'referer': dynamicReferer,
      'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
    };

    let winningResult = null;

    // ⚡ محاولة الجلب بالتوازي مع التغليف الآمن
    try {
      const promises = [
        fetchDirect(targetUrl, browserHeaders)
      ];

      if (SCRAPINGBEE_API_KEY) {
        promises.push(fetchScrapingBee(targetUrl, browserHeaders));
      }

      winningResult = await Promise.any(promises);
    } catch (e) {
      console.log('❌ فشل جلب النتائج من جميع المصادر.');
    }

    if (!winningResult || !winningResult.names || winningResult.names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج'
      });
    }

    const results = winningResult.names.map(name => ({
      name: name,
      phone: databasePhone,
      source: winningResult.source === 'scrapingbee' ? 'ScrapingBee' : 'مباشر',
      provider: provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      source: winningResult.source,
      cached_at: new Date().toISOString()
    };

    await cache.put(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
    return res.status(200).json({
      success: false,
      results: [],
      total: 0,
      error: 'حدث خطأ أثناء معالجة الطلب'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 تشغيل خادم Node.js السريع على المنفذ ${PORT}`);
});

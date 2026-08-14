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

  cleanup() {
    // NodeCache يقوم بالتنظيف تلقائياً
  }
}

// ==========================================================
// 📊 نظام تحديد المعدل (Rate Limiting)
// ==========================================================
const rateLimiter = rateLimit({
  windowMs: 3 * 1000, // 3 ثواني
  max: 1, // طلب واحد لكل IP
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
// 🌐 متغيرات البيئة ومفتاح ScrapingAPI
// ==========================================================
const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "81642fe717b80c9fd3093d74795f65f5";

// إنشاء مثيلات
const cache = new MemoryCache();

console.log('🚀 جاري تشغيل الخادم...');
console.log(`🐝 ScrapingAPI API Key: ${SCRAPINGAPI_API_KEY ? '✅ موجود' : '❌ غير موجود'}`);

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
// 📝 دوال استخراج وتنظيف الأسماء
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
    .replace(/\b(info|country|n|null|undefined|الرقم|اسم|search|phone|نتائج|البحث|للرقم|الشهرة|السجلات|المكتشفة|الأكثر|شيوعاً|اليمن|من|هذا|هذه|كان|مع|عن|على|الى|حتى|بين|أو|و|ف|في|إلى|على|عن|من|إلى|عند|ب|ك|ل|لل|و|ثم|حتى|لكن|ولا|أو|ثم|حيث|بين|عندما|ذلك|هذه|هذا|التي|الذي|الذين|اللاتي|اللواتي|منذ|خلال|بسبب|دون|بينما|حيثما|كلما|متى|أين|كيف|إذا|لن|لم|ما|لا|ليس|سوف|قد|ربما|لعل|ليت|لابد|لعل|لكي|كي|حتّى|حتى)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNamesFromJSON(jsonData) {
  const names = [];
  try {
    const text = typeof jsonData === 'string' ? jsonData : (jsonData.result || JSON.stringify(jsonData));
    if (text) {
      const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
      if (fameMatch) {
        let name = cleanExtractedName(fameMatch[1]);
        if (isRealName(name) && !names.includes(name)) names.push(name);
      }
      
      const numberedMatches = text.match(/\d+\s*[-–—]\s*([^\d\n]+)/g);
      if (numberedMatches) {
        numberedMatches.forEach(m => {
          const nameMatch = m.match(/\d+\s*[-–—]\s*([^\d\n]+)/);
          if (nameMatch) {
            let name = cleanExtractedName(nameMatch[1]);
            if (isRealName(name) && !names.includes(name)) names.push(name);
          }
        });
      }
    }
  } catch (e) {
    console.error('خطأ في استخراج الأسماء من JSON:', e);
  }
  return [...new Set(names)].slice(0, 200);
}

function extractNamesFromResponse(html) {
  const names = [];
  const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  let match;
  while ((match = numberedPattern.exec(html)) !== null) {
    let name = cleanExtractedName(match[2]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  const nameTags = /<[^>]*name[^>]*>([^<]+)<\/[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = nameTags.exec(html)) !== null) {
    let name = cleanExtractedName(tagMatch[1]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  return [...new Set(names)].slice(0, 200);
}

function extractNamesAlternative(html) {
  const names = [];
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  
  const keywords = ['اسم', 'الاسم', 'name', 'user', 'contact', 'صاحب', 'مالك', 'الشهرة', 'المستخدم', 'العميل'];
  for (const keyword of keywords) {
    const regex = new RegExp(`${keyword}[\\s:]*([^\\n<,]+)`, 'gi');
    let match;
    while ((match = regex.exec(textContent)) !== null) {
      let name = cleanExtractedName(match[1]);
      if (isRealName(name) && !names.includes(name)) names.push(name);
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

// دالة مساعدة لمعالجة الرد واستخراج النتائج
function parseResponseContent(responseText) {
  try {
    const jsonData = JSON.parse(responseText);
    const names = extractNamesFromJSON(jsonData);
    if (names.length > 0) return { names, source: 'json' };
  } catch (e) {}

  if (responseText && responseText.length >= 20) {
    let names = extractNamesFromResponse(responseText);
    if (names.length > 0) return { names, source: 'html' };
    
    names = extractNamesAlternative(responseText);
    if (names.length > 0) return { names, source: 'alternative' };
  }
  return null;
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

    // ==========================================================
    // 🛡️ [المستوى 1] الكاش المحلي (أسرع استجابة)
    // ==========================================================
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('X-Cache-Level', 'NODE_MEMORY_CACHE')
        .json(cachedData);
    }

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://b.raw2fid.net/calle/?res_id=K${base64Phone}%3D%3D`;
    const timestamp = Date.now();

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

    const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;

    // ==========================================================
    // ⚡ [المستوى 2] الجلب المتوازي السريع (المباشر + ScrapingAPI معاً)
    // ==========================================================
    console.log('⚡ إرسال الطلبات بشكل متوازي لتسريع الاستجابة...');

    // مهمة الجلب المباشر مع تحديد مهلة زمنية قصيرة (Timeout 4 ثواني) لتجنب التعليق
    const directFetchPromise = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(targetUrl, { method: 'GET', headers: browserHeaders, signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
          const text = await response.text();
          const parsed = parseResponseContent(text);
          if (parsed && parsed.names.length > 0) {
            return { names: parsed.names, source: `direct_${parsed.source}` };
          }
        }
      } catch (e) {
        clearTimeout(timeoutId);
      }
      throw new Error('Direct fetch failed');
    })();

    // مهمة جلب ScrapingAPI
    const scrapingApiPromise = (async () => {
      if (!SCRAPINGAPI_API_KEY) throw new Error('No ScrapingAPI key');
      const scrapingApiUrl = new URL('https://api.scraperapi.com/');
      scrapingApiUrl.searchParams.append('api_key', SCRAPINGAPI_API_KEY);
      scrapingApiUrl.searchParams.append('url', targetUrl);
      scrapingApiUrl.searchParams.append('render', 'false');       
      scrapingApiUrl.searchParams.append('premium_proxy', 'false');   
      scrapingApiUrl.searchParams.append('forward_headers', 'true');

      const response = await fetch(scrapingApiUrl.toString(), { method: 'GET', headers: browserHeaders });
      if (response.ok) {
        const text = await response.text();
        const parsed = parseResponseContent(text);
        if (parsed && parsed.names.length > 0) {
          return { names: parsed.names, source: `scrapingapi_${parsed.source}` };
        }
      }
      throw new Error('ScrapingAPI failed');
    })();

    let searchResult = null;
    try {
      // استخدام Promise.any لأخذ أسرع نتيجة ناجحة فوراً
      searchResult = await Promise.any([directFetchPromise, scrapingApiPromise]);
    } catch (aggregateError) {
      // إذا فشلا معاً، نحاول الانتظار بشكل احتياطي لـ ScrapingAPI لوحده كحل أخخير
      try {
        searchResult = await scrapingApiPromise;
      } catch (e) {
        // فشل الجميع
      }
    }

    // ==========================================================
    // 📊 معالجة النتيجة النهائية
    // ==========================================================
    if (!searchResult || searchResult.names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج'
      });
    }

    const results = searchResult.names.map(name => ({
      name: name,
      phone: databasePhone,
      source: searchResult.source.includes('scrapingapi') ? 'ScrapingAPI' : 'مباشر',
      provider: provider,
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      source: searchResult.source,
      cached_at: new Date().toISOString()
    };

    // حفظ النتيجة في الكاش لتكون فورية في المرات القادمة
    await cache.put(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
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
});

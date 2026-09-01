const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// 📊 نظام الكاش المحسن - 7 أيام
// ==========================================================
class MemoryCache {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 604800, checkperiod: 604800 });
    this.userCache = new Map(); // كاش لكل مستخدم
  }

  match(requestKey) {
    return this.cache.get(requestKey) || null;
  }

  put(requestKey, responseData) {
    this.cache.set(requestKey, responseData);
  }

  // كاش للمستخدمين الفرديين (لمدة 5 دقائق)
  getUserCache(userKey) {
    const data = this.userCache.get(userKey);
    if (data && Date.now() - data.timestamp < 300000) { // 5 دقائق
      return data.value;
    }
    this.userCache.delete(userKey);
    return null;
  }

  setUserCache(userKey, value) {
    this.userCache.set(userKey, {
      value,
      timestamp: Date.now()
    });
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
    res.status(429).send(rateLimiter.message);
  }
});

const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "1432f28f4c66602b7020a6f1bf5fd9ba";
const cache = new MemoryCache();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

app.get('/ping', (req, res) => res.status(200).send('OK'));

// ==========================================================
// 🌍 خريطة مفاتيح دول العالم (موسعة)
// ==========================================================
const COUNTRY_CODES = [
  // الدول العربية
  { code: '967', country: 'اليمن', minLength: 9 },
  { code: '966', country: 'السعودية', minLength: 9 },
  { code: '20', country: 'مصر', minLength: 10 },
  { code: '971', country: 'الإمارات', minLength: 9 },
  { code: '965', country: 'الكويت', minLength: 8 },
  { code: '968', country: 'عُمان', minLength: 8 },
  { code: '974', country: 'قطر', minLength: 8 },
  { code: '973', country: 'البحرين', minLength: 8 },
  { code: '962', country: 'الأردن', minLength: 9 },
  { code: '961', country: 'لبنان', minLength: 8 },
  { code: '963', country: 'سوريا', minLength: 9 },
  { code: '964', country: 'العراق', minLength: 10 },
  { code: '970', country: 'فلسطين', minLength: 9 },
  { code: '212', country: 'المغرب', minLength: 9 },
  { code: '213', country: 'الجزائر', minLength: 9 },
  { code: '216', country: 'تونس', minLength: 8 },
  { code: '218', country: 'ليبيا', minLength: 9 },
  { code: '249', country: 'السودان', minLength: 9 },
  // دول أخرى
  { code: '1', country: 'أمريكا / كندا', minLength: 10 },
  { code: '44', country: 'بريطانيا', minLength: 10 },
  { code: '90', country: 'تركيا', minLength: 10 },
  { code: '91', country: 'الهند', minLength: 10 },
  { code: '86', country: 'الصين', minLength: 11 },
  { code: '81', country: 'اليابان', minLength: 10 },
  { code: '49', country: 'ألمانيا', minLength: 10 },
  { code: '33', country: 'فرنسا', minLength: 9 },
  { code: '39', country: 'إيطاليا', minLength: 10 },
  { code: '34', country: 'إسبانيا', minLength: 9 },
  { code: '61', country: 'أستراليا', minLength: 9 },
  { code: '55', country: 'البرازيل', minLength: 10 },
  { code: '7', country: 'روسيا', minLength: 10 },
  { code: '82', country: 'كوريا الجنوبية', minLength: 10 },
  { code: '31', country: 'هولندا', minLength: 9 },
  { code: '32', country: 'بلجيكا', minLength: 9 },
  { code: '41', country: 'سويسرا', minLength: 9 },
  { code: '46', country: 'السويد', minLength: 9 },
  { code: '47', country: 'النرويج', minLength: 8 },
  { code: '45', country: 'الدنمارك', minLength: 8 },
  { code: '358', country: 'فنلندا', minLength: 9 },
  { code: '30', country: 'اليونان', minLength: 10 },
  { code: '351', country: 'البرتغال', minLength: 9 },
  { code: '353', country: 'أيرلندا', minLength: 9 },
  { code: '27', country: 'جنوب أفريقيا', minLength: 9 },
  { code: '234', country: 'نيجيريا', minLength: 10 },
  { code: '254', country: 'كينيا', minLength: 9 },
  { code: '92', country: 'باكستان', minLength: 10 },
  { code: '94', country: 'سريلانكا', minLength: 9 },
  { code: '60', country: 'ماليزيا', minLength: 9 },
  { code: '62', country: 'إندونيسيا', minLength: 10 },
  { code: '63', country: 'الفلبين', minLength: 10 },
  { code: '66', country: 'تايلاند', minLength: 9 },
  { code: '84', country: 'فيتنام', minLength: 9 },
  { code: '880', country: 'بنغلاديش', minLength: 10 },
  { code: '977', country: 'نيبال', minLength: 10 },
  { code: '98', country: 'إيران', minLength: 10 },
  { code: '48', country: 'بولندا', minLength: 9 },
  { code: '420', country: 'التشيك', minLength: 9 },
  { code: '36', country: 'المجر', minLength: 9 },
  { code: '40', country: 'رومانيا', minLength: 9 },
  { code: '356', country: 'مالطا', minLength: 8 },
  { code: '357', country: 'قبرص', minLength: 8 }
];

const STOP_WORDS = new Set([
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم',
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'شيوعا', 'اليمن',
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false',
  'غير', 'معروف', 'محدد', 'مؤكد', 'مؤكدة', 'معلومات', 'اتصال', 'هاتف'
]);

// ==========================================================
// 🎯 دوال التحقق والتنظيف المحسنة
// ==========================================================
function isRealName(name) {
  if (!name || name.length < 2) return false;
  if (/^\+?\d+$/.test(name)) return false;
  if (STOP_WORDS.has(name.trim().toLowerCase())) return false;
  // اسم يجب أن يحتوي على أحرف عربية أو إنجليزية على الأقل
  return /[\u0600-\u06FFa-zA-Z]/.test(name) && name.length >= 2;
}

function cleanExtractedName(name) {
  if (!name) return '';
  return name
    .replace(/عدد\s*السجلات\s*المكتشفة|هذا\s*الاسم\s*هو\s*الأكثر\s*شيوعاً\s*لهذا\s*الرقم|نتائج\s*البحث\s*للرقم|[\\{}{}\[\]"':\-_,\/|\.]/gi, ' ')
    .replace(/\b(عدد|السجلات|المكتشفة|الأكثر|شيوعا|شيوعاً|لهذا|الرقم|يرجى|الانتظار|البحث|نتائج|اسم|الشهرة|هاتف|ثابت|غير|معروف|مؤكد)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==========================================================
// 🌐 دوال معالجة الأرقام الدولية
// ==========================================================
function detectCountryAndProvider(fullPhone) {
  // إزالة علامة + إذا وجدت
  let cleanPhone = fullPhone.replace(/^\+/, '');
  
  // ترتيب الكود حسب الطول (من الأطول للأقصر)
  const sortedCodes = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  
  for (const item of sortedCodes) {
    if (cleanPhone.startsWith(item.code)) {
      const remaining = cleanPhone.substring(item.code.length);
      // التحقق من أن الطول مناسب
      if (remaining.length >= item.minLength) {
        return {
          country: item.country,
          code: item.code,
          nationalNumber: remaining,
          fullInternational: '+' + cleanPhone
        };
      }
    }
  }
  
  // إذا لم يتم التعرف على الدولة
  return {
    country: 'دولي',
    code: '',
    nationalNumber: cleanPhone,
    fullInternational: '+' + cleanPhone
  };
}

function formatPhoneNumber(phoneInput) {
  // تنظيف الرقم من الرموز غير الرقمية
  let raw = String(phoneInput).replace(/[^0-9+]/g, '');
  
  // إذا كان يبدأ بـ 00 نستبدلها بـ +
  if (raw.startsWith('00')) {
    raw = '+' + raw.substring(2);
  }
  
  // إذا لم يبدأ بـ + نضيفها
  if (!raw.startsWith('+')) {
    raw = '+' + raw;
  }
  
  return raw;
}

// ==========================================================
// 📊 دوال استخراج الأسماء المحسنة
// ==========================================================
function extractNamesFromJSON(jsonData) {
  const names = new Set();
  try {
    const text = typeof jsonData === 'string' ? jsonData : (jsonData.result || JSON.stringify(jsonData));
    if (text) {
      // أنماط متعددة لاستخراج الأسماء
      const patterns = [
        /اسم الشهرة[:\s]+([^\n]+)/i,
        /الاسم[:\s]+([^\n]+)/i,
        /name[:\s]+([^\n]+)/i,
        /صاحب الرقم[:\s]+([^\n]+)/i,
        /owner[:\s]+([^\n]+)/i,
        /full_name[:\s]+([^\n]+)/i,
        /display_name[:\s]+([^\n]+)/i
      ];
      
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          let name = cleanExtractedName(match[1]);
          if (isRealName(name)) names.add(name);
        }
      }

      // استخراج الأسماء من القوائم المرقمة
      const numberedMatches = text.matchAll(/\d+\s*[-–—]\s*([^\d\n]+)/g);
      for (const match of numberedMatches) {
        let name = cleanExtractedName(match[1]);
        if (isRealName(name)) names.add(name);
      }
      
      // استخراج الأسماء من JSON
      try {
        const obj = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        if (obj && typeof obj === 'object') {
          const searchInObject = (obj) => {
            for (const key in obj) {
              if (typeof obj[key] === 'string' && isRealName(obj[key])) {
                names.add(obj[key]);
              } else if (typeof obj[key] === 'object') {
                searchInObject(obj[key]);
              }
            }
          };
          searchInObject(obj);
        }
      } catch (e) {}
    }
  } catch (e) {}
  return Array.from(names).slice(0, 200);
}

function extractNamesFromResponse(html) {
  const names = new Set();
  const patterns = [
    /(?:name|اسم|صاحب|owner|full_name|display_name)\s*[:.\-]\s*([^\d\n<>]{2,50})/gi,
    /(\d+)\s*[-–—]\s*([^\d\n<]{2,50})/g,
    /<[^>]*>\s*([\u0600-\u06FFa-zA-Z\s]{3,30})\s*<\/[^>]*>/g
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const name = cleanExtractedName(match[1] || match[2]);
      if (isRealName(name)) names.add(name);
    }
  }
  
  return Array.from(names).slice(0, 200);
}

// ==========================================================
// ⏱️ دوال الجلب المحسنة
// ==========================================================
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
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

// ==========================================================
// 🚀 نظام إدارة الطلبات (لتقليل الاستهلاك)
// ==========================================================
const pendingRequests = new Map();
const requestQueue = [];
let isProcessing = false;
const MAX_CONCURRENT = 3;

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const { requestFn, resolve, reject, key } = requestQueue.shift();
  
  try {
    const result = await requestFn();
    resolve(result);
    // حذف من الطلبات المعلقة
    pendingRequests.delete(key);
  } catch (error) {
    reject(error);
    pendingRequests.delete(key);
  } finally {
    isProcessing = false;
    processQueue();
  }
}

function addToQueue(key, requestFn) {
  return new Promise((resolve, reject) => {
    // إذا كان الطلب نفسه قيد المعالجة
    if (pendingRequests.has(key)) {
      pendingRequests.get(key).then(resolve).catch(reject);
      return;
    }
    
    // إضافة إلى قائمة الانتظار
    requestQueue.push({ requestFn, resolve, reject, key });
    pendingRequests.set(key, new Promise((res, rej) => {
      // سيتم حلها من خلال قائمة الانتظار
      const originalResolve = resolve;
      const originalReject = reject;
      resolve = (value) => {
        originalResolve(value);
        res(value);
      };
      reject = (error) => {
        originalReject(error);
        rej(error);
      };
    }));
    
    processQueue();
  });
}

// ==========================================================
// 🚀 Endpoint الرئيسي المحسن
// ==========================================================
app.all('/api/search', rateLimiter, async (req, res) => {
  try {
    const query = req.method === 'GET' ? req.query.query : req.body.query;
    const clientIP = req.headers['cf-connecting-ip'] || 
                     req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     req.ip || 
                     'anonymous';

    if (!query) {
      return res.status(200).json({ 
        success: false, 
        results: [], 
        total: 0, 
        error: 'البحث فارغ' 
      });
    }

    // ==========================================================
    // 📱 معالجة الرقم الدولي
    // ==========================================================
    const formattedPhone = formatPhoneNumber(query);
    const phoneInfo = detectCountryAndProvider(formattedPhone);
    
    // التحقق من صحة الرقم
    if (phoneInfo.nationalNumber.length < 4) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'رقم غير صحيح أو غير مكتمل'
      });
    }

    // مفتاح الكاش الموحد
    const cacheKey = `phone_${phoneInfo.fullInternational}`;
    
    // ==========================================================
    // 📊 التحقق من الكاش
    // ==========================================================
    
    // 1. الكاش العام
    const cachedData = cache.match(cacheKey);
    if (cachedData) {
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('Cache-Control', 'public, max-age=86400')
        .json(cachedData);
    }
    
    // 2. كاش المستخدم
    const userCacheKey = `${clientIP}_${cacheKey}`;
    const userCached = cache.getUserCache(userCacheKey);
    if (userCached) {
      return res.status(200)
        .set('X-Cache-Status', 'USER-HIT')
        .set('Cache-Control', 'public, max-age=300')
        .json(userCached);
    }

    // ==========================================================
    // 🔍 تحديد مصدر البيانات حسب الدولة
    // ==========================================================
    let targetUrl;
    let provider = phoneInfo.country;
    
    // معالجة خاصة لليمن
    if (phoneInfo.code === '967') {
      const cleanYemen = phoneInfo.nationalNumber;
      const base64Phone = Buffer.from(cleanYemen).toString('base64');
      const dynamicReferer = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
      targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${cleanYemen}&nocache=${Date.now()}`;
      
      // تحديد مزود الخدمة في اليمن
      if (/^(77|78)[0-9]{7}$/.test(cleanYemen)) provider = 'يمن موبايل';
      else if (/^(73)[0-9]{7}$/.test(cleanYemen)) provider = 'YOU';
      else if (/^(71)[0-9]{7}$/.test(cleanYemen)) provider = 'سبأفون';
      else if (/^(70)[0-9]{7}$/.test(cleanYemen)) provider = 'واي';
    } else {
      // للدول الأخرى - استخدام محرك بحث عام
      const encodedPhone = encodeURIComponent(phoneInfo.fullInternational);
      targetUrl = `https://api.scraperapi.com/search?query=${encodedPhone}+phone+number+owner&country=${phoneInfo.code}`;
    }

    // ==========================================================
    // 🚀 تنفيذ الطلب من خلال نظام الانتظار
    // ==========================================================
    const searchFn = async () => {
      if (!SCRAPINGAPI_API_KEY) {
        throw new Error('مفتاح ScraperAPI غير مضبوط');
      }

      const scrapingApiUrl = `https://api.scraperapi.com/?api_key=${SCRAPINGAPI_API_KEY}&url=${encodeURIComponent(targetUrl)}&render=false&timeout=5000`;
      
      const browserHeaders = {
        'accept': '*/*',
        'accept-language': 'ar,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
      };
      
      // إضافة referer للدول التي تحتاجها
      if (phoneInfo.code === '967') {
        const cleanYemen = phoneInfo.nationalNumber;
        const base64Phone = Buffer.from(cleanYemen).toString('base64');
        browserHeaders['referer'] = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
      }

      const response = await fetchWithTimeout(scrapingApiUrl, { 
        method: 'GET', 
        headers: browserHeaders 
      }, 5000);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const responseContent = await response.text();
      let extracted;
      
      try {
        extracted = extractNamesFromJSON(JSON.parse(responseContent));
      } catch {
        extracted = extractNamesFromResponse(responseContent);
      }
      
      return extracted;
    };

    let names = [];
    let success = false;
    
    try {
      names = await addToQueue(cacheKey, searchFn);
      if (names && names.length > 0) {
        success = true;
      }
    } catch (e) {
      // فشل الطلب
    }

    // ==========================================================
    // 📊 تجهيز النتائج
    // ==========================================================
    if (!success || names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج',
        phone: phoneInfo.fullInternational,
        country: phoneInfo.country
      });
    }

    const results = names.map(name => ({
      name,
      phone: phoneInfo.fullInternational,
      nationalNumber: phoneInfo.nationalNumber,
      country: phoneInfo.country,
      provider: provider,
      source: 'ScrapingAPI',
      formattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    const finalResponseData = {
      success: true,
      results,
      total: results.length,
      phone: phoneInfo.fullInternational,
      country: phoneInfo.country,
      provider: provider,
      source: 'scrapingapi',
      cached_at: new Date().toISOString()
    };

    // ==========================================================
    // 💾 حفظ في الكاش
    // ==========================================================
    cache.put(cacheKey, finalResponseData);
    cache.setUserCache(userCacheKey, finalResponseData);

    // إضافة هيدرات الكاش
    res.setHeader('X-Cache-Status', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    return res.status(200).json(finalResponseData);

  } catch (e) {
    return res.status(500).json({ 
      success: false, 
      results: [], 
      total: 0, 
      error: e.message || 'خطأ في الخادم' 
    });
  }
});

// ==========================================================
// 🚀 تشغيل الخادم
// ==========================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Supports international phone numbers`);
  console.log(`🌍 ${COUNTRY_CODES.length} countries supported`);
});

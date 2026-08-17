const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// 📊 نظام الكاش (في الذاكرة - أسرع)
// ==========================================================
const cache = new Map();

function setCache(key, data, ttl = 3600000) {
  cache.set(key, data);
  setTimeout(() => cache.delete(key), ttl);
}

// ==========================================================
// 📊 نظام تحديد المعدل (Rate Limiting)
// ==========================================================
const rateLimiter = rateLimit({
  windowMs: 2000,
  max: 3,
  message: {
    success: false,
    results: [],
    total: 0,
    error: 'مهلاً! الرجاء الانتظار',
    message: '⏳ يرجى الانتظار 2 ثواني بين عمليات البحث'
  },
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
// 🌐 متغيرات البيئة
// ==========================================================
const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "";

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
// 📝 دوال استخراج وتنظيف الأسماء (مدمجة من الكودين)
// ==========================================================

const STOP_WORDS = [
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم', 
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'اليمن', 
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false',
  'loading', 'please', 'wait', 'error', 'success'
];

function isRealName(name) {
  if (!name || name.length < 3) return false;
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
    .replace(/[\\{}{}\[\]"':\-_,\/]/g, ' ')
    .replace(/\b(info|country|n|null|undefined|الرقم|اسم|search|phone|نتائج|البحث|للرقم|الشهرة|السجلات|المكتشفة|الأكثر|شيوعاً|اليمن|من|هذا|هذه|كان|مع|عن|على|الى|حتى|بين|أو|و|ف|في|إلى|على|عن|من|إلى|عند|ب|ك|ل|لل|و|ثم|حتى|لكن|ولا|أو|ثم|حيث|بين|عندما|ذلك|هذه|هذا|التي|الذي|الذين|اللاتي|اللواتي|منذ|خلال|بسبب|دون|بينما|حيثما|كلما|متى|أين|كيف|إذا|لن|لم|ما|لا|ليس|سوف|قد|ربما|لعل|ليت|لابد|لعل|لكي|كي|حتّى|حتى|loading|please|wait|error|success)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==========================================================
// 🔥 دالة استخراج محسنة (تجمع كل الطرق)
// ==========================================================
function extractAllNames(text) {
  const names = [];
  
  if (!text || text.length < 10) return names;
  
  // 1️⃣ استخراج من JSON
  try {
    const jsonData = JSON.parse(text);
    const jsonText = jsonData.result || JSON.stringify(jsonData);
    
    // اسم الشهرة (من الكود القديم)
    const fameMatch = jsonText.match(/اسم الشهرة[:\s]+([^\n]+)/);
    if (fameMatch) {
      let name = cleanExtractedName(fameMatch[1]);
      if (isRealName(name) && !names.includes(name)) names.push(name);
    }
    
    // الأرقام المرقمة
    const numberedMatches = jsonText.match(/\d+\s*[-–—]\s*([^\d\n]+)/g);
    if (numberedMatches) {
      numberedMatches.forEach(m => {
        const nameMatch = m.match(/\d+\s*[-–—]\s*([^\d\n]+)/);
        if (nameMatch) {
          let name = cleanExtractedName(nameMatch[1]);
          if (isRealName(name) && !names.includes(name)) names.push(name);
        }
      });
    }
    
    // name: value (من الكود الجديد)
    const nameValueMatches = jsonText.match(/name[:\s]+([^\n,]+)/gi);
    if (nameValueMatches) {
      nameValueMatches.forEach(m => {
        const nameMatch = m.match(/name[:\s]+([^\n,]+)/i);
        if (nameMatch) {
          let name = cleanExtractedName(nameMatch[1]);
          if (isRealName(name) && !names.includes(name)) names.push(name);
        }
      });
    }
  } catch (e) {
    // ليس JSON، نكمل مع HTML
  }
  
  // 2️⃣ استخراج من HTML
  const html = typeof text === 'string' ? text : JSON.stringify(text);
  
  // الأرقام المرقمة
  const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  let match;
  while ((match = numberedPattern.exec(html)) !== null) {
    let name = cleanExtractedName(match[2]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  // علامات name
  const nameTags = /<[^>]*name[^>]*>([^<]+)<\/[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = nameTags.exec(html)) !== null) {
    let name = cleanExtractedName(tagMatch[1]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  // 3️⃣ استخراج بديل (من الكود القديم)
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  
  const keywords = ['اسم', 'الاسم', 'name', 'user', 'contact', 'صاحب', 'مالك', 'الشهرة', 'المستخدم', 'العميل', 'owner', 'fullname'];
  for (const keyword of keywords) {
    const regex = new RegExp(`${keyword}[\\s:]*([^\\n<,]+)`, 'gi');
    let kwMatch;
    while ((kwMatch = regex.exec(textContent)) !== null) {
      let name = cleanExtractedName(kwMatch[1]);
      if (isRealName(name) && !names.includes(name)) names.push(name);
    }
  }
  
  // 4️⃣ استخراج كلمات عربية (من الكود الجديد)
  const arabicWords = textContent.match(/[\u0600-\u06FF]{3,}/g);
  if (arabicWords) {
    arabicWords.forEach(word => {
      if (!STOP_WORDS.includes(word.toLowerCase()) && word.length >= 3) {
        let name = cleanExtractedName(word);
        if (isRealName(name) && !names.includes(name)) names.push(name);
      }
    });
  }
  
  // 5️⃣ استخراج من اسم الشهرة في النص العادي (من الكود القديم)
  const fameTextMatch = textContent.match(/اسم الشهرة[:\s]+([^\n]+)/i);
  if (fameTextMatch) {
    let name = cleanExtractedName(fameTextMatch[1]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
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
// 🚀 دالة الجلب مع مهلة زمنية
// ==========================================================
async function fetchWithTimeout(url, options = {}, timeout = 8000, retries = 2) {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
      if (response.status === 429) {
        console.log(`⚠️ تم رفض الطلب (429)، انتظار 2 ثانية والمحاولة مرة أخرى (محاولة ${attempt}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.log(`⚠️ فشل الطلب، إعادة المحاولة (${attempt}/${retries}): ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  throw lastError || new Error('فشل جميع المحاولات');
}

// ==========================================================
// 🚀 Endpoint الرئيسي (محسن وسريع مع استخراج أفضل)
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
    // 🛡️ التحقق من الكاش
    // ==========================================================
    const cacheKey = `phone_${databasePhone}`;
    if (cache.has(cacheKey)) {
      const cachedData = cache.get(cacheKey);
      console.log(`✅ تم العثور على النتيجة في الكاش: ${databasePhone}`);
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('X-Cache-Level', 'MEMORY_CACHE')
        .json(cachedData);
    }

    // ==========================================================
    // 🌐 تجهيز الطلب
    // ==========================================================
    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const timestamp = Date.now();

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
    ];
    
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    const browserHeaders = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'referer': `https://b.raw2fid.net/calle/?res_id=K${base64Phone}%3D%3D`,
      'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': randomUA
    };

    const urls = [
      `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`,
      `https://b.raw2fid.net/calle/?res_id=K${base64Phone}%3D%3D`,
      `https://b.raw2fid.net/search/?phone=${encodeURIComponent(scrapePhone)}`
    ];

    // ==========================================================
    // 🚀 تشغيل المصادر بالتوازي
    // ==========================================================
    let names = [];
    let source = '';

    // دالة الجلب المباشر
    async function tryDirectFetch() {
      for (const url of urls) {
        try {
          console.log(`📡 محاولة جلب: ${url}`);
          const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: browserHeaders
          }, 6000, 2);

          if (response && response.ok) {
            const text = await response.text();
            console.log(`📄 تم استلام رد بطول ${text.length} حرف`);
            
            // استخدام دالة الاستخراج المحسنة
            const extracted = extractAllNames(text);
            
            if (extracted.length > 0) {
              console.log(`✅ استخرج ${extracted.length} اسم من المصدر المباشر`);
              return { names: extracted, source: 'direct' };
            }
          }
        } catch (error) {
          console.log(`⚠️ فشل الرابط ${url}: ${error.message}`);
        }
      }
      return null;
    }

    // دالة ScrapingAPI
    async function tryScrapingAPI() {
      if (!SCRAPINGAPI_API_KEY) return null;

      for (const url of urls) {
        try {
          const scrapingUrl = new URL('https://api.scraperapi.com/');
          scrapingUrl.searchParams.append('api_key', SCRAPINGAPI_API_KEY);
          scrapingUrl.searchParams.append('url', url);
          scrapingUrl.searchParams.append('render', 'false');
          scrapingUrl.searchParams.append('premium_proxy', 'false');
          scrapingUrl.searchParams.append('forward_headers', 'true');

          console.log(`🐝 محاولة ScrapingAPI: ${url}`);
          const response = await fetchWithTimeout(scrapingUrl.toString(), {
            method: 'GET',
            headers: browserHeaders
          }, 8000, 2);

          if (response && response.ok) {
            const text = await response.text();
            
            // استخدام دالة الاستخراج المحسنة
            const extracted = extractAllNames(text);
            
            if (extracted.length > 0) {
              console.log(`✅ استخرج ${extracted.length} اسم من ScrapingAPI`);
              return { names: extracted, source: 'scrapingapi' };
            }
          }
        } catch (error) {
          console.log(`⚠️ فشل ScrapingAPI للرابط: ${error.message}`);
        }
      }
      return null;
    }

    // 🔥 تشغيل المصادر معاً
    console.log(`🔍 البحث عن: ${scrapePhone}`);
    
    const [directResult, scrapingResult] = await Promise.allSettled([
      tryDirectFetch(),
      tryScrapingAPI()
    ]);

    // أخذ النتيجة من أيهما أسرع
    if (directResult.status === 'fulfilled' && directResult.value) {
      names = directResult.value.names;
      source = directResult.value.source;
      console.log(`✅ تم الحصول على ${names.length} اسم من المصدر المباشر`);
    } else if (scrapingResult.status === 'fulfilled' && scrapingResult.value) {
      names = scrapingResult.value.names;
      source = scrapingResult.value.source;
      console.log(`✅ تم الحصول على ${names.length} اسم من ScrapingAPI`);
    }

    // ==========================================================
    // 📊 إذا لم يتم العثور على نتائج
    // ==========================================================
    if (names.length === 0) {
      console.log(`❌ لم يتم العثور على نتائج للرقم: ${scrapePhone}`);
      
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج'
      });
    }

    // ==========================================================
    // 📊 تجهيز النتيجة
    // ==========================================================
    const results = names.map(name => ({
      name: name,
      phone: databasePhone,
      source: source.includes('scrapingapi') ? 'ScrapingAPI' : 'مباشر',
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

    // ==========================================================
    // 💾 حفظ في الكاش
    // ==========================================================
    setCache(cacheKey, finalResponseData);
    console.log(`💾 تم حفظ النتيجة في الكاش: ${databasePhone}`);

    return res.status(200)
      .set('X-Cache-Status', 'MISS')
      .json(finalResponseData);

  } catch (error) {
    console.error('❌ خطأ:', error);
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: error.message
    });
  }
});

// ==========================================================
// 🚀 تشغيل الخادم
// ==========================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 تشغيل خادم Node.js على المنفذ ${PORT}`);
  console.log(`📊 نظام الكاش جاهز (سعة: غير محدودة)`);
  console.log(`⏱️ مهلة الطلب: 6-8 ثواني`);
  console.log(`🔄 عدد محاولات إعادة الطلب: 2`);
  console.log(`📡 عدد الروابط للمحاولة: 3`);
  console.log(`✨ تم دمج جميع طرق الاستخراج للحصول على أقصى نتائج`);
});

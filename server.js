const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// 📊 نظام الكاش (في الذاكرة)
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
// 📝 دوال استخراج وتنظيف الأسماء (محسنة)
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

function extractNamesFromJSON(jsonData) {
  const names = [];
  try {
    let text = '';
    if (typeof jsonData === 'string') {
      text = jsonData;
    } else if (jsonData.result) {
      text = typeof jsonData.result === 'string' ? jsonData.result : JSON.stringify(jsonData.result);
    } else {
      text = JSON.stringify(jsonData);
    }
    
    if (text) {
      // محاولة استخراج اسم الشهرة
      const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/i);
      if (fameMatch) {
        let name = cleanExtractedName(fameMatch[1]);
        if (isRealName(name) && !names.includes(name)) names.push(name);
      }
      
      // محاولة استخراج من الأرقام المرقمة
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
      
      // محاولة استخراج من صيغة name: value
      const nameValueMatches = text.match(/name[:\s]+([^\n,]+)/gi);
      if (nameValueMatches) {
        nameValueMatches.forEach(m => {
          const nameMatch = m.match(/name[:\s]+([^\n,]+)/i);
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
  
  // نمط الأرقام المرقمة
  const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  let match;
  while ((match = numberedPattern.exec(html)) !== null) {
    let name = cleanExtractedName(match[2]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  // نمط العلامات
  const nameTags = /<[^>]*name[^>]*>([^<]+)<\/[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = nameTags.exec(html)) !== null) {
    let name = cleanExtractedName(tagMatch[1]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  // البحث عن اسم في النص العادي
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const namePattern = /(?:اسم|الاسم|name)\s*[:]\s*([^\n,]+)/gi;
  let nameMatch;
  while ((nameMatch = namePattern.exec(textContent)) !== null) {
    let name = cleanExtractedName(nameMatch[1]);
    if (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  return [...new Set(names)].slice(0, 200);
}

function extractNamesAlternative(html) {
  const names = [];
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  
  const keywords = ['اسم', 'الاسم', 'name', 'user', 'contact', 'صاحب', 'مالك', 'الشهرة', 'المستخدم', 'العميل', 'owner', 'fullname'];
  for (const keyword of keywords) {
    const regex = new RegExp(`${keyword}[\\s:]*([^\\n<,]+)`, 'gi');
    let match;
    while ((match = regex.exec(textContent)) !== null) {
      let name = cleanExtractedName(match[1]);
      if (isRealName(name) && !names.includes(name)) names.push(name);
    }
  }
  
  // محاولة استخراج أي كلمات عربية تبدو كأسماء
  const arabicWords = textContent.match(/[\u0600-\u06FF]{3,}/g);
  if (arabicWords) {
    arabicWords.forEach(word => {
      if (!STOP_WORDS.includes(word.toLowerCase()) && word.length >= 3) {
        let name = cleanExtractedName(word);
        if (isRealName(name) && !names.includes(name)) names.push(name);
      }
    });
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
// 🚀 دالة الجلب مع مهلة زمنية وإعادة المحاولة
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
      
      // إذا كان الرد 429 (Too Many Requests)، انتظر ثم حاول مرة أخرى
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
// 🚀 Endpoint الرئيسي (محسن)
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

    // مجموعة من الـ User-Agents لتجنب الحظر
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

    // روابط متعددة للمحاولة
    const urls = [
      `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`,
      `https://b.raw2fid.net/calle/?res_id=K${base64Phone}%3D%3D`,
      `https://b.raw2fid.net/search/?phone=${encodeURIComponent(scrapePhone)}`
    ];

    // ==========================================================
    // 🚀 تشغيل المصادر بالتوازي مع إعادة المحاولة
    // ==========================================================
    let names = [];
    let source = '';

    // دالة الجلب المباشر مع محاولة روابط متعددة
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
            
            let extracted = [];

            // محاولة parse كـ JSON
            try {
              const json = JSON.parse(text);
              extracted = extractNamesFromJSON(json);
              if (extracted.length > 0) {
                console.log(`✅ استخرج ${extracted.length} اسم من JSON`);
                return { names: extracted, source: 'direct_json' };
              }
            } catch (e) {
              console.log('⚠️ ليس JSON صحيح، محاولة استخراج من HTML');
            }

            // محاولة استخراج من HTML
            extracted = extractNamesFromResponse(text);
            if (extracted.length > 0) {
              console.log(`✅ استخرج ${extracted.length} اسم من HTML`);
              return { names: extracted, source: 'direct_html' };
            }

            // محاولة استخراج بديل
            extracted = extractNamesAlternative(text);
            if (extracted.length > 0) {
              console.log(`✅ استخرج ${extracted.length} اسم من النص البديل`);
              return { names: extracted, source: 'direct_alternative' };
            }
          }
        } catch (error) {
          console.log(`⚠️ فشل الرابط ${url}: ${error.message}`);
        }
      }
      return null;
    }

    // دالة ScrapingAPI مع روابط متعددة
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
            let extracted = [];

            try {
              const json = JSON.parse(text);
              extracted = extractNamesFromJSON(json);
              if (extracted.length > 0) {
                console.log(`✅ استخرج ${extracted.length} اسم من ScrapingAPI JSON`);
                return { names: extracted, source: 'scrapingapi_json' };
              }
            } catch (e) {}

            extracted = extractNamesFromResponse(text);
            if (extracted.length > 0) {
              console.log(`✅ استخرج ${extracted.length} اسم من ScrapingAPI HTML`);
              return { names: extracted, source: 'scrapingapi_html' };
            }

            extracted = extractNamesAlternative(text);
            if (extracted.length > 0) {
              console.log(`✅ استخرج ${extracted.length} اسم من ScrapingAPI بديل`);
              return { names: extracted, source: 'scrapingapi_alternative' };
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
    console.log(`📡 عدد الروابط للمحاولة: ${urls.length}`);
    
    const [directResult, scrapingResult] = await Promise.allSettled([
      tryDirectFetch(),
      tryScrapingAPI()
    ]);

    // أخذ النتيجة من أيهما أسرع
    if (directResult.status === 'fulfilled' && directResult.value) {
      names = directResult.value.names;
      source = directResult.value.source;
      console.log(`✅ تم الحصول على ${names.length} اسم من المصدر المباشر (${source})`);
    } else if (scrapingResult.status === 'fulfilled' && scrapingResult.value) {
      names = scrapingResult.value.names;
      source = scrapingResult.value.source;
      console.log(`✅ تم الحصول على ${names.length} اسم من ScrapingAPI (${source})`);
    }

    // ==========================================================
    // 📊 إذا لم يتم العثور على نتائج
    // ==========================================================
    if (names.length === 0) {
      console.log(`❌ لم يتم العثور على نتائج للرقم: ${scrapePhone}`);
      
      // إذا كان الرقم يمني، حاول البحث بدون 967
      if (provider !== 'رقم دولي' && cleanPhone.length >= 9) {
        console.log('🔄 محاولة البحث بصيغة مختلفة...');
        // يمكن إضافة منطق إضافي هنا
      }
      
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج',
        message: '⚠️ قد يكون الرقم غير مسجل أو الموقع لا يستجيب'
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
});

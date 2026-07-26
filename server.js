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
    this.cache = new NodeCache({ stdTTL: 86400, checkperiod: 600 }); // 24 ساعة
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

// إنشاء مثيل الكاش
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
      
      const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
      if (fameMatch) {
        let name = fameMatch[1].trim();
        name = cleanExtractedName(name);
        if (name && name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
          names.push(name);
        }
      }
      
      const numberedMatches = text.match(/\d+\s*[-–—]\s*([^\d\n]+)/g);
      if (numberedMatches) {
        numberedMatches.forEach(m => {
          const nameMatch = m.match(/\d+\s*[-–—]\s*([^\d\n]+)/);
          if (nameMatch) {
            let name = nameMatch[1].trim();
            name = cleanExtractedName(name);
            if (name && name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
              names.push(name);
            }
          }
        });
      }
      
      const arabicPattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,3}/g;
      let arabicMatch;
      while ((arabicMatch = arabicPattern.exec(text)) !== null) {
        let name = arabicMatch[0];
        name = cleanExtractedName(name);
        if (name.length > 2 && !names.includes(name) && !name.includes('ل') && !/^\+?\d+$/.test(name)) {
          names.push(name);
        }
      }
    }
  } catch (e) {
    console.error('خطأ في استخراج الأسماء من JSON:', e);
  }
  
  return [...new Set(names)]
    .filter(name => !/^[\d+\s]+$/.test(name))
    .slice(0, 20);
}

function extractNamesFromResponse(html) {
  const names = [];
  
  const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  let match;
  while ((match = numberedPattern.exec(html)) !== null) {
    let name = match[2];
    name = cleanExtractedName(name);
    if (name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
      names.push(name);
    }
  }
  
  const arabicNamePattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,3}/g;
  let arabicMatch;
  while ((arabicMatch = arabicNamePattern.exec(html)) !== null) {
    let name = arabicMatch[0];
    name = cleanExtractedName(name);
    if (name.length > 2 && !names.includes(name) && !name.includes('ل') && !/^\+?\d+$/.test(name)) {
      names.push(name);
    }
  }
  
  const nameTags = /<[^>]*name[^>]*>([^<]+)<\/[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = nameTags.exec(html)) !== null) {
    let name = tagMatch[1];
    name = cleanExtractedName(name);
    if (name.length > 2 && !names.includes(name) && /[\u0600-\u06FF]/.test(name) && !/^\+?\d+$/.test(name)) {
      names.push(name);
    }
  }
  
  return [...new Set(names)].slice(0, 100);
}

function extractNamesAlternative(html) {
  const names = [];
  
  const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  
  const arabicPattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,2}/g;
  let match;
  while ((match = arabicPattern.exec(textContent)) !== null) {
    let name = match[0];
    name = cleanExtractedName(name);
    if (name.length > 2 && !names.includes(name) && !name.includes('ل') && name.length < 30 && !/^\+?\d+$/.test(name)) {
      names.push(name);
    }
  }
  
  const keywords = ['اسم', 'الاسم', 'name', 'user', 'contact', 'صاحب', 'مالك', 'الشهرة', 'المستخدم', 'العميل'];
  for (const keyword of keywords) {
    const regex = new RegExp(`${keyword}[\\s:]*([^\\n<,]+)`, 'gi');
    let match;
    while ((match = regex.exec(textContent)) !== null) {
      let name = match[1];
      name = cleanExtractedName(name);
      if (name.length > 2 && !names.includes(name) && /[\u0600-\u06FF]/.test(name) && !/^\+?\d+$/.test(name)) {
        names.push(name);
      }
    }
  }
  
  const pattern = /\d+[\s-]+([\u0600-\u06FF\s]+)/g;
  let patternMatch;
  while ((patternMatch = pattern.exec(textContent)) !== null) {
    let name = patternMatch[1];
    name = cleanExtractedName(name);
    if (name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
      names.push(name);
    }
  }
  
  return [...new Set(names)].slice(0, 50);
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
    // --- 1. جلب معلمة البحث ---
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

    // --- 2. تنظيف رقم الهاتف ---
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
    // 🛡️ [المستوى 1] الكاش المحلي
    // ==========================================================
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('X-Cache-Level', 'NODE_MEMORY_CACHE')
        .json(cachedData);
    }

    // ==========================================================
    // 🌐 [المستوى 2] جلب مباشر (بدون Firecrawl وبدون Supabase)
    // ==========================================================
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
            } else {
              const alternativeNames = extractNamesAlternative(htmlContent);
              if (alternativeNames.length > 0) {
                names = alternativeNames;
                success = true;
                source = 'direct_alternative';
                console.log(`✅ استخراج ${names.length} اسم (طريقة بديلة)`);
              }
            }
          }
        }
      } else {
        console.log(`⚠️ فشل الجلب المباشر: ${response.status}`);
        lastError = `HTTP ${response.status}`;
      }
    } catch (e) {
      console.log(`⚠️ فشل الجلب المباشر: ${e.message}`);
      lastError = e.message;
    }

    // ==========================================================
    // 📊 إذا لم يتم العثور على نتائج - عرض خطأ فقط (بدون بيانات تجريبية)
    // ==========================================================
    if (!success || names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: lastError || 'لم يتم العثور على نتائج',
        debug: {
          phone: scrapePhone,
          provider: provider,
          source: source
        }
      });
    }

    // --- 4. تجهيز النتيجة ---
    const results = names.map(name => ({
      name: name,
      phone: databasePhone,
      source: source.includes('direct') ? 'مباشر' : 'مصدر آخر',
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
      error: e.message,
      stack: e.stack
    });
  }
});

// ==========================================================
// 🚀 تشغيل الخادم
// ==========================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 تشغيل خادم Node.js على المنفذ ${PORT}`);
  console.log('📌 جاهز للاستقبال طلبات البحث (جلب مباشر فقط)');
});

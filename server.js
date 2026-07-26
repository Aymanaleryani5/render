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

  cleanup() {
    // NodeCache يقوم بالتنظيف تلقائياً
  }
}

// ==========================================================
// 📊 نظام تحديد المعدل (Rate Limiting)
// ==========================================================
const rateLimiter = rateLimit({
  windowMs: 5 * 1000, // 5 ثواني
  max: 2, // طلبين لكل IP
  message: JSON.stringify({
    success: false,
    results: [],
    total: 0,
    error: 'مهلاً! الرجاء الانتظار',
    message: '⏳ يرجى الانتظار 5 ثواني بين عمليات البحث'
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
// 🌐 متغيرات البيئة
// ==========================================================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qfcsaiyuyxhibidrrmha.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// إنشاء مثيلات
const cache = new MemoryCache();

console.log('🚀 جاري تشغيل الخادم...');
console.log(`📡 Supabase: ${SUPABASE_ANON_KEY ? '✅ متاح' : '❌ غير متاح'}`);

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
// 📝 دوال استخراج الأسماء - محسنة
// ==========================================================

function extractNamesFromHTML(html) {
  const names = [];
  
  try {
    // تنظيف HTML من العلامات
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    
    // 1. البحث عن أسماء بعد أرقام (1. اسم, 2. اسم, الخ)
    const numberedPattern = /(\d+)[\s\.\-–—]+([^\d\n\.]+?)(?=\s*\d+[\s\.\-–—]|$)/g;
    let match;
    while ((match = numberedPattern.exec(text)) !== null) {
      let name = match[2].trim();
      name = cleanName(name);
      if (name && name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
        names.push(name);
      }
    }
    
    // 2. البحث عن "اسم الشهرة" أو "الاسم"
    const namePatterns = [
      /اسم\s*الشهرة\s*[:\-–—]\s*([^\n]+)/i,
      /الاسم\s*[:\-–—]\s*([^\n]+)/i,
      /name\s*[:\-–—]\s*([^\n]+)/i,
      /صاحب\s*الرقم\s*[:\-–—]\s*([^\n]+)/i
    ];
    
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match) {
        let name = match[1].trim();
        name = cleanName(name);
        if (name && name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
          names.push(name);
        }
      }
    }
    
    // 3. البحث عن أسماء عربية (3 كلمات فأكثر)
    const arabicPattern = /[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,3}/g;
    let arabicMatch;
    while ((arabicMatch = arabicPattern.exec(text)) !== null) {
      let name = arabicMatch[0].trim();
      name = cleanName(name);
      if (name.length > 3 && !names.includes(name) && !name.includes('ل') && !/^\+?\d+$/.test(name)) {
        names.push(name);
      }
    }
    
    // 4. البحث عن أسماء في JSON داخل HTML
    const jsonMatch = text.match(/\{.*?\}/);
    if (jsonMatch) {
      try {
        const jsonData = JSON.parse(jsonMatch[0]);
        if (jsonData.name || jsonData.username || jsonData.full_name) {
          let name = jsonData.name || jsonData.username || jsonData.full_name;
          name = cleanName(name);
          if (name && name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
            names.push(name);
          }
        }
      } catch (e) {}
    }
    
  } catch (e) {
    console.error('خطأ في استخراج الأسماء:', e);
  }
  
  return [...new Set(names)]
    .filter(name => name.length > 2 && name.length < 50)
    .slice(0, 20);
}

function extractNamesFromJSON(jsonData) {
  const names = [];
  
  try {
    // إذا كان JSON يحتوي على result كنص
    if (jsonData.result && typeof jsonData.result === 'string') {
      const text = jsonData.result;
      const extracted = extractNamesFromHTML(text);
      names.push(...extracted);
    }
    
    // إذا كان JSON يحتوي على data array
    if (jsonData.data && Array.isArray(jsonData.data)) {
      jsonData.data.forEach(item => {
        if (item.name || item.full_name || item.username || item.contact_name) {
          let name = item.name || item.full_name || item.username || item.contact_name;
          name = cleanName(name);
          if (name && name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
            names.push(name);
          }
        }
      });
    }
    
    // البحث المباشر في JSON
    const jsonString = JSON.stringify(jsonData);
    const extracted = extractNamesFromHTML(jsonString);
    names.push(...extracted);
    
  } catch (e) {
    console.error('خطأ في استخراج الأسماء من JSON:', e);
  }
  
  return [...new Set(names)]
    .filter(name => name.length > 2 && name.length < 50)
    .slice(0, 20);
}

function cleanName(name) {
  if (!name) return '';
  return name
    .replace(/[\\{}{}\[\]"':\-_,\/]/g, ' ')
    .replace(/\b(info|country|n|null|undefined|الرقم|اسم|search|phone|نتائج|البحث|للرقم|الشهرة|السجلات|المكتشفة|الأكثر|شيوعاً|اليمن|من|هذا|هذه|كان|مع|عن|على|الى|حتى|بين|أو|و|ف|في|إلى|على|عن|من|إلى|عند|ب|ك|ل|لل|و|ثم|حتى|لكن|ولا|أو|ثم|حيث|بين|عندما|ذلك|هذه|هذا|التي|الذي|الذين|اللاتي|اللواتي|منذ|خلال|بسبب|دون|بينما|حيثما|كلما|متى|أين|كيف|إذا|لن|لم|ما|لا|ليس|سوف|قد|ربما|لعل|ليت|لابد|لعل|لكي|كي|حتّى|حتى|بعد|قبل|عند|خلال|بين|مع|عن|على|من|إلى|في|و|أو|ثم|لكن|حيث|بينما|حيثما|كلما|متى|أين|كيف|إذا|لن|لم|ما|لا|ليس|سوف|قد|ربما|لعل|ليت|لابد)\b/gi, '')
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
// 🚀 دالة الجلب من raw2fid.net (محسنة)
// ==========================================================
async function fetchFromRaw2Fid(phone) {
  try {
    console.log(`🔄 محاولة الجلب من raw2fid.net للرقم: ${phone}`);
    
    const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(phone)}`;
    console.log(`📡 URL: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'ar,en;q=0.9',
        'Referer': 'https://b.raw2fid.net/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    console.log(`📊 استجابة raw2fid: ${response.status}`);
    
    if (!response.ok) {
      console.log(`⚠️ فشل raw2fid: ${response.status}`);
      return null;
    }
    
    const contentType = response.headers.get('content-type') || '';
    console.log(`📄 Content-Type: ${contentType}`);
    
    let data;
    let names = [];
    
    // محاولة كـ JSON أولاً
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
        console.log('✅ تم استلام JSON من raw2fid');
        names = extractNamesFromJSON(data);
      } catch (e) {
        console.log('⚠️ فشل parsing JSON، محاولة كنص');
        const text = await response.text();
        names = extractNamesFromHTML(text);
      }
    } else {
      // محاولة كـ HTML
      const html = await response.text();
      console.log(`📄 طول HTML: ${html.length}`);
      if (html.length > 50) {
        names = extractNamesFromHTML(html);
      }
    }
    
    if (names.length > 0) {
      console.log(`✅ تم استخراج ${names.length} اسم من raw2fid`);
      return names;
    }
    
    console.log('⚠️ لم يتم استخراج أي اسم من raw2fid');
    return null;
    
  } catch (error) {
    console.error(`❌ خطأ في raw2fid: ${error.message}`);
    return null;
  }
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

    const searchPhone = provider !== 'رقم دولي' ? '0' + cleanPhone : cleanPhone;
    const fullPhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    console.log(`🔍 البحث عن: ${fullPhone} (${databasePhone})`);

    // ==========================================================
    // 🛡️ [المستوى 1] الكاش المحلي
    // ==========================================================
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      console.log('✅ تم العثور في الكاش');
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('X-Cache-Level', 'NODE_MEMORY_CACHE')
        .json(cachedData);
    }

    // ==========================================================
    // 🛡️ [المستوى 2] قراءة من Supabase
    // ==========================================================
    let supabaseResults = [];
    if (SUPABASE_ANON_KEY) {
      try {
        console.log(`🔎 البحث في Supabase عن: ${databasePhone}`);
        
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
          const records = await dbResponse.json();
          if (records && records.length > 0) {
            console.log(`✅ تم العثور على ${records.length} سجل في Supabase`);
            supabaseResults = records.map((rec) => ({
              name: rec.name || rec.contact_name || rec.full_name || rec.username || 'اسم غير معروف',
              phone: rec.phone || rec.phone_number || databasePhone,
              source: rec.source || rec.data_source || 'Supabase',
              provider: rec.provider || rec.telecom || provider,
              formattedDate: new Date(rec.created_at || rec.added_at || Date.now()).toLocaleDateString('ar-EG')
            }));
          }
        }
      } catch (dbErr) {
        console.error('❌ خطأ في Supabase:', dbErr);
      }
    }

    // ==========================================================
    // 🌐 [المستوى 3] جلب من raw2fid.net
    // ==========================================================
    let raw2fidNames = [];
    let raw2fidSuccess = false;
    
    // محاولة 1: بالرقم مع الصفر
    let rawData = await fetchFromRaw2Fid(searchPhone);
    if (rawData && rawData.length > 0) {
      raw2fidNames = rawData;
      raw2fidSuccess = true;
    }
    
    // محاولة 2: بالرقم الدولي
    if (!raw2fidSuccess) {
      console.log('🔄 محاولة ثانية بالرقم الدولي');
      rawData = await fetchFromRaw2Fid(fullPhone);
      if (rawData && rawData.length > 0) {
        raw2fidNames = rawData;
        raw2fidSuccess = true;
      }
    }
    
    // محاولة 3: بالرقم بدون صفر ولا 967
    if (!raw2fidSuccess) {
      console.log('🔄 محاولة ثالثة بالرقم المجرد');
      rawData = await fetchFromRaw2Fid(cleanPhone);
      if (rawData && rawData.length > 0) {
        raw2fidNames = rawData;
        raw2fidSuccess = true;
      }
    }

    // ==========================================================
    // 📊 دمج النتائج
    // ==========================================================
    let allResults = [];
    
    // إضافة نتائج Supabase
    if (supabaseResults.length > 0) {
      allResults = allResults.concat(supabaseResults);
    }
    
    // إضافة نتائج raw2fid
    if (raw2fidSuccess && raw2fidNames.length > 0) {
      const rawResults = raw2fidNames.map(name => ({
        name: name,
        phone: databasePhone,
        source: 'raw2fid.net',
        provider: provider,
        formattedDate: new Date().toLocaleDateString('ar-EG')
      }));
      allResults = allResults.concat(rawResults);
    }

    // ==========================================================
    // 📊 إذا لم يتم العثور على نتائج
    // ==========================================================
    if (allResults.length === 0) {
      console.log('❌ لم يتم العثور على نتائج');
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج في أي مصدر',
        debug: {
          phone: fullPhone,
          provider: provider,
          supabase_found: supabaseResults.length > 0,
          raw2fid_found: raw2fidSuccess,
          raw2fid_count: raw2fidNames.length
        }
      });
    }

    // ==========================================================
    // ✅ تجهيز النتيجة النهائية
    // ==========================================================
    const finalResponseData = {
      success: true,
      results: allResults,
      total: allResults.length,
      sources: {
        supabase: supabaseResults.length,
        raw2fid: raw2fidSuccess ? raw2fidNames.length : 0
      },
      cached_at: new Date().toISOString()
    };

    console.log(`✅ نجاح: تم العثور على ${allResults.length} نتيجة`);
    
    await cache.put(cacheKey, finalResponseData);
    return res.status(200).json(finalResponseData);

  } catch (e) {
    console.error('❌ خطأ عام:', e);
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

// ==========================================================
// 🚀 تشغيل الخادم
// ==========================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 تشغيل خادم Node.js على المنفذ ${PORT}`);
  console.log(`📡 المصادر المتاحة:`);
  console.log(`  - Supabase: ${SUPABASE_ANON_KEY ? '✅ متاح' : '❌ غير متاح'}`);
  console.log(`  - raw2fid.net: ✅ متاح`);
  console.log(`💡 مثال: http://localhost:${PORT}/api/search?query=730475239`);
});

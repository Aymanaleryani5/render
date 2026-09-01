const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// 🚀 تحسين 1: كاش ذكي بذاكرة أكبر
// ==========================================================
class MemoryCache {
  constructor() {
    // زيادة وقت الكاش وتقليل الفحص
    this.cache = new NodeCache({ 
      stdTTL: 604800, 
      checkperiod: 3600, // فحص كل ساعة بدلاً من 48 ساعة
      useClones: false // تعطيل النسخ لتحسين الأداء
    });
    this.userCache = new Map();
    this.hotCache = new Map(); // كاش سريع للأرقام الأكثر بحثاً
  }

  match(key) {
    // 1. تحقق من الكاش السريع أولاً
    if (this.hotCache.has(key)) {
      return this.hotCache.get(key);
    }
    // 2. تحقق من الكاش العام
    return this.cache.get(key) || null;
  }

  put(key, data) {
    this.cache.set(key, data);
    // حفظ في الكاش السريع أيضاً
    this.hotCache.set(key, data);
    // حذف من الكاش السريع بعد 5 دقائق
    setTimeout(() => this.hotCache.delete(key), 300000);
  }

  getUserCache(key) {
    const data = this.userCache.get(key);
    if (data && Date.now() - data.timestamp < 60000) { // دقيقة واحدة فقط
      return data.value;
    }
    this.userCache.delete(key);
    return null;
  }

  setUserCache(key, value) {
    this.userCache.set(key, { value, timestamp: Date.now() });
  }
}

// ==========================================================
// 🚀 تحسين 2: تحديد المعدل أخف
// ==========================================================
const rateLimiter = rateLimit({
  windowMs: 2000, // ثانيتين بدلاً من 3
  max: 1,
  message: JSON.stringify({
    success: false,
    results: [],
    total: 0,
    error: '⏳ انتظر ثانيتين',
    message: '⏳ يرجى الانتظار 2 ثواني'
  }),
  keyGenerator: (req) => req.ip || 'anonymous',
  handler: (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(429).send(rateLimiter.message);
  }
});

// ==========================================================
// 🚀 تحسين 3: قاعدة بيانات محلية سريعة للأسماء
// ==========================================================
const LOCAL_DB = new Map([
  // أضف أرقام وأسماء معروفة محلياً (مثال)
  // ['+967771234567', 'محمد أحمد'],
  // ['+966501234567', 'خالد سعيد'],
]);

// ==========================================================
// 🚀 تحسين 4: دوال استخراج أسرع
// ==========================================================
const NAME_PATTERNS = [
  /اسم الشهرة[:\s]+([^\n]+)/i,
  /الاسم[:\s]+([^\n]+)/i,
  /name[:\s]+([^\n]+)/i,
  /صاحب الرقم[:\s]+([^\n]+)/i,
  /owner[:\s]+([^\n]+)/i
];

function extractNamesFast(text) {
  const names = [];
  const seen = new Set();
  
  // استخراج سريع باستخدام الأنماط المحددة
  for (const pattern of NAME_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (name.length > 2 && !seen.has(name)) {
        seen.add(name);
        names.push(name);
        if (names.length >= 5) break; // حد أقصى 5 أسماء للسرعة
      }
    }
  }
  
  // استخراج أسماء من القوائم المرقمة (أسرع)
  if (names.length < 3) {
    const numbered = text.match(/\d+\s*[-–—]\s*([^\d\n]{2,30})/);
    if (numbered) {
      const name = numbered[1].trim();
      if (name.length > 2 && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  
  return names;
}

// ==========================================================
// 🚀 تحسين 5: جلب أسرع مع مهلة قصيرة
// ==========================================================
async function fetchFast(url, timeout = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Accept': '*/*',
        'Accept-Language': 'ar,en;q=0.9'
      }
    });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// ==========================================================
// 🚀 تحسين 6: معالجة الأرقام بسرعة
// ==========================================================
const COUNTRY_MAP = new Map([
  ['967', { country: 'اليمن', minLen: 9 }],
  ['966', { country: 'السعودية', minLen: 9 }],
  ['20', { country: 'مصر', minLen: 10 }],
  ['971', { country: 'الإمارات', minLen: 9 }],
  ['965', { country: 'الكويت', minLen: 8 }],
  ['1', { country: 'أمريكا/كندا', minLen: 10 }],
  ['44', { country: 'بريطانيا', minLen: 10 }],
  ['90', { country: 'تركيا', minLen: 10 }]
]);

function detectPhoneFast(phone) {
  let clean = phone.replace(/[^0-9+]/g, '');
  if (clean.startsWith('00')) clean = '+' + clean.substring(2);
  if (!clean.startsWith('+')) clean = '+' + clean;
  
  // البحث السريع في الخريطة
  const digits = clean.replace(/^\+/, '');
  for (const [code, info] of COUNTRY_MAP) {
    if (digits.startsWith(code)) {
      const national = digits.substring(code.length);
      if (national.length >= info.minLen) {
        return {
          international: clean,
          code,
          national,
          country: info.country
        };
      }
    }
  }
  
  return {
    international: clean,
    code: '',
    national: clean.replace(/^\+/, ''),
    country: 'دولي'
  };
}

// ==========================================================
// 🚀 تحسين 7: Endpoint سريع جداً
// ==========================================================
app.all('/api/search', rateLimiter, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const query = req.method === 'GET' ? req.query.query : req.body.query;
    const clientIP = req.ip || 'anonymous';
    
    if (!query) {
      return res.status(200).json({ 
        success: false, 
        results: [], 
        total: 0, 
        error: 'البحث فارغ' 
      });
    }

    // ==========================================================
    // 📱 معالجة سريعة للرقم
    // ==========================================================
    const phoneInfo = detectPhoneFast(query);
    
    // التحقق من صحة الرقم
    if (phoneInfo.national.length < 4) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'رقم غير صحيح'
      });
    }

    const cacheKey = `p_${phoneInfo.international}`;
    
    // ==========================================================
    // 🚀 تحقق سريع من الكاش (أولوية قصوى)
    // ==========================================================
    const cached = cache.match(cacheKey);
    if (cached) {
      const responseTime = Date.now() - startTime;
      return res.status(200)
        .set('X-Cache', 'HIT')
        .set('X-Response-Time', `${responseTime}ms`)
        .json(cached);
    }

    // ==========================================================
    // 🔍 التحقق من القاعدة المحلية
    // ==========================================================
    if (LOCAL_DB.has(phoneInfo.international)) {
      const localResult = {
        success: true,
        results: [{ 
          name: LOCAL_DB.get(phoneInfo.international),
          phone: phoneInfo.international,
          country: phoneInfo.country,
          source: 'local'
        }],
        total: 1,
        source: 'local'
      };
      cache.put(cacheKey, localResult);
      return res.status(200)
        .set('X-Cache', 'LOCAL')
        .set('X-Response-Time', `${Date.now() - startTime}ms`)
        .json(localResult);
    }

    // ==========================================================
    // 🌐 جلب سريع من المصدر
    // ==========================================================
    let targetUrl;
    let provider = phoneInfo.country;
    
    // معالجة خاصة لليمن
    if (phoneInfo.code === '967') {
      const base64Phone = Buffer.from(phoneInfo.national).toString('base64');
      targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${phoneInfo.national}&nocache=${Date.now()}`;
      
      // تحديد المزود بسرعة
      const n = phoneInfo.national;
      if (/^7[78]/.test(n)) provider = 'يمن موبايل';
      else if (/^73/.test(n)) provider = 'YOU';
      else if (/^71/.test(n)) provider = 'سبأفون';
      else if (/^70/.test(n)) provider = 'واي';
    } else {
      // بحث عام
      targetUrl = `https://api.scraperapi.com/search?query=${encodeURIComponent(phoneInfo.international)}+phone`;
    }

    // ==========================================================
    // 🚀 جلب سريع بمهلة 3 ثواني فقط
    // ==========================================================
    let names = [];
    let success = false;
    
    try {
      if (!SCRAPINGAPI_API_KEY) {
        throw new Error('API key missing');
      }
      
      const apiUrl = `https://api.scraperapi.com/?api_key=${SCRAPINGAPI_API_KEY}&url=${encodeURIComponent(targetUrl)}&timeout=3000`;
      
      const response = await fetchFast(apiUrl, 3000);
      
      if (response.ok) {
        const text = await response.text();
        // استخراج سريع
        names = extractNamesFast(text);
        if (names.length > 0) success = true;
      }
    } catch (e) {
      // فشل سريع
    }

    // ==========================================================
    // 📊 تجهيز النتيجة بسرعة
    // ==========================================================
    if (!success || names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لا توجد نتائج',
        phone: phoneInfo.international,
        country: phoneInfo.country,
        responseTime: `${Date.now() - startTime}ms`
      });
    }

    const results = names.slice(0, 3).map(name => ({
      name,
      phone: phoneInfo.international,
      country: phoneInfo.country,
      provider,
      source: 'ScrapingAPI'
    }));

    const responseData = {
      success: true,
      results,
      total: results.length,
      phone: phoneInfo.international,
      country: phoneInfo.country,
      provider,
      source: 'scrapingapi',
      responseTime: `${Date.now() - startTime}ms`
    };

    // حفظ في الكاش
    cache.put(cacheKey, responseData);
    cache.setUserCache(`${clientIP}_${cacheKey}`, responseData);

    return res.status(200)
      .set('X-Cache', 'MISS')
      .set('X-Response-Time', `${Date.now() - startTime}ms`)
      .json(responseData);

  } catch (e) {
    return res.status(500).json({ 
      success: false, 
      results: [], 
      total: 0, 
      error: 'خطأ في الخادم',
      responseTime: `${Date.now() - startTime}ms`
    });
  }
});

// ==========================================================
// 🚀 تشغيل الخادم
// ==========================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`⚡ Fast mode enabled`);
  console.log(`📱 International phones supported`);
});

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
// 🌐 متغيرات البيئة ومفتاح ScrapingBee
// ==========================================================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qfcsaiyuyxhibidrrmha.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || "IDUQA2D25IHAQVLA6MJ4MNWERIJTSE1MHME7UBKK85365E5L7IJT3IX5Q33NM2US55IMEH8HB1Y57XF3";

// إنشاء مثيلات
const cache = new MemoryCache();

console.log('🚀 جاري تشغيل الخادم...');
console.log(`🐝 ScrapingBee API Key: ${SCRAPINGBEE_API_KEY ? '✅ موجود' : '❌ غير موجود'}`);

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
    const text = typeof jsonData === 'string' ? jsonData : (jsonData.result || JSON.stringify(jsonData));
    
    if (text) {
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
    .slice(0, 200);
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
  
  return [...new Set(names)].slice(0, 200);
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
  
  return [...new Set(names)].slice(0, 200);
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
    // 🛡️ [المستوى 2] قراءة من Supabase
    // ==========================================================
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
          const existingRecords = await dbResponse.json();
          if (existingRecords && existingRecords.length > 0) {
            console.log(`✅ تم العثور على الرقم في Supabase!`);
            
            const results = existingRecords.map((rec) => {
              const name = rec.name || rec.contact_name || rec.full_name || rec.username || 'اسم غير معروف';
              const phone = rec.phone || rec.phone_number || databasePhone;
              const src = rec.source || rec.data_source || 'قاعدة البيانات';
              const prov = rec.provider || rec.telecom || provider;
              const date = rec.created_at || rec.added_at || new Date().toISOString();

              return {
                name: name,
                phone: phone,
                source: src,
                provider: prov,
                formattedDate: new Date(date).toLocaleDateString('ar-EG')
              };
            });

            const finalResponseData = {
              success: true,
              results,
              total: results.length,
              source: 'supabase_cache',
              cached_at: new Date().toISOString()
            };

            await cache.put(cacheKey, finalResponseData);
            return res.status(200).json(finalResponseData);
          }
        }
      } catch (dbErr) {
        console.error('❌ خطأ في Supabase:', dbErr);
      }
    }

    // ==========================================================
    // 🌐 [المستوى 3] جلب عبر ScrapingBee 🐝 (نموذج 1 Credit)
    // ==========================================================
    let names = [];
    let success = false;
    let lastError = null;
    let source = '';
    let rawData = null;

    if (SCRAPINGBEE_API_KEY) {
      console.log('🐝 استخدام ScrapingBee (وضع 1 Credit)...');
      
      try {
        const targetUrl = `https://3.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;
        console.log(`📡 جلب البيانات من: ${targetUrl}`);
        
        const scrapingBeeUrl = new URL('https://app.scrapingbee.com/api/v1/');
        scrapingBeeUrl.searchParams.append('api_key', SCRAPINGBEE_API_KEY);
        scrapingBeeUrl.searchParams.append('url', targetUrl);
        scrapingBeeUrl.searchParams.append('render_js', 'false');       // 1 Credit
        scrapingBeeUrl.searchParams.append('premium_proxy', 'false');   // ضمان عدم استهلاك 10 Credits

        const response = await fetch(scrapingBeeUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/html, */*'
          }
        });
        
        if (response.ok) {
          const responseContent = await response.text();
          rawData = responseContent;
          console.log('✅ استجابة ScrapingBee مستلمة');

          // 1. محاولة معالجة النتيجة كـ JSON
          try {
            const parsedJson = JSON.parse(responseContent);
            const extractedNames = extractNamesFromJSON(parsedJson);
            if (extractedNames.length > 0) {
              names = extractedNames;
              success = true;
              source = 'scrapingbee_json';
              console.log(`✅ استخراج ${names.length} اسم من ScrapingBee (JSON)`);
            }
          } catch (e) {
            // المحتوى ليس JSON، قراءته كـ HTML
          }

          // 2. محاولة معالجة النتيجة كـ HTML
          if (!success || names.length === 0) {
            if (responseContent && responseContent.length >= 50) {
              const extractedNames = extractNamesFromResponse(responseContent);
              if (extractedNames.length > 0) {
                names = extractedNames;
                success = true;
                source = 'scrapingbee_html';
                console.log(`✅ استخراج ${names.length} اسم من ScrapingBee (HTML)`);
              } else {
                const alternativeNames = extractNamesAlternative(responseContent);
                if (alternativeNames.length > 0) {
                  names = alternativeNames;
                  success = true;
                  source = 'scrapingbee_alternative';
                  console.log(`✅ استخراج ${names.length} اسم (طريقة بديلة)`);
                }
              }
            }
          }
        } else {
          const errorText = await response.text();
          console.log(`⚠️ فشل ScrapingBee: ${response.status} - ${errorText}`);
          lastError = `ScrapingBee error: ${response.status}`;
        }
      } catch (e) {
        console.error('❌ خطأ في ScrapingBee:', e);
        lastError = `ScrapingBee exception: ${e.message}`;
      }
    } else {
      console.log('⚠️ مفتاح ScrapingBee غير موجود');
      lastError = 'مفتاح ScrapingBee غير موجود';
    }

    // ==========================================================
    // 🔄 المحاولة البديلة: جلب مباشر
    // ==========================================================
    if (!success || names.length === 0) {
      console.log('🔄 محاولة الجلب المباشر...');
      
      try {
        const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;
        
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
            rawData = jsonData;
            const extractedNames = extractNamesFromJSON(jsonData);
            if (extractedNames.length > 0) {
              names = extractedNames;
              success = true;
              source = 'direct_json';
              console.log(`✅ استخراج ${names.length} اسم من JSON مباشر`);
            }
          } else {
            const htmlContent = await response.text();
            if (htmlContent && htmlContent.length >= 50) {
              const extractedNames = extractNamesFromResponse(htmlContent);
              if (extractedNames.length > 0) {
                names = extractedNames;
                success = true;
                source = 'direct_scrape';
                console.log(`✅ استخراج ${names.length} اسم من HTML مباشر`);
              }
            }
          }
        }
      } catch (e) {
        console.log(`⚠️ فشل الجلب المباشر: ${e.message}`);
      }
    }

    // ==========================================================
    // 📊 إذا لم يتم العثور على نتائج
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
          has_scrapingbee_key: !!SCRAPINGBEE_API_KEY,
          source: source
        }
      });
    }

    // --- تجهيز النتيجة ---
    const results = names.map(name => ({
      name: name,
      phone: databasePhone,
      source: source.includes('scrapingbee') ? 'ScrapingBee' : 'مباشر',
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
  console.log(`🐝 ScrapingBee API Key: ${SCRAPINGBEE_API_KEY ? '✅ موجود' : '❌ غير موجود'}`);
  console.log(`🔑 المفتاح: ${SCRAPINGBEE_API_KEY ? SCRAPINGBEE_API_KEY.substring(0, 15) + '...' : 'غير موجود'}`);
});
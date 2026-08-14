const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

class MemoryCache {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 2592000, checkperiod: 86400 });
  }
  async match(key) { return this.cache.get(key) || null; }
  async put(key, data) { this.cache.set(key, data); }
  cleanup() {}
}

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
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip || 'anonymous',
  handler: (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(429).json(JSON.parse(rateLimiter.message));
  }
});

const SCRAPING_API_KEY = process.env.SCRAPING_API_KEY || process.env.SCRAPINGBEE_API_KEY || "";
const cache = new MemoryCache();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function parseOriginalApiResponse(rawData) {
  const names = [];
  try {
    let text = '';
    if (typeof rawData === 'string') {
      try {
        const parsed = JSON.parse(rawData);
        text = parsed.result || rawData;
      } catch (e) {
        text = rawData;
      }
    } else if (rawData && typeof rawData === 'object') {
      text = rawData.result || JSON.stringify(rawData);
    }

    text = text.replace(/\\"/g, '"').replace(/\\&quot;/g, '"');

    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^\d+[\s\-\–—]+(.+)$/);
      if (match && match[1]) {
        let cleanName = match[1].trim();
        if (cleanName && !names.includes(cleanName) && !cleanName.includes('نتائج البحث للرقم') && !cleanName.includes('الأسماء المرتبطة')) {
          names.push(cleanName);
        }
      }
    }
  } catch (e) {
    console.error('خطأ في تحليل استجابة الموقع:', e);
  }
  return names;
}

function detectProvider(fullNumber) {
  if (/^(77|78)[0-9]{7}$/.test(fullNumber)) return 'يمن موبايل (اليمن)';
  if (/^(73)[0-9]{7}$/.test(fullNumber)) return 'YOU (اليمن)';
  if (/^(71)[0-9]{7}$/.test(fullNumber)) return 'سبأفون (اليمن)';
  if (/^(70)[0-9]{7}$/.test(fullNumber)) return 'واي (اليمن)';
  if (fullNumber.startsWith('967')) return 'السجلات اليمنية (دولي)';
  if (fullNumber.startsWith('966')) return 'المملكة العربية السعودية';
  if (fullNumber.startsWith('20')) return 'جمهورية مصر العربية';
  if (fullNumber.startsWith('971')) return 'الإمارات العربية المتحدة';
  return 'رقم عربي / دولي آخر';
}

app.all('/api/search', rateLimiter, async (req, res) => {
  try {
    let query = req.method === 'GET' ? req.query.query : req.body.query;

    if (!query) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
    }

    let cleanPhone = query.trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);

    let databasePhone = cleanPhone;
    if (/^0[1-9][0-9]{8,9}$/.test(cleanPhone)) {
      databasePhone = cleanPhone.substring(1);
    }

    const provider = detectProvider(cleanPhone);
    let scrapePhone = cleanPhone;
    if (!scrapePhone.startsWith('+')) {
      scrapePhone = '+' + scrapePhone;
    }

    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200).set('X-Cache-Status', 'HIT').json(cachedData);
    }

    let names = [];
    let success = false;
    let lastError = null;
    let source = 'direct_optimized';

    const base64Phone = Buffer.from(scrapePhone).toString('base64');
    const dynamicReferer = `https://b.raw2fid.net/calle/?res_id=K${base64Phone}%3D%3D`;
    const timestamp = Date.now();
    const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;

    // 1. محاولة الجلب المباشر مع تدوير الـ User-Agents
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const dynamicHeaders = {
          'accept': 'application/json, text/javascript, */*; q=0.01',
          'accept-language': 'ar,en-US;q=0.9,en;q=0.8',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
          'x-requested-with': 'XMLHttpRequest',
          'referer': dynamicReferer,
          'user-agent': getRandomUserAgent()
        };

        const response = await fetch(targetUrl, { method: 'GET', headers: dynamicHeaders });
        
        if (response.ok) {
          const responseText = await response.text();
          const extracted = parseOriginalApiResponse(responseText);
          if (extracted.length > 0) {
            names = extracted;
            success = true;
            source = 'direct_optimized';
            break;
          }
        } else {
          lastError = `HTTP Error: ${response.status}`;
        }
      } catch (e) {
        lastError = e.message;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 2. خط الدفاع الاحتياطي الآلي باستخدام ScrapingAPI تلقائياً في حال توفر المفتاح لتجاوز الحظر الجذري
    if ((!success || names.length === 0) && SCRAPING_API_KEY) {
      try {
        const scrapingApiUrl = new URL('https://api.scrapingapi.com/v1/');
        scrapingApiUrl.searchParams.append('api_key', SCRAPING_API_KEY);
        scrapingApiUrl.searchParams.append('url', targetUrl);
        scrapingApiUrl.searchParams.append('render_js', 'false');

        const fallbackHeaders = {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
          'referer': dynamicReferer,
          'user-agent': getRandomUserAgent()
        };

        const response = await fetch(scrapingApiUrl.toString(), { method: 'GET', headers: fallbackHeaders });
        
        if (response.ok) {
          const responseContent = await response.text();
          const extracted = parseOriginalApiResponse(responseContent);
          if (extracted.length > 0) {
            names = extracted;
            success = true;
            source = 'scrapingapi_fallback';
          }
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    if (!success || names.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: lastError || 'عفواً، لم يتم العثور على نتائج أو تم الوصول للحد الأقصى.'
      });
    }

    const results = names.map(name => ({
      name: name,
      phone: databasePhone,
      source: source,
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
    return res.status(500).json({ success: false, results: [], total: 0, error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 تشغيل خادم Node.js على المنفذ ${PORT}`);
});

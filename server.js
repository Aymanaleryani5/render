const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// 📂 تجهيز مسارات الملفات من 1.csv إلى 17.csv
// ==========================================================
function getCSVFileList() {
  const fileList = [];
  for (let i = 1; i <= 17; i++) {
    const filePath = path.join(__dirname, `${i}.csv`);
    if (fs.existsSync(filePath)) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

// ==========================================================
// 🔍 دالة البحث التدفيقي بالتسلسل داخل الملفات (1.csv إلى 17.csv)
// ==========================================================
async function searchInCSVFiles(cleanPhone) {
  const matches = [];
  const csvFiles = getCSVFileList();

  for (const filePath of csvFiles) {
    await new Promise((resolve) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          const rowValues = Object.values(row).join(' ');
          if (rowValues.includes(cleanPhone)) {
            matches.push({
              name: row.name || row.Name || row.full_name || row.username || row.FULL_NAME || Object.values(row)[0] || 'اسم غير معروف',
              phone: row.phone || row.number || row.mobile || cleanPhone,
              fileName: path.basename(filePath)
            });
          }
        })
        .on('end', () => resolve())
        .on('error', (err) => {
          console.error(`❌ خطأ أثناء القراءة من ${path.basename(filePath)}:`, err.message);
          resolve();
        });
    });
  }

  return matches;
}

// ==========================================================
// 📊 نظام الكاش (Memory Cache)
// ==========================================================
class MemoryCache {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 2592000, checkperiod: 86400 });
  }

  async match(requestKey) {
    return this.cache.get(requestKey) || null;
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
// 🌐 متغيرات البيئة
// ==========================================================
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || "E0DLI9EKT3XPRF645FTO4PHG5LMRMT0UOMOXZ8EKH7CM62VXBSGYNKNPHLH7Y9IK3YBC31J0QRRP4CT1";

const cache = new MemoryCache();

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
// 📝 دوال تنظيف واستخراج الأسماء من الموقع الخارجي
// ==========================================================
function extractNamesFromJSON(jsonData) {
  const names = [];
  try {
    const text = typeof jsonData === 'string' ? jsonData : (jsonData.result || JSON.stringify(jsonData));
    if (text) {
      const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
      if (fameMatch) {
        let name = cleanExtractedName(fameMatch[1]);
        if (name && name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
          names.push(name);
        }
      }
      
      const numberedMatches = text.match(/\d+\s*[-–—]\s*([^\d\n]+)/g);
      if (numberedMatches) {
        numberedMatches.forEach(m => {
          const nameMatch = m.match(/\d+\s*[-–—]\s*([^\d\n]+)/);
          if (nameMatch) {
            let name = cleanExtractedName(nameMatch[1]);
            if (name && name.length > 2 && !names.includes(name) && !/^\+?\d+$/.test(name)) {
              names.push(name);
            }
          }
        });
      }
      
      const arabicPattern = /[\u0600-\u06FF]{3,}(?:\s+[\u0600-\u06FF]{3,}){0,3}/g;
      let arabicMatch;
      while ((arabicMatch = arabicPattern.exec(text)) !== null) {
        let name = cleanExtractedName(arabicMatch[0]);
        if (name.length > 2 && !names.includes(name) && !name.includes('ل') && !/^\+?\d+$/.test(name)) {
          names.push(name);
        }
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
    .replace(/\b(info|country|n|null|undefined|الرقم|اسم|search|phone|نتائج|البحث|للرقم|الشهرة|السجلات|اليمن)\b/gi, '')
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
// 🚀 Endpoint الرئيسي (/api/search) - البحث في الـ CSV والموقع الخارجي معا
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

    // 🛡️ [الكاش المحلي]
    const cacheKey = `phone_${databasePhone}`;
    const cachedData = await cache.match(cacheKey);
    if (cachedData) {
      return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .json(cachedData);
    }

    let combinedResults = [];

    // ==========================================================
    // 📂 المصدر 1: البحث في ملفات ה- CSV (1.csv إلى 17.csv)
    // ==========================================================
    try {
      const csvMatches = await searchInCSVFiles(cleanPhone);
      if (csvMatches.length > 0) {
        csvMatches.forEach(rec => {
          combinedResults.push({
            name: rec.name,
            phone: databasePhone,
            source: `GitHub CSV (${rec.fileName})`,
            provider: provider,
            formattedDate: new Date().toLocaleDateString('ar-EG')
          });
        });
      }
    } catch (csvErr) {
      console.error('❌ خطأ أثناء البحث في ملفات CSV:', csvErr);
    }

    // ==========================================================
    // 🌐 المصدر 2: البحث في الموقع الخارجي عبر ScrapingBee
    // ==========================================================
    if (SCRAPINGBEE_API_KEY) {
      try {
        const targetUrl = `https://b.raw2fid.net/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}`;
        const scrapingBeeUrl = new URL('https://app.scrapingbee.com/api/v1/');
        scrapingBeeUrl.searchParams.append('api_key', SCRAPINGBEE_API_KEY);
        scrapingBeeUrl.searchParams.append('url', targetUrl);
        scrapingBeeUrl.searchParams.append('render_js', 'false');

        const response = await fetch(scrapingBeeUrl.toString());
        if (response.ok) {
          const responseContent = await response.text();
          let names = [];

          try {
            const parsedJson = JSON.parse(responseContent);
            names = extractNamesFromJSON(parsedJson);
          } catch (e) {}

          if (names.length === 0) {
            names = extractNamesFromResponse(responseContent);
          }

          if (names.length > 0) {
            names.forEach(name => {
              combinedResults.push({
                name,
                phone: databasePhone,
                source: 'الموقع الخارجي (External Site)',
                provider,
                formattedDate: new Date().toLocaleDateString('ar-EG')
              });
            });
          }
        }
      } catch (webErr) {
        console.error('❌ خطأ أثناء الاتصال بالموقع الخارجي:', webErr);
      }
    }

    // ==========================================================
    // 📊 معالجة وتصفية النتائج
    // ==========================================================
    if (combinedResults.length === 0) {
      return res.status(200).json({
        success: false,
        results: [],
        total: 0,
        error: 'لم يتم العثور على نتائج في ملفات الـ CSV أو في الموقع الخارجي'
      });
    }

    // تصفية وإزالة الأسماء المكررة
    const uniqueResults = [];
    const seenNames = new Set();

    for (const item of combinedResults) {
      if (!seenNames.has(item.name)) {
        seenNames.add(item.name);
        uniqueResults.push(item);
      }
    }

    const finalResponseData = {
      success: true,
      results: uniqueResults,
      total: uniqueResults.length,
      sources_checked: ['github_csv', 'external_site'],
      cached_at: new Date().toISOString()
    };

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
  const csvFiles = getCSVFileList();
  console.log(`🚀 تشغيل خادم Node.js على المنفذ ${PORT}`);
  console.log(`📂 يتم الآن البحث المباشر في ${csvFiles.length} ملف CSV والموقع الخارجي معاً.`);
});

Const express = require('express');
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
    This.cache = new NodeCache({ stdTTL: 2592000, checkperiod: 86400 });
  }

  async match(requestKey) {
    Const entry = this.cache.get(requestKey);
    If (!entry) return null;
    Return entry;
  }

  async put(requestKey, responseData) {
    This.cache.set(requestKey, responseData);
  }

  cleanup() {
    // NodeCache يقوم بالتنظيف تلقائياً
  }
}

// ==========================================================
// 📊 نظام تحديد المعدل (Rate Limiting)
// ==========================================================
Const rateLimiter = rateLimit({
  WindowMs: 3 * 1000, // 3 ثواني
  Max: 1, // طلب واحد لكل IP
  Message: JSON.stringify({
    Success: false,
    Results: [],
    Total: 0,
    Error: 'مهلاً! الرجاء الانتظار',
    Message: '⏳ يرجى الانتظار 3 ثواني بين عمليات البحث'
  }),
  KeyGenerator: (req) => {
    Return req.headers['cf-connecting-ip'] || 
           Req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           Req.ip ||
           'anonymous';
  },
  Handler: (req, res) => {
    Res.setHeader('Content-Type', 'application/json; charset=utf-8');
    Res.status(429).json(JSON.parse(rateLimiter.message));
  }
});

// ==========================================================
// 🌐 متغيرات البيئة ومفتاح ScrapingAPI
// ==========================================================
Const SCRAPINGAPI_API_KEY = process.env.SCRAPINGAPI_API_KEY || "654649b0128a453b96288f7685c28f4f";

// إنشاء مثيلات
Const cache = new MemoryCache();

Console.log('🚀 جاري تشغيل الخادم...');
Console.log(`🐝 ScrapingAPI API Key: ${SCRAPINGAPI_API_KEY ? '✅ موجود' : '❌ غير موجود'}`);

// ==========================================================
// 🚀 Middleware
// ==========================================================
App.use(cors({
  Origin: '*',
  Methods: ['GET', 'POST', 'OPTIONS'],
  AllowedHeaders: ['Content-Type']
}));

App.use(express.json());

// ==========================================================
// 📝 دوال استخراج وتنظيف الأسماء
// ==========================================================

Const STOP_WORDS = [
  'صحيح', 'صحيحة', 'خطأ', 'نعم', 'لا', 'بحث', 'نتائج', 'البحث', 'للرقم', 
  'اسم', 'الشهرة', 'السجلات', 'المكتشفة', 'الأكثر', 'شيوعاً', 'شيوعا', 'اليمن', 
  'سجل', 'تفاصيل', 'بيانات', 'عفواً', 'تأكيد', 'الرقم', 'يرجى', 'الانتظار',
  'null', 'undefined', 'info', 'country', 'search', 'phone', 'true', 'false'
];

Function isRealName(name) {
  If (!name || name.length < 3) return false;
  If (/^\+?\d+$/.test(name)) return false;
  If (STOP_WORDS.includes(name.trim())) return false;
  If (!/[\u0600-\u06FFa-zA-Z]/.test(name)) return false;
  Return true;
}

Function cleanExtractedName(name) {
  If (!name) return '';
  
  Let cleaned = name
    // 1. إزالة العبارات والجمل النصية الزائدة من الواجهة
    .replace(/عدد\s*السجلات\s*المكتشفة/gi, '')
    .replace(/هذا\s*الاسم\s*هو\s*الأكثر\s*شيوعاً\s*لهذا\s*الرقم/gi, '')
    .replace(/هذا\s*الاسم\s*هو\s*الأكثر\s*شيوعا\s*لهذا\s*الرقم/gi, '')
    .replace(/نتائج\s*البحث\s*للرقم/gi, '')
    .replace(/[\\{}{}\[\]"':\-_,\/|\.]/g, ' ');

  // 2. إزالة كلمات التوقف المحددة وتنظيف المسافات (مع الإبقاء على الكلمات مثل Liu)
  Return cleaned
    .replace(/\b(عدد|السجلات|المكتشفة|الأكثر|شيوعا|شيوعاً|لهذا|الرقم|يرجى|الانتظار|البحث|نتائج|اسم|الشهرة|هاتف|ثابت)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

Function extractNamesFromJSON(jsonData) {
  Const names = [];
  Try {
    Const text = typeof jsonData === 'string' ? JsonData : (jsonData.result || JSON.stringify(jsonData));
    If (text) {
      Const fameMatch = text.match(/اسم الشهرة[:\s]+([^\n]+)/);
      If (fameMatch) {
        Let name = cleanExtractedName(fameMatch[1]);
        If (isRealName(name) && !names.includes(name)) names.push(name);
      }
      
      Const numberedMatches = text.match(/\d+\s*[-–—]\s*([^\d\n]+)/g);
      If (numberedMatches) {
        NumberedMatches.forEach(m => {
          Const nameMatch = m.match(/\d+\s*[-–—]\s*([^\d\n]+)/);
          If (nameMatch) {
            Let name = cleanExtractedName(nameMatch[1]);
            If (isRealName(name) && !names.includes(name)) names.push(name);
          }
        });
      }
    }
  } catch (e) {
    Console.error('خطأ في استخراج الأسماء من JSON:', e);
  }
  Return [...new Set(names)].slice(0, 200);
}

Function extractNamesFromResponse(html) {
  Const names = [];
  Const numberedPattern = /(\d+)\s*[-–—]\s*([^\d\n<]+)/g;
  Let match;
  While ((match = numberedPattern.exec(html)) !== null) {
    Let name = cleanExtractedName(match[2]);
    If (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  Const nameTags = /<[^>]*name[^>]*>([^<]+)<\/[^>]*>/gi;
  Let tagMatch;
  While ((tagMatch = nameTags.exec(html)) !== null) {
    Let name = cleanExtractedName(tagMatch[1]);
    If (isRealName(name) && !names.includes(name)) names.push(name);
  }
  
  Return [...new Set(names)].slice(0, 200);
}

Function extractNamesAlternative(html) {
  Const names = [];
  Const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  
  Const keywords = ['اسم', 'الاسم', 'name', 'user', 'contact', 'صاحب', 'مالك', 'الشهرة', 'المستخدم', 'العميل'];
  For (const keyword of keywords) {
    Const regex = new RegExp(`${keyword}[\\s:]*([^\\n<,]+)`, 'gi');
    Let match;
    While ((match = regex.exec(textContent)) !== null) {
      Let name = cleanExtractedName(match[1]);
      If (isRealName(name) && !names.includes(name)) names.push(name);
    }
  }
  
  Return [...new Set(names)].slice(0, 200);
}

Function detectProvider(cleanPhone) {
  If (/^(77|78)[0-9]{7}$/.test(cleanPhone)) return 'يمن موبايل';
  If (/^(73)[0-9]{7}$/.test(cleanPhone)) return 'YOU';
  If (/^(71)[0-9]{7}$/.test(cleanPhone)) return 'سبأفون';
  If (/^(70)[0-9]{7}$/.test(cleanPhone)) return 'واي';
  Return 'رقم دولي';
}

// ==========================================================
// 🚀 Endpoint الرئيسي
// ==========================================================
App.all('/api/search', rateLimiter, async (req, res) => {
  Try {
    Let query = null;
    If (req.method === 'GET') {
      Query = req.query.query;
    } else if (req.method === 'POST') {
      Query = req.body.query;
    }

    If (!query) {
      Return res.status(200).json({
        Success: false,
        Results: [],
        Total: 0,
        Error: 'البحث فارغ'
      });
    }

    Let cleanPhone = query.trim().replace(/\s+/g, '').replace(/[-()]/g, '');
    If (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
    Else if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    Else if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
    
    If (cleanPhone.startsWith('967')) cleanPhone = cleanPhone.substring(3);

    Const provider = detectProvider(cleanPhone);
    Let databasePhone = cleanPhone;
    If (provider !== 'رقم دولي' && !databasePhone.startsWith('0')) {
      DatabasePhone = '0' + databasePhone;
    }

    Const scrapePhone = provider !== 'رقم دولي' ? '+967' + cleanPhone : '+' + cleanPhone;

    // ==========================================================
    // 🛡️ [المستوى 1] الكاش المحلي
    // ==========================================================
    Const cacheKey = `phone_${databasePhone}`;
    Const cachedData = await cache.match(cacheKey);
    If (cachedData) {
      Return res.status(200)
        .set('X-Cache-Status', 'HIT')
        .set('X-Cache-Level', 'NODE_MEMORY_CACHE')
        .json(cachedData);
    }

    // ==========================================================
    // 🌐 [المستوى 2] المحاولة الأولى: جلب مباشر لتوفير الـ Credits
    // ==========================================================
    Let names = [];
    Let success = false;
    Let lastError = null;
    Let source = '';

    Const base64Phone = Buffer.from(scrapePhone).toString('base64');
    Const dynamicReferer = `https://ab.new9plus.com/calle/?res_id=K${base64Phone}%3D%3D`;
    Const timestamp = Date.now();

    Const browserHeaders = {
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

    Console.log('🔄 محاولة الجلب المباشر أولاً بدون استخدام ScrapingAPI...');
    Try {
      Const targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;
      Const response = await fetch(targetUrl, { method: 'GET', headers: browserHeaders });
      
      If (response.ok) {
        Const responseText = await response.text();
        Try {
          Const jsonData = JSON.parse(responseText);
          Const extractedNames = extractNamesFromJSON(jsonData);
          If (extractedNames.length > 0) {
            Names = extractedNames;
            Success = true;
            Source = 'direct_json';
            Console.log(`✅ تم الاستخراج بنجاح عبر الجلب المباشر (${names.length} اسم)`);
          }
        } catch (e) {
          If (responseText && responseText.length >= 20) {
            Const extractedNames = extractNamesFromResponse(responseText);
            If (extractedNames.length > 0) {
              Names = extractedNames;
              Success = true;
              Source = 'direct_scrape';
              Console.log(`✅ تم الاستخراج بنجاح عبر الجلب المباشر (HTML)`);
            }
          }
        }
      }
    } catch (e) {
      Console.log(`⚠️ فشل الجلب المباشر: ${e.message}`);
    }

    // ==========================================================
    // 🐝 [المستوى 3] ScrapingAPI (خيار بديل عند فشل المباشر)
    // ==========================================================
    If ((!success || names.length === 0) && SCRAPINGAPI_API_KEY) {
      Console.log('🐝 الجلب المباشر لم ينجح، استخدام ScrapingAPI...');
      
      Try {
        Const targetUrl = `https://ab.new9plus.com/wp-admin/admin-ajax.php?action=alosh_search&phone=${encodeURIComponent(scrapePhone)}&nocache=${timestamp}`;
        
        Const scrapingApiUrl = new URL('https://api.scraperapi.com/');
        ScrapingApiUrl.searchParams.append('api_key', SCRAPINGAPI_API_KEY);
        ScrapingApiUrl.searchParams.append('url', targetUrl);
        ScrapingApiUrl.searchParams.append('render', 'false');       
        ScrapingApiUrl.searchParams.append('premium_proxy', 'false');   
        ScrapingApiUrl.searchParams.append('forward_headers', 'true');

        Const response = await fetch(scrapingApiUrl.toString(), {
          Method: 'GET',
          Headers: browserHeaders
        });
        
        If (response.ok) {
          Const responseContent = await response.text();

          Try {
            Const parsedJson = JSON.parse(responseContent);
            Const extractedNames = extractNamesFromJSON(parsedJson);
            If (extractedNames.length > 0) {
              Names = extractedNames;
              Success = true;
              Source = 'scrapingapi_json';
            }
          } catch (e) {}

          If (!success || names.length === 0) {
            If (responseContent && responseContent.length >= 20) {
              Const extractedNames = extractNamesFromResponse(responseContent);
              If (extractedNames.length > 0) {
                Names = extractedNames;
                Success = true;
                Source = 'scrapingapi_html';
              } else {
                Const alternativeNames = extractNamesAlternative(responseContent);
                If (alternativeNames.length > 0) {
                  Names = alternativeNames;
                  Success = true;
                  Source = 'scrapingapi_alternative';
                }
              }
            }
          }
        } else {
          LastError = `ScrapingAPI error: ${response.status}`;
        }
      } catch (e) {
        LastError = `ScrapingAPI exception: ${e.message}`;
      }
    }

    // ==========================================================
    // 📊 إذا لم يتم العثور على نتائج حقيقية
    // ==========================================================
    If (!success || names.length === 0) {
      Return res.status(200).json({
        Success: false,
        Results: [],
        Total: 0,
        Error: lastError || 'لم يتم العثور على نتائج'
      });
    }

    // --- تجهيز النتيجة ---
    Const results = names.map(name => ({
      Name: name,
      Phone: databasePhone,
      Source: source.includes('scrapingapi') ? 'ScrapingAPI' : 'مباشر',
      Provider: provider,
      FormattedDate: new Date().toLocaleDateString('ar-EG')
    }));

    Const finalResponseData = {
      Success: true,
      Results,
      Total: results.length,
      Source: source,
      Cached_at: new Date().toISOString()
    };

    Await cache.put(cacheKey, finalResponseData);
    Return res.status(200).json(finalResponseData);

  } catch (e) {
    Return res.status(500).json({
      Success: false,
      Results: [],
      Total: 0,
      Error: e.message
    });
  }
});

// ==========================================================
// 🚀 تشغيل الخادم
// ==========================================================
App.listen(PORT, '0.0.0.0', () => {
  Console.log(`🚀 تشغيل خادم Node.js على المنفذ ${PORT}`);
});

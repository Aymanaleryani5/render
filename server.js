const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 مفتاح ScrapingAPI الخاص بك
const SCRAPING_API_KEY = '1432f28f4c66602b7020a6f1bf5fd9ba';
const SCRAPING_API_URL = 'https://api.scrapingapi.com';

// 🔗 الرابط المستهدف الذي تريد جلب البيانات منه
const TARGET_DOMAIN = 'https://prox-pj6lsspd3-yemenphoneplus.vercel.app';

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// 🚀 جلب البيانات عبر ScrapingAPI ثم تمريرها إلى الفلاتر
app.all('*', async (req, res) => {
  try {
    // بناء الرابط الكامل للموقع المستهدف
    const targetUrl = `${TARGET_DOMAIN}${req.originalUrl}`;
    
    // إعداد بارامترات ScrapingAPI
    const params = new URLSearchParams({
      api_key: SCRAPING_API_KEY,
      url: targetUrl,
      render: 'true', // لتشغيل JavaScript إذا كان الموقع يستخدمه
      wait: '2000', // انتظار تحميل الصفحة
      country_code: 'us', // تغيير حسب الحاجة
      device_type: 'desktop' // أو 'mobile'
    });

    // إضافة البارامترات حسب نوع الطلب
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      // لطلبات POST، نمرر البيانات كـ query parameters
      params.append('post_data', JSON.stringify(req.body || {}));
      params.append('method', req.method.toLowerCase());
    }

    // إضافة headers مخصصة إذا لزم الأمر
    if (req.headers['user-agent']) {
      params.append('custom_headers', JSON.stringify({
        'User-Agent': req.headers['user-agent']
      }));
    }

    // إرسال الطلب إلى ScrapingAPI
    const scrapingUrl = `${SCRAPING_API_URL}?${params.toString()}`;
    console.log(`📡 جلب البيانات من: ${targetUrl} عبر ScrapingAPI`);

    const response = await fetch(scrapingUrl, {
      method: 'GET', // ScrapingAPI يستخدم GET دائماً مع بارامترات
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    const data = await response.text();

    // محاولة تحويل البيانات إلى JSON للتحقق من صحتها
    try {
      const jsonData = JSON.parse(data);
      // إرجاع البيانات مع تنسيق JSON
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(response.status).json(jsonData);
    } catch (e) {
      // إذا لم تكن البيانات JSON، نعيدها كنص
      res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain; charset=utf-8');
      return res.status(response.status).send(data);
    }

  } catch (error) {
    console.error('❌ خطأ في الاتصال بـ ScrapingAPI:', error.message);
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: 'خطأ في الاتصال بالوسيط: ' + error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Render Proxy with ScrapingAPI running on port ${PORT}`);
  console.log(`🔑 ScrapingAPI Key: ${SCRAPING_API_KEY.substring(0, 8)}...`);
  console.log(`🎯 Target: ${TARGET_DOMAIN}`);
});

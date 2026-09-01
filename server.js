const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔗 رابط Vercel المستهدف
const VERCEL_DOMAIN = 'https://prox-pj6lsspd3-yemenphoneplus.vercel.app';

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// 🚀 جلب البيانات من Vercel وتمريرها مباشرة إلى الفلاتر دون تغيير الرابط على التطبيق
app.all('*', async (req, res) => {
  try {
    const targetUrl = `${VERCEL_DOMAIN}${req.originalUrl}`;

    // إعداد الخيارات لتطبيق طلب GET أو POST حسب ما أرسله الفلاتر
    const fetchOptions = {
      method: req.method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': req.headers['user-agent'] || 'Flutter-App'
      }
    };

    // تمرير بيانات Body إذا كان الطلب POST أو PUT
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && Object.keys(req.body || {}).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    // إرسال الطلب إلى Vercel من خادم Render
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();

    // إرجاع النتيجة للتطبيق مع الحفاظ على نوع المحتوى (JSON)
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.status(response.status).send(data);

  } catch (error) {
    return res.status(500).json({
      success: false,
      results: [],
      total: 0,
      error: 'خطأ في الاتصال بالوسيط: ' + error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Render Reverse Proxy running on port ${PORT}`);
});

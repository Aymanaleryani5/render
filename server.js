const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// 🔗 رابط Vercel الإنتاجي (احرص على إيقاف Deployment Protection من إعدادات Vercel كما موضح بالأسفل)
const VERCEL_DOMAIN = 'https://prox-pj6lsspd3-yemenphoneplus.vercel.app';

// 🚀 توجيه كافّة طلبات GET تلقائياً مع الحفاظ على متغيرات البحث
app.get('*', (req, res) => {
  const targetUrl = `${VERCEL_DOMAIN}${req.originalUrl}`;
  return res.redirect(302, targetUrl);
});

// لمعالجة بقية الأنواع وتحويلها أيضاً لـ GET على Vercel
app.use((req, res) => {
  const targetUrl = `${VERCEL_DOMAIN}${req.originalUrl}`;
  return res.redirect(302, targetUrl);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔄 Redirect server active -> Forwarding GET requests to Vercel`);
});

const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// 🔗 رابط مشروعك الجديد على Vercel
const VERCEL_DOMAIN = 'prox-lpws-1u308gtn4-yemenphoneplus.vercel.app';

// 🚀 توجيه كافّة الطلبات والمسارات تلقائياً إلى Vercel
app.use((req, res) => {
  const targetUrl = `${VERCEL_DOMAIN}${req.originalUrl}`;
  return res.redirect(301, targetUrl);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔄 Redirect server active -> Forwarding to Vercel`);
});

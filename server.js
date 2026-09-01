const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// 🔗 رابط مشروعك على Vercel (بدون https://)
const VERCEL_DOMAIN = 'prox-lpws-1u308gtn4-yemenphoneplus.vercel.app';

// ✅ التوجيه الصحيح مع الحفاظ على المسار
app.use((req, res) => {
  // بناء الرابط الصحيح
  const targetUrl = `https://${VERCEL_DOMAIN}${req.originalUrl}`;
  
  console.log(`🔄 توجيه: ${req.originalUrl} -> ${targetUrl}`);
  
  // إعادة توجيه مع الحفاظ على الطريقة (GET, POST, ...)
  return res.redirect(301, targetUrl);
});

// ✅ التعامل مع مسار البينغ للتأكد من أن الخادم يعمل
app.get('/ping', (req, res) => {
  res.status(200).send('✅ Render redirect server is running!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔄 Redirect server active on port ${PORT}`);
  console.log(`📍 Forwarding to: https://${VERCEL_DOMAIN}`);
});

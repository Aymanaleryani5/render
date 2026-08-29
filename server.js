const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// 🚀 توجيه الطلبات إلى Vercel مباشرة بدون مسار /api/search
app.all('/api/search', (req, res) => {
  const query = req.method === 'GET' ? req.query.query : req.body.query;
  
  if (!query) {
    return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
  }

  // التوجيه إلى رابط Vercel الرئيسي المباشر
  const vercelUrl = `https://prox-alpha-one.vercel.app/?query=${encodeURIComponent(query)}`;
  
  return res.redirect(307, vercelUrl);
});

app.get('/ping', (req, res) => res.status(200).send('OK'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Redirect server running on port ${PORT}`);
});

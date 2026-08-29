const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.all('/api/search', async (req, res) => {
  try {
    const query = req.method === 'GET' ? req.query.query : (req.body ? req.body.query : null);

    if (!query) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
    }

    // 🚀 الاتصال بالمسار الجديد المعتمد داخل مجلد api في Vercel
    const vercelUrl = `https://prox-alpha-one.vercel.app/api/search?query=${encodeURIComponent(query)}`;
    const vercelResponse = await fetch(vercelUrl);

    if (!vercelResponse.ok) {
      return res.status(200).json({ 
        success: false, 
        results: [], 
        total: 0, 
        error: `خطأ من سيرفر Vercel - رمز الاستجابة: ${vercelResponse.status}` 
      });
    }

    const data = await vercelResponse.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      results: [], 
      total: 0, 
      error: `فشل معالجة البيانات: ${error.message}` 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

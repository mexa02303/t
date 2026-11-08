
// Fund My Trip - Express + MongoDB Backend
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.set('trust proxy', 1);

const ADMIN_PATH = process.env.ADMIN_PATH || 'my-secret-panel';
app.get('/' + ADMIN_PATH, (_, res) =>
  res.sendFile(path.join(__dirname, 'private', 'admin.html'))
);

// ---------- Models ----------
const Item = mongoose.model('Item', new mongoose.Schema({
  title: String,
  tagline: String,
  icon: { type: String, default: '🎒' },
  target: { type: Number, default: 1000 },
  raised: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  order: { type: Number, default: 0 }
}));

const Donation = mongoose.model('Donation', new mongoose.Schema({
  itemId: mongoose.Schema.Types.ObjectId,
  itemTitle: String,
  amount: Number,
  name: String,
  email: String,
  message: String,
  utr: { type: String, default: '' },
  status: { type: String, default: 'pending' }
}, { timestamps: true }));

// ---------- Admin Authentication ----------
const SECRET = process.env.TOKEN_SECRET || 'dev-secret';

const sign = (exp) => {
  const p = String(exp);
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('hex');
};

const valid = (t = '') => {
  const [exp, sig] = t.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(exp || '').digest('hex');
  return sig && sig.length === good.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) &&
    Date.now() < +exp;
};

const admin = (req, res, next) =>
  valid((req.headers.authorization || '').replace('Bearer ', ''))
    ? next()
    : res.status(401).json({ error: 'Unauthorized' });

// ---------- Public API ----------
app.get('/api/items', async (_, res) => {
  try {
    res.json(await Item.find({ active: true }).sort('order'));
  } catch (e) {
    res.status(500).json({ error: 'Could not load items' });
  }
});

// Donation submission - UTR IS OPTIONAL
app.post('/api/donations', async (req, res) => {
  try {
    const { itemId, amount, name, email, message, utr } = req.body;

    const item = await Item.findById(itemId);

    if (!item || !(Number(amount) > 0) || !Number.isFinite(Number(amount))) {
      return res.status(400).json({ error: 'Invalid donation' });
    }

    const cleanUtr = String(utr || '').trim();

    if (cleanUtr && !/^[a-zA-Z0-9]{6,30}$/.test(cleanUtr)) {
      return res.status(400).json({
        error: 'UTR must contain 6–30 letters or numbers.'
      });
    }

    await Donation.create({
      itemId,
      itemTitle: item.title,
      amount: Number(amount),
      name: String(name || 'Anonymous').trim(),
      email: String(email || '').trim(),
      message: String(message || '').trim(),
      utr: cleanUtr,
      status: 'pending'
    });

    res.json({
      ok: true,
      message: 'Donation submitted. Waiting for admin verification.'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Donation submission failed' });
  }
});

// ---------- Admin API ----------
const fails = {};

app.post('/api/admin/login', (req, res) => {
  const f = fails[req.ip] = fails[req.ip] || { n: 0, until: 0 };

  if (Date.now() < f.until) {
    return res.status(429).json({
      error: 'Too many attempts. Try again in 15 minutes.'
    });
  }

  if (req.body.password === process.env.ADMIN_PASSWORD) {
    f.n = 0;
    return res.json({ token: sign(Date.now() + 12 * 3600e3) });
  }

  if (++f.n >= 5) {
    f.n = 0;
    f.until = Date.now() + 15 * 60e3;
  }

  res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/admin/items', admin, async (_, res) =>
  res.json(await Item.find().sort('order'))
);

app.get('/api/supporters', async (_, res) => {
  const supporters = await Donation.aggregate([
    { $match: { status: 'verified' } },
    {
      $group: {
        _id: '$name',
        total: { $sum: '$amount' },
        donations: { $sum: 1 },
        lastDonation: { $max: '$createdAt' }
      }
    },
    { $sort: { total: -1, lastDonation: -1 } },
    { $limit: 50 },
    {
      $project: {
        _id: 0,
        name: '$_id',
        total: 1,
        donations: 1,
        lastDonation: 1
      }
    }
  ]);

  res.json(supporters);
});

app.post('/api/admin/items', admin, async (req, res) =>
  res.json(await Item.create(req.body))
);

app.put('/api/admin/items/:id', admin, async (req, res) =>
  res.json(await Item.findByIdAndUpdate(req.params.id, req.body, { new: true }))
);

app.delete('/api/admin/items/:id', admin, async (req, res) => {
  await Item.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ---------- Donations Management ----------
app.get('/api/admin/donations', admin, async (_, res) =>
  res.json(await Donation.find().sort('-createdAt').limit(200))
);

app.post('/api/admin/donations/:id/:action', admin, async (req, res) => {
  const d = await Donation.findById(req.params.id);

  if (!d || d.status !== 'pending') {
    return res.status(400).json({ error: 'Already handled' });
  }

  if (req.params.action === 'verify') {
    d.status = 'verified';
    await Item.findByIdAndUpdate(d.itemId, {
      $inc: { raised: d.amount }
    });
  } else if (req.params.action === 'reject') {
    d.status = 'rejected';
  } else {
    return res.status(400).json({ error: 'Invalid action' });
  }

  await d.save();
  res.json(d);
});

app.put('/api/admin/donations/:id', admin, async (req, res) => {
  const { name, message, amount } = req.body;

  const d = await Donation.findByIdAndUpdate(
    req.params.id,
    { name, message, ...(amount > 0 && { amount }) },
    { new: true }
  );

  res.json(d);
});

app.delete('/api/admin/donations/:id', admin, async (req, res) => {
  await Donation.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ---------- Start + Seed ----------
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    if (!(await Item.countDocuments())) {
      await Item.insertMany([
        { title: 'Camping Tent', tagline: 'A cozy home under the stars', icon: '⛺', target: 8000, raised: 1200, order: 1 },
        { title: 'Hiking Backpack', tagline: 'Carries everything, every mile', icon: '🎒', target: 5000, raised: 2500, order: 2 },
        { title: 'Track Pants & Activewear', tagline: 'Comfy for the long trail', icon: '👖', target: 3000, raised: 800, order: 3 },
        { title: 'Jacket & Boots', tagline: 'Warm and steady on frosty peaks', icon: '🧥', target: 10000, raised: 3100, order: 4 },
        { title: 'Gear (Glasses & Cap)', tagline: 'Sun-proof and style-proof', icon: '🕶️', target: 2000, raised: 450, order: 5 },
        { title: 'Travel Allowance', tagline: 'Food & transport on the road', icon: '🚌', target: 12000, raised: 6950, order: 6 }
      ]);
    }

    app.listen(process.env.PORT || 3000, () =>
      console.log('Running on port ' + (process.env.PORT || 3000))
    );
  })
  .catch(e => {
    console.error('MongoDB connection failed:', e.message);
    process.exit(1);
  });

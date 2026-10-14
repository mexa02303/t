// Fund My Trip - Express + MongoDB backend (also serves the /public frontend)
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static('public'));
const path = require('path');
app.set('trust proxy', 1);
const ADMIN_PATH = process.env.ADMIN_PATH || 'my-secret-panel';
app.get('/' + ADMIN_PATH, (_, res) => res.sendFile(path.join(__dirname, 'private', 'admin.html')));

// ---------- Models ----------
const Item = mongoose.model('Item', new mongoose.Schema({
  title: String, tagline: String,
  icon: { type: String, default: '🎒' },   // emoji OR image URL (e.g. /icons/tent.png)
  target: { type: Number, default: 1000 },
  raised: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
}));
const Donation = mongoose.model('Donation', new mongoose.Schema({
  itemId: mongoose.Schema.Types.ObjectId, itemTitle: String, amount: Number,
  name: String, email: String, message: String,
  status: { type: String, default: 'pending' }, // pending | verified | rejected
}, { timestamps: true }));

// ---------- Tiny signed-token auth (no extra deps) ----------
const SECRET = process.env.TOKEN_SECRET || 'dev-secret';
const sign = (exp) => { const p = String(exp); return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('hex'); };
const valid = (t = '') => {
  const [exp, sig] = t.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(exp || '').digest('hex');
  return sig && sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) && Date.now() < +exp;
};
const admin = (req, res, next) => valid((req.headers.authorization || '').replace('Bearer ', '')) ? next() : res.status(401).json({ error: 'Unauthorized' });

// ---------- Public API ----------
app.get('/api/items', async (_, res) => res.json(await Item.find({ active: true }).sort('order')));

app.post('/api/donations', async (req, res) => {
  const { itemId, amount, name, email, message } = req.body;
  const item = await Item.findById(itemId);
  if (!item || !(amount > 0)) return res.status(400).json({ error: 'Invalid donation' });
  await Donation.create({ itemId, itemTitle: item.title, amount, name: name || 'Anonymous', email, message });
  res.json({ ok: true }); // raised amount only changes after YOU verify it in the admin panel
});

// ---------- Admin API ----------
const fails = {};
app.post('/api/admin/login', (req, res) => {
  const f = fails[req.ip] = fails[req.ip] || { n: 0, until: 0 };
  if (Date.now() < f.until) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (req.body.password === process.env.ADMIN_PASSWORD) { f.n = 0; return res.json({ token: sign(Date.now() + 12 * 3600e3) }); }
  if (++f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60e3; }
  res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/admin/items', admin, async (_, res) => res.json(await Item.find().sort('order')));
app.post('/api/admin/items', admin, async (req, res) => res.json(await Item.create(req.body)));
app.put('/api/admin/items/:id', admin, async (req, res) => res.json(await Item.findByIdAndUpdate(req.params.id, req.body, { new: true })));
app.delete('/api/admin/items/:id', admin, async (req, res) => { await Item.findByIdAndDelete(req.params.id); res.json({ ok: true }); });

app.get('/api/admin/donations', admin, async (_, res) => res.json(await Donation.find().sort('-createdAt').limit(200)));
app.post('/api/admin/donations/:id/:action', admin, async (req, res) => {
  const d = await Donation.findById(req.params.id);
  if (!d || d.status !== 'pending') return res.status(400).json({ error: 'Already handled' });
  if (req.params.action === 'verify') { d.status = 'verified'; await Item.findByIdAndUpdate(d.itemId, { $inc: { raised: d.amount } }); }
  else d.status = 'rejected';
  await d.save(); res.json(d);
});

// ---------- Start + seed ----------
mongoose.connect(process.env.MONGO_URI).then(async () => {
  if (!(await Item.countDocuments())) await Item.insertMany([
    { title: 'Camping Tent', tagline: 'A cozy home under the stars', icon: '⛺', target: 8000, raised: 1200, order: 1 },
    { title: 'Hiking Backpack', tagline: 'Carries everything, every mile', icon: '🎒', target: 5000, raised: 2500, order: 2 },
    { title: 'Track Pants & Activewear', tagline: 'Comfy for the long trail', icon: '👖', target: 3000, raised: 800, order: 3 },
    { title: 'Jacket & Boots', tagline: 'Warm and steady on frosty peaks', icon: '🧥', target: 10000, raised: 3100, order: 4 },
    { title: 'Gear (Glasses & Cap)', tagline: 'Sun-proof and style-proof', icon: '🕶️', target: 2000, raised: 450, order: 5 },
    { title: 'Travel Allowance', tagline: 'Food & transport on the road', icon: '🚌', target: 12000, raised: 6950, order: 6 },
  ]);
  app.listen(process.env.PORT || 3000, () => console.log('Running on http://localhost:' + (process.env.PORT || 3000)));
}).catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });

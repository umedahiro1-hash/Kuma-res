try { require('dotenv').config(); } catch (e) { /* dotenv is optional; Vercel/production injects env vars directly */ }

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const db = require('./db');

const PORT = process.env.PORT || 8787;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const INDEX_HTML_PATH = path.join(FRONTEND_DIR, 'index.html');
const app = express();
app.use(compression());
app.use(express.json({ limit: '4mb' }));

// ---------- SPA ルートごとの meta タグ差し替え（実URLでの共有・クロール対応） ----------

const ROUTE_META = {
  '/': { title: 'つながるくまもと｜熊本地震 被災者支援・安否確認・物資マッチングアプリ', description: '熊本地震の被災者支援アプリ「つながるくまもと」。物資の譲渡・募集、安否確認、迷子ペットの捜索、熊本地震関連の最新ニュースを一つのアプリで。' },
  '/support': { title: '物資の支援｜つながるくまもと', description: '水・食料・毛布などの物資を無料または有料でゆずる・もとめる掲示板。' },
  '/find': { title: 'さがす（安否確認）｜つながるくまもと', description: '熊本地震の被災者の安否確認・情報共有掲示板。氏名は一部伏せ字表示、電話番号照合で本人確認します。' },
  '/pets': { title: 'ペットを探す｜つながるくまもと', description: 'はぐれてしまったペットの捜索・目撃情報共有掲示板。' },
  '/news': { title: 'ニュース｜つながるくまもと', description: '熊本地震に関する最新ニュースをまとめて表示します。' },
  '/board': { title: '掲示板｜つながるくまもと', description: 'みんなの声・情報交換掲示板。ログイン不要でスレッドを立て、匿名でコメントできます。' },
  '/gov': { title: '行政からのお知らせ｜つながるくまもと', description: '自治体・行政からのお知らせを掲載。給水・避難所・罹災証明など最新情報をお届けします。' },
};

function renderIndexForRoute(pathname) {
  const meta = ROUTE_META[pathname] || ROUTE_META['/'];
  let html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${meta.title}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${meta.description}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${meta.title}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${meta.description}$2`);
  return html;
}

Object.keys(ROUTE_META).forEach((routePath) => {
  app.get(routePath, (req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send(renderIndexForRoute(routePath));
  });
});

// 管理者ページ（行政お知らせの承認）: 一般公開の導線には含めず、検索エンジンにも案内しない
app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store').type('html').send(fs.readFileSync(INDEX_HTML_PATH, 'utf8'));
});

app.use(express.static(FRONTEND_DIR, {
  setHeaders: (res, filePath) => {
    res.set('Cache-Control', filePath.endsWith('.html') ? 'no-store' : 'public, max-age=86400');
  },
}));

// ---------- 画像アップロード（Supabase Storage / ローカルディスクの二択） ----------
// SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が設定されていれば Supabase Storage に保存し、
// 公開URLを返す（Vercel などサーバーレス環境ではローカルディスクが永続化されないため必須）。
// 未設定の場合はローカル開発用に backend/uploads/ に保存する。

const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 3 * 1024 * 1024); // Vercelの本文サイズ上限(既定4.5MB)を考慮しbase64化後も収まる値に

const USE_SUPABASE_STORAGE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';
let supabaseClient = null;
if (USE_SUPABASE_STORAGE) {
  const { createClient } = require('@supabase/supabase-js');
  supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.warn('[uploads] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未設定のため、ローカルの backend/uploads/ に画像を保存します。Vercel等サーバーレス環境ではファイルが永続化されないため、本番では必ず設定してください。');
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    immutable: true,
    maxAge: '30d',
  }));
}

async function saveDataUrlImage(dataUrl, subdir) {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(dataUrl);
  if (!match) throw Object.assign(new Error('画像の形式が不正です（png/jpeg/webp/gifのみ）'), { status: 400 });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error(`画像サイズは${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB以内にしてください`), { status: 400 });

  const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;

  if (USE_SUPABASE_STORAGE) {
    const objectPath = `${subdir}/${filename}`;
    const { error } = await supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET).upload(objectPath, buffer, {
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      upsert: false,
    });
    if (error) throw Object.assign(new Error('画像のアップロードに失敗しました: ' + error.message), { status: 500 });
    const { data } = supabaseClient.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(objectPath);
    return data.publicUrl;
  }

  const dir = path.join(__dirname, 'uploads', subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${subdir}/${filename}`;
}

// ---------- メール送信（Resend / 未設定時はシミュレーション） ----------
// RESEND_API_KEY と EMAIL_FROM が設定されていれば実際に送信する。未設定の場合は
// コンソールにログを出すだけの「送信したふり」に留める（デモ・ローカル開発向け）。

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'notifications@example.com';

async function sendEmail({ to, subject, text }) {
  if (!RESEND_API_KEY) {
    console.log(`[email:simulated] to=${to} subject="${subject}"\n${text}`);
    return { sent: false, simulated: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: `つながるくまもと <${EMAIL_FROM}>`, to, subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email] Resend送信失敗', res.status, body);
      return { sent: false, simulated: false, error: true };
    }
    return { sent: true, simulated: false };
  } catch (e) {
    console.error('[email] Resend送信エラー', e);
    return { sent: false, simulated: false, error: true };
  }
}

// ---------- SMS送信（Twilio優先 / なければTextbelt / どちらも未設定ならシミュレーション） ----------
// Twilio (https://www.twilio.com) が設定されていれば優先的に使用する（有料・従量課金、日本向け実績あり）。
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER の3つがすべて設定されている場合のみ使用。
//
// Twilio未設定の場合は Textbelt (https://textbelt.com) にフォールバックする。
// 無料の共有クォータキー 'textbelt' は「サーバーのIPアドレスごとに1日1通」という
// 非常に厳しい制限があり、本格運用（複数ユーザーの同時登録）には全く足りない。

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';
const USE_TWILIO = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);

const TEXTBELT_API_KEY = process.env.TEXTBELT_API_KEY || 'textbelt';
const TEXTBELT_DISABLED = process.env.TEXTBELT_DISABLED === '1';

async function sendSmsViaTwilio({ to, message }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: message });
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.sid) {
    console.error('[sms] Twilio送信失敗', res.status, data);
    return { sent: false, simulated: false, error: true, detail: data && data.message };
  }
  console.log(`[sms] Twilio送信成功 sid=${data.sid} status=${data.status}`);
  return { sent: true, simulated: false };
}

async function sendSms({ to, message }) {
  if (USE_TWILIO) {
    try {
      return await sendSmsViaTwilio({ to, message });
    } catch (e) {
      console.error('[sms] Twilio送信エラー', e);
      return { sent: false, simulated: false, error: true };
    }
  }
  if (TEXTBELT_DISABLED) {
    console.log(`[sms:simulated] to=${to}\n${message}`);
    return { sent: false, simulated: true };
  }
  try {
    const res = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: to, message, key: TEXTBELT_API_KEY }),
    });
    const body = await res.json().catch(() => null);
    if (!body || !body.success) {
      console.error('[sms] Textbelt送信失敗', body);
      return { sent: false, simulated: false, error: true, detail: body && body.error };
    }
    console.log(`[sms] Textbelt送信成功 quotaRemaining=${body.quotaRemaining}`);
    return { sent: true, simulated: false, quotaRemaining: body.quotaRemaining };
  } catch (e) {
    console.error('[sms] Textbelt送信エラー', e);
    return { sent: false, simulated: false, error: true };
  }
}

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: /sitemap.xml\n');
});

app.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const urls = Object.keys(ROUTE_META).map(p => `  <url><loc>${base}${p}</loc></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});

// ---------- helpers ----------

// デモ用の管理者パスワード（本番では環境変数で必ず上書きすること）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'kumamoto-admin-2026';

function requireAdmin(req, res, next) {
  if (req.get('x-admin-password') !== ADMIN_PASSWORD) return res.status(401).json({ error: '管理者パスワードが正しくありません' });
  next();
}

function normTel(s) {
  return (s || '').replace(/[^0-9]/g, '');
}

function maskName(n) {
  const c = [...(n || '')];
  if (c.length <= 1) return c[0] || '※';
  if (c.length === 2) return c[0] + '※';
  return c[0] + '※'.repeat(c.length - 2) + c[c.length - 1];
}

async function getProfiles() {
  const rows = await db.prepare('SELECT * FROM profiles').all();
  const out = {};
  rows.forEach(r => { out[r.name] = { name: r.name, city: r.city, photoPath: r.photo_path, completed: r.completed, noshow: r.noshow, praises: r.praises }; });
  return out;
}

function serializeProfile(row) {
  if (!row) return null;
  return { name: row.name, phone: row.phone, city: row.city, photoPath: row.photo_path };
}

function normPhone(s) {
  return (s || '').replace(/[^0-9]/g, '');
}

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function serializeGoods(id) {
  const g = await db.prepare('SELECT * FROM goods WHERE id = ?').get(id);
  if (!g) return null;
  const applicants = await db.prepare('SELECT nick, msg, at FROM applicants WHERE goods_id = ? ORDER BY at ASC').all(id);
  const chat = await db.prepare('SELECT from_nick as "from", text, at FROM goods_chat WHERE goods_id = ? ORDER BY at ASC').all(id);
  const dealRow = await db.prepare('SELECT * FROM deals WHERE goods_id = ?').get(id);
  const reviewRows = await db.prepare('SELECT reviewer_nick, star FROM reviews WHERE goods_id = ?').all(id);
  const reviewed = {};
  reviewRows.forEach(r => { reviewed[r.reviewer_nick] = r.star; });

  let deal = null;
  if (dealRow) {
    deal = {
      partner: dealRow.partner,
      owner: dealRow.owner,
      place: dealRow.place,
      date: dealRow.date,
      time: dealRow.time,
      giverDone: !!dealRow.giver_done,
      takerDone: !!dealRow.taker_done,
      reviewed,
    };
  }

  return {
    id: g.id,
    type: g.type,
    cat: g.cat,
    district: g.district,
    place: g.place,
    title: g.title,
    qty: g.qty,
    when: g.when_text,
    nick: g.nick,
    status: g.status,
    isFree: !!g.is_free,
    price: g.price,
    imagePath: g.image_path,
    chat,
    applicants,
    deal,
    created: Number(g.created),
    updated: Number(g.updated),
  };
}

function giverNick(goods) {
  return goods.type === 'offer' ? goods.nick : goods.deal.partner;
}
function takerNick(goods) {
  return goods.type === 'offer' ? goods.deal.partner : goods.nick;
}
function isParticipant(goods, me) {
  if (goods.nick === me) return true;
  if (goods.deal && (goods.deal.partner === me || goods.deal.owner === me)) return true;
  if (goods.applicants.some(a => a.nick === me)) return true;
  return false;
}

// 支援(物資)のチャットで新着メッセージをSMS通知する。
// 申し出者→投稿者への発言は常に投稿者へ通知。
// 投稿者→の発言は、予約相手が確定していればその相手のみ、未確定なら現在の申し出者全員に通知する
// （申し出者が複数いる可能性があり、誰に向けた発言か機械的には判別できないため）。
async function notifyGoodsChatSms(goods, senderNick, text) {
  let recipientNicks;
  if (senderNick === goods.nick) {
    recipientNicks = goods.deal ? [goods.deal.partner] : goods.applicants.map(a => a.nick);
  } else {
    recipientNicks = [goods.nick];
  }
  recipientNicks = [...new Set(recipientNicks)].filter(n => n && n !== senderNick);
  if (!recipientNicks.length) return;

  const message = `【つながるくまもと】${senderNick}さんから新しいメッセージが届きました。\n\n${text}\n\nアプリでご確認ください。`;
  for (const nick of recipientNicks) {
    const profile = await db.prepare('SELECT phone FROM profiles WHERE name = ?').get(nick);
    if (!profile || !profile.phone) continue;
    await sendSms({ to: toIntlPhone(profile.phone), message });
  }
}

async function requireUser(req, res, next) {
  try {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'ログインが必要です' });
    const session = await db.prepare('SELECT name FROM sessions WHERE token = ?').get(token);
    if (!session) return res.status(401).json({ error: 'セッションが無効です。再度ログインしてください' });
    const profile = await db.prepare('SELECT name FROM profiles WHERE name = ?').get(session.name);
    if (!profile) return res.status(401).json({ error: 'アカウントが見つかりません' });
    req.me = session.name;
    next();
  } catch (e) {
    next(e);
  }
}

// Express の非同期ルートハンドラで例外を確実に catch → next(e) に流すための小さなラッパー。
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------- profiles ----------

app.get('/api/profiles', ah(async (req, res) => {
  res.json(await getProfiles());
}));

function toIntlPhone(phone) {
  return '+81' + normPhone(phone).replace(/^0/, '');
}

// ---------- auth（電話番号＋SMS認証＋パスワード） ----------

const OTP_TTL_MS = 5 * 60 * 1000;

app.post('/api/auth/request-otp', ah(async (req, res) => {
  const phone = normPhone(req.body && req.body.phone);
  if (phone.length < 10 || phone.length > 11) return res.status(400).json({ error: '正しい電話番号を入力してください' });
  const code = genOtp();
  await db.prepare(`INSERT INTO otp_codes (phone, code, expires) VALUES (?,?,?)
    ON CONFLICT(phone) DO UPDATE SET code=excluded.code, expires=excluded.expires`)
    .run(phone, code, Date.now() + OTP_TTL_MS);

  const smsResult = await sendSms({
    to: toIntlPhone(phone),
    message: `【つながるくまもと】認証コード: ${code}（5分間有効）`,
  });

  // 実際にSMS送信できた場合はコードを画面に出さない。未設定/失敗時のみ開発用に返す
  const payload = { sent: smsResult.sent || smsResult.simulated, phone };
  if (!smsResult.sent) payload.devCode = code;
  res.json(payload);
}));

app.post('/api/auth/register', ah(async (req, res) => {
  const { phone: rawPhone, code, password, nickname, city, photoDataUrl } = req.body || {};
  const phone = normPhone(rawPhone);
  if (phone.length < 10 || phone.length > 11) return res.status(400).json({ error: '正しい電話番号を入力してください' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'パスワードは8文字以上で入力してください' });
  const name = (nickname || '').trim();
  if (!name) return res.status(400).json({ error: '氏名（ニックネーム可）を入力してください' });

  const otp = await db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone);
  if (!otp || otp.code !== String(code) || Number(otp.expires) < Date.now()) {
    return res.status(400).json({ error: '認証コードが正しくないか、有効期限が切れています' });
  }
  if (await db.prepare('SELECT name FROM profiles WHERE phone = ?').get(phone)) {
    return res.status(409).json({ error: 'この電話番号はすでに登録されています' });
  }
  if (await db.prepare('SELECT name FROM profiles WHERE name = ?').get(name)) {
    return res.status(409).json({ error: 'このニックネームはすでに使われています' });
  }

  let photoPath = null;
  try {
    photoPath = await saveDataUrlImage(photoDataUrl, 'profiles');
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const { salt, hash } = db.hashPassword(password);
  await db.prepare(`INSERT INTO profiles (name, phone, password_hash, salt, city, photo_path, completed, noshow, praises)
    VALUES (?,?,?,?,?,?,0,0,0)`).run(name, phone, hash, salt, (city || '').trim(), photoPath);
  await db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);

  const token = genToken();
  await db.prepare('INSERT INTO sessions (token, name, created) VALUES (?,?,?)').run(token, name, Date.now());
  res.status(201).json({ token, profile: serializeProfile(await db.prepare('SELECT * FROM profiles WHERE name = ?').get(name)) });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const phone = normPhone(req.body && req.body.phone);
  const password = (req.body && req.body.password) || '';
  const profile = await db.prepare('SELECT * FROM profiles WHERE phone = ?').get(phone);
  if (!profile || !profile.password_hash || !db.verifyPassword(password, profile.salt, profile.password_hash)) {
    return res.status(401).json({ error: '電話番号またはパスワードが正しくありません' });
  }
  const token = genToken();
  await db.prepare('INSERT INTO sessions (token, name, created) VALUES (?,?,?)').run(token, profile.name, Date.now());
  res.json({ token, profile: serializeProfile(profile) });
}));

app.post('/api/auth/logout', requireUser, ah(async (req, res) => {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
}));

app.get('/api/me', requireUser, ah(async (req, res) => {
  res.json(serializeProfile(await db.prepare('SELECT * FROM profiles WHERE name = ?').get(req.me)));
}));

app.post('/api/me', requireUser, ah(async (req, res) => {
  const { nickname, city, photoDataUrl } = req.body || {};
  const current = await db.prepare('SELECT * FROM profiles WHERE name = ?').get(req.me);
  const newName = nickname !== undefined ? String(nickname).trim() : current.name;
  if (!newName) return res.status(400).json({ error: '氏名（ニックネーム可）を入力してください' });

  if (newName !== current.name && await db.prepare('SELECT name FROM profiles WHERE name = ?').get(newName)) {
    return res.status(409).json({ error: 'このニックネームはすでに使われています' });
  }

  let photoPath = current.photo_path;
  if (photoDataUrl) {
    try {
      photoPath = await saveDataUrlImage(photoDataUrl, 'profiles');
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }
  const newCity = city !== undefined ? String(city).trim() : current.city;

  const rename = db.transaction(async (txDb, oldName, name) => {
    await txDb.prepare('UPDATE profiles SET name = ?, city = ?, photo_path = ? WHERE name = ?').run(name, newCity, photoPath, oldName);
    if (name !== oldName) {
      await txDb.prepare('UPDATE goods SET nick = ? WHERE nick = ?').run(name, oldName);
      await txDb.prepare('UPDATE applicants SET nick = ? WHERE nick = ?').run(name, oldName);
      await txDb.prepare('UPDATE goods_chat SET from_nick = ? WHERE from_nick = ?').run(name, oldName);
      await txDb.prepare('UPDATE deals SET partner = ? WHERE partner = ?').run(name, oldName);
      await txDb.prepare('UPDATE deals SET owner = ? WHERE owner = ?').run(name, oldName);
      await txDb.prepare('UPDATE reviews SET reviewer_nick = ? WHERE reviewer_nick = ?').run(name, oldName);
      await txDb.prepare('UPDATE reviews SET target_nick = ? WHERE target_nick = ?').run(name, oldName);
      await txDb.prepare('UPDATE sessions SET name = ? WHERE name = ?').run(name, oldName);
    }
  });
  await rename(current.name, newName);

  res.json(serializeProfile(await db.prepare('SELECT * FROM profiles WHERE name = ?').get(newName)));
}));

// ---------- goods ----------

app.get('/api/goods', ah(async (req, res) => {
  const ids = (await db.prepare('SELECT id FROM goods ORDER BY created DESC').all()).map(r => r.id);
  res.json(await Promise.all(ids.map(serializeGoods)));
}));

app.post('/api/goods', requireUser, ah(async (req, res) => {
  const { type, cat, title, qty, place, when, isFree, price, imageDataUrl } = req.body || {};
  if (!['offer', 'request'].includes(type)) return res.status(400).json({ error: 'type が不正です' });
  if (!title || !qty) return res.status(400).json({ error: 'title と qty は必須です' });

  const free = type === 'offer' ? isFree !== false : true;
  let priceValue = null;
  if (!free) {
    priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) return res.status(400).json({ error: '無料でない場合は価格を入力してください' });
    priceValue = Math.round(priceValue);
  }

  let imagePath = null;
  try {
    imagePath = await saveDataUrlImage(imageDataUrl, 'goods');
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const now = Date.now();
  const id = 'g' + now + Math.random().toString(36).slice(2, 6);
  await db.prepare(`INSERT INTO goods (id, type, cat, district, place, title, qty, when_text, nick, status, is_free, price, image_path, created, updated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, type, cat || 'その他', '中央区', place || '応相談', title, qty, when || '応相談', req.me, 'open', free ? 1 : 0, priceValue, imagePath, now, now);

  res.status(201).json(await serializeGoods(id));
}));

app.post('/api/goods/:id/apply', requireUser, ah(async (req, res) => {
  const goods = await serializeGoods(req.params.id);
  if (!goods) return res.status(404).json({ error: '投稿が見つかりません' });
  if (goods.status !== 'open') return res.status(409).json({ error: 'この投稿は募集中ではありません' });
  if (goods.nick === req.me) return res.status(400).json({ error: '自分の投稿には申し出できません' });
  if (goods.applicants.some(a => a.nick === req.me)) return res.status(409).json({ error: 'すでに申し出済みです' });

  const msg = (req.body && req.body.msg) || '';
  const now = Date.now();
  await db.prepare('INSERT INTO applicants (goods_id, nick, msg, at) VALUES (?,?,?,?)').run(goods.id, req.me, msg, now);
  const text = msg || (goods.type === 'request' ? '提供できます。' : '受け取りを希望します。');
  await db.prepare('INSERT INTO goods_chat (goods_id, from_nick, text, at) VALUES (?,?,?,?)').run(goods.id, req.me, text, now);
  await db.prepare('UPDATE goods SET status = ?, updated = ? WHERE id = ?').run('nego', now, goods.id);
  await notifyGoodsChatSms(goods, req.me, text);

  res.json(await serializeGoods(goods.id));
}));

app.post('/api/goods/:id/chat', requireUser, ah(async (req, res) => {
  const goods = await serializeGoods(req.params.id);
  if (!goods) return res.status(404).json({ error: '投稿が見つかりません' });
  if (goods.status === 'done') return res.status(409).json({ error: 'この取引は完了しています' });
  const canChat = goods.status !== 'open' || goods.applicants.some(a => a.nick === req.me) || goods.nick === req.me;
  if (!canChat) return res.status(403).json({ error: 'この投稿にはまだ参加していません' });

  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'メッセージを入力してください' });

  const now = Date.now();
  await db.prepare('INSERT INTO goods_chat (goods_id, from_nick, text, at) VALUES (?,?,?,?)').run(goods.id, req.me, text, now);
  await db.prepare('UPDATE goods SET updated = ? WHERE id = ?').run(now, goods.id);
  await notifyGoodsChatSms(goods, req.me, text);

  res.json(await serializeGoods(goods.id));
}));

app.post('/api/goods/:id/appointment', requireUser, ah(async (req, res) => {
  const goods = await serializeGoods(req.params.id);
  if (!goods) return res.status(404).json({ error: '投稿が見つかりません' });
  if (goods.nick !== req.me) return res.status(403).json({ error: '投稿者のみ予約を確定できます' });
  if (goods.status !== 'nego') return res.status(409).json({ error: '交渉中の投稿のみ予約できます' });

  const { partner, place, date, time } = req.body || {};
  if (!partner || !place || !date || !time) return res.status(400).json({ error: '場所・日時・相手は必須です' });
  if (!goods.applicants.some(a => a.nick === partner)) return res.status(400).json({ error: '申し出のない相手は指定できません' });

  const now = Date.now();
  await db.prepare(`INSERT INTO deals (goods_id, partner, owner, place, date, time, giver_done, taker_done)
    VALUES (?,?,?,?,?,?,0,0)
    ON CONFLICT(goods_id) DO UPDATE SET partner=excluded.partner, owner=excluded.owner, place=excluded.place, date=excluded.date, time=excluded.time, giver_done=0, taker_done=0`)
    .run(goods.id, partner, goods.nick, place, date, time);
  await db.prepare('UPDATE goods SET status = ?, updated = ? WHERE id = ?').run('reserved', now, goods.id);
  await db.prepare('INSERT INTO goods_chat (goods_id, from_nick, text, at) VALUES (?,?,?,?)')
    .run(goods.id, req.me, `予約しました：${date} ${time} ＠${place}`, now);

  res.json(await serializeGoods(goods.id));
}));

app.post('/api/goods/:id/confirm', requireUser, ah(async (req, res) => {
  const goods = await serializeGoods(req.params.id);
  if (!goods) return res.status(404).json({ error: '投稿が見つかりません' });
  if (goods.status !== 'reserved' || !goods.deal) return res.status(409).json({ error: '予約済みの投稿のみ確認できます' });

  const role = req.body && req.body.role;
  if (!['giver', 'taker'].includes(role)) return res.status(400).json({ error: 'role が不正です' });

  const giver = giverNick(goods);
  const taker = takerNick(goods);
  if (role === 'giver' && req.me !== giver) return res.status(403).json({ error: '渡す側のみ操作できます' });
  if (role === 'taker' && req.me !== taker) return res.status(403).json({ error: '受け取る側のみ操作できます' });

  const now = Date.now();
  if (role === 'giver') await db.prepare('UPDATE deals SET giver_done = 1 WHERE goods_id = ?').run(goods.id);
  if (role === 'taker') await db.prepare('UPDATE deals SET taker_done = 1 WHERE goods_id = ?').run(goods.id);
  await db.prepare('UPDATE goods SET updated = ? WHERE id = ?').run(now, goods.id);

  const dealRow = await db.prepare('SELECT giver_done, taker_done FROM deals WHERE goods_id = ?').get(goods.id);
  let bothDone = false;
  if (dealRow.giver_done && dealRow.taker_done) {
    bothDone = true;
    await db.prepare('UPDATE goods SET status = ? WHERE id = ?').run('done', goods.id);
    await db.prepare('UPDATE profiles SET completed = completed + 1 WHERE name = ?').run(giver);
    await db.prepare('UPDATE profiles SET completed = completed + 1 WHERE name = ?').run(taker);
  }

  res.json({ goods: await serializeGoods(goods.id), bothDone });
}));

app.post('/api/goods/:id/review', requireUser, ah(async (req, res) => {
  const goods = await serializeGoods(req.params.id);
  if (!goods) return res.status(404).json({ error: '投稿が見つかりません' });
  if (goods.status !== 'done' || !goods.deal) return res.status(409).json({ error: '受渡完了後のみ評価できます' });
  if (!isParticipant(goods, req.me)) return res.status(403).json({ error: '取引の当事者のみ評価できます' });
  if (goods.deal.reviewed[req.me]) return res.status(409).json({ error: 'すでに評価済みです' });

  const star = Number(req.body && req.body.star);
  if (!Number.isInteger(star) || star < 1 || star > 5) return res.status(400).json({ error: 'star は1〜5で指定してください' });
  const msg = (req.body && req.body.msg) || '';

  const otherParty = goods.nick === req.me ? goods.deal.partner : goods.nick;
  const now = Date.now();
  await db.prepare('INSERT INTO reviews (goods_id, reviewer_nick, target_nick, star, msg, at) VALUES (?,?,?,?,?,?)')
    .run(goods.id, req.me, otherParty, star, msg, now);

  if (star >= 4) await db.prepare('UPDATE profiles SET praises = praises + 1 WHERE name = ?').run(otherParty);

  res.json(await serializeGoods(goods.id));
}));

app.post('/api/goods/:id/no-show', requireUser, ah(async (req, res) => {
  const goods = await serializeGoods(req.params.id);
  if (!goods) return res.status(404).json({ error: '投稿が見つかりません' });
  if (goods.status !== 'reserved' || !goods.deal) return res.status(409).json({ error: '予約済みの投稿のみ報告できます' });
  if (!isParticipant(goods, req.me)) return res.status(403).json({ error: '取引の当事者のみ報告できます' });

  const otherParty = goods.nick === req.me ? goods.deal.partner : goods.nick;
  await db.prepare('UPDATE profiles SET noshow = noshow + 1 WHERE name = ?').run(otherParty);

  const now = Date.now();
  await db.prepare('DELETE FROM applicants WHERE goods_id = ? AND nick = ?').run(goods.id, goods.deal.partner);
  await db.prepare('DELETE FROM deals WHERE goods_id = ?').run(goods.id);
  await db.prepare('UPDATE goods SET status = ?, updated = ? WHERE id = ?').run('open', now, goods.id);

  res.json(await serializeGoods(goods.id));
}));

app.post('/api/goods/:id/cancel', requireUser, ah(async (req, res) => {
  const goods = await serializeGoods(req.params.id);
  if (!goods) return res.status(404).json({ error: '投稿が見つかりません' });
  if (goods.status !== 'reserved') return res.status(409).json({ error: '予約済みの投稿のみキャンセルできます' });
  if (!isParticipant(goods, req.me)) return res.status(403).json({ error: '取引の当事者のみキャンセルできます' });

  const now = Date.now();
  await db.prepare('DELETE FROM deals WHERE goods_id = ?').run(goods.id);
  await db.prepare('UPDATE goods SET status = ?, updated = ? WHERE id = ?').run('open', now, goods.id);

  res.json(await serializeGoods(goods.id));
}));

// ---------- persons (find board) ----------

async function serializePersonListItem(p) {
  // 一覧APIは内容を含まない件数のみ返す（本文は本人確認(verify)後にしか渡さない）
  const messageCount = (await db.prepare('SELECT COUNT(*) c FROM person_messages WHERE person_id = ?').get(p.id)).c;
  return {
    id: p.id,
    maskedName: maskName(p.name),
    pref: p.pref,
    city: p.city,
    status: p.status,
    created: Number(p.created),
    messageCount: Number(messageCount),
  };
}

app.get('/api/persons', ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM persons ORDER BY created DESC').all();
  res.json(await Promise.all(rows.map(serializePersonListItem)));
}));

app.post('/api/persons', ah(async (req, res) => {
  const { name, mobile, home, pref, city, email, requester, photoDataUrl } = req.body || {};
  if (!name) return res.status(400).json({ error: 'お名前を入力してください' });
  if (!mobile && !home) return res.status(400).json({ error: '携帯か自宅、どちらかの電話番号が必要です' });
  if (!email || !email.includes('@')) return res.status(400).json({ error: '通知用メールアドレスを入力してください' });

  let photoPath = null;
  try {
    photoPath = await saveDataUrlImage(photoDataUrl, 'persons');
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
  await db.prepare(`INSERT INTO persons (id, name, mobile, home, pref, city, email, requester, status, photo_path, created)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, name, mobile || '', home || '', pref || '熊本県', city || '', email, requester || '', 'wait', photoPath, Date.now());

  const p = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
  res.status(201).json(await serializePersonListItem(p));
}));

app.post('/api/persons/:id/verify', ah(async (req, res) => {
  const p = await db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '見つかりません' });

  const inp = normTel(req.body && req.body.phone);
  if (!inp) return res.status(400).json({ error: '電話番号を入力してください' });
  const ok = (p.mobile && normTel(p.mobile) === inp) || (p.home && normTel(p.home) === inp);
  if (!ok) return res.status(403).json({ error: '一致しませんでした。番号をご確認ください' });

  const messages = await db.prepare('SELECT from_text as "from", text, at FROM person_messages WHERE person_id = ? ORDER BY at DESC').all(p.id);
  res.json({
    id: p.id,
    name: p.name,
    mobile: p.mobile,
    home: p.home,
    pref: p.pref,
    city: p.city,
    email: p.email,
    requester: p.requester,
    status: p.status,
    photoPath: p.photo_path,
    created: Number(p.created),
    messages,
  });
}));

app.post('/api/persons/:id/message', ah(async (req, res) => {
  const p = await db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '見つかりません' });

  const inp = normTel(req.body && req.body.phone);
  const ok = inp && ((p.mobile && normTel(p.mobile) === inp) || (p.home && normTel(p.home) === inp));
  if (!ok) return res.status(403).json({ error: '本人確認（電話番号照合）が必要です' });

  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'メッセージを入力してください' });
  const from = (req.body && req.body.from || '').trim() || '情報提供者';

  await db.prepare('INSERT INTO person_messages (person_id, from_text, text, at) VALUES (?,?,?,?)').run(p.id, from, text, Date.now());
  await db.prepare('UPDATE persons SET status = ? WHERE id = ?').run('ok', p.id);

  const emailResult = await sendEmail({
    to: p.email,
    subject: `【つながるくまもと】${p.name}さんに関する情報が届きました`,
    text: `${from}さんから、以下の情報が届きました。\n\n${text}\n\n詳細はアプリでご確認ください。`,
  });

  res.json({ notified: emailResult.sent || emailResult.simulated, person: await serializePersonListItem(await db.prepare('SELECT * FROM persons WHERE id = ?').get(p.id)) });
}));

// ---------- news (熊本地震関連) ----------

const NEWS_QUERY = '熊本地震';
const NEWS_CACHE_TTL_MS = 10 * 60 * 1000;
let newsCache = { items: [], fetchedAt: 0 };

function decodeEntities(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

async function fetchKumamotoNews() {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(NEWS_QUERY)}&hl=ja&gl=JP&ceid=JP:ja`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`news fetch failed: ${res.status}`);
  const xml = await res.text();

  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < 20) {
    const block = m[1];
    const titleRaw = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const source = sourceMatch ? decodeEntities(sourceMatch[1]) : '';
    let title = decodeEntities(titleRaw);
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    items.push({
      title,
      link: decodeEntities(link),
      source,
      publishedAt: pubDate ? new Date(pubDate).getTime() : null,
    });
  }
  items.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return items;
}

app.get('/api/news', ah(async (req, res) => {
  const now = Date.now();
  if (newsCache.items.length && now - newsCache.fetchedAt < NEWS_CACHE_TTL_MS) {
    return res.json({ items: newsCache.items, fetchedAt: newsCache.fetchedAt, stale: false });
  }
  try {
    const items = await fetchKumamotoNews();
    newsCache = { items, fetchedAt: now };
    res.json({ items, fetchedAt: now, stale: false });
  } catch (e) {
    if (newsCache.items.length) {
      return res.json({ items: newsCache.items, fetchedAt: newsCache.fetchedAt, stale: true });
    }
    res.json({ items: [], fetchedAt: null, stale: true, error: 'ニュースを取得できませんでした' });
  }
}));

// ---------- pets（ペットを探す・非ログイン利用） ----------

function serializePetItem(row, messages) {
  return {
    id: row.id,
    type: row.type,
    species: row.species,
    breed: row.breed,
    gender: row.gender,
    city: row.city,
    location: row.location,
    photoPath: row.photo_path,
    characteristics: row.characteristics,
    status: row.status,
    messages,
    created: Number(row.created),
  };
}

async function loadPetItem(id) {
  const row = await db.prepare('SELECT * FROM pets WHERE id = ?').get(id);
  if (!row) return null;
  const messages = await db.prepare('SELECT from_text as "from", text, at FROM pet_messages WHERE pet_id = ? ORDER BY at DESC').all(row.id);
  return serializePetItem(row, messages);
}

app.get('/api/pets', ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM pets ORDER BY created DESC').all();
  const withMessages = await Promise.all(rows.map(async (row) => {
    const messages = await db.prepare('SELECT from_text as "from", text, at FROM pet_messages WHERE pet_id = ? ORDER BY at DESC').all(row.id);
    return serializePetItem(row, messages);
  }));
  res.json(withMessages);
}));

app.post('/api/pets', ah(async (req, res) => {
  const { type, species, breed, gender, city, location, photoDataUrl, email, characteristics } = req.body || {};
  if (!['lost', 'sighting'].includes(type)) return res.status(400).json({ error: '「さがしています」か「見かけました」を選択してください' });
  if (!['dog', 'cat', 'other'].includes(species)) return res.status(400).json({ error: '種類（犬・猫・その他）を選択してください' });
  if (!breed) return res.status(400).json({ error: species === 'dog' ? '犬種を入力してください' : species === 'cat' ? '猫種を入力してください' : '種類の詳細を入力してください' });
  if (!['male', 'female', 'unknown'].includes(gender)) return res.status(400).json({ error: '性別を選択してください' });
  if (!(city || '').trim()) return res.status(400).json({ error: '市区町村を選択してください' });
  if (!location) return res.status(400).json({ error: '詳細な場所を入力してください' });
  if (!email || !email.includes('@')) return res.status(400).json({ error: '連絡先のメールアドレスを入力してください' });

  let photoPath = null;
  try {
    photoPath = await saveDataUrlImage(photoDataUrl, 'pets');
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  if (!photoPath) return res.status(400).json({ error: '写真を選択してください' });

  const id = 'pet' + Date.now() + Math.random().toString(36).slice(2, 6);
  await db.prepare(`INSERT INTO pets (id, type, species, breed, gender, city, location, photo_path, email, characteristics, status, created)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, type, species, breed, gender, city.trim(), location, photoPath, email, characteristics || '', 'wait', Date.now());

  res.status(201).json(await loadPetItem(id));
}));

app.post('/api/pets/:id/message', ah(async (req, res) => {
  const p = await db.prepare('SELECT * FROM pets WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '見つかりません' });
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'メッセージを入力してください' });
  const from = (req.body && req.body.from || '').trim() || '情報提供者';

  await db.prepare('INSERT INTO pet_messages (pet_id, from_text, text, at) VALUES (?,?,?,?)').run(p.id, from, text, Date.now());
  await db.prepare('UPDATE pets SET status = ? WHERE id = ?').run('ok', p.id);

  const emailResult = await sendEmail({
    to: p.email,
    subject: `【つながるくまもと】${p.breed}に関する情報が届きました`,
    text: `${from}さんから、以下の情報が届きました。\n\n${text}\n\n詳細はアプリでご確認ください。`,
  });

  res.json({ notified: emailResult.sent || emailResult.simulated, pet: await loadPetItem(p.id) });
}));

// ---------- 掲示板（非ログイン利用・匿名コメント） ----------
// 投稿者本人だけが削除できるよう、クライアントが生成した匿名トークン（X-Board-Owner ヘッダー）で所有権を照合する。
// アカウントは存在しないため「本人確認」ではなく「同じブラウザからの投稿か」の簡易な照合に留まる。

const BOARD_TITLE_MAX = 100;
const BOARD_BODY_MAX = 2000;

function boardOwnerToken(req) {
  return req.get('x-board-owner') || '';
}

async function serializeThreadListItem(t, ownerToken) {
  const commentCount = (await db.prepare('SELECT COUNT(*) c FROM board_comments WHERE thread_id = ?').get(t.id)).c;
  const canDelete = !!ownerToken && t.owner_token === ownerToken && Number(commentCount) === 0;
  return { id: t.id, title: t.title, body: t.body, city: t.city, photoPath: t.photo_path, created: Number(t.created), updated: Number(t.updated), commentCount: Number(commentCount), canDelete };
}
async function serializeThreadDetail(t, ownerToken) {
  const commentRows = await db.prepare('SELECT id, text, created, owner_token FROM board_comments WHERE thread_id = ? ORDER BY created ASC').all(t.id);
  const comments = commentRows.map(c => ({ id: c.id, text: c.text, created: Number(c.created), canDelete: !!ownerToken && c.owner_token === ownerToken }));
  const canDelete = !!ownerToken && t.owner_token === ownerToken && commentRows.length === 0;
  return { id: t.id, title: t.title, body: t.body, city: t.city, photoPath: t.photo_path, created: Number(t.created), updated: Number(t.updated), comments, canDelete };
}

app.get('/api/board', ah(async (req, res) => {
  const ownerToken = boardOwnerToken(req);
  const rows = await db.prepare('SELECT * FROM board_threads ORDER BY updated DESC').all();
  res.json(await Promise.all(rows.map(t => serializeThreadListItem(t, ownerToken))));
}));

app.get('/api/board/:id', ah(async (req, res) => {
  const t = await db.prepare('SELECT * FROM board_threads WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'スレッドが見つかりません' });
  res.json(await serializeThreadDetail(t, boardOwnerToken(req)));
}));

app.post('/api/board', ah(async (req, res) => {
  const title = ((req.body && req.body.title) || '').trim();
  const body = ((req.body && req.body.body) || '').trim();
  const city = ((req.body && req.body.city) || '').trim() || null;
  const photoDataUrl = req.body && req.body.photoDataUrl;
  if (!title) return res.status(400).json({ error: 'タイトルを入力してください' });
  if (!body) return res.status(400).json({ error: '内容を入力してください' });
  if (title.length > BOARD_TITLE_MAX) return res.status(400).json({ error: `タイトルは${BOARD_TITLE_MAX}文字以内で入力してください` });
  if (body.length > BOARD_BODY_MAX) return res.status(400).json({ error: `内容は${BOARD_BODY_MAX}文字以内で入力してください` });

  let photoPath = null;
  try {
    photoPath = await saveDataUrlImage(photoDataUrl, 'board');
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const ownerToken = boardOwnerToken(req) || null;
  const id = 'th' + Date.now() + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  await db.prepare('INSERT INTO board_threads (id, title, body, city, photo_path, owner_token, created, updated) VALUES (?,?,?,?,?,?,?,?)').run(id, title, body, city, photoPath, ownerToken, now, now);
  res.status(201).json(await serializeThreadListItem(await db.prepare('SELECT * FROM board_threads WHERE id = ?').get(id), ownerToken));
}));

app.post('/api/board/:id/comments', ah(async (req, res) => {
  const t = await db.prepare('SELECT * FROM board_threads WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'スレッドが見つかりません' });
  const text = ((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'コメントを入力してください' });
  if (text.length > BOARD_BODY_MAX) return res.status(400).json({ error: `コメントは${BOARD_BODY_MAX}文字以内で入力してください` });

  const ownerToken = boardOwnerToken(req) || null;
  const now = Date.now();
  await db.prepare('INSERT INTO board_comments (thread_id, text, owner_token, created) VALUES (?,?,?,?)').run(t.id, text, ownerToken, now);
  await db.prepare('UPDATE board_threads SET updated = ? WHERE id = ?').run(now, t.id);
  res.status(201).json(await serializeThreadDetail(await db.prepare('SELECT * FROM board_threads WHERE id = ?').get(t.id), ownerToken));
}));

app.delete('/api/board/:id', ah(async (req, res) => {
  const t = await db.prepare('SELECT * FROM board_threads WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'スレッドが見つかりません' });
  const ownerToken = boardOwnerToken(req);
  if (!ownerToken || t.owner_token !== ownerToken) return res.status(403).json({ error: '自分が立てたスレッドのみ削除できます' });
  const commentCount = (await db.prepare('SELECT COUNT(*) c FROM board_comments WHERE thread_id = ?').get(t.id)).c;
  if (Number(commentCount) > 0) return res.status(409).json({ error: 'コメントがついているスレッドは削除できません' });

  await db.prepare('DELETE FROM board_threads WHERE id = ?').run(t.id);
  res.json({ ok: true });
}));

app.delete('/api/board/:id/comments/:commentId', ah(async (req, res) => {
  const c = await db.prepare('SELECT * FROM board_comments WHERE id = ? AND thread_id = ?').get(req.params.commentId, req.params.id);
  if (!c) return res.status(404).json({ error: 'コメントが見つかりません' });
  const ownerToken = boardOwnerToken(req);
  if (!ownerToken || c.owner_token !== ownerToken) return res.status(403).json({ error: '自分が書いたコメントのみ削除できます' });

  await db.prepare('DELETE FROM board_comments WHERE id = ?').run(c.id);
  res.json(await serializeThreadDetail(await db.prepare('SELECT * FROM board_threads WHERE id = ?').get(req.params.id), ownerToken));
}));

// ---------- 行政からのお知らせ（非ログイン投稿・管理者承認制） ----------

const GOV_TITLE_MAX = 100;
const GOV_BODY_MAX = 2000;
const GOV_MAX_PHOTOS = 1;

function serializeGovNotice(row) {
  let photoPaths = [];
  try { photoPaths = JSON.parse(row.photo_paths || '[]'); } catch (e) { photoPaths = []; }
  return {
    id: row.id, title: row.title, city: row.city, body: row.body, contact: row.contact,
    photoPaths, status: row.status, created: Number(row.created),
  };
}

app.get('/api/gov', ah(async (req, res) => {
  const rows = await db.prepare("SELECT * FROM gov_notices WHERE status = 'approved' ORDER BY created DESC").all();
  res.json(rows.map(serializeGovNotice));
}));

app.post('/api/gov', ah(async (req, res) => {
  const title = ((req.body && req.body.title) || '').trim();
  const body = ((req.body && req.body.body) || '').trim();
  const contact = ((req.body && req.body.contact) || '').trim();
  const city = ((req.body && req.body.city) || '').trim() || null;
  const photoDataUrls = Array.isArray(req.body && req.body.photoDataUrls) ? req.body.photoDataUrls.slice(0, GOV_MAX_PHOTOS) : [];

  if (!title) return res.status(400).json({ error: 'タイトルを入力してください' });
  if (!body) return res.status(400).json({ error: '内容を入力してください' });
  if (!contact) return res.status(400).json({ error: 'お問い合わせ（電話番号）を入力してください' });
  if (title.length > GOV_TITLE_MAX) return res.status(400).json({ error: `タイトルは${GOV_TITLE_MAX}文字以内で入力してください` });
  if (body.length > GOV_BODY_MAX) return res.status(400).json({ error: `内容は${GOV_BODY_MAX}文字以内で入力してください` });

  let photoPaths;
  try {
    photoPaths = [];
    for (const url of photoDataUrls) {
      const saved = await saveDataUrlImage(url, 'gov');
      if (saved) photoPaths.push(saved);
    }
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const id = 'gov' + Date.now() + Math.random().toString(36).slice(2, 6);
  await db.prepare(`INSERT INTO gov_notices (id, title, city, body, contact, photo_paths, status, created)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, title, city, body, contact, JSON.stringify(photoPaths), 'pending', Date.now());

  res.status(201).json(serializeGovNotice(await db.prepare('SELECT * FROM gov_notices WHERE id = ?').get(id)));
}));

app.get('/api/admin/gov', requireAdmin, ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM gov_notices ORDER BY created DESC').all();
  res.json(rows.map(serializeGovNotice));
}));

app.post('/api/admin/gov/:id/approve', requireAdmin, ah(async (req, res) => {
  const row = await db.prepare('SELECT * FROM gov_notices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'お知らせが見つかりません' });
  await db.prepare("UPDATE gov_notices SET status = 'approved' WHERE id = ?").run(row.id);
  res.json(serializeGovNotice(await db.prepare('SELECT * FROM gov_notices WHERE id = ?').get(row.id)));
}));

app.post('/api/admin/gov/:id/reject', requireAdmin, ah(async (req, res) => {
  const row = await db.prepare('SELECT * FROM gov_notices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'お知らせが見つかりません' });
  await db.prepare("UPDATE gov_notices SET status = 'rejected' WHERE id = ?").run(row.id);
  res.json(serializeGovNotice(await db.prepare('SELECT * FROM gov_notices WHERE id = ?').get(row.id)));
}));

// ---------- エラーハンドリング ----------

app.use((err, req, res, next) => {
  console.error('[server] unhandled error', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'サーバーエラーが発生しました' });
});

// ---------- 起動 ----------
// Vercel など serverless 環境では import されるだけで listen しないため、
// ローカル/通常のNodeプロセスとして起動された場合のみ listen する。

async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`Tsunagaru Kumamoto backend listening on http://localhost:${PORT} (db: ${db.usingPostgres ? 'Postgres/Supabase' : 'SQLite (local)'})`);
  });
}

if (require.main === module) {
  start().catch((e) => {
    console.error('[server] 起動に失敗しました', e);
    process.exit(1);
  });
}

module.exports = app;

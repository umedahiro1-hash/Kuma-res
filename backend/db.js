const path = require('path');
const crypto = require('crypto');

// ---------- パスワードハッシュ（DB実装に依存しない） ----------

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const { hash: computed } = hashPassword(password, salt);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- 接続先の切り替え ----------
// DATABASE_URL が設定されている場合は Supabase（Postgres）、未設定の場合はローカル開発用に
// SQLite（better-sqlite3）を使う。呼び出し側（server.js）はどちらの場合も
// `await db.prepare(sql).get/all/run(...)` という同じ非同期インターフェースで書ける。

const USE_POSTGRES = !!process.env.DATABASE_URL;

function toPgQuery(sql, args) {
  let text = sql;
  let params;
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    params = [];
    const obj = args[0];
    text = sql.replace(/@(\w+)/g, (_, name) => {
      if (!(name in obj)) throw new Error(`[db] バインド変数 @${name} が渡されていません`);
      params.push(obj[name]);
      return `$${params.length}`;
    });
  } else {
    let i = 0;
    text = sql.replace(/\?/g, () => `$${++i}`);
    params = args;
  }
  return { text, params };
}

function makePgDb(executor) {
  return {
    prepare(sql) {
      return {
        async get(...args) {
          const { text, params } = toPgQuery(sql, args);
          const { rows } = await executor.query(text, params);
          return rows[0];
        },
        async all(...args) {
          const { text, params } = toPgQuery(sql, args);
          const { rows } = await executor.query(text, params);
          return rows;
        },
        async run(...args) {
          const { text, params } = toPgQuery(sql, args);
          const result = await executor.query(text, params);
          return { changes: result.rowCount };
        },
      };
    },
    async exec(sql) {
      await executor.query(sql);
    },
  };
}

// better-sqlite3 は同期APIのため、Postgres版と同じ「必ずawaitできる」インターフェースに揃える。
function makeSqliteDb(sqliteDb) {
  return {
    prepare(sql) {
      const stmt = sqliteDb.prepare(sql);
      return {
        async get(...args) { return stmt.get(...args); },
        async all(...args) { return stmt.all(...args); },
        async run(...args) {
          const info = stmt.run(...args);
          return { changes: info.changes };
        },
      };
    },
    async exec(sql) { sqliteDb.exec(sql); },
  };
}

let db;
let pool = null;

if (USE_POSTGRES) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Supabase の証明書チェーンはNode標準のCAストアに無いことが多いため既定では検証しない。
    // 完全なTLS検証をしたい場合は PGSSL_REJECT_UNAUTHORIZED=true を設定して上書きできる。
    ssl: { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === 'true' },
  });
  pool.on('error', (err) => console.error('[db] pool error', err));
  db = makePgDb(pool);
  db.transaction = function (fn) {
    return async (...args) => {
      const client = await pool.connect();
      const txDb = makePgDb(client);
      try {
        await client.query('BEGIN');
        const result = await fn(txDb, ...args);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };
  };
} else {
  console.warn('[db] DATABASE_URL 未設定のため、ローカル開発用の SQLite (backend/data/tsunagaru.db) を使用します。本番デプロイ時は Supabase の DATABASE_URL を設定してください。');
  const Database = require('better-sqlite3');
  const sqliteDb = new Database(path.join(__dirname, 'data', 'tsunagaru.db'));
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  db = makeSqliteDb(sqliteDb);
  // SQLite側は同期実行なので、渡された関数をその場で（同期的に）トランザクション内実行する。
  db.transaction = function (fn) {
    const runSync = sqliteDb.transaction((...args) => fn(db, ...args));
    return async (...args) => runSync(...args);
  };
}

// ---------- スキーマ（Postgres/SQLite で型を出し分け） ----------

function schemaSql() {
  const pk = USE_POSTGRES ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  // タイムスタンプはミリ秒epoch（13桁）を保存するため、32bit範囲のPostgres INTEGERでは溢れる。
  // Postgres側は BIGINT、SQLite側は元々64bit整数を扱えるINTEGERのままにする。
  const bigint = USE_POSTGRES ? 'BIGINT' : 'INTEGER';
  return `
CREATE TABLE IF NOT EXISTS profiles (
  name TEXT PRIMARY KEY,
  phone TEXT UNIQUE,
  password_hash TEXT,
  salt TEXT,
  city TEXT NOT NULL DEFAULT '',
  photo_path TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  noshow INTEGER NOT NULL DEFAULT 0,
  praises INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS goods (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('offer','request')),
  cat TEXT NOT NULL,
  district TEXT NOT NULL,
  place TEXT NOT NULL,
  title TEXT NOT NULL,
  qty TEXT NOT NULL,
  when_text TEXT NOT NULL,
  nick TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','nego','reserved','done')) DEFAULT 'open',
  is_free INTEGER NOT NULL DEFAULT 1,
  price INTEGER,
  image_path TEXT,
  created ${bigint} NOT NULL,
  updated ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS applicants (
  id ${pk},
  goods_id TEXT NOT NULL REFERENCES goods(id) ON DELETE CASCADE,
  nick TEXT NOT NULL,
  msg TEXT NOT NULL DEFAULT '',
  at ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS goods_chat (
  id ${pk},
  goods_id TEXT NOT NULL REFERENCES goods(id) ON DELETE CASCADE,
  from_nick TEXT NOT NULL,
  text TEXT NOT NULL,
  at ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  goods_id TEXT PRIMARY KEY REFERENCES goods(id) ON DELETE CASCADE,
  partner TEXT NOT NULL,
  owner TEXT NOT NULL,
  place TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  giver_done INTEGER NOT NULL DEFAULT 0,
  taker_done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id ${pk},
  goods_id TEXT NOT NULL REFERENCES goods(id) ON DELETE CASCADE,
  reviewer_nick TEXT NOT NULL,
  target_nick TEXT NOT NULL,
  star INTEGER NOT NULL CHECK(star BETWEEN 1 AND 5),
  msg TEXT NOT NULL DEFAULT '',
  at ${bigint} NOT NULL,
  UNIQUE(goods_id, reviewer_nick)
);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  home TEXT NOT NULL DEFAULT '',
  pref TEXT NOT NULL,
  city TEXT NOT NULL,
  email TEXT NOT NULL,
  requester TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('wait','ok')) DEFAULT 'wait',
  photo_path TEXT,
  created ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS person_messages (
  id ${pk},
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  from_text TEXT NOT NULL,
  text TEXT NOT NULL,
  at ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('lost','sighting')) DEFAULT 'lost',
  species TEXT NOT NULL CHECK(species IN ('dog','cat','other')),
  breed TEXT NOT NULL,
  gender TEXT NOT NULL CHECK(gender IN ('male','female','unknown')),
  city TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL,
  photo_path TEXT NOT NULL,
  email TEXT NOT NULL,
  characteristics TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('wait','ok')) DEFAULT 'wait',
  created ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS pet_messages (
  id ${pk},
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  from_text TEXT NOT NULL,
  text TEXT NOT NULL,
  at ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS board_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  city TEXT,
  owner_token TEXT,
  created ${bigint} NOT NULL,
  updated ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS board_comments (
  id ${pk},
  thread_id TEXT NOT NULL REFERENCES board_threads(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  owner_token TEXT,
  created ${bigint} NOT NULL
);

CREATE TABLE IF NOT EXISTS gov_notices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  city TEXT,
  body TEXT NOT NULL,
  contact TEXT NOT NULL,
  photo_paths TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
  created ${bigint} NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_goods_created ON goods(created DESC);
CREATE INDEX IF NOT EXISTS idx_goods_nick ON goods(nick);
CREATE INDEX IF NOT EXISTS idx_applicants_goods_id ON applicants(goods_id);
CREATE INDEX IF NOT EXISTS idx_goods_chat_goods_id ON goods_chat(goods_id);
CREATE INDEX IF NOT EXISTS idx_reviews_goods_id ON reviews(goods_id);
CREATE INDEX IF NOT EXISTS idx_persons_created ON persons(created DESC);
CREATE INDEX IF NOT EXISTS idx_person_messages_person_id ON person_messages(person_id);
CREATE INDEX IF NOT EXISTS idx_pets_created ON pets(created DESC);
CREATE INDEX IF NOT EXISTS idx_pet_messages_pet_id ON pet_messages(pet_id);
CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
CREATE INDEX IF NOT EXISTS idx_board_threads_updated ON board_threads(updated DESC);
CREATE INDEX IF NOT EXISTS idx_board_comments_thread_id ON board_comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_gov_notices_status_created ON gov_notices(status, created DESC);
`;
}

async function ensureSchema() {
  if (USE_POSTGRES) {
    await db.exec(schemaSql());
  } else {
    await db.exec(schemaSql());
  }
}

async function seedIfEmpty() {
  const profileCount = (await db.prepare('SELECT COUNT(*) c FROM profiles').get()).c;
  if (Number(profileCount) === 0) {
    const insertProfile = db.prepare(`INSERT INTO profiles (name, phone, password_hash, salt, city, completed, noshow, praises)
      VALUES (@name,@phone,@password_hash,@salt,@city,@completed,@noshow,@praises)`);
    const { salt, hash } = hashPassword('demo1234');
    const rows = [
      { name: 'たかし', phone: '09011111111', password_hash: hash, salt, city: '熊本市', completed: 8, noshow: 0, praises: 6 },
      { name: 'ボランティアM', phone: '09022222222', password_hash: hash, salt, city: '宇城市', completed: 31, noshow: 0, praises: 25 },
      { name: 'みさと母', phone: '09033333333', password_hash: hash, salt, city: '熊本市', completed: 2, noshow: 0, praises: 1 },
      { name: '子育て中', phone: '09044444444', password_hash: hash, salt, city: '美里町', completed: 0, noshow: 0, praises: 0 },
      { name: 'あなた', phone: '09000000000', password_hash: hash, salt, city: '熊本市', completed: 0, noshow: 0, praises: 0 },
    ];
    for (const r of rows) await insertProfile.run(r);
  }

  const goodsCount = (await db.prepare('SELECT COUNT(*) c FROM goods').get()).c;
  if (Number(goodsCount) === 0) {
    const now = Date.now();
    const insertGoods = db.prepare(`INSERT INTO goods
      (id, type, cat, district, place, title, qty, when_text, nick, status, created, updated)
      VALUES (@id,@type,@cat,@district,@place,@title,@qty,@when_text,@nick,@status,@created,@updated)`);
    const insertChat = db.prepare(`INSERT INTO goods_chat (goods_id, from_nick, text, at) VALUES (?,?,?,?)`);
    const insertApplicant = db.prepare(`INSERT INTO applicants (goods_id, nick, msg, at) VALUES (?,?,?,?)`);
    const insertDeal = db.prepare(`INSERT INTO deals (goods_id, partner, owner, place, date, time, giver_done, taker_done) VALUES (?,?,?,?,?,?,?,?)`);

    await insertGoods.run({ id: 'g1', type: 'offer', cat: '水', district: '中央区', place: '大江', title: 'ミネラルウォーター 2L×12本 無料でゆずります', qty: '12本', when_text: '本日 14:00まで', nick: 'たかし', status: 'open', created: now - 9000000, updated: now - 9000000 });
    await insertGoods.run({ id: 'g2', type: 'request', cat: '水', district: '東区', place: '健軍', title: '飲料水を分けてください', qty: '2Lを6本ほど', when_text: '明日 終日可能', nick: 'みさと母', status: 'open', created: now - 12000000, updated: now - 12000000 });
    await insertGoods.run({ id: 'g3', type: 'offer', cat: '毛布・衣類', district: '宇城市', place: '松橋', title: '毛布5枚・タオル多数 ゆずります', qty: '毛布5・タオル20', when_text: 'いつでも', nick: 'ボランティアM', status: 'open', created: now - 3000000, updated: now - 3000000 });
    await insertGoods.run({ id: 'g4', type: 'offer', cat: '食料', district: '熊本市', place: '市民会館前', title: 'アルファ米・レトルト食品 まとめてゆずります', qty: '30食分', when_text: '土日に受け渡し可', nick: 'ボランティアM', status: 'open', created: now - 2000000, updated: now - 2000000 });

    const g5Created = now - 4000000;
    const g5Updated = now - 100000;
    await insertGoods.run({ id: 'g5', type: 'request', cat: '衛生用品', district: '美里町', place: '払川公民館', title: '紙おむつ（Mサイズ）が必要です', qty: '1〜2パック', when_text: 'なるべく早く', nick: '子育て中', status: 'reserved', created: g5Created, updated: g5Updated });
    await insertApplicant.run('g5', 'ボランティアM', '2パックお渡しできます', now - 2200000);
    await insertChat.run('g5', 'ボランティアM', 'Mサイズ2パックあります。明日10時に払川公民館でいかがですか？', now - 2100000);
    await insertChat.run('g5', '子育て中', '助かります！お願いします。', now - 2000000);
    await insertChat.run('g5', 'ボランティアM', '予約しました：明日 10:00 ＠払川公民館', now - 1900000);
    const tomorrow = new Date(now + 864e5).toISOString().slice(0, 10);
    await insertDeal.run('g5', 'ボランティアM', '子育て中', '払川公民館', tomorrow, '10:00', 0, 0);
  }

  const personCount = (await db.prepare('SELECT COUNT(*) c FROM persons').get()).c;
  if (Number(personCount) === 0) {
    const now = Date.now();
    const insertPerson = db.prepare(`INSERT INTO persons (id, name, mobile, home, pref, city, email, requester, status, created) VALUES (@id,@name,@mobile,@home,@pref,@city,@email,@requester,@status,@created)`);
    const insertMsg = db.prepare(`INSERT INTO person_messages (person_id, from_text, text, at) VALUES (?,?,?,?)`);
    await insertPerson.run({ id: 'p1', name: '田中はな', mobile: '090-1234-5678', home: '', pref: '熊本県', city: '美里町', email: 'family_a@example.com', requester: '田中一郎（長男）', status: 'wait', created: now - 7200000 });
    await insertPerson.run({ id: 'p2', name: '佐藤みのる', mobile: '', home: '0964-99-0000', pref: '熊本県', city: '宇城市', email: 'sato_family@example.com', requester: '佐藤ゆき（妻）', status: 'ok', created: now - 172800000 });
    await insertMsg.run('p2', '近所の方', '避難所（中央公民館）でお元気にされています。', now - 86400000);
    await insertPerson.run({ id: 'p3', name: '山口けんじ', mobile: '080-2222-3333', home: '', pref: '熊本県', city: '八代市', email: 'yama_search@example.com', requester: '山口みき（娘）', status: 'wait', created: now - 259200000 });
  }

  const petCount = (await db.prepare('SELECT COUNT(*) c FROM pets').get()).c;
  if (Number(petCount) === 0) {
    const now = Date.now();
    const insertPet = db.prepare(`INSERT INTO pets (id, type, species, breed, gender, city, location, photo_path, email, characteristics, status, created) VALUES (@id,@type,@species,@breed,@gender,@city,@location,@photo_path,@email,@characteristics,@status,@created)`);
    const insertPetMsg = db.prepare(`INSERT INTO pet_messages (pet_id, from_text, text, at) VALUES (?,?,?,?)`);
    await insertPet.run({ id: 'pet1', type: 'lost', species: 'dog', breed: '柴犬', gender: 'male', city: '美里町', location: '美里町中央公民館付近', photo_path: 'https://storage.googleapis.com/aida-studio-stage-bucket/AB6AXuAh7tS4B07yq3zGk9G9Tf7m0B3wR8z1c8yL9H4lQ6bN1eX8e9g8e3a89e9f60f4e1f74811a4cf1356fcf7c4_fcd4843b-be49-41b4-82a9-c0bb6fdbd42b.jpeg', email: 'shiba_owner@example.com', characteristics: '首輪は赤色、右耳の先が少し折れています。人懐っこいです。', status: 'wait', created: now - 5400000 });
    await insertPet.run({ id: 'pet2', type: 'lost', species: 'cat', breed: 'キジトラ', gender: 'female', city: '宇城市', location: '宇城市松橋町 松橋駅周辺', photo_path: 'https://storage.googleapis.com/aida-studio-stage-bucket/AB6AXuAQ6m0G4s1D0c6b1Q8V0D3R6v5M8W5N3Z2B3x1X3b8w5y5E0p7Q2Y4X3p9q4V9b3u1D3M2X3B9L8v9A0_5e9f8485-6126-4076-afde-86efba5e6d6d.jpeg', email: 'neko_family@example.com', characteristics: '警戒心が強く、近づくと逃げます。', status: 'ok', created: now - 172800000 });
    await insertPetMsg.run('pet2', '近所の方', '松橋駅の駐輪場で保護し、現在自宅で保護しています。', now - 90000000);
    await insertPet.run({ id: 'pet3', type: 'sighting', species: 'dog', breed: 'MIX（中型犬）', gender: 'unknown', city: '益城町', location: '益城町木山 交差点付近', photo_path: 'https://storage.googleapis.com/aida-studio-stage-bucket/AB6AXuAh7tS4B07yq3zGk9G9Tf7m0B3wR8z1c8yL9H4lQ6bN1eX8e9g8e3a89e9f60f4e1f74811a4cf1356fcf7c4_fcd4843b-be49-41b4-82a9-c0bb6fdbd42b.jpeg', email: 'finder_sample@example.com', characteristics: '首輪あり、迷子札は確認できませんでした。', status: 'wait', created: now - 10800000 });
  }

  const boardCount = (await db.prepare('SELECT COUNT(*) c FROM board_threads').get()).c;
  if (Number(boardCount) === 0) {
    const now = Date.now();
    const insertThread = db.prepare('INSERT INTO board_threads (id, title, body, created, updated) VALUES (?,?,?,?,?)');
    const insertComment = db.prepare('INSERT INTO board_comments (thread_id, text, created) VALUES (?,?,?)');
    const bumpThread = db.prepare('UPDATE board_threads SET updated = ? WHERE id = ?');
    await insertThread.run('th1', '給水車が来る場所を教えてください', '中央区在住です。近くに給水車が来るスケジュールをご存知の方いたら教えてください。', now - 5400000, now - 5400000);
    await insertComment.run('th1', '市民会館前に今日15時頃来るそうです。市の防災無線でも案内がありました。', now - 5000000);
    await insertComment.run('th1', '大江でも見かけました。台数が少ないみたいで並んでいます。', now - 4800000);
    await bumpThread.run(now - 4800000, 'th1');
    await insertThread.run('th2', '断水中の洗濯、みなさんどうしてますか', '洗濯機が使えず困っています。コインランドリーで営業しているところがあれば教えてください。', now - 10800000, now - 10800000);
    await insertComment.run('th2', '宇城市の松橋駅前のコインランドリーは営業していました。', now - 9800000);
    await bumpThread.run(now - 9800000, 'th2');
    await insertThread.run('th3', '避難所での過ごし方、情報交換しましょう', '初めての避難所生活で不安なことが多いです。持っていて良かったものなど教えてもらえると助かります。', now - 172800000, now - 172800000);
  }

  const govCount = (await db.prepare('SELECT COUNT(*) c FROM gov_notices').get()).c;
  if (Number(govCount) === 0) {
    const now = Date.now();
    const insertGov = db.prepare(`INSERT INTO gov_notices (id, title, city, body, contact, photo_paths, status, created)
      VALUES (?,?,?,?,?,?,?,?)`);
    await insertGov.run('gov1', '給水車の巡回スケジュールについて', '熊本市', '熊本市内の断水地域を対象に給水車を巡回させています。最新の巡回場所・時刻は市公式サイトでも随時更新しています。', '096-328-2111（熊本市 水道局）', '[]', 'approved', now - 7200000);
    await insertGov.run('gov2', '避難所の開設状況（更新）', '美里町', '町内3か所の避難所を開設しています。ペット同伴可の避難所は中央公民館のみです。必要な方は防災担当までご連絡ください。', '0964-46-2111（美里町 防災担当）', '[]', 'approved', now - 43200000);
    await insertGov.run('gov3', '罹災証明書の発行受付を開始します', '宇城市', '罹災証明書の申請受付を開始しました。窓口・オンライン申請どちらも可能です。詳細はお問い合わせください。', '0964-32-1111（宇城市 総務課）', '[]', 'pending', now - 1800000);
  }
}

let initPromise = null;
function init() {
  if (!initPromise) {
    initPromise = ensureSchema().then(() => seedIfEmpty());
  }
  return initPromise;
}

module.exports = db;
module.exports.init = init;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.usingPostgres = USE_POSTGRES;

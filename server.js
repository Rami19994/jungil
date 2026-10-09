const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON body parser (with 50mb limit for high-res photos/logos)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

// Disable caching for all API responses so updates reflect instantly
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve static frontend files
app.use(express.static(__dirname));

// Detect Vercel serverless environment
const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);

// Paths
const localUploadsDir = path.join(__dirname, 'uploads');
const tmpUploadsDir = path.join('/tmp', 'uploads');
if (!fs.existsSync(localUploadsDir)) {
  try { fs.mkdirSync(localUploadsDir, { recursive: true }); } catch (_) {}
}
if (isVercel && !fs.existsSync(tmpUploadsDir)) {
  try { fs.mkdirSync(tmpUploadsDir, { recursive: true }); } catch (_) {}
}

// Serve uploaded images statically
app.use('/uploads', express.static(localUploadsDir));
if (isVercel) {
  app.use('/uploads', express.static(tmpUploadsDir));
}

// SQLite 3 Database File Path - single source of truth: menu.sqlite3
const dbFileName = 'menu.sqlite3';
const seedDbPath = path.join(__dirname, dbFileName);
const dbPath = isVercel ? path.join('/tmp', dbFileName) : (process.env.MENU_DB_PATH || seedDbPath);

// On Vercel, copy pre-seeded database to /tmp if not present yet
if (isVercel && !fs.existsSync(dbPath)) {
  if (fs.existsSync(seedDbPath)) {
    try { fs.copyFileSync(seedDbPath, dbPath); } catch (_) {}
  }
}

// Global real-time version timestamp for live sync across browser tabs and devices without refresh
let menuVersion = Date.now();

// Vercel Blob persistent cloud storage configuration (safely load token from environment or local env)
if (!process.env.BLOB_READ_WRITE_TOKEN && fs.existsSync(path.join(__dirname, '.env.local'))) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
    const match = envContent.match(/BLOB_READ_WRITE_TOKEN\s*=\s*["']?([^"'\r\n]+)["']?/);
    if (match) process.env.BLOB_READ_WRITE_TOKEN = match[1];
  } catch (_) {}
}
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
let blobSyncQueue = Promise.resolve();
let currentBlobVersion = null;

function getBlobVersion(blob) {
  return [blob.url, blob.uploadedAt, blob.etag, blob.size].map(value => String(value ?? '')).join(':');
}

function isValidSqliteDatabase(buffer) {
  return buffer.length > 2000 && buffer.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'));
}

function syncDbToBlob() {
  if (!BLOB_TOKEN) {
    return isVercel
      ? Promise.reject(new Error('Persistent storage is not configured. Set BLOB_READ_WRITE_TOKEN in the Vercel project environment.'))
      : Promise.resolve();
  }

  const sync = async () => {
    const { put } = require('@vercel/blob');
    const buffer = fs.readFileSync(dbPath);
    const blob = await put(dbFileName, buffer, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: BLOB_TOKEN,
    });
    currentBlobVersion = getBlobVersion(blob);
    console.log('☁️ Database persisted to Vercel Blob');
  };

  const pendingSync = blobSyncQueue.then(sync, sync);
  blobSyncQueue = pendingSync.catch(() => {});
  return pendingSync;
}

// Dual-Driver SQLite 3 Engine (sqlite3 package with node:sqlite seamless fallback for 100% Vercel & Localhost reliability)
let db;
let dbRun, dbGet, dbAll, dbExec, dbClose;

function openDatabase() {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const nativeDb = new sqlite3.Database(dbPath, (err) => {
      if (err) throw err;
    });

    nativeDb.serialize(() => {
      nativeDb.run('PRAGMA journal_mode = DELETE;');
      nativeDb.run('PRAGMA synchronous = FULL;');
      nativeDb.run('PRAGMA foreign_keys = OFF;');
      nativeDb.run('PRAGMA busy_timeout = 5000;');
    });

    dbRun = (sql, params = []) => new Promise((resolve, reject) => {
      nativeDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });

    dbGet = (sql, params = []) => new Promise((resolve, reject) => {
      nativeDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    dbAll = (sql, params = []) => new Promise((resolve, reject) => {
      nativeDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    dbExec = (sql) => new Promise((resolve, reject) => {
      nativeDb.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    dbClose = () => new Promise((resolve, reject) => {
      nativeDb.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    db = nativeDb;
    console.log(`📁 Connected to SQLite 3 database via 'sqlite3' at: ${dbPath}`);
  } catch (driverErr) {
    console.warn(`sqlite3 native package load note (${driverErr.message}), using native SQLite 3 engine...`);
    const { DatabaseSync } = require('node:sqlite');
    const syncDb = new DatabaseSync(dbPath);

    try {
      syncDb.exec('PRAGMA journal_mode = DELETE;');
      syncDb.exec('PRAGMA synchronous = FULL;');
      syncDb.exec('PRAGMA foreign_keys = OFF;');
    } catch (_) {}

    dbRun = async (sql, params = []) => {
      const stmt = syncDb.prepare(sql);
      const result = stmt.run(...params);
      return { lastID: result.lastInsertRowid, changes: result.changes };
    };

    dbGet = async (sql, params = []) => {
      const stmt = syncDb.prepare(sql);
      return stmt.get(...params);
    };

    dbAll = async (sql, params = []) => {
      const stmt = syncDb.prepare(sql);
      return stmt.all(...params) || [];
    };

    dbExec = async (sql) => {
      syncDb.exec(sql);
    };
    dbClose = async () => syncDb.close();

    db = syncDb;
    console.log(`📁 Connected to SQLite 3 database via 'node:sqlite' at: ${dbPath}`);
  }
}

// Helper: Safely save Base64 data to disk in uploads/ and return clean URL
// Helper: Safely save Base64 data to disk in uploads/ and return clean reliable URL
function saveBase64Image(base64Data) {
  if (!base64Data || typeof base64Data !== 'string') return '';
  if (!base64Data.startsWith('data:image/')) return base64Data;

  try {
    const parts = base64Data.split(',');
    const meta = parts[0].toLowerCase();
    const raw = parts.slice(1).join(',');

    let ext = 'jpg';
    if (meta.includes('webp')) ext = 'webp';
    else if (meta.includes('png')) ext = 'png';
    else if (meta.includes('svg')) ext = 'svg';
    else if (meta.includes('gif')) ext = 'gif';
    else if (meta.includes('avif')) ext = 'avif';

    const buffer = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
    const safeFilename = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;

    // Always save file copy to local uploads directory for disk backup
    try {
      fs.writeFileSync(path.join(localUploadsDir, safeFilename), buffer);
    } catch (_) {}

    if (isVercel) {
      try {
        fs.writeFileSync(path.join(tmpUploadsDir, safeFilename), buffer);
      } catch (_) {}
    }

    // On Vercel and Localhost: returning base64Data guarantees 100% reliability, zero 404 errors,
    // and instant menu rendering without dependency on ephemeral serverless disk!
    return base64Data;
  } catch (err) {
    console.warn('Failed to save base64 image to disk:', err.message);
    return base64Data;
  }
}

// POST /api/upload - Handle direct file upload from admin portal
app.post('/api/upload', (req, res) => {
  try {
    const { base64Data, filename } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No image data provided' });
    }
    const savedUrl = saveBase64Image(base64Data);
    res.json({ success: true, url: savedUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Safely delete an uploaded image file from disk to prevent orphaned files
function deleteLocalImageFile(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return;
  if (imageUrl.startsWith('/uploads/')) {
    const filename = path.basename(imageUrl);
    const localPath = path.join(localUploadsDir, filename);
    const tmpPath = path.join(tmpUploadsDir, filename);
    try {
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    } catch (_) {}
    try {
      if (isVercel && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
}

// Wait for durable persistence before reporting a successful write to the client.
async function persistDatabase() {
  if (!isVercel) {
    menuVersion = Date.now();
    return;
  }
  await syncDbToBlob();
  menuVersion = Date.now();
}

// Initialize SQLite 3 Tables
async function initDatabase() {
  try {
    // If running on Vercel, pull latest persistent database from Vercel Blob if available
    if (isVercel && BLOB_TOKEN) {
      const { list } = require('@vercel/blob');
      const blobList = await list({ token: BLOB_TOKEN, prefix: dbFileName });
      const targetBlob = blobList.blobs.find(b => b.pathname === dbFileName);
      if (targetBlob && targetBlob.url) {
        const response = await fetch(targetBlob.url + '?t=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Could not download the saved database from Vercel Blob (HTTP ${response.status})`);
        }
        const buf = Buffer.from(await response.arrayBuffer());
        if (!isValidSqliteDatabase(buf)) {
          throw new Error('The saved database in Vercel Blob is empty or invalid');
        }
        fs.writeFileSync(dbPath, buf);
        currentBlobVersion = getBlobVersion(targetBlob);
        console.log(`☁️ Restored database from Vercel Blob (${buf.length} bytes)`);
      }
    }

    openDatabase();

    await dbExec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        nameEn TEXT NOT NULL,
        nameAr TEXT NOT NULL,
        icon TEXT DEFAULT 'utensils',
        displayOrder INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS dishes (
        id TEXT PRIMARY KEY,
        categoryId TEXT NOT NULL,
        nameEn TEXT NOT NULL,
        nameAr TEXT NOT NULL,
        descEn TEXT,
        descAr TEXT,
        price REAL NOT NULL,
        image TEXT,
        isChefSpecial INTEGER DEFAULT 0,
        isBestSeller INTEGER DEFAULT 0,
        isVegetarian INTEGER DEFAULT 0,
        isSpicy INTEGER DEFAULT 0,
        inStock INTEGER DEFAULT 1,
        createdAt TEXT,
        updatedAt TEXT,
        FOREIGN KEY(categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );
    `);

    // Basic Settings fallback only if table is completely empty (no mock dishes ever inserted!)
    const checkInit = await dbGet("SELECT value FROM settings WHERE key = 'isInitialized'");
    if (!checkInit) {
      const defaultSettings = {
        restaurantNameEn: 'Jungle',
        restaurantNameAr: 'جانغل',
        taglineEn: 'Rooftop & Lounge Dining Experience',
        taglineAr: 'تجربة طعام وسهرات استثنائية على الروف توب',
        subtitleEn: 'Panoramic Skyline • Prime Botanical Cuts • Artisanal Mixology',
        subtitleAr: 'إطلالة أفق بانورامية • أرقى قطع اللحوم • كوكتيلات فاخرة',
        addressEn: 'Ankawa, Main Street, Luxury Hotel',
        addressAr: 'عنكاوة - الشارع الرئيسي - فندق luxury',
        mapUrl: 'https://maps.app.goo.gl/xiSWgf6a2JBKpTya9',
        logoUrl: '',
        heroBgUrl: '',
        isInitialized: 'true',
      };

      for (const [k, v] of Object.entries(defaultSettings)) {
        await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, String(v ?? '')]);
      }

      const defaultCategories = [
        { id: 'steaks', nameEn: 'Steaks & Grills', nameAr: 'مشاوي وستيك فاخر', icon: 'flame', displayOrder: 1 },
        { id: 'appetizers', nameEn: 'Appetizers & Tapas', nameAr: 'مقبلات وتاباس', icon: 'utensils', displayOrder: 2 },
        { id: 'sushi', nameEn: 'Sushi & Raw Bar', nameAr: 'سوشي ومأكولات بحرية', icon: 'sparkles', displayOrder: 3 },
        { id: 'cocktails', nameEn: 'Signature Cocktails', nameAr: 'كوكتيلات مميزة', icon: 'wine', displayOrder: 4 },
        { id: 'mocktails', nameEn: 'Mocktails & Tonics', nameAr: 'موكتيلات وعصائر', icon: 'coffee', displayOrder: 5 },
        { id: 'desserts', nameEn: 'Decadent Desserts', nameAr: 'حلويات فاخرة', icon: 'star', displayOrder: 6 },
        { id: 'shisha', nameEn: 'Shisha & Lounge', nameAr: 'شيشة ولاونج سهرات', icon: 'flame', displayOrder: 7 },
      ];

      for (const cat of defaultCategories) {
        await dbRun('INSERT OR REPLACE INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)', [
          cat.id, cat.nameEn, cat.nameAr, cat.icon, cat.displayOrder
        ]);
      }

      if (BLOB_TOKEN) await persistDatabase();
    }
  } catch (err) {
    console.error('Error initializing SQLite 3 database:', err);
    throw err;
  }
}

async function restoreLatestDatabaseFromBlob() {
  const { list } = require('@vercel/blob');
  const blobList = await list({ token: BLOB_TOKEN, prefix: dbFileName });
  const targetBlob = blobList.blobs.find(blob => blob.pathname === dbFileName);

  if (!targetBlob) {
    if (currentBlobVersion) {
      throw new Error('The saved database was not found in Vercel Blob');
    }
    return;
  }

  const blobVersion = getBlobVersion(targetBlob);
  if (blobVersion === currentBlobVersion) return;

  const response = await fetch(targetBlob.url + '?t=' + Date.now(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not download the latest database from Vercel Blob (HTTP ${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!isValidSqliteDatabase(buffer)) {
    throw new Error('The latest database in Vercel Blob is empty or invalid');
  }

  const replacementPath = `${dbPath}.download`;
  fs.writeFileSync(replacementPath, buffer);

  try {
    await dbClose();
    db = null;
    fs.renameSync(replacementPath, dbPath);
    openDatabase();
    await dbGet('PRAGMA schema_version');
    currentBlobVersion = blobVersion;
    console.log(`☁️ Refreshed database from Vercel Blob (${buffer.length} bytes)`);
  } catch (err) {
    if (!db && fs.existsSync(dbPath)) openDatabase();
    throw err;
  } finally {
    if (fs.existsSync(replacementPath)) fs.unlinkSync(replacementPath);
  }
}

const databaseReady = initDatabase();
databaseReady.catch(() => {});
let apiRequestQueue = Promise.resolve();

app.use('/api', async (req, res, next) => {
  try {
    await databaseReady;
  } catch (err) {
    console.error('Database is unavailable:', err);
    return res.status(503).json({ error: 'Database initialization failed', details: err.message });
  }

  const previousRequest = apiRequestQueue;
  let releaseRequest;
  let requestReleased = false;
  apiRequestQueue = new Promise(resolve => { releaseRequest = resolve; });
  await previousRequest;
  const releaseRequestOnce = () => {
    if (requestReleased) return;
    requestReleased = true;
    releaseRequest();
  };
  res.once('finish', releaseRequestOnce);
  res.once('close', () => {
    if (!res.writableFinished) releaseRequestOnce();
  });

  if (isVercel && !BLOB_TOKEN && req.path !== '/upload' && req.path !== '/health') {
    return res.status(503).json({
      error: 'Persistent storage is not configured. Set BLOB_READ_WRITE_TOKEN in the Vercel project environment.',
    });
  }

  if (isVercel && BLOB_TOKEN) {
    try {
      await restoreLatestDatabaseFromBlob();
    } catch (err) {
      console.error('Could not refresh database from Vercel Blob:', err);
      releaseRequestOnce();
      return res.status(503).json({ error: 'Could not load the latest saved database', details: err.message });
    }
  }

  return next();
});

// ======================== REST API ROUTES (100% SQLite 3) ======================== //

app.get('/api/health', (req, res) => {
  const persistentStorageConfigured = !isVercel || Boolean(BLOB_TOKEN);
  res.status(persistentStorageConfigured ? 200 : 503).json({
    status: persistentStorageConfigured ? 'ok' : 'storage_not_configured',
    runtime: isVercel ? 'vercel' : 'local',
    storage: isVercel ? (BLOB_TOKEN ? 'vercel-blob' : 'unconfigured') : 'sqlite',
    persistentStorageConfigured,
  });
});

// 0.0 GET Live Menu Version for instant cross-device updates without page reload
app.get('/api/menu-version', (req, res) => {
  res.json({ version: menuVersion, timestamp: new Date().toISOString() });
});

// 0. GET Full Menu in 1 Call directly from SQLite 3
app.get('/api/menu', async (req, res) => {
  try {
    const settingsRows = await dbAll('SELECT key, value FROM settings');
    const settings = {};
    for (const r of settingsRows) {
      settings[r.key] = r.value;
    }

    const categories = await dbAll('SELECT * FROM categories ORDER BY displayOrder ASC, nameEn ASC');
    const dishesRaw = await dbAll('SELECT * FROM dishes ORDER BY rowid DESC');
    const dishes = dishesRaw.map(d => ({
      ...d,
      isChefSpecial: Boolean(d.isChefSpecial),
      isBestSeller: Boolean(d.isBestSeller),
      isVegetarian: Boolean(d.isVegetarian),
      isSpicy: Boolean(d.isSpicy),
      inStock: Boolean(d.inStock),
    }));

    res.json({ settings, categories, dishes, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('SQLite 3 /api/menu error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 1. GET Settings
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await dbAll('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    console.error('SQLite 3 /api/settings error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. POST Update Settings
app.post('/api/settings', async (req, res) => {
  try {
    const updates = req.body;

    // Clean up old logo if replaced
    if (updates.logoUrl !== undefined) {
      const oldLogo = await dbGet("SELECT value FROM settings WHERE key = 'logoUrl'");
      if (oldLogo && oldLogo.value && oldLogo.value !== updates.logoUrl) {
        deleteLocalImageFile(oldLogo.value);
      }
    }

    // Clean up old hero background if replaced
    if (updates.heroBgUrl !== undefined) {
      const oldBg = await dbGet("SELECT value FROM settings WHERE key = 'heroBgUrl'");
      if (oldBg && oldBg.value && oldBg.value !== updates.heroBgUrl) {
        deleteLocalImageFile(oldBg.value);
      }
    }

    for (const [key, value] of Object.entries(updates)) {
      let finalVal = String(value ?? '');
      if (finalVal.startsWith('data:image/')) {
        finalVal = saveBase64Image(finalVal);
      }
      await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, finalVal]);
    }

    await persistDatabase();
    res.json({ success: true, message: 'Settings updated successfully in SQLite 3 database' });
  } catch (err) {
    console.error('SQLite 3 settings update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. GET Categories
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await dbAll('SELECT * FROM categories ORDER BY displayOrder ASC, nameEn ASC');
    res.json(categories);
  } catch (err) {
    console.error('SQLite 3 /api/categories error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. POST Add / Update Category
app.post('/api/categories', async (req, res) => {
  try {
    const { id, nameEn, nameAr, icon, displayOrder } = req.body;
    const catId = id || `cat-${Date.now()}`;

    await dbRun(
      'INSERT OR REPLACE INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)',
      [catId, nameEn || '', nameAr || '', icon || 'utensils', Number(displayOrder) || 0]
    );

    await persistDatabase();
    res.json({ success: true, id: catId });
  } catch (err) {
    console.error('SQLite 3 category save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE Category (unrestricted - user can delete any and all categories)
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const catId = req.params.id;

    // Unassign category from dishes so they stay safely visible under "جميع التصنيفات"
    await dbRun("UPDATE dishes SET categoryId = '' WHERE categoryId = ?", [catId]);
    await dbRun('DELETE FROM categories WHERE id = ?', [catId]);

    await persistDatabase();
    res.json({ success: true, message: 'Category deleted cleanly from SQLite 3 database' });
  } catch (err) {
    console.error('SQLite 3 category delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5.1 POST Clear All Categories (keeps only "جميع التصنيفات")
app.post('/api/categories/clear-all', async (req, res) => {
  try {
    // Unassign categories from dishes so dishes remain accessible under "جميع التصنيفات"
    await dbRun("UPDATE dishes SET categoryId = '';");
    await dbRun('DELETE FROM categories;');

    await persistDatabase();
    res.json({ success: true, message: 'All categories cleared cleanly from SQLite 3 database' });
  } catch (err) {
    console.error('SQLite 3 clear-all categories error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. GET All Dishes
app.get('/api/dishes', async (req, res) => {
  try {
    const dishes = await dbAll('SELECT * FROM dishes ORDER BY rowid DESC');
    const formatted = dishes.map(d => ({
      ...d,
      isChefSpecial: Boolean(d.isChefSpecial),
      isBestSeller: Boolean(d.isBestSeller),
      isVegetarian: Boolean(d.isVegetarian),
      isSpicy: Boolean(d.isSpicy),
      inStock: Boolean(d.inStock),
    }));
    res.json(formatted);
  } catch (err) {
    console.error('SQLite 3 /api/dishes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. POST Add New Dish
app.post('/api/dishes', async (req, res) => {
  try {
    const d = req.body;
    const dishId = String(d.id || `dish-${Date.now()}`).trim();
    const now = new Date().toISOString();

    let finalImageUrl = d.image || '';
    if (typeof finalImageUrl === 'string' && finalImageUrl.startsWith('data:image/')) {
      finalImageUrl = saveBase64Image(finalImageUrl);
    }

    const sql = `
      INSERT OR REPLACE INTO dishes (
        id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
        isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await dbRun(sql, [
      dishId,
      d.categoryId || 'steaks',
      d.nameEn || '',
      d.nameAr || '',
      d.descEn || '',
      d.descAr || '',
      Number(d.price) || 0,
      finalImageUrl,
      d.isChefSpecial ? 1 : 0,
      d.isBestSeller ? 1 : 0,
      d.isVegetarian ? 1 : 0,
      d.isSpicy ? 1 : 0,
      d.inStock !== false ? 1 : 0,
      now,
      now
    ]);

    await persistDatabase();
    res.json({ success: true, id: dishId, image: finalImageUrl });
  } catch (err) {
    console.error('SQLite 3 add dish error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. PUT Update Dish (with seamless UPSERT so edit NEVER fails with 404)
app.put('/api/dishes/:id', async (req, res) => {
  try {
    const rawId = req.params.id || req.body.id || '';
    const dishId = String(decodeURIComponent(rawId)).trim();
    if (!dishId) {
      return res.status(400).json({ error: 'Missing dish id' });
    }
    const d = req.body;
    const now = new Date().toISOString();

    const oldDish = await dbGet('SELECT * FROM dishes WHERE id = ?', [dishId]);

    let finalImageUrl = d.image !== undefined ? d.image : (oldDish ? oldDish.image : '');
    if (typeof finalImageUrl === 'string' && finalImageUrl.startsWith('data:image/')) {
      finalImageUrl = saveBase64Image(finalImageUrl);
    }

    // If dish did not exist yet (UPSERT fallback to prevent any 404 error)
    if (!oldDish) {
      const sqlInsert = `
        INSERT INTO dishes (
          id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
          isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await dbRun(sqlInsert, [
        dishId,
        d.categoryId || 'steaks',
        d.nameEn || '',
        d.nameAr || '',
        d.descEn || '',
        d.descAr || '',
        Number(d.price) || 0,
        finalImageUrl,
        d.isChefSpecial ? 1 : 0,
        d.isBestSeller ? 1 : 0,
        d.isVegetarian ? 1 : 0,
        d.isSpicy ? 1 : 0,
        d.inStock !== false ? 1 : 0,
        now,
        now
      ]);
      await persistDatabase();
      return res.json({ success: true, message: 'Dish saved cleanly in SQLite 3', id: dishId, image: finalImageUrl });
    }

    // If image was replaced or removed, delete old image file from disk if it was an uploaded file
    if (oldDish.image && oldDish.image !== finalImageUrl && typeof oldDish.image === 'string' && oldDish.image.startsWith('/uploads/')) {
      deleteLocalImageFile(oldDish.image);
    }

    const sqlUpdate = `
      UPDATE dishes SET
        categoryId = ?,
        nameEn = ?,
        nameAr = ?,
        descEn = ?,
        descAr = ?,
        price = ?,
        image = ?,
        isChefSpecial = ?,
        isBestSeller = ?,
        isVegetarian = ?,
        isSpicy = ?,
        inStock = ?,
        updatedAt = ?
      WHERE id = ?
    `;

    await dbRun(sqlUpdate, [
      d.categoryId || oldDish.categoryId,
      d.nameEn !== undefined ? d.nameEn : oldDish.nameEn,
      d.nameAr !== undefined ? d.nameAr : oldDish.nameAr,
      d.descEn !== undefined ? d.descEn : oldDish.descEn,
      d.descAr !== undefined ? d.descAr : oldDish.descAr,
      d.price !== undefined ? (Number(d.price) || 0) : oldDish.price,
      finalImageUrl,
      d.isChefSpecial !== undefined ? (d.isChefSpecial ? 1 : 0) : oldDish.isChefSpecial,
      d.isBestSeller !== undefined ? (d.isBestSeller ? 1 : 0) : oldDish.isBestSeller,
      d.isVegetarian !== undefined ? (d.isVegetarian ? 1 : 0) : oldDish.isVegetarian,
      d.isSpicy !== undefined ? (d.isSpicy ? 1 : 0) : oldDish.isSpicy,
      d.inStock !== undefined ? (d.inStock ? 1 : 0) : oldDish.inStock,
      now,
      dishId
    ]);

    await persistDatabase();
    res.json({ success: true, message: 'Dish updated cleanly in SQLite 3', id: dishId, image: finalImageUrl });
  } catch (err) {
    console.error('SQLite 3 update dish error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. DELETE Dish
app.delete('/api/dishes/:id', async (req, res) => {
  try {
    const rawId = req.params.id || '';
    const dishId = String(decodeURIComponent(rawId)).trim();

    const dish = await dbGet('SELECT image FROM dishes WHERE id = ?', [dishId]);
    if (dish && dish.image && typeof dish.image === 'string' && dish.image.startsWith('/uploads/')) {
      deleteLocalImageFile(dish.image);
    }

    await dbRun('DELETE FROM dishes WHERE id = ?', [dishId]);

    await persistDatabase();
    res.json({ success: true, message: 'Dish deleted completely from SQLite 3 database' });
  } catch (err) {
    console.error('SQLite 3 delete dish error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9.1 POST Clear All Dishes
app.post('/api/dishes/clear-all', async (req, res) => {
  try {
    const dishes = await dbAll('SELECT image FROM dishes');
    for (const d of dishes) {
      if (d.image && d.image.startsWith('/uploads/')) {
        deleteLocalImageFile(d.image);
      }
    }

    await dbRun('DELETE FROM dishes;');
    await persistDatabase();
    res.json({ success: true, message: 'All dishes and their images cleared completely from SQLite 3 database' });
  } catch (err) {
    console.error('SQLite 3 clear-all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10. POST Image Upload
app.post('/api/upload', (req, res) => {
  try {
    const { base64Data, filename } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    const savedUrl = saveBase64Image(base64Data);
    res.json({ success: true, url: savedUrl });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 11. POST Reset to Factory Defaults
app.post('/api/reset', async (req, res) => {
  try {
    const dishes = await dbAll('SELECT image FROM dishes');
    for (const d of dishes) {
      if (d.image && d.image.startsWith('/uploads/')) {
        deleteLocalImageFile(d.image);
      }
    }

    await dbRun('DELETE FROM dishes;');
    await dbRun('DELETE FROM categories;');
    await dbRun('DELETE FROM settings;');

    const defaultSettings = {
      restaurantNameEn: 'Jungle',
      restaurantNameAr: 'جانغل',
      taglineEn: 'Rooftop & Lounge Dining Experience',
      taglineAr: 'تجربة طعام وسهرات استثنائية على الروف توب',
      subtitleEn: 'Panoramic Skyline • Prime Botanical Cuts • Artisanal Mixology',
      subtitleAr: 'إطلالة أفق بانورامية • أرقى قطع اللحوم • كوكتيلات فاخرة',
      addressEn: 'Ankawa, Main Street, Luxury Hotel',
      addressAr: 'عنكاوة - الشارع الرئيسي - فندق luxury',
      mapUrl: 'https://maps.app.goo.gl/xiSWgf6a2JBKpTya9',
      logoUrl: '',
      heroBgUrl: '',
      isInitialized: 'true',
    };

    for (const [key, value] of Object.entries(defaultSettings)) {
      await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value ?? '')]);
    }

    const defaultCategories = [
      { id: 'steaks', nameEn: 'Steaks & Grills', nameAr: 'مشاوي وستيك فاخر', icon: 'flame', displayOrder: 1 },
      { id: 'appetizers', nameEn: 'Appetizers & Tapas', nameAr: 'مقبلات وتاباس', icon: 'utensils', displayOrder: 2 },
      { id: 'sushi', nameEn: 'Sushi & Raw Bar', nameAr: 'سوشي ومأكولات بحرية', icon: 'sparkles', displayOrder: 3 },
      { id: 'cocktails', nameEn: 'Signature Cocktails', nameAr: 'كوكتيلات مميزة', icon: 'wine', displayOrder: 4 },
      { id: 'mocktails', nameEn: 'Mocktails & Tonics', nameAr: 'موكتيلات وعصائر', icon: 'coffee', displayOrder: 5 },
      { id: 'desserts', nameEn: 'Decadent Desserts', nameAr: 'حلويات فاخرة', icon: 'star', displayOrder: 6 },
      { id: 'shisha', nameEn: 'Shisha & Lounge', nameAr: 'شيشة ولاونج سهرات', icon: 'flame', displayOrder: 7 },
    ];

    for (const cat of defaultCategories) {
      await dbRun('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)', [
        cat.id, cat.nameEn, cat.nameAr, cat.icon, cat.displayOrder
      ]);
    }

    await persistDatabase();
    res.json({ success: true, message: 'Database reset to clean state with 0 dishes' });
  } catch (err) {
    console.error('SQLite 3 reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. GET Backup
app.get('/api/backup', async (req, res) => {
  try {
    const settingsRows = await dbAll('SELECT key, value FROM settings');
    const settings = {};
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }
    const categories = await dbAll('SELECT * FROM categories ORDER BY displayOrder ASC');
    const dishes = await dbAll('SELECT * FROM dishes ORDER BY createdAt DESC');

    res.json({
      exportedAt: new Date().toISOString(),
      restaurant: settings.restaurantNameAr || 'Jungle Rooftop & Lounge',
      settings,
      categories,
      dishes,
    });
  } catch (err) {
    console.error('SQLite 3 backup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 13. POST Restore
app.post('/api/restore', async (req, res) => {
  try {
    const { settings, categories, dishes } = req.body;
    if (!settings && !categories && !dishes) {
      return res.status(400).json({ error: 'Invalid backup data' });
    }

    if (settings && typeof settings === 'object') {
      for (const [key, value] of Object.entries(settings)) {
        await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value ?? '')]);
      }
      await dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('isInitialized', 'true')");
    }

    if (Array.isArray(categories)) {
      await dbRun('DELETE FROM categories;');
      for (const cat of categories) {
        await dbRun('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)', [
          cat.id, cat.nameEn, cat.nameAr, cat.icon || 'utensils', Number(cat.displayOrder) || 0
        ]);
      }
    }

    if (Array.isArray(dishes)) {
      await dbRun('DELETE FROM dishes;');
      const sql = `
        INSERT INTO dishes (
          id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
          isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const now = new Date().toISOString();
      for (const d of dishes) {
        await dbRun(sql, [
          d.id, d.categoryId, d.nameEn, d.nameAr, d.descEn || '', d.descAr || '',
          Number(d.price) || 0, d.image || '',
          d.isChefSpecial ? 1 : 0, d.isBestSeller ? 1 : 0,
          d.isVegetarian ? 1 : 0, d.isSpicy ? 1 : 0,
          d.inStock !== false ? 1 : 0,
          d.createdAt || now, d.updatedAt || now
        ]);
      }
    }

    await persistDatabase();
    res.json({ success: true, message: 'Data restored successfully to SQLite 3 database' });
  } catch (err) {
    console.error('SQLite 3 restore error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Explicit /admin route -> Standalone admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Catch-all to serve index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server locally if run directly and not on Vercel
if (!isVercel && require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🌿 Jungle Rooftop & Lounge Server running at: http://localhost:${PORT}`);
    console.log(`📁 Database: SQLite 3 at ${dbPath}`);
  });
}

// Export for Vercel Serverless
module.exports = app;

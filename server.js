const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

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
const dataDir = isVercel ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
}

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

// SQLite Database Path
const dbPath = path.join(dataDir, 'restaurant.sqlite');
const seedDbPath = path.join(__dirname, 'data', 'restaurant.sqlite');

// On Vercel, copy pre-seeded database if /tmp copy doesn't exist yet
if (isVercel && !fs.existsSync(dbPath) && fs.existsSync(seedDbPath)) {
  try {
    fs.copyFileSync(seedDbPath, dbPath);
  } catch (err) {
    console.warn('Seed database copy skipped:', err.message);
  }
}

// Connect to SQLite Native Database
const db = new DatabaseSync(dbPath);

// Enable WAL mode & Foreign Keys
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
} catch (_) {
  try { db.exec('PRAGMA journal_mode = DELETE;'); } catch (_) {}
}

// Initialize SQLite Tables
db.exec(`
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

// Check if database was ever initialized
const checkInit = db.prepare("SELECT value FROM settings WHERE key = 'isInitialized'").get();
const isInitialized = checkInit && checkInit.value === 'true';

// Default Fallback Settings (only on brand new setup if not initialized)
if (!isInitialized) {
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

  const insertSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSettingStmt.run(k, String(v ?? ''));
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

  const insertCatStmt = db.prepare('INSERT OR REPLACE INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
  for (const cat of defaultCategories) {
    insertCatStmt.run(cat.id, cat.nameEn, cat.nameAr, cat.icon || 'utensils', Number(cat.displayOrder) || 0);
  }
}

// Flush WAL so SQLite file is permanently written to disk
function flushDb() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (_) {}
}
flushDb();

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

// ======================== REST API ROUTES (100% SQLite) ======================== //

// 0. GET Full Menu in 1 Call directly from SQLite
app.get('/api/menu', (req, res) => {
  try {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const r of settingsRows) {
      settings[r.key] = r.value;
    }

    const categories = db.prepare('SELECT * FROM categories ORDER BY displayOrder ASC, nameEn ASC').all();
    const dishes = db.prepare('SELECT * FROM dishes ORDER BY rowid DESC').all().map(d => ({
      ...d,
      isChefSpecial: Boolean(d.isChefSpecial),
      isBestSeller: Boolean(d.isBestSeller),
      isVegetarian: Boolean(d.isVegetarian),
      isSpicy: Boolean(d.isSpicy),
      inStock: Boolean(d.inStock),
    }));

    res.json({ settings, categories, dishes, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. GET Settings
app.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST Update Settings (Cleans up old images when replaced or deleted)
app.post('/api/settings', (req, res) => {
  try {
    const updates = req.body;

    // Clean up old logo if replaced
    if (updates.logoUrl !== undefined) {
      const oldLogo = db.prepare("SELECT value FROM settings WHERE key = 'logoUrl'").get();
      if (oldLogo && oldLogo.value && oldLogo.value !== updates.logoUrl) {
        deleteLocalImageFile(oldLogo.value);
      }
    }

    // Clean up old hero background if replaced
    if (updates.heroBgUrl !== undefined) {
      const oldBg = db.prepare("SELECT value FROM settings WHERE key = 'heroBgUrl'").get();
      if (oldBg && oldBg.value && oldBg.value !== updates.heroBgUrl) {
        deleteLocalImageFile(oldBg.value);
      }
    }

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, String(value ?? ''));
    }

    flushDb();
    res.json({ success: true, message: 'Settings updated successfully in SQLite database' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET Categories
app.get('/api/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY displayOrder ASC, nameEn ASC').all();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST Add / Update Category
app.post('/api/categories', (req, res) => {
  try {
    const { id, nameEn, nameAr, icon, displayOrder } = req.body;
    const catId = id || `cat-${Date.now()}`;

    const stmt = db.prepare('INSERT OR REPLACE INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
    stmt.run(catId, nameEn || '', nameAr || '', icon || 'utensils', Number(displayOrder) || 0);

    flushDb();
    res.json({ success: true, id: catId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE Category (Cleanly removes dishes & their image files)
app.delete('/api/categories/:id', (req, res) => {
  try {
    const catId = req.params.id;
    const count = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
    if (count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only remaining category' });
    }

    // Delete image files of all dishes under this category
    const dishes = db.prepare('SELECT image FROM dishes WHERE categoryId = ?').all();
    for (const d of dishes) {
      if (d.image) deleteLocalImageFile(d.image);
    }

    db.prepare('DELETE FROM dishes WHERE categoryId = ?').run(catId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catId);

    flushDb();
    res.json({ success: true, message: 'Category and its dishes deleted cleanly from database' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET All Dishes
app.get('/api/dishes', (req, res) => {
  try {
    const dishes = db.prepare('SELECT * FROM dishes ORDER BY rowid DESC').all();
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
    res.status(500).json({ error: err.message });
  }
});

// 7. POST Add New Dish (Saves directly to SQLite)
app.post('/api/dishes', (req, res) => {
  try {
    const d = req.body;
    const dishId = d.id || `dish-${Date.now()}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO dishes (
        id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
        isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      dishId,
      d.categoryId,
      d.nameEn || '',
      d.nameAr || '',
      d.descEn || '',
      d.descAr || '',
      Number(d.price) || 0,
      d.image || '',
      d.isChefSpecial ? 1 : 0,
      d.isBestSeller ? 1 : 0,
      d.isVegetarian ? 1 : 0,
      d.isSpicy ? 1 : 0,
      d.inStock !== false ? 1 : 0,
      now,
      now
    );

    flushDb();
    res.json({ success: true, id: dishId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. PUT Update Dish (Deletes old image file if replaced, completely updates SQLite row)
app.put('/api/dishes/:id', (req, res) => {
  try {
    const dishId = req.params.id;
    const d = req.body;
    const now = new Date().toISOString();

    // Check if image was replaced -> delete old image file from disk
    const oldDish = db.prepare('SELECT image FROM dishes WHERE id = ?').get(dishId);
    if (oldDish && oldDish.image && oldDish.image !== d.image) {
      deleteLocalImageFile(oldDish.image);
    }

    const stmt = db.prepare(`
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
    `);

    const result = stmt.run(
      d.categoryId,
      d.nameEn || '',
      d.nameAr || '',
      d.descEn || '',
      d.descAr || '',
      Number(d.price) || 0,
      d.image || '',
      d.isChefSpecial ? 1 : 0,
      d.isBestSeller ? 1 : 0,
      d.isVegetarian ? 1 : 0,
      d.isSpicy ? 1 : 0,
      d.inStock ? 1 : 0,
      now,
      dishId
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Dish not found' });
    }

    flushDb();
    res.json({ success: true, message: 'Dish updated cleanly in SQLite' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. DELETE Dish (Completely deletes from SQLite AND deletes image file from disk)
app.delete('/api/dishes/:id', (req, res) => {
  try {
    const dishId = req.params.id;

    // Get dish image to delete its file from disk
    const dish = db.prepare('SELECT image FROM dishes WHERE id = ?').get(dishId);
    if (dish && dish.image) {
      deleteLocalImageFile(dish.image);
    }

    const result = db.prepare('DELETE FROM dishes WHERE id = ?').run(dishId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Dish not found' });
    }

    flushDb();
    res.json({ success: true, message: 'Dish and its image deleted completely from database' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9.1 POST Clear All Dishes (Deletes all dish rows from SQLite & wipes their files)
app.post('/api/dishes/clear-all', (req, res) => {
  try {
    const dishes = db.prepare('SELECT image FROM dishes').all();
    for (const d of dishes) {
      if (d.image) deleteLocalImageFile(d.image);
    }

    db.exec('DELETE FROM dishes;');
    flushDb();
    res.json({ success: true, message: 'All dishes and their images cleared completely from database' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST Image Upload (Saves image to uploads/ & returns clean relative URL)
app.post('/api/upload', (req, res) => {
  try {
    const { base64Data, filename } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    let cleanBase64 = base64Data;
    let ext = 'jpg';

    if (base64Data.includes(',')) {
      const parts = base64Data.split(',');
      const meta = parts[0].toLowerCase();
      cleanBase64 = parts.slice(1).join(',');

      if (meta.includes('webp')) ext = 'webp';
      else if (meta.includes('png')) ext = 'png';
      else if (meta.includes('svg')) ext = 'svg';
      else if (meta.includes('gif')) ext = 'gif';
      else if (meta.includes('avif')) ext = 'avif';
      else if (meta.includes('jpeg') || meta.includes('jpg')) ext = 'jpg';
    }

    // Strip any whitespace/newlines that could corrupt binary decoding
    const buffer = Buffer.from(cleanBase64.replace(/\s+/g, ''), 'base64');
    const safeFilename = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;

    // Write to uploads directory
    let saved = false;
    try {
      fs.writeFileSync(path.join(localUploadsDir, safeFilename), buffer);
      saved = true;
    } catch (_) {}

    if (!saved && isVercel) {
      try {
        fs.writeFileSync(path.join(tmpUploadsDir, safeFilename), buffer);
        saved = true;
      } catch (_) {}
    }

    const relativeUrl = `/uploads/${safeFilename}`;
    res.json({ success: true, url: relativeUrl, extension: ext });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST Reset to Factory Defaults
app.post('/api/reset', (req, res) => {
  try {
    const dishes = db.prepare('SELECT image FROM dishes').all();
    for (const d of dishes) {
      if (d.image) deleteLocalImageFile(d.image);
    }

    db.exec('DELETE FROM dishes;');
    db.exec('DELETE FROM categories;');
    db.exec('DELETE FROM settings;');

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

    const insertSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(defaultSettings)) {
      insertSettingStmt.run(key, value);
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

    const insertCatStmt = db.prepare('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
    for (const cat of defaultCategories) {
      insertCatStmt.run(cat.id, cat.nameEn, cat.nameAr, cat.icon, cat.displayOrder);
    }

    flushDb();
    res.json({ success: true, message: 'Database reset to clean state' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET Backup (Export full database as JSON)
app.get('/api/backup', (req, res) => {
  try {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }
    const categories = db.prepare('SELECT * FROM categories ORDER BY displayOrder ASC').all();
    const dishes = db.prepare('SELECT * FROM dishes ORDER BY createdAt DESC').all();

    res.json({
      exportedAt: new Date().toISOString(),
      restaurant: settings.restaurantNameAr || 'Jungle Rooftop & Lounge',
      settings,
      categories,
      dishes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST Restore (Import full database from JSON)
app.post('/api/restore', (req, res) => {
  try {
    const { settings, categories, dishes } = req.body;
    if (!settings && !categories && !dishes) {
      return res.status(400).json({ error: 'Invalid backup data' });
    }

    if (settings && typeof settings === 'object') {
      const insertSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(settings)) {
        insertSettingStmt.run(key, String(value ?? ''));
      }
      insertSettingStmt.run('isInitialized', 'true');
    }

    if (Array.isArray(categories) && categories.length > 0) {
      db.exec('DELETE FROM categories;');
      const insertCatStmt = db.prepare('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
      for (const cat of categories) {
        insertCatStmt.run(cat.id, cat.nameEn, cat.nameAr, cat.icon || 'utensils', Number(cat.displayOrder) || 0);
      }
    }

    if (Array.isArray(dishes)) {
      db.exec('DELETE FROM dishes;');
      const insertDishStmt = db.prepare(`
        INSERT INTO dishes (
          id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
          isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      for (const d of dishes) {
        insertDishStmt.run(
          d.id, d.categoryId, d.nameEn, d.nameAr, d.descEn || '', d.descAr || '',
          Number(d.price) || 0, d.image || '',
          d.isChefSpecial ? 1 : 0, d.isBestSeller ? 1 : 0,
          d.isVegetarian ? 1 : 0, d.isSpicy ? 1 : 0,
          d.inStock !== false ? 1 : 0,
          d.createdAt || now, d.updatedAt || now
        );
      }
    }

    flushDb();
    res.json({ success: true, message: 'Data restored successfully to SQLite database' });
  } catch (err) {
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
    console.log(`📁 Database: SQLite (Native Node 24 at ${dbPath})`);
  });
}

// Export for Vercel Serverless
module.exports = app;

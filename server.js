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

// Data files paths
const menuJsonPath = path.join(__dirname, 'data', 'menu.json');
const dbPath = path.join(dataDir, 'restaurant.sqlite');
const seedDbPath = path.join(__dirname, 'data', 'restaurant.sqlite');

// Default Fallback Settings
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

const defaultCategories = [
  { id: 'steaks', nameEn: 'Steaks & Grills', nameAr: 'مشاوي وستيك فاخر', icon: 'flame', displayOrder: 1 },
  { id: 'appetizers', nameEn: 'Appetizers & Tapas', nameAr: 'مقبلات وتاباس', icon: 'utensils', displayOrder: 2 },
  { id: 'sushi', nameEn: 'Sushi & Raw Bar', nameAr: 'سوشي ومأكولات بحرية', icon: 'sparkles', displayOrder: 3 },
  { id: 'cocktails', nameEn: 'Signature Cocktails', nameAr: 'كوكتيلات مميزة', icon: 'wine', displayOrder: 4 },
  { id: 'mocktails', nameEn: 'Mocktails & Tonics', nameAr: 'موكتيلات وعصائر', icon: 'coffee', displayOrder: 5 },
  { id: 'desserts', nameEn: 'Decadent Desserts', nameAr: 'حلويات فاخرة', icon: 'star', displayOrder: 6 },
  { id: 'shisha', nameEn: 'Shisha & Lounge', nameAr: 'شيشة ولاونج سهرات', icon: 'flame', displayOrder: 7 },
];

// In-Memory state for high-speed delivery & resilient fallback
let memoryState = {
  settings: { ...defaultSettings },
  categories: [...defaultCategories],
  dishes: [],
  updatedAt: new Date().toISOString(),
};

// Load pre-existing menu.json into memory if available
function loadMenuJson() {
  try {
    if (fs.existsSync(menuJsonPath)) {
      const raw = fs.readFileSync(menuJsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.settings) memoryState.settings = { ...memoryState.settings, ...parsed.settings };
      if (Array.isArray(parsed.categories)) memoryState.categories = parsed.categories;
      if (Array.isArray(parsed.dishes)) memoryState.dishes = parsed.dishes;
      if (parsed.updatedAt) memoryState.updatedAt = parsed.updatedAt;
      return true;
    }
  } catch (err) {
    console.warn('Could not read menu.json:', err.message);
  }
  return false;
}
loadMenuJson();

// Setup SQLite with fallback
let db = null;
try {
  const { DatabaseSync } = require('node:sqlite');

  if (isVercel && !fs.existsSync(dbPath) && fs.existsSync(seedDbPath)) {
    try {
      fs.copyFileSync(seedDbPath, dbPath);
    } catch (e) {}
  }

  db = new DatabaseSync(dbPath);

  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  } catch (_) {}

  // Initialize Tables
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

  // Check if database is already initialized
  const checkInit = db.prepare("SELECT value FROM settings WHERE key = 'isInitialized'").get();
  const isInitialized = checkInit && checkInit.value === 'true';

  if (!isInitialized) {
    // Populate SQLite from menu.json or defaults
    const insertSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(memoryState.settings)) {
      insertSettingStmt.run(k, String(v ?? ''));
    }
    insertSettingStmt.run('isInitialized', 'true');

    const insertCatStmt = db.prepare('INSERT OR REPLACE INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
    for (const cat of memoryState.categories) {
      insertCatStmt.run(cat.id, cat.nameEn, cat.nameAr, cat.icon || 'utensils', Number(cat.displayOrder) || 0);
    }

    const insertDishStmt = db.prepare(`
      INSERT OR REPLACE INTO dishes (
        id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
        isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of memoryState.dishes) {
      insertDishStmt.run(
        d.id, d.categoryId, d.nameEn, d.nameAr, d.descEn || '', d.descAr || '',
        Number(d.price) || 0, d.image || '',
        d.isChefSpecial ? 1 : 0, d.isBestSeller ? 1 : 0,
        d.isVegetarian ? 1 : 0, d.isSpicy ? 1 : 0,
        d.inStock !== false ? 1 : 0,
        d.createdAt || new Date().toISOString(),
        d.updatedAt || new Date().toISOString()
      );
    }
  } else {
    // Sync memory from SQLite
    syncMemoryFromSqlite();
  }
} catch (err) {
  console.warn('SQLite init skipped, using resilient JSON engine:', err.message);
}

function syncMemoryFromSqlite() {
  if (!db) return;
  try {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settingsObj = {};
    for (const row of settingsRows) {
      settingsObj[row.key] = row.value;
    }
    memoryState.settings = { ...memoryState.settings, ...settingsObj };

    const categoriesRows = db.prepare('SELECT * FROM categories ORDER BY displayOrder ASC, nameEn ASC').all();
    if (categoriesRows.length > 0) {
      memoryState.categories = categoriesRows;
    }

    const dishesRows = db.prepare('SELECT * FROM dishes ORDER BY rowid DESC').all();
    memoryState.dishes = dishesRows.map(d => ({
      ...d,
      isChefSpecial: Boolean(d.isChefSpecial),
      isBestSeller: Boolean(d.isBestSeller),
      isVegetarian: Boolean(d.isVegetarian),
      isSpicy: Boolean(d.isSpicy),
      inStock: Boolean(d.inStock),
    }));
    memoryState.updatedAt = new Date().toISOString();
  } catch (e) {
    console.warn('syncMemoryFromSqlite error:', e.message);
  }
}

// Function to synchronously write current state to menu.json & checkpoint SQLite
function syncToJson() {
  if (db) {
    syncMemoryFromSqlite();
  }
  memoryState.updatedAt = new Date().toISOString();

  try {
    const targetPath = path.join(__dirname, 'data', 'menu.json');
    fs.writeFileSync(targetPath, JSON.stringify(memoryState, null, 2), 'utf-8');
  } catch (err) {
    // On read-only serverless, skip disk write
  }

  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (_) {}
  }
}

// Initial sync to ensure menu.json is current
syncToJson();

// ======================== REST API ROUTES ======================== //

// 0. GET Full Menu in 1 Call (Fastest for initial load)
app.get('/api/menu', (req, res) => {
  if (db) syncMemoryFromSqlite();
  res.json(memoryState);
});

// 1. GET Settings
app.get('/api/settings', (req, res) => {
  if (db) {
    try {
      const rows = db.prepare('SELECT key, value FROM settings').all();
      const settings = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      return res.json(settings);
    } catch (err) {}
  }
  res.json(memoryState.settings);
});

// 2. POST Update Settings
app.post('/api/settings', (req, res) => {
  try {
    const updates = req.body;
    if (db) {
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(updates)) {
        stmt.run(key, String(value ?? ''));
      }
    }
    memoryState.settings = { ...memoryState.settings, ...updates };
    syncToJson();
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET Categories
app.get('/api/categories', (req, res) => {
  if (db) {
    try {
      const categories = db.prepare('SELECT * FROM categories ORDER BY displayOrder ASC, nameEn ASC').all();
      return res.json(categories);
    } catch (err) {}
  }
  res.json(memoryState.categories);
});

// 4. POST Add / Update Category
app.post('/api/categories', (req, res) => {
  try {
    const { id, nameEn, nameAr, icon, displayOrder } = req.body;
    const catId = id || `cat-${Date.now()}`;
    const newCat = {
      id: catId,
      nameEn: nameEn || '',
      nameAr: nameAr || '',
      icon: icon || 'utensils',
      displayOrder: Number(displayOrder) || 0,
    };

    if (db) {
      const stmt = db.prepare('INSERT OR REPLACE INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
      stmt.run(catId, newCat.nameEn, newCat.nameAr, newCat.icon, newCat.displayOrder);
    }

    const existingIdx = memoryState.categories.findIndex(c => c.id === catId);
    if (existingIdx >= 0) {
      memoryState.categories[existingIdx] = newCat;
    } else {
      memoryState.categories.push(newCat);
    }

    syncToJson();
    res.json({ success: true, id: catId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE Category
app.delete('/api/categories/:id', (req, res) => {
  try {
    const catId = req.params.id;
    if (memoryState.categories.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only remaining category' });
    }

    if (db) {
      db.prepare('DELETE FROM dishes WHERE categoryId = ?').run(catId);
      db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
    }

    memoryState.categories = memoryState.categories.filter(c => c.id !== catId);
    memoryState.dishes = memoryState.dishes.filter(d => d.categoryId !== catId);

    syncToJson();
    res.json({ success: true, message: 'Category and its dishes deleted cleanly' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET All Dishes
app.get('/api/dishes', (req, res) => {
  if (db) {
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
      return res.json(formatted);
    } catch (err) {}
  }
  res.json(memoryState.dishes);
});

// 7. POST Add New Dish
app.post('/api/dishes', (req, res) => {
  try {
    const d = req.body;
    const dishId = d.id || `dish-${Date.now()}`;
    const now = new Date().toISOString();

    const formattedDish = {
      id: dishId,
      categoryId: d.categoryId,
      nameEn: d.nameEn || '',
      nameAr: d.nameAr || '',
      descEn: d.descEn || '',
      descAr: d.descAr || '',
      price: Number(d.price) || 0,
      image: d.image || '',
      isChefSpecial: Boolean(d.isChefSpecial),
      isBestSeller: Boolean(d.isBestSeller),
      isVegetarian: Boolean(d.isVegetarian),
      isSpicy: Boolean(d.isSpicy),
      inStock: d.inStock !== false,
      createdAt: now,
      updatedAt: now,
    };

    if (db) {
      const stmt = db.prepare(`
        INSERT INTO dishes (
          id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
          isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        dishId,
        formattedDish.categoryId,
        formattedDish.nameEn,
        formattedDish.nameAr,
        formattedDish.descEn,
        formattedDish.descAr,
        formattedDish.price,
        formattedDish.image,
        formattedDish.isChefSpecial ? 1 : 0,
        formattedDish.isBestSeller ? 1 : 0,
        formattedDish.isVegetarian ? 1 : 0,
        formattedDish.isSpicy ? 1 : 0,
        formattedDish.inStock ? 1 : 0,
        now,
        now
      );
    }

    memoryState.dishes.unshift(formattedDish);
    syncToJson();
    res.json({ success: true, id: dishId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. PUT Update Dish
app.put('/api/dishes/:id', (req, res) => {
  try {
    const dishId = req.params.id;
    const d = req.body;
    const now = new Date().toISOString();

    const formattedDish = {
      id: dishId,
      categoryId: d.categoryId,
      nameEn: d.nameEn || '',
      nameAr: d.nameAr || '',
      descEn: d.descEn || '',
      descAr: d.descAr || '',
      price: Number(d.price) || 0,
      image: d.image || '',
      isChefSpecial: Boolean(d.isChefSpecial),
      isBestSeller: Boolean(d.isBestSeller),
      isVegetarian: Boolean(d.isVegetarian),
      isSpicy: Boolean(d.isSpicy),
      inStock: Boolean(d.inStock),
      updatedAt: now,
    };

    if (db) {
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
      stmt.run(
        formattedDish.categoryId,
        formattedDish.nameEn,
        formattedDish.nameAr,
        formattedDish.descEn,
        formattedDish.descAr,
        formattedDish.price,
        formattedDish.image,
        formattedDish.isChefSpecial ? 1 : 0,
        formattedDish.isBestSeller ? 1 : 0,
        formattedDish.isVegetarian ? 1 : 0,
        formattedDish.isSpicy ? 1 : 0,
        formattedDish.inStock ? 1 : 0,
        now,
        dishId
      );
    }

    const idx = memoryState.dishes.findIndex(dish => dish.id === dishId);
    if (idx >= 0) {
      memoryState.dishes[idx] = { ...memoryState.dishes[idx], ...formattedDish };
    }

    syncToJson();
    res.json({ success: true, message: 'Dish updated cleanly' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. DELETE Dish
app.delete('/api/dishes/:id', (req, res) => {
  try {
    const dishId = req.params.id;
    if (db) {
      db.prepare('DELETE FROM dishes WHERE id = ?').run(dishId);
    }

    memoryState.dishes = memoryState.dishes.filter(d => d.id !== dishId);
    syncToJson();
    res.json({ success: true, message: 'Dish deleted completely from database' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9.1 POST Clear All Dishes (Allows user to wipe all test dishes to start fresh)
app.post('/api/dishes/clear-all', (req, res) => {
  try {
    if (db) {
      db.exec('DELETE FROM dishes;');
    }
    memoryState.dishes = [];
    syncToJson();
    res.json({ success: true, message: 'All dishes cleared cleanly' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST Image Upload (Supports all image formats: WebP, PNG, JPG, JPEG, SVG, GIF, AVIF, HEIC)
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

    // Strip any whitespace/newlines that might corrupt binary decoding
    const buffer = Buffer.from(cleanBase64.replace(/\s+/g, ''), 'base64');

    const safeFilename = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;

    // Try saving locally first so it can be committed to Git
    let saved = false;
    try {
      fs.writeFileSync(path.join(localUploadsDir, safeFilename), buffer);
      saved = true;
    } catch (_) {}

    // Fallback to /tmp on Vercel
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
    if (db) {
      db.exec('DELETE FROM dishes;');
      db.exec('DELETE FROM categories;');
      db.exec('DELETE FROM settings;');

      const insertSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(defaultSettings)) {
        insertSettingStmt.run(key, value);
      }

      const insertCatStmt = db.prepare('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
      for (const cat of defaultCategories) {
        insertCatStmt.run(cat.id, cat.nameEn, cat.nameAr, cat.icon, cat.displayOrder);
      }
    }

    memoryState.settings = { ...defaultSettings };
    memoryState.categories = [...defaultCategories];
    memoryState.dishes = [];

    syncToJson();
    res.json({ success: true, message: 'Database reset to clean state' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET Backup (Export full database as JSON)
app.get('/api/backup', (req, res) => {
  if (db) syncMemoryFromSqlite();
  res.json({
    exportedAt: new Date().toISOString(),
    restaurant: memoryState.settings.restaurantNameAr || 'Jungle Rooftop & Lounge',
    settings: memoryState.settings,
    categories: memoryState.categories,
    dishes: memoryState.dishes,
  });
});

// 13. POST Restore (Import full database from JSON)
app.post('/api/restore', (req, res) => {
  try {
    const { settings, categories, dishes } = req.body;
    if (!settings && !categories && !dishes) {
      return res.status(400).json({ error: 'Invalid backup data' });
    }

    if (settings && typeof settings === 'object') {
      memoryState.settings = { ...memoryState.settings, ...settings, isInitialized: 'true' };
      if (db) {
        const insertSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        for (const [key, value] of Object.entries(memoryState.settings)) {
          insertSettingStmt.run(key, String(value ?? ''));
        }
      }
    }

    if (Array.isArray(categories) && categories.length > 0) {
      memoryState.categories = categories;
      if (db) {
        db.exec('DELETE FROM categories;');
        const insertCatStmt = db.prepare('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
        for (const cat of categories) {
          insertCatStmt.run(cat.id, cat.nameEn, cat.nameAr, cat.icon || 'utensils', Number(cat.displayOrder) || 0);
        }
      }
    }

    if (Array.isArray(dishes)) {
      memoryState.dishes = dishes.map(d => ({
        ...d,
        isChefSpecial: Boolean(d.isChefSpecial),
        isBestSeller: Boolean(d.isBestSeller),
        isVegetarian: Boolean(d.isVegetarian),
        isSpicy: Boolean(d.isSpicy),
        inStock: d.inStock !== false,
      }));

      if (db) {
        db.exec('DELETE FROM dishes;');
        const insertDishStmt = db.prepare(`
          INSERT INTO dishes (
            id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
            isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = new Date().toISOString();
        for (const d of memoryState.dishes) {
          insertDishStmt.run(
            d.id, d.categoryId, d.nameEn, d.nameAr, d.descEn || '', d.descAr || '',
            Number(d.price) || 0, d.image || '',
            d.isChefSpecial ? 1 : 0, d.isBestSeller ? 1 : 0,
            d.isVegetarian ? 1 : 0, d.isSpicy ? 1 : 0,
            d.inStock ? 1 : 0,
            d.createdAt || now, d.updatedAt || now
          );
        }
      }
    }

    syncToJson();
    res.json({ success: true, message: 'Data restored successfully' });
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

// Start Server locally if run directly (e.g. node server.js) and not on Vercel
if (!isVercel && require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🌿 Jungle Rooftop & Lounge Server running at: http://localhost:${PORT}`);
    console.log(`📁 Database: SQLite (Native Node 24 at ${dbPath}) + data/menu.json Sync`);
  });
}

// Export for Vercel Serverless
module.exports = app;

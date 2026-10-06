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

// Serve static frontend files
app.use(express.static(__dirname));

// Detect Vercel serverless environment
const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);

// Ensure data directory exists (/tmp on Vercel, ./data locally)
const dataDir = isVercel ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure uploads directory exists (/tmp on Vercel, ./uploads locally)
const uploadsDir = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Connect to SQLite Database
const dbPath = path.join(dataDir, 'restaurant.sqlite');

// On Vercel, copy pre-seeded database if /tmp copy doesn't exist yet
const seedDbPath = path.join(__dirname, 'data', 'restaurant.sqlite');
if (isVercel && !fs.existsSync(dbPath) && fs.existsSync(seedDbPath)) {
  try {
    fs.copyFileSync(seedDbPath, dbPath);
  } catch (err) {
    console.warn('Seed database copy skipped:', err.message);
  }
}

const db = new DatabaseSync(dbPath);

// Enable WAL mode for high performance and durability
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
} catch (e) {
  try { db.exec('PRAGMA journal_mode = DELETE;'); } catch (_) {}
}

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

// Initial Default Settings
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
  heroBgUrl: 'hero-bg.jpg',
};

// Seed default settings if empty
const countSettingsStmt = db.prepare('SELECT COUNT(*) as count FROM settings');
const settingsCount = countSettingsStmt.get().count;

if (settingsCount === 0) {
  const insertSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSettingStmt.run(key, value);
  }
} else {
  // Backfill any newly introduced keys (e.g. mapUrl, heroBgUrl) without touching existing values
  const insertMissingStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertMissingStmt.run(key, value);
  }
}

// Seed default categories if empty
const countCategoriesStmt = db.prepare('SELECT COUNT(*) as count FROM categories');
const categoriesCount = countCategoriesStmt.get().count;

const defaultCategories = [
  { id: 'steaks', nameEn: 'Steaks & Grills', nameAr: 'مشاوي وستيك فاخر', icon: 'flame', displayOrder: 1 },
  { id: 'appetizers', nameEn: 'Appetizers & Tapas', nameAr: 'مقبلات وتاباس', icon: 'utensils', displayOrder: 2 },
  { id: 'sushi', nameEn: 'Sushi & Raw Bar', nameAr: 'سوشي ومأكولات بحرية', icon: 'sparkles', displayOrder: 3 },
  { id: 'cocktails', nameEn: 'Signature Cocktails', nameAr: 'كوكتيلات مميزة', icon: 'wine', displayOrder: 4 },
  { id: 'mocktails', nameEn: 'Mocktails & Tonics', nameAr: 'موكتيلات وعصائر', icon: 'coffee', displayOrder: 5 },
  { id: 'desserts', nameEn: 'Decadent Desserts', nameAr: 'حلويات فاخرة', icon: 'star', displayOrder: 6 },
  { id: 'shisha', nameEn: 'Shisha & Lounge', nameAr: 'شيشة ولاونج سهرات', icon: 'flame', displayOrder: 7 },
];

if (categoriesCount === 0) {
  const insertCatStmt = db.prepare('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
  for (const cat of defaultCategories) {
    insertCatStmt.run(cat.id, cat.nameEn, cat.nameAr, cat.icon, cat.displayOrder);
  }
}

// Seed default dishes if empty
const countDishesStmt = db.prepare('SELECT COUNT(*) as count FROM dishes');
const dishesCount = countDishesStmt.get().count;

const defaultDishes = [
  {
    id: 'dish-1',
    categoryId: 'steaks',
    nameEn: '24k Gold Wagyu Ribeye (A5 Miyazaki)',
    nameAr: 'ستيك واغيو ريب آي بذهب 24 قيراط (A5 ميازاكي)',
    descEn: 'Grade A5 Japanese Wagyu Ribeye seared over Binchotan coals, draped in edible 24k gold leaf, finished with black garlic demiglace and smoked Maldon sea salt.',
    descAr: 'لحم واغيو ياباني معتق بدرجة A5 ميازاكي مشوي على فحم البينشوتان، مغلف بورق ذهب عيار 24 قيراط، مع صلصة الثوم الأسود وملح مالدون المدخن.',
    price: 98,
    image: '',
    isChefSpecial: 1,
    isBestSeller: 1,
    isVegetarian: 0,
    isSpicy: 0,
    inStock: 1,
  },
  {
    id: 'dish-2',
    categoryId: 'steaks',
    nameEn: 'Black Truffle Filet Mignon',
    nameAr: 'فيليه مينيون بالكمأة السوداء الفاخرة',
    descEn: 'Prime Angus beef tenderloin wrapped in botanical herbs, Périgord black truffle butter emulsion, pomme purée, and wild woodland morel reduction.',
    descAr: 'فيليه آنغوس طري محمر بالأعشاب الطبيعية، زبدة كمأة بيريغورد السوداء، بيوريه البطاطس المخملية وصلصة فطر الموريل البري.',
    price: 58,
    image: '',
    isChefSpecial: 1,
    isBestSeller: 0,
    isVegetarian: 0,
    isSpicy: 0,
    inStock: 1,
  },
  {
    id: 'dish-3',
    categoryId: 'steaks',
    nameEn: 'Australian Charred Lamb Cutlets',
    nameAr: 'ريش لحم الضأن الأسترالي المشوية',
    descEn: 'Rosemary & zaatar crusted lamb cutlets, smoked eggplant mutabbal emulsion, pomegranate pearls, and mint chimichurri drizzle.',
    descAr: 'ريش لحم ضأن أسترالي متبلة بالروزماري والزعتر البري، مع متبل الباذنجان المدخن، حبات الرمان وصوص الشيميشوري بالنعناع.',
    price: 46,
    image: '',
    isChefSpecial: 0,
    isBestSeller: 1,
    isVegetarian: 0,
    isSpicy: 0,
    inStock: 1,
  },
  {
    id: 'dish-4',
    categoryId: 'steaks',
    nameEn: 'Smoked Cedar Plank Atlantic Salmon',
    nameAr: 'سلمون أطلسي مدخن بخشب الأرز العطري',
    descEn: 'Slow-charred salmon glazed with bourbon orange blossom honey, served alongside baby bok choy and saffron jasmine pilaf.',
    descAr: 'سلمون فاخر مطهو على لوح خشب الأرز بلمسة عسل زهر البرتقال، يُقدم مع بوك تشوي المقرمش وأرز الياسمين بالزعفران.',
    price: 39,
    image: '',
    isChefSpecial: 0,
    isBestSeller: 0,
    isVegetarian: 0,
    isSpicy: 0,
    inStock: 1,
  },
  {
    id: 'dish-5',
    categoryId: 'appetizers',
    nameEn: 'Black Truffle Edamame with Fleur de Sel',
    nameAr: 'إدامامي بالكمأة السوداء وملح البحر الفرنسي',
    descEn: 'Steamed young soybeans tossed in cold-pressed white truffle oil, roasted sesame seeds, and crystalline French fleur de sel.',
    descAr: 'حبوب إدامامي مطهوة على البخار مع زيت الكمأة البيضاء المعصور على البارد، سمسم محمص ورقائق ملح البحر النقي.',
    price: 18,
    image: '',
    isChefSpecial: 0,
    isBestSeller: 1,
    isVegetarian: 1,
    isSpicy: 0,
    inStock: 1,
  },
  {
    id: 'dish-6',
    categoryId: 'appetizers',
    nameEn: 'Botanical Burrata & Caramelized Black Figs',
    nameAr: 'جبنة بوراتا البستان مع تين أسود مكرمل',
    descEn: 'Fresh Pugliese burrata, heirloom cherry tomatoes, 25-year aged balsamic caviar, roasted pine nuts, and micro basil leaves.',
    descAr: 'جبنة بوراتا إيطالية طازجة مع طماطم ملونة، كافيار الخل البلسمي المعتق 25 عاماً، صنوبر محمص وأوراق الريحان العطرية.',
    price: 24,
    image: '',
    isChefSpecial: 1,
    isBestSeller: 0,
    isVegetarian: 1,
    isSpicy: 0,
    inStock: 1,
  },
  {
    id: 'dish-7',
    categoryId: 'sushi',
    nameEn: 'Dragon Volcano Crunch Roll',
    nameAr: 'رول سوشي دراغون فولكانو المقرمش',
    descEn: 'Tiger prawn tempura, avocado, flame-torched spicy salmon tartar topping, tobiko caviar, unagi reduction, and scallion curls.',
    descAr: 'رول تمبورا الروبيان العملاق، أفوكادو كريمي، يعلوه تارتار السلمون المحمر باللهب مع كافيار توبيكو وصلصة أوناجي فاخرة.',
    price: 29,
    image: '',
    isChefSpecial: 1,
    isBestSeller: 1,
    isVegetarian: 0,
    isSpicy: 1,
    inStock: 1,
  },
  {
    id: 'dish-8',
    categoryId: 'cocktails',
    nameEn: 'Jungle Mist Smoked Old Fashioned',
    nameAr: 'جانغل ميست - أولد فاشند مدخن بأعشاب الغابة',
    descEn: 'Woodford Reserve bourbon, smoked cherry bitters, burnt demerara sugar, infused under a glass cloche with aromatic hickory wood mist.',
    descAr: 'مشروب فاخر معتق، نكهات الكرز والكراميل المدخن، يُقدم تحت غطاء زجاجي مع دخان خشب الهيكوري العطري أمام الطاولة.',
    price: 23,
    image: '',
    isChefSpecial: 1,
    isBestSeller: 1,
    isVegetarian: 0,
    isSpicy: 0,
    inStock: 1,
  },
  {
    id: 'dish-9',
    categoryId: 'desserts',
    nameEn: 'Dark Chocolate Lava Sphere with Gold Leaf',
    nameAr: 'قبة الشوكولاتة الداكنة المذابة مع ورق الذهب',
    descEn: 'Valrhona 72% dark chocolate sphere melted tableside with hot salted caramel ganache, revealing Madagascan bourbon vanilla bean ice cream.',
    descAr: 'كرة شوكولاتة فالرونا 72% تُذاب بصلصة الكراميل المملح الساخنة، لتكشف عن آيس كريم فانيليا مدغشقر الفاخرة.',
    price: 22,
    image: '',
    isChefSpecial: 1,
    isBestSeller: 1,
    isVegetarian: 1,
    isSpicy: 0,
    inStock: 1,
  }
];

if (dishesCount === 0) {
  const insertDishStmt = db.prepare(`
    INSERT INTO dishes (
      id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
      isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const d of defaultDishes) {
    insertDishStmt.run(
      d.id, d.categoryId, d.nameEn, d.nameAr, d.descEn, d.descAr, d.price, d.image,
      d.isChefSpecial, d.isBestSeller, d.isVegetarian, d.isSpicy, d.inStock, now, now
    );
  }
}

// ======================== REST API ROUTES ======================== //

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

// 2. POST / Update Settings
app.post('/api/settings', (req, res) => {
  try {
    const updates = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, String(value));
    }
    res.json({ success: true, message: 'Settings updated successfully' });
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

// 4. POST Add Category
app.post('/api/categories', (req, res) => {
  try {
    const { id, nameEn, nameAr, icon, displayOrder } = req.body;
    const catId = id || `cat-${Date.now()}`;
    const stmt = db.prepare('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
    stmt.run(catId, nameEn, nameAr, icon || 'utensils', Number(displayOrder) || 0);
    res.json({ success: true, id: catId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE Category
app.delete('/api/categories/:id', (req, res) => {
  try {
    const catId = req.params.id;
    // Check count
    const total = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
    if (total <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only remaining category' });
    }
    db.prepare('DELETE FROM dishes WHERE categoryId = ?').run(catId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catId);
    res.json({ success: true, message: 'Category and its items deleted cleanly' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET All Dishes
app.get('/api/dishes', (req, res) => {
  try {
    const dishes = db.prepare('SELECT * FROM dishes ORDER BY rowid DESC').all();
    // Convert 0/1 to boolean for frontend convenience
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

// 7. POST Add New Dish
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
      d.nameEn,
      d.nameAr,
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

    res.json({ success: true, id: dishId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. PUT Update Dish (Clean complete overwrite)
app.put('/api/dishes/:id', (req, res) => {
  try {
    const dishId = req.params.id;
    const d = req.body;
    const now = new Date().toISOString();

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
      d.nameEn,
      d.nameAr,
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

    res.json({ success: true, message: 'Dish updated cleanly' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. DELETE Dish (Clean complete wipe)
app.delete('/api/dishes/:id', (req, res) => {
  try {
    const dishId = req.params.id;
    const stmt = db.prepare('DELETE FROM dishes WHERE id = ?');
    const result = stmt.run(dishId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Dish not found' });
    }

    res.json({ success: true, message: 'Dish deleted completely from database' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST Image Upload (Supports all image formats: JPG, JPEG, PNG, WEBP, SVG, GIF, AVIF, BMP, ICO, TIFF, HEIC, HEIF)
app.post('/api/upload', (req, res) => {
  try {
    const { base64Data, filename } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Match base64 prefix
    const matches = base64Data.match(/^data:([A-Za-z-+\/0-9.]+);base64,(.+)$/);
    let buffer;
    let ext = 'jpg';

    if (matches && matches.length === 3) {
      const mime = matches[1].toLowerCase();
      if (mime.includes('jpeg')) ext = 'jpeg';
      else if (mime.includes('jpg')) ext = 'jpg';
      else if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('svg')) ext = 'svg';
      else if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('avif')) ext = 'avif';
      else if (mime.includes('bmp')) ext = 'bmp';
      else if (mime.includes('ico') || mime.includes('x-icon')) ext = 'ico';
      else if (mime.includes('tiff') || mime.includes('tif')) ext = 'tiff';
      else if (mime.includes('heic')) ext = 'heic';
      else if (mime.includes('heif')) ext = 'heif';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64Data, 'base64');
    }

    // Check if filename has specific valid extension
    if (filename && typeof filename === 'string') {
      const match = filename.match(/\.([a-zA-Z0-9]+)$/);
      if (match) {
        const fileExt = match[1].toLowerCase();
        const allowed = ['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif', 'avif', 'bmp', 'ico', 'tiff', 'tif', 'heic', 'heif'];
        if (allowed.includes(fileExt)) {
          ext = fileExt;
        }
      }
    }

    if (isVercel) {
      // On Vercel serverless, return the base64 data URL directly
      // This permanently embeds images in SQLite without relying on ephemeral disks
      return res.json({ success: true, url: base64Data, extension: ext });
    }

    const safeFilename = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
    const filePath = path.join(uploadsDir, safeFilename);

    fs.writeFileSync(filePath, buffer);

    const relativeUrl = `/uploads/${safeFilename}`;
    res.json({ success: true, url: relativeUrl, extension: ext });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST Reset to Factory Defaults
app.post('/api/reset', (req, res) => {
  try {
    // Clear and restore
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

    const insertDishStmt = db.prepare(`
      INSERT INTO dishes (
        id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
        isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const d of defaultDishes) {
      insertDishStmt.run(
        d.id, d.categoryId, d.nameEn, d.nameAr, d.descEn, d.descAr, d.price, d.image,
        d.isChefSpecial, d.isBestSeller, d.isVegetarian, d.isSpicy, d.inStock, now, now
      );
    }

    res.json({ success: true, message: 'Database reset to default luxury menu' });
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
        insertSettingStmt.run(key, String(value || ''));
      }
    }

    if (Array.isArray(categories) && categories.length > 0) {
      db.exec('DELETE FROM categories;');
      const insertCatStmt = db.prepare('INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)');
      for (const cat of categories) {
        insertCatStmt.run(cat.id, cat.nameEn, cat.nameAr, cat.icon || 'utensils', cat.displayOrder || 0);
      }
    }

    if (Array.isArray(dishes) && dishes.length > 0) {
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
          d.inStock !== undefined ? (d.inStock ? 1 : 0) : 1,
          d.createdAt || now, d.updatedAt || now
        );
      }
    }

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

// Start Server locally if not on Vercel
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`\n🌿 Jungle Rooftop & Lounge Server running at: http://localhost:${PORT}`);
    console.log(`📁 Database: SQLite (Native Node 24 at ${dbPath})`);
  });
}

// Export for Vercel Serverless
module.exports = app;

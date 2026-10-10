// server.js - Jungle Rooftop & Lounge Server
// Powered by TiDB Cloud Serverless & Vercel Blob Storage

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// Load environment variables
try {
  require('dotenv').config({ path: '.env.local' });
  require('dotenv').config();
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);

// Enable JSON body parser (with 50mb limit for high-res photos/logos)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

// Aggressive cache prevention headers on all API routes so updates reflect instantly everywhere
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve static frontend files
app.use(express.static(__dirname));

// Local uploads directory for local development fallback
const localUploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(localUploadsDir)) {
  try { fs.mkdirSync(localUploadsDir, { recursive: true }); } catch (_) {}
}
app.use('/uploads', express.static(localUploadsDir));

// Vercel Blob Configuration
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// Global menu version tracker for live cross-device refresh
let menuVersion = Date.now();

// Image Storage Helper: Uploads to Vercel Blob (CDN URL) or saves locally
async function saveImage(imageData, customFilename) {
  if (!imageData || typeof imageData !== 'string') return '';
  if (!imageData.startsWith('data:image/')) return imageData;

  try {
    const parts = imageData.split(',');
    const meta = parts[0].toLowerCase();
    const raw = parts.slice(1).join(',');

    let ext = 'jpg';
    let mimeType = 'image/jpeg';
    if (meta.includes('webp')) { ext = 'webp'; mimeType = 'image/webp'; }
    else if (meta.includes('png')) { ext = 'png'; mimeType = 'image/png'; }
    else if (meta.includes('svg')) { ext = 'svg'; mimeType = 'image/svg+xml'; }
    else if (meta.includes('gif')) { ext = 'gif'; mimeType = 'image/gif'; }

    const buffer = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
    const safeFilename = customFilename || `img_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;

    // If Vercel Blob token is available, store in high-speed cloud storage
    if (BLOB_TOKEN) {
      try {
        const { put } = require('@vercel/blob');
        const blob = await put(`uploads/${safeFilename}`, buffer, {
          access: 'public',
          token: BLOB_TOKEN,
          contentType: mimeType,
          addRandomSuffix: true,
        });
        return blob.url;
      } catch (blobErr) {
        console.warn('Vercel Blob upload failed, falling back to local file:', blobErr.message);
      }
    }

    // Local fallback: save to disk
    const diskPath = path.join(localUploadsDir, safeFilename);
    fs.writeFileSync(diskPath, buffer);
    return `/uploads/${safeFilename}`;
  } catch (err) {
    console.warn('Failed to process image:', err.message);
    return imageData;
  }
}

// Image Deletion Helper: Deletes images from Vercel Blob or local disk
async function deleteImageFile(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return;

  try {
    // 1. Vercel Blob deletion
    if (imageUrl.includes('blob.vercel-storage.com') && BLOB_TOKEN) {
      const { del } = require('@vercel/blob');
      await del(imageUrl, { token: BLOB_TOKEN });
      return;
    }

    // 2. Local uploads file deletion
    if (imageUrl.startsWith('/uploads/')) {
      const filename = path.basename(imageUrl);
      const filePath = path.join(localUploadsDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.warn('Image deletion note:', err.message);
  }
}

// Initialize database schema asynchronously on boot
const dbReady = db.initDatabase().catch(err => {
  console.error('Initial TiDB Cloud connection error:', err);
});

// Middleware to ensure DB is initialized before processing API requests
app.use('/api', async (req, res, next) => {
  try {
    await dbReady;
    next();
  } catch (err) {
    console.error('Database is unavailable:', err);
    res.status(503).json({ error: 'Database connection failed', details: err.message });
  }
});

// ======================== REST API ROUTES (TiDB Cloud) ======================== //

// 0. Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'TiDB Cloud (Serverless)',
    blobConfigured: Boolean(BLOB_TOKEN),
    runtime: isVercel ? 'vercel-serverless' : 'local-node',
  });
});

// 0.1 Menu Version for live polling
app.get('/api/menu-version', (req, res) => {
  res.json({ version: menuVersion, timestamp: new Date().toISOString() });
});

// 1. Full Menu in 1 Call
app.get('/api/menu', async (req, res) => {
  try {
    const settingsRows = await db.all('SELECT `key`, `value` FROM settings');
    const settings = {};
    for (const r of settingsRows) {
      settings[r.key] = r.value;
    }

    const categories = await db.all('SELECT * FROM categories ORDER BY displayOrder ASC, nameEn ASC');
    const dishesRaw = await db.all('SELECT * FROM dishes ORDER BY createdAt DESC, id DESC');
    const dishes = dishesRaw.map(d => ({
      ...d,
      price: parseFloat(d.price) || 0,
      isChefSpecial: Boolean(d.isChefSpecial),
      isBestSeller: Boolean(d.isBestSeller),
      isVegetarian: Boolean(d.isVegetarian),
      isSpicy: Boolean(d.isSpicy),
      inStock: Boolean(d.inStock),
    }));

    res.json({
      settings,
      categories,
      dishes,
      version: menuVersion,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error fetching /api/menu:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Settings (GET)
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await db.all('SELECT `key`, `value` FROM settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    console.error('Error fetching /api/settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Settings (POST Update)
app.post('/api/settings', async (req, res) => {
  try {
    const updates = req.body;

    // Handle logo replacement cleanup
    if (updates.logoUrl !== undefined) {
      const oldLogo = await db.get("SELECT `value` FROM settings WHERE `key` = 'logoUrl'");
      if (oldLogo && oldLogo.value && oldLogo.value !== updates.logoUrl) {
        deleteImageFile(oldLogo.value);
      }
      if (typeof updates.logoUrl === 'string' && updates.logoUrl.startsWith('data:image/')) {
        updates.logoUrl = await saveImage(updates.logoUrl);
      }
    }

    // Handle hero background replacement cleanup
    if (updates.heroBgUrl !== undefined) {
      const oldBg = await db.get("SELECT `value` FROM settings WHERE `key` = 'heroBgUrl'");
      if (oldBg && oldBg.value && oldBg.value !== updates.heroBgUrl) {
        deleteImageFile(oldBg.value);
      }
      if (typeof updates.heroBgUrl === 'string' && updates.heroBgUrl.startsWith('data:image/')) {
        updates.heroBgUrl = await saveImage(updates.heroBgUrl);
      }
    }

    // Overwrite all updated settings in TiDB Cloud
    for (const [key, value] of Object.entries(updates)) {
      let finalVal = String(value ?? '');
      if (finalVal.startsWith('data:image/')) {
        finalVal = await saveImage(finalVal);
      }
      await db.run(
        'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        [key, finalVal]
      );
    }

    menuVersion = Date.now();
    res.json({ success: true, message: 'Settings saved permanently in TiDB Cloud' });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Categories (GET)
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await db.all('SELECT * FROM categories ORDER BY displayOrder ASC, nameEn ASC');
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Category (POST Add / Update)
app.post('/api/categories', async (req, res) => {
  try {
    const { id, nameEn, nameAr, icon, displayOrder } = req.body;
    const catId = id || `cat-${Date.now()}`;

    await db.run(
      `INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nameEn = VALUES(nameEn),
         nameAr = VALUES(nameAr),
         icon = VALUES(icon),
         displayOrder = VALUES(displayOrder)`,
      [catId, nameEn || '', nameAr || '', icon || 'utensils', Number(displayOrder) || 0]
    );

    menuVersion = Date.now();
    res.json({ success: true, id: catId });
  } catch (err) {
    console.error('Error saving category:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Category (DELETE Hard Delete)
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const catId = req.params.id;

    // Unassign category from dishes so they stay safely visible under All Categories
    await db.run("UPDATE dishes SET categoryId = '' WHERE categoryId = ?", [catId]);
    await db.run('DELETE FROM categories WHERE id = ?', [catId]);

    menuVersion = Date.now();
    res.json({ success: true, message: 'Category permanently deleted from TiDB Cloud' });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Clear All Categories
app.post('/api/categories/clear-all', async (req, res) => {
  try {
    await db.run("UPDATE dishes SET categoryId = ''");
    await db.run('DELETE FROM categories');

    menuVersion = Date.now();
    res.json({ success: true, message: 'All categories deleted permanently from TiDB Cloud' });
  } catch (err) {
    console.error('Error clearing categories:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Dishes (GET)
app.get('/api/dishes', async (req, res) => {
  try {
    const dishesRaw = await db.all('SELECT * FROM dishes ORDER BY createdAt DESC, id DESC');
    const formatted = dishesRaw.map(d => ({
      ...d,
      price: parseFloat(d.price) || 0,
      isChefSpecial: Boolean(d.isChefSpecial),
      isBestSeller: Boolean(d.isBestSeller),
      isVegetarian: Boolean(d.isVegetarian),
      isSpicy: Boolean(d.isSpicy),
      inStock: Boolean(d.inStock),
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Error fetching dishes:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. Dish (POST Add New Dish)
app.post('/api/dishes', async (req, res) => {
  try {
    const d = req.body;
    const dishId = String(d.id || `dish-${Date.now()}`).trim();
    const now = new Date().toISOString();

    let finalImageUrl = d.image || '';
    if (typeof finalImageUrl === 'string' && finalImageUrl.startsWith('data:image/')) {
      finalImageUrl = await saveImage(finalImageUrl);
    }

    const sql = `
      INSERT INTO dishes (
        id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
        isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        categoryId = VALUES(categoryId),
        nameEn = VALUES(nameEn),
        nameAr = VALUES(nameAr),
        descEn = VALUES(descEn),
        descAr = VALUES(descAr),
        price = VALUES(price),
        image = VALUES(image),
        isChefSpecial = VALUES(isChefSpecial),
        isBestSeller = VALUES(isBestSeller),
        isVegetarian = VALUES(isVegetarian),
        isSpicy = VALUES(isSpicy),
        inStock = VALUES(inStock),
        updatedAt = VALUES(updatedAt)
    `;

    await db.run(sql, [
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
      now,
    ]);

    menuVersion = Date.now();
    res.json({ success: true, id: dishId, image: finalImageUrl });
  } catch (err) {
    console.error('Error adding dish:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10. Dish (PUT Update Dish - Hard Replace/Update)
app.put('/api/dishes/:id', async (req, res) => {
  try {
    const rawId = req.params.id || req.body.id || '';
    const dishId = String(decodeURIComponent(rawId)).trim();
    if (!dishId) {
      return res.status(400).json({ error: 'Missing dish id' });
    }

    const d = req.body;
    const now = new Date().toISOString();
    const oldDish = await db.get('SELECT * FROM dishes WHERE id = ?', [dishId]);

    let finalImageUrl = d.image !== undefined ? d.image : (oldDish ? oldDish.image : '');
    if (typeof finalImageUrl === 'string' && finalImageUrl.startsWith('data:image/')) {
      finalImageUrl = await saveImage(finalImageUrl);
    }

    // Clean up old image if replaced
    if (oldDish && oldDish.image && oldDish.image !== finalImageUrl) {
      deleteImageFile(oldDish.image);
    }

    if (!oldDish) {
      // Dish doesn't exist yet: insert new
      const sqlInsert = `
        INSERT INTO dishes (
          id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
          isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await db.run(sqlInsert, [
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
        now,
      ]);
    } else {
      // Overwrite/Update existing dish in TiDB Cloud
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

      await db.run(sqlUpdate, [
        d.categoryId !== undefined ? d.categoryId : oldDish.categoryId,
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
        dishId,
      ]);
    }

    menuVersion = Date.now();
    res.json({ success: true, message: 'Dish updated permanently in TiDB Cloud', id: dishId, image: finalImageUrl });
  } catch (err) {
    console.error('Error updating dish:', err);
    res.status(500).json({ error: err.message });
  }
});

// 11. Dish (DELETE Hard Delete Permanently)
app.delete('/api/dishes/:id', async (req, res) => {
  try {
    const rawId = req.params.id || '';
    const dishId = String(decodeURIComponent(rawId)).trim();

    const dish = await db.get('SELECT image FROM dishes WHERE id = ?', [dishId]);
    if (dish && dish.image) {
      deleteImageFile(dish.image);
    }

    await db.run('DELETE FROM dishes WHERE id = ?', [dishId]);

    menuVersion = Date.now();
    res.json({ success: true, message: 'Dish permanently deleted from TiDB Cloud' });
  } catch (err) {
    console.error('Error deleting dish:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. Clear All Dishes (Hard Delete Permanently)
app.post('/api/dishes/clear-all', async (req, res) => {
  try {
    const dishes = await db.all('SELECT image FROM dishes');
    for (const d of dishes) {
      if (d.image) {
        deleteImageFile(d.image);
      }
    }

    await db.run('DELETE FROM dishes');

    menuVersion = Date.now();
    res.json({ success: true, message: 'All dishes permanently cleared from TiDB Cloud' });
  } catch (err) {
    console.error('Error clearing all dishes:', err);
    res.status(500).json({ error: err.message });
  }
});

// 13. Image Upload Endpoint
app.post('/api/upload', async (req, res) => {
  try {
    const { base64Data, filename } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    const savedUrl = await saveImage(base64Data, filename);
    res.json({ success: true, url: savedUrl });
  } catch (err) {
    console.error('Upload endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 14. Reset Database to Factory Defaults
app.post('/api/reset', async (req, res) => {
  try {
    const dishes = await db.all('SELECT image FROM dishes');
    for (const d of dishes) {
      if (d.image) deleteImageFile(d.image);
    }

    await db.run('DELETE FROM dishes');
    await db.run('DELETE FROM categories');
    await db.run('DELETE FROM settings');

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
      await db.run(
        'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        [key, String(value ?? '')]
      );
    }

    menuVersion = Date.now();
    res.json({ success: true, message: 'Database reset to clean state in TiDB Cloud' });
  } catch (err) {
    console.error('Error resetting database:', err);
    res.status(500).json({ error: err.message });
  }
});

// 15. Backup (GET JSON Export)
app.get('/api/backup', async (req, res) => {
  try {
    const settingsRows = await db.all('SELECT `key`, `value` FROM settings');
    const settings = {};
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }
    const categories = await db.all('SELECT * FROM categories ORDER BY displayOrder ASC');
    const dishes = await db.all('SELECT * FROM dishes ORDER BY createdAt DESC');

    res.json({
      exportedAt: new Date().toISOString(),
      restaurant: settings.restaurantNameAr || 'Jungle Rooftop & Lounge',
      settings,
      categories,
      dishes,
    });
  } catch (err) {
    console.error('Error creating backup:', err);
    res.status(500).json({ error: err.message });
  }
});

// 16. Restore (POST JSON Import)
app.post('/api/restore', async (req, res) => {
  try {
    const { settings, categories, dishes } = req.body;
    if (!settings && !categories && !dishes) {
      return res.status(400).json({ error: 'Invalid backup data' });
    }

    if (settings && typeof settings === 'object') {
      for (const [key, value] of Object.entries(settings)) {
        await db.run(
          'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
          [key, String(value ?? '')]
        );
      }
    }

    if (Array.isArray(categories)) {
      await db.run('DELETE FROM categories');
      for (const cat of categories) {
        await db.run(
          'INSERT INTO categories (id, nameEn, nameAr, icon, displayOrder) VALUES (?, ?, ?, ?, ?)',
          [cat.id, cat.nameEn, cat.nameAr, cat.icon || 'utensils', Number(cat.displayOrder) || 0]
        );
      }
    }

    if (Array.isArray(dishes)) {
      await db.run('DELETE FROM dishes');
      const now = new Date().toISOString();
      for (const d of dishes) {
        await db.run(
          `INSERT INTO dishes (
            id, categoryId, nameEn, nameAr, descEn, descAr, price, image,
            isChefSpecial, isBestSeller, isVegetarian, isSpicy, inStock, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            d.id, d.categoryId, d.nameEn, d.nameAr, d.descEn || '', d.descAr || '',
            Number(d.price) || 0, d.image || '',
            d.isChefSpecial ? 1 : 0, d.isBestSeller ? 1 : 0,
            d.isVegetarian ? 1 : 0, d.isSpicy ? 1 : 0,
            d.inStock !== false ? 1 : 0,
            d.createdAt || now, d.updatedAt || now
          ]
        );
      }
    }

    menuVersion = Date.now();
    res.json({ success: true, message: 'Data restored successfully to TiDB Cloud' });
  } catch (err) {
    console.error('Error restoring backup:', err);
    res.status(500).json({ error: err.message });
  }
});

// Explicit Admin Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Catch-all to serve customer menu index.html
app.use((req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server locally if run directly
if (!isVercel && require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🌿 Jungle Rooftop & Lounge Server running at: http://localhost:${PORT}`);
    console.log(`☁️ Database: TiDB Cloud (Serverless)`);
  });
}

// Export for Vercel Serverless Function
module.exports = app;

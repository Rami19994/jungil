// db.js - TiDB Cloud Serverless Database Adapter for Jungle Rooftop & Lounge
// Uses @tidbcloud/serverless for zero-connection-pool HTTPS queries (ideal for Vercel Serverless)

const { connect } = require('@tidbcloud/serverless');

// Load environment variables if running locally
try {
  require('dotenv').config({ path: '.env.local' });
  require('dotenv').config();
} catch (_) {}

const DEFAULT_DB_URL = 'mysql://BKwcRjQd2jpMwgD.root:3lrHd8U3fjrgrmGr@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/jungle_menu';

function getDatabaseUrl() {
  let url = process.env.DATABASE_URL || DEFAULT_DB_URL;
  // If user provides a connection string ending in /sys, redirect to /jungle_menu to prevent MySQL permission error 1142
  if (url.endsWith('/sys')) {
    url = url.slice(0, -4) + '/jungle_menu';
  }
  return url;
}

const dbUrl = getDatabaseUrl();
const conn = connect({ url: dbUrl });

// Helper to execute raw queries
async function execute(sql, params = []) {
  return await conn.execute(sql, params);
}

// Helper to get all matching rows
async function all(sql, params = []) {
  const rows = await conn.execute(sql, params);
  return Array.isArray(rows) ? rows : [];
}

// Helper to get single row
async function get(sql, params = []) {
  const rows = await conn.execute(sql, params);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// Helper for INSERT / UPDATE / DELETE queries
async function run(sql, params = []) {
  const result = await conn.execute(sql, params);
  return result;
}

// Initialize tables in TiDB Cloud and populate default branding if empty
async function initDatabase() {
  try {
    // 1. Settings Table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(191) PRIMARY KEY,
        \`value\` LONGTEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Categories Table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        \`id\` VARCHAR(100) PRIMARY KEY,
        \`nameEn\` VARCHAR(255) NOT NULL,
        \`nameAr\` VARCHAR(255) NOT NULL,
        \`icon\` VARCHAR(100) DEFAULT 'utensils',
        \`displayOrder\` INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Dishes Table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS dishes (
        \`id\` VARCHAR(100) PRIMARY KEY,
        \`categoryId\` VARCHAR(100) NOT NULL,
        \`nameEn\` VARCHAR(255) NOT NULL,
        \`nameAr\` VARCHAR(255) NOT NULL,
        \`descEn\` TEXT,
        \`descAr\` TEXT,
        \`price\` DECIMAL(10, 2) NOT NULL DEFAULT 0,
        \`image\` LONGTEXT,
        \`isChefSpecial\` TINYINT(1) DEFAULT 0,
        \`isBestSeller\` TINYINT(1) DEFAULT 0,
        \`isVegetarian\` TINYINT(1) DEFAULT 0,
        \`isSpicy\` TINYINT(1) DEFAULT 0,
        \`inStock\` TINYINT(1) DEFAULT 1,
        \`createdAt\` VARCHAR(50),
        \`updatedAt\` VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Check if initial settings exist
    const isInit = await get("SELECT `value` FROM settings WHERE `key` = 'isInitialized'");
    if (!isInit) {
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
        logoUrl: '/uploads/img_1791311494909_5435.png',
        heroBgUrl: '/uploads/img_1791311466189_1063.png',
        isInitialized: 'true',
      };

      for (const [key, value] of Object.entries(defaultSettings)) {
        await conn.execute(
          'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
          [key, String(value ?? '')]
        );
      }
      console.log('✓ Initialized default settings in TiDB Cloud');
    }

    console.log('✓ Connected & verified tables in TiDB Cloud (Serverless)');
  } catch (err) {
    console.error('Error during TiDB Cloud initialization:', err);
    throw err;
  }
}

module.exports = {
  conn,
  execute,
  all,
  get,
  run,
  initDatabase,
};

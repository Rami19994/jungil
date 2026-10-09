-- TiDB Cloud Serverless MySQL Database Schema for Jungle Rooftop & Lounge
-- Compatible with MySQL 8.0, TiDB Serverless, UTF8MB4, and persistent relational integrity

-- 1. Restaurant Settings & Brand Profile
CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(191) PRIMARY KEY,
  `value` LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Menu Categories
CREATE TABLE IF NOT EXISTS categories (
  `id` VARCHAR(100) PRIMARY KEY,
  `nameEn` VARCHAR(255) NOT NULL,
  `nameAr` VARCHAR(255) NOT NULL,
  `icon` VARCHAR(100) DEFAULT 'utensils',
  `displayOrder` INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Menu Dishes & Luxury Culinary Offerings
CREATE TABLE IF NOT EXISTS dishes (
  `id` VARCHAR(100) PRIMARY KEY,
  `categoryId` VARCHAR(100) NOT NULL,
  `nameEn` VARCHAR(255) NOT NULL,
  `nameAr` VARCHAR(255) NOT NULL,
  `descEn` TEXT,
  `descAr` TEXT,
  `price` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `image` LONGTEXT,
  `isChefSpecial` TINYINT(1) DEFAULT 0,
  `isBestSeller` TINYINT(1) DEFAULT 0,
  `isVegetarian` TINYINT(1) DEFAULT 0,
  `isSpicy` TINYINT(1) DEFAULT 0,
  `inStock` TINYINT(1) DEFAULT 1,
  `createdAt` VARCHAR(50),
  `updatedAt` VARCHAR(50),
  INDEX idx_dishes_category (`categoryId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

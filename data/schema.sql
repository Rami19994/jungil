-- SQLite 3 Database Schema for Jungle Rooftop & Lounge
-- Compatible with pure SQLite 3, WAL/DELETE journal modes, and full relational integrity

PRAGMA foreign_keys = ON;

-- 1. Restaurant Settings & Brand Profile
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 2. Menu Categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  nameEn TEXT NOT NULL,
  nameAr TEXT NOT NULL,
  icon TEXT DEFAULT 'utensils',
  displayOrder INTEGER DEFAULT 0
);

-- 3. Menu Dishes & Luxury Culinary Offerings
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

CREATE INDEX IF NOT EXISTS idx_dishes_category ON dishes(categoryId);

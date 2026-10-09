import {
  boolean,
  integer,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const menuMetaTable = pgTable("menu_meta", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const menuSettingsTable = pgTable("menu_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const menuCategoriesTable = pgTable("menu_categories", {
  id: text("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  icon: text("icon").notNull().default("utensils"),
  displayOrder: integer("display_order").notNull().default(0),
});

export const menuDishesTable = pgTable("menu_dishes", {
  id: text("id").primaryKey(),
  categoryId: text("category_id").notNull().default(""),
  nameEn: text("name_en").notNull().default(""),
  nameAr: text("name_ar").notNull().default(""),
  descEn: text("desc_en").notNull().default(""),
  descAr: text("desc_ar").notNull().default(""),
  price: real("price").notNull().default(0),
  image: text("image").notNull().default(""),
  isChefSpecial: boolean("is_chef_special").notNull().default(false),
  isBestSeller: boolean("is_best_seller").notNull().default(false),
  isVegetarian: boolean("is_vegetarian").notNull().default(false),
  isSpicy: boolean("is_spicy").notNull().default(false),
  inStock: boolean("in_stock").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type MenuCategory = typeof menuCategoriesTable.$inferSelect;
export type MenuDish = typeof menuDishesTable.$inferSelect;

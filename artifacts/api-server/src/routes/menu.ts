import { asc, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ClearCategoriesResponse,
  ClearDishesResponse,
  DeleteCategoryParams,
  DeleteCategoryResponse,
  DeleteDishParams,
  DeleteDishResponse,
  GetBackupResponse,
  GetMenuResponse,
  GetMenuVersionResponse,
  GetSettingsResponse,
  ListCategoriesResponse,
  ListDishesResponse,
  ResetRestaurantResponse,
  RestoreBackupBody,
  RestoreBackupResponse,
  SaveCategoryBody,
  SaveCategoryResponse,
  SaveDishBody,
  SaveDishResponse,
  UpdateDishBody,
  UpdateDishParams,
  UpdateDishResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
  UploadImageBody,
  UploadImageResponse,
} from "@workspace/api-zod";
import {
  db,
  menuCategoriesTable,
  menuDishesTable,
  menuMetaTable,
  menuSettingsTable,
} from "@workspace/db";

const router: IRouter = Router();
const MENU_META_ID = "main";

const DEFAULT_SETTINGS: Record<string, string> = {
  restaurantNameEn: "Jungle",
  restaurantNameAr: "جانغل",
  taglineEn: "Rooftop & Lounge Dining Experience",
  taglineAr: "تجربة طعام وسهرات استثنائية على الروف توب",
  subtitleEn: "Panoramic Skyline • Prime Botanical Cuts • Artisanal Mixology",
  subtitleAr: "إطلالة أفق بانورامية • أرقى قطع اللحوم • كوكتيلات فاخرة",
  addressEn: "Ankawa, Main Street, Luxury Hotel",
  addressAr: "عنكاوة - الشارع الرئيسي - فندق luxury",
  mapUrl: "https://maps.app.goo.gl/xiSWgf6a2JBKpTya9",
  logoUrl: "",
  heroBgUrl: "",
  isInitialized: "true",
};

const DEFAULT_CATEGORIES = [
  {
    id: "steaks",
    nameEn: "Steaks & Grills",
    nameAr: "مشاوي وستيك فاخر",
    icon: "flame",
    displayOrder: 1,
  },
  {
    id: "appetizers",
    nameEn: "Appetizers & Tapas",
    nameAr: "مقبلات وتاباس",
    icon: "utensils",
    displayOrder: 2,
  },
  {
    id: "sushi",
    nameEn: "Sushi & Raw Bar",
    nameAr: "سوشي ومأكولات بحرية",
    icon: "sparkles",
    displayOrder: 3,
  },
  {
    id: "cocktails",
    nameEn: "Signature Cocktails",
    nameAr: "كوكتيلات مميزة",
    icon: "wine",
    displayOrder: 4,
  },
  {
    id: "mocktails",
    nameEn: "Mocktails & Tonics",
    nameAr: "موكتيلات وعصائر",
    icon: "coffee",
    displayOrder: 5,
  },
  {
    id: "desserts",
    nameEn: "Decadent Desserts",
    nameAr: "حلويات فاخرة",
    icon: "star",
    displayOrder: 6,
  },
  {
    id: "shisha",
    nameEn: "Shisha & Lounge",
    nameAr: "شيشة ولاونج سهرات",
    icon: "flame",
    displayOrder: 7,
  },
];

type MenuTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function bumpMenuVersion(tx: MenuTransaction): Promise<void> {
  await tx
    .update(menuMetaTable)
    .set({
      version: sql`${menuMetaTable.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(menuMetaTable.id, MENU_META_ID));
}

export async function initializeMenuData(): Promise<void> {
  await db
    .insert(menuMetaTable)
    .values({ id: MENU_META_ID })
    .onConflictDoNothing();

  const [initialized] = await db
    .select({ key: menuSettingsTable.key })
    .from(menuSettingsTable)
    .where(eq(menuSettingsTable.key, "isInitialized"))
    .limit(1);

  if (initialized) return;

  await db.transaction(async (tx) => {
    const [checkAgain] = await tx
      .select({ key: menuSettingsTable.key })
      .from(menuSettingsTable)
      .where(eq(menuSettingsTable.key, "isInitialized"))
      .limit(1);
    if (checkAgain) return;

    await tx
      .insert(menuSettingsTable)
      .values(
        Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })),
      )
      .onConflictDoNothing();
    await tx
      .insert(menuCategoriesTable)
      .values(DEFAULT_CATEGORIES)
      .onConflictDoNothing();
  });
}

async function readSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(menuSettingsTable);
  return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}

function makeDishValues(
  input: {
    id?: string;
    categoryId?: string;
    nameEn?: string;
    nameAr?: string;
    descEn?: string;
    descAr?: string;
    price?: number;
    image?: string;
    isChefSpecial?: boolean;
    isBestSeller?: boolean;
    isVegetarian?: boolean;
    isSpicy?: boolean;
    inStock?: boolean;
    createdAt?: string;
    updatedAt?: string;
  },
  id: string,
  now: string,
  existing?: (typeof menuDishesTable.$inferSelect) | undefined,
) {
  return {
    id,
    categoryId: input.categoryId ?? existing?.categoryId ?? "steaks",
    nameEn: input.nameEn ?? existing?.nameEn ?? "",
    nameAr: input.nameAr ?? existing?.nameAr ?? "",
    descEn: input.descEn ?? existing?.descEn ?? "",
    descAr: input.descAr ?? existing?.descAr ?? "",
    price: input.price ?? existing?.price ?? 0,
    image: input.image ?? existing?.image ?? "",
    isChefSpecial: input.isChefSpecial ?? existing?.isChefSpecial ?? false,
    isBestSeller: input.isBestSeller ?? existing?.isBestSeller ?? false,
    isVegetarian: input.isVegetarian ?? existing?.isVegetarian ?? false,
    isSpicy: input.isSpicy ?? existing?.isSpicy ?? false,
    inStock: input.inStock ?? existing?.inStock ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

router.get("/menu-version", async (_req, res): Promise<void> => {
  const [meta] = await db
    .select()
    .from(menuMetaTable)
    .where(eq(menuMetaTable.id, MENU_META_ID))
    .limit(1);
  const result = GetMenuVersionResponse.parse({
    version: meta?.version ?? 1,
    timestamp: meta?.updatedAt.toISOString() ?? new Date(0).toISOString(),
  });
  res.set("Cache-Control", "no-store").json(result);
});

router.get("/menu", async (_req, res): Promise<void> => {
  const [settings, categories, dishes, meta] = await Promise.all([
    readSettings(),
    db
      .select()
      .from(menuCategoriesTable)
      .orderBy(asc(menuCategoriesTable.displayOrder), asc(menuCategoriesTable.nameEn)),
    db.select().from(menuDishesTable).orderBy(desc(menuDishesTable.createdAt)),
    db
      .select()
      .from(menuMetaTable)
      .where(eq(menuMetaTable.id, MENU_META_ID))
      .limit(1),
  ]);
  res.set("Cache-Control", "no-store").json(
    GetMenuResponse.parse({
      settings,
      categories,
      dishes,
      updatedAt: meta[0]?.updatedAt.toISOString() ?? new Date().toISOString(),
    }),
  );
});

router.get("/settings", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store").json(
    GetSettingsResponse.parse(await readSettings()),
  );
});

router.post("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.transaction(async (tx) => {
    if (Object.keys(parsed.data).length > 0) {
      await tx
        .insert(menuSettingsTable)
        .values(
          Object.entries(parsed.data).map(([key, value]) => ({ key, value })),
        )
        .onConflictDoUpdate({
          target: menuSettingsTable.key,
          set: { value: sql`excluded.value` },
        });
    }
    await bumpMenuVersion(tx);
  });
  res.json(
    UpdateSettingsResponse.parse({
      success: true,
      message: "Settings saved",
    }),
  );
});

router.get("/categories", async (_req, res): Promise<void> => {
  const categories = await db
    .select()
    .from(menuCategoriesTable)
    .orderBy(asc(menuCategoriesTable.displayOrder), asc(menuCategoriesTable.nameEn));
  res.json(ListCategoriesResponse.parse(categories));
});

router.post("/categories", async (req, res): Promise<void> => {
  const parsed = SaveCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const id = input.id?.trim() || `cat-${Date.now()}`;
  await db.transaction(async (tx) => {
    await tx
      .insert(menuCategoriesTable)
      .values({
        id,
        nameEn: input.nameEn ?? "",
        nameAr: input.nameAr ?? "",
        icon: input.icon || "utensils",
        displayOrder: input.displayOrder ?? 0,
      })
      .onConflictDoUpdate({
        target: menuCategoriesTable.id,
        set: {
          nameEn: input.nameEn ?? "",
          nameAr: input.nameAr ?? "",
          icon: input.icon || "utensils",
          displayOrder: input.displayOrder ?? 0,
        },
      });
    await bumpMenuVersion(tx);
  });
  res.json(SaveCategoryResponse.parse({ success: true, id }));
});

router.delete("/categories/:id", async (req, res): Promise<void> => {
  const parsed = DeleteCategoryParams.safeParse({
    id: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { id } = parsed.data;
  await db.transaction(async (tx) => {
    await tx
      .update(menuDishesTable)
      .set({ categoryId: "" })
      .where(eq(menuDishesTable.categoryId, id));
    await tx
      .delete(menuCategoriesTable)
      .where(eq(menuCategoriesTable.id, id));
    await bumpMenuVersion(tx);
  });
  res.json(DeleteCategoryResponse.parse({ success: true, id }));
});

router.post("/categories/clear-all", async (_req, res): Promise<void> => {
  await db.transaction(async (tx) => {
    await tx.update(menuDishesTable).set({ categoryId: "" });
    await tx.delete(menuCategoriesTable);
    await bumpMenuVersion(tx);
  });
  res.json(ClearCategoriesResponse.parse({ success: true }));
});

router.get("/dishes", async (_req, res): Promise<void> => {
  const dishes = await db
    .select()
    .from(menuDishesTable)
    .orderBy(desc(menuDishesTable.createdAt));
  res.json(ListDishesResponse.parse(dishes));
});

router.post("/dishes", async (req, res): Promise<void> => {
  const parsed = SaveDishBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const id = parsed.data.id?.trim() || `dish-${Date.now()}`;
  const now = new Date().toISOString();
  const values = makeDishValues(parsed.data, id, now);
  await db.transaction(async (tx) => {
    await tx
      .insert(menuDishesTable)
      .values(values)
      .onConflictDoUpdate({
        target: menuDishesTable.id,
        set: { ...values, id },
      });
    await bumpMenuVersion(tx);
  });
  res.json(SaveDishResponse.parse({ success: true, id, image: values.image }));
});

router.put("/dishes/:id", async (req, res): Promise<void> => {
  const params = UpdateDishParams.safeParse({
    id: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
  });
  const parsed = UpdateDishBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = params.data.id.trim();
  const now = new Date().toISOString();
  let savedImage = "";
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(menuDishesTable)
      .where(eq(menuDishesTable.id, id))
      .limit(1);
    const values = makeDishValues(parsed.data, id, now, existing);
    savedImage = values.image;
    await tx
      .insert(menuDishesTable)
      .values(values)
      .onConflictDoUpdate({
        target: menuDishesTable.id,
        set: {
          categoryId: values.categoryId,
          nameEn: values.nameEn,
          nameAr: values.nameAr,
          descEn: values.descEn,
          descAr: values.descAr,
          price: values.price,
          image: values.image,
          isChefSpecial: values.isChefSpecial,
          isBestSeller: values.isBestSeller,
          isVegetarian: values.isVegetarian,
          isSpicy: values.isSpicy,
          inStock: values.inStock,
          updatedAt: now,
        },
      });
    await bumpMenuVersion(tx);
  });
  res.json(
    UpdateDishResponse.parse({
      success: true,
      message: "Dish saved",
      id,
      image: savedImage,
    }),
  );
});

router.delete("/dishes/:id", async (req, res): Promise<void> => {
  const parsed = DeleteDishParams.safeParse({
    id: Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(menuDishesTable).where(eq(menuDishesTable.id, parsed.data.id));
    await bumpMenuVersion(tx);
  });
  res.json(DeleteDishResponse.parse({ success: true, id: parsed.data.id }));
});

router.post("/dishes/clear-all", async (_req, res): Promise<void> => {
  await db.transaction(async (tx) => {
    await tx.delete(menuDishesTable);
    await bumpMenuVersion(tx);
  });
  res.json(ClearDishesResponse.parse({ success: true }));
});

router.post("/upload", async (req, res): Promise<void> => {
  const parsed = UploadImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.base64Data.startsWith("data:image/")) {
    res.status(400).json({ error: "Invalid image data" });
    return;
  }
  res.json(
    UploadImageResponse.parse({
      success: true,
      url: parsed.data.base64Data,
    }),
  );
});

router.post("/reset", async (_req, res): Promise<void> => {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.delete(menuDishesTable);
    await tx.delete(menuCategoriesTable);
    await tx.delete(menuSettingsTable);
    await tx
      .insert(menuSettingsTable)
      .values(
        Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })),
      );
    await tx.insert(menuCategoriesTable).values(DEFAULT_CATEGORIES);
    await bumpMenuVersion(tx);
  });
  res.json(
    ResetRestaurantResponse.parse({
      success: true,
      message: `Menu reset at ${now}`,
    }),
  );
});

router.get("/backup", async (_req, res): Promise<void> => {
  const [settings, categories, dishes] = await Promise.all([
    readSettings(),
    db
      .select()
      .from(menuCategoriesTable)
      .orderBy(asc(menuCategoriesTable.displayOrder)),
    db.select().from(menuDishesTable).orderBy(desc(menuDishesTable.createdAt)),
  ]);
  res.json(
    GetBackupResponse.parse({
      exportedAt: new Date().toISOString(),
      restaurant: settings.restaurantNameAr || "Jungle Rooftop & Lounge",
      settings,
      categories,
      dishes,
    }),
  );
});

router.post("/restore", async (req, res): Promise<void> => {
  const parsed = RestoreBackupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const backup = parsed.data;
  if (
    backup.settings === undefined &&
    backup.categories === undefined &&
    backup.dishes === undefined
  ) {
    res.status(400).json({ error: "Invalid backup data" });
    return;
  }

  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    if (backup.settings) {
      const settings = {
        ...backup.settings,
        isInitialized: "true",
      };
      await tx
        .insert(menuSettingsTable)
        .values(Object.entries(settings).map(([key, value]) => ({ key, value })))
        .onConflictDoUpdate({
          target: menuSettingsTable.key,
          set: { value: sql`excluded.value` },
        });
    }
    if (backup.categories !== undefined) {
      await tx.delete(menuCategoriesTable);
      if (backup.categories.length > 0) {
        await tx.insert(menuCategoriesTable).values(
          backup.categories.map((category, index) => ({
            id: category.id || `cat-${Date.now()}-${index}`,
            nameEn: category.nameEn ?? "",
            nameAr: category.nameAr ?? "",
            icon: category.icon || "utensils",
            displayOrder: category.displayOrder ?? 0,
          })),
        );
      }
    }
    if (backup.dishes !== undefined) {
      await tx.delete(menuDishesTable);
      if (backup.dishes.length > 0) {
        await tx.insert(menuDishesTable).values(
          backup.dishes.map((dish, index) => {
            const id = dish.id || `dish-${Date.now()}-${index}`;
            return {
              ...makeDishValues(dish, id, now),
              createdAt: dish.createdAt || now,
              updatedAt: dish.updatedAt || now,
            };
          }),
        );
      }
    }
    await bumpMenuVersion(tx);
  });

  res.json(
    RestoreBackupResponse.parse({
      success: true,
      message: "Data restored",
    }),
  );
});

export default router;

"use strict";

const { ObjectId } = require("mongodb");
const { db, json, method } = require("../_lib/auth");

const PRODUCTS = process.env.LIBRARY_PRODUCTS_COLLECTION || process.env.LIBRARY_COLLECTION || "library_products";
const SETTINGS = process.env.PLATFORM_SETTINGS_COLLECTION || "platform_settings";
const LIMIT = 300;
const HIDDEN_STATUSES = new Set([
  "inactive", "disabled", "deleted", "محذوف", "غير نشط", "غير فعال"
]);

function value(input, max = 4000) {
  return String(input ?? "").trim().slice(0, max);
}

function publicImage(input, productId, index) {
  const image = value(input, 400000);
  if (!image) return "";
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(image)) {
    return "/api/public/library-image?productId=" + encodeURIComponent(productId) +
      "&imageIndex=" + encodeURIComponent(String(index));
  }
  if (image.startsWith("/") && !image.startsWith("//")) return image;
  try {
    const parsed = new URL(image);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function publicProduct(row, index = 0, includeAllImages = false) {
  const rawPrice = Number(row.price ?? 0);
  const price = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0;
  const images = Array.isArray(row.images) ? row.images : [];
  const rawType = String(row.type || row.typeLabel || "");
  const type = rawType === "physical" || rawType === "مطبوع" ? "physical" : "رقمي";
  const id = String(row._id);
  const selectedImages = includeAllImages ? images.slice(0, 8) : images.slice(0, 1);
  const imageUrls = selectedImages.map((image, imageIndex) => publicImage(image, id, imageIndex)).filter(Boolean);
  return {
    id,
    title: value(row.title || row.name || "منتج مكتبة", 240),
    description: value(row.description, 4000),
    type,
    price,
    isFree: row.isFree === true || price === 0,
    image: imageUrls[0] || "",
    images: imageUrls,
    order: Number.isFinite(Number(row.sortOrder ?? row.order)) ?
      Number(row.sortOrder ?? row.order) : index
  };
}

function visibleFilter(id) {
  const filter = {
    $and: [
      { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
      { isActive: { $ne: false } },
      { status: { $nin: [...HIDDEN_STATUSES] } }
    ]
  };
  if (id) {
    const selectors = [{ _id: id }];
    if (ObjectId.isValid(id)) selectors.push({ _id: new ObjectId(id) });
    filter.$and.push({ $or: selectors });
  }
  return filter;
}

async function currency(database) {
  let result = "EGP";
  try {
    const settings = await database.collection(SETTINGS).findOne(
      { _id: "organization" },
      { projection: { "settings.currency.defaultCurrency": 1 } }
    );
    const configured = value(settings?.settings?.currency?.defaultCurrency, 3).toUpperCase();
    if (["EGP", "SAR", "USD"].includes(configured)) result = configured;
  } catch (_) {}
  return result;
}

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const database = await db();
    const productId = value(req.query?.productId, 100);
    if (productId) {
      const row = await database.collection(PRODUCTS).findOne(visibleFilter(productId), {
        projection: {
          title: 1, name: 1, description: 1, type: 1, typeLabel: 1,
          price: 1, isFree: 1, isActive: 1, status: 1, deletedAt: 1,
          images: 1, sortOrder: 1, order: 1, createdAt: 1
        }
      });
      if (!row) return json(res, 404, { ok: false, message: "لم يتم العثور على الكتاب أو أنه غير متاح حالياً." });
      const product = publicProduct(row, 0, true);
      return json(res, 200, {
        ok: true, product, currency: await currency(database),
        generatedAt: new Date().toISOString()
      });
    }

    const rows = await database.collection(PRODUCTS).find(visibleFilter(), {
      projection: {
        title: 1, name: 1, description: 1, type: 1, typeLabel: 1,
        price: 1, isFree: 1, isActive: 1, status: 1,
        images: { $slice: 1 }, sortOrder: 1, order: 1, createdAt: 1
      }
    }).sort({ sortOrder: 1, createdAt: -1, _id: 1 }).limit(LIMIT).toArray();

    const products = rows.map((row, index) => publicProduct(row, index))
      .filter(product => product.title);
    return json(res, 200, {
      ok: true,
      products,
      currency: await currency(database),
      generatedAt: new Date().toISOString(),
      truncated: rows.length === LIMIT
    });
  } catch (error) {
    console.error("public library failed:", error.message);
    return json(res, 503, {
      ok: false,
      message: "تعذر تحميل منتجات المكتبة حالياً. يرجى المحاولة مرة أخرى."
    });
  }
};

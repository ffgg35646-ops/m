"use strict";

const { db, json, method } = require("../_lib/auth");

const PRODUCTS = process.env.LIBRARY_PRODUCTS_COLLECTION || "library_products";
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

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const database = await db();
    const rows = await database.collection(PRODUCTS).find({
      $and: [
        { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
        { isActive: { $ne: false } },
        { status: { $nin: [...HIDDEN_STATUSES] } }
      ]
    }, {
      projection: {
        title: 1, name: 1, description: 1, type: 1, typeLabel: 1,
        price: 1, isFree: 1, isActive: 1, status: 1,
        images: { $slice: 1 }, sortOrder: 1, order: 1, createdAt: 1
      }
    }).sort({ sortOrder: 1, createdAt: -1, _id: 1 }).limit(LIMIT).toArray();

    const products = rows.map((row, index) => {
      const rawPrice = Number(row.price ?? 0);
      const price = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0;
      const images = Array.isArray(row.images) ? row.images : [];
      const rawType = String(row.type || row.typeLabel || "");
      const type = rawType === "physical" || rawType === "مطبوع" ? "physical" : "رقمي";
      const id = String(row._id);
      return {
        id,
        title: value(row.title || row.name || "منتج مكتبة", 240),
        description: value(row.description, 4000),
        type,
        price,
        isFree: row.isFree === true || price === 0,
        image: images.length ? publicImage(images[0], id, 0) : "",
        order: Number.isFinite(Number(row.sortOrder ?? row.order)) ?
          Number(row.sortOrder ?? row.order) : index
      };
    }).filter(product => product.title);

    let currency = "EGP";
    try {
      const settings = await database.collection(SETTINGS).findOne(
        { _id: "organization" },
        { projection: { "settings.currency.defaultCurrency": 1 } }
      );
      const configured = value(settings?.settings?.currency?.defaultCurrency, 3).toUpperCase();
      if (["EGP", "SAR", "USD"].includes(configured)) currency = configured;
    } catch (_) {}

    return json(res, 200, {
      ok: true,
      products,
      currency,
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
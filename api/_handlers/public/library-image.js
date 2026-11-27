"use strict";

const { ObjectId } = require("mongodb");
const { db, json, method } = require("../_lib/auth");

const PRODUCTS = process.env.LIBRARY_PRODUCTS_COLLECTION || process.env.LIBRARY_COLLECTION || "library_products";
const HIDDEN_STATUSES = new Set([
  "inactive", "disabled", "deleted", "محذوف", "غير نشط", "غير فعال"
]);

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  const id = String(req.query?.productId || "").trim().slice(0, 100);
  const imageIndex = Number(req.query?.imageIndex ?? 0);
  if (!id) return json(res, 400, { ok: false, message: "معرف المنتج مطلوب." });
  if (!Number.isInteger(imageIndex) || imageIndex < 0 || imageIndex > 7) {
    return json(res, 400, { ok: false, message: "رقم الصورة غير صحيح." });
  }

  try {
    const selectors = [{ _id: id }];
    if (ObjectId.isValid(id)) selectors.push({ _id: new ObjectId(id) });
    const database = await db();
    const product = await database.collection(PRODUCTS).findOne({
      $and: [
        { $or: selectors },
        { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
        { isActive: { $ne: false } },
        { status: { $nin: [...HIDDEN_STATUSES] } }
      ]
    }, {
      projection: { images: { $slice: [imageIndex, 1] }, isActive: 1, status: 1, deletedAt: 1 }
    });

    if (!product) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }
    const source = String(Array.isArray(product.images) ? product.images[0] || "" : "");
    const match = source.match(/^data:image\/(jpeg|png|webp);base64,([a-z0-9+/]+=*)$/i);
    if (!match) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }

    const image = Buffer.from(match[2], "base64");
    if (!image.length || image.length > 300000) {
      res.statusCode = 413;
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/" + match[1].toLowerCase());
    res.setHeader("Content-Length", String(image.length));
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(image);
  } catch (error) {
    console.error("public library image failed:", error.message);
    res.statusCode = 500;
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }
};
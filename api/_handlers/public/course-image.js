"use strict";

const { ObjectId } = require("mongodb");
const { db, json, method } = require("../_lib/auth");

const COURSES = process.env.COURSES_COLLECTION || "courses";
const HIDDEN_STATUSES = new Set([
  "inactive", "disabled", "deleted", "غير نشط", "غير فعال", "محذوف"
]);

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  const id = String(req.query?.courseId || "").trim().slice(0, 100);
  if (!id) return json(res, 400, { ok: false, message: "معرف الدورة مطلوب." });

  try {
    const selectors = [{ _id: id }];
    if (ObjectId.isValid(id)) selectors.push({ _id: new ObjectId(id) });
    const database = await db();
    const course = await database.collection(COURSES).findOne({
      $and: [
        { $or: selectors },
        { deletedAt: { $exists: false } },
        { isActive: { $ne: false } },
        { isVisible: { $ne: false } },
        { visible: { $ne: false } }
      ]
    }, {
      projection: { image: 1, imageUrl: 1, thumbnail: 1, coverImage: 1, status: 1 }
    });

    const status = String(course?.status || "").trim().toLowerCase();
    if (!course || HIDDEN_STATUSES.has(status)) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }

    const source = String(course.image || course.imageUrl || course.thumbnail || course.coverImage || "");
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

    const mime = "image/" + match[1].toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(image.length));
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(image);
  } catch (error) {
    console.error("public course image failed:", error.message);
    res.statusCode = 500;
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }
};

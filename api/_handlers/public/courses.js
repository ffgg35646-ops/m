"use strict";

const { db, json, method } = require("../_lib/auth");

const COURSES = process.env.COURSES_COLLECTION || "courses";
const SETTINGS = process.env.PLATFORM_SETTINGS_COLLECTION || "platform_settings";
const LIMIT = 250;
const HIDDEN_STATUSES = new Set([
  "inactive", "disabled", "deleted", "غير نشط", "غير فعال", "محذوف"
]);

function value(input, max = 4000) {
  return String(input ?? "").trim().slice(0, max);
}

function publicImage(input) {
  const image = value(input, 400000);
  if (!image) return "";
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(image)) return image;
  if (image.startsWith("/") && !image.startsWith("//")) return image;
  try {
    const parsed = new URL(image);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ar")
  );
}

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const database = await db();
    const rows = await database.collection(COURSES).find({
      deletedAt: { $exists: false },
      isActive: { $ne: false },
      isVisible: { $ne: false },
      visible: { $ne: false }
    }, {
      projection: {
        title: 1, name: 1, description: 1,
        subject: 1, subjectName: 1,
        category: 1, gradeCategory: 1,
        grade: 1, year: 1, schoolYear: 1,
        track: 1, branch: 1,
        price: 1, amount: 1, isFree: 1,
        image: 1, imageUrl: 1, thumbnail: 1, coverImage: 1,
        status: 1, isActive: 1, isVisible: 1, visible: 1,
        pinned: 1, isPinned: 1, sortOrder: 1, createdAt: 1
      }
    }).sort({ sortOrder: 1, pinned: -1, createdAt: -1 }).limit(LIMIT).toArray();

    const courses = rows
      .filter(row => !HIDDEN_STATUSES.has(value(row.status, 40).toLowerCase()))
      .map(row => {
        const rawPrice = Number(row.price ?? row.amount ?? 0);
        const price = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0;
        return {
          id: String(row._id),
          title: value(row.title || row.name || "دورة تعليمية", 200),
          description: value(row.description, 4000),
          subject: value(row.subject || row.subjectName, 140),
          category: value(row.category || row.gradeCategory, 140),
          grade: value(row.grade || row.year || row.schoolYear, 140),
          track: value(row.track || row.branch, 100),
          price,
          isFree: row.isFree === true || price === 0,
          image: publicImage(row.image || row.imageUrl || row.thumbnail || row.coverImage),
          pinned: row.pinned === true || row.isPinned === true,
          sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0
        };
      })
      .filter(course => course.title);

    courses.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder);

    let currency = "EGP";
    try {
      const savedSettings = await database.collection(SETTINGS).findOne(
        { _id: "organization" },
        { projection: { "settings.currency.defaultCurrency": 1 } }
      );
      const configured = value(savedSettings?.settings?.currency?.defaultCurrency, 3).toUpperCase();
      if (["EGP", "SAR", "USD"].includes(configured)) currency = configured;
    } catch (_) {}

    return json(res, 200, {
      ok: true,
      courses,
      currency,
      filters: {
        categories: unique(courses.map(course => course.category)),
        grades: unique(courses.map(course => course.grade)),
        subjects: unique(courses.map(course => course.subject)),
        tracks: unique(courses.map(course => course.track))
      },
      generatedAt: new Date().toISOString(),
      truncated: rows.length === LIMIT
    });
  } catch (error) {
    console.error("public courses failed:", error.message);
    return json(res, 503, {
      ok: false,
      message: "تعذر تحميل الكورسات حالياً. يرجى المحاولة مرة أخرى."
    });
  }
};

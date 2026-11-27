const { db, json, method } = require("../_lib/auth");

const COLLECTION = process.env.ACADEMIC_STRUCTURE_COLLECTION || "academic_structure";

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const database = await db();
    const saved = await database.collection(COLLECTION).findOne(
      { _id: "main" },
      { projection: { categories: 1, years: 1, updatedAt: 1 } }
    );
    return json(res, 200, {
      ok: true,
      categories: Array.isArray(saved?.categories) ? saved.categories.map(item => ({
        id: String(item.id || ""),
        name: String(item.name || "")
      })).filter(item => item.id && item.name) : [],
      years: Array.isArray(saved?.years) ? saved.years.map(item => ({
        id: String(item.id || ""),
        name: String(item.name || ""),
        category: String(item.category || ""),
        color: /^#[0-9a-fA-F]{6}$/.test(String(item.color || "")) ? item.color : "#3b82f6",
        imageText: String(item.imageText || ""),
        imageData: typeof item.imageData === "string" ? item.imageData : ""
      })).filter(item => item.id && item.name && item.category) : [],
      updatedAt: saved?.updatedAt || null
    });
  } catch (error) {
    console.error("public academic structure failed:", error.message);
    return json(res, 503, { ok: false, message: "تعذر تحميل الصفوف الدراسية حالياً." });
  }
};

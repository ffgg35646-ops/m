const { db, json, method } = require("../_lib/auth");

const COLLECTION = process.env.COURSES_COLLECTION || "courses";

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const category = String(req.query?.category || "").trim().slice(0, 140);
    const grade = String(req.query?.grade || "").trim().slice(0, 140);
    if (!category || !grade) return json(res, 400, { ok: false, message: "حدد الفئة والصف الدراسي." });

    const database = await db();
    const rows = await database.collection(COLLECTION).find({
      deletedAt: { $exists: false },
      isVisible: { $ne: false },
      visible: { $ne: false },
      isActive: { $ne: false },
      status: { $nin: ["inactive", "disabled", "غير نشط", "غير فعال", "deleted", "محذوف"] },
      $or: [{ category }, { gradeCategory: category }],
      $and: [{ $or: [{ grade }, { year: grade }, { schoolYear: grade }] }]
    }, {
      projection: {
        title: 1, name: 1, description: 1, subject: 1, subjectName: 1,
        category: 1, gradeCategory: 1, grade: 1, year: 1, schoolYear: 1,
        price: 1, amount: 1, isFree: 1, image: 1, imageUrl: 1, thumbnail: 1, coverImage: 1
      }
    }).sort({ pinned: -1, sortOrder: 1, createdAt: -1 }).limit(200).toArray();

    const courses = rows.map(row => {
      const price = Number(row.price ?? row.amount ?? 0);
      return {
        id: String(row._id),
        title: String(row.title || row.name || "دورة تعليمية"),
        description: String(row.description || ""),
        subject: String(row.subject || row.subjectName || ""),
        category: String(row.category || row.gradeCategory || category),
        grade: String(row.grade || row.year || row.schoolYear || grade),
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        isFree: row.isFree === true || price === 0,
        image: String(row.image || row.imageUrl || row.thumbnail || row.coverImage || "")
      };
    });
    return json(res, 200, { ok: true, courses, category, grade });
  } catch (error) {
    console.error("public academic courses failed:", error.message);
    return json(res, 503, { ok: false, message: "تعذر تحميل الدورات الدراسية حالياً." });
  }
};

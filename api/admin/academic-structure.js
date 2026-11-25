const crypto = require("crypto");
const { json } = require("../_lib/auth");
const { requireAdmin } = require("../_lib/admin");

const COLLECTION = process.env.ACADEMIC_STRUCTURE_COLLECTION || "academic_structure";
const IMAGE_LIMIT = 900000;

const DEFAULT_STRUCTURE = {
  categories: [
    { id: "cat-1", name: "النيل", createdAt: "2026-04-18T00:00:00.000Z" },
    { id: "cat-2", name: "IGCSE", createdAt: "2026-04-18T00:00:00.000Z" },
    { id: "cat-3", name: "البكالوريا المصرية", createdAt: "2026-04-19T00:00:00.000Z" },
    { id: "cat-4", name: "American Diploma", createdAt: "2026-04-18T00:00:00.000Z" },
    { id: "cat-5", name: "أبناؤنا في الخارج ( المسار المصري )", createdAt: "2026-05-07T00:00:00.000Z" },
    { id: "cat-6", name: "الكورسات المجانية", createdAt: "2026-04-22T00:00:00.000Z" },
    { id: "cat-7", name: "تعليم اللغة لغير الناطقين بها", createdAt: "2026-05-08T00:00:00.000Z" }
  ],
  years: [
    { id: "year-1", name: "KG1 , KG2", category: "النيل", color: "#3b82f6", imageText: "KG1", createdAt: "2026-08-31T00:00:00.000Z" },
    { id: "year-2", name: "Grade 1", category: "النيل", color: "#3b82f6", imageText: "Gr 1", createdAt: "2026-07-26T00:00:00.000Z" },
    { id: "year-3", name: "Grade 2", category: "النيل", color: "#3b82f6", imageText: "Gr 2", createdAt: "2026-08-15T00:00:00.000Z" },
    { id: "year-4", name: "Grade 3", category: "النيل", color: "#3b82f6", imageText: "Gr 3", createdAt: "2026-04-18T00:00:00.000Z" },
    { id: "year-5", name: "Grade 4", category: "النيل", color: "#3b82f6", imageText: "Gr 4", createdAt: "2026-04-18T00:00:00.000Z" },
    { id: "year-6", name: "Grade 5", category: "النيل", color: "#3b82f6", imageText: "Gr 5", createdAt: "2026-04-18T00:00:00.000Z" }
  ],
  subjects: [
    { id: "subject-1", name: "النيل", description: "مهارة القراءة و الكتابة والاستماع والتحدث والنحو", createdAt: "2026-04-18T00:00:00.000Z" },
    { id: "subject-2", name: "البكالوريا - اللغة العربية", description: "قراءة، نصوص، بلاغة، نحو، أدب، تعبير", createdAt: "2026-05-08T00:00:00.000Z" },
    { id: "subject-3", name: "Arabic - American diploma", description: "قراءة، نصوص، بلاغة، نحو، أدب، تعبير", createdAt: "2026-07-14T00:00:00.000Z" },
    { id: "subject-4", name: "IGCSE, Arabic", description: "Edexcel 4AA1 - 0508 - 7180", createdAt: "2026-04-18T00:00:00.000Z" },
    { id: "subject-5", name: "الدين الإسلامي", description: "American diploma - IGCSE - البكالوريا المصرية", createdAt: "2026-07-14T00:00:00.000Z" }
  ]
};

function textValue(value, label, max = 160, required = true) {
  const valueText = String(value ?? "").trim().slice(0, max);
  if (required && !valueText) throw new Error("أدخل " + label + ".");
  return valueText;
}

function cleanImage(value) {
  const image = String(value || "");
  if (!image) return "";
  if (image.length > IMAGE_LIMIT) throw new Error("حجم صورة السنة بعد الضغط كبير. اختر صورة أصغر.");
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    throw new Error("صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP.");
  }
  return image;
}

function cleanId(value, used) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("معرف أحد العناصر غير صحيح.");
  if (used.has(id)) throw new Error("يوجد عنصر مكرر في البيانات.");
  used.add(id);
  return id;
}

function cleanCreatedAt(value, previous) {
  const candidate = value || previous || new Date().toISOString();
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeStructure(input, previous) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("بيانات الهيكل الأكاديمي غير صحيحة.");
  }

  const old = previous || DEFAULT_STRUCTURE;
  const oldByType = {
    categories: new Map((old.categories || []).map(item => [String(item.id), item])),
    years: new Map((old.years || []).map(item => [String(item.id), item])),
    subjects: new Map((old.subjects || []).map(item => [String(item.id), item]))
  };

  const categoriesInput = Array.isArray(input.categories) ? input.categories : [];
  const yearsInput = Array.isArray(input.years) ? input.years : [];
  const subjectsInput = Array.isArray(input.subjects) ? input.subjects : [];
  if (categoriesInput.length > 100) throw new Error("الحد الأقصى لفئات السنوات هو 100 فئة.");
  if (yearsInput.length > 500) throw new Error("الحد الأقصى للسنوات الدراسية هو 500 سنة.");
  if (subjectsInput.length > 300) throw new Error("الحد الأقصى للمواد هو 300 مادة.");

  const categoryIds = new Set();
  const categoryNames = new Set();
  const categories = categoriesInput.map(item => {
    const id = cleanId(item?.id, categoryIds);
    const name = textValue(item?.name, "اسم الفئة", 140);
    const normalizedName = name.toLocaleLowerCase("ar");
    if (categoryNames.has(normalizedName)) throw new Error("اسم الفئة مستخدم بالفعل.");
    categoryNames.add(normalizedName);
    return {
      id,
      name,
      createdAt: cleanCreatedAt(item.createdAt, oldByType.categories.get(id)?.createdAt)
    };
  });

  const categoryNamesSet = new Set(categories.map(item => item.name));
  const yearIds = new Set();
  const years = yearsInput.map(item => {
    const id = cleanId(item?.id, yearIds);
    const name = textValue(item?.name, "اسم السنة الدراسية", 140);
    const category = textValue(item?.category, "فئة السنة الدراسية", 140);
    if (!categoryNamesSet.has(category)) {
      throw new Error("فئة السنة «" + category + "» غير موجودة. اختر فئة صحيحة أو انقل السنة إلى فئة أخرى.");
    }
    const color = String(item?.color || "#3b82f6").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("لون السنة الدراسية غير صحيح.");
    const oldItem = oldByType.years.get(id);
    return {
      id,
      name,
      category,
      color: color.toLowerCase(),
      imageText: textValue(item?.imageText || name.slice(0, 4), "اختصار الصورة", 12, false),
      imageData: cleanImage(item?.imageData),
      createdAt: cleanCreatedAt(item.createdAt, oldItem?.createdAt)
    };
  });

  const subjectIds = new Set();
  const subjects = subjectsInput.map(item => {
    const id = cleanId(item?.id, subjectIds);
    const name = textValue(item?.name, "اسم المادة", 140);
    const description = textValue(item?.description, "وصف المادة", 1500, false);
    return {
      id,
      name,
      description,
      createdAt: cleanCreatedAt(item.createdAt, oldByType.subjects.get(id)?.createdAt)
    };
  });

  const usedCategories = new Set(years.map(item => item.category));
  const removedInUse = (old.categories || []).filter(item =>
    !categoryNamesSet.has(item.name) && usedCategories.has(item.name)
  );
  if (removedInUse.length) {
    throw new Error("لا يمكن حذف فئة مرتبطة بسنوات دراسية. انقل سنواتها أو احذفها أولاً.");
  }

  return { categories, years, subjects };
}

async function readOrSeed(collection) {
  let saved = await collection.findOne({ _id: "main" });
  if (!saved) {
    await collection.updateOne(
      { _id: "main" },
      { $setOnInsert: { ...DEFAULT_STRUCTURE, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    );
    saved = await collection.findOne({ _id: "main" });
  }
  return {
    categories: Array.isArray(saved?.categories) ? saved.categories : [],
    years: Array.isArray(saved?.years) ? saved.years : [],
    subjects: Array.isArray(saved?.subjects) ? saved.subjects : [],
    updatedAt: saved?.updatedAt || null
  };
}

module.exports = async function handler(req, res) {
  if (!["GET", "PUT"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });

    const collection = auth.database.collection(COLLECTION);
    const current = await readOrSeed(collection);

    if (req.method === "GET") {
      return json(res, 200, {
        ok: true,
        structure: {
          categories: current.categories,
          years: current.years,
          subjects: current.subjects
        },
        updatedAt: current.updatedAt
      });
    }

    let structure;
    try {
      structure = normalizeStructure(req.body?.structure, current);
    } catch (error) {
      return json(res, 400, { ok: false, message: error.message });
    }

    const updatedAt = new Date();
    await collection.updateOne(
      { _id: "main" },
      {
        $set: {
          ...structure,
          updatedAt,
          updatedBy: auth.admin._id
        },
        $setOnInsert: { createdAt: updatedAt }
      },
      { upsert: true }
    );

    return json(res, 200, {
      ok: true,
      message: "تم حفظ الهيكل الأكاديمي في قاعدة البيانات بنجاح.",
      structure,
      updatedAt
    });
  } catch (error) {
    console.error("admin academic structure failed:", error.message);
    return json(res, 500, {
      ok: false,
      message: "تعذر تحميل أو حفظ الهيكل الأكاديمي. تحقق من اتصال قاعدة البيانات."
    });
  }
};

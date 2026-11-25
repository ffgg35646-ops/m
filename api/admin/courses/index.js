const { ObjectId } = require("mongodb");
const { json, db: getDatabase, collectionName } = require("../../_lib/auth");
const { requireAdmin, parseMongoId, roleAllows, normalizeRole } = require("../../_lib/admin");

const COURSES = process.env.COURSES_COLLECTION || "courses";
const ENROLLMENTS = process.env.ENROLLMENTS_COLLECTION || "enrollments";
const USERS = process.env.USERS_COLLECTION || "users";
const ACADEMIC = process.env.ACADEMIC_STRUCTURE_COLLECTION || "academic_structure";
const ROLES = process.env.PLATFORM_ROLES_COLLECTION || "platform_roles";
const SECTION = "إدارة المحتوى";
const MODULE = "الكورسات ومحتواها";
const LIMIT = 500;
const IMAGE_LIMIT = 380000;

function str(value, max = 200) { return String(value ?? "").trim().slice(0, max); }
function error(message, status = 400) { const e = new Error(message); e.statusCode = status; throw e; }
function objectId(id) { return ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : String(id); }
function courseQuery(id) { const value = objectId(id); return { $or: [{ _id: value }, { _id: String(id) }] }; }
async function exists(db, name) { return db.listCollections({ name }, { nameOnly: true }).hasNext(); }
function safeUrl(value, label = "الرابط") {
  const raw = str(value, 1600);
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return parsed.toString();
  } catch { error("أدخل رابطاً صحيحاً في حقل " + label + "."); }
}
function safeImage(value) {
  const raw = str(value, IMAGE_LIMIT + 10);
  if (!raw) return "";
  if (raw.startsWith("data:")) {
    if (raw.length > IMAGE_LIMIT || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      error("صورة الدورة كبيرة أو غير صالحة. استخدم JPG أو PNG أو WEBP مضغوطة.");
    }
    return raw;
  }
  return safeUrl(raw, "صورة الدورة");
}
async function academicData(db) {
  const doc = await db.collection(ACADEMIC).findOne({ _id: "main" }, { projection: { categories: 1, years: 1, subjects: 1 } });
  return {
    categories: Array.isArray(doc?.categories) ? doc.categories.map(x => ({ id: x.id, name: x.name })) : [],
    years: Array.isArray(doc?.years) ? doc.years.map(x => ({ id: x.id, name: x.name, category: x.category })) : [],
    subjects: Array.isArray(doc?.subjects) ? doc.subjects.map(x => ({ id: x.id, name: x.name })) : []
  };
}
async function validateAcademic(db, data) {
  const academic = await academicData(db);
  const category = str(data.category, 140), grade = str(data.grade, 140), subject = str(data.subject, 140);
  if (!category || !grade) error("اختر فئة السنة الدراسية والسنة الدراسية.");
  if (academic.categories.length && !academic.categories.some(x => x.name === category)) error("فئة السنة غير موجودة في الهيكل الأكاديمي.");
  if (academic.years.length && !academic.years.some(x => x.name === grade && x.category === category)) error("السنة الدراسية لا تتبع الفئة المختارة.");
  if (subject && academic.subjects.length && !academic.subjects.some(x => x.name === subject)) error("المادة المحددة غير موجودة في الهيكل الأكاديمي.");
}
function activeStatus(course) {
  return !["inactive", "disabled", "غير نشط", "غير فعال", "deleted", "محذوف"].includes(String(course.status || "").toLowerCase()) &&
    course.isActive !== false;
}
function publicItem(item, index) {
  return {
    id: str(item.id, 100) || "item-" + index, name: str(item.name || item.title, 200),
    type: item.type === "file" || item.type === "ملف" ? "file" : "video",
    url: str(item.url || item.fileUrl || item.videoUrl, 1600),
    description: str(item.description || item.content, 2000),
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index
  };
}
function publicSection(section, index) {
  const items = Array.isArray(section.items) ? section.items : [];
  return {
    id: str(section.id, 100) || "section-" + index,
    title: str(section.title || section.name, 200),
    sortOrder: Number.isFinite(Number(section.sortOrder)) ? Number(section.sortOrder) : index,
    items: items.map(publicItem).sort((a, b) => a.sortOrder - b.sortOrder)
  };
}
function publicCourse(doc, enrollmentCount = null) {
  const price = Number(doc.price ?? doc.amount ?? 0);
  const sections = Array.isArray(doc.sections) ? doc.sections : Array.isArray(doc.courseSections) ? doc.courseSections : [];
  const status = activeStatus(doc) ? "active" : "inactive";
  const image = doc.image || doc.imageUrl || doc.thumbnail || doc.coverImage || "";
  return {
    id: String(doc._id), title: str(doc.title || doc.name, 200), description: str(doc.description, 4000),
    subject: str(doc.subject || doc.subjectName, 140), category: str(doc.category || doc.gradeCategory, 140),
    grade: str(doc.grade || doc.year || doc.schoolYear, 140), track: str(doc.track || doc.branch || "-", 100) || "-",
    price: Number.isFinite(price) && price >= 0 ? price : 0, isFree: doc.isFree === true || price === 0,
    status, pinned: doc.pinned === true || doc.isPinned === true,
    isVisible: doc.isVisible !== false && doc.visible !== false, image: str(image, IMAGE_LIMIT + 10),
    expiryMode: ["date", "days"].includes(doc.accessExpiryMode) ? doc.accessExpiryMode : "none",
    accessEndsAt: doc.accessEndsAt || doc.expiresAt || null,
    accessDays: Number.isFinite(Number(doc.accessDays)) ? Number(doc.accessDays) : null,
    sortOrder: Number.isFinite(Number(doc.sortOrder)) ? Number(doc.sortOrder) : 0,
    sections: sections.map(publicSection).sort((a, b) => a.sortOrder - b.sortOrder),
    enrollmentCount, createdAt: doc.createdAt || null, updatedAt: doc.updatedAt || null
  };
}
function enrollmentQuery(course) {
  const id = String(course._id), values = [id];
  if (ObjectId.isValid(id)) values.push(new ObjectId(id));
  return { $or: [{ courseId: { $in: values } }, { course_id: { $in: values } }, { "course.id": { $in: values } }, { course: { $in: values } }] };
}
async function capabilities(db, auth) {
  if (auth.builtInAdmin) return { view: true, create: true, edit: true, delete: true, manageContent: true, academic: true, users: true };
  const roles = await db.collection(ROLES).find({ isActive: { $ne: false } }).toArray();
  const role = roles.find(x => normalizeRole(x.roleName) === normalizeRole(auth.roleName));
  const allows = (section, module, action) => roleAllows(role, { section, module, action });
  const create = allows(SECTION, MODULE, "إنشاء"), edit = allows(SECTION, MODULE, "تعديل");
  return {
    view: allows(SECTION, MODULE, "عرض"), create, edit, delete: allows(SECTION, MODULE, "حذف"),
    manageContent: create || edit,
    academic: ["فئات السنوات الدراسية", "السنوات الدراسية", "المواد"].some(module => allows("الهيكل الأكاديمي", module, "عرض")),
    users: ["المشرفون", "الطلاب", "الأدوار والصلاحيات"].some(module => allows("صلاحيات المستخدمين", module, "عرض"))
  };
}
async function audit(db, auth, action, courseId, details = {}) {
  try {
    await db.collection("admin_audit_logs").insertOne({ action, adminId: auth.admin._id, targetCourseId: courseId || null, details, createdAt: new Date() });
  } catch (e) { console.error("course audit log failed:", e.message); }
}
async function loadEnrollments(db, course) {
  if (!await exists(db, ENROLLMENTS)) return { available: false, enrollments: [] };
  const rows = await db.collection(ENROLLMENTS).find(enrollmentQuery(course)).sort({ createdAt: -1 }).limit(1000).toArray();
  const ids = [];
  for (const row of rows) {
    const id = row.userId || row.studentId || row.user?._id || row.student?._id;
    if (id !== undefined && id !== null) { ids.push(id, String(id)); if (ObjectId.isValid(String(id))) ids.push(new ObjectId(String(id))); }
  }
  let byId = new Map();
  if (ids.length && await exists(db, USERS)) {
    const unique = [...new Map(ids.map(x => [String(x) + typeof x, x])).values()];
    const users = await db.collection(USERS).find({ _id: { $in: unique } }, {
      projection: { firstName: 1, lastName: 1, fullName: 1, name: 1, email: 1, phone: 1, mobile: 1, code: 1, studentCode: 1, parentPhone: 1, guardianPhone: 1 }
    }).toArray();
    byId = new Map(users.map(x => [String(x._id), x]));
  }
  return {
    available: true,
    enrollments: rows.map(row => {
      const rawId = row.userId || row.studentId || row.user?._id || row.student?._id;
      const student = (rawId && byId.get(String(rawId))) || row.student || row.user || {};
      const first = str(student.firstName, 80), last = str(student.lastName, 100);
      return {
        id: String(row._id), studentId: rawId ? String(rawId) : "",
        name: str(student.fullName || student.name || [first, last].filter(Boolean).join(" ") || row.studentName || row.userName, 200) || "طالب بدون اسم",
        code: str(student.code || student.studentCode || row.studentCode, 40),
        phone: str(student.phone || student.mobile || row.phone, 40),
        parentPhone: str(student.parentPhone || student.guardianPhone || row.parentPhone, 40),
        email: str(student.email || row.email, 254), status: str(row.status || (row.isActive ? "نشط" : "غير محدد"), 50),
        createdAt: row.createdAt || row.enrolledAt || null, expiresAt: row.expiresAt || row.accessEndsAt || null
      };
    })
  };
}
async function findCourse(db, id) {
  if (!id) error("معرف الدورة مطلوب.");
  return db.collection(COURSES).findOne(courseQuery(str(id, 100)));
}
function cleanCourse(data, previous = {}) {
  const title = str(data.title, 200), price = Number(data.price);
  if (title.length < 2) error("أدخل عنوان الدورة.");
  if (!Number.isFinite(price) || price < 0 || price > 100000000) error("أدخل سعراً صحيحاً.");
  const mode = ["date", "days"].includes(data.expiryMode) ? data.expiryMode : "none";
  let ends = null, days = null;
  if (mode === "date") { ends = new Date(data.accessEndsAt); if (!data.accessEndsAt || Number.isNaN(ends.getTime())) error("حدد تاريخ انتهاء الوصول."); }
  if (mode === "days") { days = Number(data.accessDays); if (!Number.isInteger(days) || days < 1 || days > 3650) error("عدد أيام الوصول يجب أن يكون بين 1 و3650."); }
  const status = data.status === undefined && data.isActive === undefined ? (activeStatus(previous) ? "active" : "inactive") :
    ((data.status === "inactive" || data.isActive === false) ? "inactive" : "active");
  const image = data.image === undefined ? (previous.image || previous.imageUrl || "") : safeImage(data.image);
  return {
    title, name: title, description: str(data.description, 4000),
    subject: str(data.subject, 140), subjectName: str(data.subject, 140),
    category: str(data.category, 140), gradeCategory: str(data.category, 140),
    grade: str(data.grade, 140), year: str(data.grade, 140), schoolYear: str(data.grade, 140),
    track: str(data.track || "-", 100) || "-", price, isFree: price === 0,
    status, isActive: status === "active",
    pinned: data.pinned === undefined ? (previous.pinned === true || previous.isPinned === true) : data.pinned === true,
    isPinned: data.pinned === undefined ? (previous.pinned === true || previous.isPinned === true) : data.pinned === true,
    isVisible: data.isVisible === undefined ? previous.isVisible !== false && previous.visible !== false : data.isVisible !== false,
    image, imageUrl: image, accessExpiryMode: mode, accessEndsAt: ends, expiresAt: ends, accessDays: days,
    updatedAt: new Date()
  };
}
async function saveContent(db, auth, action, data, course) {
  const sections = (Array.isArray(course.sections) ? course.sections : Array.isArray(course.courseSections) ? course.courseSections : []).map(publicSection);
  const sectionId = str(data.sectionId, 100), sectionIndex = sections.findIndex(x => x.id === sectionId);
  if (action === "createSection") {
    const title = str(data.title, 200); if (!title) error("أدخل اسم القسم.");
    sections.push({ id: "sec-" + new ObjectId().toString(), title, sortOrder: sections.length, items: [] });
  } else if (action === "reorderSections") {
    if (!Array.isArray(data.sectionIds)) error("ترتيب الأقسام غير صحيح.");
    const map = new Map(sections.map(x => [x.id, x]));
    const ordered = data.sectionIds.map(id => map.get(String(id))).filter(Boolean);
    sections.forEach(x => { if (!ordered.includes(x)) ordered.push(x); });
    ordered.forEach((x, i) => { x.sortOrder = i; });
    sections.splice(0, sections.length, ...ordered);
  } else {
    if (sectionIndex < 0) error("لم يتم العثور على القسم.", 404);
    const section = sections[sectionIndex];
    if (action === "updateSection") {
      const title = str(data.title, 200); if (!title) error("أدخل اسم القسم."); section.title = title;
    } else if (action === "deleteSection") sections.splice(sectionIndex, 1);
    else if (["createItem", "updateItem", "deleteItem"].includes(action)) {
      const items = section.items, itemId = str(data.itemId, 100), itemIndex = items.findIndex(x => x.id === itemId);
      if (action === "createItem") {
        const name = str(data.name, 200); if (!name) error("أدخل اسم العنصر.");
        items.push({ id: "item-" + new ObjectId().toString(), name, type: data.itemType === "file" ? "file" : "video", url: safeUrl(data.url, "رابط العنصر"), description: str(data.description, 2000), sortOrder: items.length, createdAt: new Date() });
      } else {
        if (itemIndex < 0) error("لم يتم العثور على العنصر.", 404);
        if (action === "deleteItem") items.splice(itemIndex, 1);
        else {
          const name = str(data.name, 200); if (!name) error("أدخل اسم العنصر.");
          items[itemIndex] = { ...items[itemIndex], name, type: data.itemType === "file" ? "file" : "video", url: safeUrl(data.url, "رابط العنصر"), description: str(data.description, 2000), updatedAt: new Date() };
        }
      }
      items.forEach((x, i) => { x.sortOrder = i; });
    } else error("الإجراء المطلوب غير معروف.");
  }
  await db.collection(COURSES).updateOne({ _id: course._id }, { $set: { sections, updatedAt: new Date(), updatedBy: auth.admin._id } });
  await audit(db, auth, action, course._id, { sectionId, itemId: data.itemId || null });
  return { message: "تم حفظ محتوى الدورة بنجاح.", sections };
}
const ACTIONS = {
  createCourse: ["إنشاء"], updateCourse: ["تعديل"], deleteCourse: ["حذف"],
  reorderCourses: ["تعديل"], toggleCoursePin: ["تعديل"], toggleCourseStatus: ["تعديل"], toggleCourseVisibility: ["تعديل"],
  createSection: ["إنشاء", "تعديل"], updateSection: ["تعديل"], deleteSection: ["حذف"], reorderSections: ["تعديل"],
  createItem: ["إنشاء", "تعديل"], updateItem: ["تعديل"], deleteItem: ["حذف"]
};
async function write(db, auth, action, data) {
  const collection = db.collection(COURSES), now = new Date();
  if (action === "createCourse") {
    await validateAcademic(db, data);
    const doc = cleanCourse(data);
    doc.pinned = false; doc.isPinned = false;
    doc.sortOrder = await collection.countDocuments({ deletedAt: { $exists: false } });
    doc.createdAt = now; doc.createdBy = auth.admin._id;
    const inserted = await collection.insertOne(doc);
    await audit(db, auth, "course_created", inserted.insertedId, { title: doc.title });
    return { message: "تمت إضافة الدورة وحفظها في قاعدة البيانات.", id: String(inserted.insertedId) };
  }
  if (action === "reorderCourses") {
    if (!Array.isArray(data.courseIds) || data.courseIds.length > LIMIT) error("قائمة ترتيب الدورات غير صحيحة.");
    for (let i = 0; i < data.courseIds.length; i++) {
      const item = await findCourse(db, data.courseIds[i]);
      if (item && !item.deletedAt) await collection.updateOne({ _id: item._id }, { $set: { sortOrder: i, updatedAt: now } });
    }
    await audit(db, auth, "courses_reordered", null, { count: data.courseIds.length });
    return { message: "تم حفظ ترتيب الدورات." };
  }
  const course = await findCourse(db, data.courseId || data.id);
  if (!course || course.deletedAt || ["deleted", "محذوف"].includes(String(course.status || "").toLowerCase())) error("لم يتم العثور على الدورة.", 404);
  if (action === "updateCourse") {
    await validateAcademic(db, data);
    const patch = cleanCourse(data, course);
    delete patch.pinned; delete patch.isPinned;
    await collection.updateOne({ _id: course._id }, { $set: { ...patch, updatedBy: auth.admin._id } });
    await audit(db, auth, "course_updated", course._id, { title: patch.title });
    return { message: "تم تحديث بيانات الدورة بنجاح." };
  }
  if (action === "toggleCoursePin") {
    const pinned = data.pinned === true;
    await collection.updateOne({ _id: course._id }, { $set: { pinned, isPinned: pinned, updatedAt: now, updatedBy: auth.admin._id } });
    await audit(db, auth, pinned ? "course_pinned" : "course_unpinned", course._id);
    return { message: pinned ? "تم تثبيت الدورة." : "تم إلغاء تثبيت الدورة." };
  }
  if (action === "toggleCourseStatus") {
    const active = data.status === "active";
    await collection.updateOne({ _id: course._id }, { $set: { status: active ? "active" : "inactive", isActive: active, updatedAt: now, updatedBy: auth.admin._id } });
    await audit(db, auth, active ? "course_activated" : "course_deactivated", course._id);
    return { message: active ? "الدورة نشطة الآن." : "تم إيقاف الدورة." };
  }
  if (action === "toggleCourseVisibility") {
    const visible = data.isVisible === true;
    await collection.updateOne({ _id: course._id }, { $set: { isVisible: visible, visible, updatedAt: now, updatedBy: auth.admin._id } });
    await audit(db, auth, visible ? "course_visible" : "course_hidden", course._id);
    return { message: visible ? "الدورة ظاهرة للطلاب." : "تم إخفاء الدورة عن الطلاب." };
  }
  if (action === "deleteCourse") {
    await collection.updateOne({ _id: course._id }, { $set: { status: "deleted", isActive: false, deletedAt: now, deletedBy: auth.admin._id, updatedAt: now } });
    await audit(db, auth, "course_soft_deleted", course._id, { title: course.title || course.name || "" });
    return { message: "تم حذف الدورة مع الاحتفاظ بسجلات الاشتراكات المرتبطة بها." };
  }
  return saveContent(db, auth, action, data, course);
}
module.exports = async function handler(req, res) {
  try {
    const db = await getDatabase();
    if (req.method === "GET") {
      const auth = await requireAdmin(req, { section: SECTION, module: MODULE, action: "عرض" });
      if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
      const [perms, academic] = await Promise.all([capabilities(db, auth), academicData(db)]);
      const actor = { name: auth.admin.fullName || auth.admin.name || auth.admin.email || "مدير النظام", role: auth.roleName };
      const site = { url: process.env.APP_URL || "" };
      const courseId = str(req.query?.courseId, 100);
      if (courseId) {
        const course = await findCourse(db, courseId);
        if (!course || course.deletedAt) return json(res, 404, { ok: false, message: "لم يتم العثور على الدورة." });
        const hasEnrollments = await loadEnrollments(db, course);
        return json(res, 200, { ok: true, course: publicCourse(course, hasEnrollments.enrollments.length), enrollments: hasEnrollments.enrollments, enrollmentsAvailable: hasEnrollments.available, academic, capabilities: perms, actor, site });
      }
      const docs = await db.collection(COURSES).find({ deletedAt: { $exists: false }, status: { $nin: ["deleted", "محذوف"] } }).sort({ sortOrder: 1, pinned: -1, createdAt: -1 }).limit(LIMIT).toArray();
      const hasEnrollments = await exists(db, ENROLLMENTS);
      const courses = await Promise.all(docs.map(async doc => publicCourse(doc, hasEnrollments ? await db.collection(ENROLLMENTS).countDocuments(enrollmentQuery(doc)) : null)));
      return json(res, 200, { ok: true, courses, academic, capabilities: perms, actor, site, enrollmentsAvailable: hasEnrollments, truncated: docs.length === LIMIT, generatedAt: new Date().toISOString() });
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." }); }
    const action = str(req.body?.action, 50), possible = ACTIONS[action];
    if (!possible) return json(res, 400, { ok: false, message: "العملية المطلوبة غير صحيحة." });
    let auth = null, last = { status: 403, message: "ليس لديك صلاحية تنفيذ هذا الإجراء." };
    for (const permission of possible) {
      const candidate = await requireAdmin(req, { section: SECTION, module: MODULE, action: permission });
      if (candidate.ok) { auth = candidate; break; }
      last = candidate;
    }
    if (!auth) return json(res, last.status, { ok: false, message: last.message });
    const result = await write(db, auth, action, req.body || {});
    return json(res, 200, { ok: true, ...result });
  } catch (e) {
    console.error("admin course management failed:", e.message);
    return json(res, e.statusCode || 500, { ok: false, message: e.message || "تعذر تنفيذ العملية." });
  }
};

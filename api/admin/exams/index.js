const { ObjectId } = require("mongodb");
const { json, db: getDatabase } = require("../../_lib/auth");
const { requireAdmin, roleAllows, normalizeRole } = require("../../_lib/admin");

const EXAMS = process.env.EXAMS_COLLECTION || "exams";
const COURSES = process.env.COURSES_COLLECTION || "courses";
const ROLES = process.env.PLATFORM_ROLES_COLLECTION || "platform_roles";
const SECTION = "إدارة المحتوى";
const MODULE = "الامتحانات والأسئلة";
const MAX_EXAMS = 300;
const MAX_QUESTIONS = 1000;

function str(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}
function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
function idValue(value) {
  const raw = str(value, 100);
  return ObjectId.isValid(raw) ? new ObjectId(raw) : raw;
}
function idQuery(value) {
  const raw = str(value, 100);
  if (!raw) fail("معرف السجل مطلوب.");
  const converted = idValue(raw);
  return { $or: [{ _id: converted }, { _id: raw }] };
}
function courseTitle(course) {
  return str(course?.title || course?.name, 200) || "دورة بدون عنوان";
}
function cleanQuestions(input) {
  if (!Array.isArray(input)) fail("قائمة الأسئلة غير صحيحة.");
  if (input.length > MAX_QUESTIONS) fail("الحد الأقصى للامتحان هو 1000 سؤال.");
  const ids = new Set();
  return input.map((item, index) => {
    const text = str(item?.text || item?.q, 1500);
    if (!text) fail("نص السؤال رقم " + (index + 1) + " فارغ.");
    if (!Array.isArray(item?.options) || item.options.length !== 3) {
      fail("يجب أن يحتوي كل سؤال على ثلاثة اختيارات بالضبط. راجع السؤال رقم " + (index + 1) + ".");
    }
    const options = item.options.map((option, optionIndex) => {
      const value = str(option, 500);
      if (!value) fail("الاختيار رقم " + (optionIndex + 1) + " في السؤال " + (index + 1) + " فارغ.");
      return value;
    });
    const correctIndex = Number(item.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 2) {
      fail("حدد الإجابة الصحيحة للسؤال رقم " + (index + 1) + ".");
    }
    let id = str(item.id, 100);
    if (!id || ids.has(id)) id = "q-" + new ObjectId().toString();
    ids.add(id);
    return {
      id,
      text,
      options,
      correctIndex,
      required: item.required !== false,
      source: item.source === "bank" ? "bank" : "provided",
      sortOrder: index
    };
  });
}
function publicExam(doc) {
  const questions = Array.isArray(doc.questions) ? doc.questions : [];
  return {
    id: String(doc._id),
    courseId: String(doc.courseId || ""),
    courseTitle: str(doc.courseTitle, 200),
    title: str(doc.title, 200),
    questions,
    questionCount: questions.length,
    status: doc.status === "active" ? "active" : "draft",
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  };
}
async function loadCapabilities(database, auth) {
  if (auth.builtInAdmin) return { view: true, create: true, edit: true, delete: true };
  const roles = await database.collection(ROLES).find({ isActive: { $ne: false } }).toArray();
  const role = roles.find(item => normalizeRole(item.roleName) === normalizeRole(auth.roleName));
  const allows = action => roleAllows(role, { section: SECTION, module: MODULE, action });
  return {
    view: allows("عرض"),
    create: allows("إنشاء"),
    edit: allows("تعديل"),
    delete: allows("حذف")
  };
}
async function audit(database, auth, action, examId, details = {}) {
  try {
    await database.collection("admin_audit_logs").insertOne({
      action,
      targetExamId: examId || null,
      adminId: auth.admin._id,
      details,
      createdAt: new Date()
    });
  } catch (error) {
    console.error("exam audit log failed:", error.message);
  }
}
async function findCourse(database, courseId) {
  if (!courseId) fail("اختر الدورة المرتبط بها الامتحان.");
  return database.collection(COURSES).findOne({
    ...idQuery(courseId),
    deletedAt: { $exists: false },
    status: { $nin: ["deleted", "محذوف"] }
  });
}
async function write(database, auth, action, data) {
  const collection = database.collection(EXAMS);
  const now = new Date();

  if (action === "saveExam") {
    const title = str(data.title, 200);
    if (title.length < 2) fail("أدخل اسم الامتحان.");
    const course = await findCourse(database, data.courseId);
    if (!course) fail("لم يتم العثور على الدورة المحددة أو أنها محذوفة.", 404);
    const questions = cleanQuestions(data.questions);
    const status = data.status === "active" ? "active" : "draft";
    const examId = str(data.examId, 100);
    const fields = {
      courseId: String(course._id),
      courseTitle: courseTitle(course),
      title,
      questions,
      questionCount: questions.length,
      status,
      isActive: status === "active",
      updatedAt: now,
      updatedBy: auth.admin._id
    };

    if (examId) {
      const previous = await collection.findOne({ ...idQuery(examId), deletedAt: { $exists: false } });
      if (!previous) fail("لم يتم العثور على الامتحان المطلوب تعديله.", 404);
      await collection.updateOne({ _id: previous._id }, { $set: fields });
      await audit(database, auth, "exam_updated", previous._id, { title, questionCount: questions.length });
      return { message: "تم حفظ تعديلات الامتحان والأسئلة في قاعدة البيانات.", examId: String(previous._id) };
    }

    const document = {
      ...fields,
      createdAt: now,
      createdBy: auth.admin._id
    };
    const inserted = await collection.insertOne(document);
    await audit(database, auth, "exam_created", inserted.insertedId, { title, questionCount: questions.length });
    return { message: "تم إنشاء الامتحان وحفظه في قاعدة البيانات.", examId: String(inserted.insertedId) };
  }

  const examId = str(data.examId, 100);
  const exam = await collection.findOne({ ...idQuery(examId), deletedAt: { $exists: false } });
  if (!exam) fail("لم يتم العثور على الامتحان.", 404);

  if (action === "deleteExam") {
    await collection.updateOne({ _id: exam._id }, {
      $set: {
        status: "deleted",
        isActive: false,
        deletedAt: now,
        deletedBy: auth.admin._id,
        updatedAt: now,
        updatedBy: auth.admin._id
      }
    });
    await audit(database, auth, "exam_deleted", exam._id, { title: exam.title || "" });
    return { message: "تم حذف الامتحان من قائمة الإدارة." };
  }

  if (action === "toggleExamStatus") {
    const status = data.status === "active" ? "active" : "draft";
    await collection.updateOne({ _id: exam._id }, {
      $set: { status, isActive: status === "active", updatedAt: now, updatedBy: auth.admin._id }
    });
    await audit(database, auth, status === "active" ? "exam_activated" : "exam_deactivated", exam._id);
    return { message: status === "active" ? "تم تفعيل الامتحان." : "تم تحويل الامتحان إلى مسودة." };
  }

  fail("العملية المطلوبة غير معروفة.");
}

module.exports = async function handler(req, res) {
  try {
    const database = await getDatabase();

    if (req.method === "GET") {
      const auth = await requireAdmin(req, { section: SECTION, module: MODULE, action: "عرض" });
      if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });

      const [capabilities, courseDocs, examDocs] = await Promise.all([
        loadCapabilities(database, auth),
        database.collection(COURSES)
          .find({ deletedAt: { $exists: false }, status: { $nin: ["deleted", "محذوف"] } })
          .sort({ sortOrder: 1, createdAt: -1 })
          .limit(500)
          .toArray(),
        database.collection(EXAMS)
          .find({ deletedAt: { $exists: false }, status: { $ne: "deleted" } })
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(MAX_EXAMS)
          .toArray()
      ]);

      const courses = courseDocs.map(course => ({
        id: String(course._id),
        title: courseTitle(course),
        category: str(course.category || course.gradeCategory, 140),
        grade: str(course.grade || course.year || course.schoolYear, 140),
        subject: str(course.subject || course.subjectName, 140),
        status: course.status === "inactive" || course.isActive === false ? "inactive" : "active"
      }));
      return json(res, 200, {
        ok: true,
        courses,
        exams: examDocs.map(publicExam),
        capabilities,
        actor: {
          name: auth.admin.fullName || auth.admin.name || auth.admin.email || "مدير النظام",
          role: auth.roleName
        },
        site: { url: process.env.APP_URL || "" },
        generatedAt: new Date().toISOString()
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
    }

    const data = req.body || {};
    const action = str(data.action, 40);
    const requestedPermissions = {
      saveExam: data.examId ? ["تعديل"] : ["إنشاء"],
      deleteExam: ["حذف"],
      toggleExamStatus: ["تعديل"]
    }[action];
    if (!requestedPermissions) return json(res, 400, { ok: false, message: "العملية المطلوبة غير صحيحة." });

    let auth = null;
    let last = { status: 403, message: "ليس لديك صلاحية تنفيذ هذا الإجراء." };
    for (const permission of requestedPermissions) {
      const candidate = await requireAdmin(req, { section: SECTION, module: MODULE, action: permission });
      if (candidate.ok) {
        auth = candidate;
        break;
      }
      last = candidate;
    }
    if (!auth) return json(res, last.status, { ok: false, message: last.message });

    const result = await write(database, auth, action, data);
    return json(res, 200, { ok: true, ...result });
  } catch (error) {
    console.error("admin exams management failed:", error.message);
    return json(res, error.statusCode || 500, {
      ok: false,
      message: error.message || "تعذر تحميل أو حفظ الامتحانات. تحقق من اتصال قاعدة البيانات."
    });
  }
};
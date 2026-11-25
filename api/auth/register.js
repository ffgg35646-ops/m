const crypto = require("crypto");
const { db, json, method, hashCode, hashPassword, collectionName } = require("../_lib/auth");
const { sendCodeEmail } = require("../_lib/email");

const USERS = process.env.USERS_COLLECTION || "users";
const ACADEMIC = process.env.ACADEMIC_STRUCTURE_COLLECTION || "academic_structure";
const CODE_COLLECTION = "email_verification_codes";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, max = 180) { return String(value ?? "").trim().slice(0, max); }
function fail(message, status = 400) { const error = new Error(message); error.statusCode = status; throw error; }
function makeCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, "0"); }

async function academicOptions(database) {
  const saved = await database.collection(ACADEMIC).findOne(
    { _id: "main" },
    { projection: { categories: 1, years: 1 } }
  );
  if (saved) {
    return {
      categories: Array.isArray(saved.categories) ? saved.categories.map(x => ({ id: x.id, name: x.name })) : [],
      years: Array.isArray(saved.years) ? saved.years.map(x => ({ id: x.id, name: x.name, category: x.category })) : []
    };
  }
  return {
    categories: [
      { id: "cat-1", name: "النيل" },
      { id: "cat-2", name: "IGCSE" },
      { id: "cat-3", name: "البكالوريا المصرية" },
      { id: "cat-4", name: "American Diploma" },
      { id: "cat-5", name: "أبناؤنا في الخارج ( المسار المصري )" },
      { id: "cat-6", name: "الكورسات المجانية" },
      { id: "cat-7", name: "تعليم اللغة لغير الناطقين بها" }
    ],
    years: []
  };
}

async function sendRegistrationCode(database, email) {
  const codes = database.collection(CODE_COLLECTION);
  const recent = await codes.findOne({
    email,
    createdAt: { $gt: new Date(Date.now() - 60_000) }
  });
  if (recent) fail("تم إرسال كود إلى هذا البريد منذ قليل. انتظر دقيقة قبل طلب كود جديد.", 429);
  const record = await codes.findOne({ email, expiresAt: { $gt: new Date() } });
  if (!record) fail("جلسة التسجيل غير موجودة. أعد إدخال بيانات التسجيل.", 400);
  const code = makeCode();
  await codes.updateOne(
    { _id: record._id },
    { $set: { codeHash: hashCode(code), attempts: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60_000) } }
  );
  await sendCodeEmail({ to: email, name: record.firstName, code, purpose: "registration" });
}

module.exports = async function handler(req, res) {
  try {
    const database = await db();
    if (req.method === "GET") {
      const structure = await academicOptions(database);
      return json(res, 200, { ok: true, structure });
    }
    if (!method(req, res, "POST")) return;
    const payload = req.body || {};
    const email = text(payload.email, 254).toLowerCase();
    if (payload.action === "resend") {
      if (!EMAIL_RE.test(email)) return json(res, 400, { ok: false, message: "أدخل بريداً إلكترونياً صحيحاً." });
      const pending = await database.collection(CODE_COLLECTION).findOne({ email, expiresAt: { $gt: new Date() } });
      if (!pending) return json(res, 400, { ok: false, message: "بيانات التسجيل غير موجودة أو انتهت صلاحيتها. أعد التسجيل من جديد." });
      await sendRegistrationCode(database, email);
      return json(res, 200, { ok: true, message: "أرسلنا كود تأكيد جديداً إلى بريدك الإلكتروني." });
    }

    const firstName = text(payload.firstName, 80);
    const lastName = text(payload.lastName, 100);
    const phone = text(payload.phone, 40);
    const password = String(payload.password || "");
    const category = text(payload.category, 140);
    const year = text(payload.year, 140);
    if (firstName.length < 2 || lastName.length < 2) fail("أدخل الاسم الأول واسم العائلة بشكل صحيح.");
    if (!EMAIL_RE.test(email)) fail("أدخل بريداً إلكترونياً صحيحاً لاستلام كود التأكيد.");
    if (password.length < 8 || password.length > 200) fail("كلمة المرور يجب ألا تقل عن 8 أحرف.");
    if (!category || !year) fail("اختر فئة السنة الدراسية والسنة الدراسية.");

    const users = database.collection(USERS);
    const admins = database.collection(collectionName());
    const [existingStudent, existingAdmin] = await Promise.all([
      users.findOne({ email }, { projection: { _id: 1 } }),
      collectionName() === USERS ? Promise.resolve(null) : admins.findOne({ email }, { projection: { _id: 1 } })
    ]);
    if (existingStudent || existingAdmin) fail("هذا البريد الإلكتروني مسجل بالفعل. سجل الدخول أو استخدم بريداً آخر.", 409);

    const academic = await database.collection(ACADEMIC).findOne({ _id: "main" }, { projection: { categories: 1, years: 1 } });
    if (academic && Array.isArray(academic.categories) && academic.categories.length) {
      if (!academic.categories.some(item => item.name === category)) fail("فئة السنة الدراسية غير موجودة. حدّث الصفحة واختر فئة متاحة.");
      if (!Array.isArray(academic.years) || !academic.years.some(item => item.name === year && item.category === category)) {
        fail("السنة الدراسية لا تتبع الفئة المختارة.");
      }
    }

    const codes = database.collection(CODE_COLLECTION);
    await codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await codes.createIndex({ email: 1, createdAt: -1 });
    const recent = await codes.findOne({ email, createdAt: { $gt: new Date(Date.now() - 60_000) } });
    if (recent) fail("تم إرسال كود إلى هذا البريد منذ قليل. انتظر دقيقة قبل طلب كود جديد.", 429);

    const credentials = await hashPassword(password);
    const code = makeCode();
    await codes.deleteMany({ email });
    await codes.insertOne({
      email, firstName, lastName, phone,
      category, gradeCategory: category, year, schoolYear: year,
      credentials,
      codeHash: hashCode(code), attempts: 0,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60_000)
    });
    try {
      await sendCodeEmail({ to: email, name: firstName, code, purpose: "registration" });
    } catch (error) {
      await codes.deleteMany({ email });
      throw error;
    }
    return json(res, 200, {
      ok: true, message: "أرسلنا كود تأكيد إلى بريدك الإلكتروني. أدخله لإكمال إنشاء الحساب.",
      email
    });
  } catch (error) {
    console.error("student registration failed:", error.message);
    return json(res, error.statusCode || 500, {
      ok: false,
      message: error.statusCode ? error.message : "تعذر إرسال كود التأكيد حالياً. تحقق من إعدادات البريد وحاول مرة أخرى."
    });
  }
};

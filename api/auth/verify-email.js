const crypto = require("crypto");
const { db, json, method, hashCode } = require("../_lib/auth");

const USERS = process.env.USERS_COLLECTION || "users";
const CODE_COLLECTION = "email_verification_codes";

function text(value, max = 180) { return String(value ?? "").trim().slice(0, max); }
function safeHashEqual(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function studentCode() { return "STU-" + crypto.randomInt(100000, 1000000); }

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const email = text(req.body?.email, 254).toLowerCase();
    const code = text(req.body?.code, 6);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
      return json(res, 400, { ok: false, message: "أدخل البريد الإلكتروني وكود التأكيد المكوّن من 6 أرقام." });
    }

    const database = await db();
    const codes = database.collection(CODE_COLLECTION);
    const record = await codes.findOne({ email, expiresAt: { $gt: new Date() }, consumedAt: { $exists: false } });
    if (!record) return json(res, 400, { ok: false, message: "الكود غير صحيح أو انتهت صلاحيته. اطلب كوداً جديداً." });
    if (Number(record.attempts || 0) >= 5) {
      await codes.deleteOne({ _id: record._id });
      return json(res, 429, { ok: false, message: "تجاوزت عدد المحاولات المسموحة. أعد التسجيل للحصول على كود جديد." });
    }
    if (!safeHashEqual(hashCode(code), record.codeHash)) {
      await codes.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
      return json(res, 400, { ok: false, message: "كود التأكيد غير صحيح." });
    }

    const users = database.collection(USERS);
    const adminCollection = process.env.AUTH_COLLECTION || "admins";
    const [existing, existingAdmin] = await Promise.all([
      users.findOne({ email }, { projection: { _id: 1 } }),
      adminCollection === USERS ? Promise.resolve(null) : database.collection(adminCollection).findOne({ email }, { projection: { _id: 1 } })
    ]);
    if (existing || existingAdmin) {
      await codes.deleteOne({ _id: record._id });
      return json(res, 409, { ok: false, message: "هذا البريد مرتبط بحساب بالفعل. انتقل إلى تسجيل الدخول." });
    }

    const claimed = await codes.updateOne(
      { _id: record._id, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date() } }
    );
    if (!claimed.modifiedCount) return json(res, 409, { ok: false, message: "تم استخدام هذا الكود بالفعل. سجل الدخول أو اطلب كوداً جديداً." });

    let codeValue = studentCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const duplicate = await users.findOne({ $or: [{ code: codeValue }, { studentCode: codeValue }] }, { projection: { _id: 1 } });
      if (!duplicate) break;
      codeValue = studentCode();
    }
    const now = new Date();
    const document = {
      firstName: record.firstName, lastName: record.lastName,
      fullName: [record.firstName, record.lastName].filter(Boolean).join(" "),
      name: [record.firstName, record.lastName].filter(Boolean).join(" "),
      email, phone: record.phone || "", mobile: record.phone || "",
      code: codeValue, studentCode: codeValue,
      role: "student", accountType: "student",
      category: record.category, gradeCategory: record.category,
      year: record.year, schoolYear: record.year,
      status: "نشط", isActive: true, active: true,
      emailVerified: true, emailVerifiedAt: now,
      ...record.credentials,
      createdAt: now, updatedAt: now
    };
    const inserted = await users.insertOne(document);
    await codes.deleteOne({ _id: record._id });
    try {
      await database.collection("admin_audit_logs").insertOne({
        action: "student_registered_email_verified",
        targetUserId: inserted.insertedId,
        details: { email },
        createdAt: now
      });
    } catch (error) { console.error("student registration audit log failed:", error.message); }

    return json(res, 200, {
      ok: true, message: "تم تأكيد بريدك الإلكتروني وإنشاء حسابك بنجاح. يمكنك تسجيل الدخول الآن.",
      redirect: "login.html", email
    });
  } catch (error) {
    console.error("email verification failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تأكيد البريد الإلكتروني حالياً." });
  }
};

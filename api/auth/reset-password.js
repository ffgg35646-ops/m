const crypto = require("crypto");
const {
  db, collectionName, json, method, hashCode, hashPassword, safeEqual
} = require("../_lib/auth");

const USERS = process.env.USERS_COLLECTION || "users";
const RESET_CODES = "password_reset_codes";

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    const password = String(req.body?.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code) || password.length < 8 || password.length > 200) {
      return json(res, 400, { ok: false, message: "تحقق من البريد والكود، واجعل كلمة المرور 8 أحرف على الأقل." });
    }

    const database = await db();
    const resets = database.collection(RESET_CODES);
    const record = await resets.findOne({ email, expiresAt: { $gt: new Date() }, consumedAt: { $exists: false } });
    if (!record) return json(res, 400, { ok: false, message: "الكود غير صحيح أو انتهت صلاحيته. اطلب كوداً جديداً." });
    if (Number(record.attempts || 0) >= 5) {
      await resets.deleteOne({ _id: record._id });
      return json(res, 429, { ok: false, message: "تجاوزت عدد المحاولات. اطلب كوداً جديداً." });
    }
    if (!safeEqual(hashCode(code), record.codeHash)) {
      await resets.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
      return json(res, 400, { ok: false, message: "كود التحقق غير صحيح." });
    }

    const claimed = await resets.updateOne(
      { _id: record._id, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date() } }
    );
    if (!claimed.modifiedCount) return json(res, 409, { ok: false, message: "تم استخدام هذا الكود بالفعل. اطلب كوداً جديداً." });

    const targetCollection = record.collection || collectionName();
    const credentials = await hashPassword(password);
    const updated = await database.collection(targetCollection).updateOne(
      { _id: record.userId, email },
      { $set: { ...credentials, passwordUpdatedAt: new Date(), updatedAt: new Date() } }
    );
    if (!updated.matchedCount) {
      await resets.deleteOne({ _id: record._id });
      return json(res, 400, { ok: false, message: "تعذر تحديث الحساب. اطلب كوداً جديداً." });
    }

    await resets.deleteOne({ _id: record._id });
    await database.collection("auth_sessions").deleteMany({ userId: record.userId });
    res.setHeader("Set-Cookie", "ali_admin_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    return json(res, 200, { ok: true, message: "تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن." });
  } catch (error) {
    console.error("password reset failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تغيير كلمة المرور حالياً." });
  }
};

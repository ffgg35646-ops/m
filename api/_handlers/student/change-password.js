"use strict";
const crypto = require("crypto");
const { promisify } = require("util");
const { json, hashPassword, safeEqual } = require("../_lib/auth");
const { requireStudent, USERS } = require("./_lib");
const scrypt = promisify(crypto.scrypt);

module.exports = async function(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }
  try {
    const auth = await requireStudent(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!currentPassword || newPassword.length < 8 || newPassword.length > 200) {
      return json(res, 400, { ok: false, message: "أدخل كلمة المرور الحالية، واجعل الجديدة 8 أحرف على الأقل." });
    }
    if (!auth.user.passwordHash || !auth.user.passwordSalt) {
      return json(res, 409, { ok: false, message: "تعذر التحقق من كلمة المرور الحالية لهذا الحساب." });
    }
    const digest = await scrypt(currentPassword, auth.user.passwordSalt, 64);
    if (!safeEqual(digest.toString("hex"), auth.user.passwordHash)) {
      return json(res, 401, { ok: false, message: "كلمة المرور الحالية غير صحيحة." });
    }
    const credentials = await hashPassword(newPassword);
    await auth.database.collection(USERS).updateOne(
      { _id: auth.user._id },
      { $set: { ...credentials, passwordChangedAt: new Date(), updatedAt: new Date() } }
    );
    return json(res, 200, { ok: true, message: "تم تغيير كلمة المرور بنجاح." });
  } catch (error) {
    console.error("student password update failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تغيير كلمة المرور حالياً." });
  }
};

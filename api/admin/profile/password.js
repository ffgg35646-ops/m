const { json, method, hashPassword, safeEqual } = require("../../_lib/auth");
const { requireAdmin } = require("../../_lib/admin");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!currentPassword || newPassword.length < 6 || newPassword.length > 200) {
      return json(res, 400, { ok: false, message: "أدخل كلمة المرور الحالية، واجعل الجديدة 6 أحرف على الأقل." });
    }
    if (currentPassword === newPassword) {
      return json(res, 400, { ok: false, message: "كلمة المرور الجديدة يجب أن تختلف عن الحالية." });
    }

    const source = auth.session.authCollection || "admins";
    const admins = auth.database.collection(source);
    const admin = await admins.findOne(
      { _id: auth.session.userId },
      { projection: { passwordHash: 1, passwordSalt: 1 } }
    );
    if (!admin?.passwordHash || !admin?.passwordSalt) {
      return json(res, 400, { ok: false, message: "تعذر التحقق من كلمة المرور الحالية لهذا الحساب." });
    }

    const derived = await scrypt(currentPassword, admin.passwordSalt, 64);
    if (!safeEqual(derived.toString("hex"), admin.passwordHash)) {
      return json(res, 401, { ok: false, message: "كلمة المرور الحالية غير صحيحة." });
    }

    const credentials = await hashPassword(newPassword);
    const updatedAt = new Date();
    await admins.updateOne(
      { _id: admin._id },
      { $set: { ...credentials, passwordUpdatedAt: updatedAt, updatedAt } }
    );

    await auth.database.collection("auth_sessions").deleteMany({
      userId: auth.session.userId,
      tokenHash: { $ne: auth.session.tokenHash }
    });

    return json(res, 200, {
      ok: true,
      message: "تم تغيير كلمة المرور بنجاح.",
      updatedAt
    });
  } catch (error) {
    console.error("admin password change failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تغيير كلمة المرور حالياً." });
  }
};

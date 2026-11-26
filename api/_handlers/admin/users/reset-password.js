const { json, method, hashPassword } = require("../../_lib/auth");
const { requireAdmin, parseMongoId } = require("../../_lib/admin");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const userId = String(req.body?.userId || "");
    const password = String(req.body?.password || "");
    const requestId = String(req.body?.requestId || "");
    if (!userId || password.length < 6 || password.length > 200) {
      return json(res, 400, { ok: false, message: "كلمة المرور يجب ألا تقل عن 6 أحرف." });
    }

    const database = auth.database;
    const users = database.collection(process.env.USERS_COLLECTION || "users");
    const parsedId = parseMongoId(userId);
    const user = await users.findOne({ $or: [{ _id: parsedId }, { _id: userId }] });
    if (!user) return json(res, 404, { ok: false, message: "لم يتم العثور على حساب المستخدم في قاعدة البيانات." });

    const credentials = await hashPassword(password);
    const update = await users.updateOne(
      { _id: user._id },
      { $set: { ...credentials, passwordUpdatedAt: new Date(), updatedAt: new Date() } }
    );
    if (!update.matchedCount) return json(res, 404, { ok: false, message: "لم يتم العثور على حساب المستخدم." });

    await database.collection("auth_sessions").deleteMany({ userId: user._id });
    if (requestId) {
      await database.collection(process.env.PASSWORD_RESET_REQUESTS_COLLECTION || "password_reset_requests")
        .updateOne({ _id: parseMongoId(requestId) }, { $set: { status: "completed", completedAt: new Date(), updatedAt: new Date(), handledBy: auth.admin._id } });
    }
    await database.collection("admin_audit_logs").insertOne({
      action: "student_password_reset",
      targetUserId: user._id,
      adminId: auth.admin._id,
      createdAt: new Date()
    });
    return json(res, 200, { ok: true, message: "تم تحديث كلمة مرور المستخدم وإلغاء جلساته السابقة." });
  } catch (error) {
    console.error("admin user password reset failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تغيير كلمة المرور حالياً." });
  }
};

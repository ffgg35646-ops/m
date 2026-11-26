const { json, method } = require("../../_lib/auth");
const { requireAdmin, parseMongoId } = require("../../_lib/admin");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const id = String(req.body?.id || "");
    if (!id) return json(res, 400, { ok: false, message: "معرف الإشعار مطلوب." });
    const result = await auth.database.collection(process.env.NOTIFICATIONS_COLLECTION || "notifications")
      .deleteOne({ _id: parseMongoId(id) });
    if (!result.deletedCount) return json(res, 404, { ok: false, message: "الإشعار غير موجود." });
    return json(res, 200, { ok: true, message: "تم حذف الإشعار." });
  } catch (error) {
    console.error("admin notification delete failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر حذف الإشعار حالياً." });
  }
};

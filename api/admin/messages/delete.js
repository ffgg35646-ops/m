const { json, method } = require("../../_lib/auth");
const { requireAdmin, parseMongoId } = require("../../_lib/admin");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const id = String(req.body?.id || "");
    const kind = String(req.body?.kind || "");
    if (!id || !["contact", "password_reset"].includes(kind)) {
      return json(res, 400, { ok: false, message: "بيانات الحذف غير مكتملة." });
    }
    const collection = kind === "contact"
      ? (process.env.CONTACT_MESSAGES_COLLECTION || "contact_messages")
      : (process.env.PASSWORD_RESET_REQUESTS_COLLECTION || "password_reset_requests");
    const result = await auth.database.collection(collection).deleteOne({ _id: parseMongoId(id) });
    if (!result.deletedCount) return json(res, 404, { ok: false, message: "الرسالة غير موجودة أو حُذفت بالفعل." });
    return json(res, 200, { ok: true, message: "تم حذف السجل بنجاح." });
  } catch (error) {
    console.error("admin message delete failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر حذف السجل حالياً." });
  }
};

const { json, method } = require("../_lib/auth");
const { requireAdmin } = require("../_lib/admin");

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const database = auth.database;
    const collection = database.collection(process.env.NOTIFICATIONS_COLLECTION || "notifications");

    if (req.method === "GET") {
      const notifications = await collection.find({}).sort({ createdAt: -1 }).limit(100).toArray();
      return json(res, 200, {
        ok: true,
        notifications: notifications.map((item) => ({
          id: String(item._id),
          title: item.title || "",
          body: item.body || item.message || "",
          audience: item.audience || "all",
          recipientCount: item.recipientCount ?? (item.recipientIds?.length || null),
          createdAt: item.createdAt || null,
          status: item.status || "sent"
        }))
      });
    }

    const title = String(req.body?.title || "").trim().slice(0, 140);
    const body = String(req.body?.body || "").trim().slice(0, 3000);
    const audience = String(req.body?.audience || "all");
    let recipientIds = Array.isArray(req.body?.recipientIds)
      ? [...new Set(req.body.recipientIds.map((id) => String(id).trim()).filter(Boolean))].slice(0, 500)
      : [];

    if (title.length < 3 || body.length < 3) {
      return json(res, 400, { ok: false, message: "أدخل عنواناً ونصاً واضحين للإشعار." });
    }
    if (!["all", "selected"].includes(audience)) {
      return json(res, 400, { ok: false, message: "نوع المستلمين غير صحيح." });
    }
    if (audience === "selected" && recipientIds.length === 0) {
      return json(res, 400, { ok: false, message: "أدخل معرف مستخدم واحداً على الأقل للإرسال المحدد." });
    }

    if (audience === "selected") {
      const { ObjectId } = require("mongodb");
      const filters = recipientIds.map((id) => /^[a-fA-F0-9]{24}$/.test(id) ? new ObjectId(id) : id);
      const users = database.collection(process.env.USERS_COLLECTION || "users");
      const found = await users.find({ _id: { $in: filters } }, { projection: { _id: 1 } }).toArray();
      recipientIds = found.map((user) => String(user._id));
      if (!recipientIds.length) return json(res, 404, { ok: false, message: "لم يتم العثور على المستخدمين المحددين." });
    }

    const document = {
      title, body, audience,
      recipientIds: audience === "selected" ? recipientIds : [],
      recipientCount: audience === "selected" ? recipientIds.length : null,
      status: "sent",
      createdAt: new Date(),
      createdBy: auth.admin._id
    };
    const result = await collection.insertOne(document);
    return json(res, 201, { ok: true, id: String(result.insertedId), message: "تم حفظ الإشعار في سجل إشعارات المنصة." });
  } catch (error) {
    console.error("admin notification operation failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تنفيذ عملية الإشعارات حالياً." });
  }
};

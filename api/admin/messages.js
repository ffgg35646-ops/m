const { json, method } = require("../_lib/auth");
const { requireAdmin } = require("../_lib/admin");

function safeMessage(doc, type) {
  return {
    id: String(doc._id),
    userId: doc.userId ? String(doc.userId) : null,
    type,
    name: doc.name || doc.fullName || "—",
    email: doc.email || "—",
    phone: doc.phone || doc.mobile || "—",
    code: doc.code || doc.studentCode || "—",
    category: doc.category || doc.gradeCategory || "—",
    grade: doc.grade || doc.schoolYear || "—",
    status: doc.userStatus || "—",
    message: doc.message || "—",
    createdAt: doc.createdAt || doc.date || null,
    requestStatus: doc.requestStatus || doc.status || "new"
  };
}

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const database = auth.database;
    const contactName = process.env.CONTACT_MESSAGES_COLLECTION || "contact_messages";
    const resetName = process.env.PASSWORD_RESET_REQUESTS_COLLECTION || "password_reset_requests";
    const existing = new Set((await database.listCollections(
      { name: { $in: [contactName, resetName] } }, { nameOnly: true }
    ).toArray()).map((item) => item.name));

    const [contacts, resets] = await Promise.all([
      existing.has(contactName) ? database.collection(contactName).find({}).sort({ createdAt: -1 }).limit(100).toArray() : [],
      existing.has(resetName) ? database.collection(resetName).find({}).sort({ createdAt: -1 }).limit(100).toArray() : []
    ]);

    const messages = [
      ...resets.map((doc) => safeMessage(doc, "password_reset")),
      ...contacts.map((doc) => safeMessage(doc, "contact"))
    ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return json(res, 200, {
      ok: true,
      total: messages.length,
      messages,
      collections: { contact: existing.has(contactName), passwordReset: existing.has(resetName) }
    });
  } catch (error) {
    console.error("admin messages read failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تحميل الرسائل حالياً." });
  }
};

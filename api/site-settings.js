const { db, json, method } = require("./_lib/auth");
const COLLECTION = process.env.PLATFORM_SETTINGS_COLLECTION || "platform_settings";
const DEFAULT_NAME = "منصة علي عليان الدولية";
module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const database = await db();
    const saved = await database.collection(COLLECTION).findOne(
      { _id: "organization" },
      { projection: { "settings.organization.name": 1 } }
    );
    const name = String(saved?.settings?.organization?.name || DEFAULT_NAME).trim() || DEFAULT_NAME;
    return json(res, 200, { ok: true, organization: { name } });
  } catch (error) {
    console.error("public site settings failed:", error.message);
    return json(res, 503, { ok: false, message: "تعذر تحميل إعدادات المنصة." });
  }
};
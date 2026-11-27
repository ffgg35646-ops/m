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
      { projection: { "settings.organization.name": 1, "settings.branding.logoData": 1, "settings.branding.bannerData": 1, "settings.legal.privacyText": 1 } }
    );
    const name = String(saved?.settings?.organization?.name || DEFAULT_NAME).trim() || DEFAULT_NAME;
    return json(res, 200, {
      ok: true,
      organization: { name },
      branding: {
        logoData: typeof saved?.settings?.branding?.logoData === "string" ? saved.settings.branding.logoData : "",
        bannerData: typeof saved?.settings?.branding?.bannerData === "string" ? saved.settings.branding.bannerData : ""
      },
      legal: {
        privacyText: typeof saved?.settings?.legal?.privacyText === "string" ? saved.settings.legal.privacyText : ""
      }
    });
  } catch (error) {
    console.error("public site settings failed:", error.message);
    return json(res, 503, { ok: false, message: "تعذر تحميل إعدادات المنصة." });
  }
};
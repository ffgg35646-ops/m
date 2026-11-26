const crypto = require("crypto");
const {
  db, collectionName, json, method, hashCode, required
} = require("../_lib/auth");
const { sendCodeEmail } = require("../_lib/email");

const USERS = process.env.USERS_COLLECTION || "users";
const RESET_CODES = "password_reset_codes";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, max = 254) { return String(value ?? "").trim().slice(0, max); }

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const email = text(req.body?.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return json(res, 400, { ok: false, message: "أدخل بريداً إلكترونياً صحيحاً." });

    const database = await db();
    const resets = database.collection(RESET_CODES);
    await resets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await resets.createIndex({ email: 1, createdAt: -1 });
    const recent = await resets.findOne({ email, createdAt: { $gt: new Date(Date.now() - 60_000) } });
    if (recent) return json(res, 429, { ok: false, message: "انتظر دقيقة قبل طلب كود جديد." });

    const userCollection = database.collection(USERS);
    const adminCollectionName = collectionName();
    const [student, admin] = await Promise.all([
      userCollection.findOne({ email }),
      adminCollectionName === USERS ? Promise.resolve(null) : database.collection(adminCollectionName).findOne({ email })
    ]);
    const user = student || admin;
    const targetCollection = student ? USERS : (admin ? adminCollectionName : null);

    // Same public response whether or not the email exists.
    if (user && targetCollection) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      await resets.deleteMany({ email });
      await resets.insertOne({
        email, userId: user._id, collection: targetCollection,
        codeHash: hashCode(code), attempts: 0,
        createdAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60_000)
      });
      try {
        await sendCodeEmail({
          to: email,
          name: user.fullName || user.name || user.firstName || "صديقنا",
          code,
          purpose: "password"
        });
      } catch (error) {
        await resets.deleteMany({ email });
        throw error;
      }
    }
    return json(res, 200, {
      ok: true,
      message: "إذا كان البريد مرتبطاً بحساب، فسيصلك كود استعادة كلمة المرور خلال لحظات."
    });
  } catch (error) {
    console.error("forgot password failed:", error.message);
    return json(res, 500, {
      ok: false,
      message: "تعذر إرسال كود التحقق حالياً. راجع إعدادات البريد والخادم."
    });
  }
};

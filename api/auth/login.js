const { db, collectionName, json, method, hashPassword, safeEqual } = require("../_lib/auth");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const identity = String(req.body?.identity || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!identity || !password || password.length > 200) return json(res, 400, { ok:false, message:"أدخل بيانات تسجيل الدخول." });

    const database = await db();
    const users = database.collection(collectionName());
    const user = await users.findOne({ $or: [{ email: identity }, { phone: identity }] });
    if (!user || !user.passwordHash || !user.passwordSalt) return json(res, 401, { ok:false, message:"بيانات الدخول غير صحيحة." });

    const derived = await scrypt(password, user.passwordSalt, 64);
    if (!safeEqual(derived.toString("hex"), user.passwordHash)) return json(res, 401, { ok:false, message:"بيانات الدخول غير صحيحة." });

    const token = crypto.randomBytes(32).toString("hex");
    const sessionHash = crypto.createHash("sha256").update(token).digest("hex");
    await database.collection("auth_sessions").insertOne({
      userId: user._id, tokenHash: sessionHash, role: user.role || "admin",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000)
    });
    res.setHeader("Set-Cookie", `ali_admin_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
    return json(res, 200, { ok:true, redirect:"dashboard.html" });
  } catch (error) {
    console.error("auth login failed:", error.message);
    return json(res, 500, { ok:false, message:"تعذر تسجيل الدخول حالياً. راجع إعدادات الخادم." });
  }
};

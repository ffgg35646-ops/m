const crypto = require("crypto");
const { db, json, method } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const identity = String(req.body?.identity || "").trim();
    if (identity.length < 5 || identity.length > 180) {
      return json(res, 400, { ok: false, message: "أدخل البريد الإلكتروني أو رقم الهاتف المسجل." });
    }
    const normalized = identity.toLowerCase();
    const database = await db();
    const users = database.collection(process.env.USERS_COLLECTION || "users");
    const requests = database.collection(process.env.PASSWORD_RESET_REQUESTS_COLLECTION || "password_reset_requests");
    const identityHash = crypto.createHash("sha256").update(normalized).digest("hex");
    const recent = await requests.findOne({
      identityHash,
      createdAt: { $gt: new Date(Date.now() - 5 * 60_000) },
      status: { $in: ["new", "pending"] }
    });
    if (recent) return json(res, 200, { ok: true, message: "تم استلام طلبك بالفعل. يرجى انتظار تواصل الإدارة." });

    const user = await users.findOne({
      $or: [{ email: normalized }, { phone: identity }, { mobile: identity }, { username: normalized }]
    });
    // Use the same public response whether the account exists or not.
    if (user) {
      const name = user.fullName || user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || "مستخدم";
      await requests.insertOne({
        userId: user._id,
        name,
        email: user.email || null,
        phone: user.phone || user.mobile || null,
        code: user.code || user.studentCode || null,
        category: user.category || user.gradeCategory || null,
        grade: user.grade || user.schoolYear || null,
        userStatus: user.status || (user.isActive === false ? "غير نشط" : "غير محدد"),
        identityHash,
        type: "password_reset",
        status: "new",
        message: "طلب المستخدم إعادة تعيين كلمة المرور.",
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    return json(res, 200, { ok: true, message: "إذا كانت البيانات مرتبطة بحساب، فقد تم تسجيل طلبك لإدارة المنصة." });
  } catch (error) {
    console.error("admin password reset request failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تسجيل الطلب حالياً." });
  }
};

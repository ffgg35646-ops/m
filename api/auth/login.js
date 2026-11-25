const { db, collectionName, json, method, safeEqual } = require("../_lib/auth");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const identityRaw = String(req.body?.identity || "").trim();
    const identity = identityRaw.toLowerCase();
    const password = String(req.body?.password || "");
    if (!identity || !password || password.length > 200) return json(res, 400, {ok:false,message:"أدخل بيانات تسجيل الدخول."});

    const database = await db();
    const adminCollection = collectionName();
    const studentCollection = process.env.USERS_COLLECTION || "users";
    let user = await database.collection(adminCollection).findOne({$or:[{email:identity},{phone:identityRaw},{mobile:identityRaw}]});
    let matchedCollection = adminCollection;
    let role;

    if (user) {
      role = user.role || "admin";
    } else if (studentCollection !== adminCollection) {
      user = await database.collection(studentCollection).findOne({$or:[{email:identity},{phone:identityRaw},{mobile:identityRaw},{username:identity}]});
      matchedCollection = studentCollection;
      role = user?.role || user?.accountType || "student";
    }

    if (!user || !user.passwordHash || !user.passwordSalt) {
      return json(res,401,{ok:false,message:"بيانات الدخول غير صحيحة."});
    }
    const derived = await scrypt(password,user.passwordSalt,64);
    if (!safeEqual(derived.toString("hex"),user.passwordHash)) {
      return json(res,401,{ok:false,message:"بيانات الدخول غير صحيحة."});
    }
    if (user.isActive === false || user.active === false || ["blocked","deleted","محظور","محذوف"].includes(String(user.status || "").toLowerCase())) {
      return json(res,403,{ok:false,message:"هذا الحساب غير نشط. تواصل مع إدارة المنصة."});
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await database.collection("auth_sessions").insertOne({
      userId:user._id, authCollection:matchedCollection, tokenHash, role,
      createdAt:new Date(), expiresAt:new Date(Date.now()+7*86400000)
    });
    res.setHeader("Set-Cookie",`ali_admin_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);
    const adminRoles = new Set(["admin","super_admin","owner","administrator","مدير النظام","مدير","مسؤول"]);
    let redirect = adminRoles.has(String(role).trim().toLowerCase()) ? "admin.html" : "dashboard.html";
    if (redirect === "dashboard.html" && matchedCollection === adminCollection) {
      const rolesCollection = process.env.PLATFORM_ROLES_COLLECTION || "platform_roles";
      const savedRoles = await database.collection(rolesCollection).find({ isActive: { $ne: false } }).toArray();
      const hasAdminRole = savedRoles.some(item => String(item.roleName || "").trim().toLowerCase() === String(role).trim().toLowerCase());
      if (hasAdminRole) redirect = "admin-users.html";
    }
    return json(res,200,{ok:true,redirect});
  } catch(error) {
    console.error("auth login failed:",error.message);
    return json(res,500,{ok:false,message:"تعذر تسجيل الدخول حالياً. راجع إعدادات الخادم."});
  }
};

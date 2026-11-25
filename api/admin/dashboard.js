const crypto = require("crypto");
const { db, collectionName, json, method } = require("../_lib/auth");

const numberEnv = (name) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const count = (database, name, query = {}) =>
  database.collection(name).countDocuments(query);

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;

  try {
    const token = String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("ali_admin_session="))
      ?.slice("ali_admin_session=".length);

    if (!token) return json(res, 401, { ok: false, message: "يلزم تسجيل الدخول." });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const database = await db();
    const session = await database.collection("auth_sessions").findOne({
      tokenHash,
      expiresAt: { $gt: new Date() }
    });

    if (!session || !["admin", "super_admin", "owner"].includes(session.role)) {
      return json(res, 403, { ok: false, message: "ليس لديك صلاحية دخول لوحة الإدارة." });
    }

    const admin = await database.collection(collectionName()).findOne(
      { _id: session.userId },
      { projection: { name: 1, fullName: 1, email: 1, role: 1 } }
    );
    if (!admin) return json(res, 401, { ok: false, message: "الحساب غير موجود." });

    const collections = {
      users: process.env.USERS_COLLECTION || "users",
      courses: process.env.COURSES_COLLECTION || "courses",
      enrollments: process.env.ENROLLMENTS_COLLECTION || "enrollments",
      orders: process.env.ORDERS_COLLECTION || "orders",
      coupons: process.env.COUPONS_COLLECTION || "coupons",
      codes: process.env.ACCESS_CODES_COLLECTION || "access_codes"
    };

    const activeUserFilter = {
      $or: [
        { status: { $in: ["active", "نشط", "نشطة", "مفعل", "مفعّل"] } },
        { isActive: true },
        { active: true }
      ]
    };
    const activeEnrollmentFilter = {
      $or: [
        { status: { $in: ["active", "نشط", "نشطة", "approved", "مفعل", "مفعّل"] } },
        { isActive: true }
      ]
    };
    const endedEnrollmentFilter = {
      $or: [
        { status: { $in: ["expired", "completed", "ended", "منتهي", "مكتمل"] } },
        { isExpired: true }
      ]
    };
    const freeCourseFilter = { $or: [{ isFree: true }, { price: 0 }] };
    const paidCourseFilter = {
      $or: [
        { isFree: false, price: { $gt: 0 } },
        { price: { $gt: 0 } }
      ]
    };
    const activeCouponFilter = {
      $or: [
        { isActive: true },
        { status: { $in: ["active", "نشط", "نشطة", "مفعل", "مفعّل"] } }
      ]
    };
    const usedCodeFilter = {
      $or: [
        { isUsed: true },
        { used: true },
        { usedAt: { $exists: true, $ne: null } },
        { status: { $in: ["used", "مستخدم", "مستخدمة"] } }
      ]
    };

    const [
      totalUsers, activeUsers, activeSessions, totalAdmins,
      totalCourses, freeCourses, paidCourses,
      totalEnrollments, activeEnrollments, endedEnrollments,
      totalOrders, orderStatusRows,
      totalCoupons, activeCoupons, totalCodes, usedCodes
    ] = await Promise.all([
      count(database, collections.users),
      count(database, collections.users, activeUserFilter),
      count(database, "auth_sessions", { expiresAt: { $gt: new Date() } }),
      count(database, collectionName()),
      count(database, collections.courses),
      count(database, collections.courses, freeCourseFilter),
      count(database, collections.courses, paidCourseFilter),
      count(database, collections.enrollments),
      count(database, collections.enrollments, activeEnrollmentFilter),
      count(database, collections.enrollments, endedEnrollmentFilter),
      count(database, collections.orders),
      database.collection(collections.orders).aggregate([
        { $group: { _id: "$status", total: { $sum: 1 } } }
      ]).toArray(),
      count(database, collections.coupons),
      count(database, collections.coupons, activeCouponFilter),
      count(database, collections.codes),
      count(database, collections.codes, usedCodeFilter)
    ]);

    const orderStatuses = {
      free: 0, paid: 0, pending: 0, failed: 0, cancelled: 0, other: 0
    };
    for (const row of orderStatusRows) {
      const value = String(row._id || "").trim().toLowerCase();
      let key = "other";
      if (["free", "مجاني", "مجانية"].includes(value)) key = "free";
      else if (["paid", "completed", "success", "successful", "مدفوع", "مكتمل", "ناجح"].includes(value)) key = "paid";
      else if (["pending", "waiting", "معلق", "قيد الانتظار", "قيد المراجعة"].includes(value)) key = "pending";
      else if (["failed", "فاشل", "فشل"].includes(value)) key = "failed";
      else if (["cancelled", "canceled", "ملغي", "ملغى"].includes(value)) key = "cancelled";
      orderStatuses[key] += row.total;
    }

    const userLimit = numberEnv("PLATFORM_MAX_USERS");
    const storageUsed = numberEnv("PLATFORM_STORAGE_USED_GB");
    const storageLimit = numberEnv("PLATFORM_STORAGE_LIMIT_GB");
    const appUrl = process.env.APP_URL || "";
    const siteName = appUrl ? new URL(appUrl).host : "";

    return json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      admin: {
        name: admin.fullName || admin.name || admin.email || "مدير النظام",
        email: admin.email || "",
        role: admin.role || session.role
      },
      site: { url: appUrl, name: siteName },
      plan: {
        name: process.env.PLATFORM_PLAN_NAME || null,
        renewDate: process.env.PLATFORM_PLAN_RENEW_DATE || null,
        users: { used: totalUsers, limit: userLimit },
        storage: { used: storageUsed, limit: storageLimit }
      },
      people: {
        users: { total: totalUsers, active: activeUsers, sessions: activeSessions },
        admins: { total: totalAdmins }
      },
      business: {
        courses: { total: totalCourses, free: freeCourses, paid: paidCourses },
        enrollments: { total: totalEnrollments, active: activeEnrollments, ended: endedEnrollments },
        orders: { total: totalOrders, statuses: orderStatuses }
      },
      promo: {
        coupons: { total: totalCoupons, active: activeCoupons },
        codes: { total: totalCodes, used: usedCodes }
      }
    });
  } catch (error) {
    console.error("admin dashboard data failed:", error.message);
    return json(res, 500, {
      ok: false,
      message: "تعذر تحميل إحصائيات لوحة الإدارة. تحقق من متغيرات البيئة وأسماء المجموعات في MongoDB."
    });
  }
};

const crypto = require("crypto");
const { db, collectionName, json, method } = require("../_lib/auth");

const numberEnv = (name) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

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
    const allowedRoles = ["admin", "super_admin", "owner", "administrator", "مدير النظام", "مدير", "مسؤول"];
    if (!session || !allowedRoles.includes(session.role)) {
      return json(res, 403, { ok: false, message: "ليس لديك صلاحية دخول لوحة الإدارة." });
    }

    const admin = await database.collection(collectionName()).findOne(
      { _id: session.userId },
      { projection: { name: 1, fullName: 1, email: 1, role: 1 } }
    );
    if (!admin) return json(res, 401, { ok: false, message: "الحساب غير موجود." });

    const collections = {
      admins: collectionName(),
      sessions: "auth_sessions",
      users: process.env.USERS_COLLECTION || "users",
      courses: process.env.COURSES_COLLECTION || "courses",
      enrollments: process.env.ENROLLMENTS_COLLECTION || "enrollments",
      orders: process.env.ORDERS_COLLECTION || "orders",
      coupons: process.env.COUPONS_COLLECTION || "coupons",
      codes: process.env.ACCESS_CODES_COLLECTION || "access_codes"
    };

    const existingRows = await database.listCollections(
      { name: { $in: [...new Set(Object.values(collections))] } },
      { nameOnly: true }
    ).toArray();
    const existing = new Set(existingRows.map((row) => row.name));
    const count = (name, query = {}) => existing.has(name)
      ? database.collection(name).countDocuments(query)
      : Promise.resolve(null);

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
    const paidCourseFilter = { price: { $gt: 0 } };
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
      count(collections.users),
      count(collections.users, activeUserFilter),
      count(collections.sessions, { expiresAt: { $gt: new Date() } }),
      count(collections.admins),
      count(collections.courses),
      count(collections.courses, freeCourseFilter),
      count(collections.courses, paidCourseFilter),
      count(collections.enrollments),
      count(collections.enrollments, activeEnrollmentFilter),
      count(collections.enrollments, endedEnrollmentFilter),
      count(collections.orders),
      existing.has(collections.orders)
        ? database.collection(collections.orders).aggregate([
            { $group: { _id: "$status", total: { $sum: 1 } } }
          ]).toArray()
        : Promise.resolve([]),
      count(collections.coupons),
      count(collections.coupons, activeCouponFilter),
      count(collections.codes),
      count(collections.codes, usedCodeFilter)
    ]);

    const orderStatuses = {
      free: existing.has(collections.orders) ? 0 : null,
      paid: existing.has(collections.orders) ? 0 : null,
      pending: existing.has(collections.orders) ? 0 : null,
      failed: existing.has(collections.orders) ? 0 : null,
      cancelled: existing.has(collections.orders) ? 0 : null,
      other: existing.has(collections.orders) ? 0 : null
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

    const missingCollections = Object.entries(collections)
      .filter(([, name]) => !existing.has(name))
      .map(([key, name]) => ({ key, name }));

    const appUrl = process.env.APP_URL || "";
    let siteName = "";
    if (appUrl) {
      try { siteName = new URL(appUrl).host; }
      catch { throw new Error("APP_URL must be a full URL including https://"); }
    }

    return json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      missingCollections,
      admin: {
        name: admin.fullName || admin.name || admin.email || "مدير النظام",
        email: admin.email || "",
        role: admin.role || session.role
      },
      site: { url: appUrl, name: siteName },
      plan: {
        name: process.env.PLATFORM_PLAN_NAME || null,
        renewDate: process.env.PLATFORM_PLAN_RENEW_DATE || null,
        users: { used: totalUsers, limit: numberEnv("PLATFORM_MAX_USERS") },
        storage: {
          used: numberEnv("PLATFORM_STORAGE_USED_GB"),
          limit: numberEnv("PLATFORM_STORAGE_LIMIT_GB")
        }
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

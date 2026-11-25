const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const { db, collectionName } = require("./auth");

const ADMIN_ROLES = new Set(["admin", "super_admin", "owner", "administrator", "مدير النظام", "مدير", "مسؤول"]);

async function requireAdmin(req) {
  const token = String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ali_admin_session="))
    ?.slice("ali_admin_session=".length);
  if (!token) return { ok: false, status: 401, message: "يلزم تسجيل الدخول." };

  const database = await db();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await database.collection("auth_sessions").findOne({
    tokenHash,
    expiresAt: { $gt: new Date() }
  });
  if (!session || !ADMIN_ROLES.has(session.role)) {
    return { ok: false, status: 403, message: "ليس لديك صلاحية تنفيذ هذا الإجراء." };
  }

  const admin = await database.collection(collectionName()).findOne(
    { _id: session.userId },
    { projection: { name: 1, fullName: 1, email: 1, role: 1 } }
  );
  if (!admin) return { ok: false, status: 401, message: "حساب المسؤول غير موجود." };
  return { ok: true, database, admin, session };
}

function parseMongoId(value) {
  const id = String(value || "");
  if (/^[a-fA-F0-9]{24}$/.test(id)) return new ObjectId(id);
  return id;
}

module.exports = { requireAdmin, parseMongoId };

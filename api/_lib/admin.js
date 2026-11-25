const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const { db, collectionName } = require("./auth");

const ADMIN_ROLES = new Set([
  "admin", "super_admin", "owner", "administrator",
  "مدير النظام", "مدير", "مسؤول"
]);

function normalizeRole(value) {
  return String(value || "").trim().toLocaleLowerCase("ar");
}

function roleAllows(roleRecord, permission) {
  if (!roleRecord || roleRecord.isActive === false) return false;
  if (roleRecord.allPermissions === true) return true;
  if (!permission) return false;

  const sections = Array.isArray(roleRecord.sections) ? roleRecord.sections : [];
  const section = sections.find(item => item.title === permission.section);
  if (!section) return false;
  const items = Array.isArray(section.items) ? section.items : [];

  if (permission.module) {
    const item = items.find(entry => entry.module === permission.module);
    return Boolean(item && Array.isArray(item.actions) && item.actions.includes(permission.action));
  }

  return items.some(item =>
    Array.isArray(item.actions) &&
    item.actions.includes(permission.action) &&
    (!permission.modules || permission.modules.includes(item.module))
  );
}

async function requireAdmin(req, permission = null) {
  const token = String(req.headers.cookie || "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith("ali_admin_session="))
    ?.slice("ali_admin_session=".length);
  if (!token) return { ok: false, status: 401, message: "يلزم تسجيل الدخول." };

  const database = await db();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await database.collection("auth_sessions").findOne({
    tokenHash,
    expiresAt: { $gt: new Date() }
  });
  if (!session) return { ok: false, status: 401, message: "انتهت جلسة الدخول. سجل الدخول مرة أخرى." };

  const adminCollection = session.authCollection || collectionName();
  const admin = await database.collection(adminCollection).findOne(
    { _id: session.userId },
    { projection: { name: 1, fullName: 1, firstName: 1, lastName: 1, email: 1, role: 1, isOwner: 1, status: 1, isActive: 1 } }
  );
  if (!admin) return { ok: false, status: 401, message: "حساب المسؤول غير موجود." };

  const roleName = String(admin.role || session.role || "");
  const normalizedRole = normalizeRole(roleName);
  const builtInAdmin = ADMIN_ROLES.has(normalizedRole);
  const isActive = admin.isActive !== false && admin.active !== false &&
    !["blocked", "disabled", "deleted", "محظور", "غير نشط", "محذوف"].includes(normalizedRole) &&
    !["blocked", "disabled", "deleted", "محظور", "غير نشط", "محذوف"].includes(normalizeRole(admin.status));

  if (!isActive) return { ok: false, status: 403, message: "هذا الحساب غير نشط." };
  if (!builtInAdmin) {
    if (!permission) return { ok: false, status: 403, message: "ليس لديك صلاحية تنفيذ هذا الإجراء." };
    const rolesCollection = process.env.PLATFORM_ROLES_COLLECTION || "platform_roles";
    const allRoles = await database.collection(rolesCollection).find({}).toArray();
    const roleRecord = allRoles.find(item => normalizeRole(item.roleName) === normalizedRole);
    if (!roleAllows(roleRecord, permission)) {
      return { ok: false, status: 403, message: "ليس لديك الصلاحية المطلوبة لتنفيذ هذا الإجراء." };
    }
  }

  return { ok: true, database, admin, session, roleName, builtInAdmin };
}

function parseMongoId(value) {
  const id = String(value || "");
  if (/^[a-fA-F0-9]{24}$/.test(id)) return new ObjectId(id);
  return id;
}

module.exports = { requireAdmin, parseMongoId, ADMIN_ROLES, roleAllows, normalizeRole };

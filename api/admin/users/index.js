const crypto = require("crypto");
const {
  json,
  db: getDatabase,
  collectionName,
  hashPassword
} = require("../../_lib/auth");
const {
  requireAdmin,
  parseMongoId,
  roleAllows,
  normalizeRole
} = require("../../_lib/admin");

const ROLES_COLLECTION = process.env.PLATFORM_ROLES_COLLECTION || "platform_roles";
const USERS_COLLECTION = process.env.USERS_COLLECTION || "users";
const ENROLLMENTS_COLLECTION = process.env.ENROLLMENTS_COLLECTION || "enrollments";
const MAX_LIST = 2000;

const SUPERVISOR_SECTIONS = [
  {
    title: "إدارة المؤسسة",
    items: [
      { module: "لوحة التحكم", actions: ["عرض"] },
      { module: "إعدادات المؤسسة", actions: ["عرض"] }
    ]
  },
  {
    title: "الرسائل والإشعارات",
    items: [
      { module: "رسائل التواصل", actions: ["عرض", "إنشاء", "تعديل", "حذف"] },
      { module: "الإشعارات", actions: ["عرض", "إنشاء", "تعديل", "حذف"] }
    ]
  },
  {
    title: "صلاحيات المستخدمين",
    items: [
      { module: "الملف الشخصي", actions: ["عرض", "إنشاء", "تعديل"] },
      { module: "المشرفون", actions: ["عرض", "إنشاء", "تعديل"] },
      { module: "الطلاب", actions: ["عرض", "إنشاء", "تعديل", "حذف"] },
      { module: "الأدوار والصلاحيات", actions: ["عرض"] }
    ]
  },
  {
    title: "الهيكل الأكاديمي",
    items: [
      { module: "فئات السنوات الدراسية", actions: ["عرض", "إنشاء", "تعديل", "حذف"] },
      { module: "السنوات الدراسية", actions: ["عرض", "إنشاء", "تعديل", "حذف"] },
      { module: "المواد", actions: ["عرض", "إنشاء", "تعديل", "حذف"] }
    ]
  },
  {
    title: "إدارة المحتوى",
    items: [
      { module: "الكورسات ومحتواها", actions: ["عرض", "إنشاء"] },
      { module: "الجلسات المباشرة", actions: ["عرض", "إنشاء", "تعديل", "حذف"] }
    ]
  },
  {
    title: "محتوى الموقع",
    items: [{ module: "مميزات المؤسسة", actions: ["عرض"] }]
  },
  {
    title: "المدونة",
    items: [
      { module: "المدونات", actions: ["عرض", "إنشاء"] },
      { module: "تصنيفات المدونات", actions: ["عرض", "إنشاء"] }
    ]
  },
  {
    title: "المكتبة",
    items: [
      { module: "منتجات المكتبة", actions: ["عرض", "إنشاء"] },
      { module: "طلبات المكتبة", actions: ["عرض", "إنشاء"] }
    ]
  }
];

const DEFAULT_ROLES = [
  {
    roleName: "مشرف",
    badge: null,
    permissionsCount: 48,
    allPermissions: false,
    sections: SUPERVISOR_SECTIONS,
    createdAt: new Date("2026-08-04T00:00:00.000Z")
  },
  {
    roleName: "Administrator",
    badge: "افتراضي",
    permissionsCount: 160,
    allPermissions: true,
    sections: [
      {
        title: "إدارة المؤسسة",
        items: [
          { module: "لوحة التحكم", actions: ["عرض", "إنشاء", "تعديل", "حذف"] },
          { module: "إعدادات المؤسسة", actions: ["عرض", "إنشاء", "تعديل", "حذف"] }
        ]
      },
      {
        title: "صلاحيات المستخدمين",
        items: [
          { module: "المشرفون", actions: ["عرض", "إنشاء", "تعديل", "حذف"] },
          { module: "الطلاب", actions: ["عرض", "إنشاء", "تعديل", "حذف"] },
          { module: "الأدوار والصلاحيات", actions: ["عرض", "إنشاء", "تعديل", "حذف"] }
        ]
      }
    ],
    createdAt: new Date("2026-07-24T00:00:00.000Z")
  }
];

const SAFE_ADMIN_PROJECTION = {
  firstName: 1, lastName: 1, fullName: 1, name: 1,
  email: 1, phone: 1, mobile: 1, role: 1,
  status: 1, isActive: 1, active: 1, isOwner: 1,
  createdAt: 1, updatedAt: 1
};

const SAFE_STUDENT_PROJECTION = {
  firstName: 1, lastName: 1, fullName: 1, name: 1,
  email: 1, phone: 1, mobile: 1, username: 1,
  parentPhone: 1, guardianPhone: 1,
  code: 1, studentCode: 1, role: 1, accountType: 1,
  status: 1, isActive: 1, active: 1,
  category: 1, gradeCategory: 1, year: 1, schoolYear: 1,
  governorate: 1, city: 1, track: 1,
  device: 1, deviceName: 1, deviceInfo: 1, deviceId: 1,
  subscriptionStatus: 1, isSubscribed: 1, hasActiveSubscription: 1,
  createdAt: 1, updatedAt: 1, lastLoginAt: 1
};

function text(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function emailValue(value) {
  const email = text(value, 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("أدخل بريداً إلكترونياً صحيحاً.");
  }
  return email;
}

function isOwnerRecord(record, reqEmail = "") {
  const ownerEmail = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const ownerId = String(process.env.OWNER_ADMIN_ID || "").trim();
  return record?.isOwner === true ||
    ["admin", "owner", "super_admin", "مدير النظام", "مالك"].includes(normalizeRole(record?.role)) ||
    Boolean(ownerEmail && String(record?.email || "").toLowerCase() === ownerEmail) ||
    Boolean(ownerId && String(record?._id || "") === ownerId);
}

function hasElevatedAdminRole(record) {
  return ["admin", "owner", "super_admin", "administrator", "مدير النظام", "مدير", "مسؤول"].includes(normalizeRole(record?.role));
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function publicAdmin(record, actorId, actorIsCoreAdmin) {
  const firstName = text(record.firstName || "");
  const lastName = text(record.lastName || "");
  const fullName = text(record.fullName || record.name || [firstName, lastName].filter(Boolean).join(" "));
  const owner = isOwnerRecord(record) || String(record._id) === String(actorId) || (!actorIsCoreAdmin && hasElevatedAdminRole(record));
  const statusActive = record.isActive !== false && record.active !== false &&
    !["blocked", "disabled", "inactive", "deleted", "محظور", "غير نشط", "غير فعال", "محذوف"].includes(normalizeRole(record.status));
  return {
    id: String(record._id),
    firstName: firstName || fullName.split(/\s+/)[0] || "",
    lastName: lastName || fullName.split(/\s+/).slice(1).join(" "),
    fullName,
    badge: owner ? "مالك" : null,
    isProtected: owner,
    phone: text(record.phone || record.mobile || "", 40),
    email: text(record.email || "", 254),
    role: text(record.role || "مشرف", 80),
    status: statusActive ? "نشط" : "غير نشط",
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
}

function subscriptionState(record, enrollmentIds) {
  if (record.hasActiveSubscription === true || record.isSubscribed === true) return "مشترك";
  if (record.hasActiveSubscription === false || record.isSubscribed === false) return "غير مشترك";
  const status = normalizeRole(record.subscriptionStatus);
  if (["active", "paid", "مشترك", "نشط", "مدفوع"].includes(status)) return "مشترك";
  if (["inactive", "expired", "unpaid", "غير مشترك", "منتهي", "غير نشط"].includes(status)) return "غير مشترك";
  return enrollmentIds.has(String(record._id)) ? "مشترك" : "غير محدد";
}

function publicStudent(record, activeEnrollmentIds) {
  const firstName = text(record.firstName || "");
  const lastName = text(record.lastName || "");
  const name = text(record.fullName || record.name || [firstName, lastName].filter(Boolean).join(" "));
  const active = record.isActive !== false && record.active !== false &&
    !["blocked", "disabled", "deleted", "محظور", "محذوف", "غير نشط"].includes(normalizeRole(record.status));
  return {
    id: String(record._id),
    firstName: firstName || name.split(/\s+/)[0] || "",
    lastName: lastName || name.split(/\s+/).slice(1).join(" "),
    name,
    code: text(record.code || record.studentCode || "", 40),
    contact: text(record.email || record.phone || record.mobile || record.username || "", 254),
    email: text(record.email || "", 254),
    phone: text(record.phone || record.mobile || "", 40),
    parentPhone: text(record.parentPhone || record.guardianPhone || "", 40),
    device: text(record.deviceName || record.device || record.deviceInfo || "", 100) || "غير مسجل",
    status: active ? "نشط" : "غير نشط",
    category: text(record.gradeCategory || record.category || "", 140),
    year: text(record.schoolYear || record.year || "", 140),
    governorate: text(record.governorate || "", 80),
    city: text(record.city || "", 100),
    track: text(record.track || "", 100),
    subscription: subscriptionState(record, activeEnrollmentIds),
    createdAt: record.createdAt || null,
    lastLoginAt: record.lastLoginAt || null
  };
}

function ownerEmailConflict(email) {
  const ownerEmail = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  return Boolean(ownerEmail && email === ownerEmail);
}

async function ensureDefaultRoles(database) {
  const roles = database.collection(ROLES_COLLECTION);
  for (const role of DEFAULT_ROLES) {
    await roles.updateOne(
      { roleName: role.roleName },
      { $setOnInsert: { ...role, isActive: true } },
      { upsert: true }
    );
  }
  return roles.find({ isActive: { $ne: false } }).sort({ createdAt: 1 }).toArray();
}

async function roleCapabilities(database, roleName, builtInAdmin) {
  if (builtInAdmin) return {
    admins: true, students: true, roles: true,
    adminCreate: true, adminEdit: true,
    studentCreate: true, studentEdit: true, studentDelete: true,
    academic: true, courses: true, courseCreate: true, courseEdit: true, courseDelete: true
  };
  const roles = await ensureDefaultRoles(database);
  const role = roles.find(item => normalizeRole(item.roleName) === normalizeRole(roleName));
  const allowed = (module, action) => roleAllows(role, {
    section: "صلاحيات المستخدمين", module, action
  });
  return {
    admins: allowed("المشرفون", "عرض"),
    students: allowed("الطلاب", "عرض"),
    roles: allowed("الأدوار والصلاحيات", "عرض"),
    adminCreate: allowed("المشرفون", "إنشاء"),
    adminEdit: allowed("المشرفون", "تعديل"),
    studentCreate: allowed("الطلاب", "إنشاء"),
    studentEdit: allowed("الطلاب", "تعديل"),
    studentDelete: allowed("الطلاب", "حذف"),
    academic: roleAllows(role, { section: "الهيكل الأكاديمي", modules: ["فئات السنوات الدراسية", "السنوات الدراسية", "المواد"], action: "عرض" }),
    courses: roleAllows(role, { section: "إدارة المحتوى", module: "الكورسات ومحتواها", action: "عرض" }),
    courseCreate: roleAllows(role, { section: "إدارة المحتوى", module: "الكورسات ومحتواها", action: "إنشاء" }),
    courseEdit: roleAllows(role, { section: "إدارة المحتوى", module: "الكورسات ومحتواها", action: "تعديل" }),
    courseDelete: roleAllows(role, { section: "إدارة المحتوى", module: "الكورسات ومحتواها", action: "حذف" })
  };
}

async function requireModulePermission(req, module, action) {
  return requireAdmin(req, {
    section: "صلاحيات المستخدمين",
    module,
    action
  });
}

async function audit(database, actorId, action, targetId, details = {}) {
  try {
    await database.collection("admin_audit_logs").insertOne({
      action,
      targetUserId: targetId || null,
      adminId: actorId,
      details,
      createdAt: new Date()
    });
  } catch (error) {
    console.error("user management audit log failed:", error.message);
  }
}

async function duplicateField(collection, field, value, excludeId = null) {
  if (!value) return false;
  const query = { [field]: { $regex: "^" + value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&") + "$", $options: "i" } };
  if (excludeId) query._id = { $ne: excludeId };
  return Boolean(await collection.findOne(query, { projection: { _id: 1 } }));
}

async function nextStudentCode(users) {
  const existing = await users.find({}, { projection: { code: 1, studentCode: 1 } }).toArray();
  let max = 1364;
  for (const record of existing) {
    const value = String(record.code || record.studentCode || "");
    if (/^\d{1,12}$/.test(value)) max = Math.max(max, Number(value));
  }
  return String(max + 1);
}

async function validateAcademicSelection(database, category, year) {
  const categoryValue = text(category, 140);
  const yearValue = text(year, 140);
  if (!categoryValue && !yearValue) return;
  const collection = process.env.ACADEMIC_STRUCTURE_COLLECTION || "academic_structure";
  const structure = await database.collection(collection).findOne(
    { _id: "main" },
    { projection: { categories: 1, years: 1 } }
  );
  if (!structure) return;
  const categories = Array.isArray(structure.categories) ? structure.categories : [];
  const years = Array.isArray(structure.years) ? structure.years : [];
  if (categoryValue && categories.length && !categories.some(item => item.name === categoryValue)) {
    throw new Error("فئة السنة الدراسية المحددة غير موجودة في الهيكل الأكاديمي.");
  }
  if (yearValue && years.length && !years.some(item =>
    item.name === yearValue && (!categoryValue || item.category === categoryValue)
  )) {
    throw new Error("السنة الدراسية المحددة لا تتبع الفئة المختارة.");
  }
}

async function findStudent(users, id) {
  const parsed = parseMongoId(id);
  return users.findOne({ $or: [{ _id: parsed }, { _id: String(id) }] });
}

async function writeStudent(database, auth, action, payload) {
  const users = database.collection(USERS_COLLECTION);
  const studentId = text(payload.studentId || payload.id, 100);
  const now = new Date();

  if (action === "createStudent") {
    const firstName = text(payload.firstName, 80);
    const lastName = text(payload.lastName, 100);
    const email = emailValue(payload.email);
    const phone = text(payload.phone, 40);
    const password = String(payload.password || "");
    if (firstName.length < 2 || lastName.length < 2) throw new Error("أدخل الاسم الأول والاسم الأخير بشكل صحيح.");
    if (!email && !phone) throw new Error("أدخل البريد الإلكتروني أو رقم الهاتف على الأقل.");
    if (password.length < 8 || password.length > 200) throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف.");
    if (await duplicateField(users, "email", email)) throw new Error("البريد الإلكتروني مستخدم بالفعل.");
    if (phone && (await duplicateField(users, "phone", phone) || await duplicateField(users, "mobile", phone))) throw new Error("رقم الهاتف مستخدم بالفعل.");

    await validateAcademicSelection(database, payload.category, payload.year);
    const code = text(payload.code, 40) || await nextStudentCode(users);
    if (await duplicateField(users, "code", code) || await duplicateField(users, "studentCode", code)) throw new Error("كود الطالب مستخدم بالفعل.");
    const credentials = await hashPassword(password);
    const isActive = payload.isActive !== false;
    const document = {
      firstName, lastName, fullName: firstName + " " + lastName,
      name: firstName + " " + lastName,
      email, phone,
      parentPhone: text(payload.parentPhone, 40),
      code, studentCode: code,
      role: "student", accountType: "student",
      category: text(payload.category, 140),
      gradeCategory: text(payload.category, 140),
      year: text(payload.year, 140),
      schoolYear: text(payload.year, 140),
      governorate: text(payload.governorate, 80),
      city: text(payload.city, 100),
      track: text(payload.track, 100),
      status: isActive ? "نشط" : "غير نشط",
      isActive, active: isActive,
      ...credentials,
      createdAt: now, updatedAt: now
    };
    const inserted = await users.insertOne(document);
    await audit(database, auth.admin._id, "student_created", inserted.insertedId, { code });
    return { message: "تم إضافة الطالب بنجاح.", id: String(inserted.insertedId) };
  }

  const student = await findStudent(users, studentId);
  if (!student || student.deletedAt || normalizeRole(student.status) === "deleted") {
    throw new Error("لم يتم العثور على الطالب.");
  }

  if (action === "updateStudent") {
    const firstName = text(payload.firstName, 80);
    const lastName = text(payload.lastName, 100);
    const email = emailValue(payload.email);
    const phone = text(payload.phone, 40);
    if (firstName.length < 2 || lastName.length < 2) throw new Error("أدخل الاسم الأول والاسم الأخير بشكل صحيح.");
    if (!email && !phone) throw new Error("أدخل البريد الإلكتروني أو رقم الهاتف على الأقل.");
    if (await duplicateField(users, "email", email, student._id)) throw new Error("البريد الإلكتروني مستخدم بالفعل.");
    if (phone && (await duplicateField(users, "phone", phone, student._id) || await duplicateField(users, "mobile", phone, student._id))) throw new Error("رقم الهاتف مستخدم بالفعل.");

    const code = text(payload.code || student.code || student.studentCode, 40);
    if (code && (await duplicateField(users, "code", code, student._id) || await duplicateField(users, "studentCode", code, student._id))) throw new Error("كود الطالب مستخدم بالفعل.");
    await validateAcademicSelection(database, payload.category, payload.year);
    const isActive = payload.isActive !== false;
    await users.updateOne({ _id: student._id }, {
      $set: {
        firstName, lastName, fullName: firstName + " " + lastName, name: firstName + " " + lastName,
        email, phone, mobile: phone,
        parentPhone: text(payload.parentPhone, 40),
        code, studentCode: code,
        category: text(payload.category, 140), gradeCategory: text(payload.category, 140),
        year: text(payload.year, 140), schoolYear: text(payload.year, 140),
        governorate: text(payload.governorate, 80), city: text(payload.city, 100),
        track: text(payload.track, 100),
        status: isActive ? "نشط" : "غير نشط",
        isActive, active: isActive, updatedAt: now
      }
    });
    await audit(database, auth.admin._id, "student_updated", student._id, { code });
    return { message: "تم تحديث بيانات الطالب بنجاح." };
  }

  if (action === "deleteStudent") {
    await users.updateOne({ _id: student._id }, {
      $set: { status: "deleted", isActive: false, active: false, deletedAt: now, deletedBy: auth.admin._id, updatedAt: now }
    });
    await database.collection("auth_sessions").deleteMany({ userId: student._id });
    await audit(database, auth.admin._id, "student_soft_deleted", student._id, { code: student.code || student.studentCode || "" });
    return { message: "تم حذف الطالب من القائمة وتعطيل حسابه." };
  }

  if (action === "toggleStudent") {
    const active = payload.isActive === true;
    await users.updateOne({ _id: student._id }, {
      $set: { status: active ? "نشط" : "غير نشط", isActive: active, active, updatedAt: now }
    });
    if (!active) await database.collection("auth_sessions").deleteMany({ userId: student._id });
    await audit(database, auth.admin._id, active ? "student_activated" : "student_deactivated", student._id);
    return { message: active ? "تم تفعيل حساب الطالب." : "تم إيقاف حساب الطالب." };
  }

  if (action === "resetStudentPassword") {
    const password = String(payload.password || "");
    if (password.length < 8 || password.length > 200) throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف.");
    const credentials = await hashPassword(password);
    await users.updateOne({ _id: student._id }, {
      $set: { ...credentials, passwordUpdatedAt: now, updatedAt: now }
    });
    await database.collection("auth_sessions").deleteMany({ userId: student._id });
    await audit(database, auth.admin._id, "student_password_reset", student._id);
    return { message: "تم تغيير كلمة المرور وإلغاء جلسات الطالب السابقة." };
  }

  if (action === "resetStudentDevice") {
    await users.updateOne({ _id: student._id }, {
      $unset: {
        device: "", deviceName: "", deviceInfo: "", deviceId: "",
        deviceFingerprint: "", registeredDevice: "", lastDevice: "",
        deviceSessionId: ""
      },
      $set: { deviceResetAt: now, deviceResetBy: auth.admin._id, updatedAt: now }
    });
    await database.collection("auth_sessions").deleteMany({ userId: student._id });
    await audit(database, auth.admin._id, "student_device_reset", student._id);
    return { message: "تمت إعادة تعيين الجهاز وإلغاء جلسات الطالب السابقة." };
  }

  throw new Error("الإجراء المطلوب غير معروف.");
}

async function writeAdmin(database, auth, action, payload) {
  const admins = database.collection(auth.session.authCollection || collectionName());
  const now = new Date();

  if (action === "createAdmin") {
    const firstName = text(payload.firstName, 80);
    const lastName = text(payload.lastName, 100);
    const email = emailValue(payload.email);
    const phone = text(payload.phone, 40);
    const password = String(payload.password || "");
    const role = text(payload.role || "مشرف", 80);
    if (firstName.length < 2 || lastName.length < 2) throw new Error("أدخل الاسم الأول والاسم الأخير بشكل صحيح.");
    if (!email) throw new Error("البريد الإلكتروني مطلوب.");
    if (ownerEmailConflict(email)) throw new Error("لا يمكن استخدام بريد مالك المنصة لإنشاء مشرف.");
    if (password.length < 8 || password.length > 200) throw new Error("كلمة المرور يجب ألا تقل عن 8 أحرف.");
    const roles = await ensureDefaultRoles(database);
    const roleRecord = roles.find(item => normalizeRole(item.roleName) === normalizeRole(role));
    if (!roleRecord) throw new Error("الدور المحدد غير موجود.");
    if (roleRecord.allPermissions && !auth.builtInAdmin) throw new Error("لا تملك صلاحية إسناد دور مدير النظام.");
    if (await duplicateField(admins, "email", email)) throw new Error("البريد الإلكتروني مستخدم بالفعل.");
    if (phone && (await duplicateField(admins, "phone", phone) || await duplicateField(admins, "mobile", phone))) throw new Error("رقم الهاتف مستخدم بالفعل.");

    const credentials = await hashPassword(password);
    const document = {
      firstName, lastName, fullName: firstName + " " + lastName,
      name: firstName + " " + lastName,
      email, phone, mobile: phone,
      role, status: "نشط", isActive: true, active: true,
      isOwner: false, createdAt: now, updatedAt: now,
      ...credentials
    };
    const inserted = await admins.insertOne(document);
    await audit(database, auth.admin._id, "admin_created", inserted.insertedId, { role });
    return { message: "تم إضافة المشرف بنجاح." };
  }

  const adminId = text(payload.adminId || payload.id, 100);
  const parsedId = parseMongoId(adminId);
  const target = await admins.findOne({ $or: [{ _id: parsedId }, { _id: adminId }] });
  if (!target) throw new Error("لم يتم العثور على المشرف.");
  if (String(target._id) === String(auth.session.userId)) {
    throw new Error("لا يمكن تعديل حسابك الحالي من صفحة إدارة المشرفين. استخدم صفحة الملف الشخصي.");
  }
  if (isOwnerRecord(target) || (!auth.builtInAdmin && hasElevatedAdminRole(target))) {
    throw new Error("هذا حساب مالك أو مدير بصلاحيات مرتفعة ولا يمكن تعديله من هذا الحساب.");
  }

  if (action === "updateAdmin") {
    const firstName = text(payload.firstName, 80);
    const lastName = text(payload.lastName, 100);
    const email = emailValue(payload.email);
    const phone = text(payload.phone, 40);
    const role = text(payload.role || target.role || "مشرف", 80);
    if (firstName.length < 2 || lastName.length < 2) throw new Error("أدخل الاسم الأول والاسم الأخير بشكل صحيح.");
    if (!email) throw new Error("البريد الإلكتروني مطلوب.");
    if (ownerEmailConflict(email)) throw new Error("لا يمكن استخدام بريد مالك المنصة لحساب مشرف.");
    const roles = await ensureDefaultRoles(database);
    const roleRecord = roles.find(item => normalizeRole(item.roleName) === normalizeRole(role));
    if (!roleRecord) throw new Error("الدور المحدد غير موجود.");
    if (roleRecord.allPermissions && !auth.builtInAdmin) throw new Error("لا تملك صلاحية إسناد دور مدير النظام.");
    if (await duplicateField(admins, "email", email, target._id)) throw new Error("البريد الإلكتروني مستخدم بالفعل.");
    if (phone && (await duplicateField(admins, "phone", phone, target._id) || await duplicateField(admins, "mobile", phone, target._id))) throw new Error("رقم الهاتف مستخدم بالفعل.");

    const active = payload.status === "نشط";
    await admins.updateOne({ _id: target._id }, {
      $set: {
        firstName, lastName, fullName: firstName + " " + lastName, name: firstName + " " + lastName,
        email, phone, mobile: phone, role,
        status: active ? "نشط" : "غير نشط",
        isActive: active, active, updatedAt: now
      }
    });
    if (!active || normalizeRole(role) !== normalizeRole(target.role)) {
      await database.collection("auth_sessions").deleteMany({ userId: target._id });
    }
    await audit(database, auth.admin._id, "admin_updated", target._id, { role, active });
    return { message: "تم تحديث بيانات المشرف بنجاح." };
  }

  throw new Error("الإجراء المطلوب غير معروف.");
}

async function loadData(auth, capabilities) {
  const database = auth.database;
  const [adminDocs, studentDocs, roles] = await Promise.all([
    capabilities.admins
      ? database.collection(auth.session.authCollection || collectionName()).find(
          { deletedAt: { $exists: false } },
          { projection: SAFE_ADMIN_PROJECTION }
        ).sort({ createdAt: -1 }).limit(MAX_LIST).toArray()
      : Promise.resolve([]),
    capabilities.students
      ? database.collection(USERS_COLLECTION).find(
          { deletedAt: { $exists: false }, status: { $nin: ["deleted", "محذوف"] } },
          { projection: SAFE_STUDENT_PROJECTION }
        ).sort({ createdAt: -1 }).limit(MAX_LIST).toArray()
      : Promise.resolve([]),
    (capabilities.roles || capabilities.adminCreate || capabilities.adminEdit) ? ensureDefaultRoles(database) : Promise.resolve([])
  ]);

  const enrollmentIds = new Set();
  if (studentDocs.length) {
    const collectionExists = await database.listCollections({ name: ENROLLMENTS_COLLECTION }, { nameOnly: true }).hasNext();
    if (collectionExists) {
      const ids = studentDocs.map(item => item._id);
      const idStrings = ids.map(String);
      const enrollments = await database.collection(ENROLLMENTS_COLLECTION).find({
        status: { $in: ["active", "paid", "نشط", "مشترك", "مفعل", "مفعّل"] },
        $or: [
          { userId: { $in: ids } }, { studentId: { $in: ids } },
          { userId: { $in: idStrings } }, { studentId: { $in: idStrings } }
        ]
      }, { projection: { userId: 1, studentId: 1 } }).limit(5000).toArray();
      for (const enrollment of enrollments) {
        if (enrollment.userId) enrollmentIds.add(String(enrollment.userId));
        if (enrollment.studentId) enrollmentIds.add(String(enrollment.studentId));
      }
    }
  }

  let academic = { categories: [], years: [] };
  const academicCollection = process.env.ACADEMIC_STRUCTURE_COLLECTION || "academic_structure";
  if (capabilities.students) {
    const saved = await database.collection(academicCollection).findOne(
      { _id: "main" },
      { projection: { categories: 1, years: 1 } }
    );
    if (saved) academic = {
      categories: Array.isArray(saved.categories) ? saved.categories.map(item => ({ id: item.id, name: item.name })) : [],
      years: Array.isArray(saved.years) ? saved.years.map(item => ({ id: item.id, name: item.name, category: item.category })) : []
    };
  }

  const actorName = auth.admin.fullName || auth.admin.name ||
    [auth.admin.firstName, auth.admin.lastName].filter(Boolean).join(" ") || auth.admin.email || "مدير النظام";

  return {
    ok: true,
    actor: { name: actorName, role: auth.roleName },
    site: { url: process.env.APP_URL || "" },
    capabilities,
    admins: adminDocs.map(item => publicAdmin(item, auth.session.userId, auth.builtInAdmin)),
    students: studentDocs.map(item => publicStudent(item, enrollmentIds)),
    roles: roles.map(item => ({
      id: String(item._id),
      roleName: item.roleName,
      badge: item.badge || null,
      permissionsCount: item.permissionsCount || 0,
      allPermissions: item.allPermissions === true,
      createdAt: item.createdAt || null,
      sections: Array.isArray(item.sections) ? item.sections : []
    })),
    academic,
    truncated: {
      admins: adminDocs.length === MAX_LIST,
      students: studentDocs.length === MAX_LIST
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  try {
    const database = await getDatabase();
    if (req.method === "GET") {
      const viewPermissions = [
        { section: "صلاحيات المستخدمين", module: "المشرفون", action: "عرض" },
        { section: "صلاحيات المستخدمين", module: "الطلاب", action: "عرض" },
        { section: "صلاحيات المستخدمين", module: "الأدوار والصلاحيات", action: "عرض" },
        { section: "صلاحيات المستخدمين", module: "الملف الشخصي", action: "عرض" },
        { section: "إدارة المحتوى", module: "الكورسات ومحتواها", action: "عرض" }
      ];
      let authorized = null;
      let lastFailure = { status: 403, message: "ليس لديك صلاحية عرض إدارة المستخدمين." };
      for (const permission of viewPermissions) {
        const candidate = await requireAdmin(req, permission);
        if (!candidate.ok) { lastFailure = candidate; continue; }
        const candidateCapabilities = await roleCapabilities(database, candidate.roleName, candidate.builtInAdmin);
        if (candidateCapabilities.admins || candidateCapabilities.students || candidateCapabilities.roles || candidateCapabilities.courses) {
          authorized = { auth: candidate, capabilities: candidateCapabilities };
          break;
        }
      }
      if (!authorized) return json(res, lastFailure.status, { ok: false, message: lastFailure.message });
      return json(res, 200, await loadData(authorized.auth, authorized.capabilities));
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
    }

    const action = text(req.body?.action, 50);
    const type = text(req.body?.type, 30);
    const actionPermission = {
      createAdmin: ["المشرفون", "إنشاء"],
      updateAdmin: ["المشرفون", "تعديل"],
      createStudent: ["الطلاب", "إنشاء"],
      updateStudent: ["الطلاب", "تعديل"],
      deleteStudent: ["الطلاب", "حذف"],
      toggleStudent: ["الطلاب", "تعديل"],
      resetStudentPassword: ["الطلاب", "تعديل"],
      resetStudentDevice: ["الطلاب", "تعديل"]
    }[action];

    if (!actionPermission || !["admins", "students"].includes(type)) {
      return json(res, 400, { ok: false, message: "العملية المطلوبة غير صحيحة." });
    }
    if ((type === "admins" && !action.endsWith("Admin")) || (type === "students" && !action.endsWith("Student"))) {
      return json(res, 400, { ok: false, message: "نوع المستخدم غير متوافق مع العملية." });
    }

    const auth = await requireModulePermission(req, actionPermission[0], actionPermission[1]);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const result = type === "admins"
      ? await writeAdmin(database, auth, action, req.body || {})
      : await writeStudent(database, auth, action, req.body || {});

    return json(res, 200, { ok: true, ...result });
  } catch (error) {
    console.error("admin user management failed:", error.message);
    const status = error.statusCode || 400;
    return json(res, status, {
      ok: false,
      message: error.message || "تعذر تنفيذ العملية. حاول مرة أخرى."
    });
  }
};

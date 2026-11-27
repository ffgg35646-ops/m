"use strict";
const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const { db } = require("../_lib/auth");

const USERS = process.env.USERS_COLLECTION || "users";
const COURSES = process.env.COURSES_COLLECTION || "courses";
const ENROLLMENTS = process.env.ENROLLMENTS_COLLECTION || "enrollments";
const PRODUCTS = process.env.LIBRARY_PRODUCTS_COLLECTION || process.env.LIBRARY_COLLECTION || "library_products";
const ORDERS = process.env.LIBRARY_ORDERS_COLLECTION || process.env.ORDERS_COLLECTION || "orders";
const CODES = process.env.CENTER_CODES_COLLECTION || "center_codes";
const EXAMS = process.env.EXAMS_COLLECTION || "exams";
const ATTEMPTS = process.env.EXAM_ATTEMPTS_COLLECTION || "exam_attempts";

const text = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const isObjectId = value => ObjectId.isValid(String(value || ""));
const idValue = value => isObjectId(value) ? new ObjectId(String(value)) : String(value || "");
const idValues = value => {
  const raw = String(value || "");
  return isObjectId(raw) ? [raw, new ObjectId(raw)] : [raw];
};
const array = value => Array.isArray(value) ? value : [];
const blocked = new Set(["deleted", "inactive", "disabled", "محذوف", "غير نشط", "غير فعال", "محظور", "blocked"]);

function cookieToken(req) {
  const part = String(req.headers?.cookie || "").split(";").map(x => x.trim())
    .find(x => x.startsWith("ali_admin_session="));
  return part ? part.slice("ali_admin_session=".length) : "";
}

async function requireStudent(req) {
  const token = cookieToken(req);
  if (!token) return { ok: false, status: 401, message: "سجل الدخول أولاً للمتابعة." };
  const database = await db();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await database.collection("auth_sessions").findOne({
    tokenHash, expiresAt: { $gt: new Date() }
  });
  if (!session) return { ok: false, status: 401, message: "انتهت جلسة الدخول. سجل الدخول مرة أخرى." };
  if (session.authCollection !== USERS) return { ok: false, status: 403, message: "هذه الصفحة متاحة لحسابات الطلاب فقط." };
  const user = await database.collection(USERS).findOne({ _id: session.userId });
  if (!user) return { ok: false, status: 401, message: "حساب الطالب غير موجود." };
  const status = text(user.status, 40).toLowerCase();
  if (user.isActive === false || user.active === false || blocked.has(status)) {
    return { ok: false, status: 403, message: "هذا الحساب غير نشط. تواصل مع إدارة المنصة." };
  }
  return { ok: true, database, user, session };
}

function studentName(user) {
  return text(user.fullName || user.name || [user.firstName, user.lastName].filter(Boolean).join(" "), 200) || "طالب";
}

function userLookup(user) {
  const ids = [user._id, String(user._id)];
  if (isObjectId(user._id)) ids.push(new ObjectId(String(user._id)));
  const clauses = [
    { userId: { $in: ids } },
    { studentId: { $in: ids } },
    { "user._id": { $in: ids } },
    { "student._id": { $in: ids } }
  ];
  if (user.email) {
    clauses.push({ email: String(user.email).toLowerCase() });
    clauses.push({ studentEmail: String(user.email).toLowerCase() });
  }
  return { $or: clauses };
}

function courseIdFromEnrollment(row) {
  const value = row.courseId ?? row.course_id ?? row.course?._id ?? row.course?.id ?? row.course;
  return value === undefined || value === null ? "" : String(value);
}

function enrollmentIsActive(row) {
  const status = text(row.status, 40).toLowerCase();
  return !row.deletedAt && row.isActive !== false && !blocked.has(status);
}

function enrollmentExpiry(row, course) {
  const direct = row.expiresAt || row.accessEndsAt;
  if (direct) return new Date(direct);
  if (course?.accessExpiryMode === "date" && (course.accessEndsAt || course.expiresAt)) {
    return new Date(course.accessEndsAt || course.expiresAt);
  }
  if (course?.accessExpiryMode === "days" && Number(course.accessDays) > 0) {
    const start = new Date(row.enrolledAt || row.createdAt || new Date());
    start.setDate(start.getDate() + Number(course.accessDays));
    return start;
  }
  return null;
}

function safeAssetUrl(input, max = 1800) {
  const raw = text(input, max);
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}
function imageUrl(source, id, kind) {
  const raw = text(source, 400000);
  if (!raw) return "";
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(raw)) {
    return kind === "course"
      ? "/api/public/course-image?courseId=" + encodeURIComponent(id)
      : "/api/public/library-image?productId=" + encodeURIComponent(id);
  }
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function publicCourse(course, enrollment) {
  const rawSections = array(course.sections).length ? course.sections : array(course.courseSections);
  const sections = rawSections.map((section, sectionIndex) => ({
    id: text(section.id, 100) || "section-" + sectionIndex,
    title: text(section.title || section.name, 200),
    sortOrder: Number.isFinite(Number(section.sortOrder)) ? Number(section.sortOrder) : sectionIndex,
    items: array(section.items).map((item, itemIndex) => ({
      id: text(item.id, 100) || "item-" + itemIndex,
      name: text(item.name || item.title, 200),
      type: item.type === "file" || item.type === "ملف" ? "file" : "video",
      url: safeAssetUrl(item.url || item.fileUrl || item.videoUrl, 1800),
      description: text(item.description || item.content, 3000),
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : itemIndex
    })).sort((a, b) => a.sortOrder - b.sortOrder)
  })).sort((a, b) => a.sortOrder - b.sortOrder);
  const expiresAt = enrollmentExpiry(enrollment, course);
  return {
    id: String(course._id),
    title: text(course.title || course.name, 240),
    description: text(course.description, 5000),
    category: text(course.category || course.gradeCategory, 160),
    grade: text(course.grade || course.year || course.schoolYear, 160),
    subject: text(course.subject || course.subjectName, 160),
    track: text(course.track || course.branch, 120),
    image: imageUrl(course.image || course.imageUrl || course.thumbnail || course.coverImage, String(course._id), "course"),
    sections,
    enrollment: {
      id: String(enrollment._id),
      status: text(enrollment.status || "active", 50),
      createdAt: enrollment.createdAt || enrollment.enrolledAt || null,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      expired: Boolean(expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now())
    }
  };
}

async function ownedCourseRows(database, user) {
  const rows = await database.collection(ENROLLMENTS).find(userLookup(user))
    .sort({ createdAt: -1, enrolledAt: -1 }).limit(1000).toArray();
  const activeRows = rows.filter(enrollmentIsActive);
  const ids = [...new Set(activeRows.map(courseIdFromEnrollment).filter(Boolean))];
  const selectors = ids.flatMap(idValues);
  const docs = selectors.length
    ? await database.collection(COURSES).find({ _id: { $in: selectors }, deletedAt: { $exists: false } }).toArray()
    : [];
  const byId = new Map(docs.map(course => [String(course._id), course]));
  return activeRows.map(row => {
    const course = byId.get(courseIdFromEnrollment(row));
    return course ? publicCourse(course, row) : null;
  }).filter(Boolean).filter(course => !course.enrollment.expired);
}

function typeOfOrder(order) {
  const value = text(order.orderType || order.type || order.sourceType || order.store, 50).toLowerCase();
  if (["library", "library_product", "library-product", "مكتبة", "كتاب"].includes(value)) return "library";
  if (["course", "courses", "enrollment", "كورس", "كورس تعليمي"].includes(value)) return "course";
  if (order.productId || order.product?.id || order.product?._id) return "library";
  if (order.courseId || order.course?.id || order.course?._id) return "course";
  return value || "other";
}

function orderAccessible(order) {
  const status = text(order.paymentStatus || order.status || order.state, 60).toLowerCase();
  return !["pending", "unpaid", "cancelled", "canceled", "failed", "معلق", "قيد الانتظار", "ملغي", "فشل"].includes(status);
}

function libraryProductId(order) {
  const product = order.product || order.item || {};
  return text(order.productId || product._id || product.id || order.item?.productId, 100);
}

async function ownedBookRows(database, user) {
  const rows = await database.collection(ORDERS).find(userLookup(user))
    .sort({ createdAt: -1, orderedAt: -1 }).limit(2000).toArray();
  const ownOrders = rows.filter(row => typeOfOrder(row) === "library" && orderAccessible(row));
  const ids = [...new Set(ownOrders.map(libraryProductId).filter(Boolean))];
  const selectors = ids.flatMap(idValues);
  const docs = selectors.length ? await database.collection(PRODUCTS).find({ _id: { $in: selectors } }).toArray() : [];
  const byId = new Map(docs.map(product => [String(product._id), product]));
  return ownOrders.map(order => {
    const id = libraryProductId(order);
    const product = byId.get(id) || order.product || order.item || null;
    if (!product) return null;
    const productId = String(product._id || product.id || id);
    const image = array(product.images)[0] || product.image || product.imageUrl;
    return {
      id: productId,
      title: text(product.title || product.name || order.productName, 240),
      description: text(product.description, 6000),
      type: product.type === "physical" || product.type === "مطبوع" ? "physical" : "digital",
      price: Number.isFinite(Number(product.price ?? order.amount)) ? Number(product.price ?? order.amount) : 0,
      image: imageUrl(image, productId, "library"),
      fileUrl: safeAssetUrl(product.fileUrl || product.downloadUrl || product.pdfUrl || product.file?.url, 1800),
      orderId: String(order._id),
      activatedAt: order.activatedAt || order.createdAt || order.orderedAt || null,
      deliveryStatus: text(order.deliveryStatus || "تم التفعيل", 80)
    };
  }).filter(Boolean);
}

async function getOwnedCourse(database, user, courseId) {
  const list = await ownedCourseRows(database, user);
  return list.find(item => item.id === String(courseId)) || null;
}

async function getOwnedBook(database, user, productId) {
  const list = await ownedBookRows(database, user);
  return list.find(item => item.id === String(productId)) || null;
}

function publicOrder(order) {
  return {
    id: String(order._id),
    type: typeOfOrder(order),
    itemId: text(order.courseId || order.productId || order.item?.productId, 100),
    title: text(order.courseName || order.productName || order.title || order.course?.title || order.product?.title, 240),
    amount: Number.isFinite(Number(order.amount ?? order.total ?? order.price)) ? Number(order.amount ?? order.total ?? order.price) : 0,
    paymentStatus: text(order.paymentStatus || order.status || "غير محدد", 80),
    deliveryStatus: text(order.deliveryStatus || "", 80),
    source: text(order.source || "", 50),
    createdAt: order.createdAt || order.orderedAt || order.date || null
  };
}

module.exports = {
  db,
  ObjectId,
  USERS,
  COURSES,
  ENROLLMENTS,
  PRODUCTS,
  ORDERS,
  CODES,
  EXAMS,
  ATTEMPTS,
  text,
  array,
  idValue,
  idValues,
  isObjectId,
  requireStudent,
  studentName,
  userLookup,
  enrollmentIsActive,
  imageUrl,
  publicCourse,
  ownedCourseRows,
  typeOfOrder,
  orderAccessible,
  libraryProductId,
  ownedBookRows,
  getOwnedCourse,
  getOwnedBook,
  publicOrder
};

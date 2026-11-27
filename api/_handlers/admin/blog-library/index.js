const { ObjectId } = require("mongodb");
const { json, db: getDatabase } = require("../../_lib/auth");
const { requireAdmin, roleAllows, normalizeRole } = require("../../_lib/admin");

const POSTS = process.env.BLOG_POSTS_COLLECTION || "blog_posts";
const CATEGORIES = process.env.BLOG_CATEGORIES_COLLECTION || "blog_categories";
const PRODUCTS = process.env.LIBRARY_PRODUCTS_COLLECTION || "library_products";
const ORDERS = process.env.LIBRARY_ORDERS_COLLECTION || process.env.ORDERS_COLLECTION || "orders";
const ROLES = process.env.PLATFORM_ROLES_COLLECTION || "platform_roles";
const MAX_ROWS = 1000;
const IMAGE_LIMIT = 380000;
const BLOG_SECTION = "المدونة";
const POSTS_MODULE = "المدونات";
const TAGS_MODULE = "تصنيفات المدونات";
const LIBRARY_SECTION = "المكتبة";
const PRODUCTS_MODULE = "منتجات المكتبة";
const ORDERS_MODULE = "طلبات المكتبة";

function str(value, max = 200) { return String(value ?? "").trim().slice(0, max); }
function fail(message, status = 400) { const e = new Error(message); e.statusCode = status; throw e; }
function idQuery(value) {
  const id = str(value, 100);
  if (!id) fail("معرف السجل مطلوب.");
  const parsed = ObjectId.isValid(id) ? new ObjectId(id) : id;
  return { $or: [{ _id: parsed }, { _id: id }] };
}
async function collectionExists(db, name) {
  return db.listCollections({ name }, { nameOnly: true }).hasNext();
}
function safeImage(value) {
  const raw = str(value, IMAGE_LIMIT + 10);
  if (!raw) return "";
  if (raw.startsWith("data:")) {
    if (raw.length > IMAGE_LIMIT || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      fail("الصورة كبيرة أو غير صالحة. استخدم JPG أو PNG أو WEBP مضغوطة.");
    }
    return raw;
  }
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch { fail("أدخل رابط صورة صحيحاً."); }
}
function safeUrl(value, label = "الرابط") {
  const raw = str(value, 1800);
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch { fail("أدخل " + label + " صحيحاً."); }
}
function sortValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1000000, number)) : fallback;
}
function normalizeType(value) {
  return value === "physical" || value === "مطبوع" ? "physical" : "رقمي";
}
function visibleDoc(doc) {
  return !doc.deletedAt && !["deleted", "محذوف"].includes(String(doc.status || "").toLowerCase());
}
function publicPost(doc, index = 0) {
  return {
    id: String(doc._id),
    title: str(doc.title, 240),
    excerpt: str(doc.excerpt, 1200),
    content: str(doc.content, 100000),
    imageUrl: str(doc.imageUrl || doc.image, IMAGE_LIMIT + 10),
    hasImage: Boolean(doc.imageUrl || doc.image),
    categoryId: str(doc.categoryId, 100),
    tag: str(doc.tag || doc.categoryName || "", 140),
    status: doc.status === "published" ? "published" : "draft",
    sortOrder: sortValue(doc.sortOrder, index),
    publishedAt: doc.publishedAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  };
}
function publicCategory(doc, index = 0) {
  return {
    id: String(doc._id),
    name: str(doc.name, 140),
    order: sortValue(doc.sortOrder ?? doc.order, index),
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  };
}
function publicProduct(doc, index = 0) {
  const type = normalizeType(doc.type || doc.typeLabel);
  const price = Number(doc.price ?? 0);
  const images = Array.isArray(doc.images) ? doc.images.map(image => str(image, IMAGE_LIMIT + 10)).filter(Boolean).slice(0, 8) : [];
  return {
    id: String(doc._id),
    title: str(doc.title || doc.name, 240),
    description: str(doc.description, 4000),
    type,
    typeLabel: type,
    price: Number.isFinite(price) && price >= 0 ? price : 0,
    isFree: doc.isFree === true || price === 0,
    isActive: doc.isActive !== false && doc.status !== "inactive",
    featuredHome: doc.featuredHome === true,
    order: sortValue(doc.sortOrder ?? doc.order, index),
    images,
    fileUrl: str(doc.fileUrl || doc.downloadUrl || doc.pdfUrl, 1800),
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  };
}
async function activeRole(db, auth) {
  if (auth.builtInAdmin) return null;
  const rows = await db.collection(ROLES).find({ isActive: { $ne: false } }).toArray();
  return rows.find(row => normalizeRole(row.roleName) === normalizeRole(auth.roleName)) || null;
}
async function capabilities(db, auth) {
  if (auth.builtInAdmin) {
    return {
      blogView: true, blogCreate: true, blogEdit: true, blogDelete: true,
      tagsView: true, tagsCreate: true, tagsEdit: true, tagsDelete: true,
      productsView: true, productsCreate: true, productsEdit: true, productsDelete: true,
      ordersView: true
    };
  }
  const role = await activeRole(db, auth);
  const allows = (section, module, action) => roleAllows(role, { section, module, action });
  return {
    blogView: allows(BLOG_SECTION, POSTS_MODULE, "عرض"),
    blogCreate: allows(BLOG_SECTION, POSTS_MODULE, "إنشاء"),
    blogEdit: allows(BLOG_SECTION, POSTS_MODULE, "تعديل"),
    blogDelete: allows(BLOG_SECTION, POSTS_MODULE, "حذف"),
    tagsView: allows(BLOG_SECTION, TAGS_MODULE, "عرض"),
    tagsCreate: allows(BLOG_SECTION, TAGS_MODULE, "إنشاء"),
    tagsEdit: allows(BLOG_SECTION, TAGS_MODULE, "تعديل"),
    tagsDelete: allows(BLOG_SECTION, TAGS_MODULE, "حذف"),
    productsView: allows(LIBRARY_SECTION, PRODUCTS_MODULE, "عرض"),
    productsCreate: allows(LIBRARY_SECTION, PRODUCTS_MODULE, "إنشاء"),
    productsEdit: allows(LIBRARY_SECTION, PRODUCTS_MODULE, "تعديل"),
    productsDelete: allows(LIBRARY_SECTION, PRODUCTS_MODULE, "حذف"),
    ordersView: allows(LIBRARY_SECTION, ORDERS_MODULE, "عرض")
  };
}
const VIEW_PERMISSIONS = [
  { section: BLOG_SECTION, module: POSTS_MODULE, action: "عرض" },
  { section: BLOG_SECTION, module: TAGS_MODULE, action: "عرض" },
  { section: LIBRARY_SECTION, module: PRODUCTS_MODULE, action: "عرض" },
  { section: LIBRARY_SECTION, module: ORDERS_MODULE, action: "عرض" }
];
const ACTIONS = {
  createPost: { section: BLOG_SECTION, module: POSTS_MODULE, action: "إنشاء" },
  updatePost: { section: BLOG_SECTION, module: POSTS_MODULE, action: "تعديل" },
  deletePost: { section: BLOG_SECTION, module: POSTS_MODULE, action: "حذف" },
  reorderPosts: { section: BLOG_SECTION, module: POSTS_MODULE, action: "تعديل" },
  createCategory: { section: BLOG_SECTION, module: TAGS_MODULE, action: "إنشاء" },
  updateCategory: { section: BLOG_SECTION, module: TAGS_MODULE, action: "تعديل" },
  deleteCategory: { section: BLOG_SECTION, module: TAGS_MODULE, action: "حذف" },
  reorderCategories: { section: BLOG_SECTION, module: TAGS_MODULE, action: "تعديل" },
  createProduct: { section: LIBRARY_SECTION, module: PRODUCTS_MODULE, action: "إنشاء" },
  updateProduct: { section: LIBRARY_SECTION, module: PRODUCTS_MODULE, action: "تعديل" },
  deleteProduct: { section: LIBRARY_SECTION, module: PRODUCTS_MODULE, action: "حذف" },
  reorderProducts: { section: LIBRARY_SECTION, module: PRODUCTS_MODULE, action: "تعديل" },
  toggleProductStatus: { section: LIBRARY_SECTION, module: PRODUCTS_MODULE, action: "تعديل" }
};
async function authorizeAnyView(req) {
  let last = { status: 403, message: "ليس لديك صلاحية عرض المدونة أو المكتبة." };
  for (const permission of VIEW_PERMISSIONS) {
    const auth = await requireAdmin(req, permission);
    if (auth.ok) return auth;
    last = auth;
  }
  return last;
}
async function audit(db, auth, action, targetId, details = {}) {
  try {
    await db.collection("admin_audit_logs").insertOne({
      action, targetContentId: targetId || null, adminId: auth.admin._id,
      details, createdAt: new Date()
    });
  } catch (e) { console.error("blog/library audit log failed:", e.message); }
}
async function loadOrders(db, products) {
  if (!await collectionExists(db, ORDERS)) return { available: false, orders: [] };
  const productIds = new Set(products.map(item => item.id));
  const productNames = new Set(products.map(item => item.title.trim().toLocaleLowerCase("ar")));
  const rows = await db.collection(ORDERS).find({}).sort({ createdAt: -1, _id: -1 }).limit(MAX_ROWS).toArray();
  const orders = rows.filter(row => {
    const explicit = [row.type, row.orderType, row.source, row.store, row.productType, row.itemType]
      .some(value => ["library", "مكتبة", "library_product", "library-product"].includes(String(value || "").toLowerCase()));
    if (explicit) return true;
    const candidates = [
      row.productId, row.product?._id, row.product?.id,
      row.item?.productId, row.item?.id
    ].filter(value => value !== undefined && value !== null).map(String);
    if (candidates.some(value => productIds.has(value))) return true;
    const names = [row.productName, row.product?.title, row.product?.name, row.item?.title, row.item?.name]
      .filter(Boolean).map(value => String(value).trim().toLocaleLowerCase("ar"));
    if (names.some(value => productNames.has(value))) return true;
    const items = Array.isArray(row.items) ? row.items : [];
    return items.some(item => {
      const id = String(item.productId || item.product?._id || item.product?.id || item.id || "");
      const name = String(item.title || item.name || item.productName || "").trim().toLocaleLowerCase("ar");
      return (id && productIds.has(id)) || (name && productNames.has(name));
    });
  }).map(row => {
    const product = row.product || row.item || {};
    const items = Array.isArray(row.items) ? row.items : [];
    const ids = [row.productId, product._id, product.id, row.item?.productId]
      .filter(value => value !== undefined && value !== null).map(String);
    const names = [row.productName, product.title, product.name, row.itemName, row.title,
      ...items.map(item => item.title || item.name || item.productName)]
      .filter(Boolean).map(value => String(value).trim().toLocaleLowerCase("ar"));
    const matchedProduct = products.find(item => ids.includes(item.id) || names.includes(item.title.trim().toLocaleLowerCase("ar")));
    const name = str(row.productName || product.title || product.name || row.itemName || row.title, 240) ||
      matchedProduct?.title || items.map(x => str(x.title || x.name || x.productName, 120)).filter(Boolean).join("، ");
    const student = row.student || row.user || row.customer || {};
    const createdAt = row.createdAt || row.orderedAt || row.date || null;
    return {
      id: String(row._id),
      productId: str(row.productId || product._id || product.id || matchedProduct?.id, 100),
      productName: name || "منتج مكتبة",
      productType: matchedProduct?.type || normalizeType(row.productType || product.type),
      studentName: str(row.studentName || row.customerName || student.fullName || student.name || row.userName, 200) || "غير محدد",
      studentPhone: str(row.studentPhone || row.phone || student.phone || student.mobile, 50),
      studentEmail: str(row.studentEmail || row.email || student.email, 254),
      studentCode: str(row.studentCode || row.code || student.code || student.studentCode, 50),
      amount: Number.isFinite(Number(row.amount ?? row.total ?? row.price)) ? Number(row.amount ?? row.total ?? row.price) : 0,
      paymentStatus: str(row.paymentStatus || row.payment_status || row.status, 60) || "غير محدد",
      deliveryStatus: str(row.deliveryStatus || row.shippingStatus || row.fulfillmentStatus, 60) || "غير محدد",
      createdAt
    };
  });
  return { available: true, orders, truncated: rows.length === MAX_ROWS };
}
async function loadCollection(db, name, sorter = { sortOrder: 1, createdAt: -1 }) {
  if (!await collectionExists(db, name)) return { available: false, rows: [] };
  const rows = await db.collection(name).find({
    $and: [
      { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
      { status: { $nin: ["deleted", "محذوف"] } }
    ]
  }).sort(sorter).limit(MAX_ROWS).toArray();
  return { available: true, rows };
}
function idFrom(value) {
  const id = str(value, 100);
  if (!id) fail("معرف السجل مطلوب.");
  return ObjectId.isValid(id) ? new ObjectId(id) : id;
}
async function findRecord(db, collection, id) {
  const textId = str(id, 100);
  return db.collection(collection).findOne({ $or: [{ _id: idFrom(textId) }, { _id: textId }] });
}
function cleanPost(data, previous = {}) {
  const title = str(data.title, 240);
  const excerpt = str(data.excerpt, 1200);
  const content = str(data.content, 100000);
  if (title.length < 2) fail("أدخل عنوان المقال.");
  if (!excerpt) fail("أدخل مقتطف المقال.");
  if (!content) fail("أدخل محتوى المقال.");
  const status = data.status === "published" ? "published" : "draft";
  const imageUrl = data.hasImage === false ? "" : (data.imageUrl === undefined ? str(previous.imageUrl || previous.image, IMAGE_LIMIT + 10) : safeImage(data.imageUrl));
  return {
    title, excerpt, content, imageUrl, image: imageUrl,
    categoryId: str(data.categoryId, 100), tag: str(data.tag, 140),
    status, sortOrder: sortValue(data.sortOrder, sortValue(previous.sortOrder)),
    publishedAt: status === "published" ? (previous.publishedAt || new Date()) : null,
    updatedAt: new Date()
  };
}
function cleanCategory(data, previous = {}) {
  const name = str(data.name, 140);
  if (name.length < 2) fail("أدخل اسم التصنيف.");
  return { name, sortOrder: sortValue(data.order, sortValue(previous.sortOrder ?? previous.order)), updatedAt: new Date() };
}
function cleanProduct(data, previous = {}) {
  const title = str(data.title, 240);
  if (title.length < 2) fail("أدخل اسم المنتج.");
  const type = normalizeType(data.type ?? previous.type);
  const isFree = data.isFree === true;
  const price = isFree ? 0 : Number(data.price);
  if (!Number.isFinite(price) || price < 0 || price > 100000000) fail("أدخل سعراً صحيحاً.");
  const images = Array.isArray(data.images) ? data.images.slice(0, 8).map(safeImage).filter(Boolean) :
    (Array.isArray(previous.images) ? previous.images : []);
  if (Array.isArray(data.images) && data.images.length > 8) fail("الحد الأقصى 8 صور للمنتج.");
  const fileUrl = safeUrl(data.fileUrl === undefined ? (previous.fileUrl || previous.downloadUrl || previous.pdfUrl) : data.fileUrl, "رابط ملف الكتاب");
  if (type !== "physical" && !isFree && !fileUrl) fail("أضف رابط ملف القراءة أو التحميل للمنتج الرقمي قبل حفظه.");
  return {
    title, name: title, description: str(data.description, 4000),
    type, typeLabel: type, price, isFree,
    isActive: data.isActive === undefined ? previous.isActive !== false : data.isActive === true,
    status: (data.isActive === undefined ? previous.isActive !== false : data.isActive === true) ? "active" : "inactive",
    featuredHome: data.featuredHome === true,
    sortOrder: sortValue(data.order, sortValue(previous.sortOrder ?? previous.order)),
    images, fileUrl, downloadUrl: fileUrl, updatedAt: new Date()
  };
}
async function reorderCollection(db, collectionName, ids, auth, eventName) {
  if (!Array.isArray(ids) || ids.length > MAX_ROWS) fail("قائمة الترتيب غير صحيحة.");
  for (let index = 0; index < ids.length; index++) {
    const record = await findRecord(db, collectionName, ids[index]);
    if (record && visibleDoc(record)) {
      await db.collection(collectionName).updateOne({ _id: record._id }, { $set: { sortOrder: index, updatedAt: new Date() } });
    }
  }
  await audit(db, auth, eventName, null, { count: ids.length });
  return { message: "تم حفظ الترتيب." };
}
async function write(db, auth, action, data) {
  const now = new Date();
  if (action === "createPost") {
    const doc = cleanPost(data);
    doc.createdAt = now; doc.createdBy = auth.admin._id;
    const inserted = await db.collection(POSTS).insertOne(doc);
    await audit(db, auth, "blog_post_created", inserted.insertedId, { title: doc.title });
    return { message: "تم إنشاء المقال وحفظه.", id: String(inserted.insertedId) };
  }
  if (action === "updatePost") {
    const previous = await findRecord(db, POSTS, data.id);
    if (!previous || !visibleDoc(previous)) fail("لم يتم العثور على المقال.", 404);
    const patch = cleanPost(data, previous);
    await db.collection(POSTS).updateOne({ _id: previous._id }, { $set: { ...patch, updatedBy: auth.admin._id } });
    await audit(db, auth, "blog_post_updated", previous._id, { title: patch.title });
    return { message: "تم تحديث المقال." };
  }
  if (action === "deletePost") {
    const previous = await findRecord(db, POSTS, data.id);
    if (!previous || !visibleDoc(previous)) fail("لم يتم العثور على المقال.", 404);
    await db.collection(POSTS).updateOne({ _id: previous._id }, { $set: { status: "deleted", deletedAt: now, deletedBy: auth.admin._id, updatedAt: now } });
    await audit(db, auth, "blog_post_deleted", previous._id, { title: previous.title });
    return { message: "تم حذف المقال." };
  }
  if (action === "reorderPosts") return reorderCollection(db, POSTS, data.ids, auth, "blog_posts_reordered");
  if (action === "createCategory") {
    const doc = cleanCategory(data);
    doc.createdAt = now; doc.createdBy = auth.admin._id;
    const inserted = await db.collection(CATEGORIES).insertOne(doc);
    await audit(db, auth, "blog_category_created", inserted.insertedId, { name: doc.name });
    return { message: "تمت إضافة التصنيف.", id: String(inserted.insertedId) };
  }
  if (action === "updateCategory") {
    const previous = await findRecord(db, CATEGORIES, data.id);
    if (!previous || !visibleDoc(previous)) fail("لم يتم العثور على التصنيف.", 404);
    const patch = cleanCategory(data, previous);
    await db.collection(CATEGORIES).updateOne({ _id: previous._id }, { $set: patch });
    await audit(db, auth, "blog_category_updated", previous._id, { name: patch.name });
    return { message: "تم تحديث التصنيف." };
  }
  if (action === "deleteCategory") {
    const previous = await findRecord(db, CATEGORIES, data.id);
    if (!previous || !visibleDoc(previous)) fail("لم يتم العثور على التصنيف.", 404);
    const linked = await db.collection(POSTS).countDocuments({
      $and: [
        { $or: [{ categoryId: String(previous._id) }, { tag: previous.name }, { categoryName: previous.name }] },
        { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] }
      ]
    });
    if (linked) fail("لا يمكن حذف التصنيف قبل نقل المقالات المرتبطة به إلى تصنيف آخر.");
    await db.collection(CATEGORIES).updateOne({ _id: previous._id }, { $set: { deletedAt: now, deletedBy: auth.admin._id, updatedAt: now } });
    await audit(db, auth, "blog_category_deleted", previous._id, { name: previous.name });
    return { message: "تم حذف التصنيف." };
  }
  if (action === "reorderCategories") return reorderCollection(db, CATEGORIES, data.ids, auth, "blog_categories_reordered");
  if (action === "createProduct") {
    const doc = cleanProduct(data);
    doc.createdAt = now; doc.createdBy = auth.admin._id;
    doc.sortOrder = await db.collection(PRODUCTS).countDocuments({ deletedAt: { $exists: false } });
    const inserted = await db.collection(PRODUCTS).insertOne(doc);
    await audit(db, auth, "library_product_created", inserted.insertedId, { title: doc.title });
    return { message: "تمت إضافة المنتج وحفظه في المكتبة.", id: String(inserted.insertedId) };
  }
  if (action === "updateProduct") {
    const previous = await findRecord(db, PRODUCTS, data.id);
    if (!previous || !visibleDoc(previous)) fail("لم يتم العثور على المنتج.", 404);
    const patch = cleanProduct(data, previous);
    await db.collection(PRODUCTS).updateOne({ _id: previous._id }, { $set: { ...patch, updatedBy: auth.admin._id } });
    await audit(db, auth, "library_product_updated", previous._id, { title: patch.title });
    return { message: "تم تحديث المنتج." };
  }
  if (action === "toggleProductStatus") {
    const previous = await findRecord(db, PRODUCTS, data.id);
    if (!previous || !visibleDoc(previous)) fail("لم يتم العثور على المنتج.", 404);
    const active = data.isActive === true;
    await db.collection(PRODUCTS).updateOne({ _id: previous._id }, { $set: { isActive: active, status: active ? "active" : "inactive", updatedAt: now, updatedBy: auth.admin._id } });
    await audit(db, auth, active ? "library_product_activated" : "library_product_deactivated", previous._id);
    return { message: active ? "تم تفعيل المنتج." : "تم إيقاف المنتج." };
  }
  if (action === "deleteProduct") {
    const previous = await findRecord(db, PRODUCTS, data.id);
    if (!previous || !visibleDoc(previous)) fail("لم يتم العثور على المنتج.", 404);
    await db.collection(PRODUCTS).updateOne({ _id: previous._id }, { $set: { deletedAt: now, deletedBy: auth.admin._id, isActive: false, status: "deleted", updatedAt: now } });
    await audit(db, auth, "library_product_deleted", previous._id, { title: previous.title || previous.name });
    return { message: "تم حذف المنتج من العرض مع الاحتفاظ بسجلات الطلبات المرتبطة به." };
  }
  if (action === "reorderProducts") return reorderCollection(db, PRODUCTS, data.ids, auth, "library_products_reordered");
  fail("العملية المطلوبة غير معروفة.", 400);
}
module.exports = async function handler(req, res) {
  try {
    const db = await getDatabase();
    if (req.method === "GET") {
      const auth = await authorizeAnyView(req);
      if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
      const perms = await capabilities(db, auth);
      const [postsResult, categoriesResult, productsResult] = await Promise.all([
        perms.blogView ? loadCollection(db, POSTS) : Promise.resolve({ available: false, rows: [] }),
        perms.tagsView ? loadCollection(db, CATEGORIES) : Promise.resolve({ available: false, rows: [] }),
        perms.productsView ? loadCollection(db, PRODUCTS) : Promise.resolve({ available: false, rows: [] })
      ]);
      const posts = postsResult.rows.map(publicPost);
      const categories = categoriesResult.rows.map(publicCategory);
      const products = productsResult.rows.map(publicProduct);
      let orderProducts = products;
      if (perms.ordersView && !perms.productsView) {
        const lookupProducts = await loadCollection(db, PRODUCTS);
        orderProducts = lookupProducts.rows.map(publicProduct);
      }
      const orderResult = perms.ordersView ? await loadOrders(db, orderProducts) : { available: false, orders: [] };
      return json(res, 200, {
        ok: true, posts, categories, products, orders: orderResult.orders,
        availability: {
          posts: postsResult.available, categories: categoriesResult.available,
          products: productsResult.available, orders: orderResult.available
        },
        truncated: {
          posts: postsResult.rows.length === MAX_ROWS,
          categories: categoriesResult.rows.length === MAX_ROWS,
          products: productsResult.rows.length === MAX_ROWS,
          orders: orderResult.truncated === true
        },
        capabilities: perms,
        actor: { name: auth.admin.fullName || auth.admin.name || auth.admin.email || "مدير النظام", role: auth.roleName },
        site: { url: process.env.APP_URL || "https://alielian.com" },
        generatedAt: new Date().toISOString()
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
    }
    const action = str(req.body?.action, 60);
    const permission = ACTIONS[action];
    if (!permission) return json(res, 400, { ok: false, message: "العملية المطلوبة غير صحيحة." });
    const auth = await requireAdmin(req, permission);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const result = await write(db, auth, action, req.body || {});
    return json(res, 200, { ok: true, ...result });
  } catch (e) {
    console.error("admin blog/library management failed:", e.message);
    return json(res, e.statusCode || 500, { ok: false, message: e.message || "تعذر تنفيذ العملية." });
  }
};
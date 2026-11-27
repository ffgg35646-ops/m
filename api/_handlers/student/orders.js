"use strict";
const { json } = require("../_lib/auth");
const { requireStudent, userLookup, publicOrder, ORDERS } = require("./_lib");

module.exports = async function(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }
  try {
    const auth = await requireStudent(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const rows = await auth.database.collection(ORDERS).find(userLookup(auth.user))
      .sort({ createdAt: -1, orderedAt: -1 }).limit(500).toArray();
    const orders = rows.map(publicOrder);
    return json(res, 200, { ok: true, orders, count: orders.length, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("student orders failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تحميل طلباتك حالياً." });
  }
};

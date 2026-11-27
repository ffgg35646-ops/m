"use strict";
const { json } = require("../_lib/auth");
const { requireStudent, ownedBookRows } = require("./_lib");

module.exports = async function(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }
  try {
    const auth = await requireStudent(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const books = await ownedBookRows(auth.database, auth.user);
    return json(res, 200, { ok: true, books, count: books.length, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("student books failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تحميل كتبك حالياً." });
  }
};

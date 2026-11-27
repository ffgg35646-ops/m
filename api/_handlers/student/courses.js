"use strict";
const { json } = require("../_lib/auth");
const { requireStudent, ownedCourseRows, text } = require("./_lib");

module.exports = async function(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }
  try {
    const auth = await requireStudent(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const courses = await ownedCourseRows(auth.database, auth.user);
    const courseId = text(req.query?.courseId, 100);
    if (courseId) {
      const course = courses.find(item => item.id === courseId);
      if (!course) return json(res, 403, { ok: false, message: "هذا الكورس غير مسجل في حسابك أو انتهت مدة الوصول إليه." });
      return json(res, 200, { ok: true, course });
    }
    return json(res, 200, { ok: true, courses, count: courses.length, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("student courses failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تحميل كورساتك حالياً." });
  }
};

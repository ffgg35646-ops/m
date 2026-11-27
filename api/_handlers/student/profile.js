"use strict";
const { json } = require("../_lib/auth");
const { requireStudent, text, studentName, USERS } = require("./_lib");

module.exports = async function(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "PATCH") {
      res.setHeader("Allow", "GET, POST, PATCH");
      return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
    }
    const auth = await requireStudent(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const user = auth.user;
    if (req.method === "GET") {
      return json(res, 200, {
        ok: true,
        profile: {
          id: String(user._id),
          firstName: text(user.firstName, 80),
          lastName: text(user.lastName, 100),
          fullName: studentName(user),
          email: text(user.email, 254),
          phone: text(user.phone || user.mobile, 40),
          guardianPhone: text(user.guardianPhone || user.parentPhone, 40),
          category: text(user.category || user.gradeCategory, 160),
          year: text(user.year || user.schoolYear || user.grade, 160),
          governorate: text(user.governorate, 100),
          city: text(user.city, 100),
          division: text(user.division, 80),
          code: text(user.code || user.studentCode, 40),
          createdAt: user.createdAt || null,
          updatedAt: user.updatedAt || null
        }
      });
    }
    const body = req.body || {};
    const firstName = text(body.firstName, 80);
    const lastName = text(body.lastName, 100);
    if (firstName.length < 2 || lastName.length < 2) {
      return json(res, 400, { ok: false, message: "أدخل الاسم الأول واسم العائلة بشكل صحيح." });
    }
    const patch = {
      firstName, lastName,
      fullName: firstName + " " + lastName,
      name: firstName + " " + lastName,
      phone: text(body.phone, 40),
      mobile: text(body.phone, 40),
      guardianPhone: text(body.guardianPhone, 40),
      parentPhone: text(body.guardianPhone, 40),
      governorate: text(body.governorate, 100),
      city: text(body.city, 100),
      division: text(body.division, 80),
      updatedAt: new Date()
    };
    if (body.category !== undefined) {
      patch.category = text(body.category, 160);
      patch.gradeCategory = patch.category;
    }
    if (body.year !== undefined) {
      patch.year = text(body.year, 160);
      patch.schoolYear = patch.year;
      patch.grade = patch.year;
    }
    await auth.database.collection(USERS).updateOne({ _id: user._id }, { $set: patch });
    return json(res, 200, {
      ok: true,
      message: "تم حفظ بيانات حسابك بنجاح.",
      profile: {
        id: String(user._id),
        firstName, lastName, fullName: patch.fullName,
        email: text(user.email, 254),
        phone: patch.phone, guardianPhone: patch.guardianPhone,
        category: text(patch.category || user.category || user.gradeCategory, 160),
        year: text(patch.year || user.year || user.schoolYear, 160),
        governorate: patch.governorate, city: patch.city,
        division: patch.division, code: text(user.code || user.studentCode, 40)
      }
    });
  } catch (error) {
    console.error("student profile failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تحميل أو حفظ بيانات الحساب حالياً." });
  }
};

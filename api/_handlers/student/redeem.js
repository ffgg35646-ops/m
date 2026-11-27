"use strict";
const { json } = require("../_lib/auth");
const {
  requireStudent, text, idValues, userLookup, studentName, getOwnedBook,
  CODES, COURSES, PRODUCTS, ENROLLMENTS, ORDERS
} = require("./_lib");

function expired(expiresAt) {
  if (!expiresAt) return false;
  const value = String(expiresAt).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + "T23:59:59.999")
    : new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() < Date.now();
}

module.exports = async function(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }
  try {
    const auth = await requireStudent(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });
    const codeText = text(req.body?.code, 80).toUpperCase();
    if (!/^[A-Z0-9_-]{3,80}$/.test(codeText)) {
      return json(res, 400, { ok: false, message: "أدخل كود تفعيل صحيحاً." });
    }
    const code = await auth.database.collection(CODES).findOne({
      code: { $regex: "^" + codeText + "$", $options: "i" },
      deletedAt: { $exists: false }
    });
    if (!code) return json(res, 404, { ok: false, message: "كود التفعيل غير موجود." });
    if (code.isUsed) return json(res, 409, { ok: false, message: "تم استخدام هذا الكود بالفعل." });
    if (expired(code.expiresAt)) return json(res, 410, { ok: false, message: "انتهت صلاحية كود التفعيل." });

    const targetType = text(code.targetType || "courses", 40);
    const targetId = text(code.targetId, 100);
    if (!targetId || !["courses", "library"].includes(targetType)) {
      return json(res, 400, { ok: false, message: "هذا النوع من الأكواد غير مدعوم من حساب الطالب." });
    }
    if (req.body?.targetType && text(req.body.targetType, 40) !== targetType) {
      return json(res, 400, { ok: false, message: "هذا الكود مخصص لنوع محتوى مختلف." });
    }
    if (req.body?.targetId && text(req.body.targetId, 100) !== targetId) {
      return json(res, 400, { ok: false, message: "هذا الكود لا يخص المحتوى المحدد." });
    }

    const isCourse = targetType === "courses";
    const targetCollection = isCourse ? COURSES : PRODUCTS;
    const target = await auth.database.collection(targetCollection).findOne({
      _id: { $in: idValues(targetId) },
      deletedAt: { $exists: false },
      status: { $nin: ["deleted", "محذوف", "inactive", "غير نشط", "disabled"] },
      isActive: { $ne: false }
    });
    if (!target) return json(res, 404, { ok: false, message: "المحتوى المرتبط بالكود غير متاح حالياً." });

    if (isCourse) {
      const selectors = idValues(targetId);
      const existing = await auth.database.collection(ENROLLMENTS).findOne({
        $and: [
          userLookup(auth.user),
          { $or: [
            { courseId: { $in: selectors } },
            { course_id: { $in: selectors } },
            { "course._id": { $in: selectors } },
            { "course.id": { $in: selectors } },
            { course: { $in: selectors } }
          ] },
          { deletedAt: { $exists: false } }
        ]
      });
      const existingStatus = String(existing?.status || "").trim().toLowerCase();
      const existingExpiry = existing?.expiresAt || existing?.accessEndsAt;
      const existingExpired = existingExpiry ? new Date(existingExpiry).getTime() < Date.now() : false;
      if (existing && existing.isActive !== false && !existingExpired && !["deleted", "inactive", "محذوف", "غير نشط", "expired", "منتهي"].includes(existingStatus)) {
        return json(res, 409, { ok: false, message: "هذا الكورس مضاف بالفعل إلى كورساتك." });
      }
    } else {
      const existingBook = await getOwnedBook(auth.database, auth.user, targetId);
      if (existingBook) return json(res, 409, { ok: false, message: "هذا الكتاب موجود بالفعل في مكتبتك." });
    }

    const now = new Date();
    const redemptionId = require("crypto").randomUUID();
    const claim = await auth.database.collection(CODES).updateOne(
      { _id: code._id, isUsed: { $ne: true }, deletedAt: { $exists: false } },
      {
        $set: {
          isUsed: true,
          usedAt: now,
          usedBy: studentName(auth.user),
          user: {
            id: String(auth.user._id),
            name: studentName(auth.user),
            phone: text(auth.user.phone || auth.user.mobile, 40),
            email: text(auth.user.email, 254)
          },
          redemptionId
        }
      }
    );
    if (!claim.modifiedCount) {
      return json(res, 409, { ok: false, message: "سبق استخدام هذا الكود. حدّث الصفحة وتحقق من حالته." });
    }

    let enrollmentId = null;
    let orderId = null;
    try {
      const rawAmount = Number(target.price ?? target.amount ?? 0);
      const amount = Number.isFinite(rawAmount) && rawAmount >= 0 ? rawAmount : 0;
      const commonOrder = {
        userId: auth.user._id,
        studentId: auth.user._id,
        email: text(auth.user.email, 254).toLowerCase(),
        studentEmail: text(auth.user.email, 254).toLowerCase(),
        studentName: studentName(auth.user),
        studentPhone: text(auth.user.phone || auth.user.mobile, 40),
        studentCode: text(auth.user.code || auth.user.studentCode, 40),
        amount,
        paymentStatus: "paid",
        status: "paid",
        source: "center_code",
        codeId: String(code._id),
        code: code.code,
        redemptionId,
        activatedAt: now,
        createdAt: now,
        updatedAt: now
      };

      if (isCourse) {
        let expiresAt = null;
        if (target.accessExpiryMode === "date" && (target.accessEndsAt || target.expiresAt)) {
          expiresAt = new Date(target.accessEndsAt || target.expiresAt);
        } else if (target.accessExpiryMode === "days" && Number(target.accessDays) > 0) {
          expiresAt = new Date(now.getTime());
          expiresAt.setDate(expiresAt.getDate() + Number(target.accessDays));
        }
        const enrollment = {
          courseId: String(target._id),
          course: { id: String(target._id), title: text(target.title || target.name, 240) },
          userId: auth.user._id,
          studentId: auth.user._id,
          user: { _id: auth.user._id, name: studentName(auth.user), email: text(auth.user.email, 254) },
          student: { _id: auth.user._id, name: studentName(auth.user), email: text(auth.user.email, 254) },
          studentName: studentName(auth.user),
          email: text(auth.user.email, 254).toLowerCase(),
          status: "active",
          isActive: true,
          source: "center_code",
          codeId: String(code._id),
          code: code.code,
          enrolledAt: now,
          createdAt: now,
          updatedAt: now,
          expiresAt,
          accessEndsAt: expiresAt
        };
        const inserted = await auth.database.collection(ENROLLMENTS).insertOne(enrollment);
        enrollmentId = inserted.insertedId;
        Object.assign(commonOrder, {
          orderType: "course",
          type: "course",
          courseId: String(target._id),
          courseName: text(target.title || target.name, 240),
          deliveryStatus: "تم التفعيل"
        });
      } else {
        Object.assign(commonOrder, {
          orderType: "library",
          type: "library",
          productId: String(target._id),
          productName: text(target.title || target.name, 240),
          productType: target.type || target.typeLabel || "رقمي",
          deliveryStatus: "تم التفعيل"
        });
      }
      const insertedOrder = await auth.database.collection(ORDERS).insertOne(commonOrder);
      orderId = insertedOrder.insertedId;
      try {
        await auth.database.collection("admin_audit_logs").insertOne({
          action: isCourse ? "student_course_activated_by_code" : "student_book_activated_by_code",
          targetUserId: auth.user._id,
          targetContentId: target._id,
          details: { codeId: String(code._id), orderId: String(orderId), redemptionId },
          createdAt: now
        });
      } catch (auditError) {
        console.error("student activation audit failed:", auditError.message);
      }
      return json(res, 200, {
        ok: true,
        message: isCourse ? "تم تفعيل الكورس وإضافته إلى كورساتك." : "تم تفعيل الكتاب وإضافته إلى كتبي.",
        type: targetType,
        targetId,
        title: text(target.title || target.name, 240),
        enrollmentId: enrollmentId ? String(enrollmentId) : null,
        orderId: String(orderId)
      });
    } catch (error) {
      if (enrollmentId) await auth.database.collection(ENROLLMENTS).deleteOne({ _id: enrollmentId }).catch(() => {});
      if (orderId) await auth.database.collection(ORDERS).deleteOne({ _id: orderId }).catch(() => {});
      await auth.database.collection(CODES).updateOne(
        { _id: code._id, redemptionId },
        {
          $set: { isUsed: false, user: null, usedBy: null },
          $unset: { usedAt: "", redemptionId: "" }
        }
      ).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error("student code redemption failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تفعيل المحتوى حالياً. حاول مرة أخرى أو تواصل مع الدعم." });
  }
};

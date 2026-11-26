const { json, method, collectionName } = require("../_lib/auth");
const { requireAdmin } = require("../_lib/admin");

function makeProfile(admin) {
  const fullName = String(admin.fullName || admin.name || "").trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    name: fullName,
    firstName: String(admin.firstName || parts[0] || ""),
    lastName: String(admin.lastName || parts.slice(1).join(" ")),
    email: String(admin.email || ""),
    phone: String(admin.phone || admin.mobile || ""),
    avatarData: String(admin.avatarData || admin.avatarUrl || admin.photoUrl || admin.profileImage || ""),
    role: String(admin.role || "admin"),
    createdAt: admin.createdAt || null,
    updatedAt: admin.updatedAt || null
  };
}

module.exports = async function handler(req, res) {
  if (!["GET", "PUT"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT");
    return json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
  }

  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok: false, message: auth.message });

    const database = auth.database;
    const source = auth.session.authCollection || collectionName();
    const admins = database.collection(source);
    const current = await admins.findOne({ _id: auth.session.userId });
    if (!current) return json(res, 404, { ok: false, message: "لم يتم العثور على حساب المدير." });

    if (req.method === "GET") {
      return json(res, 200, {
        ok: true,
        user: makeProfile(current),
        siteUrl: process.env.APP_URL || ""
      });
    }

    const firstName = String(req.body?.firstName || "").trim().slice(0, 80);
    const lastName = String(req.body?.lastName || "").trim().slice(0, 100);
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
    const phone = String(req.body?.phone || "").trim().slice(0, 32);

    if (firstName.length < 2 || lastName.length < 2) {
      return json(res, 400, { ok: false, message: "أدخل الاسم الأول واسم العائلة بشكل صحيح." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { ok: false, message: "أدخل بريداً إلكترونياً صحيحاً." });
    }

    const duplicateEmail = await admins.findOne({
      _id: { $ne: current._id },
      email
    }, { projection: { _id: 1 } });
    if (duplicateEmail) {
      return json(res, 409, { ok: false, message: "هذا البريد الإلكتروني مستخدم بالفعل لحساب آخر." });
    }

    if (phone) {
      const duplicatePhone = await admins.findOne({
        _id: { $ne: current._id },
        $or: [{ phone }, { mobile: phone }]
      }, { projection: { _id: 1 } });
      if (duplicatePhone) {
        return json(res, 409, { ok: false, message: "رقم الهاتف مستخدم بالفعل لحساب آخر." });
      }
    }

    const fullName = firstName + " " + lastName;
    const update = {
      $set: {
        firstName,
        lastName,
        fullName,
        name: fullName,
        email,
        phone,
        mobile: phone,
        updatedAt: new Date()
      }
    };

    if (req.body?.avatarData !== undefined) {
      const avatarData = String(req.body.avatarData || "");
      if (avatarData.length > 500000) {
        return json(res, 413, { ok: false, message: "حجم الصورة بعد الضغط كبير. اختر صورة أصغر." });
      }
      if (avatarData && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatarData)) {
        return json(res, 400, { ok: false, message: "صيغة الصورة غير مدعومة." });
      }
      if (avatarData) update.$set.avatarData = avatarData;
      else update.$unset = { avatarData: "" };
    }

    await admins.updateOne({ _id: current._id }, update);
    const saved = await admins.findOne({ _id: current._id });
    return json(res, 200, {
      ok: true,
      message: "تم تحديث المعلومات الشخصية بنجاح.",
      user: makeProfile(saved)
    });
  } catch (error) {
    console.error("admin profile operation failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر تحديث الملف الشخصي حالياً." });
  }
};

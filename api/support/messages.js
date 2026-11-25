const { db, json, method } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const name = String(req.body?.name || "").trim().slice(0, 120);
    const phone = String(req.body?.phone || "").trim().slice(0, 40);
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 180);
    const message = String(req.body?.message || "").trim().slice(0, 5000);

    if (name.length < 2 || phone.length < 7 || message.length < 5) {
      return json(res, 400, { ok: false, message: "يرجى إدخال الاسم ورقم الهاتف ورسالة واضحة." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { ok: false, message: "صيغة البريد الإلكتروني غير صحيحة." });
    }

    const database = await db();
    const messages = database.collection(process.env.CONTACT_MESSAGES_COLLECTION || "contact_messages");
    const recent = await messages.findOne({
      phone,
      createdAt: { $gt: new Date(Date.now() - 60_000) }
    });
    if (recent) return json(res, 429, { ok: false, message: "تم استلام رسالة منك منذ قليل. يرجى الانتظار قبل الإرسال مرة أخرى." });

    const result = await messages.insertOne({
      name, phone, email: email || null, message,
      type: "contact",
      status: "new",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return json(res, 201, { ok: true, id: String(result.insertedId), message: "تم استلام رسالتك بنجاح، وسيقوم فريق الدعم بمراجعتها." });
  } catch (error) {
    console.error("support message save failed:", error.message);
    return json(res, 500, { ok: false, message: "تعذر إرسال الرسالة حالياً. حاول مرة أخرى لاحقاً." });
  }
};

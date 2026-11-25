const crypto = require("crypto");
const { db, collectionName, json, method, hashCode, required } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { ok:false, message:"أدخل بريداً إلكترونياً صحيحاً." });

    const database = await db();
    const users = database.collection(collectionName());
    const resets = database.collection("password_reset_codes");
    await resets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await resets.createIndex({ email: 1, createdAt: -1 });
    const recent = await resets.findOne({ email, createdAt: { $gt: new Date(Date.now() - 60_000) } });
    if (recent) return json(res, 429, { ok:false, message:"انتظر دقيقة قبل طلب كود جديد." });

    const user = await users.findOne({ email });
    // Do not reveal whether an email is registered.
    if (user) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      await resets.deleteMany({ email });
      await resets.insertOne({
        email, userId: user._id, codeHash: hashCode(code),
        attempts: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60_000)
      });

      const from = required("EMAIL_FROM");
      const apiKey = required("RESEND_API_KEY");
      const origin = process.env.APP_URL || "https://ali-alian-platform.vercel.app";
      const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body style="margin:0;background:#f3f5f8;font-family:Arial,Tahoma,sans-serif;padding:32px 12px;color:#1e293b"><div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #e2e8f0"><div style="background:linear-gradient(135deg,#279be4,#1579ba);padding:28px;text-align:center;color:#fff"><h1 style="margin:0;font-size:23px">منصة علي عليان الدولية</h1><p style="margin:8px 0 0">استعادة كلمة المرور</p></div><div style="padding:32px;text-align:center"><h2 style="font-size:20px">رمز التحقق</h2><p style="line-height:1.9;color:#64748b">استخدم الرمز التالي لإعادة تعيين كلمة المرور. الرمز صالح لمدة 10 دقائق ولمرة واحدة.</p><div style="direction:ltr;letter-spacing:10px;font-size:32px;font-weight:bold;color:#1289a7;background:#f0f9fc;border:1px dashed #8acbd9;border-radius:12px;padding:18px 10px;margin:24px 0">${code}</div><p style="font-size:12px;color:#94a3b8">إذا لم تطلب استعادة كلمة المرور، تجاهل هذه الرسالة.</p></div></div></body></html>`;
      const mail = await fetch("https://api.resend.com/emails", {
        method:"POST",
        headers:{ Authorization:`Bearer ${apiKey}`, "Content-Type":"application/json" },
        body:JSON.stringify({ from, to:[email], subject:"رمز استعادة كلمة المرور | منصة علي عليان الدولية", html })
      });
      if (!mail.ok) {
        const details = await mail.text();
        console.error("email provider error:", mail.status, details.slice(0, 500));
        await resets.deleteMany({ email });
        throw new Error("Email provider rejected the message");
      }
    }
    return json(res, 200, { ok:true, message:"إذا كان البريد مسجلاً لدينا فسيصلك رمز التحقق خلال لحظات." });
  } catch (error) {
    console.error("forgot password failed:", error.message);
    return json(res, 500, { ok:false, message:"تعذر إرسال رمز التحقق حالياً. راجع إعدادات البريد والخادم." });
  }
};

const { required } = require("./auth");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function codeEmailTemplate({ name, code, purpose }) {
  const registration = purpose === "registration";
  const heading = registration ? "تأكيد البريد الإلكتروني" : "استعادة كلمة المرور";
  const intro = registration
    ? "أدخل رمز التأكيد التالي لإكمال إنشاء حسابك على المنصة."
    : "استخدم رمز التحقق التالي لإعادة تعيين كلمة المرور الخاصة بحسابك.";
  const note = registration
    ? "لن يتم إنشاء حساب الطالب وتفعيله إلا بعد تأكيد البريد الإلكتروني."
    : "إذا لم تطلب تغيير كلمة المرور، يمكنك تجاهل هذه الرسالة بأمان.";
  const subject = registration
    ? "تأكيد بريدك الإلكتروني | منصة علي عليان الدولية"
    : "رمز استعادة كلمة المرور | منصة علي عليان الدولية";
  const safeName = escapeHtml(name || "صديقنا");
  const safeCode = escapeHtml(code);
  const appUrl = escapeHtml(process.env.APP_URL || "https://alielian.com");
  const html = [
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:28px 12px;background:#f3f6fa;color:#1e293b;font-family:Tahoma,Arial,sans-serif">',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + heading + ' - رمز صالح لمدة 10 دقائق.</div>',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:580px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden">',
    '<tr><td style="padding:30px 24px;text-align:center;background:linear-gradient(135deg,#279be4 0%,#1c8ed6 55%,#1579ba 100%);color:#fff">',
    '<div style="width:54px;height:54px;line-height:54px;border-radius:16px;margin:0 auto 13px;background:#ffffff26;border:1px solid #ffffff55;font-size:27px">🎓</div>',
    '<div style="font-size:22px;font-weight:800">منصة علي عليان الدولية</div><div style="font-size:12px;margin-top:7px;color:#e8f6ff">TEACHING PORTALS</div></td></tr>',
    '<tr><td style="padding:32px 28px 24px;text-align:center">',
    '<div style="display:inline-block;padding:6px 13px;background:#eaf7fc;border:1px solid #d2eef7;border-radius:30px;color:#1289a7;font-size:11px;font-weight:bold">' + heading + '</div>',
    '<h1 style="font-size:22px;margin:18px 0 9px;color:#17324d">مرحباً ' + safeName + '</h1>',
    '<p style="font-size:14px;line-height:2;color:#64748b;margin:0 auto;max-width:430px">' + intro + '</p>',
    '<div style="margin:26px auto 20px;padding:20px 12px;background:#f0f9fc;border:1px dashed #79bfd1;border-radius:15px;max-width:390px">',
    '<div style="font-size:11px;color:#64748b;margin-bottom:12px">رمز التحقق الخاص بك</div>',
    '<div dir="ltr" style="font-family:Arial,sans-serif;font-size:36px;line-height:1.2;letter-spacing:12px;font-weight:800;color:#087f9c;padding-left:12px">' + safeCode + '</div></div>',
    '<div style="display:inline-block;padding:8px 13px;border-radius:8px;background:#fff8e8;color:#97630b;font-size:12px;font-weight:bold">⏱ الرمز صالح لمدة 10 دقائق فقط</div>',
    '<p style="font-size:12px;line-height:1.9;color:#94a3b8;margin:22px auto 0;max-width:430px">' + note + '</p></td></tr>',
    '<tr><td style="padding:18px 22px;background:#f8fafc;border-top:1px solid #e8eef4;text-align:center">',
    '<a href="' + appUrl + '" style="font-size:12px;color:#1289a7;text-decoration:none;font-weight:bold">alielian.com</a>',
    '<div style="font-size:10px;color:#a0acb8;margin-top:8px">© ' + new Date().getFullYear() + ' منصة علي عليان الدولية — جميع الحقوق محفوظة</div>',
    '</td></tr></table><p style="max-width:580px;margin:14px auto 0;text-align:center;color:#a0acb8;font-size:10px">هذه رسالة آلية، يرجى عدم الرد عليها.</p></body></html>'
  ].join("");
  const text = heading + "\nمرحباً " + (name || "") + "\n" + intro + "\nرمز التحقق: " + code + "\nالرمز صالح لمدة 10 دقائق.\n" + note + "\nمنصة علي عليان الدولية";
  return { subject, html, text };
}

async function sendCodeEmail({ to, name, code, purpose }) {
  const template = codeEmailTemplate({ name, code, purpose });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + required("RESEND_API_KEY"),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: required("EMAIL_FROM"),
      to: [to],
      subject: template.subject,
      html: template.html,
      text: template.text
    })
  });
  if (!response.ok) {
    const details = await response.text();
    console.error("email provider error:", response.status, details.slice(0, 500));
    throw new Error("Email provider rejected the message");
  }
  return response.json().catch(() => ({}));
}

module.exports = { sendCodeEmail, codeEmailTemplate, escapeHtml };

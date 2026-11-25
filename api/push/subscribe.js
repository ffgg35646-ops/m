const crypto = require("crypto");
const { db, json, method } = require("../_lib/auth");

module.exports = async function handler(req,res) {
  if (!method(req,res,"POST")) return;
  try {
    const token = String(req.headers.cookie || "").split(";").map(x=>x.trim()).find(x=>x.startsWith("ali_admin_session="))?.slice("ali_admin_session=".length);
    if (!token) return json(res,401,{ok:false,message:"سجّل الدخول أولاً لتفعيل إشعارات الهاتف."});
    const database = await db();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await database.collection("auth_sessions").findOne({tokenHash,expiresAt:{$gt:new Date()}});
    if (!session) return json(res,401,{ok:false,message:"انتهت جلسة الدخول."});
    if (["admin","super_admin","owner","administrator"].includes(String(session.role).toLowerCase())) {
      return json(res,403,{ok:false,message:"تسجيل هذا الجهاز مخصص لحسابات الطلاب وأولياء الأمور."});
    }
    const subscription = req.body?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return json(res,400,{ok:false,message:"بيانات اشتراك الهاتف غير مكتملة."});
    }
    const name = process.env.PUSH_SUBSCRIPTIONS_COLLECTION || "push_subscriptions";
    await database.collection(name).updateOne(
      {endpoint:subscription.endpoint},
      {$set:{userId:session.userId,subscription,endpoint:subscription.endpoint,updatedAt:new Date()} ,$setOnInsert:{createdAt:new Date()}},
      {upsert:true}
    );
    return json(res,200,{ok:true,message:"تم تفعيل إشعارات هذا الجهاز."});
  } catch(error) {
    console.error("push subscription failed:",error.message);
    return json(res,500,{ok:false,message:"تعذر تسجيل هذا الجهاز حالياً."});
  }
};

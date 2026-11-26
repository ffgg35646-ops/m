const crypto = require("crypto");
const { db,json,method } = require("../_lib/auth");
const { ObjectId } = require("mongodb");

module.exports = async function handler(req,res) {
  if (!method(req,res,"POST")) return;
  try {
    const token = String(req.headers.cookie || "").split(";").map(x=>x.trim()).find(x=>x.startsWith("ali_admin_session="))?.slice("ali_admin_session=".length);
    if (!token) return json(res,401,{ok:false,message:"سجّل الدخول أولاً."});
    const database = await db();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await database.collection("auth_sessions").findOne({tokenHash,expiresAt:{$gt:new Date()}});
    if (!session) return json(res,401,{ok:false,message:"انتهت جلسة الدخول."});
    const id = String(req.body?.id || "");
    if (!/^[a-fA-F0-9]{24}$/.test(id)) return json(res,400,{ok:false,message:"معرف الإشعار غير صحيح."});
    const result = await database.collection(process.env.NOTIFICATIONS_COLLECTION || "notifications").updateOne(
      {_id:new ObjectId(id),userId:session.userId},
      {$addToSet:{readBy:session.userId},$set:{updatedAt:new Date()}}
    );
    return json(res,result.matchedCount?200:404,{ok:Boolean(result.matchedCount),message:result.matchedCount?"تم تحديث حالة الإشعار.":"الإشعار غير موجود."});
  } catch(error) {
    console.error("mark notification read failed:",error.message);
    return json(res,500,{ok:false,message:"تعذر تحديث الإشعار."});
  }
};

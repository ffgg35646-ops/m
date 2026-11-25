const crypto = require("crypto");
const { db,json,method } = require("../_lib/auth");

module.exports = async function handler(req,res) {
  if (!method(req,res,"GET")) return;
  try {
    const token = String(req.headers.cookie || "").split(";").map(x=>x.trim()).find(x=>x.startsWith("ali_admin_session="))?.slice("ali_admin_session=".length);
    if (!token) return json(res,401,{ok:false,message:"سجّل الدخول لعرض الإشعارات."});
    const database = await db();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await database.collection("auth_sessions").findOne({tokenHash,expiresAt:{$gt:new Date()}});
    if (!session) return json(res,401,{ok:false,message:"انتهت جلسة الدخول."});
    const notices = await database.collection(process.env.NOTIFICATIONS_COLLECTION || "notifications")
      .find({userId:session.userId}).sort({createdAt:-1}).limit(100).toArray();
    return json(res,200,{ok:true,notifications:notices.map(item=>({
      id:String(item._id),title:item.title || "إشعار من إدارة المنصة",body:item.body || item.message || "",
      href:item.href || "dashboard.html",createdAt:item.createdAt || null,
      read:Array.isArray(item.readBy) && item.readBy.some(id=>String(id)===String(session.userId))
    }))});
  } catch(error) {
    console.error("student notification inbox failed:",error.message);
    return json(res,500,{ok:false,message:"تعذر تحميل الإشعارات."});
  }
};

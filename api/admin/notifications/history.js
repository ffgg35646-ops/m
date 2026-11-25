const { json, method } = require("../../_lib/auth");
const { requireAdmin } = require("../../_lib/admin");

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok:false, message:auth.message });
    const db = auth.database;
    const name = process.env.NOTIFICATION_BATCHES_COLLECTION || "notification_batches";
    const exists = await db.listCollections({name},{nameOnly:true}).toArray();
    if (!exists.length) return json(res,200,{ok:true,history:[]});
    const rows = await db.collection(name).find({}).sort({createdAt:-1}).limit(100).toArray();
    return json(res,200,{ok:true,history:rows.map(row=>({
      id:String(row._id),message:row.message || "",studentsCount:row.studentCount ?? row.recipientCount ?? 0,
      recipientCount:row.recipientCount ?? 0,parentCount:row.parentCount ?? 0,
      devicesCount:row.deviceCount ?? 0,delivered:row.pushDelivered ?? 0,
      failed:row.pushFailed ?? 0,pushStatus:row.pushStatus || "not_configured",
      time:row.createdAt || null
    }))});
  } catch(error) {
    console.error("notification history failed:",error.message);
    return json(res,500,{ok:false,message:"تعذر تحميل سجل الإشعارات."});
  }
};

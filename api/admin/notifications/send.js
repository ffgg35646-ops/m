const { json, method } = require("../../_lib/auth");
const { requireAdmin } = require("../../_lib/admin");

function relationIds(user) {
  const fields = ["parentUserId","guardianUserId","parentId","guardianId","parentIds","guardianIds","parents"];
  const result = [];
  for (const field of fields) {
    const value = user[field];
    const list = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of list) {
      const id = item && typeof item === "object"
        ? (typeof item.toHexString === "function" ? item.toHexString() : (item.userId || item._id || item.id))
        : item;
      if (id) result.push(String(id));
    }
  }
  return [...new Set(result)];
}

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok:false, message:auth.message });
    const message = String(req.body?.message || "").trim().slice(0, 2000);
    const studentIds = Array.isArray(req.body?.studentIds)
      ? [...new Set(req.body.studentIds.map(id => String(id).trim()).filter(Boolean))].slice(0, 500)
      : [];
    const includeParents = req.body?.includeParents !== false;
    if (message.length < 2) return json(res, 400, { ok:false, message:"اكتب نص الإشعار أولاً." });
    if (!studentIds.length) return json(res, 400, { ok:false, message:"حدد طالباً واحداً على الأقل." });

    const db = auth.database;
    const { ObjectId } = require("mongodb");
    const objectIds = studentIds.filter(id => /^[a-fA-F0-9]{24}$/.test(id)).map(id => new ObjectId(id));
    const usersName = process.env.USERS_COLLECTION || "users";
    const students = await db.collection(usersName).find({
      $or:[{_id:{$in:objectIds}},{_id:{$in:studentIds}}]
    }).toArray();
    if (students.length !== studentIds.length) {
      return json(res, 400, { ok:false, message:"بعض الطلاب المحددين لم يعودوا موجودين. حدّث قائمة الطلاب وحاول مرة أخرى." });
    }

    const recipients = new Map();
    for (const student of students) {
      recipients.set(String(student._id), { userId:student._id, studentId:student._id, role:"student" });
    }
    if (includeParents) {
      const parentIds = [...new Set(students.flatMap(relationIds))];
      const parentObjectIds = parentIds.filter(id => /^[a-fA-F0-9]{24}$/.test(id)).map(id => new ObjectId(id));
      const parentDocs = parentIds.length ? await db.collection(usersName).find({
        $or:[{_id:{$in:parentObjectIds}},{_id:{$in:parentIds}}]
      }, {projection:{_id:1,role:1,accountType:1}}).toArray() : [];
      const parentById = new Map(parentDocs.map(parent => [String(parent._id), parent]));
      for (const student of students) {
        for (const id of relationIds(student)) {
          const parent = parentById.get(id);
          if (parent && !recipients.has(String(parent._id))) {
            recipients.set(String(parent._id), {userId:parent._id,studentId:student._id,role:"parent"});
          }
        }
      }
    }

    const now = new Date();
    const batchId = new ObjectId();
    const notificationsName = process.env.NOTIFICATIONS_COLLECTION || "notifications";
    const notifications = [...recipients.values()].map(recipient => ({
      userId:recipient.userId,
      studentId:recipient.studentId,
      title:"إشعار من إدارة المنصة",
      body:message,
      message,
      type:"admin_announcement",
      href:"dashboard.html",
      readBy:[],
      createdAt:now,
      updatedAt:now,
      batchId
    }));
    await db.collection(notificationsName).insertMany(notifications);

    const subscriptionsName = process.env.PUSH_SUBSCRIPTIONS_COLLECTION || "push_subscriptions";
    const subscriptionCollections = await db.listCollections({name:subscriptionsName},{nameOnly:true}).toArray();
    let deviceCount = 0;
    let delivered = 0;
    let failed = 0;
    let pushStatus = "not_configured";
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT && subscriptionCollections.length) {
      const webpush = require("web-push");
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      const recipientIds = [...recipients.keys()];
      const subscriptionDocs = await db.collection(subscriptionsName).find({
        $or:[
          {userId:{$in:recipientIds}},
          {userId:{$in:recipientIds.filter(id=>/^[a-fA-F0-9]{24}$/.test(id)).map(id=>new ObjectId(id))}}
        ]
      }).limit(5000).toArray();
      deviceCount = subscriptionDocs.length;
      const payload = JSON.stringify({ title:"منصة علي عليان الدولية", body:message, url:"dashboard.html" });
      const outcomes = await Promise.all(subscriptionDocs.map(async doc => {
        const subscription = doc.subscription || doc;
        if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) return {ok:false, doc, invalid:true};
        try { await webpush.sendNotification(subscription,payload); return {ok:true}; }
        catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await db.collection(subscriptionsName).deleteOne({_id:doc._id});
          }
          return {ok:false, doc};
        }
      }));
      delivered = outcomes.filter(item=>item.ok).length;
      failed = outcomes.filter(item=>!item.ok).length;
      pushStatus = deviceCount === 0 ? "no_devices" : failed === 0 ? "sent" : delivered > 0 ? "partial" : "failed";
    } else if (subscriptionCollections.length) {
      deviceCount = await db.collection(subscriptionsName).countDocuments({
        $or:[
          {userId:{$in:[...recipients.keys()]}},
          {userId:{$in:[...recipients.keys()].filter(id=>/^[a-fA-F0-9]{24}$/.test(id)).map(id=>new ObjectId(id))}}
        ]
      });
    }

    const batchName = process.env.NOTIFICATION_BATCHES_COLLECTION || "notification_batches";
    const batch = {
      _id:batchId,
      message,
      studentIds:students.map(student=>student._id),
      recipientCount:recipients.size,
      studentCount:students.length,
      parentCount:Math.max(0,recipients.size-students.length),
      deviceCount,
      pushDelivered:delivered,
      pushFailed:failed,
      pushStatus,
      includeParents,
      status:"saved",
      createdAt:now,
      createdBy:auth.admin._id
    };
    await db.collection(batchName).insertOne(batch);
    return json(res, 201, {
      ok:true,
      message: pushStatus === "not_configured"
        ? "تم حفظ الإشعار في جرس حسابات المستلمين. إشعارات الهاتف لم تُفعّل بعد؛ يلزم إعداد مفاتيح Web Push وتسجيل أجهزة الطلاب."
        : `تم حفظ الإشعار. نجاح إرسال الهاتف: ${delivered}، تعذر: ${failed}.`,
      result:{studentCount:students.length,recipientCount:recipients.size,parentCount:batch.parentCount,deviceCount,delivered,failed,pushStatus}
    });
  } catch (error) {
    console.error("admin notification send failed:", error.message);
    return json(res, 500, { ok:false, message:"تعذر إرسال الإشعار. تحقق من ربط قاعدة البيانات وخدمة الإشعارات." });
  }
};

const { json } = require("../_lib/auth");
const { requireAdmin } = require("../_lib/admin");
const { ObjectId } = require("mongodb");
const CODES = process.env.CENTER_CODES_COLLECTION || "center_codes";
const COURSE = process.env.COURSES_COLLECTION || "courses";
const LIVE = process.env.LIVE_SESSIONS_COLLECTION || "live_sessions";
const LIBRARY = process.env.LIBRARY_PRODUCTS_COLLECTION || process.env.LIBRARY_COLLECTION || "library_products";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const clean = (v,n=200)=>String(v??"").trim().slice(0,n);
const expired = d=>!!d && new Date(d+"T23:59:59").getTime()<Date.now();
const status = x=>x.isUsed?"مستخدم":expired(x.expiresAt)?"منتهي":"متاح";
const randomCode = ()=>Array.from({length:10},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join("");
const publicCode = x=>({id:String(x._id),code:x.code,description:x.description||"",targetType:x.targetType||"courses",targetId:x.targetId||"",content:x.content||[],expiresAt:x.expiresAt||"",isUsed:!!x.isUsed,user:x.user||null,usedBy:x.usedBy||null,status:status(x),createdAt:x.createdAt||null});
async function targets(db){
 const [c,l,b]=await Promise.all([
  db.collection(COURSE).find({deletedAt:{$exists:false},status:{$nin:["deleted","محذوف"]}},{projection:{title:1,name:1,isActive:1,status:1}}).sort({sortOrder:1,createdAt:-1}).limit(1000).toArray(),
  db.collection(LIVE).find({},{projection:{title:1,name:1,isActive:1,status:1}}).sort({createdAt:-1}).limit(500).toArray().catch(()=>[]),
  db.collection(LIBRARY).find({},{projection:{title:1,name:1,isActive:1,status:1}}).sort({createdAt:-1}).limit(500).toArray().catch(()=>[])
 ]);
 const map=a=>a.map(x=>({id:String(x._id),title:clean(x.title||x.name),active:x.isActive!==false&&x.status!=="inactive"}));
 return {courses:map(c),live:map(l),library:map(b)};
}
module.exports=async function(req,res){
 try{
  const p=req.method==="GET"?{section:"المبيعات والإيرادات",module:"أكواد السنتر",action:"عرض"}:{section:"المبيعات والإيرادات",module:"أكواد السنتر",action:"تعديل"};
  const auth=await requireAdmin(req,p);if(!auth.ok)return json(res,auth.status,{ok:false,message:auth.message});
  const col=auth.database.collection(CODES);
  if(req.method==="GET"){
   const [rows,list]=await Promise.all([col.find({deletedAt:{$exists:false}}).sort({createdAt:-1}).limit(5000).toArray(),targets(auth.database)]);
   return json(res,200,{ok:true,codes:rows.map(publicCode),targets:list});
  }
  if(req.method!=="POST"){res.setHeader("Allow","GET, POST");return json(res,405,{ok:false,message:"طريقة الطلب غير مدعومة."});}
  const action=clean(req.body?.action,20);
  if(action==="create"){
   const count=Math.min(1000,Math.max(1,Number(req.body.count)||1));
   if(count>1&&clean(req.body.code))return json(res,400,{ok:false,message:"الكود المخصص متاح عند إنشاء كود واحد فقط."});
   const type=["courses","live","library"].includes(req.body.targetType)?req.body.targetType:"courses";
   const targetId=clean(req.body.targetId,100);if(!targetId)return json(res,400,{ok:false,message:"اختر المحتوى الذي يفتحه الكود."});
   const expiresAt=clean(req.body.expiresAt,10);if(expiresAt&&!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt))return json(res,400,{ok:false,message:"تاريخ الانتهاء غير صحيح."});
   const made=[];
   for(let i=0;i<count;i++){
    let code=clean(count===1?req.body.code:randomCode(),80)||randomCode();
    if(!/^[A-Za-z0-9_-]{3,80}$/.test(code))return json(res,400,{ok:false,message:"الكود يجب أن يتكون من 3 أحرف أو أرقام على الأقل."});
    let tries=0;while(await col.findOne({code:{$regex:"^"+code+"$",$options:"i"}})&&tries++<8)code=randomCode();
    if(tries>=8)return json(res,409,{ok:false,message:"تعذر توليد كود فريد."});
    const item={code,description:clean(req.body.description,1000),targetType:type,targetId,content:[clean(req.body.targetTitle,200)],expiresAt,isUsed:false,user:null,usedBy:null,createdAt:new Date(),createdBy:auth.admin._id};
    const result=await col.insertOne(item);made.push(publicCode({...item,_id:result.insertedId}));
   }
   return json(res,201,{ok:true,codes:made,message:"تم إنشاء "+made.length+" كود وحفظها في قاعدة البيانات."});
  }
  const id=clean(req.body.id,100);if(!id)return json(res,400,{ok:false,message:"معرف الكود مطلوب."});
  const query={_id:ObjectId.isValid(id)?new ObjectId(id):id,deletedAt:{$exists:false}};
  const current=await col.findOne(query);if(!current)return json(res,404,{ok:false,message:"الكود غير موجود."});
  if(action==="delete"){
   if(current.isUsed)return json(res,409,{ok:false,message:"لا يمكن حذف كود تم استخدامه حفاظاً على سجل التفعيل."});
   await col.updateOne(query,{$set:{deletedAt:new Date(),deletedBy:auth.admin._id}});
   return json(res,200,{ok:true,message:"تم حذف الكود."});
  }
  if(action==="update"){
   if(current.isUsed)return json(res,409,{ok:false,message:"لا يمكن تعديل كود مستخدم بالفعل."});
   const code=clean(req.body.code||current.code,80);
   if(!/^[A-Za-z0-9_-]{3,80}$/.test(code))return json(res,400,{ok:false,message:"صيغة الكود غير صحيحة."});
   if(await col.findOne({_id:{$ne:current._id},code:{$regex:"^"+code+"$",$options:"i"},deletedAt:{$exists:false}}))return json(res,409,{ok:false,message:"هذا الكود مستخدم بالفعل."});
   const type=["courses","live","library"].includes(req.body.targetType)?req.body.targetType:current.targetType;
   const expiresAt=clean(req.body.expiresAt,10);if(expiresAt&&!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt))return json(res,400,{ok:false,message:"تاريخ الانتهاء غير صحيح."});
   await col.updateOne(query,{$set:{code,description:clean(req.body.description,1000),targetType:type,targetId:clean(req.body.targetId,100),content:[clean(req.body.targetTitle,200)],expiresAt,updatedAt:new Date(),updatedBy:auth.admin._id}});
   return json(res,200,{ok:true,message:"تم تحديث الكود."});
  }
  return json(res,400,{ok:false,message:"الإجراء غير معروف."});
 }catch(e){console.error("center codes API:",e.message);return json(res,500,{ok:false,message:e.message||"تعذر تنفيذ العملية."});}
};
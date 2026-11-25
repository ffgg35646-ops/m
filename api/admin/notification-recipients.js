const { json, method } = require("../_lib/auth");
const { requireAdmin } = require("../_lib/admin");

function scalar(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    return String(value.name || value.title || value.label || value.courseName || value.groupName || value._id || "");
  }
  return "";
}
function values(...items) {
  const output = [];
  for (const item of items) {
    if (Array.isArray(item)) output.push(...item.map(scalar));
    else if (item !== undefined && item !== null) output.push(scalar(item));
  }
  return [...new Set(output.map(v => v.trim()).filter(Boolean))];
}
function text(user, keys) {
  for (const key of keys) {
    const value = user[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}
function relatedIds(user) {
  const keys = ["parentUserId","guardianUserId","parentId","guardianId","parentIds","guardianIds","parents"];
  const result = [];
  for (const key of keys) {
    const value = user[key];
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
  if (!method(req, res, "GET")) return;
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return json(res, auth.status, { ok:false, message:auth.message });
    const db = auth.database;
    const usersName = process.env.USERS_COLLECTION || "users";
    const userRows = await db.listCollections({ name: usersName }, { nameOnly:true }).toArray();
    if (!userRows.length) return json(res, 503, { ok:false, message:`مجموعة الطلاب "${usersName}" غير موجودة في قاعدة البيانات. اضبط USERS_COLLECTION في Vercel.` });

    const projection = {
      name:1, fullName:1, firstName:1, lastName:1, email:1, phone:1, mobile:1, phoneNumber:1,
      role:1, accountType:1, type:1, status:1, isActive:1, active:1,
      category:1, gradeCategory:1, schoolCategory:1, grade:1, schoolYear:1, year:1,
      course:1, courseName:1, courses:1, courseIds:1, enrollments:1,
      group:1, groupName:1, groups:1, groupIds:1,
      parentUserId:1, guardianUserId:1, parentId:1, guardianId:1, parentIds:1, guardianIds:1, parents:1
    };
    const users = await db.collection(usersName).find({}, { projection }).sort({ createdAt:-1 }).limit(2000).toArray();
    const excluded = new Set(["admin","super_admin","owner","administrator","teacher","instructor","parent","guardian","support","accountant","manager","مدير","مدير النظام","معلم","مدرس","ولي أمر"]);
    const desiredRole = String(process.env.STUDENT_ROLE_VALUE || "").trim().toLowerCase();
    const students = users.filter(user => {
      const role = String(user.role || user.accountType || user.type || "").trim().toLowerCase();
      if (role && excluded.has(role)) return false;
      if (desiredRole && role !== desiredRole) return false;
      if (user.isActive === false || user.active === false || ["blocked","deleted","محظور","محذوف"].includes(String(user.status || "").toLowerCase())) return false;
      return true;
    });


    const studentIds = students.map(user => user._id);
    const studentIdStrings = studentIds.map(id => String(id));
    const { ObjectId } = require("mongodb");
    const studentObjectIds = studentIdStrings.filter(id => /^[a-fA-F0-9]{24}$/.test(id)).map(id => new ObjectId(id));
    const relatedFilter = {
      $or: [
        { userId: { $in: studentIds } }, { userId: { $in: studentIdStrings } },
        { studentId: { $in: studentIds } }, { studentId: { $in: studentIdStrings } },
        { studentIds: { $in: studentObjectIds } }, { studentIds: { $in: studentIdStrings } },
        { students: { $in: studentObjectIds } }, { students: { $in: studentIdStrings } },
        { memberIds: { $in: studentObjectIds } }, { memberIds: { $in: studentIdStrings } },
        { members: { $in: studentObjectIds } }, { members: { $in: studentIdStrings } }
      ]
    };
    const hasCollection = async name => (await db.listCollections({ name }, { nameOnly:true }).toArray()).length > 0;
    const enrollmentName = process.env.STUDENT_ENROLLMENTS_COLLECTION || process.env.ENROLLMENTS_COLLECTION || "enrollments";
    const groupCollectionName = process.env.STUDENT_GROUPS_COLLECTION || "groups";
    const courseCollectionName = process.env.COURSES_COLLECTION || "courses";
    const [hasEnrollments, hasGroups, hasCourses] = await Promise.all([
      hasCollection(enrollmentName), hasCollection(groupCollectionName), hasCollection(courseCollectionName)
    ]);
    const [enrollmentRows, groupRows] = await Promise.all([
      hasEnrollments ? db.collection(enrollmentName).find(relatedFilter, {
        projection:{userId:1,studentId:1,course:1,courseName:1,courseTitle:1,courseId:1,group:1,groupName:1,status:1}
      }).limit(10000).toArray() : [],
      hasGroups ? db.collection(groupCollectionName).find(relatedFilter, {
        projection:{name:1,title:1,groupName:1,userId:1,studentId:1,studentIds:1,students:1,memberIds:1,members:1}
      }).limit(5000).toArray() : []
    ]);

    const courseIds = new Set();
    for (const user of students) {
      values(user.courseIds).forEach(id => courseIds.add(id));
      values(user.courses).forEach(item => {
        if (/^[a-fA-F0-9]{24}$/.test(item)) courseIds.add(item);
      });
    }
    for (const row of enrollmentRows) {
      const id = scalar(row.courseId);
      if (/^[a-fA-F0-9]{24}$/.test(id)) courseIds.add(id);
    }
    const courseIdValues = [...courseIds];
    const courseObjectIds = courseIdValues.map(id => new ObjectId(id));
    const courseRows = hasCourses && courseObjectIds.length
      ? await db.collection(courseCollectionName).find({_id:{$in:courseObjectIds}}, {projection:{name:1,title:1,courseName:1}}).toArray()
      : [];
    const courseNameById = new Map(courseRows.map(row => [String(row._id), row.title || row.name || row.courseName || ""]));

    const relatedByStudent = new Map(studentIdStrings.map(id => [id,{courses:[],groups:[]}]));
    const addRelated = (recordId, key, value) => {
      const id = String(recordId || "");
      if (!relatedByStudent.has(id) || !value) return;
      relatedByStudent.get(id)[key].push(value);
    };
    for (const row of enrollmentRows) {
      const studentId = row.studentId || row.userId;
      const name = scalar(row.courseName) || scalar(row.courseTitle) || scalar(row.course);
      const courseId = scalar(row.courseId);
      addRelated(studentId,"courses",name || courseNameById.get(courseId));
      addRelated(studentId,"groups",scalar(row.groupName) || scalar(row.group));
    }
    for (const group of groupRows) {
      const name = scalar(group.name) || scalar(group.title) || scalar(group.groupName);
      if (!name) continue;
      const members = [];
      for (const key of ["userId","studentId","studentIds","students","memberIds","members"]) {
        const val = group[key];
        for (const item of (Array.isArray(val) ? val : val ? [val] : [])) {
          const id = item && typeof item === "object" ? (item.userId || item._id || item.id) : item;
          if (id) members.push(String(id));
        }
      }
      for (const id of members) addRelated(id,"groups",name);
    }

    const allSubscriptionIds = new Set();
    for (const student of students) {
      allSubscriptionIds.add(String(student._id));
      relatedIds(student).forEach(id => allSubscriptionIds.add(id));
    }
    const subName = process.env.PUSH_SUBSCRIPTIONS_COLLECTION || "push_subscriptions";
    const subExists = await db.listCollections({ name:subName }, { nameOnly:true }).toArray();
    let subscriptions = [];
    if (subExists.length && allSubscriptionIds.size) {
      const ids = [...allSubscriptionIds];
      const { ObjectId } = require("mongodb");
      const objectIds = ids.filter(id => /^[a-fA-F0-9]{24}$/.test(id)).map(id => new ObjectId(id));
      subscriptions = await db.collection(subName).find({
        $or: [{ userId:{ $in:ids } }, { userId:{ $in:objectIds } }]
      }, { projection:{ userId:1 } }).limit(10000).toArray();
    }
    const deviceCounts = new Map();
    for (const sub of subscriptions) {
      if (sub.userId) deviceCounts.set(String(sub.userId), (deviceCounts.get(String(sub.userId)) || 0) + 1);
    }

    const records = students.map(user => {
      const linked = relatedByStudent.get(String(user._id)) || {courses:[],groups:[]};
      const courseNames = values(user.course, user.courseName, user.courses, user.enrollments, linked.courses);
      const groupNames = values(user.group, user.groupName, user.groups, linked.groups);
      for (const id of values(user.courseIds)) {
        if (courseNameById.has(id)) courseNames.push(courseNameById.get(id));
      }
      const category = text(user, ["category","gradeCategory","schoolCategory"]);
      const grade = text(user, ["grade","schoolYear","year"]);
      const name = text(user, ["fullName","name"]) || [user.firstName,user.lastName].filter(Boolean).join(" ") || user.email || "طالب";
      const parents = relatedIds(user);
      const devices = (deviceCounts.get(String(user._id)) || 0) + parents.reduce((sum,id)=>sum+(deviceCounts.get(id)||0),0);
      return {
        id:String(user._id), name, email:user.email || "", phone:user.phone || user.mobile || user.phoneNumber || "",
        category, grade, courses:courseNames, groups:groupNames, devices, parentCount:parents.length
      };
    });

    const distinct = key => [...new Set(records.flatMap(item => item[key] || []).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
    return json(res, 200, {
      ok:true,
      students:records,
      filters:{ courses:distinct("courses"), categories:distinct("category"), grades:distinct("grade"), groups:distinct("groups") },
      total:records.length,
      capped:users.length >= 2000
    });
  } catch (error) {
    console.error("admin notification recipients failed:", error.message);
    return json(res, 500, { ok:false, message:"تعذر تحميل الطلاب. تحقق من USERS_COLLECTION وبنية حسابات الطلاب." });
  }
};

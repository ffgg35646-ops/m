const crypto = require("crypto");
const { db, collectionName, json, method } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  try {
    const token = String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith("ali_admin_session="))?.slice("ali_admin_session=".length);
    if (!token) return json(res, 401, { ok:false });
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const database = await db();
    const session = await database.collection("auth_sessions").findOne({ tokenHash, expiresAt: { $gt: new Date() } });
    if (!session) return json(res, 401, { ok:false });
    const user = await database.collection(collectionName()).findOne({ _id: session.userId }, { projection:{ email:1, name:1, role:1 } });
    if (!user) return json(res, 401, { ok:false });
    return json(res, 200, { ok:true, user:{ email:user.email, name:user.name || "", role:user.role || "admin" } });
  } catch (error) {
    console.error("session check failed:", error.message);
    return json(res, 500, { ok:false });
  }
};

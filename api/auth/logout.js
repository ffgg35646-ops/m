const crypto = require("crypto");
const { db, json, method } = require("../_lib/auth");

module.exports = async function handler(req, res) {
  if (!method(req, res, "POST")) return;
  try {
    const token = String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith("ali_admin_session="))?.slice("ali_admin_session=".length);
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const database = await db();
      await database.collection("auth_sessions").deleteOne({ tokenHash });
    }
    res.setHeader("Set-Cookie", "ali_admin_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    return json(res, 200, { ok:true });
  } catch (error) {
    console.error("logout failed:", error.message);
    return json(res, 500, { ok:false });
  }
};

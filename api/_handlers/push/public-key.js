const { json, method } = require("../_lib/auth");
module.exports = async function handler(req,res) {
  if (!method(req,res,"GET")) return;
  const key = process.env.VAPID_PUBLIC_KEY || "";
  return json(res,200,{ok:true,enabled:Boolean(key),publicKey:key});
};

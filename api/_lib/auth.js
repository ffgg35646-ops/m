const { MongoClient } = require("mongodb");
const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
let clientPromise;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function db() {
  if (!clientPromise) {
    const client = new MongoClient(required("MONGODB_URI"));
    clientPromise = client.connect();
  }
  const client = await clientPromise;
  return client.db(required("MONGODB_DB"));
}

function collectionName() {
  return process.env.AUTH_COLLECTION || "admins";
}

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}

function method(req, res, expected) {
  if (req.method !== expected) {
    res.setHeader("Allow", expected);
    json(res, 405, { ok: false, message: "طريقة الطلب غير مدعومة." });
    return false;
  }
  return true;
}

function hashCode(code) {
  return crypto.createHmac("sha256", required("RESET_CODE_SECRET")).update(code).digest("hex");
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return { passwordHash: derived.toString("hex"), passwordSalt: salt };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { db, collectionName, json, method, hashCode, hashPassword, safeEqual, required };

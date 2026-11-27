"use strict";

const { ObjectId } = require("mongodb");
const { db, json, method } = require("../_lib/auth");

const POSTS = process.env.BLOG_POSTS_COLLECTION || "blog_posts";

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  const id = String(req.query?.postId || "").trim().slice(0, 100);
  if (!id) return json(res, 400, { ok: false, message: "معرف المقال مطلوب." });

  try {
    const selectors = [{ _id: id }];
    if (ObjectId.isValid(id)) selectors.push({ _id: new ObjectId(id) });
    const database = await db();
    const post = await database.collection(POSTS).findOne({
      $and: [
        { $or: selectors },
        { status: "published" },
        { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] }
      ]
    }, {
      projection: { image: 1, imageUrl: 1, status: 1, deletedAt: 1 }
    });

    if (!post) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }
    const source = String(post.imageUrl || post.image || "");
    const match = source.match(/^data:image\/(jpeg|png|webp);base64,([a-z0-9+/]+=*)$/i);
    if (!match) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }

    const image = Buffer.from(match[2], "base64");
    if (!image.length || image.length > 300000) {
      res.statusCode = 413;
      res.setHeader("Cache-Control", "no-store");
      return res.end();
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/" + match[1].toLowerCase());
    res.setHeader("Content-Length", String(image.length));
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(image);
  } catch (error) {
    console.error("public blog image failed:", error.message);
    res.statusCode = 500;
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }
};
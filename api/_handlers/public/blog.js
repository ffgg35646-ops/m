"use strict";

const { ObjectId } = require("mongodb");
const { db, json, method } = require("../_lib/auth");

const POSTS = process.env.BLOG_POSTS_COLLECTION || "blog_posts";
const CATEGORIES = process.env.BLOG_CATEGORIES_COLLECTION || "blog_categories";
const LIMIT = 300;

function value(input, max = 4000) {
  return String(input ?? "").trim().slice(0, max);
}

function publishedQuery(selectors = null) {
  const conditions = [
    { status: "published" },
    { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] }
  ];
  if (selectors) conditions.push({ $or: selectors });
  return { $and: conditions };
}

function publicImage(input, postId) {
  const image = value(input, 380010);
  if (!image) return "";
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(image)) {
    return "/api/public/blog-image?postId=" + encodeURIComponent(postId);
  }
  if (image.startsWith("/") && !image.startsWith("//")) return image;
  try {
    const parsed = new URL(image);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function publicPost(row, categoryMap = new Map(), includeContent = false) {
  const id = String(row._id);
  const categoryId = value(row.categoryId, 100);
  const category = categoryMap.get(categoryId) || value(row.tag || row.categoryName, 140);
  const post = {
    id,
    title: value(row.title, 240),
    excerpt: value(row.excerpt, 1200),
    image: publicImage(row.imageUrl || row.image, id),
    categoryId,
    category,
    publishedAt: row.publishedAt || null,
    createdAt: row.createdAt || null
  };
  if (includeContent) post.content = value(row.content, 100000);
  return post;
}

module.exports = async function handler(req, res) {
  if (!method(req, res, "GET")) return;
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const database = await db();
    const postId = value(req.query?.postId, 100);
    if (postId) {
      const selectors = [{ _id: postId }];
      if (ObjectId.isValid(postId)) selectors.push({ _id: new ObjectId(postId) });
      const post = await database.collection(POSTS).findOne(publishedQuery(selectors), {
        projection: {
          title: 1, excerpt: 1, content: 1, image: 1, imageUrl: 1,
          categoryId: 1, tag: 1, categoryName: 1, publishedAt: 1, createdAt: 1
        }
      });
      if (!post) return json(res, 404, { ok: false, message: "المقال غير موجود أو لم يتم نشره." });
      const categoryMap = new Map();
      if (post.categoryId) {
        const category = await database.collection(CATEGORIES).findOne({
          _id: post.categoryId,
          $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }]
        }, { projection: { name: 1 } });
        if (category?.name) categoryMap.set(String(post.categoryId), value(category.name, 140));
      }
      return json(res, 200, { ok: true, post: publicPost(post, categoryMap, true) });
    }

    const [rows, categoryRows] = await Promise.all([
      database.collection(POSTS).find(publishedQuery(), {
        projection: {
          title: 1, excerpt: 1, image: 1, imageUrl: 1, categoryId: 1,
          tag: 1, categoryName: 1, publishedAt: 1, createdAt: 1, sortOrder: 1
        }
      }).sort({ publishedAt: -1, createdAt: -1, _id: -1 }).limit(LIMIT).toArray(),
      database.collection(CATEGORIES).find({
        $and: [
          { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] }
        ]
      }, { projection: { name: 1, sortOrder: 1, order: 1 } })
        .sort({ sortOrder: 1, order: 1, name: 1 }).limit(300).toArray()
    ]);

    const categoryMap = new Map(categoryRows.map(row => [String(row._id), value(row.name, 140)]));
    const posts = rows.map(row => publicPost(row, categoryMap, false)).filter(post => post.title);
    const usedCategoryIds = new Set(posts.map(post => post.categoryId).filter(Boolean));
    const categoryEntries = new Map();
    categoryRows
      .filter(row => usedCategoryIds.has(String(row._id)))
      .forEach(row => {
        const id = String(row._id);
        const name = value(row.name, 140);
        if (name) categoryEntries.set(id, { id, name });
      });
    posts.forEach(post => {
      if (!post.category) return;
      const id = post.categoryId || post.category;
      if (!categoryEntries.has(id)) categoryEntries.set(id, { id, name: post.category });
    });
    const categories = [...categoryEntries.values()];

    return json(res, 200, {
      ok: true,
      posts,
      categories,
      generatedAt: new Date().toISOString(),
      truncated: rows.length === LIMIT
    });
  } catch (error) {
    console.error("public blog failed:", error.message);
    return json(res, 503, {
      ok: false,
      message: "تعذر تحميل مقالات المدونة حالياً. يرجى المحاولة مرة أخرى."
    });
  }
};
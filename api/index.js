"use strict";

// Public API entrypoint. Original handlers are kept under _handlers so
// Vercel bundles them as private modules instead of creating one function
// per file. Existing frontend API URLs remain unchanged.
const routes = Object.freeze({
  "admin/academic-structure": require("./_handlers/admin/academic-structure"),
  "admin/blog-library": require("./_handlers/admin/blog-library"),
  "admin/center-codes": require("./_handlers/admin/center-codes"),
  "admin/courses": require("./_handlers/admin/courses"),
  "admin/dashboard": require("./_handlers/admin/dashboard"),
  "admin/exams": require("./_handlers/admin/exams"),
  "admin/messages": require("./_handlers/admin/messages"),
  "admin/messages/delete": require("./_handlers/admin/messages/delete"),
  "admin/notification-recipients": require("./_handlers/admin/notification-recipients"),
  "admin/notifications": require("./_handlers/admin/notifications"),
  "admin/notifications/delete": require("./_handlers/admin/notifications/delete"),
  "admin/notifications/history": require("./_handlers/admin/notifications/history"),
  "admin/notifications/send": require("./_handlers/admin/notifications/send"),
  "admin/profile": require("./_handlers/admin/profile"),
  "admin/profile/password": require("./_handlers/admin/profile/password"),
  "admin/settings": require("./_handlers/admin/settings"),
  "admin/users": require("./_handlers/admin/users"),
  "admin/users/reset-password": require("./_handlers/admin/users/reset-password"),
  "auth/forgot-password": require("./_handlers/auth/forgot-password"),
  "auth/login": require("./_handlers/auth/login"),
  "auth/logout": require("./_handlers/auth/logout"),
  "auth/me": require("./_handlers/auth/me"),
  "auth/register": require("./_handlers/auth/register"),
  "auth/request-admin-reset": require("./_handlers/auth/request-admin-reset"),
  "auth/reset-password": require("./_handlers/auth/reset-password"),
  "auth/verify-email": require("./_handlers/auth/verify-email"),
  "notifications/my": require("./_handlers/notifications/my"),
  "notifications/read": require("./_handlers/notifications/read"),
  "push/public-key": require("./_handlers/push/public-key"),
  "push/subscribe": require("./_handlers/push/subscribe"),
  "site-settings": require("./_handlers/site-settings"),
  "support/messages": require("./_handlers/support/messages"),
});

module.exports = async function apiRouter(req, res) {
  const captured = req.query && req.query.__apiRoute;
  const route = (Array.isArray(captured) ? captured.join("/") : String(captured || ""))
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.js$/i, "");

  const handler = routes[route];
  if (!handler) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, message: "API route not found" }));
  }

  return handler(req, res);
};

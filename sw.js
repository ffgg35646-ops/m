self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : "" }; }
  const title = payload.title || "منصة علي عليان الدولية";
  const options = {
    body: payload.body || "لديك إشعار جديد من المنصة.",
    icon: "/icons/icon.svg",
    badge: "/icons/icon.svg",
    data: { url: payload.url || "/dashboard.html" },
    dir: "rtl",
    lang: "ar"
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/dashboard.html", self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type:"window", includeUncontrolled:true });
    for (const client of clientsList) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});

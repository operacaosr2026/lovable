// Service worker do SRX Growth — SÓ notificações push.
// De propósito, sem cache e sem "fetch": o site continua sempre buscando a
// versão nova direto do servidor (nada de usuário preso em versão antiga).
// Registrado só quando a pessoa ativa as notificações (Configurações >
// Notificações).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "SRX Growth", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "SRX Growth";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    // Mesmo tag = substitui a anterior em vez de empilhar.
    renotify: Boolean(data.tag),
    data: { url: data.url || "/" },
  }));
});

// Toque na notificação: abre a tela do aviso (reaproveita a janela aberta).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  const url = new URL(raw, self.location.origin);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Link externo (ex.: pedido no admin da Shopify): abre fora.
    if (url.origin !== self.location.origin) return self.clients.openWindow(url.href);
    for (const w of wins) {
      if (new URL(w.url).origin === url.origin && "focus" in w) {
        await w.focus();
        if ("navigate" in w) return w.navigate(url.href);
        return;
      }
    }
    return self.clients.openWindow(url.href);
  })());
});

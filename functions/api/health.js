export function onRequestGet() {
  return Response.json({
    ok: true,
    service: "stop-scrolling",
    platform: "cloudflare-pages"
  });
}

/** Legacy crew links now stay in the race guide's location panel. */
export function crewLocationPage(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/#live",
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

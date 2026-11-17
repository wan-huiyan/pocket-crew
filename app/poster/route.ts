import source from "../../guide/index.html?raw";
import home from "../../guide/poster-home.html?raw";
import { renderPosterGuide } from "../../guide/poster-template.mjs";

export function GET() {
  return new Response(renderPosterGuide(source, home), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

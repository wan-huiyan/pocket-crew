import html from "../guide/index.html?raw";
export function GET(){ return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache","Referrer-Policy":"strict-origin-when-cross-origin","X-Content-Type-Options":"nosniff"}}); }

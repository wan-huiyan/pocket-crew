import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { renderPosterGuide } from "../guide/poster-template.mjs";
await mkdir(new URL("../public/", import.meta.url), {recursive:true});
await copyFile(new URL("../guide/index.html", import.meta.url),new URL("../public/index.html", import.meta.url));
await copyFile(new URL("../guide/index.html", import.meta.url),new URL("../public/crew.html", import.meta.url));
await copyFile(new URL("../guide/celebration-home.html", import.meta.url),new URL("../public/celebration.html", import.meta.url));
await mkdir(new URL("../public/poster/", import.meta.url), {recursive:true});
const [source, home] = await Promise.all([
  readFile(new URL("../guide/index.html", import.meta.url), "utf8"),
  readFile(new URL("../guide/poster-home.html", import.meta.url), "utf8")
]);
await writeFile(new URL("../public/poster/index.html", import.meta.url), renderPosterGuide(source, home));

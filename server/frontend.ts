import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../frontend/dist/", import.meta.url));
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export async function serveFrontend(pathname: string, response: ServerResponse): Promise<void> {
  try {
    const decoded = decodeURIComponent(pathname);
    const filename = resolve(directory, decoded === "/" ? "index.html" : `.${decoded}`);
    const contentType = contentTypes[extname(filename)];
    if (!filename.startsWith(`${resolve(directory)}${sep}`) || !contentType || decoded.includes("\0")) {
      throw new Error("Not found");
    }
    const body = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": extname(filename) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found. Run npm run build to generate the frontend.");
  }
}

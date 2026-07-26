import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultPort = Number(process.env.PORT || 8080);
const defaultHost = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

export function resolveRequestPath(url) {
  const requestedPath = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
  const filePath = normalize(join(root, relativePath));

  if (!filePath.startsWith(root)) {
    return null;
  }

  return filePath;
}

export function createStaticServer(options = {}) {
  const port = options.port ?? defaultPort;
  const host = options.host ?? defaultHost;
  const server = createServer((request, response) => {
    const filePath = resolveRequestPath(request.url || "/");

    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("404 Not Found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Try: PORT=8090 npm start`);
      process.exit(1);
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      console.error(`Cannot open ${host}:${port}. Try a different port: PORT=8090 npm start`);
      process.exit(1);
    }

    throw error;
  });

  return server;
}

export function startServer(options = {}) {
  return new Promise((resolve) => {
    const port = options.port ?? defaultPort;
    const host = options.host ?? defaultHost;
    const server = createStaticServer({ port, host });
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      console.log(`FleetWorks is running at http://localhost:${actualPort}/`);
      resolve(server);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

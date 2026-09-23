import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI arguments
const args = process.argv.slice(2);
let dir = 'dist';
let base = '/patchbay-claude/';
let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4173;
let host = '127.0.0.1';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' && i + 1 < args.length) {
    dir = args[++i];
  } else if (args[i] === '--base' && i + 1 < args.length) {
    base = args[++i];
  } else if (args[i] === '--port' && i + 1 < args.length) {
    port = parseInt(args[++i], 10);
  } else if (args[i] === '--host' && i + 1 < args.length) {
    host = args[++i];
  }
}

// Normalize base to have leading and trailing slash
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base = base + '/';

// Resolve dir relative to cwd
const resolvedDir = path.resolve(process.cwd(), dir);

// Content-Type map
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return contentTypes[ext] || 'application/octet-stream';
}

function decodeURIComponentSafe(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  // Only allow GET and HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Allow': 'GET, HEAD' });
    res.end();
    console.log(`405 ${req.method} ${req.url}`);
    return;
  }

  // Parse URL and strip query string
  let pathname;
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;
  } catch {
    res.writeHead(400);
    res.end();
    console.log(`400 ${req.method} ${req.url}`);
    return;
  }

  // Check if path is exactly base without trailing slash
  const baseWithoutTrailingSlash = base.slice(0, -1);
  if (pathname === baseWithoutTrailingSlash) {
    res.writeHead(301, { 'Location': base });
    res.end();
    console.log(`301 ${req.method} ${pathname}`);
    return;
  }

  // Check if path is under base
  if (!pathname.startsWith(base)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 outside base ${base}`);
    console.log(`404 ${req.method} ${pathname}`);
    return;
  }

  // Extract the relative path under base
  let relPath = pathname.slice(base.length);

  // Decode URI components safely
  const parts = relPath.split('/').map(part => {
    const decoded = decodeURIComponentSafe(part);
    if (decoded === null) {
      return null;
    }
    return decoded;
  });

  if (parts.includes(null)) {
    res.writeHead(400);
    res.end();
    console.log(`400 ${req.method} ${pathname}`);
    return;
  }

  relPath = parts.join('/');

  // Resolve the file path
  let filePath = path.join(resolvedDir, relPath);

  // Check for path traversal (ensure resolved path is inside resolvedDir)
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(resolvedDir + path.sep) && normalized !== resolvedDir) {
    res.writeHead(403);
    res.end();
    console.log(`403 ${req.method} ${pathname}`);
    return;
  }

  // Check if it's a directory or file
  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Cache-Control': 'no-cache' });
        res.end();
        console.log(`404 ${req.method} ${pathname}`);
      } else {
        res.writeHead(500);
        res.end();
        console.log(`500 ${req.method} ${pathname}`);
      }
      return;
    }

    // If it's a directory, serve index.html
    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      fs.readFile(indexPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Cache-Control': 'no-cache' });
          res.end();
          console.log(`404 ${req.method} ${pathname}`);
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          if (req.method !== 'HEAD') {
            res.write(data);
          }
          res.end();
          console.log(`200 ${req.method} ${pathname}`);
        }
      });
      return;
    }

    // It's a file, serve it
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Cache-Control': 'no-cache' });
        res.end();
        console.log(`404 ${req.method} ${pathname}`);
      } else {
        const contentType = getContentType(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
        });
        if (req.method !== 'HEAD') {
          res.write(data);
        }
        res.end();
        console.log(`200 ${req.method} ${pathname}`);
      }
    });
  });
});

server.listen(port, host, () => {
  console.log(`Serving ${resolvedDir} at http://${host}:${port}${base}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

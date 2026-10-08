// A small static server for site5's tests, rooted at the repo, on a free port. Node only, no dependencies.
// start() -> Promise<{ url(path), close() }>
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm' };
exports.start = () => new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel || 'index.html');
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }   // nothing outside the repo
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ url: p => `http://127.0.0.1:${port}/${p.replace(/^\/+/, '')}`, close: () => server.close() });
  });
});

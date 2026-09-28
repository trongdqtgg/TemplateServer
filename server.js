// Máy chủ mẫu điền form — định danh bằng số điện thoại (không mật khẩu)
// Dùng được 2 cách:
//   1. Trong ứng dụng khay hệ thống (main.js gọi startServer)
//   2. Chạy trực tiếp: npm run server   (cấu hình trong file .env, xem .env.example)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalizePhone(p) {
  let d = String(p || '').replace(/[\s.\-()]/g, '');
  if (d.startsWith('+84')) d = '0' + d.slice(3);
  else if (/^84\d{9,10}$/.test(d)) d = '0' + d.slice(2);
  return /^0\d{9,10}$/.test(d) ? d : '';
}

// Tách theo dấu phẩy / chấm phẩy / xuống dòng (không tách theo dấu cách: "0900 000 001" là một số)
const phoneSet = v => new Set(String(v || '').split(/[,;\n]+/).map(normalizePhone).filter(Boolean));

const readJSON = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
function writeJSON(f, v) {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, f); // ghi an toàn, không hỏng file nếu tắt giữa chừng
}

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => {
      d += c;
      if (d.length > 2e6) { reject(new HttpError(413, 'Dữ liệu quá lớn')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new HttpError(400, 'JSON không hợp lệ')); }
    });
  });
}

const cleanValue = v => Array.isArray(v) ? v.map(String)
  : typeof v === 'boolean' ? v
  : String(v ?? '');
// Loại ô đặc biệt: 'select' (danh sách chọn), 'date' (chọn ngày)
const cleanKind = k => ['select', 'date'].includes(k) ? k : undefined;

// Kiểm tra & làm sạch dữ liệu mẫu. 3 loại: form (điền cả form), macro (chuỗi thao tác), text (đoạn văn bản)
function clean(t) {
  const type = ['text', 'macro'].includes(t.type) ? t.type : 'form';
  const out = { type, name: String(t.name || '').trim().slice(0, 100) };
  if (!out.name) throw new HttpError(400, 'Thiếu tên mẫu');
  if (type === 'text') {
    out.text = String(t.text || '').slice(0, 20000);
    return out;
  }
  out.site = String(t.site || '').slice(0, 500);
  if (type === 'form') {
    out.fields = (Array.isArray(t.fields) ? t.fields : []).slice(0, 500).map(f => ({
      selector: String(f.selector || ''),
      label: String(f.label || '').slice(0, 200),
      value: cleanValue(f.value),
      kind: cleanKind(f.kind),
    })).filter(f => f.selector);
  } else {
    out.steps = (Array.isArray(t.steps) ? t.steps : []).slice(0, 1000).map(st => {
      const step = {
        action: ['set', 'select'].includes(st.action) ? st.action : 'click',
        selector: String(st.selector || ''),
        label: String(st.label || '').slice(0, 200),
      };
      if (step.action !== 'click') { step.value = cleanValue(st.value); step.kind = cleanKind(st.kind); }
      else { step.text = String(st.text || '').slice(0, 200); step.tag = String(st.tag || '').slice(0, 20); }
      return step;
    }).filter(st => st.selector);
  }
  return out;
}

// Địa chỉ mà máy khách dùng để gọi tới (qua tunnel là https://ten-mien-tunnel)
function originOf(req) {
  let proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  let host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  if (!['http', 'https'].includes(proto)) proto = 'http';
  if (!/^[\w.-]+(:\d{1,5})?$/.test(host)) host = 'localhost'; // chặn chèn ký tự lạ qua header
  return `${proto}://${host}`;
}

// Điền sẵn SERVER, @match, @connect và @updateURL vào userscript
function personalizeUserscript(src, origin, match) {
  const host = new URL(origin).hostname;
  const matches = String(match || '*://*/*').split(/[,\n]+/).map(m => m.trim()).filter(Boolean);
  return src
    .replace(/const SERVER = '[^']*';/, `const SERVER = '${origin}';`)
    .replace(/^\/\/ @match\s+.*$/m, matches.map(m => `// @match        ${m}`).join('\n'))
    .replace(/^\/\/ @connect\s+.*$/m, `// @connect      ${host}`)
    .replace(/^\/\/ @(updateURL|downloadURL)\s+.*\n/gm, '')
    .replace(/^\/\/ Nên đổi @match.*\n/m, '') // ghi chú cho người tự cài tay, không cần nữa
    .replace(/^\/\/ ==\/UserScript==$/m,
      `// @updateURL    ${origin}/caidat.user.js\n// @downloadURL  ${origin}/caidat.user.js\n// ==/UserScript==`);
}

/**
 * Khởi động máy chủ. Trả về { server, port, close() }.
 * opts: port, dataDir, adminPhones, allowedPhones, match, version, publicDir, userscriptPath
 */
function startServer(opts = {}) {
  const PORT = Number(opts.port) || 8787;
  const DATA_DIR = path.resolve(opts.dataDir || path.join(__dirname, 'data'));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const TPL = path.join(DATA_DIR, 'templates.json');
  const PAGE = path.join(opts.publicDir || path.join(__dirname, 'public'), 'index.html');
  const USERSCRIPT = opts.userscriptPath || path.join(__dirname, 'userscript', 'mau-dien-form.user.js');
  const VERSION = opts.version || require('./package.json').version;
  const MATCH = opts.match || '*://*/*';
  // Quản trị viên: quản lý mẫu dùng chung
  const ADMINS = phoneSet(opts.adminPhones);
  // Danh sách SĐT được phép (để trống = ai cũng dùng được). Quản trị viên luôn được phép.
  const ALLOWED = phoneSet(opts.allowedPhones);
  ADMINS.forEach(p => ALLOWED.size && ALLOWED.add(p));

  async function handle(req, res) {
    const p = new URL(req.url, 'http://localhost').pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return send(res, 200, fs.readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }
    // Kiểm tra máy chủ còn sống (dùng cho ứng dụng khay hệ thống)
    if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true, version: VERSION });
    // Userscript đã điền sẵn địa chỉ máy chủ; Tampermonkey tự kiểm tra cập nhật qua @updateURL
    // Link dễ nhớ để chia sẻ: /caidat (hoặc /caidat.js) chuyển sang /caidat.user.js,
    // vì Tampermonkey chỉ hiện nút cài khi đường dẫn kết thúc bằng ".user.js"
    if (req.method === 'GET' && ['/caidat', '/caidat/', '/caidat.js'].includes(p)) {
      res.writeHead(302, { Location: '/caidat.user.js', 'Cache-Control': 'no-store' });
      return res.end();
    }
    // /mau-dien-form.user.js: giữ lại để các máy đã cài theo link cũ vẫn tự cập nhật được
    if (req.method === 'GET' && (p === '/caidat.user.js' || p === '/mau-dien-form.user.js')) {
      const src = fs.readFileSync(USERSCRIPT, 'utf8');
      return send(res, 200, personalizeUserscript(src, originOf(req), MATCH), 'text/javascript; charset=utf-8');
    }

    // Định danh người dùng bằng SĐT gửi kèm mỗi yêu cầu
    if (!p.startsWith('/api/')) throw new HttpError(404, 'Không tìm thấy');
    const phone = normalizePhone(req.headers['x-phone']);
    if (!phone) throw new HttpError(400, 'Số điện thoại không hợp lệ');
    if (ALLOWED.size && !ALLOWED.has(phone)) throw new HttpError(403, 'Số điện thoại này chưa được phép dùng máy chủ mẫu');
    const isAdmin = ADMINS.has(phone);

    if (p === '/api/me' && req.method === 'GET') return send(res, 200, { phone, isAdmin });

    const m = p.match(/^\/api\/templates(?:\/([\w-]+))?(?:\/(share)(?:\/([^/]+))?)?$/);
    if (!m) throw new HttpError(404, 'Không tìm thấy');

    // Quyền:
    //  - Mẫu riêng: chủ sở hữu sửa; người được chia sẻ chỉ dùng
    //  - Mẫu dùng chung: ai cũng dùng, chỉ quản trị viên sửa
    const isOwner = t => t.phone === phone;
    const received = t => !t.shared && !isOwner(t) && (t.sharedWith || []).includes(phone);
    const canSee = t => t.shared || isOwner(t) || received(t);
    const canEdit = t => t.shared ? isAdmin : isOwner(t);
    const view = t => {
      const v = { ...t, mine: isOwner(t), canEdit: canEdit(t) };
      if (received(t)) v.sharedBy = t.phone;
      if (!isOwner(t)) delete v.sharedWith;       // không lộ SĐT của người nhận khác
      return v;
    };

    const [, id, share, target] = m;
    const list = readJSON(TPL, []);

    if (!id && req.method === 'GET') {
      const mine = list.filter(t => !t.shared && isOwner(t));
      const got = list.filter(received);
      const shared = list.filter(t => t.shared);
      return send(res, 200, [...mine, ...got, ...shared].map(view));
    }
    if (!id && req.method === 'POST') {
      const body = await readBody(req);
      if (body.shared && !isAdmin) throw new HttpError(403, 'Chỉ quản trị viên được tạo mẫu dùng chung');
      const t = { id: crypto.randomUUID(), phone, ...clean(body), shared: !!body.shared, sharedWith: [], updatedAt: Date.now() };
      list.push(t); writeJSON(TPL, list);
      return send(res, 201, view(t));
    }
    if (!id) throw new HttpError(405, 'Phương thức không hỗ trợ');

    const i = list.findIndex(t => t.id === id && canSee(t));
    if (i < 0) throw new HttpError(404, 'Không có mẫu này');
    const t = list[i];

    // --- Chia sẻ cho SĐT khác ---
    if (share) {
      if (req.method === 'POST' && !target) {
        if (!isOwner(t) || t.shared) throw new HttpError(403, 'Chỉ chủ mẫu riêng mới chia sẻ được');
        const raw = (await readBody(req)).phones;
        const input = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]+/).map(x => x.trim());
        const added = [], invalid = [];
        t.sharedWith = t.sharedWith || [];
        for (const x of input.filter(Boolean)) {
          const p2 = normalizePhone(x);
          if (!p2) invalid.push(`${x} (không hợp lệ)`);
          else if (p2 === phone) invalid.push(`${x} (là số của bạn)`);
          else if (ALLOWED.size && !ALLOWED.has(p2)) invalid.push(`${x} (chưa được phép dùng máy chủ)`);
          else if (!t.sharedWith.includes(p2)) { t.sharedWith.push(p2); added.push(p2); }
        }
        writeJSON(TPL, list);
        return send(res, 200, { template: view(t), added, invalid });
      }
      if (req.method === 'DELETE' && target) {
        const p2 = normalizePhone(decodeURIComponent(target));
        // Chủ mẫu thu hồi của bất kỳ ai; người nhận tự bỏ chia sẻ của chính mình
        if (!isOwner(t) && p2 !== phone) throw new HttpError(403, 'Bạn chỉ bỏ chia sẻ được cho chính mình');
        t.sharedWith = (t.sharedWith || []).filter(x => x !== p2);
        writeJSON(TPL, list);
        return send(res, 200, isOwner(t) ? { template: view(t) } : { removed: true });
      }
      throw new HttpError(405, 'Phương thức không hỗ trợ');
    }

    if (!canEdit(t)) {
      throw new HttpError(403, received(t)
        ? 'Mẫu được chia sẻ chỉ chủ mẫu được sửa. Hãy sao chép về mẫu của bạn để chỉnh.'
        : 'Mẫu dùng chung chỉ quản trị viên được sửa. Hãy sao chép về mẫu của bạn để chỉnh.');
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      // Chỉ quản trị viên được bật/tắt dùng chung; chủ sở hữu và danh sách chia sẻ giữ nguyên
      const sharedFlag = isAdmin ? !!body.shared : false;
      list[i] = { id, phone: t.phone, ...clean(body), shared: sharedFlag, sharedWith: t.sharedWith || [],
                  updatedAt: Date.now(), updatedBy: phone };
      writeJSON(TPL, list);
      return send(res, 200, view(list[i]));
    }
    if (req.method === 'DELETE') {
      list.splice(i, 1); writeJSON(TPL, list);
      return send(res, 204, '');
    }
    throw new HttpError(405, 'Phương thức không hỗ trợ');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => send(res, e.code || 500, { error: e.code ? e.message : 'Lỗi máy chủ' }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', e => reject(e.code === 'EADDRINUSE'
      ? new Error(`Cổng ${PORT} đang bị chương trình khác dùng. Đổi cổng trong Cài đặt hoặc tắt chương trình kia.`)
      : e));
    server.listen(PORT, () => resolve({
      server, port: PORT, dataFile: TPL, admins: [...ADMINS], allowedCount: ALLOWED.size,
      close: () => new Promise(r => server.close(() => r())),
    }));
  });
}

module.exports = { startServer, personalizeUserscript };

// Chạy trực tiếp bằng "npm run server"
if (require.main === module) {
  try { require('dotenv').config(); } catch {}
  startServer({
    port: process.env.PORT,
    dataDir: process.env.DATA_DIR && path.resolve(__dirname, process.env.DATA_DIR),
    adminPhones: process.env.ADMIN_PHONES,
    allowedPhones: process.env.ALLOWED_PHONES,
    match: process.env.USERSCRIPT_MATCH,
  }).then(s => {
    console.log(`Máy chủ mẫu chạy tại http://localhost:${s.port}`);
    console.log(`Dữ liệu mẫu: ${s.dataFile}`);
    console.log(s.allowedCount ? `Chỉ cho phép ${s.allowedCount} SĐT` : 'Mọi SĐT hợp lệ đều dùng được');
    console.log(s.admins.length ? `Quản trị viên mẫu dùng chung: ${s.admins.join(', ')}` : 'Chưa có quản trị viên (đặt ADMIN_PHONES để tạo mẫu dùng chung)');
    console.log(`Cài userscript: http://localhost:${s.port}/caidat (qua tunnel thì thay bằng địa chỉ tunnel)`);
  }).catch(e => { console.error(e.message); process.exit(1); });
}

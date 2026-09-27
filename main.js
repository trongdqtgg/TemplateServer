// Ứng dụng khay hệ thống: chạy máy chủ mẫu ẩn dưới taskbar + tự cập nhật qua GitHub Releases
const { app, Tray, Menu, BrowserWindow, shell, dialog, nativeImage, Notification, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');

const APP_NAME = 'Máy chủ mẫu điền form';
const UPDATE_EVERY_MS = 4 * 60 * 60 * 1000; // kiểm tra cập nhật mỗi 4 tiếng
const BACKUP_KEEP = 14;                      // giữ 14 bản sao lưu hằng ngày

// Chỉ cho chạy 1 bản; mở lần 2 thì hiện cửa sổ Cài đặt của bản đang chạy
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

// Dữ liệu và cấu hình nằm trong %APPDATA%, không bị xóa khi cập nhật / gỡ cài đặt
const USER_DIR = app.getPath('userData');
const DATA_DIR = path.join(USER_DIR, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const CONFIG_FILE = path.join(USER_DIR, 'config.json');
const LOG_FILE = path.join(USER_DIR, 'app.log');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const DEFAULTS = {
  port: 8787,
  publicUrl: '',          // địa chỉ tunnel, chỉ dùng để hiện link cài userscript
  adminPhones: '',
  allowedPhones: '',
  match: '*://*/*',
  openAtLogin: true,
  autoUpdate: true,
};

// ---------- Nhật ký ----------
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (a && a.stack) || (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1e6) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}
process.on('uncaughtException', e => log('Lỗi không bắt được:', e));

// ---------- Cấu hình ----------
function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function saveConfig(c) {
  fs.writeFileSync(CONFIG_FILE + '.tmp', JSON.stringify(c, null, 2));
  fs.renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE);
}
let cfg = loadConfig();

// ---------- Máy chủ ----------
let srv = null;
let serverError = '';
let quitting = false;

async function startSrv() {
  serverError = '';
  try {
    srv = await startServer({
      port: cfg.port, dataDir: DATA_DIR, adminPhones: cfg.adminPhones, allowedPhones: cfg.allowedPhones,
      match: cfg.match, version: app.getVersion(),
      publicDir: path.join(__dirname, 'public'),
      userscriptPath: path.join(__dirname, 'userscript', 'mau-dien-form.user.js'),
    });
    log(`Máy chủ chạy cổng ${srv.port}`);
  } catch (e) {
    srv = null;
    serverError = e.message;
    log('Không khởi động được máy chủ:', e);
    notify('Máy chủ mẫu không chạy được', e.message);
  }
  refreshTray();
}
async function stopSrv() {
  if (srv) { await srv.close(); srv = null; }
}
async function restartSrv() { await stopSrv(); await startSrv(); }

// ---------- Sao lưu hằng ngày ----------
function dailyBackup() {
  const src = path.join(DATA_DIR, 'templates.json');
  if (!fs.existsSync(src)) return;
  const day = new Date().toISOString().slice(0, 10);
  const dst = path.join(BACKUP_DIR, `templates-${day}.json`);
  try {
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^templates-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - BACKUP_KEEP)).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch (e) { log('Sao lưu lỗi:', e); }
}

// ---------- Sao lưu / nhập thủ công ----------
async function exportData() {
  const src = path.join(DATA_DIR, 'templates.json');
  if (!fs.existsSync(src)) return dialog.showMessageBox({ type: 'info', message: 'Chưa có mẫu nào để sao lưu.' });
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Sao lưu mẫu', defaultPath: `mau-dien-form-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return;
  fs.copyFileSync(src, filePath);
  notify('Đã sao lưu', filePath);
}

async function importData() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Nhập mẫu từ file (vd templates.json của bản cũ)', properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths[0]) return;
  let incoming;
  try {
    incoming = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!Array.isArray(incoming)) throw new Error('File không phải danh sách mẫu');
  } catch (e) {
    return dialog.showMessageBox({ type: 'error', message: 'Không đọc được file', detail: e.message });
  }
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['Gộp vào mẫu hiện có', 'Thay thế toàn bộ', 'Hủy'], cancelId: 2, defaultId: 0,
    message: `File có ${incoming.length} mẫu. Bạn muốn làm gì?`,
    detail: 'Trước khi nhập, dữ liệu hiện tại được sao lưu vào thư mục backups.',
  });
  if (response === 2) return;
  const dst = path.join(DATA_DIR, 'templates.json');
  let current = [];
  try { current = JSON.parse(fs.readFileSync(dst, 'utf8')); } catch {}
  if (fs.existsSync(dst)) fs.copyFileSync(dst, path.join(BACKUP_DIR, `truoc-khi-nhap-${Date.now()}.json`));
  const ids = new Set(current.map(t => t.id));
  const merged = response === 0 ? current.concat(incoming.filter(t => t && t.id && !ids.has(t.id))) : incoming;
  fs.writeFileSync(dst + '.tmp', JSON.stringify(merged, null, 2));
  fs.renameSync(dst + '.tmp', dst);
  notify('Đã nhập mẫu', `Hiện có ${merged.length} mẫu.`);
}

// ---------- Thông báo ----------
let tray = null;
function notify(title, body, onClick) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon-64.png') });
      if (onClick) n.on('click', onClick);
      n.show();
      return;
    }
  } catch {}
  if (tray && process.platform === 'win32') tray.displayBalloon({ title, content: body });
}

// ---------- Tự cập nhật (GitHub Releases) ----------
let autoUpdater = null;
let updState = 'Chưa kiểm tra';
let updReady = null;     // phiên bản đã tải xong, chờ cài
let manualCheck = false;
let checking = false;

function setupUpdater() {
  // FORM_MAU_UPDATE_TEST=<url>: chỉ dùng khi thử nghiệm, kiểm tra cập nhật từ máy chủ thử thay vì GitHub
  const testFeed = process.env.FORM_MAU_UPDATE_TEST;
  if (!app.isPackaged && !testFeed) { updState = 'Bản chạy thử, không tự cập nhật'; return; }
  try { ({ autoUpdater } = require('electron-updater')); }
  catch (e) { updState = 'Thiếu electron-updater'; log(e); return; }
  autoUpdater.logger = { info: m => log('[update]', m), warn: m => log('[update]', m), error: m => log('[update]', m), debug() {} };
  if (testFeed) { autoUpdater.forceDevUpdateConfig = true; autoUpdater.setFeedURL({ provider: 'generic', url: testFeed }); }
  autoUpdater.autoDownload = true;          // tải ngầm
  autoUpdater.autoInstallOnAppQuit = true;  // tắt app thì tự cài

  const set = s => { updState = s; refreshTray(); sendStatus(); };
  autoUpdater.on('checking-for-update', () => set('Đang kiểm tra…'));
  autoUpdater.on('update-not-available', () => {
    set(`Đang dùng bản mới nhất (${app.getVersion()})`);
    if (manualCheck) notify('Không có bản mới', `Bạn đang dùng bản mới nhất ${app.getVersion()}.`);
    manualCheck = false;
  });
  autoUpdater.on('update-available', info => set(`Có bản ${info.version}, đang tải…`));
  autoUpdater.on('download-progress', p => set(`Đang tải bản mới… ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', info => {
    updReady = info.version;
    manualCheck = false;
    if (cfg.autoUpdate) {
      set(`Đang cài bản ${info.version}…`);
      notify('Đang cập nhật máy chủ mẫu', `Lên bản ${info.version}. Máy chủ tạm dừng vài giây rồi tự chạy lại.`);
      setTimeout(installUpdate, 5000);
    } else {
      set(`Bản ${info.version} đã tải xong, chờ cài`);
      notify('Có bản mới', `Bản ${info.version} đã tải xong. Bấm để cài ngay.`, installUpdate);
    }
  });
  autoUpdater.on('error', e => {
    set('Kiểm tra cập nhật lỗi (xem nhật ký)');
    log('[update] lỗi:', e);
    if (manualCheck) notify('Không kiểm tra được cập nhật', String((e && e.message) || e).slice(0, 200));
    manualCheck = false;
  });

  setTimeout(() => checkUpdate(false), testFeed ? 1000 : 15 * 1000);
  setInterval(() => checkUpdate(false), UPDATE_EVERY_MS);
}

async function checkUpdate(manual) {
  if (!autoUpdater) {
    if (manual) notify('Không tự cập nhật', updState);
    return;
  }
  if (updReady) return installUpdate();
  if (checking) return;
  checking = true; manualCheck = manual;
  try { await autoUpdater.checkForUpdates(); }
  catch (e) { log('[update] checkForUpdates lỗi:', e); }
  finally { checking = false; }
}

async function installUpdate() {
  if (!autoUpdater || !updReady) return;
  quitting = true;
  log(`Cài bản ${updReady}`);
  try { await stopSrv(); } catch {}
  autoUpdater.quitAndInstall(true, true); // cài im lặng, xong tự mở lại
}

// ---------- Khay hệ thống ----------
function trayIcon() {
  const f = path.join(__dirname, 'assets', serverError ? 'tray-error.png' : 'tray.png');
  return nativeImage.createFromPath(f);
}
const managerUrl = () => `http://localhost:${cfg.port}/`;

function refreshTray() {
  if (!tray) return;
  tray.setImage(trayIcon());
  const status = srv ? `Đang chạy · cổng ${srv.port}` : `Không chạy: ${serverError || 'đang khởi động'}`;
  tray.setToolTip(`${APP_NAME}\n${status}`.slice(0, 127));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
    { label: status.slice(0, 80), enabled: false },
    { type: 'separator' },
    { label: 'Mở trang quản lý mẫu', enabled: !!srv, click: () => shell.openExternal(managerUrl()) },
    { label: 'Cài đặt…', click: openSettings },
    { label: 'Khởi động lại máy chủ', click: restartSrv },
    { type: 'separator' },
    { label: 'Dữ liệu', submenu: [
      { label: 'Mở thư mục dữ liệu', click: () => shell.openPath(DATA_DIR) },
      { label: 'Sao lưu mẫu ra file…', click: exportData },
      { label: 'Nhập mẫu từ file…', click: importData },
      { label: 'Mở nhật ký', click: () => shell.openPath(LOG_FILE) },
    ] },
    { type: 'separator' },
    { label: `Phiên bản ${app.getVersion()} · ${updState}`.slice(0, 90), enabled: false },
    updReady
      ? { label: `Khởi động lại để cập nhật lên ${updReady}`, click: installUpdate }
      : { label: 'Kiểm tra cập nhật', click: () => checkUpdate(true) },
    { type: 'separator' },
    { label: 'Thoát (tắt máy chủ)', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', () => tray.popUpContextMenu());
  tray.on('double-click', () => srv && shell.openExternal(managerUrl()));
  refreshTray();
}

// ---------- Cửa sổ Cài đặt ----------
let settingsWin = null;
function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 560, height: 720, minWidth: 420, minHeight: 480, title: `Cài đặt · ${APP_NAME}`,
    icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
  // Link ngoài mở bằng trình duyệt, không mở trong cửa sổ cài đặt
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function status() {
  return {
    running: !!srv, port: srv ? srv.port : cfg.port, error: serverError,
    version: app.getVersion(), updState, updReady, packaged: !!autoUpdater,
    dataFile: path.join(DATA_DIR, 'templates.json'),
  };
}
function sendStatus() {
  if (settingsWin) settingsWin.webContents.send('status', status());
}

ipcMain.handle('cfg:get', () => ({ cfg, status: status() }));
ipcMain.handle('cfg:save', async (_e, next) => {
  const port = Number(next.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Cổng phải là số từ 1024 đến 65535');
  const clean = {
    port,
    publicUrl: String(next.publicUrl || '').trim().replace(/\/+$/, ''),
    adminPhones: String(next.adminPhones || '').trim(),
    allowedPhones: String(next.allowedPhones || '').trim(),
    match: String(next.match || '').trim() || '*://*/*',
    openAtLogin: !!next.openAtLogin,
    autoUpdate: !!next.autoUpdate,
  };
  if (clean.publicUrl && !/^https?:\/\/[\w.-]+(:\d+)?$/.test(clean.publicUrl)) {
    throw new Error('Địa chỉ tunnel phải có dạng https://ten-mien (không kèm đường dẫn)');
  }
  const needRestart = ['port', 'adminPhones', 'allowedPhones', 'match'].some(k => clean[k] !== cfg[k]);
  cfg = clean;
  saveConfig(cfg);
  applyLoginItem();
  if (needRestart) await restartSrv();
  refreshTray();
  return { cfg, status: status() };
});
ipcMain.handle('app:open', (_e, what) => {
  if (what === 'manager' && srv) return shell.openExternal(managerUrl());
  if (what === 'data') return shell.openPath(DATA_DIR);
  if (what === 'log') return shell.openPath(LOG_FILE);
});
ipcMain.handle('app:copy', (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('upd:check', () => checkUpdate(true));

function applyLoginItem() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  if (!app.isPackaged) return; // bản chạy thử không đăng ký khởi động cùng Windows
  app.setLoginItemSettings({ openAtLogin: cfg.openAtLogin, args: ['--hidden'] });
}

// ---------- Khởi động ----------
app.on('second-instance', () => { log('Mở thêm lần nữa: hiện cửa sổ Cài đặt'); openSettings(); });
app.on('window-all-closed', () => { /* đóng cửa sổ cài đặt không tắt app: vẫn chạy dưới khay */ });
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('vn.formmau.server');
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  const firstRun = !fs.existsSync(CONFIG_FILE);
  if (firstRun) saveConfig(cfg);
  createTray();
  applyLoginItem();
  await startSrv();
  setupUpdater();
  refreshTray();
  dailyBackup();
  setInterval(dailyBackup, 6 * 60 * 60 * 1000);
  // Lần đầu cài: mở Cài đặt để nhập SĐT quản trị, địa chỉ tunnel
  if (firstRun && !process.argv.includes('--hidden')) openSettings();
  // Tự khởi động cùng Windows thì chạy im lặng; mở bằng tay thì báo cho biết app đang nằm dưới khay
  else if (srv && !process.argv.includes('--hidden')) notify(APP_NAME, `Đang chạy dưới khay hệ thống, cổng ${srv.port}.`);
});

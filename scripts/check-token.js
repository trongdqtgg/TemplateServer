// Kiem tra GitHub token truoc khi phat hanh (thong bao khong dau de hien dung trong cmd)
const pkg = require('../package.json');
const pub = [].concat((pkg.build && pkg.build.publish) || []).find(p => p.provider === 'github') || {};
const token = String(process.env.GH_TOKEN || '').replace(/^﻿/, '').trim();

const fail = msg => { console.log('  LOI: ' + msg); process.exit(1); };

(async () => {
  if (!token) fail('Chua co token.');
  if (!/^(github_pat_|ghp_|gho_|ghs_)[A-Za-z0-9_]+$/.test(token)) {
    fail('Token khong dung dinh dang (phai bat dau bang github_pat_ hoac ghp_). Kiem tra lai khi copy.');
  }
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'form-mau-publish', Accept: 'application/vnd.github+json' };
  let r = await fetch('https://api.github.com/user', { headers });
  if (r.status === 401) fail('Token sai, da het han hoac da bi thu hoi (Revoke). Tao token moi tren GitHub.');
  if (!r.ok) fail(`GitHub tra loi ${r.status} khi kiem tra token.`);
  const user = await r.json();

  if (!pub.owner || !pub.repo) fail('package.json chua khai bao "publish" (owner, repo).');
  r = await fetch(`https://api.github.com/repos/${pub.owner}/${pub.repo}`, { headers });
  if (r.status === 404) {
    fail(`Khong thay kho ${pub.owner}/${pub.repo}. Kiem tra ten kho trong package.json, ` +
      'va khi tao token nho chon dung kho nay o muc "Repository access".');
  }
  if (!r.ok) fail(`GitHub tra loi ${r.status} khi kiem tra kho ${pub.owner}/${pub.repo}.`);
  const repo = await r.json();
  if (repo.permissions && repo.permissions.push === false) {
    fail(`Tai khoan ${user.login} khong co quyen ghi vao kho ${pub.owner}/${pub.repo}.`);
  }
  console.log(`  Token hop le: tai khoan ${user.login}, kho ${pub.owner}/${pub.repo}.`);
  if (repo.private) {
    console.log('  CANH BAO: kho dang de Private. Cac may se KHONG tai duoc ban cap nhat.');
    console.log('  Nen chuyen kho sang Public (Settings > General > Danger Zone > Change visibility).');
  }
})().catch(e => fail('Khong ket noi duoc GitHub: ' + e.message));

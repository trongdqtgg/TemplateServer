// ==UserScript==
// @name         Mẫu điền form (theo số điện thoại)
// @namespace    kham-benh-filler
// @version      9.0
// @description  Alt + chuột phải: nhập SĐT. Ctrl + click: chọn mẫu điền form hoặc chuỗi thao tác đã ghi
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// ==/UserScript==
// Nên đổi @match thành domain trang khám bệnh, và @connect thành domain tunnel của bạn.

(function () {
  'use strict';

  // ===== CẤU HÌNH =====
  const SERVER = 'https://ten-tunnel-cua-ban.example.com'; // địa chỉ tunnel, không có "/" ở cuối

  const SITE = location.host + location.pathname;
  const SKIP_TYPES = ['password', 'hidden', 'file', 'submit', 'button', 'reset', 'image'];
  let templates = null;
  let PHONE = GM_getValue('phone', '');   // SĐT đã nhập, nhớ cho các lần sau

  function normalizePhone(p) {
    let d = String(p || '').replace(/[\s.\-()]/g, '');
    if (d.startsWith('+84')) d = '0' + d.slice(3);
    else if (/^84\d{9,10}$/.test(d)) d = '0' + d.slice(2);
    return /^0\d{9,10}$/.test(d) ? d : '';
  }

  // ===== GỌI MÁY CHỦ =====
  function request(method, path = '', body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: SERVER + '/api/templates' + path,
        headers: { 'Content-Type': 'application/json', 'X-Phone': PHONE },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 10000,
        onload: r => {
          let json = null;
          try { json = r.responseText ? JSON.parse(r.responseText) : null; } catch {}
          r.status < 400 ? resolve(json) : reject(new Error((json && json.error) || 'Lỗi ' + r.status));
        },
        onerror: () => reject(new Error('Không kết nối được máy chủ mẫu')),
        ontimeout: () => reject(new Error('Máy chủ mẫu không phản hồi')),
      });
    });
  }

  const refresh = async () => {
    if (!PHONE) throw new Error('Chưa nhập số điện thoại (Alt + chuột phải)');
    templates = await request('GET');
  };

  // ===== NHẬP / ĐỔI SỐ ĐIỆN THOẠI =====
  async function askPhone() {
    const input = prompt('Nhập số điện thoại của bạn để lấy đúng bộ mẫu:', PHONE);
    if (input === null) return false;
    const p = normalizePhone(input);
    if (!p) { toast('Số điện thoại không hợp lệ'); return false; }
    PHONE = p;
    GM_setValue('phone', p);
    templates = null;
    try {
      await refresh();
      toast(`SĐT ${p}: có ${templates.length} mẫu`);
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  // ===== Ô NHẬP =====
  const isChoice = el => el.type === 'checkbox' || el.type === 'radio';
  const isTextLike = el => el && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !isChoice(el) && !SKIP_TYPES.includes(el.type)));

  function getFields() {
    return [...document.querySelectorAll('input, select, textarea')].filter(el =>
      !el.disabled && !SKIP_TYPES.includes((el.type || '').toLowerCase()));
  }

  function keyOf(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
      return '#' + CSS.escape(el.id);
    }
    if (el.name) {
      let sel = `${tag}[name="${CSS.escape(el.name)}"]`;
      if (isChoice(el)) sel += `[value="${CSS.escape(el.value)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      let i = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
      parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);
    }
    return 'body > ' + parts.join(' > ');
  }

  // Tên dễ đọc của ô, hiển thị trên trang quản lý mẫu
  function labelOf(el) {
    let text = '';
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) text = l.textContent;
    }
    if (!text && el.closest('label')) text = el.closest('label').textContent;
    text = (text || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || el.type)
      .replace(/\s+/g, ' ').trim().slice(0, 80);
    return isChoice(el) ? `${text} [${el.value}]` : text;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
                : el.tagName === 'SELECT'   ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }
  const fire = el => ['input', 'change', 'blur'].forEach(t =>
    el.dispatchEvent(new Event(t, { bubbles: true })));

  function setValue(el, v) {
    if (isChoice(el)) {
      if (el.type === 'checkbox' ? el.checked !== v : v && !el.checked) el.click();
      return;
    }
    if (el.tagName === 'SELECT' && el.multiple && Array.isArray(v)) {
      [...el.options].forEach(o => { o.selected = v.includes(o.value); });
    } else {
      setNativeValue(el, v);
    }
    fire(el);
  }

  // ===== ĐIỀN MẪU FORM =====
  async function fillForm(t) {
    let pending = t.fields.slice(), filled = 0;
    for (let pass = 0; pass < 3 && pending.length; pass++) {
      const next = [];
      for (const f of pending) {
        let el;
        try { el = document.querySelector(f.selector); } catch { el = null; }
        if (el) { setValue(el, f.value); filled++; } else next.push(f);
      }
      pending = next;
      if (pending.length) await new Promise(r => setTimeout(r, 400));
    }
    toast(`"${t.name}": điền ${filled} ô` + (pending.length ? `, thiếu ${pending.length} ô` : ''));
    focusFirstEmpty();
  }

  // Đưa con trỏ tới ô trống đầu tiên để gõ thông tin bệnh nhân ngay
  function focusFirstEmpty() {
    const empty = getFields().find(f => isTextLike(f) && f.value === '' && f.offsetParent && !f.readOnly);
    if (empty) { empty.scrollIntoView({ block: 'center' }); empty.focus(); }
  }

  // ===== CHÈN MẪU VĂN BẢN =====
  function insertText(target, text) {
    const { el, start, end } = target;
    el.focus();
    const v = el.value;
    const s = start ?? v.length, e = end ?? v.length;
    setNativeValue(el, v.slice(0, s) + text + v.slice(e));
    try { el.setSelectionRange(s + text.length, s + text.length); } catch {}
    fire(el);
  }

  // ===== LƯU FORM HIỆN TẠI THÀNH MẪU =====
  async function saveCurrent() {
    const name = prompt('Tên mẫu (vd: Khám sức khỏe, Viêm họng):');
    if (!name) return;
    const fields = [];
    getFields().forEach(el => {
      let value;
      if (isChoice(el)) { if (!el.checked) return; value = true; }
      else if (el.tagName === 'SELECT' && el.multiple) {
        value = [...el.selectedOptions].map(o => o.value);
        if (!value.length) return;
      } else { if (el.value === '') return; value = el.value; }
      fields.push({ selector: keyOf(el), label: labelOf(el), value });
    });
    if (!fields.length) return toast('Form đang trống, chưa có gì để lưu');
    await saveTemplate({ type: 'form', name, site: SITE, fields }, `${fields.length} ô`);
  }

  // Lưu mẫu lên máy chủ; trùng tên (cùng loại, cùng trang) thì hỏi ghi đè
  async function saveTemplate(body, summary) {
    try {
      if (!templates) await refresh();
      // Chỉ ghi đè mẫu riêng của mình, không đụng tới mẫu dùng chung hay mẫu được chia sẻ
      const same = (templates || []).find(t => t.mine && !t.shared &&
        t.type === body.type && t.site === body.site && t.name === body.name);
      if (same) {
        if (!confirm(`Mẫu "${body.name}" đã có. Ghi đè?`)) return;
        await request('PUT', '/' + same.id, body);
      } else {
        await request('POST', '', body);
      }
      await refresh();
      toast(`Đã lưu "${body.name}" (${summary})`);
    } catch (e) { toast(e.message); }
  }

  // ===== CHUỖI THAO TÁC: GHI & PHÁT LẠI =====
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Nút lưu/gửi không được ghi: người dùng tự bấm sau khi kiểm tra
  const SAVE_WORDS = /(^|\s)(lưu|gửi|hoàn tất|hoàn thành|submit|save)(\s|$)/i;
  const CLICKABLE = 'button, a, summary, label, li, [role=button], [role=tab], [role=option], ' +
    '[role=menuitem], [role=checkbox], [role=radio], [role=switch], [onclick], ' +
    '[data-toggle], [data-bs-toggle], .btn, .tab, .nav-link';
  const textOf = el => (el.getAttribute('aria-label') || el.title || el.textContent || el.value || '')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
  const isOurUI = e => e.composedPath().some(n => n.dataset && 'ffUi' in n.dataset);
  const describe = st => {
    const l = st.label.length > 40 ? st.label.slice(0, 40) + '…' : st.label;
    return st.action === 'click' ? `bấm "${l}"` : `điền "${l}"`;
  };

  let rec = null;       // bản ghi đang chạy
  let playing = null;   // đang phát lại

  // Tìm phần tử "bấm được" từ chỗ người dùng click
  function clickTarget(t) {
    if (!(t instanceof Element)) return null;
    if (t.closest('input, select, textarea, option')) return null; // ô nhập: ghi qua sự kiện change
    const lab = t.closest('label');
    if (lab && (lab.control || lab.querySelector('input, select, textarea'))) return null;
    let el = t.closest(CLICKABLE);
    if (!el && getComputedStyle(t).cursor === 'pointer') el = t;
    if (!el || el === document.body || el === document.documentElement) return null;
    return el;
  }

  document.addEventListener('click', e => {
    if (!rec || !e.isTrusted || e.ctrlKey || e.button !== 0 || isOurUI(e)) return;
    const el = clickTarget(e.target);
    if (!el) return;
    const text = textOf(el);
    if (el.type === 'submit' || SAVE_WORDS.test(text)) {
      toast('Không ghi nút lưu/gửi: bạn tự bấm sau khi kiểm tra');
      return;
    }
    addStep({ action: 'click', selector: keyOf(el), label: text || el.tagName.toLowerCase(), text, tag: el.tagName });
  }, true);

  // Không đòi isTrusted ở đây: nhiều trang (select2, datepicker…) cập nhật ô bằng code
  document.addEventListener('change', e => {
    if (!rec || playing || isOurUI(e)) return;
    const el = e.target;
    if (!(el instanceof Element) || !el.matches('input, select, textarea') || SKIP_TYPES.includes(el.type)) return;
    let value;
    if (isChoice(el)) value = el.checked;
    else if (el.tagName === 'SELECT' && el.multiple) value = [...el.selectedOptions].map(o => o.value);
    else value = el.value;
    const selector = keyOf(el);
    const last = rec.steps[rec.steps.length - 1];
    if (last && last.action === 'set' && last.selector === selector) rec.steps.pop(); // gộp lần sửa liên tiếp
    // Ô để trống không ghi => phần thông tin bệnh nhân để trống lúc ghi
    if (value === '' || (Array.isArray(value) && !value.length)) return updateBar();
    addStep({ action: 'set', selector, label: labelOf(el), value });
  }, true);

  function addStep(step) { rec.steps.push(step); updateBar(); }

  function updateBar() {
    if (!rec) return;
    const last = rec.steps[rec.steps.length - 1];
    rec.label.textContent = `Đang ghi: ${rec.steps.length} bước` + (last ? `, vừa ${describe(last)}` : '');
  }

  function startRecording() {
    if (rec) return;
    const bar = document.createElement('div');
    bar.dataset.ffUi = '';
    Object.assign(bar.style, { position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647 });
    const root = bar.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .b { display: flex; align-items: center; gap: 10px; background: #1C2B33; color: #fff; padding: 8px 10px 8px 14px;
             border-radius: 8px; font: 13px system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: #E5484D; animation: p 1.2s infinite; }
        @keyframes p { 50% { opacity: .3; } }
        @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
        .t { max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        button { border: none; border-radius: 6px; padding: 5px 10px; font: inherit; cursor: pointer; }
        .s { background: #1E6B5C; color: #fff; } .u { background: #3A4B55; color: #fff; }
        .c { background: transparent; color: #C9D3D7; }
      </style>
      <div class="b" role="status"><span class="dot"></span><span class="t">Đang ghi: 0 bước</span>
        <button class="u">Bỏ bước cuối</button><button class="s">Dừng và lưu</button><button class="c">Hủy</button></div>`;
    document.body.appendChild(bar);
    rec = { steps: [], bar, label: root.querySelector('.t') };
    root.querySelector('.u').onclick = () => { rec.steps.pop(); updateBar(); };
    root.querySelector('.s').onclick = stopAndSave;
    root.querySelector('.c').onclick = () => {
      if (!rec.steps.length || confirm('Hủy bản ghi này?')) stopRecording();
    };
    toast('Bắt đầu ghi: bấm nút, điền ô như bình thường. Để trống phần của bệnh nhân.');
  }

  function stopRecording() { if (rec) { rec.bar.remove(); rec = null; } }

  async function stopAndSave() {
    const steps = rec.steps.slice();
    if (!steps.length) { stopRecording(); return toast('Chưa ghi được bước nào'); }
    const name = prompt(`Tên chuỗi thao tác (${steps.length} bước), vd: Kê đơn viêm họng:`);
    if (!name) return; // bấm Hủy thì vẫn tiếp tục ghi
    stopRecording();
    await saveTemplate({ type: 'macro', name, site: SITE, steps }, `${steps.length} bước`);
  }

  const visible = el => !!(el.offsetParent || el.getClientRects().length);

  function findStep(st) {
    let el = null;
    try { el = document.querySelector(st.selector); } catch {}
    if (st.action === 'click' && st.text && (!el || textOf(el) !== st.text)) {
      // Trang thay đổi làm selector lệch: tìm lại nút theo chữ hiển thị
      const same = [...document.querySelectorAll(st.tag ? st.tag.toLowerCase() : CLICKABLE)]
        .filter(x => visible(x) && textOf(x) === st.text);
      el = same[0] || el;
    }
    return el && (st.action === 'set' || visible(el)) ? el : null;
  }

  async function waitFor(st, timeout = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout && !playing.cancel) {
      const el = findStep(st);
      if (el) return el;
      await sleep(150);
    }
    return null;
  }

  // Bấm đầy đủ chuỗi sự kiện chuột để cả các nút tự thiết kế cũng nhận
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    if (el.focus) el.focus();
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }

  async function playMacro(t) {
    if (playing) return toast('Đang chạy một chuỗi khác');
    if (rec) return toast('Đang ghi, hãy dừng ghi trước');
    playing = { cancel: false };
    const onKey = e => { if (e.key === 'Escape') playing.cancel = true; };
    document.addEventListener('keydown', onKey, true);
    toast(`Đang chạy "${t.name}" (Esc để dừng)`);
    try {
      for (const [i, st] of t.steps.entries()) {
        const el = await waitFor(st);
        if (playing.cancel) return toast(`Đã dừng ở bước ${i + 1}`);
        if (!el) return toast(`Dừng ở bước ${i + 1}: không tìm thấy chỗ để ${describe(st)}`);
        if (st.action === 'click') {
          el.scrollIntoView({ block: 'center' });
          realClick(el);
          await sleep(350); // chờ trang cập nhật: thêm dòng, đổi tab…
        } else {
          setValue(el, st.value);
          await sleep(60);
        }
      }
      toast(`"${t.name}": xong ${t.steps.length} bước`);
      focusFirstEmpty();
    } finally {
      document.removeEventListener('keydown', onKey, true);
      playing = null;
    }
  }

  // ===== MENU CTRL + CHUỘT PHẢI =====
  let host = null;
  const closeMenu = () => { if (host) { host.remove(); host = null; } };

  // Alt + chuột phải: nhập / đổi SĐT
  // Ctrl + chuột trái: mở menu mẫu (trên macOS, Ctrl + click được hiểu là chuột phải nên bắt cả ở contextmenu)
  async function openFor(e) {
    const el = isTextLike(e.target) ? e.target : null;
    let start = null, end = null;
    if (el) { try { start = el.selectionStart; end = el.selectionEnd; } catch {} }
    if (!PHONE && !(await askPhone())) return;
    openMenu(e.clientX, e.clientY, el ? { el, start, end } : null);
  }

  document.addEventListener('contextmenu', e => {
    if (host && e.composedPath().includes(host)) return;
    if (e.altKey) { e.preventDefault(); e.stopPropagation(); closeMenu(); askPhone(); }
    else if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); openFor(e); }
  }, true);

  document.addEventListener('click', e => {
    if (!e.ctrlKey || e.button !== 0) return;
    if (host && e.composedPath().includes(host)) return;
    e.preventDefault();   // chặn Ctrl + click mở link sang tab mới
    e.stopPropagation();
    openFor(e);
  }, true);

  document.addEventListener('mousedown', e => {
    if (host && !e.composedPath().includes(host)) closeMenu();
  }, true);

  function openMenu(x, y, target) {
    closeMenu();
    host = document.createElement('div');
    host.dataset.ffUi = '';
    Object.assign(host.style, { position: 'fixed', zIndex: 2147483647, left: x + 'px', top: y + 'px' });
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .m { width: 290px; background: #fff; color: #1C2B33; border: 1px solid #D6DFDC; border-radius: 8px;
             box-shadow: 0 6px 24px rgba(28,43,51,.18); font: 14px/1.4 system-ui, sans-serif; overflow: hidden; }
        input { width: 100%; box-sizing: border-box; border: none; border-bottom: 1px solid #D6DFDC;
                padding: 10px 12px; font: inherit; outline: none; }
        .list { max-height: 50vh; overflow: auto; padding: 4px 0; }
        .h { font-size: 12px; font-weight: 600; color: #5F6F76; padding: 8px 12px 2px; }
        .i { padding: 7px 12px; cursor: pointer; }
        .i.on { background: #E1EFEA; }
        .tag { font-size: 11px; color: #1E6B5C; border: 1px solid currentColor; border-radius: 4px;
               padding: 0 4px; margin-left: 6px; }
        .note { padding: 8px 12px; color: #5F6F76; font-size: 13px; }
        .who { padding: 6px 12px; font-size: 12px; color: #5F6F76; border-top: 1px solid #D6DFDC; }
        .f { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #D6DFDC; border-top: 1px solid #D6DFDC; }
        .f button { border: none; background: #F3F6F5; padding: 8px; font: inherit; font-size: 13px; cursor: pointer; }
        .f button:disabled { color: #9AA7AC; cursor: default; }
        .f button:hover { background: #E1EFEA; }
      </style>
      <div class="m">
        <input type="search" placeholder="Tìm mẫu…" aria-label="Tìm mẫu">
        <div class="list"><div class="note">Đang tải mẫu…</div></div>
        <div class="who"></div>
        <div class="f">
          <button data-a="save">Lưu form thành mẫu</button><button data-a="rec">Ghi thao tác</button>
          <button data-a="phone">Đổi SĐT</button><button data-a="reload">Tải lại</button>
        </div>
      </div>`;
    document.body.appendChild(host);

    const input = root.querySelector('input');
    const list = root.querySelector('.list');
    root.querySelector('.who').textContent = 'Mẫu của SĐT ' + PHONE;
    let items = [], active = 0;

    const place = () => {
      const r = host.getBoundingClientRect();
      host.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
      host.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    };

    const pick = t => {
      closeMenu();
      if (t.type === 'form') fillForm(t);
      else if (t.type === 'macro') playMacro(t);
      else insertText(target, t.text);
    };

    function render() {
      const q = input.value.toLowerCase();
      const match = t => t.name.toLowerCase().includes(q);
      // Thứ tự: mẫu của tôi, mẫu được chia sẻ, mẫu dùng chung
      const rank = t => t.shared ? 2 : t.sharedBy ? 1 : 0;
      const byOwner = arr => arr.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'vi'));
      const forms = byOwner(templates.filter(t => t.type === 'form' && t.site === SITE && match(t)));
      const macros = byOwner(templates.filter(t => t.type === 'macro' && t.site === SITE && match(t)));
      const texts = target ? byOwner(templates.filter(t => t.type === 'text' && match(t))) : [];
      items = [...forms, ...macros, ...texts];
      active = Math.min(active, Math.max(items.length - 1, 0));

      let html = '';
      const section = (title, arr, offset) => arr.length
        ? `<div class="h">${title}</div>` + arr.map((t, i) =>
            `<div class="i ${i + offset === active ? 'on' : ''}" data-i="${i + offset}"></div>`).join('')
        : '';
      html += section('Mẫu form cho trang này', forms, 0);
      html += section('Chuỗi thao tác', macros, forms.length);
      html += section('Chèn văn bản vào ô', texts, forms.length + macros.length);
      if (!items.length) {
        html = `<div class="note">${q ? 'Không có mẫu khớp.' : 'Chưa có mẫu cho trang này.'}` +
          (target ? '' : ' Ctrl + click vào một ô nhập để thấy mẫu văn bản.') + '</div>';
      }
      list.innerHTML = html;
      list.querySelectorAll('.i').forEach(d => {
        const t = items[+d.dataset.i];
        d.textContent = t.name; // textContent để an toàn
        const tagText = t.shared ? 'chung' : t.sharedBy ? 'từ ' + t.sharedBy : '';
        if (tagText) {
          const tag = document.createElement('span');
          tag.className = 'tag'; tag.textContent = tagText;
          d.appendChild(tag);
        }
        d.onclick = () => pick(items[+d.dataset.i]);
      });
      place();
    }

    async function load(force) {
      try {
        if (force || !templates) { list.innerHTML = '<div class="note">Đang tải mẫu…</div>'; await refresh(); }
        render();
      } catch (e) {
        list.innerHTML = '';
        const n = document.createElement('div');
        n.className = 'note'; n.textContent = e.message + '. Kiểm tra tunnel đang chạy và SĐT.';
        list.appendChild(n);
        place();
      }
    }

    input.addEventListener('input', () => { active = 0; if (templates) render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') return closeMenu();
      if (!items.length) return;
      if (e.key === 'ArrowDown') { active = (active + 1) % items.length; render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
      if (e.key === 'Enter') { pick(items[active]); e.preventDefault(); }
    });
    root.querySelector('[data-a=save]').onclick = () => { closeMenu(); saveCurrent(); };
    const recBtn = root.querySelector('[data-a=rec]');
    if (rec) { recBtn.textContent = 'Đang ghi…'; recBtn.disabled = true; }
    recBtn.onclick = () => { closeMenu(); startRecording(); };
    root.querySelector('[data-a=phone]').onclick = () => { closeMenu(); askPhone(); };
    root.querySelector('[data-a=reload]').onclick = () => load(true);

    place();
    input.focus();
    load(false);
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.dataset.ffUi = '';
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 2147483647,
      background: '#1C2B33', color: '#fff', padding: '8px 14px', borderRadius: '6px',
      font: '13px system-ui, sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,.3)'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  // Tải sẵn danh sách mẫu để menu mở nhanh
  if (PHONE) refresh().catch(() => {});
})();

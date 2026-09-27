// ==UserScript==
// @name         Mẫu điền form (theo số điện thoại)
// @namespace    kham-benh-filler
// @version      12.1
// @description  Alt + chuột phải: nhập SĐT. Ctrl + click: chọn mẫu điền form hoặc chuỗi thao tác đã ghi
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_info
// @connect      *
// ==/UserScript==
// Nên đổi @match thành domain trang khám bệnh, và @connect thành domain tunnel của bạn.

(function () {
  'use strict';

  // ===== CẤU HÌNH =====
  const SERVER = 'https://ten-tunnel-cua-ban.example.com'; // địa chỉ tunnel, không có "/" ở cuối

  const VERSION = '12.1';
  // Trang Angular/React đổi đường dẫn mà không tải lại trang, nên tính lại mỗi lần dùng
  const siteNow = () => location.host + location.pathname;
  // Mẫu thuộc cùng website (khác đường dẫn vẫn hiện, xếp sau mẫu của đúng trang này)
  const sameHost = t => String(t.site || '').split('/')[0] === location.host;

  // Nhật ký lỗi gần đây, dùng cho nút "Chẩn đoán"
  const errLog = [];
  function logErr(where, e) {
    errLog.push(`${new Date().toLocaleTimeString()} ${where}: ${(e && (e.stack || e.message)) || e}`);
    if (errLog.length > 20) errLog.shift();
  }
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

  // Vị trí lưu cho ô danh sách: ô nhập bên trong đổi chỗ khi chọn nhiều giá trị,
  // nên lưu theo khung ngoài (nếu ô nhập không có id/name riêng)
  function fieldKey(el) {
    const root = selectRootOf(el);
    if (!root) return keyOf(el);
    const k = keyOf(el);
    return k.startsWith('#') || k.includes('[name=') ? k : keyOf(root) + ' input';
  }

  // Tên dễ đọc của ô, hiển thị trên trang quản lý mẫu
  function labelOf(el) {
    let text = '';
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) text = l.textContent;
    }
    if (!text && el.closest('label')) text = el.closest('label').textContent;
    // Ô danh sách / chọn ngày: tính từ khung ngoài, để không lấy nhầm chữ của lựa chọn bên trong
    const frame = selectRootOf(el) || pickerRootOf(el) || el;
    if (!text) {
      // Bố cục form kiểu Ant Design / ng-zorro: "<tiền tố>-form-item" chứa "<tiền tố>-form-item-label"
      const item = frame.parentElement && frame.parentElement.closest('[class*="-form-item"]');
      const lab = item && [...item.querySelectorAll('[class*="-form-item-label"]')]
        .find(x => hasClass(x, /-form-item-label$/));
      if (lab && !lab.contains(frame)) text = lab.textContent;
    }
    if (!text) {
      // Nhãn nằm ở ô bên cạnh (kiểu "Bác sĩ làm bệnh án  [ô chọn]")
      for (let n = frame, i = 0; n && i < 8 && !text; n = n.parentElement, i++) {
        if (n === document.body || n.tagName === 'FORM') break; // không dò ra ngoài form / trang
        const prev = n.previousElementSibling;
        // Bỏ qua nút bấm, các ô nhập khác và thẻ không hiển thị, chỉ lấy chữ nhãn
        const CTRL = 'button, input, select, textarea, a, [role=button]';
        if (!prev || prev.matches('style, script, template, noscript, head') ||
            prev.matches(CTRL) || prev.querySelector(CTRL)) continue;
        const t = prev.textContent.replace(/\s+/g, ' ').trim();
        if (t && t.length <= 60) text = t;
      }
    }
    // Chữ mờ gợi ý của ô danh sách (vd "Nhân viên") nằm ngoài ô nhập
    const root = selectRootOf(el);
    const ph = root && root.querySelector('[class*="-select-selection-placeholder"]');
    const phText = ph && ph.textContent.replace(/\s+/g, ' ').trim();
    text = (text || el.getAttribute('aria-label') || el.placeholder || phText || el.name || el.id || el.type)
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

  // ===== Ô ĐẶC BIỆT: DANH SÁCH CHỌN (Select) & CHỌN NGÀY (DatePicker) =====
  // Các ô này (Ant Design, Element, react-datepicker…) không nhận giá trị gán thẳng vào ô nhập:
  // ngày phải gõ rồi nhấn Enter, danh sách phải mở ra rồi bấm đúng lựa chọn.
  // Ant Design và các bản dựa trên nó (ng-zorro, bản đổi tên như "ui-select"…) có cùng cấu trúc,
  // chỉ khác tiền tố tên class, nên nhận diện theo mẫu "<tiền tố>-select", "<tiền tố>-picker"…
  const PICKER_SEL = '.el-date-editor, .react-datepicker__input-container, .mx-datepicker, .vdp-datepicker';
  const POPUP_SEL = '.el-select-dropdown, .el-picker-panel, .flatpickr-calendar, .react-datepicker-popper, ' +
    '.select2-dropdown, .MuiAutocomplete-popper, [role=listbox]';
  const OPTION_SEL = '[role=option], .el-select-dropdown__item, .select2-results__option, ' +
    '.vs__dropdown-option, .MuiAutocomplete-option';
  const SELECT_RE = /^([a-z][a-z0-9]*)-select$/;
  const PICKER_RE = /^([a-z][a-z0-9]*)-picker$/;
  const POPUP_RE = /^[a-z][a-z0-9]*-(select|picker)-dropdown$/;
  const OPTION_RE = /^[a-z][a-z0-9]*-select-item-option$/;
  const hasClass = (el, re) => !!el.classList && [...el.classList].some(c => re.test(c));
  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Khung ngoài của ô danh sách: có class "<tiền tố>-select" và bên trong có "<tiền tố>-select-selector"
  function selectRootOf(el) {
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 8; n = n.parentElement, i++) {
      for (const c of n.classList) {
        const m = c.match(SELECT_RE);
        if (m && n.querySelector(`.${m[1]}-select-selector`)) { n.__ffPrefix = m[1]; return n; }
      }
    }
    return null;
  }
  const pfx = root => root.__ffPrefix || 'ant';
  function pickerRootOf(el) {
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; n = n.parentElement, i++) {
      const m = [...n.classList].map(c => c.match(PICKER_RE)).find(Boolean);
      if (m && m[1] !== 'color') return n;
    }
    return el && el.closest ? el.closest(PICKER_SEL) : null;
  }
  function inPopup(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.matches(POPUP_SEL) || hasClass(n, POPUP_RE)) return true;
    }
    return false;
  }
  const isComboInput = el => !!el && el.tagName === 'INPUT' &&
    (!!selectRootOf(el) || el.getAttribute('role') === 'combobox');
  const isPickerInput = el => !!el && el.tagName === 'INPUT' && (!!pickerRootOf(el) ||
    el.classList.contains('flatpickr-input') || /(^|[\s_-])date-?picker/i.test(el.className));
  const kindOf = el => isComboInput(el) ? 'select' : isPickerInput(el) ? 'date' : '';

  // Giá trị đang chọn: chữ hiển thị của lựa chọn (mảng nếu chọn nhiều)
  function comboValue(input) {
    const root = selectRootOf(input);
    if (!root) return norm(input.value);
    const p = pfx(root);
    const items = [...root.querySelectorAll(`.${p}-select-selection-item`)]
      .filter(x => !x.classList.contains(`${p}-select-selection-item-rest`))
      .map(x => norm(x.getAttribute('title') || x.textContent)).filter(Boolean);
    return root.classList.contains(`${p}-select-multiple`) ? items : (items[0] || '');
  }
  const widgetValue = el => kindOf(el) === 'select' ? comboValue(el) : norm(el.value);
  const isEmptyValue = v => v === '' || v == null || (Array.isArray(v) && !v.length);
  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Kích thước thật > 0: loại các lựa chọn ẩn dành cho trình đọc màn hình
  const shown = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };

  function mouse(el, type) {
    const r = el.getBoundingClientRect();
    // Không truyền "view": trong hộp cát của Tampermonkey, window không phải Window thật -> Chrome báo lỗi
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true,
      button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  }
  function pressKey(el, key, keyCode) {
    for (const type of ['keydown', 'keyup']) {
      // keyCode/which đặt ngay khi tạo (Chrome nhận), để trang thấy được kể cả khi
      // Tampermonkey chạy script tách biệt với trang; defineProperty dự phòng cho Firefox
      const ev = new KeyboardEvent(type, { key, code: key, keyCode, which: keyCode,
        bubbles: true, cancelable: true, composed: true });
      if (ev.keyCode !== keyCode) {
        try {
          Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
          Object.defineProperty(ev, 'which', { get: () => keyCode });
        } catch {}
      }
      el.dispatchEvent(ev);
    }
  }
  function typeInto(el, text) {
    setNativeValue(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    // Một số ô tìm kiếm lọc theo sự kiện nhả phím
    el.dispatchEvent(new KeyboardEvent('keyup', { key: text.slice(-1) || 'Backspace', bubbles: true }));
  }

  // Chọn ngày: gõ đúng chữ đã lưu (vd "2022", "28/09/2026") rồi nhấn Enter
  // Trả về '' nếu thành công, ngược lại là lý do
  async function setDate(input, value) {
    value = norm(value);
    if (norm(input.value) === value) return '';
    input.focus();
    mouse(input, 'mousedown'); mouse(input, 'mouseup'); mouse(input, 'click');
    await sleep(100);
    // Nhiều ô ngày chỉ-đọc cho tới khi được bấm vào, nên kiểm tra sau khi bấm
    if (input.readOnly) {
      pressKey(input, 'Escape', 27); input.blur();
      return 'ô ngày chỉ cho chọn trên lịch, không gõ được';
    }
    typeInto(input, value);
    await sleep(100);
    pressKey(input, 'Enter', 13);
    await sleep(120);
    if (norm(input.value) !== value) {
      // Cách khác: báo "đã đổi" rồi bấm ra ngoài để lịch tự xác nhận
      typeInto(input, value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(80);
    }
    input.blur();
    mouse(document.body, 'mousedown'); mouse(document.body, 'mouseup'); mouse(document.body, 'click');
    await sleep(150);
    return norm(input.value) === value ? '' : `ô ngày không nhận "${value}" (đang hiện "${norm(input.value)}")`;
  }

  function comboOpen(input, root) {
    return root ? root.classList.contains(`${pfx(root)}-select-open`) : input.getAttribute('aria-expanded') === 'true';
  }
  function visibleOptions() {
    const cands = new Set(document.querySelectorAll(OPTION_SEL + ', [class*="-select-item-option"]'));
    return [...cands].filter(o => (o.matches(OPTION_SEL) || hasClass(o, OPTION_RE)) && shown(o) &&
      !o.closest('[class*="-select-dropdown-hidden"]') && o.getAttribute('aria-disabled') !== 'true' &&
      !hasClass(o, /-select-item-option-disabled$/));
  }
  function optionText(o) {
    const content = [...o.querySelectorAll('[class*="-select-item-option-content"]')]
      .find(x => hasClass(x, /-select-item-option-content$/));
    return norm(o.getAttribute('title') || (content || o).textContent);
  }
  const isOpenNow = (input, root) => comboOpen(input, root) || visibleOptions().length > 0;

  // Mở danh sách: bấm vào ô; nếu chưa mở thì bấm khung ngoài; cuối cùng thử phím mũi tên xuống
  async function openCombo(input, root) {
    if (isOpenNow(input, root)) return true;
    const trigger = root ? (root.querySelector(`.${pfx(root)}-select-selector`) || root) : input;
    const tries = [
      () => { mouse(trigger, 'mousedown'); mouse(trigger, 'mouseup'); mouse(trigger, 'click'); },
      () => { if (root && root !== trigger) { mouse(root, 'mousedown'); mouse(root, 'mouseup'); mouse(root, 'click'); } },
      () => { input.focus(); pressKey(input, 'ArrowDown', 40); },
    ];
    for (const t of tries) {
      t();
      await sleep(200);
      if (isOpenNow(input, root)) return true;
    }
    return isOpenNow(input, root);
  }

  const hasPicked = (input, text) => {
    const cur = comboValue(input);
    return Array.isArray(cur) ? cur.includes(text) : cur === text;
  };

  // Mở danh sách, gõ để lọc, bấm đúng lựa chọn có chữ trùng khớp. Trả về '' nếu được, ngược lại là lý do
  async function pickOne(input, root, text) {
    input.focus();
    const opened = await openCombo(input, root);
    if (!input.readOnly) typeInto(input, text); // danh sách dài chỉ hiển thị một phần, phải lọc
    const low = text.toLowerCase();
    let seen = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) { // danh sách tải từ máy chủ có thể chậm
      await sleep(150);
      const opts = visibleOptions();
      if (opts.length) seen = opts.slice(0, 5).map(optionText);
      const hit = opts.find(o => optionText(o) === text) ||
        opts.find(o => optionText(o).toLowerCase() === low) ||
        (opts.length === 1 && optionText(opts[0]).toLowerCase().includes(low) ? opts[0] : null);
      if (hit) {
        hit.scrollIntoView({ block: 'nearest' });
        realClick(hit);
        await sleep(200);
        if (hasPicked(input, text)) return '';
        // Bấm chưa ăn: chọn bằng phím Enter (lựa chọn đang được tô sáng)
        pressKey(input, 'Enter', 13);
        await sleep(200);
        if (hasPicked(input, text)) return '';
        return `đã bấm "${optionText(hit)}" nhưng ô không nhận`;
      }
      // Danh sách không tìm kiếm được: cuộn xuống để hiện thêm lựa chọn
      const holder = [...document.querySelectorAll('.rc-virtual-list-holder, cdk-virtual-scroll-viewport, ' +
        '[class*="-select-dropdown"] [role=listbox]')]
        .find(x => shown(x) && !x.closest('[class*="-select-dropdown-hidden"]'));
      if (input.readOnly && holder && holder.scrollTop + holder.clientHeight < holder.scrollHeight) {
        holder.scrollTop += holder.clientHeight * 0.8;
        holder.dispatchEvent(new Event('scroll'));
      }
    }
    if (!opened && !seen.length) return 'không mở được danh sách';
    return seen.length ? `không có "${text}" trong danh sách (đang thấy: ${seen.join(', ')})`
      : `không thấy lựa chọn nào khi tìm "${text}"`;
  }

  async function chooseCombo(input, value) {
    const root = selectRootOf(input);
    const wanted = (Array.isArray(value) ? value : [value]).map(norm).filter(Boolean);
    const missing = [];
    for (const text of wanted) {
      const cur = comboValue(input);
      if (Array.isArray(cur) ? cur.includes(text) : cur === text) continue;
      const why = await pickOne(input, root, text);
      if (why) missing.push(why);
    }
    if (comboOpen(input, root)) pressKey(input, 'Escape', 27);
    if (!input.readOnly && input.value) typeInto(input, ''); // xóa chữ tìm kiếm còn sót
    input.blur();
    await sleep(60);
    return missing;
  }

  // Gán giá trị cho một ô bất kỳ; trả về danh sách giá trị không chọn được
  async function applyValue(el, value, kind) {
    kind = kind || kindOf(el);
    if (kind === 'select') return chooseCombo(el, value);
    if (kind === 'date') { const why = await setDate(el, value); return why ? [why] : []; }
    setValue(el, value);
    return [];
  }

  // Tìm lại ô đã lưu: theo vị trí trước, nếu lệch (trang đổi bố cục, ô không có id) thì tìm theo nhãn
  function findField(selector, label, kind) {
    let el = null;
    try { el = document.querySelector(selector); } catch {}
    const kindOk = x => !kind || kindOf(x) === kind;
    if (el && kindOk(el) && (!label || labelOf(el) === label)) return el;
    if (label) {
      const same = getFields().filter(f => kindOk(f) && labelOf(f) === label);
      if (same.length === 1) return same[0];
    }
    return el && kindOk(el) ? el : null;
  }

  // ===== ĐIỀN MẪU FORM =====
  async function fillForm(t) {
    try { await fillFormInner(t); }
    catch (e) { logErr('Điền mẫu', e); toast('Lỗi khi điền mẫu: ' + e.message + '. Dùng "Chẩn đoán" để xem chi tiết.', 6000); }
  }
  async function fillFormInner(t) {
    let pending = t.fields.slice(), filled = 0;
    const failed = [];
    for (let pass = 0; pass < 3 && pending.length; pass++) {
      const next = [];
      for (const f of pending) {
        const el = findField(f.selector, f.label, f.kind);
        if (!el) { next.push(f); continue; }
        const miss = await applyValue(el, f.value, f.kind);
        if (miss.length) { failed.push(`${f.label}: ${miss.join(', ')}`); logErr('Điền mẫu', `${f.label}: ${miss.join(', ')}`); }
        else filled++;
      }
      pending = next;
      if (pending.length) await sleep(400);
    }
    let msg = `"${t.name}": điền ${filled} ô`;
    if (pending.length) {
      msg += `, không tìm thấy ${pending.length} ô (${pending.map(f => f.label).join(', ')})`;
      logErr('Điền mẫu', 'không tìm thấy ô: ' + pending.map(f => `${f.label} [${f.selector}]`).join('; '));
    }
    if (failed.length) msg += `. Không chọn được: ${failed.join('; ')}`;
    toast(msg, failed.length || pending.length ? 8000 : 2800);
    focusFirstEmpty();
  }

  // Đưa con trỏ tới ô trống đầu tiên để gõ thông tin bệnh nhân ngay
  function focusFirstEmpty() {
    const empty = getFields().find(f => isTextLike(f) && !kindOf(f) && f.value === '' && f.offsetParent && !f.readOnly);
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
      const kind = kindOf(el);
      if (kind) {
        value = widgetValue(el);
        if (isEmptyValue(value)) return;
        return fields.push({ selector: fieldKey(el), label: labelOf(el), value, kind });
      }
      if (isChoice(el)) { if (!el.checked) return; value = true; }
      else if (el.tagName === 'SELECT' && el.multiple) {
        value = [...el.selectedOptions].map(o => o.value);
        if (!value.length) return;
      } else { if (el.value === '') return; value = el.value; }
      fields.push({ selector: keyOf(el), label: labelOf(el), value });
    });
    if (!fields.length) return toast('Form đang trống, chưa có gì để lưu');
    await saveTemplate({ type: 'form', name, site: siteNow(), fields }, `${fields.length} ô`);
  }

  // Lưu mẫu lên máy chủ; trùng tên (cùng loại, cùng trang) thì hỏi ghi đè
  async function saveTemplate(body, summary) {
    try {
      if (!templates) await refresh();
      // Chỉ ghi đè mẫu riêng của mình, không đụng tới mẫu dùng chung hay mẫu được chia sẻ
      const same = (templates || []).find(t => t.mine && !t.shared &&
        t.type === body.type && sameHost(t) && t.name === body.name);
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
    if (st.action === 'click') return `bấm "${l}"`;
    if (st.action === 'select') return `chọn "${[].concat(st.value).join(', ')}" ở "${l}"`;
    return `điền "${l}"`;
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

  // --- Ghi ô chọn ngày / danh sách chọn: không ghi từng cú bấm bên trong,
  //     mà ghi giá trị cuối cùng hiển thị trong ô ---
  let lastWidget = null;
  const baseline = new WeakMap();

  document.addEventListener('focusin', e => {
    if (!rec || !e.isTrusted) return;
    const el = e.target;
    if (kindOf(el)) {
      lastWidget = el;
      if (!baseline.has(el)) baseline.set(el, widgetValue(el));
    }
  }, true);

  // Ô đang được thao tác: ô đang có con trỏ, hoặc ô vừa dùng gần nhất
  function widgetOwner(target) {
    const a = document.activeElement;
    if (kindOf(a)) return a;
    const root = target instanceof Element && (selectRootOf(target) || pickerRootOf(target));
    const inside = root && root.querySelector('input');
    return inside && kindOf(inside) ? inside : lastWidget;
  }

  function recordWidget(el) {
    if (!rec || !el || !el.isConnected) return;
    const kind = kindOf(el);
    const value = widgetValue(el);
    const selector = fieldKey(el);
    const steps = rec.steps;
    const prev = [...steps].reverse().find(s => s.selector === selector);
    const before = prev ? prev.value : baseline.get(el);
    if (isEmptyValue(value) || sameValue(value, before)) return;
    const step = { action: kind === 'select' ? 'select' : 'set', kind, selector, label: labelOf(el), value };
    const last = steps[steps.length - 1];
    if (last && last.selector === selector) steps.pop(); // gộp các lần chọn liên tiếp
    addStep(step);
  }
  // Ghi sau một chút để trang kịp cập nhật giá trị; nếu có thao tác khác xảy ra trước
  // thì ghi ngay (flushWidgets) để giữ đúng thứ tự các bước
  const pendingWidgets = new Set();
  function checkLater(el) {
    if (!el) return;
    pendingWidgets.add(el);
    setTimeout(() => { if (pendingWidgets.delete(el)) recordWidget(el); }, 150);
  }
  function flushWidgets() {
    const list = [...pendingWidgets];
    pendingWidgets.clear();
    list.forEach(recordWidget);
  }

  ['keyup', 'focusout'].forEach(type => document.addEventListener(type, e => {
    if (!rec || !e.isTrusted || isOurUI(e)) return;
    if (kindOf(e.target)) checkLater(e.target);
  }, true));

  document.addEventListener('click', e => {
    if (!rec || !e.isTrusted || e.ctrlKey || e.button !== 0 || isOurUI(e)) return;
    const t = e.target;
    if (t instanceof Element && (inPopup(t) || selectRootOf(t) || pickerRootOf(t))) {
      checkLater(widgetOwner(t)); // bấm bên trong ô chọn / lịch: chỉ ghi giá trị cuối
      return;
    }
    const el = clickTarget(e.target);
    if (!el) return;
    flushWidgets();
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
    if (kindOf(el)) return; // ô chọn ngày / danh sách: ghi riêng ở trên
    flushWidgets();
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
    flushWidgets();
    recordWidget(lastWidget);
    const steps = rec.steps.slice();
    if (!steps.length) { stopRecording(); return toast('Chưa ghi được bước nào'); }
    const name = prompt(`Tên chuỗi thao tác (${steps.length} bước), vd: Kê đơn viêm họng:`);
    if (!name) return; // bấm Hủy thì vẫn tiếp tục ghi
    stopRecording();
    await saveTemplate({ type: 'macro', name, site: siteNow(), steps }, `${steps.length} bước`);
  }

  const visible = el => !!(el.offsetParent || el.getClientRects().length);

  function findStep(st) {
    if (st.action !== 'click') return findField(st.selector, st.label, st.kind || (st.action === 'select' ? 'select' : ''));
    let el = null;
    try { el = document.querySelector(st.selector); } catch {}
    if (st.action === 'click' && st.text && (!el || textOf(el) !== st.text)) {
      // Trang thay đổi làm selector lệch: tìm lại nút theo chữ hiển thị
      const same = [...document.querySelectorAll(st.tag ? st.tag.toLowerCase() : CLICKABLE)]
        .filter(x => visible(x) && textOf(x) === st.text);
      el = same[0] || el;
    }
    return el && (st.action !== 'click' || visible(el)) ? el : null;
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
    const o = { bubbles: true, cancelable: true, composed: true, button: 0, // không truyền "view" (xem hàm mouse)
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
    const onKey = e => { if (e.isTrusted && e.key === 'Escape') playing.cancel = true; };
    document.addEventListener('keydown', onKey, true);
    toast(`Đang chạy "${t.name}" (Esc để dừng)`);
    try {
      for (const [i, st] of t.steps.entries()) {
        const el = await waitFor(st);
        if (playing.cancel) return toast(`Đã dừng ở bước ${i + 1}`);
        if (!el) {
          logErr('Phát lại', `bước ${i + 1}: không tìm thấy ${st.selector}`);
          return toast(`Dừng ở bước ${i + 1}: không tìm thấy chỗ để ${describe(st)}`, 8000);
        }
        if (st.action === 'click') {
          el.scrollIntoView({ block: 'center' });
          realClick(el);
          await sleep(350); // chờ trang cập nhật: thêm dòng, đổi tab…
        } else {
          const miss = await applyValue(el, st.value, st.kind || (st.action === 'select' ? 'select' : ''));
          if (miss.length) {
            logErr('Phát lại', `bước ${i + 1} ${describe(st)}: ${miss.join('; ')}`);
            return toast(`Dừng ở bước ${i + 1}: không ${describe(st)}: ${miss.join('; ')}`, 8000);
          }
          await sleep(60);
        }
      }
      toast(`"${t.name}": xong ${t.steps.length} bước`);
      focusFirstEmpty();
    } catch (e) {
      logErr('Phát lại', e);
      toast('Lỗi khi chạy chuỗi: ' + e.message + '. Dùng "Chẩn đoán" để xem chi tiết.', 8000);
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
    const el = isTextLike(e.target) && !kindOf(e.target) ? e.target : null;
    let start = null, end = null;
    if (el) { try { start = el.selectionStart; end = el.selectionEnd; } catch {} }
    const clicked = e.target instanceof Element ? e.target : null;
    if (!PHONE && !(await askPhone())) return;
    openMenu(e.clientX, e.clientY, el ? { el, start, end } : null, clicked);
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
    // Ctrl + click để mở menu: không để trang mở danh sách chọn / lịch bên dưới
    if (e.ctrlKey && e.button === 0 && !isOurUI(e)) e.stopPropagation();
  }, true);

  function openMenu(x, y, target, clicked) {
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
        .f .wide { grid-column: 1 / -1; color: #5F6F76; }
        .f button:hover { background: #E1EFEA; }
      </style>
      <div class="m">
        <input type="search" placeholder="Tìm mẫu…" aria-label="Tìm mẫu">
        <div class="list"><div class="note">Đang tải mẫu…</div></div>
        <div class="who"></div>
        <div class="f">
          <button data-a="save">Lưu form thành mẫu</button><button data-a="rec">Ghi thao tác</button>
          <button data-a="phone">Đổi SĐT</button><button data-a="reload">Tải lại</button>
          <button data-a="diag" class="wide">Chẩn đoán ô vừa bấm</button>
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
      const here = siteNow();
      const onPage = t => sameHost(t) && match(t);
      // Mẫu của đúng trang này lên trước, mẫu ở trang khác cùng website xếp sau
      const byPage = arr => byOwner(arr).sort((a, b) => (a.site !== here) - (b.site !== here));
      const forms = byPage(templates.filter(t => t.type === 'form' && onPage(t)));
      const macros = byPage(templates.filter(t => t.type === 'macro' && onPage(t)));
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
    root.querySelector('[data-a=diag]').onclick = () => { closeMenu(); diagnose(clicked); };

    place();
    input.focus();
    load(false);
  }

  // ===== CHẨN ĐOÁN =====
  // Thử mở ô vừa bấm (không chọn gì) và ghi lại những gì script nhìn thấy,
  // để người dùng chép gửi cho người hỗ trợ.
  const cleanHTML = (html, max) => String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>')
    .replace(/\s(_ngcontent|_nghost)-[\w-]+=""/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, max);
  const short = el => el ? `<${el.tagName.toLowerCase()}${el.id ? ' id=' + el.id : ''} class="${
    (typeof el.className === 'string' ? el.className : '').trim()}"${el.readOnly ? ' readonly' : ''}>` : '(không có)';

  function popupHTML() {
    const boxes = [...document.querySelectorAll('.cdk-overlay-container, [class*="-dropdown"], [role=listbox]')]
      .filter(x => shown(x) && !isOurUIEl(x));
    const top = boxes.filter(b => !boxes.some(o => o !== b && o.contains(b)));
    return top.map(b => b.outerHTML).join('\n');
  }
  const isOurUIEl = el => { for (let n = el; n; n = n.parentElement) if (n.dataset && 'ffUi' in n.dataset) return true; return false; };

  async function diagnose(clicked) {
    const L = [];
    const add = (k, v) => L.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    try {
      add('Phiên bản script', VERSION);
      add('Trang', location.host + location.pathname + location.hash.split('?')[0]);
      try { add('Tampermonkey', `${GM_info.scriptHandler || ''} ${GM_info.version || ''} sandbox=${GM_info.sandboxMode || '?'}`); } catch {}
      add('Ô vừa bấm', short(clicked));
      let input = null;
      if (clicked) {
        const frame = selectRootOf(clicked) || pickerRootOf(clicked);
        input = clicked.matches('input, textarea, select') ? clicked
          : (frame || clicked).querySelector('input, textarea, select');
      }
      add('Ô nhập tìm được', short(input));
      if (input) {
        const kind = kindOf(input);
        const root = selectRootOf(input), pr = pickerRootOf(input);
        add('Script nhận là', kind === 'select' ? 'danh sách chọn' : kind === 'date' ? 'ô chọn ngày' : 'ô nhập thường');
        add('Nhãn', labelOf(input));
        add('Vị trí lưu', fieldKey(input));
        add('Giá trị script đọc được', widgetValue(input));
        if (root) add('Khung danh sách', `${short(root)} tiền tố="${pfx(root)}" đang mở=${comboOpen(input, root)}`);
        if (pr) add('Khung chọn ngày', short(pr));
        L.push('--- HTML của ô ---', cleanHTML((root || pr || input.parentElement).outerHTML, 2500));
        if (kind === 'select') {
          const opened = await openCombo(input, root);
          await sleep(600);
          const opts = visibleOptions();
          add('Mở được danh sách', opened);
          add('Số lựa chọn script thấy', opts.length);
          add('Vài lựa chọn đầu', opts.slice(0, 5).map(o => `${short(o)} "${optionText(o)}"`));
          L.push('--- HTML danh sách đang mở ---', cleanHTML(popupHTML(), 4000) || '(không thấy)');
          if (comboOpen(input, root)) pressKey(input, 'Escape', 27);
          input.blur();
        } else if (kind === 'date' || input.tagName === 'INPUT') {
          input.focus();
          mouse(input, 'mousedown'); mouse(input, 'mouseup'); mouse(input, 'click');
          await sleep(600);
          add('Định dạng đang hiện', input.value || '(trống)');
          add('placeholder', input.placeholder || '');
          L.push('--- HTML lịch / popup đang mở ---', cleanHTML(popupHTML(), 3000) || '(không thấy)');
          pressKey(input, 'Escape', 27);
          input.blur();
        }
      }
      if (!templates) { try { await refresh(); } catch (e) { add('Tải mẫu', e.message); } }
      const mine = (templates || []).filter(t => t.type !== 'text' && sameHost(t));
      L.push('--- Mẫu của website này ---');
      mine.slice(0, 10).forEach(t => L.push(`${t.type === 'macro' ? 'Chuỗi' : 'Mẫu'} "${t.name}" (${t.site}): ` +
        (t.fields || t.steps || []).map(f => `${f.kind || f.action || 'text'} ${f.label}=${JSON.stringify(f.value ?? f.text ?? '')}`).join(' | ')));
      L.push('--- Lỗi gần đây ---', ...(errLog.length ? errLog.slice(-8) : ['(không có)']));
    } catch (e) {
      L.push('LỖI KHI CHẨN ĐOÁN: ' + (e.stack || e));
    }
    showReport(L.join('\n'));
  }

  function showReport(text) {
    const box = document.createElement('div');
    box.dataset.ffUi = '';
    Object.assign(box.style, { position: 'fixed', inset: '0', zIndex: 2147483647 });
    const root = box.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .bg { position: fixed; inset: 0; background: rgba(28,43,51,.35); display: flex; align-items: center;
              justify-content: center; font: 14px/1.4 system-ui, sans-serif; color: #1C2B33; }
        .d { width: min(760px, calc(100vw - 32px)); background: #fff; border-radius: 10px; padding: 18px;
             box-shadow: 0 10px 40px rgba(0,0,0,.25); }
        h2 { font-size: 16px; margin: 0 0 4px; } p { margin: 0 0 10px; color: #5F6F76; font-size: 13px; }
        textarea { width: 100%; box-sizing: border-box; height: 50vh; font: 12px/1.45 ui-monospace, Consolas, monospace;
                   border: 1px solid #D6DFDC; border-radius: 6px; padding: 8px; }
        .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
        button { padding: 7px 14px; border-radius: 6px; border: 1px solid #D6DFDC; background: #fff; font: inherit; cursor: pointer; }
        .p { background: #1E6B5C; border-color: #1E6B5C; color: #fff; }
      </style>
      <div class="bg"><div class="d" role="dialog" aria-label="Kết quả chẩn đoán">
        <h2>Kết quả chẩn đoán</h2>
        <p>Bấm "Sao chép" rồi dán gửi cho người hỗ trợ. Nội dung chỉ gồm cấu trúc ô và mẫu, không có thông tin bệnh nhân nếu bạn chẩn đoán trên form trống.</p>
        <textarea readonly></textarea>
        <div class="row"><button class="c">Đóng</button><button class="p">Sao chép</button></div>
      </div></div>`;
    const ta = root.querySelector('textarea');
    ta.value = text;
    root.querySelector('.c').onclick = () => box.remove();
    root.querySelector('.p').onclick = async () => {
      try { await navigator.clipboard.writeText(text); }
      catch { ta.focus(); ta.select(); document.execCommand('copy'); }
      root.querySelector('.p').textContent = 'Đã sao chép';
    };
    box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') box.remove(); });
    document.body.appendChild(box);
  }

  function toast(msg, ms = 2800) {
    const t = document.createElement('div');
    t.dataset.ffUi = '';
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 2147483647,
      background: '#1C2B33', color: '#fff', padding: '8px 14px', borderRadius: '6px',
      font: '13px system-ui, sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,.3)'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // Tải sẵn danh sách mẫu để menu mở nhanh
  if (PHONE) refresh().catch(() => {});
})();

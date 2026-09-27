# Máy chủ mẫu điền form

Ứng dụng Windows chạy ẩn dưới khay hệ thống (góc phải taskbar), lưu mẫu điền form cho userscript Tampermonkey
và tự cập nhật qua GitHub Releases.

- **Mẫu riêng**: chỉ hiện với số điện thoại đã tạo ra nó.
- **Mẫu được chia sẻ**: chủ mẫu chia sẻ cho từng SĐT; người nhận tự thấy, chỉ dùng, không sửa.
- **Mẫu dùng chung**: mọi người đều dùng được, chỉ quản trị viên được tạo, sửa, xóa.

---

## A. Cài trên máy làm máy chủ

1. Tải `May-chu-mau-Setup-x.y.z.exe` ở trang Releases của kho GitHub, chạy file đó. Không cần cài Node.js.
2. Lần đầu mở, cửa sổ **Cài đặt** hiện ra: điền SĐT quản trị viên, SĐT được phép (nên điền), bấm **Lưu và áp dụng**.
3. Đóng cửa sổ: app vẫn chạy dưới khay hệ thống, tự chạy lại mỗi khi mở máy.

**Biểu tượng dưới khay** (bấm chuột để mở menu, bấm đúp để mở trang quản lý):
- Mở trang quản lý mẫu · Cài đặt… · Khởi động lại máy chủ
- Dữ liệu: mở thư mục dữ liệu, sao lưu mẫu ra file, nhập mẫu từ file, mở nhật ký
- Kiểm tra cập nhật · Thoát (tắt máy chủ)
- Biểu tượng có chấm đỏ = máy chủ không chạy (thường do trùng cổng), rê chuột lên để xem lý do.

**Tunnel** (để các máy khác dùng qua Internet), chạy riêng trên máy chủ:
```
cloudflared tunnel --url http://localhost:8787
```
Dán địa chỉ tunnel vào ô **Địa chỉ tunnel** trong Cài đặt để lấy link cài userscript.

### Chuyển dữ liệu từ bản cũ (bản chạy bằng `node server.js`)
Khay hệ thống → **Dữ liệu → Nhập mẫu từ file…** → chọn file `templates.json` cũ
(nằm trong thư mục `data` hoặc cạnh `server.js` của bản cũ) → **Gộp** hoặc **Thay thế**.

### Dữ liệu nằm ở đâu
`%APPDATA%\May chu mau dien form\`
- `data\templates.json`: toàn bộ mẫu
- `data\backups\`: tự sao lưu mỗi ngày, giữ 14 ngày gần nhất
- `config.json`: cấu hình, `app.log`: nhật ký

Dữ liệu **không bị xóa** khi cập nhật hay gỡ cài đặt.

---

## B. Cài userscript cho các máy dùng

1. Cài extension **Tampermonkey** (Chrome/Edge: bật **Chế độ nhà phát triển** trong `chrome://extensions`).
2. Mở link `https://<địa-chỉ-tunnel>/mau-dien-form.user.js` (có nút sao chép trong Cài đặt, hoặc nút
   "Cài / cập nhật userscript" trên trang quản lý) → Tampermonkey hiện trang cài → **Cài đặt**.

Userscript cài theo cách này đã điền sẵn địa chỉ máy chủ và **tự cập nhật**: khi máy chủ lên bản mới
có userscript mới, Tampermonkey tự tải về (mặc định kiểm tra mỗi ngày; muốn nhanh thì vào Tampermonkey →
"Kiểm tra cập nhật userscript").

> Nếu địa chỉ tunnel thay đổi (link trycloudflare miễn phí đổi mỗi lần chạy lại), các máy phải cài lại
> userscript từ link mới. Dùng named tunnel với tên miền cố định để tránh việc này.

**Cách dùng**: Alt + chuột phải để nhập SĐT; Ctrl + click để mở menu mẫu (điền mẫu, chạy chuỗi thao tác,
lưu mẫu, ghi thao tác, chẩn đoán ô bị lỗi).

---

## C. Phát hành bản mới (cho người bảo trì)

### Chuẩn bị một lần
1. Cài **Node.js** bản LTS.
2. Tạo kho GitHub để chứa bản phát hành, vd `form-mau-server`.
   Nên để **Public**: các máy tải bản cập nhật không cần đăng nhập. Mã nguồn có thể để ở kho khác nếu muốn.
3. Mở `package.json`, tìm phần `"publish"`: thay `TEN_TAI_KHOAN_GITHUB` bằng tên tài khoản GitHub,
   `form-mau-server` bằng tên kho.
4. Tạo token: GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
   → chỉ chọn kho phát hành → quyền **Contents: Read and write**.
5. Chạy `build-and-publish.bat` lần đầu: script hỏi token, bạn dán vào (chuột phải hoặc Ctrl+V; ký tự
   bị ẩn khi gõ). Script kiểm tra token với GitHub rồi hỏi có lưu vào `gh-token.txt` để lần sau khỏi nhập không.
   **Không** dán token vào file `.bat`, không gửi file `gh-token.txt` cho ai, không đưa lên GitHub
   (đã có sẵn trong `.gitignore`). Token hết hạn hoặc bị thu hồi thì script báo và cho nhập token mới.

### Mỗi lần phát hành
Chạy `build-and-publish.bat` → chọn **Y** để tự tăng phiên bản → chờ build và đăng lên GitHub Releases.

Các máy đang chạy app sẽ tự nhận bản mới: kiểm tra khi mở app và mỗi 4 tiếng, tải ngầm, rồi tự cài
(máy chủ dừng vài giây và tự chạy lại). Tắt "Tự cài bản cập nhật" trong Cài đặt nếu muốn tự bấm cài.

### Chạy thử khi sửa code
- `chay-thu.bat` (hoặc `npm start`): chạy app có khay hệ thống, không cần build.
- `npm run server`: chỉ chạy máy chủ, không có khay (cấu hình trong `.env`, xem `.env.example`).
- `npm run dist:win`: build file cài đặt vào thư mục `dist` mà không đăng lên GitHub.

---

## Lưu ý bảo mật
- Không có mật khẩu: ai biết SĐT của bạn và địa chỉ tunnel thì dùng được mẫu của bạn.
  Giữ kín địa chỉ tunnel và điền danh sách SĐT được phép.
- Ai biết SĐT quản trị viên thì sửa được mẫu dùng chung. Nên chọn số ít người biết.
- Không lưu thông tin bệnh nhân cụ thể vào mẫu.
- Token GitHub chỉ để trong `gh-token.txt` trên máy phát hành. Nếu token từng bị lộ, vào GitHub thu hồi (Revoke) ngay.

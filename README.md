# Quyền Anh

Ứng dụng web PWA theo dõi sức khoẻ, sổ công việc và thu chi cá nhân tối giản, tốc độ cao, viết bằng **Go** + **SQLite** kết hợp giao diện **HTML5 / CSS3 / Vanilla JavaScript** (nhúng tĩnh qua `go:embed`).

Được tối ưu để chạy nhẹ trên **Koyeb Nano (0.1 vCPU, 512MB RAM)** và dùng mượt như app gốc trên điện thoại (iOS / Android).

---

## Tính năng chính

### 1. Hôm nay (Sức khoẻ & Thói quen hằng ngày)
- **Điểm tuân thủ hằng ngày (0–100):** Tổng hợp tiến độ uống nước, uống thuốc, cân nặng và bữa ăn qua biểu đồ vòng tròn SVG kèm lời chào linh động theo khung giờ.
- **Cân nặng:** Theo dõi hành trình cân nặng (`97.0 kg` → mục tiêu `70.0 kg`) với nút bấm nhanh `±0.1 kg`, `±0.5 kg` và biểu đồ tiến trình SVG.
- **Thuốc bổ gan nhiều cữ:** Đánh dấu từng cữ uống thuốc theo lịch nhắc (mặc định 3 lần/ngày: `08:00`, `12:30`, `20:00`).
- **Nước lọc:** Mục tiêu `2.500 – 3.000 ml/ngày`, hiệu ứng sóng nước SVG, chọn nhanh `+200ml`, `+300ml`, `+500ml`, `+1.000ml` hoặc nhập số tuỳ ý, hỗ trợ hoàn tác.
- **Ăn uống & Thực đơn Healthy:** Sinh thực đơn 7 ngày phù hợp mục tiêu năng lượng và nguyên liệu dân dã Việt Nam (hạn chế chiên rán/nội tạng/GI cao, đủ rau xanh), đổi món linh hoạt, tổng hợp danh sách đi chợ và ghi nhận `Ăn đúng` / `Ăn khác`.
- **Động lực:** Bộ ảnh và thông điệp khích lệ hằng ngày.

### 2. Công việc (Sổ công việc thay thế Excel)
- **Bảng lịch tháng trực quan (`T2` – `CN`):**
  - Khoanh **vòng xanh** vào những ngày có phát sinh đơn dịch vụ.
  - Khoanh **đỏ mận** vào ngày hôm nay (hiển thị vòng xanh bao ngoài + đỏ mận ở trong nếu hôm nay cũng có phát sinh đơn).
  - Bấm vào ngày bất kỳ trên lịch để chuyển ngay sang xem tổng kết và danh sách đơn chi tiết của ngày đó.
- **Thẻ tổng kết doanh thu:** Chuyển nhanh **Theo ngày / Cả tháng**, hiển thị tổng doanh thu, số đơn, **Thực thu** và **Còn nợ**.
- **Quản lý đơn dịch vụ:** Ghi đơn nhanh kèm gợi ý tên khách & dịch vụ thường dùng, phân loại kênh (`ZL`, `FB`), trạng thái thanh toán (`TT` đã thu / `CTT` còn nợ), sửa và xoá đơn.
- **Sổ nợ khách hàng:** Gom các đơn `CTT` theo từng khách hàng; hỗ trợ tìm kiếm theo tên khách/dịch vụ/ngày, lọc theo trạng thái (`Tất cả`, `Chưa trả`, `Đã trả xong`) và khoảng thời gian (`Tất cả`, `Theo ngày`, `Theo tháng`, `Từ – Đến`), thanh toán nhiều đợt kèm tiến độ %, và sao chép nội dung nhắc nợ.

### 3. Thu chi (Thu chi cá nhân)
- **Bảng lịch tháng (`T2` – `CN`):** Khoanh **vòng xanh** cho ngày có phát sinh thu chi (`Chi tiêu`, `Nộp Quỹ`, `Trả Nợ`, `Số Quỹ`), khoanh **đỏ mận** cho hôm nay; bấm vào ngày để xem danh sách phát sinh chi tiết trong ngày.
- **Thẻ tổng kết Theo ngày / Cả tháng:** Theo dõi nhanh `Chi tiêu`, `Nộp quỹ`, `Mượn` và `Trả nợ`.
- **Khoản Mượn của Quyền:** Gom toàn bộ khoản mượn xuyên suốt, tìm kiếm theo tên, lọc trạng thái, ghi nhận trả góp nhiều lần kèm lịch sử và phần trăm đã trả.

### 4. Cài đặt, Thông báo & Đồng bộ đa thiết bị
- **Web Push Notification:** Nhắc cân sáng, uống thuốc nhiều cữ, uống nước lọc và giờ đi ngủ (hỗ trợ cả Android, Desktop và iPhone iOS 16.4+ khi **Thêm vào Màn hình chính**). Tuỳ chỉnh mốc giờ nhắc tự do trên giao diện.
- **Đồng bộ đa thiết bị & Offline-first:** Lưu trữ kép tại trình duyệt (`localStorage` + `IndexedDB`) kèm hàng đợi đồng bộ (`outbox`) và `tombstones` chống trùng/mất dữ liệu khi mất mạng hoặc redeploy server.
- **Xuất & Sao lưu dữ liệu:**
  - Xuất bảng **Excel (`.csv`)** theo tháng.
  - Lưu/nạp file tài chính (`.json`), hỗ trợ gắn file tự động ghi trực tiếp trên ổ cứng (`showSaveFilePicker`).
  - Sao lưu & khôi phục toàn bộ dữ liệu ứng dụng (`.json`).

---

## Cấu trúc mã nguồn

```text
cmd/server/main.go          # Điểm khởi chạy HTTP server & worker nhắc nhở
internal/app/               # Router, auth PIN, health handlers, work/ledger, backup & Web Push
internal/meals/             # Thuật toán sinh thực đơn Healthy & danh sách đi chợ
web/                        # PWA frontend (index.html, style.css, app.js, sw.js, manifest.webmanifest)
Dockerfile                  # Multi-stage build (Go 1.23 -> Alpine 3.20)
```

---

## Hướng dẫn Deploy lên Koyeb

1. Push mã nguồn lên GitHub.
2. Vào [Koyeb Console](https://app.koyeb.com/) → **Create App** → chọn **GitHub** và repository của bạn (Koyeb tự nhận `Dockerfile`).
3. Chọn cấu hình **Nano** (`0.1 vCPU`, `512MB RAM`).
4. Cấu hình biến môi trường (**Environment Variables**):
   - `APP_PIN`: Mã PIN đăng nhập chính (nên đặt bí mật trên môi trường production).
   - `PORT`: `8080` (mặc định).
   - `DATA_DIR`: `/data` (thư mục lưu database SQLite).
   - `SESSION_SECRET`: *(Tuỳ chọn)* Khoá ký cookie phiên đăng nhập; nếu bỏ trống sẽ suy ra từ `APP_PIN`.
   - `TICK_TOKEN`: *(Tuỳ chọn)* Mã xác thực cho cron bên ngoài (cron-job.org / UptimeRobot) gọi `GET/POST /api/tick?token=...` để giữ dịch vụ hoạt động và kích hoạt nhắc nhở đúng giờ.
   - `VAPID_SUBJECT`: *(Tuỳ chọn)* Email hoặc URL liên hệ cho Web Push (ví dụ `mailto:you@example.com`).
5. Gắn **Persistent Volume** vào đường dẫn `/data` để giữ dữ liệu SQLite qua các lần redeploy.

---

## Chạy thử trên máy Local

Yêu cầu: **Docker** hoặc **Go 1.23+**

### Cách 1: Chạy bằng Docker
```bash
docker build -t quyenanh .
docker run -p 8080:8080 -e APP_PIN=123456 -v ./data:/data quyenanh
```

### Cách 2: Chạy trực tiếp bằng Go
```bash
APP_PIN=123456 DATA_DIR=./data go run ./cmd/server
```

Sau khi chạy, mở trình duyệt tại `http://localhost:8080` và nhập mã PIN đã cấu hình (mặc định local là `123456` nếu chưa đặt `APP_PIN`).

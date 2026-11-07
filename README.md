# QuyenHealth 🥗💧⚖️

Hệ thống web theo dõi sức khoẻ siêu nhanh, nhẹ, mượt và tối giản dành riêng cho **Phùng Văn Quyền**.
Được thiết kế để tối ưu chạy trên **Koyeb cấu hình Nano (0.1 vCPU, 512MB RAM, 2GB DISK)**.

---

## 🎯 Mục tiêu & Ràng buộc Sức khoẻ

- **Mục tiêu cân nặng:** 97 Kg &rarr; 70 Kg (Cao 1m72, 22 tuổi).
- **Chỉ số:** Gan nhiễm mỡ độ 3, máu đông, nguy cơ gút, đường huyết 5.6/7.0 (tiền tiểu đường), tuyến giáp.
- **Lời dặn của Bác sĩ được tích hợp thẳng vào thuật toán thực đơn:**
  - ❌ Hạn chế dầu mỡ, tuyệt đối không chiên rán, không nội tạng động vật.
  - ❌ Không dùng các loại tinh bột GI cao gây tăng đột ngột đường huyết.
  - ❌ Không dùng các thực phẩm đắt tiền/khó tìm (cá hồi, quinoa, bánh mì đen, gạo lứt...).
  - ✅ **Chỉ dùng nguyên liệu dân dã ở làng quê Việt Nam:** Khoai lang luộc, ngô luộc, ức gà, thịt thăn lợn nạc, cá đồng (rô, trắm, diêu hồng, chép), trứng gà, đậu phụ, lạc luộc, rau muống, rau cải, mồng tơi, bí xanh, bầu, bí đỏ, cà chua, cà rốt, thanh long ruột đỏ, ổi, đu đủ...
  - ✅ Bắt buộc mỗi ngày có ít nhất **3 phần rau xanh** và **1 món thực phẩm màu đỏ**.
  - ✅ Ngân sách năng lượng kiểm soát chặt chẽ ở mức **~1.800 kcal/ngày** (thâm hụt lành mạnh ~500 kcal giúp giảm cân an toàn 0.5 - 0.75kg/tuần).

---

## 🚀 Các Tính Năng Nghiệp Vụ

1. **💧 Theo Dõi Nước Lọc:**
   - Mục tiêu: Tối thiểu 2.500ml - Tối đa 3.000ml / ngày.
   - Hoạt hoạ sóng nước SVG dâng lên tương ứng với phần trăm mục tiêu đã uống.
   - Nút bấm nhanh 1 chạm: **Ca (300ml)**, **Chai nhỏ (500ml)**, **Bình (1.000ml)**, hoặc tự gõ số ml.
   - Nút hoàn tác (undo) nếu bấm nhầm.

2. **🍽️ Lên Lịch Bữa Ăn 7 Ngày & Checklist:**
   - Nút **"Tạo Lịch Bữa Ăn 7 Ngày"**: Thuật toán tự động sinh thực đơn 7 ngày đáp ứng 100% ràng buộc y khoa trong vòng chưa tới 10ms.
   - Nút **"🔄 Đổi món"** cho từng bữa nếu hôm đó không muốn ăn món được gợi ý.
   - Nút **"🛒 Đi chợ"**: Tự động gộp nguyên liệu của 7 ngày theo nhóm (Tinh bột, Đạm, Rau củ, Trái cây) kèm định lượng để đi chợ quê tiện lợi.
   - Checklist từng bữa:
     - `✅ Ăn đúng`: Xác nhận ăn đúng món.
     - `✍️ Ăn khác`: Mở form ghi chú món thực tế đã ăn kèm tag cảnh báo nhanh (*Có chiên rán, Có nội tạng, Ăn khuya, Ăn quá no, Uống bia*).

3. **⚖️ Theo Dõi Cân Nặng:**
   - Bộ chọn cân nặng dạng Stepper nút bấm nhanh `±0.1kg`, `±0.5kg` (không cần bàn phím).
   - Biểu đồ SVG siêu nhẹ hiển thị tiến trình giảm cân từ 97kg về 70kg.
   - Thống kê chênh lệch so với ngày hôm trước và mục tiêu.

4. **💊 Checklist Uống Thuốc:**
   - Nút xác nhận to bản `Đã uống thuốc hôm nay ✅` theo ngày.
   - Nhắc nhở qua thông báo push.

5. **🩸 Nhật Ký Đường Huyết & Giấc Ngủ:**
   - Ghi nhận chỉ số mmol/L theo thời điểm (sáng đói, sau ăn, trước ngủ).
   - Đánh dấu màu an toàn (< 5.6 mmol/L) và cảnh báo ngưỡng (>= 7.0 mmol/L).
   - Nhắc đi ngủ sớm trước 22:30 để bảo vệ gan.

6. **📑 Báo Cáo Sức Khoẻ Tuần:**
   - Tổng hợp lượng nước trung bình, % tuân thủ thực đơn, % uống thuốc và cân nặng thay đổi trong 7 ngày để đưa Bác sĩ xem khi tái khám.

7. **🔔 Thông Báo Web Push & Tương Thích iPhone:**
   - Hoạt động mượt mà trên iPhone (iOS 16.4+) khi chọn **Chia sẻ &rarr; Thêm vào Màn hình chính** (Add to Home Screen).
   - Endpoint `/api/tick` hỗ trợ các cron ngoài (cron-job.org / UptimeRobot) ping giữ dịch vụ không bị ngủ trên gói Koyeb Free.

8. **💾 Sao Lưu & Khôi Phục JSON:**
   - 1-click tải toàn bộ dữ liệu ra file `.json` hoặc khôi phục dữ liệu bất cứ lúc nào.

---

## ⚙️ Hướng Dẫn Deploy Lên Koyeb

### Cách 1: Deploy qua GitHub Repository

1. Push mã nguồn này lên GitHub của bạn (repo public hoặc private).
2. Vào [Koyeb Console](https://app.koyeb.com/) &rarr; bấm **Create App** &rarr; chọn **GitHub**.
3. Chọn repo `webchoquyen`.
4. Koyeb sẽ tự động nhận diện `Dockerfile`.
5. Cấu hình phần cứng:
   - **Instance type:** `nano` (0.1 vCPU, 512MB RAM).
6. Cấu hình biến môi trường (**Environment Variables**):
   - `APP_PIN`: Mã PIN bảo mật để Quyền đăng nhập (Ví dụ: `686868` hoặc ngày sinh của Quyền).
   - `PORT`: `8080` (Mặc định).
   - `DATA_DIR`: `/data` (Nơi lưu database SQLite).
   - `TICK_TOKEN`: Mã bí mật bất kỳ nếu dùng cron ngoài ping `/api/tick?token=...`.
   - `VAPID_SUBJECT`: Email liên hệ của bạn (Ví dụ: `mailto:your-email@gmail.com`).
7. *(Khuyến nghị nếu gói Koyeb hỗ trợ)*: Gắn một **Persistent Volume** vào đường dẫn `/data` để giữ dữ liệu qua các lần redeploy.
8. Bấm **Deploy**. Sau ~1 phút, dịch vụ sẽ online tại URL `https://<app-name>.koyeb.app`.

---

## 💻 Chạy Thử Trên Máy Local

Yêu cầu: Đã cài Docker hoặc Go 1.23+

```bash
# Chạy với Docker
docker build -t quyenhealth .
docker run -p 8080:8080 -e APP_PIN=123456 -v ./data:/data quyenhealth

# Mở trình duyệt:
http://localhost:8080
# Nhập mã PIN: 123456
```


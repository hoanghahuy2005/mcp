# Bàn giao MCP ProjeQtOr — 27/10/2026

## Trạng thái hiện tại

Đã tiếp quản theo yêu cầu tiếp tục của người dùng. **M1–M5 hoàn tất trong phạm vi chạy cục bộ, Mock Mode và tích hợp REST với upstream giả lập.** Không còn task triển khai mock nào đang chờ trong kế hoạch hiện tại.

Lệnh dừng và phân công Main/Backend/QA của bàn giao 22/10 là lịch sử. Phiên này triển khai/review/chạy lại QA trong cùng một agent; không tuyên bố có một lần QA độc lập mới. Đã bảo toàn nguồn ProjeQtOr và các thay đổi có sẵn.

## Sản phẩm đã có

- HTTP Streamable trên 127.0.0.1 và stdio; bearer/Host/Origin validation, health, giới hạn request, JSON log stderr.
- Tool ghi: `create_activity` và `delete_activity`. Xóa chỉ có ở Real Mode, bắt buộc lượt kiểm tra `confirmed=false` rồi xác nhận người dùng trước lượt `confirmed=true`; không có approval CLI.
- Adapter REST chỉ GET allowlist, Basic Auth, timeout/response bounds, chuẩn hóa dữ liệu và lỗi an toàn, không fallback từ Real sang Mock.
- Workload theo Assignment, distinct Activity, tổng đơn vị gốc và dữ liệu thiếu rõ ràng; không suy diễn giờ/capacity/overload.
- Preview lưu đề xuất cục bộ có hạn; CLI người dùng duyệt đúng ID/hash; tạo mock cần ENABLE_WRITE=true, phê duyệt chỉ dùng một lần. Lock nhiều tiến trình và cập nhật state nguyên tử tránh tạo trùng; dữ liệu mock đọc được sau restart.
- Default ENABLE_WRITE=false. Real create luôn trả REAL_WRITE_BLOCKED trước mọi truy cập upstream; CLI cũng chặn duyệt proposal real.

## Bằng chứng hoàn tất

`npm.cmd run verify` exit 0: **132 PASS, 0 FAIL, 0 SKIP**; build + 81 unit + 18 helper + 4 foundation + 26 API-read + 3 workload/workflow integration, kèm SDK HTTP/stdio legacy/modern và Inspector list/call đều đạt.

Npm audit mới nhất: 0 lỗ hổng được báo cáo. So sánh SHA256/file set nguồn ProjeQtOr: **5316/5316 không đổi**, không có file thêm/xóa trong tập nguồn. Không sửa PHP, DB hay Apache; không khởi tạo Git/commit.

Chi tiết tại `ACCEPTANCE_REPORT.md`; log và kết quả JSON ở `.qa-artifacts/` (ignored). Build ở `dist/`, dependency hiện có ở `node_modules/`. SDK server/client 2.3.1, Node adapter 2.1.1, Inspector 2.12.0; yêu cầu Node >=24.15.0.

## Chạy và kiểm tra lại

Tại `projeqtor-mcp-server/`:

```powershell
npm.cmd run verify
$env:PROJEQTOR_MODE = 'mock'
$env:ENABLE_WRITE = 'false'
$env:MCP_BEARER_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm.cmd start
```

HTTP mặc định: `http://127.0.0.1:8787/mcp`; `/health` không chứng minh đăng nhập upstream. Stdio cho MCP host: gọi trực tiếp node với đường dẫn tuyệt đối `dist/index.js` và `--stdio`, env mock/ghi tắt. Dùng `docs/CONNECTION_GUIDE.md` và `examples/` để cấu hình host; cấu hình người dùng chưa bị thay đổi.

Thử tạo mock: bật `ENABLE_WRITE=true` trước khi khởi động rồi gọi `create_activity` trực tiếp với `projectId` và `name`.

State mặc định `.mcp-state/`, TTL mặc định 300 giây; tối đa 1000 proposal và 1000 activity mock. State lỗi/còn lock sau kill phải xử lý theo README; không xóa state tự động. Chỉ dành cho người dùng OS cục bộ đáng tin cậy.

## Phần còn chờ phạm vi/điều kiện riêng

**Live reads vẫn BLOCKED theo lựa chọn trước của người dùng.** Không tìm credentials, không bật Real Mode vào URL thật và không gọi API thật. QLDA_Nhom9 trong fixture là giả lập, dự án thật chưa được xác minh.

**Real writes BLOCKED.** Cần thiết kế/xác minh AesCtr/API key, quyền và phê duyệt ghi thật riêng. Upstream bearer/signature hiện bị vô hiệu hóa trong nguồn đã khảo sát; dùng Basic cho adapter đọc. HTTP MCP bearer là bí mật khác.

**Kết nối tài khoản thực tế chưa xác minh.** OAuth/discovery/rotation đã pass trên loopback; vẫn cần hostname HTTPS cố định, endpoint đăng nhập ProjeQtOr thật và kiểm thử auto-refresh/revoke bằng ChatGPT web trước khi tuyên bố production.

Điểm bắt đầu cho phiên sau: đọc README và PLAN/TASKS/ACCEPTANCE_REPORT hiện tại, chạy verify nếu có thay đổi cần kiểm chứng, rồi xử lý đúng gate mở rộng được người dùng yêu cầu; không quay lại triển khai M2 như bàn giao cũ.

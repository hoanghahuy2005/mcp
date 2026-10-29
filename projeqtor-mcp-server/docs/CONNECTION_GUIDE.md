# Kết nối MCP — cập nhật 28/10/2026

Server đã được kiểm tra bằng SDK MCP và Inspector. Chưa thay đổi cấu hình Codex của người dùng hoặc xác nhận kết nối từ tài khoản thật.

## Codex cục bộ: stdio

Codex hỗ trợ cấu hình stdio trong `config.toml`, gồm `command`, `args`, `cwd` và `env`. Xem [tài liệu MCP chính thức của OpenAI](https://learn.chatgpt.com/docs/extend/mcp).

Build package, sau đó chép ví dụ [codex-stdio.toml](../examples/codex-stdio.toml) vào cấu hình MCP đang dùng. Ví dụ dùng đường dẫn hiện tại của project, Mock Mode và tắt tạo activity. Điều chỉnh đường dẫn nếu di chuyển thư mục.

```toml
[mcp_servers.projeqtor]
command = "node"
args = ["D:/HoangPc/Study/Subject/QLDA/OpenSrc/projeqtorV13.1.1/projeqtor/projeqtor-mcp-server/dist/index.js", "--stdio"]
cwd = "D:/HoangPc/Study/Subject/QLDA/OpenSrc/projeqtorV13.1.1/projeqtor/projeqtor-mcp-server"
env = { PROJEQTOR_MODE = "mock", ENABLE_WRITE = "false" }
```

Khởi chạy trực tiếp `node` để stdout chỉ chứa giao thức. Ví dụ không tải `.env`; không cần bearer token cho stdio. Sau khi tải lại cấu hình, kiểm tra danh sách mười tool và gọi `list_projects`, rồi `analyze_workload` với `projectId=1`. Kết quả phải ghi `mode=mock`; tên `QLDA_Nhom9` là fixture giả lập.

## Codex cục bộ: HTTP

OpenAI hỗ trợ `url` và `bearer_token_env_var` cho Streamable HTTP. Xem [cấu hình MCP chính thức](https://learn.chatgpt.com/docs/extend/mcp).

Khởi động server theo README rồi dùng [codex-http.toml](../examples/codex-http.toml). Server và tiến trình Codex phải nhận cùng `MCP_BEARER_TOKEN`; đặt biến trong cửa sổ PowerShell khác không tự cập nhật môi trường của ứng dụng đang chạy. Không chép token vào TOML hoặc URL.

```toml
[mcp_servers.projeqtor_http]
url = "http://127.0.0.1:8787/mcp"
bearer_token_env_var = "MCP_BEARER_TOKEN"
```

`/health` chỉ xác nhận tiến trình sẵn sàng, không xác nhận mật khẩu ProjeQtOr đúng. HTTP bearer xác thực client vào MCP; upstream Basic Auth là thông tin riêng của tài khoản ProjeQtOr. Server hiện dùng một tài khoản upstream cho mỗi tiến trình, chưa có ánh xạ danh tính nhiều người dùng.

## Thử tạo mock

Đổi `ENABLE_WRITE` sang `true` trong cấu hình Mock Mode rồi khởi động lại server. Tạo mock Activity trực tiếp bằng `create_activity`. Riêng `ENABLE_WRITE=true` không mở ghi thật.

## Bật ghi Activity thật

Chỉ bật trên tài khoản và project đã được phép. Cấu hình `PROJEQTOR_MODE=real`, `ENABLE_WRITE=true`, `ENABLE_REAL_WRITE=true`, API key 32 ký tự hex của đúng `PROJEQTOR_USERNAME`, và `PROJEQTOR_AES_KEY_LENGTH` khớp cấu hình ProjeQtOr. ChatGPT có thể gọi `create_activity` trực tiếp trong một lượt; cần có `activityTypeId`, `statusId`, `creationDate`. `delete_activity` phải được gọi lần đầu với `confirmed=false`, hỏi xác nhận người dùng bằng thông tin Activity trả về, rồi mới gọi lại với `confirmed=true`. Cả hai tool cần MCP `mcp:write` và các gate local.

Nếu kết quả tạo không rõ, gửi lại đúng payload một lần. Server sẽ tự đối soát và trả Activity khi tìm thấy chính xác một bản ghi khớp; nếu không thể xác định duy nhất, server chặn ghi lại để tránh tạo trùng.

## ChatGPT Work trên web

ChatGPT web không đọc `config.toml` cục bộ; Work dùng plugin cho MCP từ xa. Xem [tài liệu OpenAI](https://learn.chatgpt.com/docs/extend/mcp). Thêm custom MCP server qua Plugins phụ thuộc quyền workspace và hỗ trợ URL hoặc Secure MCP Tunnel; các lựa chọn xác thực có OAuth. Xem [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server).

Server hiện có OAuth 2.1 Authorization Code + PKCE S256, discovery, DCR/CIMD, refresh rotation và revocation. Để kết nối thực tế:

1. Đưa toàn bộ server (không chỉ `/mcp`) ra một hostname HTTPS cố định bằng reverse proxy/ngrok; Node vẫn bind `127.0.0.1`.
2. Đặt `MCP_AUTH_MODE=oauth`, `OAUTH_ISSUER=https://<host>` và `OAUTH_RESOURCE=https://<host>/mcp`. `OAUTH_PROJEQTOR_BASE_URL` phải trỏ tới API ProjeQtOr thực sự kiểm tra Basic credentials.
3. Xác nhận hai URL discovery trả JSON: `/.well-known/oauth-protected-resource` và `/.well-known/oauth-authorization-server`.
4. Trong ChatGPT Plugins, chọn Add custom MCP server, nhập `https://<host>/mcp`, chọn OAuth và dùng client/callback chính xác mà trang quản lý hiển thị. Mặc định server đã pre-register `https://chatgpt.com/oauth/client.json` và callback ổn định; DCR cũng được hỗ trợ.
5. Cài plugin, thực hiện login/consent, gọi một tool đọc, chờ access token hết hạn trong môi trường test TTL ngắn và gọi lại để xác nhận ChatGPT tự refresh mà không mở login.
6. Thu hồi connection và xác nhận lần gọi sau yêu cầu liên kết lại.

Luồng trên đã pass bằng client HTTP loopback độc lập nhưng chưa được chạy bằng tài khoản ChatGPT/ngrok thật. Ngoài ra token nhận diện user đăng nhập, còn real data adapter hiện vẫn gọi ProjeQtOr bằng tài khoản upstream cấu hình cho tiến trình; muốn phân quyền dữ liệu hoàn toàn theo từng user cần thêm delegated upstream credentials.

## Chẩn đoán

| Hiện tượng | Kiểm tra |
|---|---|
| Tiến trình thoát khi khởi động | Chạy `npm.cmd run build`; kiểm tra Node >=24.15.0, port và cấu hình hợp lệ. Log startup được làm sạch nên không in giá trị bí mật. |
| HTTP 401 | Client thiếu/sai bearer; không dùng mật khẩu ProjeQtOr làm MCP token. |
| HTTP 403 | Host/Origin phải khớp chính xác cấu hình loopback. |
| `WRITE_DISABLED` | Bật `ENABLE_WRITE=true` cho chế độ ghi được phép, sau đó khởi động lại. |
| `STATE_BUSY` | Kiểm tra tiến trình sử dụng state; hướng dẫn xử lý lock trong README. |
| `REAL_WRITE_BLOCKED` | Thiếu `ENABLE_REAL_WRITE`, API key/AES length hợp lệ hoặc real write client. |
| `OPERATION_OUTCOME_UNKNOWN` | Không thể tự xác định duy nhất kết quả lần ghi trước; kiểm tra Activity trong ProjeQtOr để tránh tạo trùng. |

Mọi kiểm tra tự động hiện tại dùng mock hoặc upstream giả lập. Kết nối live vẫn giữ trạng thái chặn theo lựa chọn trước của người dùng.

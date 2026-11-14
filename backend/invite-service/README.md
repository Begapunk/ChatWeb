# invite-service

FastAPI 邀请管理服务，M1 起开发。职责：

- 安全随机一次性邀请码（仅存哈希）、过期时间、尝试次数限制
- 全系统 4 人名额的事务性控制
- 通过 Synapse 官方注册令牌 API 创建注册凭证（管理 Token 仅本服务持有）
- 注册成功后引导加入固定私人加密房间

浏览器永不直接访问 Synapse 管理 API。环境变量见根目录 `.env.example`。
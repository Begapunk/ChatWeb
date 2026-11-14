-- Aether 邀请服务初始 schema（DESIGN-M1 §3.2）
-- PG16；gen_random_uuid() 内建（PG13+）。仅经版本表 runner 执行，禁手工改表。

CREATE TABLE invite_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag         text NOT NULL UNIQUE,          -- 码前段（uuid 前 10 hex），定位用；不含熵
  salt        text NOT NULL,                 -- base64(16B)，逐码独立
  code_hash   text NOT NULL,                 -- hex sha256(salt ‖ pepper ‖ code)（见 DESIGN-M1-CHECKS 偏差 3）
  status      text NOT NULL DEFAULT 'UNUSED'
              CHECK (status IN ('UNUSED','USED','EXPIRED','BLOCKED','REVOKED')),
  expires_at  timestamptz NOT NULL,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb   -- note/created_by 等；禁存明文码/令牌
);

-- 单行名额锁对象（id 恒为 1）
CREATE TABLE quota_counters (
  id          integer PRIMARY KEY CHECK (id = 1),
  max_members integer NOT NULL DEFAULT 4,
  seats_used  integer NOT NULL DEFAULT 0
);

CREATE TABLE rooms (
  room_id    text PRIMARY KEY,               -- Synapse room_id（!xxx:server_name）
  kind       text NOT NULL CHECK (kind IN ('group','private')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_invite_jobs (
  id               bigserial PRIMARY KEY,
  user_id          text NOT NULL,            -- 新用户 MXID
  room_id          text NOT NULL REFERENCES rooms(room_id),
  status           text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','DONE','FAILED')),
  attempts         integer NOT NULL DEFAULT 0,
  last_error_code  text,                     -- 仅错误码，禁含响应体
  last_attempt_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, room_id)                  -- 幂等：同人对同房至多一个任务
);

-- 审计日志（P1-2）：仅事件码/结果码/关联 id，无任何明文机密
CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  event_type  text NOT NULL,                 -- code.created/code.revoked/verify.ok/verify.fail/token.issued/invite.done/invite.retry/invite.failed/bootstrap.*
  code_id     uuid REFERENCES invite_codes(id),
  result      text NOT NULL,                 -- 'ok' 或错误码枚举
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_room_invite_jobs_pending ON room_invite_jobs (status, id);
CREATE INDEX idx_audit_events_type ON audit_events (event_type, created_at);

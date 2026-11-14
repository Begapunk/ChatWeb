#!/usr/bin/env python3
"""Aether homeserver 配置渲染脚本（宿主机 Python >= 3.10，仅标准库）。

用法：
    python scripts/render-synapse-config.py --env-file .env [--local] [--data-dir infra/synapse/data]

职责：
  1. 解析 .env（简单 KEY=VALUE 行；支持引号与 # 注释）；
  2. 以 {{VAR}} 占位符渲染 infra/synapse/homeserver.yaml.template 与
     infra/synapse/aether-synapse.log.config.template；
  3. 产物写入 <data-dir>/homeserver.yaml 与 <data-dir>/aether-synapse.log.config
     （gitignore；signing key 等其它 data 目录内容一概不动）。

--local（或 .env 中 SYNAPSE_PUBLIC_BASEURL_MODE=local）时：
  public_baseurl = http://127.0.0.1:8008/   （本地测试 profile）
否则：
  public_baseurl = https://$AETHER_DOMAIN/   （生产）

安全：脚本绝不打印任何密钥值，只打印已渲染的变量名。
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REQUIRED_KEYS = (
    "SYNAPSE_SERVER_NAME",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "SYNAPSE_REGISTRATION_SHARED_SECRET",
    "SYNAPSE_MACARON_SECRET_KEY",
    "SYNAPSE_FORM_SECRET",
    "OPERATOR_EMAIL",
)


def parse_env_file(path: Path) -> dict[str, str]:
    """极简 dotenv 解析（仅本脚本所需语义）。"""
    env: dict[str, str] = {}
    if not path.exists():
        sys.exit(f"error: env file not found: {path}")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # 去成对引号
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key:
            env[key] = value
    return env


def render(template: str, variables: dict[str, str], source: str) -> str:
    def _sub(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in variables:
            sys.exit(f"error: {source} references unknown/missing variable {{{{{name}}}}}")
        return variables[name]

    rendered = re.sub(r"\{\{([A-Z0-9_]+)\}\}", _sub, template)
    leftover = re.search(r"\{\{[^}]*\}\}", rendered)
    if leftover:
        sys.exit(f"error: {source} still contains unreplaced placeholder {leftover.group(0)!r}")
    return rendered


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Synapse homeserver/log config from .env")
    parser.add_argument("--env-file", default=".env", help="env 文件路径（默认 .env）")
    parser.add_argument("--local", action="store_true", help="本地测试 profile（public_baseurl=http://127.0.0.1:8008/）")
    parser.add_argument("--data-dir", default="infra/synapse/data", help="渲染产物目录")
    args = parser.parse_args()

    env_path = Path(args.env_file)
    if not env_path.is_absolute():
        env_path = REPO_ROOT / env_path
    env = parse_env_file(env_path)

    missing = [k for k in REQUIRED_KEYS if not env.get(k)]
    if missing:
        sys.exit("error: missing required env keys: " + ", ".join(missing))

    # public_baseurl 形态
    mode = "local" if args.local else env.get("SYNAPSE_PUBLIC_BASEURL_MODE", "production")
    if mode == "local":
        public_baseurl = "http://127.0.0.1:8008/"
    else:
        domain = env.get("AETHER_DOMAIN")
        if not domain:
            sys.exit("error: AETHER_DOMAIN required for production public_baseurl")
        public_baseurl = f"https://{domain}/"

    # report_stats 归一化为 YAML 布尔
    report_stats_raw = env.get("SYNAPSE_REPORT_STATS", "no").strip().lower()
    report_stats = "true" if report_stats_raw in ("yes", "true", "1") else "false"

    variables = {
        "SYNAPSE_SERVER_NAME": env["SYNAPSE_SERVER_NAME"],
        "SYNAPSE_PUBLIC_BASEURL": public_baseurl,
        "SYNAPSE_REPORT_STATS": report_stats,
        "POSTGRES_USER": env["POSTGRES_USER"],
        "POSTGRES_PASSWORD": env["POSTGRES_PASSWORD"],
        "POSTGRES_DB": env["POSTGRES_DB"],
        "SYNAPSE_REGISTRATION_SHARED_SECRET": env["SYNAPSE_REGISTRATION_SHARED_SECRET"],
        "SYNAPSE_MACARON_SECRET_KEY": env["SYNAPSE_MACARON_SECRET_KEY"],
        "SYNAPSE_FORM_SECRET": env["SYNAPSE_FORM_SECRET"],
        "OPERATOR_EMAIL": env["OPERATOR_EMAIL"],
    }

    data_dir = Path(args.data_dir)
    if not data_dir.is_absolute():
        data_dir = REPO_ROOT / data_dir
    data_dir.mkdir(parents=True, exist_ok=True)

    # 渲染时用脱敏副本做摘要（不含任何密钥值）
    safe_summary = {k: ("***" if any(s in k for s in ("SECRET", "PASSWORD")) else v) for k, v in variables.items()}

    homeserver_tpl = (REPO_ROOT / "infra/synapse/homeserver.yaml.template").read_text(encoding="utf-8")
    log_tpl = (REPO_ROOT / "infra/synapse/aether-synapse.log.config.template").read_text(encoding="utf-8")

    (data_dir / "homeserver.yaml").write_text(render(homeserver_tpl, variables, "homeserver.yaml.template"), encoding="utf-8")
    (data_dir / "aether-synapse.log.config").write_text(render(log_tpl, variables, "aether-synapse.log.config.template"), encoding="utf-8")

    print(f"rendered {data_dir / 'homeserver.yaml'} (mode={mode})")
    print(f"rendered {data_dir / 'aether-synapse.log.config'}")
    print("variables: " + ", ".join(f"{k}={v}" for k, v in safe_summary.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

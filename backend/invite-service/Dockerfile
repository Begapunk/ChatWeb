# Aether 邀请服务镜像 — python:3.12-slim（DEPENDENCIES.md 锁定）
ARG REGISTRY_MIRROR=docker.1ms.run
FROM ${REGISTRY_MIRROR}/library/python:3.12-slim

# pip 镜像源（构建机网络约束，R3.4 同类；可用 build-arg 覆盖）
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL}

WORKDIR /srv

# 依赖先装（利用层缓存）；优先用 lock 文件（首次构建后由容器内 pip freeze 产出并提交）
COPY requirements.txt requirements.lock.txt* ./
RUN if [ -f requirements.lock.txt ]; then \
        pip install --no-cache-dir -r requirements.lock.txt; \
    else \
        pip install --no-cache-dir -r requirements.txt && \
        pip freeze > requirements.lock.txt; \
    fi

COPY app ./app

# 非 root 运行
RUN useradd --system --uid 10001 aether \
    && mkdir -p /srv \
    && chown -R aether:aether /srv
USER aether

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

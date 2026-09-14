#!/bin/bash
# 掌兴代账系统 · 子域名批量部署脚本（可复用）
# 用法：bash deploy-subsite.sh <域名1> [域名2 ...]
# 例： bash deploy-subsite.sh dz-li.bianzige.cn dz-wang.bianzige.cn
# 前提：域名已解析到 47.85.20.92；SSH 公钥免密；deploy/nginx/ 下有 daizang 模板 conf
# 流程：上传 dist 与模板 → HTTP 站点(ACME 验证) → acme.sh 签证书挂自动续期 → 正式 HTTPS 配置
set -e
SERVER=root@47.85.20.92
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
DOMAINS="$@"

echo "== 1. 本地构建并上传产物与配置模板 =="
cd "$PROJ"
npm run build >/dev/null 2>&1
# 用 shell glob 引用 conf（该路径字面量偶发不可见字符污染，glob 从磁盘读真实字节最稳）
cp deploy/nginx/*.conf /tmp/tpl.full.conf.src
cp deploy/nginx/*.http-only /tmp/tpl.http.conf.src
tar -C dist -czf /tmp/zc_dist.tgz .
scp -q /tmp/zc_dist.tgz "$SERVER:/tmp/"
scp -q /tmp/tpl.http.conf.src "$SERVER:/tmp/tpl.http.conf"
scp -q /tmp/tpl.full.conf.src "$SERVER:/tmp/tpl.full.conf"
rm -f /tmp/tpl.http.conf.src /tmp/tpl.full.conf.src

echo "== 2. 部署目录 + HTTP 站点（回答 ACME 验证）=="
ssh "$SERVER" "set -e
for D in $DOMAINS; do
  mkdir -p /www/wwwroot/\$D/app/dist
  tar -C /www/wwwroot/\$D/app/dist -xzf /tmp/zc_dist.tgz 2>/dev/null
  sed 's/daizhang\.bianzige\.cn/'\$D'/g' /tmp/tpl.http.conf > /www/server/panel/vhost/nginx/\$D.conf
done
/www/server/nginx/sbin/nginx -t >/dev/null 2>&1 && /www/server/nginx/sbin/nginx -s reload"

echo "== 3. 签发并安装证书（挂自动续期）=="
ssh "$SERVER" "set -e
for D in $DOMAINS; do
  ~/.acme.sh/acme.sh --issue -d \$D -w /www/wwwroot/\$D/app/dist --server letsencrypt 2>&1 | grep -E 'Cert success|Skipping|error' | head -1
  mkdir -p /www/server/panel/vhost/cert/\$D
  ~/.acme.sh/acme.sh --install-cert -d \$D --ecc \
    --fullchain-file /www/server/panel/vhost/cert/\$D/fullchain.pem \
    --key-file /www/server/panel/vhost/cert/\$D/privkey.pem \
    --reloadcmd '/www/server/nginx/sbin/nginx -s reload' >/dev/null 2>&1
done"

echo "== 4. 启用正式 HTTPS 配置 =="
ssh "$SERVER" "set -e
for D in $DOMAINS; do
  sed 's/daizhang\.bianzige\.cn/'\$D'/g' /tmp/tpl.full.conf > /www/server/panel/vhost/nginx/\$D.conf
done
/www/server/nginx/sbin/nginx -t 2>&1 | grep conflicting && exit 1 || true
/www/server/nginx/sbin/nginx -t >/dev/null 2>&1 && /www/server/nginx/sbin/nginx -s reload"
rm -f /tmp/zc_dist.tgz
echo "== 部署完毕，请外网验证各域名 =="

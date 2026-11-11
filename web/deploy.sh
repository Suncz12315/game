#!/usr/bin/env bash
# 松鼠大作战 · 一键部署到 Ubuntu VPS
#
# 用法:
#   ./deploy.sh user@服务器IP                          # 使用默认域名 squirrel.playkk.top
#   ./deploy.sh user@服务器IP squirrel.playkk.top      # 显式指定域名
#
# 多游戏共存约定: 一台服务器托管多个游戏, 每个游戏一个子域名
#   squirrel.playkk.top  → 本游戏
#   <其他游戏>.playkk.top → 其他游戏各自的子域名
# 每个子域名在服务器上有独立的站点目录(/var/www/<域名>)和
# nginx 配置(/etc/nginx/sites-available/<域名>), 互不影响, 可反复部署。
#
# 前提: 本机可通过 SSH 登录服务器(密码或密钥均可); 域名须已解析到该 IP。
set -euo pipefail

SERVER="${1:?用法: ./deploy.sh user@服务器IP [域名]}"
DOMAIN="${2:-squirrel.playkk.top}"
WEB_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── 远端安装脚本(先上传再执行, 避免与 SSH 密码提示抢占 stdin) ──
cat > "$TMP/setup.sh" <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
DOMAIN="$1"
SITE_ROOT="/var/www/$DOMAIN"
UPLOAD_DIR="/tmp/deploy-$DOMAIN"

sudo apt-get update
sudo apt-get install -y nginx
sudo mkdir -p "$SITE_ROOT"
sudo cp -r "$UPLOAD_DIR"/* "$SITE_ROOT/"
sudo chown -R www-data:www-data "$SITE_ROOT"
rm -rf "$UPLOAD_DIR"

# 每个子域名一个独立 server 块; 不动 default 和其他游戏站点
sudo tee "/etc/nginx/sites-available/$DOMAIN" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $SITE_ROOT;
    index index.html;
    location / { try_files \$uri \$uri/ =404; }
}
EOF

sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 防火墙放行(若启用了 ufw)
sudo ufw allow 'Nginx Full' 2>/dev/null || true

echo "==> 3/3 申请 HTTPS 证书(域名须已解析到本机)..."
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    -m "admin@${DOMAIN#*.}" --redirect \
  || sudo certbot --nginx -d "$DOMAIN"
EOS

echo "==> 1/3 上传游戏文件到 $SERVER (站点: $DOMAIN) ..."
rsync -avz --delete --exclude test.html --exclude tools --exclude serve.sh \
  --exclude README.md --exclude deploy.sh \
  "$WEB_DIR/index.html" "$WEB_DIR/style.css" "$WEB_DIR/engine.js" "$WEB_DIR/game.js" \
  "$WEB_DIR/sw.js" "$WEB_DIR/manifest.webmanifest" "$WEB_DIR/icons" \
  "$SERVER:/tmp/deploy-$DOMAIN/"

echo "==> 2/3 上传安装脚本 ..."
scp "$TMP/setup.sh" "$SERVER:/tmp/setup-$DOMAIN.sh"

echo "==> 服务器上安装 nginx 并配置站点(可能需要输入 SSH 密码/确认) ..."
ssh "$SERVER" "bash /tmp/setup-$DOMAIN.sh '$DOMAIN'"

echo ""
echo "✅ 部署完成: https://$DOMAIN"
echo ""
if grep -q 'content="icons/share-card.png"' "$WEB_DIR/index.html"; then
  echo "别忘了最后一步 —— 把分享预览图改成绝对地址:"
  echo "  sed -i '' 's|content=\"icons/share-card.png\"|content=\"https://$DOMAIN/icons/share-card.png\"|' \"$WEB_DIR/index.html\""
  echo "  ./deploy.sh $SERVER $DOMAIN   # 再跑一次让改动生效"
else
  echo "分享预览图已是绝对地址, 无需额外处理。"
fi

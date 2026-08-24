#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-inventory}"
DB_USER="${DB_USER:-fishuser}"
DB_PASSWORD="${DB_PASSWORD:-fishpass}"
INSTALL_FRONTEND="${INSTALL_FRONTEND:-1}"
INSTALL_AI="${INSTALL_AI:-1}"

cd "$PROJECT_DIR"

sudo apt update
sudo apt install -y python3 python3-venv python3-pip build-essential pkg-config libmariadb-dev mariadb-server nodejs npm

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel

if [ "$INSTALL_AI" = "1" ]; then
  pip install -r requirements.txt
else
  pip install Flask flask-socketio python-socketio python-engineio simple-websocket mariadb pymysql bcrypt python-dotenv requests pyyaml opencv-python
fi

cat > .env <<EOF
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
APP_HOST=0.0.0.0
APP_PORT=5000
APP_DEBUG=false
EOF

sudo systemctl enable mariadb
sudo systemctl start mariadb

sudo mariadb -e "CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
sudo mariadb -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';"
sudo mariadb -e "CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';"
sudo mariadb -e "GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';"
sudo mariadb -e "GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'127.0.0.1'; FLUSH PRIVILEGES;"

python -c "from backend.core.db import init_db; init_db()"

if [ "$INSTALL_FRONTEND" = "1" ]; then
  cd frontend
  npm install
  npm run build
  cd "$PROJECT_DIR"
fi

echo "Setup complete."
echo "Activate venv: source .venv/bin/activate"
echo "Run app: python app.py"

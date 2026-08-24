# Fish Counter sa Raspberry Pi 5 (Step-by-step)

Guide ito para one-time setup at run ng project sa Raspberry Pi 5.

## 1) I-clone ang project

```bash
git clone <YOUR_REPO_URL> Fish-Counter
cd Fish-Counter
```

## 2) Install system packages

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip build-essential pkg-config libmariadb-dev mariadb-server nodejs npm
```

## 3) I-start ang MariaDB

```bash
sudo systemctl enable mariadb
sudo systemctl start mariadb
```

## 4) Gumawa ng DB at user

Palitan ang password sa command sa ibaba.

```bash
sudo mariadb -e "CREATE DATABASE IF NOT EXISTS inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
sudo mariadb -e "CREATE USER IF NOT EXISTS 'fishuser'@'localhost' IDENTIFIED BY 'fishpass';"
sudo mariadb -e "CREATE USER IF NOT EXISTS 'fishuser'@'127.0.0.1' IDENTIFIED BY 'fishpass';"
sudo mariadb -e "GRANT ALL PRIVILEGES ON inventory.* TO 'fishuser'@'localhost';"
sudo mariadb -e "GRANT ALL PRIVILEGES ON inventory.* TO 'fishuser'@'127.0.0.1'; FLUSH PRIVILEGES;"
```

## 5) Gumawa ng Python virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
```

## 6) Install Python dependencies

```bash
pip install -r requirements.txt
```

Kung nag-error sa `torch` / `ultralytics` sa ARM, pwede muna backend-only:

```bash
pip install Flask flask-socketio python-socketio python-engineio simple-websocket mariadb pymysql bcrypt python-dotenv requests pyyaml opencv-python
```

## 7) Gumawa ng `.env`

Sa root ng project, gumawa ng `.env` file:

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=inventory
DB_USER=fishuser
DB_PASSWORD=fishpass
APP_HOST=0.0.0.0
APP_PORT=5000
APP_DEBUG=false
```

## 8) Initialize schema

```bash
python -c "from backend.core.db import init_db; init_db()"
```

## 9) Install at build frontend (React)

```bash
cd frontend
npm install
npm run build
cd ..
```

## 10) Run app

```bash
source .venv/bin/activate
python app.py
```

Open sa browser:

```text
http://<hostname-ng-rpi>.local:5000
```

## 11) Isang command na setup (optional)

May automatic script na:

```bash
chmod +x scripts/setup_rpi5.sh
./scripts/setup_rpi5.sh
```

Pwede rin backend-only (skip AI + optional frontend):

```bash
INSTALL_AI=0 INSTALL_FRONTEND=0 ./scripts/setup_rpi5.sh
```

## 12) Auto-open Firefox sa startup (Inventory + 67% zoom)

Kung gusto mo na pag-login/open ng RPi desktop ay automatic bubukas ang Firefox sa inventory view:

```bash
chmod +x scripts/setup_rpi_firefox_inventory.sh
APP_URL="http://$(hostname).local:5000/?tab=dashboard" ZOOM_PERCENT=67 ./scripts/setup_rpi_firefox_inventory.sh
```

Pagkatapos, reboot o log out/log in.

Notes:
- Kailangan na running ang app service mo (`fish-counter.service`) para may lalabas agad sa browser.
- Kung ibang URL ang gusto mo, palitan lang `APP_URL`.
- Default ng script kapag walang `APP_URL`: `http://$(hostname).local:5000/?tab=dashboard`.
- Supported zoom steps ng Firefox: `30, 50, 67, 80, 90, 100, 110, 120, 133, 150, 170, 200, 240, 300`.

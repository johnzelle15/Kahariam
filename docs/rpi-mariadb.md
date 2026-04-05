# Raspberry Pi 5 — MariaDB setup

Quick steps to run this project with MariaDB on a Raspberry Pi 5.

1. Install MariaDB server on RPi

```bash
sudo apt update
sudo apt install mariadb-server
sudo mysql_secure_installation
```

2. Create database and user

```sql
-- run as root in mariadb client
CREATE DATABASE inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER 'fishuser'@'%' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON inventory.* TO 'fishuser'@'%';
FLUSH PRIVILEGES;
```

3. On your RPi app host, set environment variables (example in `.env` or systemd unit):

- `DB_HOST=127.0.0.1`
- `DB_USER=fishuser`
- `DB_PASSWORD=yourpassword`
- `DB_NAME=inventory`
- `DB_PORT=3306`

4. Install Python deps

```bash
python3 -m pip install -r requirements.txt
```

5. Initialize schema in MariaDB (from project root)

```bash
# ensure env vars set, then run Python
python -c "from backend.core.db import init_db; init_db()"
```

6. Run the app

```bash
# example
export DB_HOST=127.0.0.1
export DB_USER=fishuser
export DB_PASSWORD=yourpassword
export DB_NAME=inventory
python app.py
```

Notes
- The application now runs in MariaDB-only mode.

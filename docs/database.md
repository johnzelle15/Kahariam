MariaDB setup and usage notes for Fish-Counter (Raspberry Pi)

1) Install MariaDB (Raspbian / Raspberry Pi OS):

```bash
sudo apt update
sudo apt install mariadb-server
sudo mysql_secure_installation
```

2) Create database and user (example):

```sql
CREATE DATABASE fish_counter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'fc_user'@'localhost' IDENTIFIED BY 'strong_password_here';
GRANT ALL PRIVILEGES ON fish_counter.* TO 'fc_user'@'localhost';
FLUSH PRIVILEGES;
```

3) Import schema:

```bash
mariadb -u fc_user -p fish_counter < sql/schema.sql
```

4) Install Python dependencies for seeder or app (in virtualenv):

```bash
python3 -m venv venv
source venv/bin/activate
pip install mariadb bcrypt
```

5) Create a device token (run the seeder):

```bash
python scripts/seed_device.py --host localhost --user fc_user --password "your_pw" --database fish_counter --name pi-counter-01 --location "Tank A"
```

The script prints a `Device ID` and a plaintext `Device token`. Save the token securely — it is shown only once. Store only the hash on the server.

6) Device auth & ingestion suggestions
- Devices should send `Authorization: Bearer <token>` header or include `device_id` + `token` in a secure channel.
- Prefer HTTPS or MQTT over TLS. Validate token on server with bcrypt.checkpw.
- Server should use its own timestamp for readings and store device-provided timestamp only in `raw_payload` if needed.

7) Backups (cron example for daily backup):

```bash
0 2 * * * /usr/bin/mysqldump -u fc_user -p"your_pw" fish_counter | gzip > /home/pi/backups/fish_counter-$(date +\%F).sql.gz
```

8) Notes for low-memory Raspberry Pi
- Use small `innodb_buffer_pool_size` (e.g., 128M-256M) in `/etc/mysql/mariadb.conf.d/50-server.cnf`.
- If readings grow large, consider retention/partitioning by month or export raw payloads to object storage.

9) Migration note
- This repository is now MariaDB-only for runtime/deployment.


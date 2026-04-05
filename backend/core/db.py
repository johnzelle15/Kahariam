import os
from datetime import datetime
import bcrypt
from pathlib import Path

# MariaDB-only mode
DB_ENGINE = 'mariadb'


def _load_env_file():
    # Look for .env in project root (parent.parent.parent from this file)
    env_path = Path(__file__).resolve().parent.parent.parent / '.env'
    if not env_path.exists():
        # Fallback to backend/.env if exists
        env_path = Path(__file__).resolve().parent.parent / '.env'
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file()


def get_db():
    """Return a MariaDB DB-API connection wrapper.

    Uses `mariadb` connector when available, with `pymysql` fallback.
    """
    use_mariadb = False
    try:
        import mariadb
        use_mariadb = True
    except Exception:
        try:
            import pymysql
            from pymysql.cursors import DictCursor
        except Exception as e:
            raise RuntimeError('MariaDB driver required: pip install mariadb (or pymysql)') from e

    host = os.environ.get('DB_HOST', 'localhost')
    user = os.environ.get('DB_USER', 'fishuser')
    password = os.environ.get('DB_PASSWORD', '')
    dbname = os.environ.get('DB_NAME', 'inventory')
    port = int(os.environ.get('DB_PORT', 3306))

    if use_mariadb:
        conn = mariadb.connect(host=host, user=user, password=password, database=dbname, port=port)
    else:
        conn = pymysql.connect(host=host, user=user, password=password, database=dbname, port=port,
                               cursorclass=DictCursor, autocommit=False)

    return MariaDBConnectionWrapper(conn, use_mariadb)


class MariaDBCursorWrapper:
    def __init__(self, cur, is_mariadb):
        self._cur = cur
        self._is_mariadb = is_mariadb

    def execute(self, query, params=None):
        # Translate '?' placeholders (sqlite style) to '%s' for MariaDB/PyMySQL
        q = query.replace('?', '%s')
        if params is None:
            return self._cur.execute(q)
        if isinstance(params, (list, tuple)) and len(params) == 0:
            return self._cur.execute(q)
        return self._cur.execute(q, params)

    def executemany(self, query, seq_of_params):
        q = query.replace('?', '%s')
        return self._cur.executemany(q, seq_of_params)

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def __getattr__(self, name):
        return getattr(self._cur, name)


class MariaDBConnectionWrapper:
    def __init__(self, conn, is_mariadb):
        self._conn = conn
        self._is_mariadb = is_mariadb

    def cursor(self):
        # For mariadb connector, request dictionary cursors via `dictionary=True`.
        if self._is_mariadb:
            return MariaDBCursorWrapper(self._conn.cursor(dictionary=True), True)
        else:
            return MariaDBCursorWrapper(self._conn.cursor(), False)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        return self._conn.close()


def init_db():
    """Initialize MariaDB schema and seed bootstrap data."""
    conn = get_db()
    c = conn.cursor()

    def table_exists(name):
        q = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s"
        raw = conn._conn.cursor()
        raw.execute(q, (os.environ.get('DB_NAME', 'inventory'), name))
        r = raw.fetchone()
        raw.close()
        return bool(r)

    if not table_exists('counting_state'):
        c.execute('''
            CREATE TABLE counting_state (
                id INT PRIMARY KEY,
                active TINYINT DEFAULT 0,
                updated_at DATETIME
            )
        ''')
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        c.execute('INSERT INTO counting_state (id, active, updated_at) VALUES (%s, %s, %s)', (1, 0, now))
        conn.commit()

    if not table_exists('inventory'):
        c.execute('''
            CREATE TABLE inventory (
                id INT PRIMARY KEY AUTO_INCREMENT,
                count INT NOT NULL,
                variant VARCHAR(255) NOT NULL,
                date DATETIME NOT NULL,
                notes TEXT,
                action VARCHAR(32) DEFAULT 'IN',
                deleted TINYINT DEFAULT 0
            )
        ''')
        conn.commit()
    else:
        raw = conn._conn.cursor()
        raw.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s", (os.environ.get('DB_NAME', 'inventory'), 'inventory'))
        cols = [row['COLUMN_NAME'] if isinstance(row, dict) else row[0] for row in raw.fetchall()]
        raw.close()
        if 'variant' not in cols:
            c.execute("ALTER TABLE inventory ADD COLUMN variant VARCHAR(255) DEFAULT 'Unknown'")
        if 'action' not in cols:
            c.execute("ALTER TABLE inventory ADD COLUMN action VARCHAR(32) DEFAULT 'IN'")
        if 'deleted' not in cols:
            c.execute("ALTER TABLE inventory ADD COLUMN deleted TINYINT DEFAULT 0")
        conn.commit()

    if not table_exists('devices'):
        c.execute('''
            CREATE TABLE devices (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255),
                location VARCHAR(255),
                model VARCHAR(255),
                firmware VARCHAR(255),
                secret_hash TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen DATETIME,
                active TINYINT DEFAULT 1,
                locked_by VARCHAR(255),
                lock_time DATETIME
            )
        ''')
        conn.commit()

    if not table_exists('readings'):
        c.execute('''
            CREATE TABLE readings (
                id INT PRIMARY KEY AUTO_INCREMENT,
                device_id VARCHAR(255),
                count INT,
                timestamp DATETIME,
                firmware VARCHAR(255),
                raw_payload TEXT,
                rssi INT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

    dev_token = os.environ.get('DEV_DEVICE_TOKEN')
    raw = conn._conn.cursor()
    raw.execute('SELECT COUNT(*) as cnt FROM devices')
    row = raw.fetchone()
    devices_count = row['cnt'] if isinstance(row, dict) else row[0]
    raw.close()
    if dev_token and devices_count == 0:
        token_hash = bcrypt.hashpw(dev_token.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        c.execute('INSERT INTO devices (id, name, firmware, secret_hash) VALUES (%s, %s, %s, %s)',
                  ('test-device', 'dev-test', 'dev', token_hash))
        conn.commit()

    conn.close()

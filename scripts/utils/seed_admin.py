#!/usr/bin/env python3
"""
Seed the bootstrap admin user into MariaDB.
Usage:
  python scripts/utils/seed_admin.py --host HOST --user USER --password PASS --database DB --admin-password ADMIN_PASS [--username admin] [--email EMAIL]

Requires: mariadb (or mysql-connector-python), bcrypt
Install: pip install mariadb bcrypt
"""
import argparse
import bcrypt
use_mariadb = False
try:
    import mariadb
    use_mariadb = True
except Exception:
    try:
        import mysql.connector
    except Exception:
        print('Please install a MariaDB driver: pip install mariadb (or mysql-connector-python)')
        raise

parser = argparse.ArgumentParser()
parser.add_argument('--host', required=True)
parser.add_argument('--user', required=True)
parser.add_argument('--password', required=True, help='DB connection password')
parser.add_argument('--database', required=True)
parser.add_argument('--admin-password', required=True, help='login password to set for the admin account')
parser.add_argument('--username', default='admin')
parser.add_argument('--email', default=None)
args = parser.parse_args()

password_hash = bcrypt.hashpw(args.admin_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

try:
    if use_mariadb:
        conn = mariadb.connect(host=args.host, user=args.user, password=args.password, database=args.database)
    else:
        conn = mysql.connector.connect(host=args.host, user=args.user, password=args.password, database=args.database)
    cur = conn.cursor()
    cur.execute(
        "INSERT IGNORE INTO users (username, password_hash, email, role, active) VALUES (%s, %s, %s, 'admin', 1)",
        (args.username, password_hash, args.email)
    )
    conn.commit()
    if cur.rowcount:
        print(f"Admin user '{args.username}' created.")
    else:
        print(f"User '{args.username}' already exists — no change made.")
    cur.close()
    conn.close()
except Exception as e:
    print("Failed to seed admin user:", e)
    raise

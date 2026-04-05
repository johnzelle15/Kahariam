#!/usr/bin/env python3
"""
Seed a new device into MariaDB and print a plaintext token for the device.
Usage:
  python scripts/seed_device.py --host HOST --user USER --password PASS --database DB --name NAME [--location LOC] [--model MODEL] [--firmware FW]

Requires: mariadb (or mysql-connector-python), bcrypt
Install: pip install mariadb bcrypt
"""
import argparse
import secrets
import bcrypt
import uuid
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
parser.add_argument('--password', required=True)
parser.add_argument('--database', required=True)
parser.add_argument('--name', default='pi-counter-01')
parser.add_argument('--location', default='Tank A')
parser.add_argument('--model', default='RaspberryPi4')
parser.add_argument('--firmware', default='v0.1')
args = parser.parse_args()

# generate token and hash
token = secrets.token_urlsafe(32)
secret_hash = bcrypt.hashpw(token.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
device_id = str(uuid.uuid4())

# insert into DB
try:
    if use_mariadb:
        conn = mariadb.connect(
            host=args.host,
            user=args.user,
            password=args.password,
            database=args.database
        )
        cur = conn.cursor()
    else:
        conn = mysql.connector.connect(
            host=args.host,
            user=args.user,
            password=args.password,
            database=args.database
        )
        cur = conn.cursor()
    cur.execute(
        "INSERT INTO devices (id, name, location, model, firmware, secret_hash) VALUES (%s, %s, %s, %s, %s, %s)",
        (device_id, args.name, args.location, args.model, args.firmware, secret_hash)
    )
    conn.commit()
    cur.close()
    conn.close()
    print("Device created successfully")
    print("Device ID:", device_id)
    print("Device token (store this securely and provide to device):")
    print(token)
except Exception as e:
    print("Failed to insert device:", e)
    raise

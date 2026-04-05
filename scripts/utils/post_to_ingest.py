#!/usr/bin/env python3
"""
Small helper to POST a reading to /api/v1/ingest for local testing.
Usage:
  python scripts/post_to_ingest.py --token <TOKEN> --device-id <ID> --count 5
Requires: requests
Install: pip install requests
"""
import argparse
import requests

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5000/api/v1/ingest')
parser.add_argument('--token', required=True)
parser.add_argument('--device-id', default='test-device')
parser.add_argument('--count', type=int, default=1)
parser.add_argument('--firmware', default='dev')
args = parser.parse_args()

headers = {
    'Authorization': f'Bearer {args.token}',
    'Content-Type': 'application/json'
}

payload = {
    'device_id': args.device_id,
    'count': args.count,
    'firmware': args.firmware
}

r = requests.post(args.url, json=payload, headers=headers, timeout=5)
print(r.status_code)
print(r.text)

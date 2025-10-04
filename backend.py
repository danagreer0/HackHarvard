from flask import Flask, request, jsonify
from datetime import datetime, timedelta, timezone
from flask_cors import CORS
import random
import os
import smtplib
import ssl
import hmac
import hashlib

app = Flask(__name__)
CORS(app)
# Config via environment variables
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
EMAIL_FROM = os.getenv("EMAIL_FROM", SMTP_USER or "no-reply@example.com")
APP_NAME = os.getenv("APP_NAME", "HackHarvardApp")
OTP_SECRET = os.getenv("OTP_SECRET", "dev-change-me")
OTP_TTL_SECONDS = int(os.getenv("OTP_TTL_SECONDS", "600"))  # 10 minutes
MAX_ATTEMPTS = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
LOCK_MINUTES = int(os.getenv("OTP_LOCK_MINUTES", "10"))

# Demo users
USERS = {
    'alice': 'password123',
    'bob': 'securepass'
}

# Possible rules
MERCHANT_RULES = {
    'merchant_1': {
        'high_value_amount': 500,
        'new_device': True,
        'new_location': True,
        'suspicious_merchant': True
    }
}

# In-memory stores
transaction_log = []
# OTP store: userId -> record with secure hash and TTL
otp_store = {}


def generate_otp(digits=6):
    start = 10 ** (digits - 1)
    end = (10 ** digits) - 1
    return str(random.randint(start, end))


def hash_otp(code: str, email: str, user_id: str, purpose: str = "mfa") -> bytes:
    ctx = f"{(email or '').lower()}|{user_id}|{purpose}|{code}".encode("utf-8")
    return hmac.new(OTP_SECRET.encode("utf-8"), ctx, hashlib.sha256).digest()


def send_otp_email(user_email, otp):
    user_email = (user_email or "").strip()
    if not user_email:
        print("No email provided; cannot send OTP email.")
        return
    if not (SMTP_HOST and SMTP_USER and SMTP_PASS):
        print(f"[DEV] Would email OTP to {user_email}: {otp}")
        return
    msg = (
        f"Subject: Your {APP_NAME} verification code\r\n"
        f"From: {EMAIL_FROM}\r\n"
        f"To: {user_email}\r\n"
        f"Content-Type: text/plain; charset=utf-8\r\n"
        f"\r\n"
        f"Your {APP_NAME} verification code is {otp}. It expires in {OTP_TTL_SECONDS // 60} minutes.\r\n"
        f"If you did not request this, you can ignore this email.\r\n"
    )
    context = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls(context=context)
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(EMAIL_FROM, [user_email], msg)

# Rule checking
def check_rules(tx):
    rules = MERCHANT_RULES.get(tx['merchantId'], {})
    user_id = tx['userId']
    now = datetime.fromisoformat(tx['timestamp'])

    last_24h = [t for t in transaction_log
                if t['userId'] == user_id
                and t['merchantId'] == tx['merchantId']
                and datetime.fromisoformat(t['timestamp']) > now - timedelta(days=1)]

    count_24h = len(last_24h)
    sum_24h = sum(t['amount'] for t in last_24h)

    score = 0
    if tx['amount'] >= rules.get('high_value_amount', 500):
        score += 3
    if rules.get('new_device', False) and tx.get('deviceId'):
        score += 1
    if rules.get('new_location', False) and tx.get('country'):
        score += 1
    if rules.get('suspicious_merchant', False):
        score += 1

    transaction_log.append(tx)
    print(f"Transaction: {tx}, Score: {score}, MFA Required: {score >= 3}")
    return score >= 3

# Login endpoint
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if username in USERS and USERS[username] == password:
        return jsonify({'success': True, 'username': username})
    return jsonify({'success': False, 'error': 'Invalid username or password'})

# Check MFA endpoint
@app.route('/api/check_mfa', methods=['POST'])
def check_mfa():
    tx = request.get_json() or {}
    require_mfa = check_rules(tx)

    if require_mfa:
        user_id = tx.get('userId')
        email = (tx.get('email') or '').strip()
        code = generate_otp(6)
        digest = hash_otp(code, email, user_id)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=OTP_TTL_SECONDS)
        otp_store[user_id] = {
            'hash': digest,
            'expires_at': expires_at,
            'attempts': 0,
            'locked_until': None,
            'email': email,
        }
        try:
            send_otp_email(email, code)
        except Exception as e:
            print(f"Error sending OTP: {e}")

    return jsonify({
        'require_mfa': require_mfa,
        'methods': ['otp'] if require_mfa else []
    })

# Verify MFA endpoint
@app.route('/api/verify_mfa', methods=['POST'])
def verify_mfa():
    data = request.get_json() or {}
    user_id = data.get('userId') or ''
    code = (data.get('otp') or '').strip()
    record = otp_store.get(user_id)
    now = datetime.now(timezone.utc)

    if not record:
        return jsonify({'verified': False})
    if record.get('locked_until') and now < record['locked_until']:
        return jsonify({'verified': False})
    if now > record['expires_at']:
        del otp_store[user_id]
        return jsonify({'verified': False})

    email = record.get('email') or ''
    candidate = hash_otp(code, email, user_id)
    if len(candidate) != len(record['hash']) or not hmac.compare_digest(candidate, record['hash']):
        record['attempts'] += 1
        if record['attempts'] >= MAX_ATTEMPTS:
            record['locked_until'] = now + timedelta(minutes=LOCK_MINUTES)
        return jsonify({'verified': False})

    del otp_store[user_id]
    return jsonify({'verified': True})

if __name__ == '__main__':
    app.run(port=5050, debug=True)

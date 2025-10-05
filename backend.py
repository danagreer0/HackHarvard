from flask import Flask, request, jsonify
from datetime import datetime, timedelta, timezone
from flask_cors import CORS
import random
import os
import smtplib
import ssl
import hmac
import hashlib
import secrets
import base64
import json
import time
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.backends import default_backend

app = Flask(__name__)
CORS(
    app,
    supports_credentials=True,
    resources={
        r"/api/*": {
            "origins": ["http://127.0.0.1:8000", "http://localhost:8000"],
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "X-MFA-Merchant"],
        }
    },
)

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

# WebAuthn configuration
RP_ID = os.getenv("RP_ID", "localhost")
RP_NAME = os.getenv("RP_NAME", "HackHarvardApp")
ORIGIN = os.getenv("ORIGIN", "http://localhost:8000")

# Password hashing helpers (PBKDF2-HMAC-SHA256)
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    iterations = 200_000
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return f"pbkdf2_sha256${iterations}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"

def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iter_s, salt_b64, dk_b64 = encoded.split('$')
        iterations = int(iter_s)
        salt = base64.b64decode(salt_b64.encode())
        expected = base64.b64decode(dk_b64.encode())
        candidate = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
        return hmac.compare_digest(candidate, expected)
    except Exception:
        return False

# Demo users (hashed at startup; dev only)
USERS = {
    'alice': hash_password('password123'),
    'bob': hash_password('securepass')
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
# WebAuthn credentials store
webauthn_credentials = {}


def generate_otp(digits=6):
    n = secrets.randbelow(10**digits)  # 0 .. 10^digits - 1
    return str(n).zfill(digits)


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
def parse_ts(s: str):
    try:
        # Accept ISO8601 with trailing 'Z' (UTC) and without
        return datetime.fromisoformat((s or '').replace('Z', '+00:00'))
    except Exception:
        try:
            return datetime.fromisoformat(s)
        except Exception:
            return datetime.now(timezone.utc)


def check_rules(tx):
    rules = MERCHANT_RULES.get(tx['merchantId'], {})
    user_id = tx['userId']
    now = parse_ts(tx.get('timestamp'))

    last_24h = [t for t in transaction_log
                if t['userId'] == user_id
                and t['merchantId'] == tx['merchantId']
                and parse_ts(t['timestamp']) > now - timedelta(days=1)]

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

# WebAuthn endpoints
@app.route('/api/webauthn/register/start', methods=['POST'])
def webauthn_register_start():
    """Inicia el registro de WebAuthn"""
    data = request.get_json()
    user_id = data.get('userId')
    username = data.get('username')
    
    if not user_id or not username:
        return jsonify({'error': 'Missing user data'}), 400
    
    # Generar challenge
    challenge = secrets.token_bytes(32)
    
    # Crear opciones para el cliente
    options = {
        'rp': {
            'name': RP_NAME,
            'id': RP_ID
        },
        'user': {
            'id': user_id.encode('utf-8').hex(),
            'name': username,
            'displayName': username
        },
        'challenge': base64.b64encode(challenge).decode('utf-8'),
        'pubKeyCredParams': [
            {
                'type': 'public-key',
                'alg': -7  # ES256
            }
        ],
        'timeout': 60000,
        'authenticatorSelection': {
            'authenticatorAttachment': 'platform',  # Para Touch ID/Face ID
            'userVerification': 'required'
        }
    }
    
    # Guardar challenge temporalmente
    webauthn_credentials[f"challenge_{user_id}"] = {
        'challenge': challenge,
        'timestamp': time.time()
    }
    
    return jsonify(options)

@app.route('/api/webauthn/register/finish', methods=['POST'])
def webauthn_register_finish():
    """Completa el registro de WebAuthn"""
    data = request.get_json()
    user_id = data.get('userId')
    credential = data.get('credential')
    
    if not user_id or not credential:
        return jsonify({'error': 'Missing data'}), 400
    
    # En un sistema real, aquí verificarías la firma del authenticator
    # Para este ejemplo, aceptamos la credencial directamente
    
    if user_id not in webauthn_credentials:
        webauthn_credentials[user_id] = []
    
    webauthn_credentials[user_id].append({
        'id': credential.get('id'),
        'publicKey': credential.get('response', {}).get('publicKey'),
        'counter': 0
    })
    
    # Limpiar challenge
    webauthn_credentials.pop(f"challenge_{user_id}", None)
    
    return jsonify({'success': True})

@app.route('/api/webauthn/auth/start', methods=['POST'])
def webauthn_auth_start():
    """Inicia la autenticación WebAuthn"""
    data = request.get_json()
    user_id = data.get('userId')
    
    if not user_id:
        return jsonify({'error': 'Missing user ID'}), 400
    
    credentials = webauthn_credentials.get(user_id, [])
    if not credentials:
        return jsonify({'error': 'No credentials registered'}), 400
    
    # Generar challenge
    challenge = secrets.token_bytes(32)
    
    options = {
        'challenge': base64.b64encode(challenge).decode('utf-8'),
        'timeout': 60000,
        'rpId': RP_ID,
        'allowCredentials': [
            {
                'id': cred['id'],
                'type': 'public-key'
            } for cred in credentials
        ],
        'userVerification': 'required'
    }
    
    # Guardar challenge
    webauthn_credentials[f"auth_challenge_{user_id}"] = {
        'challenge': challenge,
        'timestamp': time.time()
    }
    
    return jsonify(options)

@app.route('/api/webauthn/auth/finish', methods=['POST'])
def webauthn_auth_finish():
    """Completa la autenticación WebAuthn"""
    data = request.get_json()
    user_id = data.get('userId')
    credential = data.get('credential')
    
    if not user_id or not credential:
        return jsonify({'error': 'Missing data'}), 400
    
    # En un sistema real, verificarías la firma aquí
    # Para este ejemplo, asumimos que la autenticación es exitosa
    
    # Limpiar challenge de autenticación
    webauthn_credentials.pop(f"auth_challenge_{user_id}", None)
    
    return jsonify({'verified': True})

# Login endpoint
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    stored = USERS.get(username)
    if stored and verify_password(password or '', stored):
        return jsonify({'success': True, 'username': username})
    return jsonify({'success': False, 'error': 'Invalid username or password'})

# Check MFA endpoint
@app.route('/api/check_mfa', methods=['POST'])
def check_mfa():
    tx = request.get_json() or {}
    require_mfa = check_rules(tx)

    methods = []
    has_webauthn = False

    if require_mfa:
        user_id = tx.get('userId')
        email = (tx.get('email') or '').strip()
        
        # Verificar si el usuario tiene credenciales WebAuthn registradas
        has_webauthn = user_id in webauthn_credentials and len(webauthn_credentials[user_id]) > 0
        
        methods = ['otp']
        if has_webauthn:
            methods.append('webauthn')
        
        # Preparar OTP (siempre disponible como fallback)
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
        'methods': methods if require_mfa else [],
        'has_webauthn': has_webauthn if require_mfa else False
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
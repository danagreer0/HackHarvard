from flask import Flask, request, jsonify
from datetime import datetime, timedelta
from flask_cors import CORS
import random

app = Flask(__name__)
CORS(app)

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
otp_store = {}

# Demo OTP sender
def send_otp_email(user_email, otp):
    print(f"DEBUG OTP for {user_email}: {otp}")

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
    tx = request.get_json()
    require_mfa = check_rules(tx)

    if require_mfa:
        otp = f"{random.randint(100000, 999999)}"
        otp_store[tx['userId']] = otp
        user_email = tx.get('email', 'demo@example.com')
        send_otp_email(user_email, otp)

    return jsonify({
        'require_mfa': require_mfa,
        'methods': ['otp', 'webauthn'] if require_mfa else []
    })

# Verify MFA endpoint
@app.route('/api/verify_mfa', methods=['POST'])
def verify_mfa():
    data = request.get_json()
    user_id = data.get('userId')
    otp_input = data.get('otp')

    correct_otp = otp_store.get(user_id)
    if correct_otp and otp_input == correct_otp:
        del otp_store[user_id]
        return jsonify({'verified': True})
    return jsonify({'verified': False})

if __name__ == '__main__':
    app.run(port=5000, debug=True)

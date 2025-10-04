from flask import Flask, request, jsonify
from datetime import datetime, timedelta
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # This allows your frontend (localhost) to talk to Flask

# Possible rules
MERCHANT_RULES = {
    'merchant_1': {
        'max_tx_per_day': 10,
        'max_amount_per_day': 1000,
        'high_value_amount': 500,
        'max_tx_per_hour': 5,
        'max_amount_per_tx': 800,
        'max_amount_per_week': 5000,
        'new_device': True,
        'new_location': True,
        'suspicious_merchant': True,
        'tx_frequency_limit': 2,
        'tx_amount_pattern': True,
    }
}

# In-memory transaction log
transaction_log = []

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
    if count_24h >= rules.get('max_tx_per_day', 10):
        score += 2
    if sum_24h + tx['amount'] > rules.get('max_amount_per_day', 3000):
        score += 2
    if rules.get('new_device', False) and tx.get('deviceId', None):
        score += 1
    if rules.get('new_location', False) and tx.get('country', None):
        score += 1
    if rules.get('suspicious_merchant', False):
        score += 1

    transaction_log.append(tx)

    # Debug info
    print(f"Transaction amount: {tx['amount']}, Score: {score}, Require MFA: {score >= 3}")

    return score >= 3

@app.route('/api/check_mfa', methods=['POST'])
def check_mfa():
    tx = request.get_json()
    require_mfa = check_rules(tx)
    return jsonify({
        'require_mfa': require_mfa,
        'methods': ['otp', 'webauthn'] if require_mfa else []
    })

@app.route('/api/verify_mfa', methods=['POST'])
def verify_mfa():
    data = request.get_json()
    return jsonify({'verified': True})

if __name__ == '__main__':
    app.run(port=5000, debug=True)

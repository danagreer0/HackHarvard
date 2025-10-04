let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    const payBtn = document.getElementById('payBtn');

    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    if (payBtn) payBtn.addEventListener('click', handlePayment);
});

function handleLogin() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    fetch('http://127.0.0.1:5000/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentUser = data.username;
            alert(`Welcome, ${data.username}!`);
            document.querySelector('.login-container').style.display = 'none';
            document.querySelector('.checkout-container').style.display = 'block';
        } else {
            alert(data.error || 'Login failed.');
        }
    })
    .catch(console.error);
}

function handlePayment() {
    if (!currentUser) {
        alert('Please login first!');
        return;
    }

    const amount = parseFloat(document.getElementById('amountInput').value);
    const recipient = document.getElementById('recipient').value.trim();
    const account = document.getElementById('account').value.trim();
    const concept = document.getElementById('concept').value.trim();
    
    if (!amount || !recipient || !account || !concept) {
        alert('Please fill in all fields!');
        return;
    }

    const transaction = {
        userId: currentUser,
        merchantId: 'merchant_1',
        amount: amount,
        recipient: recipient,
        account: account,
        concept: concept,
        deviceId: navigator.userAgent,
        timestamp: new Date().toISOString(),
        email: `${currentUser}@demo.com`
    };

    fetch('http://127.0.0.1:5000/api/check_mfa', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(transaction)
    })
    .then(res => res.json())
    .then(data => {
        if(data.require_mfa) {
            showMfaPopup(transaction.userId, data.methods);
        } else {
            alert('Payment verified without MFA!');
            document.getElementById('amountInput').value = '';
            document.getElementById('recipient').value = '';
            document.getElementById('account').value = '';
            document.getElementById('concept').value = '';
        }
    })
    .catch(console.error);
}

function showMfaPopup(userId, methods) {
    const overlay = document.createElement('div');
    overlay.id = 'mfaOverlay';
    overlay.innerHTML = `
        <div class="mfa-popup">
            <h2>MFA Required</h2>
            <p>Methods available: <strong>${methods.join(', ')}</strong></p>
            <input type="text" id="otpInput" placeholder="Enter OTP" />
            <br><br>
            <button id="verifyMfaBtn">Verify</button>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('verifyMfaBtn').addEventListener('click', () => {
        const otp = document.getElementById('otpInput').value;

        fetch('http://127.0.0.1:5000/api/verify_mfa', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({otp, userId})
        })
        .then(res => res.json())
        .then(res => {
            if(res.verified) {
                alert('Payment verified!');
                document.body.removeChild(overlay);
            } else {
                alert('Verification failed! Try again.');
            }
        })
        .catch(console.error);
    });
}

// front.js
document.getElementById('payBtn').addEventListener('click', () => {
    const transaction = {
        userId: 'user123',
        merchantId: 'merchant_1',
        amount: parseFloat(document.querySelector('#amount').innerText),
        deviceId: navigator.userAgent,
        timestamp: new Date().toISOString(),
        email: 'demo@example.com' // just for demo
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
        }
    })
    .catch(err => console.error(err));
});

function showMfaPopup(userId, methods) {
    const overlay = document.createElement('div');
    overlay.id = 'mfaOverlay';

    const popup = document.createElement('div');
    popup.className = 'mfa-popup';
    popup.innerHTML = `
        <h2>MFA Required</h2>
        <p>Methods available: <strong>${methods.join(', ')}</strong></p>
        <input type="text" id="otpInput" placeholder="Enter OTP" />
        <br><br>
        <button id="verifyMfaBtn">Verify</button>
    `;

    overlay.appendChild(popup);
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
        .catch(err => console.error(err));
    });
}

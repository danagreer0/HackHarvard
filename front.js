document.addEventListener('DOMContentLoaded', function() {
    const payBtn = document.getElementById('payBtn');

    payBtn.addEventListener('click', () => {
        const transaction = {
            userId: 'user123',
            merchantId: 'merchant_1',
            amount: parseFloat(document.querySelector('#amount').innerText),
            deviceId: navigator.userAgent,
            timestamp: new Date().toISOString()
        };

        fetch('http://127.0.0.1:5000/api/verify_mfa', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(transaction)
        })
        .then(res => res.json())
        .then(data => {
            if(data.require_mfa) showMfaPopup(data.methods);
            else alert('Payment verified without MFA!');
        })
        .catch(err => console.error(err));
    });

    function showMfaPopup(methods) {
        const overlay = document.createElement('div');
        overlay.id = 'mfaOverlay';
        overlay.style.position = 'fixed';
        overlay.style.top = 0;
        overlay.style.left = 0;
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
        overlay.style.zIndex = 9999;
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        const popup = document.createElement('div');
        popup.style.backgroundColor = '#fff';
        popup.style.padding = '30px';
        popup.style.borderRadius = '10px';
        popup.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
        popup.style.textAlign = 'center';
        popup.style.minWidth = '300px';

        popup.innerHTML = `
            <h2>MFA Required</h2>
            <p>Methods available: <strong>${methods.join(', ')}</strong></p>
            <input type="text" id="otpInput" placeholder="Enter OTP" style="width: 80%; padding: 8px; margin-top: 10px;" />
            <br><br>
            <button id="verifyMfaBtn" style="padding: 10px 20px; cursor: pointer;">Verify</button>
        `;

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        document.getElementById('verifyMfaBtn').addEventListener('click', () => {
            const otp = document.getElementById('otpInput').value;

            fetch('http://127.0.0.1:5000/api/verify_mfa', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({otp})
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
});

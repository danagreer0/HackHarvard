//Javascript for MFA and snippet
// Include on checkout pages. Initialize with ChechoutMFA.init({apiBaseUrl, merchantId, formSelector, hiddenFeildName, enforceMode, headers, resendCooldownMs, challengeTTLSeconds})

(function() {
    const DEFAULTS = {
        apiBaseUrl: '',                     // Where your MFA server lives
        merchantId: '',                     // Your merchant ID
        formSelector: null,                 // How to find the checkout form
        hiddenFeildName: 'mfa_token',       // Name of the hidden field to add to the form after successful MFA
        enforceMode: 'token-required',      // If 'client' = just show the screen, If 'token-required' = add a token the server can check
        getUserId: () => document.querySelector('input[name="email"], input[type="email"]')?.value || 'guest',
        getTransactionContext: () => {
            const amount = Number(document.querySelector('[name="amount"]')?.value || '0');
            const currency = (document.querySelector('[name="currency"]')?.value || 'USD').toUpperCase();
            const merchantID = window.CHECKOUT_CONFIG?.merchantId || '';
            const email= document.querySelector('input[name="email"], input[type="email"]')?.value || '';
            return { amount, currency, merchantID, email};
        },
        headers: {},                    // Any extra headers you want to add to the API requests
        resendCooldownMs: 30000,        // How long before the user can request a new code in ms
        challengeTTLSeconds: 300,       // How long the code is valid for in seconds
    };
     const state = {
        config: {...DEFAULTS},
        isOpen: false,
        modal: null,
        current: {challengeId: null },
        verifiedToken: null,
        sumbitINProgress: false,
        cleanup: []
    };
    function html(str) { const t = document.createElement('template'); t.innerHTML = str.trim(); return t.content.firstChild; }
    function styles(){
        if(document.getElementById('mfa-styles-v2')) return;
        const s = document.createElement('style');
        s.id = 'mfa-styles-v2';
        s.textContent = `
            .mfax-overlay {position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 2147483000;}
            .mfax-modeal {width: 100%; max-width: 420px; background: #ffff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); padding: 20px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif; color:#111; position: relative;}
            .mfax-h{font-size: 18px; font-weight: 600; margin 0 0 8px}
            .mfax-subh{font-size: 14px; margin: 0 0 12px; color: #555;}
            mfax-btn{flex:1;padding:10px 12px;border:none;border-radius:8px;cursor:pointer;font-weight:600}
            .mfax-btn-primary{background:#111;color:#fff}
            .mfax-btn-secondary{background:#f1f1f1;color:#111}
            .mfax-link{background:none;border:none;color:#0a66c2;text-decoration:underline;cursor:pointer;font-size:13px;padding:0}
            .mfax-input{width:100%;font-size:20px;letter-spacing:10px;text-align:center;padding:10px;border:1px solid #ccc;border-radius:8px;outline:none}
            .mfax-error{color:#b00020;font-size:13px;margin-top:10px;min-height:16px}
            .mfax-meta{color:#666;font-size:12px;margin-top:10px}
            .mfax-close{position:absolute;right:12px;top:12px;background:transparent;border:none;font-size:18px;cursor:pointer}
            .mfax-choice{display:flex;gap:8px}
            .mfax-choice .mfax-btn{flex:initial}
            .mfax-hidden{display:none}
    `;
    document.head.appendChild(s);
    }
        function mergeConfig(cfg) {
        state.config = {...DEFAULTS, ...cfg};
        if(!state.config.apiBaseUrl) throw new Error('MFA System: apiBaseUrl is required');
        if(!state.config.merchantId) throw new Error('MFA System: merchantId is required');
        if(!state.config.formSelector) throw new Error('MFA System: formSelector is required');
    }
    function getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-MFA-Merchant': state.config.merchantId,
            ...state.config.headers
        };
    }

    function buildUrl(path) {
        const base = (state.config.apiBaseUrl || '').replace(/\/+$/,'');
        const p = ('${path}' || '').startsWith('/') ? path : `/${path}`;
        return '${base}${p}';
    }
    async function apiPost(path, body) {
        const res = await fetch(buildUrl(path), {
            method: 'POST',
            headers: getHeaders(),
            credentials: 'include',
            cache: 'no-store',
            body: JSON.stringify(body || {})
        });
        if (!res.ok) {
            throw new Error('POST ${path} failed with ${res.status}');
            return res.json();
        }
    }
    function dispatchMFARequired(detail) {
        try {
            document.dispatchEvent(new CustomEvent('checkout-mfa:required', { detail }));
        } catch (_) {
            if (typeof state.config.onMFARequired === 'function') {
                try { state.config.onMFARequired(detail); } catch (_) {}
            }
        }
    }
    function removeExistingOverlay() {
    const existing = document.getElementById('mfaOverlay');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function showMfaPopup(methods) {
        removeExistingOverlay();

        //Overlay
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
        popup.style.maxWidth = '90%';
        
        const title = document.createElement('h2');
        title.textContent = 'MFA Required';

        const msg = document.createElement('p');
        msg.textContent = 'To protect your account, we need to verify this payment before proceeding.';

        const methodsP = document.createElement('p');
        if (Array.isArray(methods) && methods.length > 0) {
            methodsP.innerHTML = 'Methods available: <strong>' + methods.join(', ') + '</strong>';
        } else {
            methodsP.textContent = 'We will guide you through verification on the next step.';
        };
        
        popup.appendChild(title);
        popup.appendChild(msg);
        popup.appendChild(methodsP);

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // Click outside to close
        overlay.addEventListener('click', (e) => {
             if (e.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });

        return () => {
         if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };
    }
    
})();

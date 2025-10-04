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
        if(!state.config.formSelector) {
            console.warn('MFA System: formSelector not provided — SDK will not intercept the form automatically.');
        }
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
        const p = (path || '').startsWith('/') ? path : `/${path}`;
        return `${base}${p}`;
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
            throw new Error(`POST ${path} failed with ${res.status}`);
        }
        return res.json();
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

    function showSuccessPopup(message='Transaction complete') {
        removeExistingOverlay();
        const overlay = document.createElement('div');
        overlay.id = 'mfaOverlay';
        overlay.innerHTML = `
            <div class="mfa-popup">
                <h2>${message}</h2>
                <button id="successOkBtn">OK</button>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });
        document.getElementById('successOkBtn').addEventListener('click', () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });
        return () => { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    }

    function showMfaPopup(methods) {
        removeExistingOverlay();

        const overlay = document.createElement('div');
        overlay.id = 'mfaOverlay';
        overlay.innerHTML = `
            <div class="mfa-popup">
                <h2>MFA Required</h2>
                <p>Methods available: <strong>${Array.isArray(methods) && methods.length ? methods.join(', ') : 'otp'}</strong></p>
                <input type="text" id="otpInput" placeholder="Enter OTP" />
                <br><br>
                <button id="verifyMfaBtn">Verify</button>
            </div>
        `;
        document.body.appendChild(overlay);

        // Click outside to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });

        // Esc to close
        const onKey = (e) => {
            if (e.key === 'Escape') {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                document.removeEventListener('keydown', onKey);
            }
        };
        document.addEventListener('keydown', onKey);

        document.getElementById('verifyMfaBtn').addEventListener('click', async () => {
            const otp = (document.getElementById('otpInput').value || '').trim();
            if (!otp) { alert('Please enter the code.'); return; }

            try {
                const userId = (typeof state.config.getUserId === 'function' ? state.config.getUserId() : 'guest') || 'guest';
                const res = await apiPost('/api/verify_mfa', { userId, otp });
                if (res.verified) {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    document.removeEventListener('keydown', onKey);
                    showSuccessPopup('Transaction complete');
                } else {
                    alert('Verification failed! Try again.');
                }
            } catch (err) {
                console.warn(err);
                alert('Verification failed. Please try again.');
            }
        });

        return () => {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            document.removeEventListener('keydown', onKey);
        };
    }
    async function evaluate(context){
        const tx = context || (typeof state.config.getTransactionContext === 'function' ? state.config.getTransactionContext() : {});
        if(!tx || typeof tx !== 'object') throw new Error('MFA System: getTransactionContext must return an object');
        if(typeof tx.amount !== 'number' || isNaN(tx.amount) || tx.amount < 0) throw new Error('MFA System: Transaction amount is required and must be a positive number');
        if(typeof tx.currency !== 'string' || !tx.currency.match(/^[A-Z]{3}$/)) throw new Error('MFA System: Transaction currency is required and must be a 3 letter ISO code');
        if(typeof tx.merchantID !== 'string' || !tx.merchantID) throw new Error('MFA System: Transaction merchantID is required and must be a string');
        if(typeof tx.email !== 'string') throw new Error('MFA System: Transaction email must be a string');
     
        const payload = {
            merchantId: state.config.merchantId || tx.merchantID || '',
            userId: (typeof state.config.getUserId === 'function' ? state.config.getUserId() : 'guest') || 'guest',
            amount: tx.amount || 0,
            currency: (tx.currency || 'USD').toUpperCase(),
            timestamp: tx.timestamp || new Date().toISOString(),
            ...(tx.deviceId ? { deviceId: tx.deviceId } : {}),
            ...(tx.country ? { country: tx.country } : {}),
            email: tx.email || ''
        }

        const decision = await apiPost('/api/check_mfa', payload);
        state.current.decision = decision;

        if (decision?.require_mfa) {
            state.current.flagged = true;
            showMfaPopup(decision.methods || [], decision);
            dispatchMFARequired({ decision, context: payload });
            return { mfaRequired: true, decision };
        }
        return { mfaRequired: false, decision };
    }
        function getForm() {
        if (state.config.formSelector) {
            const el = document.querySelector(state.config.formSelector);
            if (!el) throw new Error('MFA System: formSelector did not match any elements');
            if (el.tagName !== 'FORM') throw new Error('MFA System: formSelector must point to a FORM element');
            return el;
        }
        return null;
    }
    function wireFormInterception(form) {
        if (!form || form._mfaWired) return;

        const handler = async (e) => {
            if (state.current.flagged) {
                e.preventDefault();
                if (!document.getElementById('mfaOverlay') && state.current.decision?.require_mfa) {
                    showMfaPopup(state.current.decision.methods || [], state.current.decision);
                }
                return;
            }
            try {
                const result = await evaluate();
                if (result.mfaRequired) {
                    e.preventDefault();
                    return;
                }
            } catch (err) {
                console.warn('[CheckoutMFA] Decision failed:', err);
            }

        };
        form.addEventListener('submit', handler, true);
        form._mfaWired = true;
        state.cleanup.push(() => form.removeEventListener('submit', handler, true));
    }
    async function init(userConfig= {}) {
        mergeConfig(userConfig);
        styles();
        const form = getForm();
        if (form){
             wireFormInterception(form);
        } else {
            console.warn('[CheckoutMFA] No form found to intercept.');
        }
    }

    // Public API
    window.CheckoutMFA = {
        init,
        evaluate,
        onMFARequired(cb){
            state.config.onMFARequired = cb;
        },
        showMfaPopup,
        get config() { return state.config; },
        get flagged() { return !!state.current.flagged; },
        get lastDecision() { return state.current.decision || null; },
        version: '1.1.0-snippet'
    };
    (function autoInit(){
        try {
            const s = document.currentScript
                 || document.querySelector('script[src*="mfaSystem.js"],script[src*="front.js"]');
            const ds = s?.dataset || {};
            const cfg = {
                apiBaseUrl: ds.apiBaseUrl || '',
                merchantId: ds.merchantId || '',
                formSelector: ds.formSelector || '',
                hiddenFeildName: ds.hiddenFeildName || 'mfa_token',
                enforceMode: ds.enforce
            };
            if(cfg.apiBaseUrl && cfg.merchantId) {
                window.CheckoutMFA.init(cfg);   
            }
        } catch (e) {
            console.warn('[CheckoutMFA] Auto init failed:', e);
       }
    })();    
})();

// --- Begin merged app.js (previously in app.js) ---
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#checkout-form');
  if (!form) return;

  let output = document.getElementById('result');
  if (!output) {
    output = document.createElement('pre');
    output.id = 'result';
    // Hide the legacy green result box; keep node for compatibility
    output.style.display = 'none';
    document.body.appendChild(output);
  }

  // Discover API base and merchantId from the mfaSystem.js tag, with sensible defaults
  const mfaScript = document.querySelector('script[src*="mfaSystem.js"]');
  const API_BASE = (mfaScript?.dataset?.apiBaseUrl || 'http://127.0.0.1:5000').replace(/\/+$/, '');
  const MERCHANT_ID = mfaScript?.dataset?.merchantId || 'merchant_1';

  const defaultHeaders = {
    'Content-Type': 'application/json',
    'X-MFA-Merchant': MERCHANT_ID,
  };

  function setOutput(message, details) {
    if (details) {
      try {
        output.textContent = message + '\n\n' + JSON.stringify(details, null, 2);
      } catch (_) {
        output.textContent = message;
      }
    } else {
      output.textContent = message;
    }
  }

  form.addEventListener('submit', async (e) => {
    // Keep the page in-place (SPA style)
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());
    const context = {
      merchantID: MERCHANT_ID,
      amount: Number(data.amount),
      currency: (data.currency || 'USD').toUpperCase(),
      email: data.email || '',
      timestamp: new Date().toISOString(),
    };

    // Prefer the CheckoutMFA flow, which will show an overlay if needed
    if (window.CheckoutMFA && typeof window.CheckoutMFA.evaluate === 'function') {
      try {
        const evalRes = await window.CheckoutMFA.evaluate(context);
        if (evalRes && evalRes.mfaRequired) {
          setOutput('MFA required — complete verification in the overlay.', evalRes.decision || evalRes);
          return; // overlay is shown by mfaSystem.js
        } else {
          // Show success popup instead of green result box
          if (window.CheckoutMFA && typeof window.CheckoutMFA.showMfaPopup === 'function') {
            // no-op; success path
          }
          showSuccessPopup('Transaction complete');
          return;
        }
      } catch (err) {
        console.warn('CheckoutMFA.evaluate failed; falling back to direct API call.', err);
        // fall through
      }
    }

    // Fallback: call backend directly
    try {
      const res = await fetch(`${API_BASE}/api/check_mfa`, {
        method: 'POST',
        headers: defaultHeaders,
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          merchantId: MERCHANT_ID,
          userId: data.email || 'guest',
          amount: Number(data.amount),
          currency: (data.currency || 'USD').toUpperCase(),
          timestamp: new Date().toISOString(),
        }),
      });

      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch (_) {}

      if (!res.ok) {
        setOutput(`API error ${res.status}`, json || text);
        return;
      }

      if (json && json.require_mfa) {
        if (window.CheckoutMFA && typeof window.CheckoutMFA.showMfaPopup === 'function') {
          window.CheckoutMFA.showMfaPopup(json.methods || []);
        }
        setOutput('MFA required — check the overlay to verify.', json);
      } else {
        // Show success popup instead of green result box
        showSuccessPopup('Transaction complete');
      }
    } catch (err) {
      if (/Failed to fetch|CORS/i.test(err.message)) {
        setOutput('Request failed (possible CORS issue). Ensure your backend at 127.0.0.1:5000 allows Access-Control-Allow-Origin: http://127.0.0.1:8000', { error: err.message });
      } else {
        setOutput('Request error', { error: err.message });
      }
    }
  });
});
// --- End merged app.js ---

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

})();

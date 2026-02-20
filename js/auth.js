/**
 * Authentication module for NeuronGuessr online mode.
 *
 * Players paste their neuPrint API token to authenticate.
 * Tokens are stored in localStorage so they persist across sessions.
 */

let _token = null;
let _userEmail = null;
let _authChangeCallbacks = [];

/**
 * Initialize auth state from saved session.
 */
export function initAuth() {
    const saved = localStorage.getItem('neuprint_token');
    if (saved) {
        _token = saved;
        _userEmail = localStorage.getItem('neuprint_email') || 'authenticated';
        _notifyChange();
    }
}

/**
 * Get the current auth token, or null if not authenticated.
 */
export function getToken() {
    return _token;
}

/**
 * Check if user is signed in.
 */
export function isSignedIn() {
    return _token !== null;
}

/**
 * Get the signed-in user's email (if available).
 */
export function getUserEmail() {
    return _userEmail;
}

/**
 * Register a callback for auth state changes.
 * @param {function} cb - Called with (token) on sign-in/sign-out
 */
export function onAuthChange(cb) {
    _authChangeCallbacks.push(cb);
}

function _notifyChange() {
    for (const cb of _authChangeCallbacks) {
        try { cb(_token); } catch (e) { console.error('Auth callback error:', e); }
    }
}

/**
 * Set a manually-pasted neuPrint API token.
 * @param {string} token - Token from neuprint.janelia.org account page
 */
export function setManualToken(token) {
    if (!token || !token.trim()) return;
    // Strip non-ASCII characters (BOM, smart quotes, etc. from copy-paste)
    _token = token.trim().replace(/[^\x20-\x7E]/g, '');
    _userEmail = 'token user';
    localStorage.setItem('neuprint_token', _token);
    localStorage.setItem('neuprint_email', _userEmail);
    _notifyChange();
}

/**
 * Sign out and clear stored credentials.
 */
export function signOut() {
    _token = null;
    _userEmail = null;
    localStorage.removeItem('neuprint_token');
    localStorage.removeItem('neuprint_email');

    _notifyChange();
}

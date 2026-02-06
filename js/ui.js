/**
 * UI helper utilities for NeuronGuessr.
 */

/**
 * Animate a number counting up from 0 to target.
 * @param {HTMLElement} element
 * @param {number} target
 * @param {number} duration - ms
 */
export function animateScore(element, target, duration = 800) {
    const start = performance.now();

    function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = Math.round(target * eased).toLocaleString();
        if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

/**
 * Show a screen by ID, hiding all others.
 * @param {string} screenId
 */
export function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
    });
    const el = document.getElementById(screenId);
    if (el) el.classList.add('active');
}

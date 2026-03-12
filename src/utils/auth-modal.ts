export function showAuthRequiredModal() {
    const overlay = document.createElement('div');
    overlay.className = 'auth-modal-overlay';
    overlay.innerHTML = `
        <div class="auth-modal-card">
            <div class="auth-modal-icon">
                🔒
            </div>
            <h2 class="auth-modal-title">Sign In Required</h2>
            <p class="auth-modal-text">Please sign in to access this feature and start your learning journey.</p>
            <button class="auth-modal-button" id="authModalBtn">Go to Sign In</button>
        </div>
    `;

    document.body.appendChild(overlay);

    const button = overlay.querySelector('#authModalBtn');
    button?.addEventListener('click', () => {
        overlay.remove();
        window.location.href = '/';
    });

    // Click overlay to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            window.location.href = '/';
        }
    });
}

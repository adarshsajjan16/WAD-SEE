/**
 * Core Hospital Management System Frontend Utility Engine
 */

// Toast Notifications Container Setup
let toastContainer = null;
function initToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
}

function showToast(message, type = 'info') {
    initToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'danger') icon = '⚠️';
    if (type === 'warning') icon = '🔔';

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-msg">${escapeHtml(message)}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// API Helper with standard JSON response processing
async function apiCall(url, options = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    options.headers = { ...defaultHeaders, ...options.headers };

    try {
        const response = await fetch(url, options);
        
        // Handle CSV downloads cleanly
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/csv')) {
            if (!response.ok) {
                throw new Error('CSV Download failed due to authorization or server error.');
            }
            const blob = await response.blob();
            const filename = response.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'export.csv';
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);
            return { success: true, message: 'CSV Download completed' };
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Server request failed.');
        }

        return data;
    } catch (err) {
        console.error(`API Error [${url}]:`, err);
        throw err;
    }
}

// Global Auth Session Check
async function getCurrentUser() {
    try {
        const data = await apiCall('/api/auth/me');
        return data.user;
    } catch (err) {
        return null;
    }
}

// Logout handler
async function logoutUser() {
    try {
        await apiCall('/api/auth/logout', { method: 'POST' });
        showToast('Logged out successfully.', 'info');
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 500);
    } catch (err) {
        showToast(err.message || 'Logout failed.', 'danger');
    }
}

// HTML Escaper for XSS Defense in frontend rendering
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Date and Time Formatting Helpers
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const options = { year: 'numeric', month: 'short', day: 'numeric' };
        return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, options);
    } catch (e) {
        return dateStr;
    }
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    try {
        const [h, m] = timeStr.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    } catch (e) {
        return timeStr;
    }
}

// Modal Toggle Helpers
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-action="logout"]').forEach(button => {
        button.addEventListener('click', logoutUser);
    });

    // Setup modal overlay backdrop close listeners
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });
});

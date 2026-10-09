/**
 * Authentication & Registration Frontend Controller - HealthCare+
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. LOGIN FORM HANDLER
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        const currentUser = await getCurrentUser();
        if (currentUser) {
            if (currentUser.role === 'admin') {
                window.location.href = '/admin-dashboard.html';
            } else {
                window.location.href = '/patient-dashboard.html';
            }
            return;
        }

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const submitBtn = loginForm.querySelector('button[type="submit"]');

            if (!email || !password) {
                showToast('Please enter both email and password.', 'warning');
                return;
            }

            try {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '⚡ Verifying...';

                const response = await apiCall('/api/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ email, password })
                });

                showToast(response.message || 'Login successful!', 'success');

                setTimeout(() => {
                    if (response.user.role === 'admin') {
                        window.location.href = '/admin-dashboard.html';
                    } else {
                        window.location.href = '/patient-dashboard.html';
                    }
                }, 300);

            } catch (err) {
                showToast(err.message || 'Login failed.', 'danger');
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Sign In to Portal';
            }
        });
    }

    // 2. REGISTRATION FORM HANDLER WITH STRICT INPUT LOGIC
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        const nameInput = document.getElementById('full_name');
        const phoneInput = document.getElementById('phone');
        const passInput = document.getElementById('password');
        const confirmPassInput = document.getElementById('confirmPassword');

        const nameHint = document.getElementById('nameHint');
        const phoneHint = document.getElementById('phoneHint');
        const passMatchHint = document.getElementById('passMatchHint');

        // Live input validation listeners
        if (nameInput && nameHint) {
            nameInput.addEventListener('input', () => {
                const val = nameInput.value.trim();
                if (!val) {
                    nameHint.textContent = 'Only alphabets and spaces allowed';
                    nameHint.className = 'input-hint';
                } else if (!/^[A-Za-z\s]+$/.test(val)) {
                    nameHint.textContent = '❌ Name must contain ONLY letters (no numbers or symbols)';
                    nameHint.className = 'input-hint error';
                } else {
                    nameHint.textContent = '✓ Valid name format';
                    nameHint.className = 'input-hint valid';
                }
            });
        }

        if (phoneInput && phoneHint) {
            phoneInput.addEventListener('input', () => {
                const val = phoneInput.value.trim();
                if (!val) {
                    phoneHint.textContent = 'Must be exactly 10 digits';
                    phoneHint.className = 'input-hint';
                } else if (!/^\d{10}$/.test(val)) {
                    phoneHint.textContent = `❌ Requires exactly 10 digits (currently ${val.length})`;
                    phoneHint.className = 'input-hint error';
                } else {
                    phoneHint.textContent = '✓ Valid 10-digit mobile number';
                    phoneHint.className = 'input-hint valid';
                }
            });
        }

        if (passInput && confirmPassInput && passMatchHint) {
            const checkPassMatch = () => {
                const p1 = passInput.value;
                const p2 = confirmPassInput.value;
                if (!p2) {
                    passMatchHint.textContent = '';
                } else if (p1 !== p2) {
                    passMatchHint.textContent = '❌ Passwords do not match';
                    passMatchHint.className = 'input-hint error';
                } else {
                    passMatchHint.textContent = '✓ Passwords match';
                    passMatchHint.className = 'input-hint valid';
                }
            };
            passInput.addEventListener('input', checkPassMatch);
            confirmPassInput.addEventListener('input', checkPassMatch);
        }

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const full_name = nameInput.value.trim();
            const email = document.getElementById('email').value.trim();
            const phone = phoneInput.value.trim();
            const password = passInput.value;
            const confirmPassword = confirmPassInput.value;
            const date_of_birth = document.getElementById('date_of_birth').value;
            const gender = document.getElementById('gender').value;
            const address = document.getElementById('address').value.trim();
            const emergency_contact = document.getElementById('emergency_contact').value.trim();

            const submitBtn = registerForm.querySelector('button[type="submit"]');

            // 1. Alphabetic Name Logic Check
            if (!/^[A-Za-z\s]+$/.test(full_name)) {
                showToast('Full name must contain only letters and spaces.', 'danger');
                nameInput.focus();
                return;
            }

            // 2. 10-Digit Mobile Number Logic Check
            if (!/^\d{10}$/.test(phone)) {
                showToast('Mobile phone number must be exactly 10 numeric digits.', 'danger');
                phoneInput.focus();
                return;
            }

            // 3. Password Match Logic Check
            if (password !== confirmPassword) {
                showToast('Password and confirm password do not match.', 'danger');
                confirmPassInput.focus();
                return;
            }

            if (password.length < 6) {
                showToast('Password must be at least 6 characters long.', 'warning');
                passInput.focus();
                return;
            }

            try {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '⚡ Creating Patient Profile...';

                const response = await apiCall('/api/auth/register', {
                    method: 'POST',
                    body: JSON.stringify({
                        full_name,
                        email,
                        phone,
                        password,
                        confirmPassword,
                        date_of_birth,
                        gender,
                        address,
                        emergency_contact
                    })
                });

                showToast('Registration successful! Redirecting...', 'success');

                setTimeout(() => {
                    window.location.href = '/patient-dashboard.html';
                }, 500);

            } catch (err) {
                showToast(err.message || 'Registration failed.', 'danger');
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Complete Patient Registration';
            }
        });
    }
});

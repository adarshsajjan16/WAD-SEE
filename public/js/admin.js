/**
 * Admin Command Center & Management Controller
 */

let allDoctorsList = [];
let rescheduleSelectedSlot = null;

document.addEventListener('DOMContentLoaded', async () => {
    const rescheduleSlotContainer = document.getElementById('rescheduleSlotContainer');
    if (rescheduleSlotContainer) {
        rescheduleSlotContainer.addEventListener('click', (event) => {
            const slotButton = event.target.closest('.slot-btn');
            if (slotButton && rescheduleSlotContainer.contains(slotButton) && !slotButton.disabled) {
                selectRescheduleSlot(slotButton, slotButton.dataset.startTime);
            }
        });
    }

    // 1. Check Session & Role
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = '/login.html';
        return;
    }

    if (user.role !== 'admin') {
        showToast('Access denied. Administrator privileges required.', 'danger');
        setTimeout(() => window.location.href = '/patient-dashboard.html', 1000);
        return;
    }

    // Set Admin Name Header
    const adminNameEl = document.getElementById('adminNameDisplay');
    if (adminNameEl) adminNameEl.textContent = user.full_name;

    // Check if demo admin default password warning banner should be displayed
    if (user.isDemoPasswordDefault) {
        const warningBanner = document.getElementById('demoPasswordWarning');
        if (warningBanner) warningBanner.style.display = 'flex';
    }

    // Initialize Admin Tabs
    setupTabs();

    // Initial Load Overview & Doctors List
    await loadAdminDashboard();
    await loadDoctorsList();

    // Change Password Form Listener
    const changePassForm = document.getElementById('changeAdminPassForm');
    if (changePassForm) {
        changePassForm.addEventListener('submit', handleChangeAdminPassword);
    }

    // Add Doctor Form Listener
    const addDoctorForm = document.getElementById('addDoctorForm');
    if (addDoctorForm) {
        addDoctorForm.addEventListener('submit', handleAddDoctorSubmit);
    }

    // Search and Filters
    const patientSearchInput = document.getElementById('adminPatientSearch');
    if (patientSearchInput) {
        patientSearchInput.addEventListener('input', debounce(() => loadPatientsTable(), 300));
    }

    const apptStatusFilter = document.getElementById('adminApptStatusFilter');
    const apptSearchInput = document.getElementById('adminApptSearch');
    if (apptStatusFilter) apptStatusFilter.addEventListener('change', loadAppointmentsTable);
    if (apptSearchInput) apptSearchInput.addEventListener('input', debounce(() => loadAppointmentsTable(), 300));
});

// Tab Setup
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const targetTab = btn.getAttribute('data-tab');
            
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetEl = document.getElementById(targetTab);
            if (targetEl) targetEl.classList.add('active');

            // Trigger tab specific loads
            if (targetTab === 'tabOverview') await loadAdminDashboard();
            if (targetTab === 'tabPatients') await loadPatientsTable();
            if (targetTab === 'tabDoctors') await loadDoctorsList();
            if (targetTab === 'tabAppointments') await loadAppointmentsTable();
            if (targetTab === 'tabLogs') await loadActivityLogs();
        });
    });
}

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// 1. OVERVIEW & METRICS
async function loadAdminDashboard() {
    try {
        const data = await apiCall('/api/admin/dashboard');
        const s = data.stats;

        document.getElementById('statTotalPatients').textContent = s.totalPatients;
        document.getElementById('statActivePatients').textContent = s.totalActivePatients;
        document.getElementById('statTotalDoctors').textContent = s.totalDoctors;
        document.getElementById('statPendingAppts').textContent = s.pendingAppointments;
        document.getElementById('statConfirmedAppts').textContent = s.confirmedAppointments;
        document.getElementById('statCompletedAppts').textContent = s.completedAppointments;
        document.getElementById('statCancelledAppts').textContent = s.cancelledAppointments;

        // Render Recent Audit Snippet
        const tbody = document.getElementById('recentActivityTbody');
        if (tbody && data.recentActivity) {
            tbody.innerHTML = data.recentActivity.map(log => `
                <tr>
                    <td><span style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(log.timestamp)} ${formatTime(log.timestamp.split('T')[1] || '')}</span></td>
                    <td><strong>${escapeHtml(log.actor_name || 'System')}</strong></td>
                    <td><span class="badge badge-pending">${escapeHtml(log.action)}</span></td>
                    <td>${escapeHtml(log.entity_type)} #${log.entity_id || '-'}</td>
                </tr>
            `).join('');
        }
    } catch (err) {
        showToast(err.message || 'Failed to refresh admin metrics.', 'danger');
    }
}

// 2. PATIENT DIRECTORY MANAGEMENT
async function loadPatientsTable() {
    const searchVal = document.getElementById('adminPatientSearch')?.value || '';
    const tbody = document.getElementById('patientsTableTbody');
    if (!tbody) return;

    try {
        const data = await apiCall(`/api/admin/patients?search=${encodeURIComponent(searchVal)}`);
        
        if (data.patients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;">No matching patient records found.</td></tr>';
            return;
        }

        tbody.innerHTML = data.patients.map(p => `
            <tr>
                <td><strong>${escapeHtml(p.patient_number)}</strong></td>
                <td>
                    <div style="font-weight:700;">${escapeHtml(p.full_name)}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(p.email)}</div>
                </td>
                <td>${escapeHtml(p.phone)}</td>
                <td>${formatDate(p.registered_at)}</td>
                <td><span class="badge badge-${p.account_status}">${p.account_status}</span></td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="openEditPatientModal(${p.id})">⚙️ Manage</button>
                    <button class="btn ${p.account_status === 'active' ? 'btn-danger' : 'btn-success'} btn-sm" 
                            onclick="togglePatientStatus(${p.id}, '${p.account_status}')">
                        ${p.account_status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        showToast(err.message || 'Failed to load patients list.', 'danger');
    }
}

async function openEditPatientModal(patientId) {
    try {
        const data = await apiCall(`/api/admin/patients/${patientId}`);
        const p = data.patient;

        document.getElementById('editPatientId').value = p.id;
        document.getElementById('editPatientName').value = p.full_name || '';
        document.getElementById('editPatientEmail').value = p.email || '';
        document.getElementById('editPatientPhone').value = p.phone || '';
        document.getElementById('editPatientStatus').value = p.account_status || 'active';
        document.getElementById('editPatientDob').value = p.date_of_birth || '';
        document.getElementById('editPatientGender').value = p.gender || '';
        document.getElementById('editPatientAddress').value = p.address || '';
        document.getElementById('editPatientEmergency').value = p.emergency_contact || '';

        openModal('adminEditPatientModal');
    } catch (err) {
        showToast('Failed to load patient details.', 'danger');
    }
}

async function saveAdminPatientEdit() {
    const patientId = document.getElementById('editPatientId').value;
    const full_name = document.getElementById('editPatientName').value.trim();
    const email = document.getElementById('editPatientEmail').value.trim();
    const phone = document.getElementById('editPatientPhone').value.trim();
    const account_status = document.getElementById('editPatientStatus').value;
    const date_of_birth = document.getElementById('editPatientDob').value;
    const gender = document.getElementById('editPatientGender').value;
    const address = document.getElementById('editPatientAddress').value.trim();
    const emergency_contact = document.getElementById('editPatientEmergency').value.trim();

    // 1. Name Validation (Only alphabets and spaces)
    if (full_name && !/^[A-Za-z\s]+$/.test(full_name)) {
        showToast('Full name must contain only letters and spaces (no numbers or special characters).', 'danger');
        return;
    }

    // 2. Mobile Phone Validation (Exactly 10 digits)
    if (phone && !/^\d{10}$/.test(phone)) {
        showToast('Phone number must contain exactly 10 numeric digits.', 'danger');
        return;
    }

    try {
        await apiCall(`/api/admin/patients/${patientId}`, {
            method: 'PATCH',
            body: JSON.stringify({
                full_name,
                email,
                phone,
                account_status,
                date_of_birth,
                gender,
                address,
                emergency_contact
            })
        });

        showToast('Patient record updated successfully by administrator!', 'success');
        closeModal('adminEditPatientModal');
        await loadPatientsTable();
        await loadAdminDashboard();
    } catch (err) {
        showToast(err.message || 'Update failed.', 'danger');
    }
}

async function togglePatientStatus(patientId, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    if (!confirm(`Are you sure you want to change this patient account status to ${newStatus}?`)) return;

    try {
        await apiCall(`/api/admin/patients/${patientId}`, {
            method: 'PATCH',
            body: JSON.stringify({ account_status: newStatus })
        });

        showToast(`Account status updated to ${newStatus}.`, 'success');
        await loadPatientsTable();
        await loadAdminDashboard();
    } catch (err) {
        showToast(err.message || 'Status toggle failed.', 'danger');
    }
}

// 3. DOCTORS ROSTER MANAGEMENT
async function loadDoctorsList() {
    const tbody = document.getElementById('doctorsTableTbody');
    try {
        const data = await apiCall('/api/admin/doctors');
        allDoctorsList = data.doctors;

        if (tbody) {
            tbody.innerHTML = allDoctorsList.map(d => `
                <tr>
                    <td><strong>#${d.id}</strong></td>
                    <td>
                        <div style="font-weight:700;">${escapeHtml(d.full_name)}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(d.department)}</div>
                    </td>
                    <td>${escapeHtml(d.specialization)}</td>
                    <td>
                        <div style="font-size:0.85rem;">${escapeHtml(d.available_days.join(', '))}</div>
                        <div style="font-size:0.78rem; color:var(--text-muted);">${formatTime(d.consultation_start)} - ${formatTime(d.consultation_end)} (${d.slot_duration_minutes}m slots)</div>
                    </td>
                    <td><span class="badge badge-${d.active ? 'active' : 'disabled'}">${d.active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                        <button class="btn ${d.active ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleDoctorActive(${d.id}, ${d.active})">
                            ${d.active ? 'Deactivate' : 'Activate'}
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (err) {
        showToast(err.message || 'Failed to load doctors list.', 'danger');
    }
}

async function handleAddDoctorSubmit(e) {
    e.preventDefault();

    const full_name = document.getElementById('docName').value.trim();
    const specialization = document.getElementById('docSpec').value.trim();
    const department = document.getElementById('docDept').value.trim();
    const consultation_start = document.getElementById('docStart').value;
    const consultation_end = document.getElementById('docEnd').value;
    const slot_duration_minutes = parseInt(document.getElementById('docDuration').value, 10);

    const checkedDays = Array.from(document.querySelectorAll('input[name="docDays"]:checked')).map(c => c.value);

    if (checkedDays.length === 0) {
        showToast('Please select at least one available working day.', 'warning');
        return;
    }

    try {
        await apiCall('/api/admin/doctors', {
            method: 'POST',
            body: JSON.stringify({
                full_name,
                specialization,
                department,
                available_days: checkedDays,
                consultation_start,
                consultation_end,
                slot_duration_minutes
            })
        });

        showToast('Doctor created successfully!', 'success');
        closeModal('addDoctorModal');
        e.target.reset();
        await loadDoctorsList();
        await loadAdminDashboard();
    } catch (err) {
        showToast(err.message || 'Failed to add doctor.', 'danger');
    }
}

async function toggleDoctorActive(doctorId, currentActive) {
    const newActive = currentActive ? 0 : 1;
    try {
        await apiCall(`/api/admin/doctors/${doctorId}`, {
            method: 'PATCH',
            body: JSON.stringify({ active: newActive })
        });

        showToast(`Doctor status updated to ${newActive ? 'Active' : 'Inactive'}.`, 'success');
        await loadDoctorsList();
        await loadAdminDashboard();
    } catch (err) {
        showToast(err.message || 'Failed to update doctor active status.', 'danger');
    }
}

// 4. MASTER APPOINTMENT DESK
async function loadAppointmentsTable() {
    const status = document.getElementById('adminApptStatusFilter')?.value || 'all';
    const search = document.getElementById('adminApptSearch')?.value || '';

    const tbody = document.getElementById('adminApptsTableTbody');
    if (!tbody) return;

    try {
        const data = await apiCall(`/api/admin/appointments?status=${status}&search=${encodeURIComponent(search)}`);
        const appts = data.appointments;

        if (appts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem;">No appointments found matching search filter.</td></tr>';
            return;
        }

        tbody.innerHTML = appts.map(a => `
            <tr>
                <td><strong>#${a.id}</strong></td>
                <td>
                    <div style="font-weight:700;">${escapeHtml(a.patient_name)}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(a.patient_number)}</div>
                </td>
                <td>
                    <div style="font-weight:600;">${escapeHtml(a.doctor_name)}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(a.specialization)}</div>
                </td>
                <td>
                    <div>${formatDate(a.appointment_date)}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted);">${formatTime(a.start_time)} - ${formatTime(a.end_time)}</div>
                </td>
                <td>${escapeHtml(a.reason_for_visit)}</td>
                <td><span class="badge badge-${a.status}">${a.status}</span></td>
                <td>
                    <div style="font-size:0.82rem; font-style:italic; max-width:180px;">${escapeHtml(a.admin_notes || 'None')}</div>
                </td>
                <td>
                    <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                        ${a.status === 'pending' ? `
                            <button class="btn btn-success btn-sm" onclick="updateApptStatus(${a.id}, 'confirmed')">Confirm</button>
                            <button class="btn btn-danger btn-sm" onclick="updateApptStatus(${a.id}, 'rejected')">Reject</button>
                        ` : ''}
                        ${a.status === 'confirmed' ? `
                            <button class="btn btn-primary btn-sm" onclick="updateApptStatus(${a.id}, 'completed')">Complete</button>
                            <button class="btn btn-danger btn-sm" onclick="updateApptStatus(${a.id}, 'cancelled')">Cancel</button>
                        ` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="openRescheduleModal(${a.id}, ${a.doctor_id}, '${a.appointment_date}')">🗓️ Reschedule</button>
                        <button class="btn btn-secondary btn-sm" onclick="openNotesModal(${a.id}, '${escapeHtml(a.admin_notes || '')}')">📝 Notes</button>
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        showToast(err.message || 'Failed to load master appointments desk.', 'danger');
    }
}

async function updateApptStatus(apptId, status) {
    try {
        await apiCall(`/api/admin/appointments/${apptId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });

        showToast(`Appointment status updated to ${status}.`, 'success');
        await loadAppointmentsTable();
        await loadAdminDashboard();
    } catch (err) {
        showToast(err.message || 'Status update failed.', 'danger');
    }
}

function openNotesModal(apptId, currentNotes) {
    document.getElementById('notesApptId').value = apptId;
    document.getElementById('adminNotesInput').value = currentNotes;
    openModal('adminNotesModal');
}

async function saveAdminNotes() {
    const apptId = document.getElementById('notesApptId').value;
    const admin_notes = document.getElementById('adminNotesInput').value.trim();

    try {
        await apiCall(`/api/admin/appointments/${apptId}`, {
            method: 'PATCH',
            body: JSON.stringify({ admin_notes })
        });

        showToast('Administrative notes saved.', 'success');
        closeModal('adminNotesModal');
        await loadAppointmentsTable();
    } catch (err) {
        showToast(err.message || 'Failed to save notes.', 'danger');
    }
}

function openRescheduleModal(apptId, doctorId, currentDate) {
    document.getElementById('rescheduleApptId').value = apptId;
    document.getElementById('rescheduleDoctorId').value = doctorId;
    document.getElementById('rescheduleDate').value = currentDate;
    document.getElementById('rescheduleDate').min = new Date().toISOString().split('T')[0];

    document.getElementById('rescheduleDate').onchange = fetchRescheduleSlots;
    fetchRescheduleSlots();

    openModal('rescheduleModal');
}

async function fetchRescheduleSlots() {
    const doctorId = document.getElementById('rescheduleDoctorId').value;
    const date = document.getElementById('rescheduleDate').value;
    const container = document.getElementById('rescheduleSlotContainer');

    rescheduleSelectedSlot = null;

    if (!doctorId || !date) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Pick a date to check slot availability.</div>';
        return;
    }

    try {
        const data = await apiCall(`/api/doctors/${doctorId}/slots?date=${date}`);
        if (!data.isWorkingDay) {
            container.innerHTML = `<div class="alert-banner" style="margin-bottom:0;">⚠️ ${escapeHtml(data.message)}</div>`;
            return;
        }

        container.innerHTML = `
            <div class="slot-grid">
                ${data.slots.map(s => `
                    <button type="button" class="slot-btn" ${!s.available ? 'disabled' : ''} data-start-time="${escapeHtml(s.start_time)}">
                        ${formatTime(s.start_time)}
                    </button>
                `).join('')}
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div style="color:var(--danger);">${escapeHtml(err.message)}</div>`;
    }
}

function selectRescheduleSlot(btn, time) {
    document.querySelectorAll('#rescheduleSlotContainer .slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    rescheduleSelectedSlot = time;
}

async function saveReschedule() {
    const apptId = document.getElementById('rescheduleApptId').value;
    const date = document.getElementById('rescheduleDate').value;

    if (!rescheduleSelectedSlot) {
        showToast('Please select a target slot time.', 'warning');
        return;
    }

    try {
        await apiCall(`/api/admin/appointments/${apptId}`, {
            method: 'PATCH',
            body: JSON.stringify({
                appointment_date: date,
                start_time: rescheduleSelectedSlot
            })
        });

        showToast('Appointment rescheduled successfully!', 'success');
        closeModal('rescheduleModal');
        await loadAppointmentsTable();
    } catch (err) {
        showToast(err.message || 'Reschedule failed.', 'danger');
    }
}

// 5. ACTIVITY AUDIT LOGS
async function loadActivityLogs() {
    const tbody = document.getElementById('activityLogsTbody');
    if (!tbody) return;

    try {
        const data = await apiCall('/api/admin/activity-logs');

        if (data.logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem;">No system activity logged yet.</td></tr>';
            return;
        }

        tbody.innerHTML = data.logs.map(log => `
            <tr>
                <td><strong>#${log.id}</strong></td>
                <td>${formatDate(log.timestamp)} ${formatTime(log.timestamp.split('T')[1] || '')}</td>
                <td>
                    <div style="font-weight:700;">${escapeHtml(log.actor_name || 'System')}</div>
                    <div style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(log.actor_role || 'system')}</div>
                </td>
                <td><span class="badge badge-pending">${escapeHtml(log.action)}</span></td>
                <td>${escapeHtml(log.entity_type)} #${log.entity_id || '-'}</td>
                <td>
                    <pre style="font-size:0.75rem; color:var(--text-muted); background:rgba(0,0,0,0.2); padding:0.25rem 0.5rem; border-radius:4px; max-width:250px; overflow-x:auto;">${escapeHtml(log.metadata || '{}')}</pre>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        showToast(err.message || 'Failed to load activity logs.', 'danger');
    }
}

// 6. CSV EXPORT HUB HANDLERS
async function downloadCsv(type) {
    try {
        showToast(`Generating ${type} CSV export...`, 'info');
        await apiCall(`/api/admin/export/${type}`);
        showToast(`Downloaded ${type} CSV successfully!`, 'success');
    } catch (err) {
        showToast(err.message || `Failed to download ${type} CSV.`, 'danger');
    }
}

// CHANGE DEMO ADMIN PASSWORD
async function handleChangeAdminPassword(e) {
    e.preventDefault();
    const currentPassword = document.getElementById('currentAdminPass').value;
    const newPassword = document.getElementById('newAdminPass').value;

    if (!currentPassword || !newPassword) {
        showToast('Please enter current and new password.', 'warning');
        return;
    }

    try {
        await apiCall('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });

        showToast('Admin password updated successfully! Please re-login with your new password.', 'success');
        closeModal('changeAdminPassModal');
        
        // Hide warning banner
        const banner = document.getElementById('demoPasswordWarning');
        if (banner) banner.style.display = 'none';

    } catch (err) {
        showToast(err.message || 'Password change failed.', 'danger');
    }
}

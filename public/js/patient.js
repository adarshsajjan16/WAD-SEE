/**
 * Patient Dashboard & Appointment Booking Controller
 */

let selectedSlotTime = null;
let currentPatientProfile = null;

document.addEventListener('DOMContentLoaded', async () => {
    const slotContainer = document.getElementById('slotContainer');
    if (slotContainer) {
        slotContainer.addEventListener('click', (event) => {
            const slotButton = event.target.closest('.slot-btn');
            if (slotButton && slotContainer.contains(slotButton) && !slotButton.disabled) {
                selectSlot(slotButton, slotButton.dataset.startTime);
            }
        });
    }

    // Verify session
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = '/login.html';
        return;
    }

    if (user.role === 'admin') {
        window.location.href = '/admin-dashboard.html';
        return;
    }

    // Set Header Name & Patient Number
    const userNameEl = document.getElementById('userNameDisplay');
    if (userNameEl) userNameEl.textContent = user.full_name;

    // Load Patient Dashboard Data
    await loadPatientDashboard();

    // Setup Appointment Booking Modal Listener
    const newApptBtn = document.getElementById('newApptBtn');
    if (newApptBtn) {
        newApptBtn.addEventListener('click', () => {
            openBookingModal();
        });
    }

    // Setup Edit Profile Listener
    const editProfileBtn = document.getElementById('editProfileBtn');
    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', () => {
            openProfileModal();
        });
    }

    // Profile Form Submit
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', handleProfileUpdate);
    }

    // Appointment Form Submit
    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) {
        bookingForm.addEventListener('submit', handleAppointmentSubmit);
    }

    // Slot Picker change listeners
    const doctorSelect = document.getElementById('bookingDoctor');
    const dateInput = document.getElementById('bookingDate');

    if (doctorSelect && dateInput) {
        // Enforce minimum date = today
        dateInput.min = new Date().toISOString().split('T')[0];

        doctorSelect.addEventListener('change', fetchAvailableSlots);
        dateInput.addEventListener('change', fetchAvailableSlots);
    }
});

async function loadPatientDashboard() {
    try {
        const data = await apiCall('/api/patients/me');
        currentPatientProfile = data.patient;

        // Render Profile Summary Cards
        document.getElementById('patientNumberBadge').textContent = currentPatientProfile.patient_number;
        document.getElementById('patientPhone').textContent = currentPatientProfile.phone || 'Not provided';
        document.getElementById('patientAddress').textContent = currentPatientProfile.address || 'Not provided';

        // Stats calculation
        const appts = data.appointments || [];
        document.getElementById('statTotalBookings').textContent = appts.length;
        
        const upcomingCount = appts.filter(a => a.status === 'confirmed' || a.status === 'pending').length;
        document.getElementById('statUpcomingVisits').textContent = upcomingCount;

        // Render Table
        renderPatientAppointmentsTable(appts);

    } catch (err) {
        showToast(err.message || 'Failed to load dashboard.', 'danger');
    }
}

function renderPatientAppointmentsTable(appointments) {
    const tbody = document.getElementById('patientAppointmentsTbody');
    if (!tbody) return;

    if (!appointments || appointments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    📁 No appointments scheduled yet. Click <strong>"Book Appointment"</strong> to schedule a visit with a specialist.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = appointments.map(appt => {
        const isCancelable = appt.status === 'pending' || appt.status === 'confirmed';
        return `
            <tr>
                <td><strong>#${appt.id}</strong></td>
                <td>
                    <div style="font-weight: 700;">${escapeHtml(appt.doctor_name)}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(appt.specialization)} (${escapeHtml(appt.department)})</div>
                </td>
                <td>${formatDate(appt.appointment_date)}</td>
                <td><span style="font-weight: 600;">${formatTime(appt.start_time)}</span> - ${formatTime(appt.end_time)}</td>
                <td>${escapeHtml(appt.reason_for_visit)}</td>
                <td><span class="badge badge-${appt.status}">${appt.status}</span></td>
                <td>
                    ${isCancelable ? `
                        <button class="btn btn-danger btn-sm" onclick="cancelAppointment(${appt.id})">
                            Cancel Request
                        </button>
                    ` : '<span style="font-size: 0.85rem; color: var(--text-dim);">-</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

async function openBookingModal() {
    selectedSlotTime = null;
    document.getElementById('slotContainer').innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">Select a specialist and appointment date to view available time slots.</div>';
    
    // Load active doctors
    try {
        const data = await apiCall('/api/doctors');
        const doctorSelect = document.getElementById('bookingDoctor');
        doctorSelect.innerHTML = '<option value="">-- Select Specialist --</option>' + 
            data.doctors.map(d => `<option value="${d.id}">${escapeHtml(d.full_name)} (${escapeHtml(d.specialization)})</option>`).join('');
        
        openModal('bookingModal');
    } catch (err) {
        showToast('Failed to load available medical specialists.', 'danger');
    }
}

async function fetchAvailableSlots() {
    const doctorId = document.getElementById('bookingDoctor').value;
    const date = document.getElementById('bookingDate').value;
    const slotContainer = document.getElementById('slotContainer');

    selectedSlotTime = null;

    if (!doctorId || !date) {
        slotContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">Select a specialist and date to check slots.</div>';
        return;
    }

    slotContainer.innerHTML = '<div style="color: var(--primary); font-size: 0.85rem;">⏳ Calculating real-time slot availability...</div>';

    try {
        const data = await apiCall(`/api/doctors/${doctorId}/slots?date=${date}`);
        
        if (!data.isWorkingDay) {
            slotContainer.innerHTML = `<div class="alert-banner" style="margin-bottom: 0;">📅 ${escapeHtml(data.message)}</div>`;
            return;
        }

        if (!data.slots || data.slots.length === 0) {
            slotContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No consultation slots configured for this date.</div>';
            return;
        }

        const slotGrid = document.createElement('div');
        slotGrid.className = 'slot-grid';

        slotGrid.innerHTML = data.slots.map(slot => {
            const timeText = formatTime(slot.start_time);
            return `
                <button type="button" class="slot-btn" 
                    ${!slot.available ? 'disabled' : ''} 
                    title="${escapeHtml(slot.reason)}"
                    data-start-time="${escapeHtml(slot.start_time)}">
                    ${timeText}
                </button>
            `;
        }).join('');

        slotContainer.innerHTML = '';
        slotContainer.appendChild(slotGrid);

    } catch (err) {
        slotContainer.innerHTML = `<div style="color: var(--danger); font-size: 0.85rem;">${escapeHtml(err.message || 'Error loading slots.')}</div>`;
    }
}

function selectSlot(btn, startTime) {
    document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedSlotTime = startTime;
}

async function handleAppointmentSubmit(e) {
    e.preventDefault();

    const doctor_id = document.getElementById('bookingDoctor').value;
    const appointment_date = document.getElementById('bookingDate').value;
    const reason_for_visit = document.getElementById('bookingReason').value.trim();

    if (!doctor_id || !appointment_date || !selectedSlotTime || !reason_for_visit) {
        showToast('Please complete all fields and select an available time slot.', 'warning');
        return;
    }

    try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Processing Booking...';

        await apiCall('/api/appointments', {
            method: 'POST',
            body: JSON.stringify({
                doctor_id: parseInt(doctor_id, 10),
                appointment_date,
                start_time: selectedSlotTime,
                reason_for_visit
            })
        });

        showToast('Appointment request submitted successfully!', 'success');
        closeModal('bookingModal');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Booking Request';

        // Refresh dashboard
        await loadPatientDashboard();

    } catch (err) {
        showToast(err.message || 'Booking failed.', 'danger');
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Booking Request';
    }
}

async function cancelAppointment(appointmentId) {
    if (!confirm('Are you sure you want to cancel this appointment request?')) return;

    try {
        await apiCall(`/api/appointments/${appointmentId}/cancel`, {
            method: 'POST'
        });

        showToast('Appointment cancelled.', 'info');
        await loadPatientDashboard();
    } catch (err) {
        showToast(err.message || 'Could not cancel appointment.', 'danger');
    }
}

function openProfileModal() {
    if (!currentPatientProfile) return;
    document.getElementById('editPhone').value = currentPatientProfile.phone || '';
    document.getElementById('editDob').value = currentPatientProfile.date_of_birth || '';
    document.getElementById('editGender').value = currentPatientProfile.gender || '';
    document.getElementById('editAddress').value = currentPatientProfile.address || '';
    document.getElementById('editEmergency').value = currentPatientProfile.emergency_contact || '';
    openModal('profileModal');
}

async function handleProfileUpdate(e) {
    e.preventDefault();

    const phone = document.getElementById('editPhone').value.trim();
    const date_of_birth = document.getElementById('editDob').value;
    const gender = document.getElementById('editGender').value;
    const address = document.getElementById('editAddress').value.trim();
    const emergency_contact = document.getElementById('editEmergency').value.trim();

    try {
        await apiCall('/api/patients/me', {
            method: 'POST',
            body: JSON.stringify({ phone, date_of_birth, gender, address, emergency_contact })
        });

        showToast('Profile updated successfully!', 'success');
        closeModal('profileModal');
        await loadPatientDashboard();
    } catch (err) {
        showToast(err.message || 'Profile update failed.', 'danger');
    }
}

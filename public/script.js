// ============================================
// IMPORTS
// ============================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { 
    auth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    updatePassword,
    sendPasswordResetEmail
} from './firebase-config.js';

// ============================================
// SYNC USER TO SUPABASE (sirf ek baar)
// ============================================
async function syncUserToSupabase(user, additionalData = {}) {
    try {
        await fetch('/api/users/sync', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                firebase_uid: user.uid,
                email:        user.email,
                display_name: additionalData.display_name || user.displayName || user.email.split('@')[0]
            })
        });
    } catch (err) {
        console.debug('[Nexora] sync error:', err.message);
    }
}
// ============================================
// UPDATE USER IN SUPABASE
// ============================================
async function updateUserInSupabase(userId, updates) {
    try {
        const res  = await fetch('/api/users/update', {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ firebase_uid: userId, ...updates })
        });
        const json = await res.json();
        return json.success;
    } catch (err) {
        console.debug('[Nexora] update error:', err.message);
        return false;
    }
}
// ============================================
// SUPABASE REST (for projects/roles)
// ============================================
async function supabaseQuery(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        headers: {
            apikey:        SUPABASE_ANON,
            Authorization: `Bearer ${SUPABASE_ANON}`,
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase [${table}]: ${res.status} — ${err}`);
    }
    return res.json();
}

// ============================================
// FAQ DATA
// ============================================
const faqs = [
    { question: 'How can I apply for a job at Nexora?',    answer: 'You can apply by opening a job post, filling the form, and uploading your CV.' },
    { question: 'Is remote work available?',               answer: 'Yes, most work is remote. We collaborate through Google Meet, WhatsApp, and GitHub.' },
    { question: 'Do I need experience to apply?',          answer: 'No formal experience is required. We value strong AI tool usage and practical ability.' },
    { question: 'How will I know if I am selected?',       answer: 'Shortlisted candidates are contacted via email or provided contact details.' },
    { question: 'Can I apply for multiple positions?',     answer: 'No, apply for only one role at a time.' },
    { question: 'What happens after I submit my CV?',      answer: 'Your application is reviewed by the team, and shortlisted candidates are contacted.' },
];

// ============================================
// STATE
// ============================================
let currentProjects            = [];
let currentSearch              = '';
let currentCategory            = 'all';
let currentView                = 'projects';
let selectedProjectForRoles    = null;
let currentUser                = null;
let projectsLoaded             = false;

let _pendingApplyProject = null;
let _pendingApplyRoleId  = null;

// ============================================
// AUTH UI
// ============================================
function updateAuthUI(user) {
    const authButtonContainer = document.getElementById('authButtonContainer');
    const profileContainer    = document.getElementById('profileContainer');
    const avatarBtn           = document.getElementById('avatarBtn');

    if (!authButtonContainer || !profileContainer) return;

    if (user) {
        authButtonContainer.classList.add('hidden');
        profileContainer.classList.remove('hidden');
        const displayName = user.displayName || user.email.split('@')[0];
        if (avatarBtn) {
            avatarBtn.textContent = displayName.charAt(0).toUpperCase();
            avatarBtn.title       = user.email;
        }
    } else {
        authButtonContainer.classList.remove('hidden');
        profileContainer.classList.add('hidden');
    }
}

// ============================================
// AUTH MODAL HELPERS
// ============================================
function openModalFunc() {
    const modal      = document.getElementById('authModal');
    const modalInner = document.getElementById('authModalInner');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => modalInner?.classList.add('nx-visible'), 10);
    document.body.style.overflow = 'hidden';
    clearMsg();
}

function closeModalFunc() {
    const modalInner = document.getElementById('authModalInner');
    modalInner?.classList.remove('nx-visible');
    setTimeout(() => {
        const modal = document.getElementById('authModal');
        if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
        document.body.style.overflow = '';
        clearMsg();
    }, 300);
}

function clearMsg() {
    const msgDiv = document.getElementById('authMessage');
    if (msgDiv) { msgDiv.textContent = ''; msgDiv.classList.add('hidden'); }
}

function showMsg(text, type) {
    const msgDiv = document.getElementById('authMessage');
    if (msgDiv) {
        msgDiv.textContent = text;
        msgDiv.className   = type === 'error' ? 'nx-error' : (type === 'success' ? 'nx-success' : 'nx-info');
        msgDiv.classList.remove('hidden');
    }
}

window.nxShowTab = function(tab) {
    const loginForm = document.getElementById('loginForm');
    const regForm   = document.getElementById('registerForm');
    const tabPill   = document.getElementById('nxTabPill');
    const loginTab  = document.getElementById('loginTab');
    const regTab    = document.getElementById('registerTab');

    if (tab === 'login') {
        loginForm?.classList.remove('nx-hidden');
        regForm?.classList.add('nx-hidden');
        if (tabPill) tabPill.style.left = '4px';
        loginTab?.classList.replace('nx-inactive', 'nx-active');
        regTab?.classList.replace('nx-active', 'nx-inactive');
    } else {
        loginForm?.classList.add('nx-hidden');
        regForm?.classList.remove('nx-hidden');
        if (tabPill) tabPill.style.left = 'calc(50%)';
        regTab?.classList.replace('nx-inactive', 'nx-active');
        loginTab?.classList.replace('nx-active', 'nx-inactive');
    }
    clearMsg();
};

window.nxToggleEye = function(id, btn) {
    const inp = document.getElementById(id);
    if (inp) {
        inp.type         = inp.type === 'password' ? 'text' : 'password';
        btn.style.opacity = inp.type === 'password' ? '0.6' : '1';
    }
};

// ============================================
// FIREBASE AUTH HANDLERS
// ============================================
function setupAuth() {
    const loginBtn    = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const signUpBtn   = document.getElementById('signUpBtn');
    const closeBtn    = document.getElementById('closeModal');
    const modal       = document.getElementById('authModal');

    // LOGIN
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const email    = document.getElementById('loginEmail')?.value.trim();
            const password = document.getElementById('loginPassword')?.value;
            if (!email || !password) { showMsg('Please fill in all fields.', 'error'); return; }

            showMsg('Signing in…', 'info');
            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                showMsg('Login successful!', 'success');
                document.getElementById('loginEmail').value = '';
                document.getElementById('loginPassword').value = '';
                setTimeout(closeModalFunc, 1000);
            } catch (error) {
                let msg = error.message;
                if (msg.includes('invalid-credential')) msg = 'Invalid email or password.';
                showMsg(msg, 'error');
            }
        });
    }

    // REGISTER
    if (registerBtn) {
        registerBtn.addEventListener('click', async () => {
            const name     = document.getElementById('regName')?.value.trim();
            const email    = document.getElementById('regEmail')?.value.trim();
            const password = document.getElementById('regPassword')?.value;
            if (!name || !email || !password) { showMsg('All fields required.', 'error'); return; }
            if (password.length < 6) { showMsg('Password must be at least 6 characters.', 'error'); return; }

            showMsg('Creating account…', 'info');
            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                
                // Update profile with display name
                await updateProfile(user, { displayName: name });
                
                // Sync to Supabase
                await syncUserToSupabase(user, { display_name: name });
                
                showMsg('Account created! You are now logged in.', 'success');
                document.getElementById('regName').value = '';
                document.getElementById('regEmail').value = '';
                document.getElementById('regPassword').value = '';
                setTimeout(closeModalFunc, 1000);
            } catch (error) {
                let msg = error.message;
                if (msg.includes('email-already-in-use')) msg = 'Email already in use.';
                showMsg(msg, 'error');
            }
        });
    }

    signUpBtn?.addEventListener('click', e => { e.preventDefault(); openModalFunc(); });
    closeBtn?.addEventListener('click', closeModalFunc);
    modal?.addEventListener('click', e => { if (e.target === modal) closeModalFunc(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModalFunc(); });

    document.getElementById('loginTab')?.addEventListener('click',    () => window.nxShowTab('login'));
    document.getElementById('registerTab')?.addEventListener('click', () => window.nxShowTab('register'));
}

// ============================================
// PROFILE MODAL
// ============================================
function openProfileModal(tab = 'edit') {
    const m  = document.getElementById('profileModal');
    const mi = document.getElementById('profileModalInner');
    if (!m) return;
    if (currentUser) {
        const ni = document.getElementById('profileNameInput');
        if (ni) ni.value = currentUser.displayName || '';
    }
    m.classList.remove('hidden');
    m.classList.add('flex');
    setTimeout(() => mi?.classList.add('nx-visible'), 10);
    document.body.style.overflow = 'hidden';
    nxShowProfileTab(tab);
    clearProfileMsg();
}

function closeProfileModal() {
    const mi = document.getElementById('profileModalInner');
    mi?.classList.remove('nx-visible');
    setTimeout(() => {
        const m = document.getElementById('profileModal');
        if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
        document.body.style.overflow = '';
        clearProfileMsg();
    }, 300);
}

function clearProfileMsg() {
    const msg = document.getElementById('profileMessage');
    if (msg) { msg.textContent = ''; msg.classList.add('hidden'); }
}

function showProfileMsg(text, type) {
    const msg = document.getElementById('profileMessage');
    if (msg) {
        msg.textContent = text;
        msg.className   = type === 'error' ? 'nx-error' : (type === 'success' ? 'nx-success' : 'nx-info');
        msg.classList.remove('hidden');
    }
}

window.nxShowProfileTab = function(tab) {
    const ef   = document.getElementById('editProfileForm');
    const pf   = document.getElementById('changePasswordForm');
    const pill = document.getElementById('profileTabPill');
    const et   = document.getElementById('editProfileTab');
    const pt   = document.getElementById('changePassTab');

    if (tab === 'edit') {
        ef?.classList.remove('nx-hidden');
        pf?.classList.add('nx-hidden');
        if (pill) pill.style.left = '4px';
        et?.classList.replace('nx-inactive', 'nx-active');
        pt?.classList.replace('nx-active', 'nx-inactive');
    } else {
        ef?.classList.add('nx-hidden');
        pf?.classList.remove('nx-hidden');
        if (pill) pill.style.left = 'calc(50%)';
        pt?.classList.replace('nx-inactive', 'nx-active');
        et?.classList.replace('nx-active', 'nx-inactive');
    }
    clearProfileMsg();
};

function setupProfileDropdown() {
    const avatarBtn        = document.getElementById('avatarBtn');
    const dropdownMenu     = document.getElementById('dropdownMenu');
    const logoutBtn        = document.getElementById('logoutBtn');
    const changeProfileBtn = document.getElementById('changeProfileBtn');
    const closeProfileBtn  = document.getElementById('closeProfileModal');
    const saveProfileBtn   = document.getElementById('saveProfileBtn');
    const savePasswordBtn  = document.getElementById('savePasswordBtn');
    const profileModal     = document.getElementById('profileModal');

    avatarBtn?.addEventListener('click', e => {
        e.stopPropagation();
        dropdownMenu?.classList.toggle('show');
    });
    document.addEventListener('click', () => dropdownMenu?.classList.remove('show'));

    changeProfileBtn?.addEventListener('click', e => {
        e.preventDefault();
        dropdownMenu?.classList.remove('show');
        if (!currentUser) { alert('Please login first'); return; }
        openProfileModal('edit');
    });

    closeProfileBtn?.addEventListener('click', closeProfileModal);
    profileModal?.addEventListener('click', e => { if (e.target === profileModal) closeProfileModal(); });

    // Save display name
    saveProfileBtn?.addEventListener('click', async () => {
        const newName = document.getElementById('profileNameInput')?.value.trim();
        if (!newName) { showProfileMsg('Name cannot be empty.', 'error'); return; }
        showProfileMsg('Saving…', 'info');

        try {
            await updateProfile(currentUser, { displayName: newName });
            
            // Update in Supabase as well
            await updateUserInSupabase(currentUser.uid, { display_name: newName });
            
            // Refresh currentUser
            currentUser = auth.currentUser;
            updateAuthUI(currentUser);
            
            showProfileMsg('Profile updated successfully!', 'success');
            setTimeout(closeProfileModal, 1200);
        } catch (error) {
            showProfileMsg('Error: ' + error.message, 'error');
        }
    });

    // Change password
    savePasswordBtn?.addEventListener('click', async () => {
        const newPass = document.getElementById('newPasswordInput')?.value;
        const confirm = document.getElementById('confirmPasswordInput')?.value;
        if (!newPass || !confirm) { showProfileMsg('All fields are required.', 'error'); return; }
        if (newPass.length < 6)   { showProfileMsg('New password must be at least 6 characters.', 'error'); return; }
        if (newPass !== confirm)   { showProfileMsg('Passwords do not match.', 'error'); return; }

        showProfileMsg('Updating password…', 'info');
        try {
            await updatePassword(currentUser, newPass);
            ['newPasswordInput', 'confirmPasswordInput'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            showProfileMsg('Password updated successfully!', 'success');
            setTimeout(closeProfileModal, 1200);
        } catch (error) {
            showProfileMsg('Error: ' + error.message, 'error');
        }
    });

    logoutBtn?.addEventListener('click', async e => {
        e.preventDefault();
        dropdownMenu?.classList.remove('show');
        await signOut(auth);
        alert('Logged out successfully');
        showPage('home');
    });
}

// ============================================
// APPLY MODAL
// ============================================
function openApplyModal(project, roleId) {
    const role = project.roles.find(r => r.id === roleId);
    if (!role) return;

    _pendingApplyProject = project;
    _pendingApplyRoleId  = roleId;

    const subtitle = document.getElementById('applyModalSubtitle');
    if (subtitle) subtitle.textContent = `${role.role_title} · ${project.title}`;

    const nameInput  = document.getElementById('applyName');
    const emailInput = document.getElementById('applyEmail');
    if (nameInput)  nameInput.value  = currentUser?.displayName || '';
    if (emailInput) emailInput.value = currentUser?.email || '';

    const phoneInput = document.getElementById('applyPhone');
    const cvInput    = document.getElementById('applyCvLink');
    const applyMsg   = document.getElementById('applyMessage');
    if (phoneInput) phoneInput.value = '';
    if (cvInput)    cvInput.value    = '';
    if (applyMsg) { applyMsg.textContent = ''; applyMsg.className = 'hidden'; applyMsg.style.display = ''; }

    const applyModal      = document.getElementById('applyModal');
    const applyModalInner = document.getElementById('applyModalInner');
    if (!applyModal) return;

    applyModal.classList.remove('hidden');
    applyModal.classList.add('flex');
    setTimeout(() => applyModalInner?.classList.add('nx-visible'), 10);
    document.body.style.overflow = 'hidden';
}

function closeApplyModal() {
    const applyModalInner = document.getElementById('applyModalInner');
    applyModalInner?.classList.remove('nx-visible');
    setTimeout(() => {
        const applyModal = document.getElementById('applyModal');
        if (applyModal) { applyModal.classList.add('hidden'); applyModal.classList.remove('flex'); }
        document.body.style.overflow = '';
        _pendingApplyProject = null;
        _pendingApplyRoleId  = null;
    }, 300);
}

function showApplyMsg(text, type) {
    const msg = document.getElementById('applyMessage');
    if (!msg) return;
    msg.textContent    = text;
    msg.style.display  = 'block';
    msg.className      = '';
    msg.style.background = type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)';
    msg.style.border     = type === 'error' ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(34,197,94,0.25)';
    msg.style.color      = type === 'error' ? '#fca5a5' : '#86efac';
    msg.style.borderRadius = '10px';
    msg.style.padding      = '8px 12px';
    msg.style.fontSize     = '11px';
    msg.style.fontWeight   = '500';
    msg.style.marginTop    = '8px';
}

function setupApplyModal() {
    document.getElementById('closeApplyModal')?.addEventListener('click', closeApplyModal);
    document.getElementById('applyModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('applyModal')) closeApplyModal();
    });

    document.getElementById('applySubmitBtn')?.addEventListener('click', async () => {
        const name  = document.getElementById('applyName')?.value.trim();
        const email = document.getElementById('applyEmail')?.value.trim();
        const phone = document.getElementById('applyPhone')?.value.trim();
        const cv    = document.getElementById('applyCvLink')?.value.trim();

        if (!name)                          return showApplyMsg('Please enter your full name.', 'error');
        if (!email || !email.includes('@')) return showApplyMsg('Please enter a valid email address.', 'error');
        if (!phone)                         return showApplyMsg('Please enter your phone number.', 'error');
        if (!cv)                            return showApplyMsg('Please provide your CV link (Google Drive / Dropbox).', 'error');

        const project = _pendingApplyProject;
        const role    = project?.roles.find(r => r.id === _pendingApplyRoleId);

        const submitBtn = document.getElementById('applySubmitBtn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span>Submitting…</span>'; }

        // Update user in Supabase with phone and CV
        await updateUserInSupabase(currentUser.uid, {
            display_name: name,
            phone: phone,
            cv_link: cv
        });

        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span>Submit Application →</span>'; }

        showApplyMsg(`✅ Application submitted for "${role?.role_title}"! We'll contact you at ${email}`, 'success');
        setTimeout(() => closeApplyModal(), 2200);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            const applyModal = document.getElementById('applyModal');
            if (applyModal && !applyModal.classList.contains('hidden')) closeApplyModal();
        }
    });
}

// ============================================
// RENDER HELPERS
// ============================================
function getNoticeLine(status, purpose) {
    if (status === 'Paid'   && purpose === 'Client')   return '💰 Payment depends upon tender size. Larger project = higher compensation.';
    if (status === 'Paid'   && purpose === 'Practice') return '📈 Practice project with performance-based incentives.';
    if (status === 'Unpaid' && purpose === 'Client')   return '🤝 Client project — Commission-based. Payment upon successful delivery.';
    return '🎓 Commission-based | Startup unpaid. Paid when clients come. Learning opportunity.';
}

function renderCategories() {
    const container = document.getElementById('portalCategoriesContainer');
    if (!container) return;

    if (currentView !== 'roles' || !selectedProjectForRoles) {
        container.innerHTML = '';
        return;
    }

    const projectCategories = ['all', ...new Set(selectedProjectForRoles.roles.map(r => r.category))];
    container.innerHTML = `
        <button class="nx-cat-chip back-chip" onclick="goBackToProjects()">← Back to Projects</button>
        ${projectCategories.map(cat => `
            <button data-category="${cat.toLowerCase()}" class="nx-cat-chip ${currentCategory === cat.toLowerCase() ? 'active' : ''}">
                ${cat === 'all' ? 'All Roles' : cat}
            </button>
        `).join('')}
    `;

    document.querySelectorAll('#portalCategoriesContainer .nx-cat-chip:not(.back-chip)').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('#portalCategoriesContainer .nx-cat-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.getAttribute('data-category');
            filterRolesByCategory();
        });
    });
}

function buildRoleCard(role, project) {
    return `
        <div class="role-card">
            <div class="role-card-project-info">
                <img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)}" class="role-project-image"
                     onerror="this.src='https://placehold.co/60x60/1a1635/white?text=Project'">
                <div class="role-project-details">
                    <div class="role-project-name">${escapeHtml(project.title)}</div>
                    <div class="role-project-badges">
                        <span class="badge ${project.status === 'Paid' ? 'badge-paid' : 'badge-unpaid'}">${project.status}</span>
                        <span class="badge badge-purpose">${project.purpose}</span>
                    </div>
                </div>
            </div>
            <div class="role-card-divider"></div>
            <div class="role-card-header">
                <h4 class="role-title">${escapeHtml(role.role_title)}</h4>
                <span class="role-category-badge">${escapeHtml(role.category)}</span>
            </div>
            <p class="role-description">${escapeHtml(role.description || 'No description provided.')}</p>
            <div class="role-techstack">
                <span class="tech-label">Tech Stack</span>
                <div class="tech-list">
                    ${role.skills.map(s => `<span class="tech-chip">${escapeHtml(s)}</span>`).join('')}
                </div>
            </div>
            <button class="apply-role-btn" onclick='applyForSpecificRole(${JSON.stringify(project).replace(/'/g, "&#39;")}, ${role.id})'>
                Apply for this Role →
            </button>
        </div>
    `;
}

function filterRolesByCategory() {
    if (!selectedProjectForRoles) return;
    const container   = document.getElementById('portalJobsContainer');
    const resultCount = document.getElementById('portalResultCount');
    const project     = selectedProjectForRoles;

    let filteredRoles = currentCategory !== 'all'
        ? project.roles.filter(r => r.category.toLowerCase() === currentCategory)
        : [...project.roles];

    if (!container) return;
    if (resultCount) resultCount.textContent = filteredRoles.length;
    document.getElementById('portalNoResults')?.classList.add('hidden');

    container.innerHTML = filteredRoles.length === 0
        ? `<div class="text-center py-12"><p class="text-gray-400">No roles in "${currentCategory}" category.</p></div>`
        : `<div class="roles-grid">${filteredRoles.map(r => buildRoleCard(r, project)).join('')}</div>`;
}

function showRolesForProject(project) {
    selectedProjectForRoles = project;
    currentView             = 'roles';
    currentCategory         = 'all';
    renderCategories();
    renderRolesView();
}

function goBackToProjects() {
    currentView             = 'projects';
    selectedProjectForRoles = null;
    currentCategory         = 'all';
    renderCategories();
    renderPortalJobs();
}

function renderRolesView() {
    const container   = document.getElementById('portalJobsContainer');
    const resultCount = document.getElementById('portalResultCount');
    const project     = selectedProjectForRoles;
    if (!container) return;

    if (!project?.roles?.length) {
        if (resultCount) resultCount.textContent = '0';
        container.innerHTML = `<div class="text-center py-12" style="grid-column:1/-1;"><p class="text-gray-400">No roles available for this project yet.</p></div>`;
        return;
    }

    let filteredRoles = currentCategory === 'all'
        ? [...project.roles]
        : project.roles.filter(r => r.category?.toLowerCase() === currentCategory);

    if (resultCount) resultCount.textContent = filteredRoles.length;
    document.getElementById('portalNoResults')?.classList.add('hidden');

    container.innerHTML = filteredRoles.length === 0
        ? `<div class="text-center py-12" style="grid-column:1/-1;"><p class="text-gray-400">No roles found.</p></div>`
        : `<div class="roles-grid">${filteredRoles.map(r => buildRoleCard(r, project)).join('')}</div>`;
}

function renderPortalJobs() {
    if (currentView === 'roles' && selectedProjectForRoles) { renderRolesView(); return; }

    let filtered = [...currentProjects];
    if (currentSearch?.trim()) {
        const q = currentSearch.toLowerCase();
        filtered = filtered.filter(p =>
            p.title.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.roles?.some(r => r.role_title?.toLowerCase().includes(q))
        );
    }

    const container   = document.getElementById('portalJobsContainer');
    const noResults   = document.getElementById('portalNoResults');
    const resultCount = document.getElementById('portalResultCount');
    if (!container) return;

    if (resultCount) resultCount.textContent = filtered.length;

    if (filtered.length === 0) {
        container.innerHTML = '';
        noResults?.classList.remove('hidden');
        return;
    }
    noResults?.classList.add('hidden');

    container.innerHTML = filtered.map(project => `
        <div class="project-card">
            <div class="project-card-image">
                <img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)}"
                     onerror="this.src='https://placehold.co/400x200/1a1635/white?text=Project'">
            </div>
            <div class="project-card-content">
                <div class="project-header">
                    <h3 class="project-title">${escapeHtml(project.title)}</h3>
                    <div class="project-badges">
                        <span class="badge ${project.status === 'Paid' ? 'badge-paid' : 'badge-unpaid'}">${project.status}</span>
                        <span class="badge badge-purpose">${project.purpose}</span>
                    </div>
                </div>
                <p class="project-description">${escapeHtml(project.description)}</p>
                <div class="progress-section">
                    <div class="progress-header">
                        <span>Completion</span>
                        <span class="progress-percent">${project.completion}%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width:${project.completion}%"></div>
                    </div>
                </div>
                <div class="roles-info">
                    <span class="roles-count">📌 ${project.roles?.length || 0} role(s) available</span>
                </div>
                <div class="notice-section ${project.status === 'Paid' ? 'notice-paid' : 'notice-unpaid'}">
                    ${getNoticeLine(project.status, project.purpose)}
                </div>
                <div class="action-buttons">
                    <button class="btn-doc" onclick='viewRequirements(${JSON.stringify(project).replace(/'/g, "&#39;")})'>
                        📄 View Requirements Document
                    </button>
                    <button class="btn-view-roles" onclick='showRolesForProject(${JSON.stringify(project).replace(/'/g, "&#39;")})'>
                        👁️ See Available Roles (${project.roles?.length || 0})
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// ============================================
// DATA LOADER
async function loadProjectsFromSupabase() {
    showPortalLoading(true);
    try {
        const res  = await fetch('/api/projects');
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        currentProjects = json.data;
        projectsLoaded  = true;
    } catch (err) {
        console.error('[Nexora] load failed:', err);
        currentProjects = [];
        showPortalError(err.message);
    } finally {
        showPortalLoading(false);
    }
}
function parseSkills(raw) {
    if (!raw) return [];
    const str = String(raw).trim();
    if (str.startsWith('[')) { try { return JSON.parse(str); } catch (_) {} }
    return str.split(',').map(s => s.trim()).filter(Boolean);
}

function showPortalLoading(show) {
    const container = document.getElementById('portalJobsContainer');
    if (!show || !container) return;
    document.getElementById('portalResultCount')?.textContent != null &&
        (document.getElementById('portalResultCount').textContent = '…');
    document.getElementById('portalNoResults')?.classList.add('hidden');
    container.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:4rem 0;">
            <div style="display:inline-block;width:36px;height:36px;border:3px solid rgba(255,255,255,0.1);border-top-color:rgba(255,255,255,0.6);border-radius:50%;animation:nx-spin 0.7s linear infinite;"></div>
            <p style="color:rgba(255,255,255,0.5);margin-top:1rem;font-size:0.875rem;">Loading projects…</p>
        </div>
        <style>@keyframes nx-spin{to{transform:rotate(360deg)}}</style>
    `;
}

function showPortalError(msg) {
    const container = document.getElementById('portalJobsContainer');
    if (container) container.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:4rem 0;">
            <p style="color:#f87171;font-size:0.875rem;">⚠️ Could not load projects</p>
            <p style="color:rgba(255,255,255,0.4);font-size:0.75rem;margin-top:0.5rem;">${escapeHtml(msg)}</p>
        </div>
    `;
}

// ============================================
// UTILS
// ============================================
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function renderFAQs() {
    const container = document.getElementById('faq-container');
    if (!container) return;
    container.innerHTML = faqs.map((faq, i) => `
        <div class="faq-item" onclick="toggleFAQ(${i})">
            <div class="faq-question">
                ${faq.question}
                <svg class="faq-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div class="faq-answer">${faq.answer}</div>
        </div>
    `).join('');
}

window.toggleFAQ            = i => document.querySelectorAll('.faq-item')[i]?.classList.toggle('active');
window.showRolesForProject  = showRolesForProject;
window.goBackToProjects     = goBackToProjects;
window.applyForSpecificRole = applyForSpecificRole;
window.viewRequirements     = viewRequirements;

function applyForSpecificRole(project, roleId) {
    if (!currentUser) { alert('Please sign in first to apply for roles!'); openModalFunc(); return; }
    openApplyModal(project, roleId);
}

function viewRequirements(project) {
    if (!project.doc_url || project.doc_url === '#') { alert('Requirements document not available yet.'); return; }
    window.open(project.doc_url, '_blank');
}

// ============================================
// PAGE NAVIGATION
// ============================================
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    document.getElementById(pageId + 'Page')?.classList.add('active-page');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (pageId === 'jobPortal') {
        currentView             = 'projects';
        selectedProjectForRoles = null;
        currentCategory         = 'all';
        renderCategories();
        if (!projectsLoaded) {
            loadProjectsFromSupabase().then(() => { renderCategories(); renderPortalJobs(); });
        } else {
            renderPortalJobs();
        }
    }
}

function handleAboutClick(e) {
    e.preventDefault();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    document.getElementById('homePage').classList.add('active-page');
    setTimeout(() => {
        document.getElementById('meet-team')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
}

// ============================================
// BOOTSTRAP
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    setupAuth();
    setupProfileDropdown();
    setupApplyModal();

    // Firebase Auth State Listener
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        updateAuthUI(currentUser);
        
        // Sync user to Supabase only when user logs in and is new
        if (user) {
            await syncUserToSupabase(user);
        }
    });

    window.addEventListener('scroll', () => {
        document.getElementById('navbar')?.classList.toggle('navbar-scrolled', window.scrollY > 50);
    });

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const page = link.getAttribute('data-page');
            if (page === 'home')       showPage('home');
            else if (page === 'jobportal') showPage('jobPortal');
        });
    });

    document.querySelectorAll('.open-job-portal').forEach(btn => {
        btn.addEventListener('click', e => { e.preventDefault(); showPage('jobPortal'); });
    });

    const searchBtn   = document.getElementById('portalSearchBtn');
    const searchInput = document.getElementById('portalSearchInput');
    searchBtn?.addEventListener('click', () => {
        currentSearch = searchInput?.value || '';
        currentView === 'roles' && selectedProjectForRoles ? filterRolesByCategory() : renderPortalJobs();
    });
    searchInput?.addEventListener('keypress', e => {
        if (e.key !== 'Enter') return;
        currentSearch = e.target.value;
        currentView === 'roles' && selectedProjectForRoles ? filterRolesByCategory() : renderPortalJobs();
    });

    document.getElementById('aboutLink')?.addEventListener('click', handleAboutClick);
    document.getElementById('footerAboutLink')?.addEventListener('click', handleAboutClick);

    renderFAQs();
    renderCategories();
    loadProjectsFromSupabase().then(() => { renderCategories(); renderPortalJobs(); });
});
// ── MOBILE NAV ──
document.addEventListener('DOMContentLoaded', function () {
    var drawer = document.createElement('div');
    drawer.id = 'mobile-menu';
    drawer.innerHTML = `
        <a href="#" class="nav-link" data-page="home">Home</a>
        <a href="#" class="nav-link" data-page="jobportal">Job Portal</a>
        <a href="#" id="mobileAboutLink">About</a>
    `;
    var nav = document.getElementById('navbar');
    if (nav) nav.insertAdjacentElement('afterend', drawer);

    var btn   = document.getElementById('menu-btn');
    var menu  = document.getElementById('mobile-menu');
    var about = document.getElementById('mobileAboutLink');

    if (btn && menu) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = menu.classList.toggle('open');
            var paths = btn.querySelectorAll('path');
            if (isOpen) {
                if (paths[0]) paths[0].setAttribute('d', 'M6 18L18 6');
                if (paths[1]) paths[1].style.opacity = '0';
                if (paths[2]) paths[2].setAttribute('d', 'M6 6L18 18');
            } else {
                if (paths[0]) paths[0].setAttribute('d', 'M4 5h16');
                if (paths[1]) { paths[1].style.opacity = '1'; paths[1].setAttribute('d', 'M4 12h16'); }
                if (paths[2]) paths[2].setAttribute('d', 'M4 19h16');
            }
        });

        document.addEventListener('click', function () {
            menu.classList.remove('open');
            var paths = btn.querySelectorAll('path');
            if (paths[0]) paths[0].setAttribute('d', 'M4 5h16');
            if (paths[1]) { paths[1].style.opacity = '1'; paths[1].setAttribute('d', 'M4 12h16'); }
            if (paths[2]) paths[2].setAttribute('d', 'M4 19h16');
        });

        menu.addEventListener('click', function (e) { e.stopPropagation(); });
        menu.querySelectorAll('a').forEach(function (a) {
            a.addEventListener('click', function () { menu.classList.remove('open'); });
        });
    }

    if (about) {
        about.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active-page'); });
            document.getElementById('homePage').classList.add('active-page');
            menu.classList.remove('open');
            setTimeout(function () {
                var el = document.getElementById('meet-team');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 150);
        });
    }
});
import { auth, onAuthStateChanged, logOut, getCachedAuthState, cacheAuthState } from '../services/firebase';
import { getUserProfile, initUserProfile } from '../db';
import { initI18n, setLanguage, getCurrentLanguage, updatePageTranslations } from '../i18n';
import tier2Words from '../data/words-tier2-full';
import { setAvatar, generateAvatarUrl } from '../utils/avatar';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

let currentUser = null;
let currentLang = getCurrentLanguage();
let classes = [];

// Elements
const loadingOverlay = document.getElementById('loadingOverlay');
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar') as HTMLImageElement;
const userName = document.getElementById('userName');
const signOutBtn = document.getElementById('signOutBtn');

const totalClassesEl = document.getElementById('totalClasses');
const totalStudentsEl = document.getElementById('totalStudents');
const avgProgressEl = document.getElementById('avgProgress');

const classNameInput = document.getElementById('classNameInput') as HTMLInputElement;
const createClassBtn = document.getElementById('createClassBtn');
const classesGrid = document.getElementById('classesGrid');
const emptyState = document.getElementById('emptyState');

const classModal = document.getElementById('classModal');
const closeClassModal = document.getElementById('closeClassModal');
const classModalTitle = document.getElementById('classModalTitle');
const classCodeDisplay = document.getElementById('classCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const studentsList = document.getElementById('studentsList');
const studentCount = document.getElementById('studentCount');
const deleteClassBtn = document.getElementById('deleteClassBtn');

const studentModal = document.getElementById('studentModal');
const closeStudentModal = document.getElementById('closeStudentModal');
const studentAvatar = document.getElementById('studentAvatar') as HTMLImageElement;
const studentName = document.getElementById('studentName');
const studentEmail = document.getElementById('studentEmail');
const studentProgress = document.getElementById('studentProgress');

const toast = document.getElementById('toast');
const toastIcon = document.getElementById('toastIcon');
const toastTitle = document.getElementById('toastTitle');
const toastMessage = document.getElementById('toastMessage');

const fullscreenCodeBtn = document.getElementById('fullscreenCodeBtn');
const fullscreenCodeOverlay = document.getElementById('fullscreenCodeOverlay');
const closeFullscreenCode = document.getElementById('closeFullscreenCode');
const fullscreenCode = document.getElementById('fullscreenCode');

let currentClassId = null;
let currentStudentLearnedWords: any[] = [];
let currentStudentAllProgress: Record<string, string> = {};
let currentStudentWordTab = 'known';

// Initialize i18n
initI18n();
updatePageTranslations();

// Language selector
const languageBtn = document.getElementById('languageBtn');
const languageDropdown = document.getElementById('languageDropdown');
const languageOptions = document.querySelectorAll('.language-option');

const languages = {
    ru: { flag: '🇷🇺', code: 'RU' },
    en: { flag: '🇬🇧', code: 'EN' },
    zh: { flag: '🇨🇳', code: 'ZH' }
};

languageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    languageBtn.classList.toggle('active');
    languageDropdown.classList.toggle('active');
});

languageOptions.forEach(option => {
    option.addEventListener('click', (e) => {
        e.stopPropagation();
        const lang = option.dataset.lang;
        currentLang = lang;

        const flagSpan = languageBtn.querySelector('.flag');
        const langText = languageBtn.querySelector('.lang-text');
        flagSpan.textContent = languages[lang].flag;
        langText.textContent = languages[lang].code;

        languageOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        languageBtn.classList.remove('active');
        languageDropdown.classList.remove('active');

        setLanguage(lang);
        updatePageTranslations();
        localStorage.setItem('preferred-language', lang);
    });
});

// Show/hide loading
function showLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
}

// Toast notification
function showToast(title: string, message: string, type: 'success' | 'error' = 'success') {
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    toastIcon.textContent = type === 'success' ? '✓' : '✕';

    toast.classList.remove('toast-success', 'toast-error');
    toast.classList.add(type === 'success' ? 'toast-success' : 'toast-error');
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// User dropdown toggle
const userInfoTrigger = document.getElementById('userInfoTrigger');
const userDropdown = document.getElementById('userDropdown');

userInfoTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    userInfoTrigger.classList.toggle('active');
    userDropdown.classList.toggle('active');
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    // Close language dropdown
    languageBtn.classList.remove('active');
    languageDropdown.classList.remove('active');

    // Close user dropdown
    if (!userProfile?.contains(e.target as Node)) {
        userInfoTrigger?.classList.remove('active');
        userDropdown?.classList.remove('active');
    }
});

// Sign out
signOutBtn.addEventListener('click', async () => {
    try {
        await logOut();
        window.location.href = '/';
    } catch (error) {
        console.error('Sign out error:', error);
    }
});

// Create class
createClassBtn.addEventListener('click', async () => {
    const className = classNameInput.value.trim();

    if (!className) {
        showToast('Error', 'Please enter a class name', 'error');
        return;
    }

    try {
        createClassBtn.setAttribute('disabled', 'true');
        createClassBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

        const response = await fetch(`${API_URL}/classes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teacherUid: currentUser.uid,
                className: className
            })
        });

        if (!response.ok) throw new Error('Failed to create class');

        const newClass = await response.json();
        classes.push(newClass);

        classNameInput.value = '';
        renderClasses();
        updateStats();
        showToast('Success', `Class "${className}" created successfully!`);

        createClassBtn.removeAttribute('disabled');
        createClassBtn.innerHTML = '<i class="fas fa-plus"></i> <span data-i18n="dashboard.createBtn">Create Class</span>';
    } catch (error) {
        console.error('Error creating class:', error);
        showToast('Error', 'Failed to create class', 'error');
        createClassBtn.removeAttribute('disabled');
        createClassBtn.innerHTML = '<i class="fas fa-plus"></i> <span data-i18n="dashboard.createBtn">Create Class</span>';
    }
});

// Load teacher's classes
async function loadClasses() {
    try {
        const response = await fetch(`${API_URL}/classes/teacher/${currentUser.uid}`);
        if (!response.ok) throw new Error('Failed to load classes');

        classes = await response.json();
        renderClasses();
        updateStats();
    } catch (error) {
        console.error('Error loading classes:', error);
        showToast('Error', 'Failed to load classes', 'error');
    }
}

// Render classes
function renderClasses() {
    if (classes.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    classesGrid.innerHTML = classes.map(cls => `
        <div class="class-card" data-class-id="${cls.id}">
            <div class="class-header">
                <h3>${cls.class_name}</h3>
                <div class="class-code">
                    <i class="fas fa-key"></i>
                    <code>${cls.class_code}</code>
                </div>
            </div>
            <div class="class-stats">
                <div class="class-stat">
                    <i class="fas fa-users"></i>
                    <span>${cls.student_count} students</span>
                </div>
                <div class="class-stat">
                    <i class="fas fa-calendar"></i>
                    <span>${new Date(cls.created_at).toLocaleDateString()}</span>
                </div>
            </div>
            <button class="btn-view" onclick="window.viewClass(${cls.id})">
                <i class="fas fa-eye"></i>
                <span data-i18n="dashboard.viewDetails">View Details</span>
            </button>
        </div>
    `).join('');
}

// Update stats
function updateStats() {
    const totalClasses = classes.length;
    const totalStudents = classes.reduce((sum, cls) => sum + parseInt(cls.student_count), 0);

    totalClassesEl.textContent = totalClasses.toString();
    totalStudentsEl.textContent = totalStudents.toString();
    avgProgressEl.textContent = '0%'; // TODO: Calculate average progress
}

// View class details
async function viewClass(classId: number) {
    currentClassId = classId;

    try {
        const response = await fetch(`${API_URL}/classes/${classId}`);
        if (!response.ok) throw new Error('Failed to load class');

        const data = await response.json();

        classModalTitle.textContent = data.class.class_name;
        classCodeDisplay.textContent = data.class.class_code;
        studentCount.textContent = data.students.length.toString();

        if (data.students.length === 0) {
            studentsList.innerHTML = '<div class="empty-state-small">No students have joined yet</div>';
        } else {
            studentsList.innerHTML = data.students.map(student => `
                <div class="student-item" onclick="window.viewStudentProgress('${student.uid}', '${student.display_name || student.email}', '${student.photo_url || ''}', '${student.email}')">
                    <img src="${student.photo_url || generateAvatarUrl(student.display_name || student.email, 40)}" alt="${student.display_name || student.email}">
                    <div class="student-info">
                        <div class="student-name">${student.display_name || student.email}</div>
                        <div class="student-joined">Joined: ${new Date(student.joined_at).toLocaleDateString()}</div>
                    </div>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `).join('');
        }

        classModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.error('Error viewing class:', error);
        showToast('Error', 'Failed to load class details', 'error');
    }
}

// Copy class code
copyCodeBtn.addEventListener('click', async () => {
    const code = classCodeDisplay.textContent;
    try {
        await navigator.clipboard.writeText(code);
        showToast('Copied', `Class code ${code} copied to clipboard!`);

        copyCodeBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            copyCodeBtn.innerHTML = '<i class="fas fa-copy"></i>';
        }, 2000);
    } catch (error) {
        console.error('Error copying code:', error);
        showToast('Error', 'Failed to copy code', 'error');
    }
});

// Fullscreen class code
fullscreenCodeBtn.addEventListener('click', () => {
    const code = classCodeDisplay.textContent;
    fullscreenCode.textContent = code;
    fullscreenCodeOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
});

// Close fullscreen code
closeFullscreenCode.addEventListener('click', () => {
    fullscreenCodeOverlay.style.display = 'none';
    document.body.style.overflow = '';
});

fullscreenCodeOverlay.addEventListener('click', (e) => {
    if (e.target === fullscreenCodeOverlay) {
        fullscreenCodeOverlay.style.display = 'none';
        document.body.style.overflow = '';
    }
});

// Delete class
deleteClassBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete this class? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/classes/${currentClassId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete class');

        classes = classes.filter(cls => cls.id !== currentClassId);
        renderClasses();
        updateStats();

        classModal.style.display = 'none';
        document.body.style.overflow = '';

        showToast('Success', 'Class deleted successfully');
    } catch (error) {
        console.error('Error deleting class:', error);
        showToast('Error', 'Failed to delete class', 'error');
    }
});

// View student progress
async function viewStudentProgress(uid: string, name: string, photoUrl: string, email: string) {
    try {
        setAvatar(studentAvatar, photoUrl, name, 80);
        studentName.textContent = name;
        studentEmail.textContent = email;

        // Reset period filter
        document.querySelectorAll('.s-period-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.s-period-btn[data-period="today"]')?.classList.add('active');

        // Load all data in parallel
        const [progressData, learnedData, allProgressData] = await Promise.all([
            fetch(`${API_URL}/classes/student/${uid}/progress`).then(r => r.json()),
            fetch(`${API_URL}/progress/${uid}/tier2/learned`).then(r => r.json()).catch(() => ({ words: [] })),
            fetch(`${API_URL}/progress/${uid}/tier2`).then(r => r.json()).catch(() => ({ words: {} }))
        ]);

        // Store data globally
        currentStudentLearnedWords = learnedData.words || [];
        currentStudentAllProgress = allProgressData.words || {};

        // Aggregate stats across all tiers
        let totalKnown = 0, totalUnsure = 0, totalUnknown = 0;
        progressData.forEach(item => {
            if (item.status === 'known') totalKnown += parseInt(item.count);
            else if (item.status === 'unsure') totalUnsure += parseInt(item.count);
            else if (item.status === 'unknown') totalUnknown += parseInt(item.count);
        });
        const totalWords = totalKnown + totalUnsure + totalUnknown;

        // Update stats cards
        document.getElementById('studentKnown').textContent = String(totalKnown);
        document.getElementById('studentUnsure').textContent = String(totalUnsure);
        document.getElementById('studentUnknown').textContent = String(totalUnknown);
        document.getElementById('studentLearned').textContent = String(currentStudentLearnedWords.length);

        // Update progress bar
        if (totalWords > 0) {
            const kPct = Math.round((totalKnown / totalWords) * 100);
            const uPct = Math.round((totalUnsure / totalWords) * 100);
            const unPct = 100 - kPct - uPct;
            document.getElementById('spbKnown').style.width = `${kPct}%`;
            document.getElementById('spbUnsure').style.width = `${uPct}%`;
            document.getElementById('spbUnknown').style.width = `${unPct}%`;
        }

        // Update learned count for "today" period
        updateStudentLearnedPeriod('today');

        // Init word tabs
        currentStudentWordTab = 'known';
        document.querySelectorAll('.sw-tab').forEach(b => b.classList.remove('active'));
        document.querySelector('.sw-tab[data-tab="known"]')?.classList.add('active');

        // Update tab counts
        const learnedIds = new Set(currentStudentLearnedWords.map(w => w.word_id));
        document.getElementById('swCountKnown').textContent = String(Object.values(currentStudentAllProgress).filter(s => s === 'known').length);
        document.getElementById('swCountUnsure').textContent = String(Object.values(currentStudentAllProgress).filter(s => s === 'unsure').length);
        document.getElementById('swCountUnknown').textContent = String(Object.values(currentStudentAllProgress).filter(s => s === 'unknown').length);
        document.getElementById('swCountLearned').textContent = String(currentStudentLearnedWords.length);

        renderStudentWords('known');

        // Load sessions
        loadStudentSessions(uid);

        studentModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.error('Error loading student progress:', error);
        showToast('Error', 'Failed to load student progress', 'error');
    }
}

function updateStudentLearnedPeriod(period: string) {
    const now = new Date();
    let cutoff: Date | null = null;
    let cutoffEnd: Date | null = null;

    if (period === 'today') {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'yesterday') {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        cutoffEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const filtered = cutoff
        ? currentStudentLearnedWords.filter(w => {
            const d = new Date(w.changed_at || w.learned_at);
            return d >= cutoff && (cutoffEnd === null || d < cutoffEnd);
          })
        : currentStudentLearnedWords;

    document.getElementById('studentLearnedCount').textContent = String(filtered.length);
}

function renderStudentWords(tab: string) {
    currentStudentWordTab = tab;
    const container = document.getElementById('swWordsList');
    if (!container) return;

    let words: { id: string; en: string; ru: string }[] = [];

    if (tab === 'learned') {
        const learnedIds = new Set(currentStudentLearnedWords.map(w => w.word_id));
        words = tier2Words.filter(w => learnedIds.has(w.id));
    } else {
        words = tier2Words.filter(w => currentStudentAllProgress[w.id] === tab);
    }

    if (words.length === 0) {
        container.innerHTML = '<div class="sessions-empty">No words in this category</div>';
        return;
    }

    const colors = { known: 'sw-known', learned: 'sw-learned', unsure: 'sw-unsure', unknown: 'sw-unknown' };
    const colorClass = colors[tab] || '';

    container.innerHTML = words.map(w => `
        <div class="sw-word-item ${colorClass}">
            <span class="sw-word-en">${w.en}</span>
            <span class="sw-word-ru">${w.ru}</span>
        </div>
    `).join('');
}

// Word tabs for student modal
document.querySelectorAll('.sw-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.sw-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderStudentWords((btn as HTMLElement).dataset.tab);
    });
});

// Period filter buttons for student modal
document.querySelectorAll('.s-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.s-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateStudentLearnedPeriod((btn as HTMLElement).dataset.period);
    });
});

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

async function loadStudentSessions(uid: string) {
    const sessionsList = document.getElementById('studentSessionsList');
    const sessionStats = document.getElementById('studentSessionStats');

    try {
        const [sessions, stats] = await Promise.all([
            fetch(`${API_URL}/sessions/${uid}`).then(r => r.json()),
            fetch(`${API_URL}/sessions/${uid}/stats`).then(r => r.json())
        ]);

        if (stats && parseInt(stats.total_sessions) > 0) {
            sessionStats.style.display = 'flex';
            document.getElementById('studentTotalTime').textContent = formatDuration(parseInt(stats.total_seconds));
            document.getElementById('studentTotalSessions').textContent = stats.total_sessions;
            document.getElementById('studentCompletedSessions').textContent = stats.completed_sessions;
        } else {
            sessionStats.style.display = 'none';
        }

        if (!sessions || sessions.length === 0) {
            sessionsList.innerHTML = '<div class="sessions-empty">No sessions yet</div>';
            return;
        }

        sessionsList.innerHTML = sessions.slice(0, 8).map(s => {
            const date = new Date(s.started_at);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="session-card ${s.completed ? 'session-completed' : 'session-partial'}">
                    <div class="session-card-left">
                        <div class="session-status-dot ${s.completed ? 'dot-complete' : 'dot-partial'}"></div>
                        <div>
                            <div class="session-date">${dateStr} · ${timeStr}</div>
                            <div class="session-tier">${s.completed ? 'Completed' : 'Partial'}</div>
                        </div>
                    </div>
                    <div class="session-card-right">
                        <div class="session-stat">
                            <span>🕐 ${formatDuration(s.duration_seconds)}</span>
                        </div>
                        <div class="session-mini-stats">
                            <span class="mini-known">✓${s.known_count}</span>
                            <span class="mini-unsure">?${s.unsure_count}</span>
                            <span class="mini-unknown">✗${s.unknown_count}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading student sessions:', error);
        sessionsList.innerHTML = '<div class="sessions-empty">Failed to load sessions</div>';
    }
}

// Close modals
closeClassModal.addEventListener('click', () => {
    classModal.style.display = 'none';
    document.body.style.overflow = '';
});

closeStudentModal.addEventListener('click', () => {
    studentModal.style.display = 'none';
    document.body.style.overflow = '';
});

classModal.addEventListener('click', (e) => {
    if (e.target === classModal) {
        classModal.style.display = 'none';
        document.body.style.overflow = '';
    }
});

studentModal.addEventListener('click', (e) => {
    if (e.target === studentModal) {
        studentModal.style.display = 'none';
        document.body.style.overflow = '';
    }
});

// ============ ASSIGNMENTS ============

const assignmentsList = document.getElementById('assignmentsList');
const assignmentsEmpty = document.getElementById('assignmentsEmpty');

// Navigate to create assignment page
document.getElementById('createAssignmentBtn')?.addEventListener('click', () => {
    window.location.href = '/create-assignment.html';
});

async function loadAssignments() {
    if (!currentUser) return;
    try {
        const assignments = await fetch(`${API_URL}/assignments/teacher/${currentUser.uid}`).then(r => r.json());

        if (!assignments.length) {
            assignmentsEmpty.style.display = 'block';
            assignmentsList.innerHTML = '';
            assignmentsList.appendChild(assignmentsEmpty);
            return;
        }

        assignmentsEmpty.style.display = 'none';
        const now = new Date();

        assignmentsList.innerHTML = assignments.map(a => {
            const due = new Date(a.due_date);
            const overdue = due < now;
            const dueStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const target = a.type === 'words' ? `${a.target} words` : `${a.target} min`;
            const icon = a.type === 'words' ? '📚' : '⏱';
            const scope = a.class_name ? `Class: ${a.class_name}` : `Student: ${a.student_name || 'Individual'}`;

            return `
            <div class="assignment-card ${overdue ? 'overdue' : ''}">
                <div class="asgn-left">
                    <div class="asgn-icon">${icon}</div>
                    <div class="asgn-info">
                        <div class="asgn-title">${a.title}</div>
                        <div class="asgn-meta">${scope} · ${target}</div>
                        ${a.description ? `<div class="asgn-desc">${a.description}</div>` : ''}
                    </div>
                </div>
                <div class="asgn-right">
                    <div class="asgn-due ${overdue ? 'asgn-overdue' : ''}">
                        ${overdue ? '⚠ Overdue' : '📅 Due'} ${dueStr}
                    </div>
                    <button class="asgn-progress-btn" onclick="window.viewAssignmentProgress(${a.id})">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        Прогресс
                    </button>
                    <button class="asgn-delete" onclick="window.deleteAssignment(${a.id})">✕</button>
                </div>
            </div>`;
        }).join('');
    } catch (error) {
        console.error('Error loading assignments:', error);
    }
}

async function deleteAssignment(id: number) {
    if (!confirm('Delete this assignment?')) return;
    try {
        await fetch(`${API_URL}/assignments/${id}`, { method: 'DELETE' });
        loadAssignments();
        showToast('Deleted', 'Assignment removed');
    } catch {
        showToast('Error', 'Failed to delete assignment', 'error');
    }
}

(window as any).deleteAssignment = deleteAssignment;

// View assignment progress modal
async function viewAssignmentProgress(id: number) {
    const modal = document.getElementById('assignmentProgressModal');
    const title = document.getElementById('apModalTitle');
    const body = document.getElementById('apModalBody');

    title.textContent = 'Загрузка...';
    body.innerHTML = '<div class="ap-loading"><div class="ap-spinner"></div><span>Загрузка данных...</span></div>';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    try {
        const data = await fetch(`${API_URL}/assignments/${id}/progress`).then(r => r.json());
        const a = data.assignment;
        const students = data.students;

        const unit = a.type === 'words' ? 'слов' : 'мин';
        title.textContent = a.title;

        if (students.length === 0) {
            body.innerHTML = '<div class="ap-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>Нет студентов в этом задании</p></div>';
            return;
        }

        const done = students.filter(s => s.done);
        const notDone = students.filter(s => !s.done);
        const completionRate = Math.round((done.length / students.length) * 100);

        body.innerHTML = `
            <div class="ap-stats-grid">
                <div class="ap-stat-card ap-stat-total">
                    <div class="ap-stat-number">${students.length}</div>
                    <div class="ap-stat-label">Всего</div>
                </div>
                <div class="ap-stat-card ap-stat-done">
                    <div class="ap-stat-number">${done.length}</div>
                    <div class="ap-stat-label">Выполнили</div>
                </div>
                <div class="ap-stat-card ap-stat-pending">
                    <div class="ap-stat-number">${notDone.length}</div>
                    <div class="ap-stat-label">В процессе</div>
                </div>
                <div class="ap-stat-card ap-stat-rate">
                    <div class="ap-stat-number">${completionRate}%</div>
                    <div class="ap-stat-label">Завершено</div>
                </div>
            </div>
            <div class="ap-overall-bar">
                <div class="ap-overall-fill" style="width:${completionRate}%"></div>
            </div>
            <div class="ap-students">
                ${students.sort((a, b) => b.percent - a.percent).map(s => `
                    <div class="ap-student-row ${s.done ? 'ap-row-done' : ''}">
                        <img src="${s.photo_url || generateAvatarUrl(s.display_name || s.email, 40)}" class="ap-avatar">
                        <div class="ap-student-info">
                            <div class="ap-student-name">${s.display_name || s.email}</div>
                            <div class="ap-progress-bar-wrap">
                                <div class="ap-progress-bar">
                                    <div class="ap-progress-fill ${s.done ? 'ap-fill-done' : ''}" style="width:${s.percent}%"></div>
                                </div>
                                <span class="ap-progress-label">${s.current} / ${s.target} ${unit}</span>
                            </div>
                        </div>
                        <div class="ap-status-badge ${s.done ? 'ap-badge-done' : 'ap-badge-pending'}">
                            ${s.done ? 'Готово' : s.percent + '%'}
                        </div>
                    </div>
                `).join('')}
            </div>`;
    } catch (error) {
        body.innerHTML = '<div class="ap-error"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>Ошибка загрузки данных</p></div>';
    }
}

(window as any).viewAssignmentProgress = viewAssignmentProgress;

// Global functions for onclick handlers
(window as any).viewClass = viewClass;
(window as any).viewStudentProgress = viewStudentProgress;

// Close assignment progress modal
document.getElementById('closeApModal')?.addEventListener('click', () => {
    document.getElementById('assignmentProgressModal').style.display = 'none';
    document.body.style.overflow = '';
});
document.getElementById('assignmentProgressModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('assignmentProgressModal')) {
        document.getElementById('assignmentProgressModal').style.display = 'none';
        document.body.style.overflow = '';
    }
});

// Auth state
showLoading();

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        cacheAuthState(user);

        userProfile.style.display = 'flex';
        setAvatar(userAvatar, user.photoURL, user.displayName || user.email, 36);
        userName.textContent = user.displayName || user.email;

        // Ensure user exists in database
        await initUserProfile(user);

        // Check if user is a teacher
        const userData = await getUserProfile(user.uid);
        if (userData.role !== 'teacher') {
            alert('Access denied. This page is for teachers only.');
            window.location.href = '/';
            return;
        }

        // Load classes and assignments
        await loadClasses();
        await loadAssignments();
        hideLoading();
    } else {
        alert('Please sign in to access the teacher dashboard');
        window.location.href = '/';
    }
});

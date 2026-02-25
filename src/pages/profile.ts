import { auth, onAuthStateChanged, logOut, getCachedAuthState, cacheAuthState } from '../services/firebase';
import { getUserNativeLanguage, getUserProfile, getProgress, initUserProfile, getSessions, getSessionStats, getLearnedWords, getStreak } from '../db';
import { initI18n, setLanguage, getCurrentLanguage, updatePageTranslations } from '../i18n';
import { setAvatar } from '../utils/avatar';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

let currentUser = null;
let currentLang = getCurrentLanguage();
let allSessions: any[] = [];
let allLearnedWords: any[] = [];

// Loading overlay
const loadingOverlay = document.getElementById('loadingOverlay');

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

function showLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }
}

// Elements
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const signOutBtn = document.getElementById('signOutBtn');

const profileAvatar = document.getElementById('profileAvatar');
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const roleBadge = document.getElementById('roleBadge');
const nativeLanguageBadge = document.getElementById('nativeLanguageBadge');
const memberDate = document.getElementById('memberDate');
const lastLogin = document.getElementById('lastLogin');
const lastUpdated = document.getElementById('lastUpdated');
const profileHeader = document.querySelector('.profile-header');

// Show skeleton loaders initially
function showSkeletonLoaders() {
    profileHeader.classList.add('loading');
    profileAvatar.style.display = 'none';
    profileName.innerHTML = '<div class="skeleton skeleton-text large"></div>';
    profileEmail.innerHTML = '<div class="skeleton skeleton-text medium"></div>';
}

// Hide skeleton loaders
function hideSkeletonLoaders() {
    profileHeader.classList.remove('loading');
    profileAvatar.style.display = 'block';
}

// Initialize with skeleton loaders
showSkeletonLoaders();

const totalWordsReviewed = document.getElementById('totalWordsReviewed');
const knownWords = document.getElementById('knownWords');
const unsureWords = document.getElementById('unsureWords');
const unknownWords = document.getElementById('unknownWords');

const knownSegment = document.getElementById('knownSegment');
const unsureSegment = document.getElementById('unsureSegment');
const unknownSegment = document.getElementById('unknownSegment');
const knownPercent = document.getElementById('knownPercent');
const unsurePercent = document.getElementById('unsurePercent');
const unknownPercent = document.getElementById('unknownPercent');

const knownCount = document.getElementById('knownCount');
const unsureCount = document.getElementById('unsureCount');
const unknownCount = document.getElementById('unknownCount');

// Language selector
const languageBtn = document.getElementById('languageBtn');
const languageDropdown = document.getElementById('languageDropdown');
const languageOptions = document.querySelectorAll('.language-option');

const languages = {
    ru: { flag: '🇷🇺', code: 'RU' },
    en: { flag: '🇬🇧', code: 'EN' },
    zh: { flag: '🇨🇳', code: 'ZH' }
};

// Initialize language
const savedLang = localStorage.getItem('preferred-language');
if (savedLang && languages[savedLang]) {
    const flagSpan = languageBtn.querySelector('.flag');
    const langText = languageBtn.querySelector('.lang-text');
    flagSpan.textContent = languages[savedLang].flag;
    langText.textContent = languages[savedLang].code;
    currentLang = savedLang;
}

// Language selector events
languageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    languageBtn.classList.toggle('active');
    languageDropdown.classList.toggle('active');
});

document.addEventListener('click', () => {
    languageBtn.classList.remove('active');
    languageDropdown.classList.remove('active');
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
        updateRoleAndLanguageBadges();
    });
});

// Initialize translations
initI18n();
updatePageTranslations();

// Dropdown toggle
const userInfoTrigger = document.getElementById('userInfoTrigger');
const userDropdown = document.getElementById('userDropdown');

userInfoTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    userInfoTrigger.classList.toggle('active');
    userDropdown.classList.toggle('active');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!userProfile?.contains(e.target)) {
        userInfoTrigger?.classList.remove('active');
        userDropdown?.classList.remove('active');
    }
});

// Show cached user immediately
const cachedAuth = getCachedAuthState();
if (cachedAuth) {
    userProfile.style.display = 'flex';
    setAvatar(userAvatar as HTMLImageElement, cachedAuth.photoURL, cachedAuth.displayName || cachedAuth.email, 36);
    userName.textContent = cachedAuth.displayName || cachedAuth.email;

    // Also fill profile info immediately
    setAvatar(profileAvatar as HTMLImageElement, cachedAuth.photoURL, cachedAuth.displayName || cachedAuth.email, 120);
    profileName.textContent = cachedAuth.displayName || cachedAuth.email;
    profileEmail.textContent = cachedAuth.email;
}

// Sign out button
signOutBtn.addEventListener('click', async () => {
    try {
        await logOut();
        window.location.href = '/';
    } catch (error) {
        console.error('Sign out error:', error);
    }
});

// Format date
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString(currentLang === 'zh' ? 'zh-CN' : currentLang === 'ru' ? 'ru-RU' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString(currentLang === 'zh' ? 'zh-CN' : currentLang === 'ru' ? 'ru-RU' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Update role and language badges
function updateRoleAndLanguageBadges() {
    const roleText = roleBadge.querySelector('.badge-text');
    const langText = nativeLanguageBadge.querySelector('.badge-text');

    if (currentUser && currentUser.role) {
        if (currentUser.role === 'teacher') {
            roleBadge.querySelector('.badge-icon').textContent = '👨‍🏫';
            roleText.setAttribute('data-i18n', 'profile.teacher');
        } else {
            roleBadge.querySelector('.badge-icon').textContent = '👨‍🎓';
            roleText.setAttribute('data-i18n', 'profile.student');
        }
    }

    if (currentUser && currentUser.nativeLanguage) {
        const nativeLangFlags = {
            'ru': '🇷🇺',
            'zh': '🇨🇳',
            'en': '🇬🇧'
        };
        const nativeLangI18nKeys = {
            'ru': 'profile.nativeRussian',
            'zh': 'profile.nativeChinese',
            'en': 'profile.nativeEnglish'
        };
        const nativeLangFlag = nativeLangFlags[currentUser.nativeLanguage] || '🇷🇺';
        const nativeLangI18nKey = nativeLangI18nKeys[currentUser.nativeLanguage] || 'profile.nativeRussian';

        nativeLanguageBadge.querySelector('.badge-icon').textContent = nativeLangFlag;
        langText.setAttribute('data-i18n', nativeLangI18nKey);
    }

    // Update translations after changing data-i18n attributes
    updatePageTranslations();
}

// Load user profile data
async function loadUserProfile() {
    if (!currentUser) {
        console.log('No currentUser in loadUserProfile');
        return;
    }

    console.log('Loading profile for user:', currentUser.uid);

    try {
        // Load user document
        const userData = await getUserProfile(currentUser.uid);
        console.log('User data loaded:', userData);

        if (userData) {
            // Store user data
            currentUser.role = userData.role || 'student';
            currentUser.nativeLanguage = userData.native_language || 'ru';

            // Hide skeleton loaders and update profile header
            hideSkeletonLoaders();
            setAvatar(profileAvatar as HTMLImageElement, currentUser.photoURL, currentUser.displayName || currentUser.email, 120);
            profileName.textContent = currentUser.displayName || currentUser.email;
            profileEmail.textContent = currentUser.email;

            // Update badges
            updateRoleAndLanguageBadges();

            // Update dates
            memberDate.textContent = formatDate(userData.created_at);
            lastLogin.textContent = formatDateTime(userData.last_login);

            // Show dashboard link for teachers
            if (currentUser.role === 'teacher') {
                const dashboardLink = document.getElementById('dashboardLink');
                if (dashboardLink) {
                    dashboardLink.style.display = 'flex';
                }
            }

            // Load progress
            await loadProgress();

            // Load sessions
            loadSessions();

            // Load assignments for students
            if (currentUser.role === 'student') {
                loadAssignments();
            }

            // Show classes section for students
            if (currentUser.role === 'student') {
                myClassesSection.style.display = 'block';
                loadStudentClasses();
            }
        }
    } catch (error) {
        console.error('Error loading user profile:', error);
        hideSkeletonLoaders();
    }
}

// Load progress statistics
async function loadProgress() {
    console.log('Loading progress for user:', currentUser?.uid);
    try {
        const data = await getProgress(currentUser.uid, 'tier2');
        console.log('Progress data:', data);
        const words = data.words || {};

        let known = 0;
        let unsure = 0;
        let unknown = 0;

        Object.values(words).forEach(status => {
            if (status === 'known') known++;
            else if (status === 'unsure') unsure++;
            else if (status === 'unknown') unknown++;
        });

        const total = known + unsure + unknown;

        // Update statistics
        totalWordsReviewed.textContent = total;
        knownWords.textContent = known;
        unsureWords.textContent = unsure;
        unknownWords.textContent = unknown;

        // Update quick access counts
        knownCount.textContent = known;
        unsureCount.textContent = unsure;
        unknownCount.textContent = unknown;

        // Enable quiz button if there are unsure or unknown words
        const takeQuizCard = document.getElementById('takeQuizCard');
        const quizSubtext = document.getElementById('quizSubtext');
        const quizWordsCount = unsure + unknown;

        if (quizWordsCount > 0) {
            takeQuizCard.classList.remove('quiz-disabled');
            quizSubtext.textContent = `${quizWordsCount} words available`;

            // Set up quiz navigation
            takeQuizCard.addEventListener('click', (e) => {
                e.preventDefault();
                // Store words to quiz in sessionStorage
                const wordsToQuiz = Object.keys(words).filter(wordId =>
                    words[wordId] === 'unsure' || words[wordId] === 'unknown'
                );
                sessionStorage.setItem('quizWords', JSON.stringify(wordsToQuiz));
                sessionStorage.setItem('quizStatus', 'mixed');
                window.location.href = '/quiz';
            });
        } else {
            takeQuizCard.classList.add('quiz-disabled');
            quizSubtext.textContent = 'No words available';
        }

        // Update progress bar
        if (total > 0) {
            const knownPct = Math.round((known / total) * 100);
            const unsurePct = Math.round((unsure / total) * 100);
            const unknownPct = 100 - knownPct - unsurePct;

            knownSegment.style.width = `${knownPct}%`;
            unsureSegment.style.width = `${unsurePct}%`;
            unknownSegment.style.width = `${unknownPct}%`;

            knownPercent.textContent = `${knownPct}%`;
            unsurePercent.textContent = `${unsurePct}%`;
            unknownPercent.textContent = `${unknownPct}%`;

            // Hide labels for segments that are too small
            if (knownPct < 10) knownPercent.style.display = 'none';
            if (unsurePct < 10) unsurePercent.style.display = 'none';
            if (unknownPct < 10) unknownPercent.style.display = 'none';
        }

        // Update last updated
        if (data.lastUpdated) {
            lastUpdated.textContent = formatDateTime(data.lastUpdated);
        }
    } catch (error) {
        console.error('Error loading progress:', error);
    }
}

// Timeout fallback - if Firebase doesn't respond in 500ms, use cached data
let authResolved = false;
setTimeout(() => {
    if (!authResolved) {
        console.log('Firebase auth timeout, using cached data');
        const cached = getCachedAuthState();
        if (cached && cached.uid) {
            currentUser = { uid: cached.uid, email: cached.email, displayName: cached.displayName, photoURL: cached.photoURL };
            loadUserProfile().then(() => hideLoading());
        } else {
            hideLoading();
            alert('Пожалуйста, войдите в систему');
            window.location.href = '/';
        }
    }
}, 500);

// Auth
onAuthStateChanged(auth, async (user) => {
    authResolved = true;
    if (user) {
        currentUser = user;
        cacheAuthState(user);
        userProfile.style.display = 'flex';
        setAvatar(userAvatar as HTMLImageElement, user.photoURL, user.displayName || user.email, 36);
        userName.textContent = user.displayName || user.email;

        // Ensure user exists in PostgreSQL
        try {
            await initUserProfile(user);
        } catch (error) {
            console.error('Error initializing user profile:', error);
        }

        // Get user's native language and set it automatically
        const nativeLang = await getUserNativeLanguage(user.uid);
        if (nativeLang) {
            currentLang = nativeLang;
            setLanguage(nativeLang);
            updatePageTranslations();

            // Update language selector UI
            const flagSpan = languageBtn.querySelector('.flag');
            const langText = languageBtn.querySelector('.lang-text');
            flagSpan.textContent = languages[nativeLang].flag;
            langText.textContent = languages[nativeLang].code;

            // Update selected option
            languageOptions.forEach(opt => {
                if (opt.dataset.lang === nativeLang) {
                    opt.classList.add('selected');
                } else {
                    opt.classList.remove('selected');
                }
            });
        }

        await loadUserProfile();
        hideLoading();
    } else {
        console.log('No user detected in onAuthStateChanged');
        const cached = getCachedAuthState();
        console.log('Cached auth:', cached);

        // Try to use cached user
        if (cached && cached.uid) {
            console.log('Using cached user data');
            currentUser = { uid: cached.uid, email: cached.email, displayName: cached.displayName, photoURL: cached.photoURL };
            userProfile.style.display = 'flex';
            setAvatar(userAvatar as HTMLImageElement, cached.photoURL, cached.displayName || cached.email, 36);
            userName.textContent = cached.displayName || cached.email;

            await loadUserProfile();
            hideLoading();
        } else {
            cacheAuthState(null);
            alert('Please sign in to view your profile');
            window.location.href = '/';
        }
    }
});

// ============ STUDENT CLASS MANAGEMENT ============

const myClassesSection = document.getElementById('myClassesSection');
const classCodeInput = document.getElementById('classCodeInput') as HTMLInputElement;
const joinClassBtn = document.getElementById('joinClassBtn');
const studentClassesList = document.getElementById('studentClassesList');

// Load student classes
async function loadStudentClasses() {
    if (!currentUser || !currentUser.role || currentUser.role !== 'student') {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/classes/student/${currentUser.uid}`);
        if (!response.ok) throw new Error('Failed to load classes');

        const classes = await response.json();

        if (classes.length === 0) {
            studentClassesList.innerHTML = '<div class="empty-state-small">You haven\'t joined any classes yet. Enter a class code above to join!</div>';
        } else {
            studentClassesList.innerHTML = classes.map(cls => `
                <div class="student-class-card">
                    <div class="class-info">
                        <h3>${cls.class_name}</h3>
                        <p class="teacher-name">Teacher: ${cls.teacher_name}</p>
                        <div class="class-code-badge">
                            <i class="fas fa-key"></i>
                            <code>${cls.class_code}</code>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading student classes:', error);
    }
}

// Join class
joinClassBtn?.addEventListener('click', async () => {
    const classCode = classCodeInput.value.trim().toUpperCase();

    if (!classCode || classCode.length !== 6) {
        alert('Please enter a valid 6-character class code');
        return;
    }

    try {
        joinClassBtn.setAttribute('disabled', 'true');
        joinClassBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';

        const response = await fetch(`${API_URL}/classes/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                studentUid: currentUser.uid,
                classCode: classCode
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to join class');
        }

        classCodeInput.value = '';
        await loadStudentClasses();
        alert(`Successfully joined class!`);

        joinClassBtn.removeAttribute('disabled');
        joinClassBtn.innerHTML = '<i class="fas fa-plus"></i> <span data-i18n="profile.joinClass">Join Class</span>';
    } catch (error) {
        console.error('Error joining class:', error);
        alert(error.message || 'Failed to join class. Please check the code and try again.');

        joinClassBtn.removeAttribute('disabled');
        joinClassBtn.innerHTML = '<i class="fas fa-plus"></i> <span data-i18n="profile.joinClass">Join Class</span>';
    }
});

// Classes section will be shown in loadUserProfile() based on user role

// ============ SESSIONS ============

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

async function loadSessions() {
    if (!currentUser) return;

    const sessionsList = document.getElementById('sessionsList');
    const sessionsTotalStats = document.getElementById('sessionsTotalStats');

    try {
        const [sessions, stats, streakData] = await Promise.all([
            getSessions(currentUser.uid),
            getSessionStats(currentUser.uid),
            getStreak(currentUser.uid)
        ]);

        // Show streak stats
        if (streakData) {
            document.getElementById('currentStreak').textContent = streakData.current_streak || 0;
            document.getElementById('longestStreak').textContent = streakData.longest_streak || 0;
        }

        // Show stats if there are sessions
        if (stats && parseInt(stats.total_sessions) > 0) {
            sessionsTotalStats.style.display = 'flex';
            document.getElementById('totalStudyTime').textContent = formatDuration(parseInt(stats.total_seconds));
            document.getElementById('totalSessionsCount').textContent = stats.total_sessions;
            document.getElementById('completedSessionsCount').textContent = stats.completed_sessions;
        }

        // Save sessions globally for period filtering
        allSessions = sessions || [];

        // Load learned words for period filtering
        try {
            const learnedData = await getLearnedWords(currentUser.uid, 'tier2');
            allLearnedWords = learnedData.words || [];
        } catch (e) {
            allLearnedWords = [];
        }

        updateLearnedStats('today');

        if (!sessions || sessions.length === 0) {
            sessionsList.innerHTML = '<div class="sessions-empty">No sessions yet. Start learning to track your progress!</div>';
            return;
        }

        sessionsList.innerHTML = sessions.slice(0, 10).map(s => {
            const date = new Date(s.started_at);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="session-card ${s.completed ? 'session-completed' : 'session-partial'}">
                    <div class="session-card-left">
                        <div class="session-status-dot ${s.completed ? 'dot-complete' : 'dot-partial'}"></div>
                        <div>
                            <div class="session-date">${dateStr} · ${timeStr}</div>
                            <div class="session-tier">Tier 2 · ${s.completed ? 'Completed' : 'Partial'}</div>
                        </div>
                    </div>
                    <div class="session-card-right">
                        <div class="session-stat">
                            <span class="session-stat-icon">🕐</span>
                            <span>${formatDuration(s.duration_seconds)}</span>
                        </div>
                        <div class="session-stat">
                            <span class="session-stat-icon">📖</span>
                            <span>${s.words_reviewed} words</span>
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
        console.error('Error loading sessions:', error);
    }
}

function animateNumber(id: string, target: number) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = parseInt(el.textContent) || 0;
    if (start === target) return;
    const duration = 400;
    const startTime = performance.now();
    const update = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = String(Math.round(start + (target - start) * eased));
        if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
}

function updateLearnedStats(period: string) {
    const now = new Date();
    let cutoff: Date | null = null;
    let cutoffEnd: Date | null = null;

    if (period === 'today') {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'yesterday') {
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        cutoff = yesterday;
        cutoffEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const filteredLearned = cutoff
        ? allLearnedWords.filter(w => {
            const d = new Date(w.changed_at || w.learned_at);
            return d >= cutoff && (cutoffEnd === null || d < cutoffEnd);
          })
        : allLearnedWords;

    animateNumber('learnedKnown', filteredLearned.length);

    // Update the learned words count in Quick Access
    const learnedCountEl = document.getElementById('learnedCount');
    if (learnedCountEl) {
        learnedCountEl.textContent = String(allLearnedWords.length);
    }
}

// Period filter buttons
document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateLearnedStats((btn as HTMLElement).dataset.period);
    });
});

// ============ ASSIGNMENTS ============

async function loadAssignments() {
    if (!currentUser) return;
    const section = document.getElementById('assignmentsProfileSection');
    const list = document.getElementById('assignmentsProfileList');
    if (!section || !list) return;

    try {
        const [assignments, learnedData, stats] = await Promise.all([
            fetch(`${API_URL}/assignments/student/${currentUser.uid}`).then(r => r.json()),
            fetch(`${API_URL}/progress/${currentUser.uid}/tier2/learned`).then(r => r.json()).catch(() => ({ words: [] })),
            fetch(`${API_URL}/sessions/${currentUser.uid}/stats`).then(r => r.json()).catch(() => ({}))
        ]);

        if (!assignments || assignments.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        const now = new Date();
        const totalLearnedWords = (learnedData.words || []).length;
        const totalMinutes = Math.floor((parseInt(stats.total_seconds) || 0) / 60);

        list.innerHTML = assignments.map(a => {
            const due = new Date(a.due_date);
            const overdue = due < now;
            const daysLeft = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const dueStr = due.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            const isWords = a.type === 'words';
            const current = isWords ? totalLearnedWords : totalMinutes;
            const pct = Math.min(100, Math.round((current / a.target) * 100));
            const done = pct >= 100;
            const icon = isWords ? '📚' : '⏱';
            const unitCurrent = isWords ? `${current} сл.` : `${current} мин`;
            const unitTarget = isWords ? `${a.target} слов` : `${a.target} мин`;
            const scope = a.class_name ? `Класс: ${a.class_name}` : 'Личное задание';
            const teacher = a.teacher_name ? `от ${a.teacher_name}` : '';
            let dueLabel = overdue ? '⚠ Просрочено' : done ? '✅ Выполнено' : daysLeft <= 1 ? '🔥 Сегодня' : `📅 ${dueStr}`;

            return `
            <div class="profile-asgn-card ${done ? 'asgn-done' : overdue ? 'asgn-overdue' : ''}">
                <div class="profile-asgn-header">
                    <span class="profile-asgn-icon">${icon}</span>
                    <div class="profile-asgn-meta">
                        <div class="profile-asgn-title">${a.title}</div>
                        <div class="profile-asgn-sub">${scope}${teacher ? ' · ' + teacher : ''}</div>
                    </div>
                    <div class="profile-asgn-due-badge ${overdue && !done ? 'badge-overdue' : done ? 'badge-done' : daysLeft <= 1 ? 'badge-urgent' : 'badge-normal'}">
                        ${dueLabel}
                    </div>
                </div>
                ${a.description ? `<div class="profile-asgn-desc">${a.description}</div>` : ''}
                <div class="profile-asgn-progress">
                    <div class="profile-asgn-progress-bar">
                        <div class="profile-asgn-progress-fill ${done ? 'fill-done' : ''}" style="width:${pct}%"></div>
                    </div>
                    <div class="profile-asgn-progress-label">
                        <span>${unitCurrent} из ${unitTarget}</span>
                        <span class="pct-badge">${pct}%</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (error) {
        console.error('Error loading assignments:', error);
    }
}

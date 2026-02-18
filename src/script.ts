import translations from './translations';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
  logOut,
  getCachedAuthState,
  cacheAuthState,
  updateProfile
} from './services/firebase';
import { initUserProfile, saveUserRoleAndLanguage } from './db';
import { setAvatar } from './utils/avatar';

// Current user
let currentUser: any = null;

// Internationalization
function updateContent(lang) {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
        const key = element.getAttribute('data-i18n');
        const keys = key.split('.');
        let translation = translations[lang];

        for (const k of keys) {
            translation = translation[k];
        }

        if (translation) {
            // Special handling for hero title with highlight span
            if (key === 'hero.title') {
                const highlightSpan = element.querySelector('.highlight');
                if (highlightSpan) {
                    // Update only the text nodes, preserve the span
                    const titleHighlight = translations[lang].hero.titleHighlight;
                    highlightSpan.textContent = titleHighlight;

                    // Update the text before the span
                    element.childNodes[0].textContent = translation;
                } else {
                    element.textContent = translation;
                }
            } else if (key !== 'hero.titleHighlight') {
                // Don't update titleHighlight separately as it's handled above
                element.textContent = translation;
            }
        }
    });

    // Update HTML lang attribute
    document.documentElement.lang = lang;

    // Update title
    const titles = {
        ru: 'Lexis - Изучай английские слова эффективно',
        en: 'Lexis - Learn English words effectively',
        zh: 'Lexis - 高效学习英语单词'
    };
    document.title = titles[lang];
}

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add scroll effect to header
let lastScroll = 0;
const header = document.querySelector('header');

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
        header.style.boxShadow = '0 2px 20px rgba(0,0,0,0.1)';
    } else {
        header.style.boxShadow = 'none';
    }

    lastScroll = currentScroll;
});

// Demo card interactions
const demoButtons = document.querySelectorAll('.word-card .actions button');
demoButtons.forEach(button => {
    button.addEventListener('click', () => {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = '';
        }, 100);
    });
});

// Language selector
const languageBtn = document.getElementById('languageBtn');
const languageDropdown = document.getElementById('languageDropdown');
const languageOptions = document.querySelectorAll('.language-option');

const languages = {
    ru: { flag: '🇷🇺', code: 'RU' },
    en: { flag: '🇬🇧', code: 'EN' },
    zh: { flag: '🇨🇳', code: 'ZH' }
};

let currentLang = 'ru';

// Toggle dropdown
languageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    languageBtn.classList.toggle('active');
    languageDropdown.classList.toggle('active');
});

// Close dropdown when clicking outside
document.addEventListener('click', () => {
    languageBtn.classList.remove('active');
    languageDropdown.classList.remove('active');
});

// Language selection
languageOptions.forEach(option => {
    option.addEventListener('click', (e) => {
        e.stopPropagation();
        const lang = option.dataset.lang;
        currentLang = lang;

        // Update button
        const flagSpan = languageBtn.querySelector('.flag');
        const langText = languageBtn.querySelector('.lang-text');
        flagSpan.textContent = languages[lang].flag;
        langText.textContent = languages[lang].code;

        // Update selected state
        languageOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        // Close dropdown
        languageBtn.classList.remove('active');
        languageDropdown.classList.remove('active');

        // Store preference
        localStorage.setItem('preferred-language', lang);

        // Update page content
        updateContent(lang);

        console.log('Language changed to:', lang);
    });
});

// Load saved language preference
const savedLang = localStorage.getItem('preferred-language');
if (savedLang && languages[savedLang]) {
    const flagSpan = languageBtn.querySelector('.flag');
    const langText = languageBtn.querySelector('.lang-text');
    flagSpan.textContent = languages[savedLang].flag;
    langText.textContent = languages[savedLang].code;
    currentLang = savedLang;

    languageOptions.forEach(opt => {
        if (opt.dataset.lang === savedLang) {
            opt.classList.add('selected');
        }
    });

    // Apply saved language
    updateContent(savedLang);
} else {
    // Set Russian as default
    languageOptions.forEach(opt => {
        if (opt.dataset.lang === 'ru') {
            opt.classList.add('selected');
        }
    });
}

// Authentication
const showAuthModalBtn = document.getElementById('showAuthModalBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userInfoTrigger = document.getElementById('userInfoTrigger');
const userDropdown = document.getElementById('userDropdown');

// Auth Modal Elements
const authModal = document.getElementById('authModal');
const closeAuthModal = document.getElementById('closeAuthModal');
const authModalTitle = document.getElementById('authModalTitle');
const emailAuthForm = document.getElementById('emailAuthForm') as HTMLFormElement;
const authEmail = document.getElementById('authEmail') as HTMLInputElement;
const authPassword = document.getElementById('authPassword') as HTMLInputElement;
const authDisplayName = document.getElementById('authDisplayName') as HTMLInputElement;
const displayNameGroup = document.getElementById('displayNameGroup');
const emailAuthSubmit = document.getElementById('emailAuthSubmit');
const forgotPasswordLink = document.getElementById('forgotPasswordLink');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const authToggleText = document.getElementById('authToggleText');
const authToggleLink = document.getElementById('authToggleLink');

let isSignUpMode = false;

// Toast notification
const successToast = document.getElementById('successToast');
const toastTitle = document.getElementById('toastTitle');
const toastMessage = document.getElementById('toastMessage');
const toastIcon = document.getElementById('toastIcon');

const toastIcons = {
    success: '✓',
    info: '→',
};

function showToast(title: string, message: string, duration: number = 4000, type: 'success' | 'info' = 'success') {
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    toastIcon.textContent = toastIcons[type];
    successToast.classList.remove('toast-type-info', 'toast-type-success');
    successToast.classList.add(`toast-type-${type}`, 'show');

    setTimeout(() => {
        successToast.classList.remove('show');
    }, duration);
}

// Role selection modal
const roleModal = document.getElementById('roleModal');
const selectTeacher = document.getElementById('selectTeacher');
const selectStudent = document.getElementById('selectStudent');
const roleModalWrapper = document.querySelector('.role-modal-wrapper') as HTMLElement;
const roleStep = document.getElementById('roleStep');
const languageStep = document.getElementById('languageStep');
const languageCards = document.querySelectorAll('.language-card');

let selectedRole = null;
let pendingUser = null;

// Show role modal
function showRoleModal() {
    roleModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Reset to first step
    roleStep.classList.add('active');
    roleStep.classList.remove('slide-out');
    languageStep.classList.remove('active');
}

// Hide role modal
function hideRoleModal() {
    roleModal.style.display = 'none';
    document.body.style.overflow = '';
    selectedRole = null;
    pendingUser = null;
    selectTeacher.classList.remove('selected');
    selectStudent.classList.remove('selected');
    languageCards.forEach(card => card.classList.remove('selected'));
    // Reset to first step
    setTimeout(() => {
        roleStep.classList.add('active');
        roleStep.classList.remove('slide-out');
        languageStep.classList.remove('active');
    }, 300);
}

// Slide to language selection
function slideToLanguageSelection() {
    roleStep.classList.add('slide-out');
    roleStep.classList.remove('active');
    languageStep.classList.add('active');
}

// Teacher selection
selectTeacher.addEventListener('click', () => {
    selectedRole = 'teacher';
    selectTeacher.classList.add('selected');
    selectStudent.classList.remove('selected');

    // Slide to teacher name input
    setTimeout(() => {
        slideToTeacherName();
    }, 300);
});

function slideToTeacherName() {
    const roleStep = document.getElementById('roleStep');
    const teacherNameStep = document.getElementById('teacherNameStep');

    roleStep.classList.remove('active');
    roleStep.classList.add('slide-out');
    teacherNameStep.classList.add('active');
}

// Confirm teacher name
const confirmTeacherNameBtn = document.getElementById('confirmTeacherName');
const teacherNameInput = document.getElementById('teacherNameInput') as HTMLInputElement;

confirmTeacherNameBtn.addEventListener('click', async () => {
    const teacherName = teacherNameInput.value.trim();

    if (!teacherName) {
        alert('Please enter your name');
        return;
    }

    if (pendingUser) {
        try {
            // Update display name in Firebase
            await updateProfile(pendingUser, {
                displayName: teacherName
            });

            // Save role for teacher with English as default language
            await saveUserRoleAndLanguage(pendingUser.uid, 'teacher', 'en');
            console.log('Teacher role saved with English as default');

            // Set English as UI language for teachers
            localStorage.setItem('preferred-language', 'en');
            const flagSpan = languageBtn.querySelector('.flag');
            const langText = languageBtn.querySelector('.lang-text');
            flagSpan.textContent = languages['en'].flag;
            langText.textContent = languages['en'].code;
            updateContent('en');

            hideRoleModal();
        } catch (error) {
            console.error('Error saving teacher info:', error);
            alert('Error saving information. Please try again.');
        }
    }
});

// Student selection
selectStudent.addEventListener('click', () => {
    selectedRole = 'student';
    selectStudent.classList.add('selected');
    selectTeacher.classList.remove('selected');
    // Slide to language selection
    setTimeout(() => {
        slideToLanguageSelection();
    }, 200);
});

// Language selection for students
languageCards.forEach(card => {
    card.addEventListener('click', async () => {
        const nativeLang = card.dataset.nativeLang;

        languageCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        // Save role and language for student
        if (pendingUser && selectedRole === 'student') {
            try {
                await saveUserRoleAndLanguage(pendingUser.uid, 'student', nativeLang);
                console.log('Student role and language saved:', nativeLang);

                // Set the user's preferred language in localStorage
                localStorage.setItem('preferred-language', nativeLang);

                // Update UI language
                const flagSpan = languageBtn.querySelector('.flag');
                const langText = languageBtn.querySelector('.lang-text');
                flagSpan.textContent = languages[nativeLang].flag;
                langText.textContent = languages[nativeLang].code;
                updateContent(nativeLang);

                hideRoleModal();
            } catch (error) {
                console.error('Error saving student role and language:', error);
                alert('Error saving role and language. Please try again.');
            }
        }
    });
});

// Show auth modal
showAuthModalBtn.addEventListener('click', () => {
    authModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
});

// Close auth modal
closeAuthModal.addEventListener('click', () => {
    authModal.style.display = 'none';
    document.body.style.overflow = '';
    resetAuthForm();
});

// Close modal on outside click
authModal.addEventListener('click', (e) => {
    if (e.target === authModal) {
        authModal.style.display = 'none';
        document.body.style.overflow = '';
        resetAuthForm();
    }
});

// Toggle between sign-in and sign-up
authToggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isSignUpMode = !isSignUpMode;
    updateAuthModalMode();
});

function updateAuthModalMode() {
    const t = translations[currentLang].auth;
    if (isSignUpMode) {
        authModalTitle.textContent = t.modal.signUpTitle;
        emailAuthSubmit.querySelector('span').textContent = t.modal.signUpButton;
        displayNameGroup.style.display = 'block';
        forgotPasswordLink.style.display = 'none';
        authToggleText.textContent = t.hasAccount;
        authToggleLink.textContent = t.signInLink;
    } else {
        authModalTitle.textContent = t.modal.signInTitle;
        emailAuthSubmit.querySelector('span').textContent = t.modal.signInButton;
        displayNameGroup.style.display = 'none';
        forgotPasswordLink.style.display = 'block';
        authToggleText.textContent = t.noAccount;
        authToggleLink.textContent = t.signUpLink;
    }
}

function resetAuthForm() {
    emailAuthForm.reset();
    isSignUpMode = false;
    updateAuthModalMode();
}

// Google sign in
googleSignInBtn.addEventListener('click', async () => {
    try {
        const user = await signInWithGoogle();
        const result = await initUserProfile(user);
        console.log('Signed in with Google:', user);

        authModal.style.display = 'none';
        document.body.style.overflow = '';
        resetAuthForm();

        if (result.isNewUser) {
            showToast('Account created!', `Welcome, ${user.displayName || user.email}! 🎉`);
        } else {
            showToast('Signed in!', `Welcome back, ${user.displayName || user.email}!`);
        }

        // Show role modal for new users
        if (result.isNewUser) {
            pendingUser = user;
            setTimeout(() => {
                showRoleModal();
            }, 500);
        }
    } catch (error) {
        console.error('Google sign in error:', error);
        alert('Ошибка входа через Google. Попробуйте снова.');
    }
});

// Email/Password auth form submit
emailAuthForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = authEmail.value.trim();
    const password = authPassword.value;
    const displayName = authDisplayName.value.trim();

    try {
        let user;
        const wasSignUp = isSignUpMode;

        if (isSignUpMode) {
            // Sign up
            user = await signUpWithEmail(email, password, displayName || undefined);
            console.log('Signed up:', user);
        } else {
            // Sign in
            user = await signInWithEmail(email, password);
            console.log('Signed in:', user);
        }

        const result = await initUserProfile(user);

        authModal.style.display = 'none';
        document.body.style.overflow = '';
        resetAuthForm();

        if (wasSignUp) {
            showToast('Account created!', `Welcome, ${displayName || user.email}! 🎉`);
        } else {
            showToast('Signed in!', `Welcome back, ${displayName || user.displayName || user.email}!`);
        }

        // Show role modal for new users
        if (result.isNewUser) {
            pendingUser = user;
            setTimeout(() => {
                showRoleModal();
            }, 500);
        }
    } catch (error) {
        console.error('Auth error:', error);
        alert(error.message || 'Ошибка аутентификации. Попробуйте снова.');
    }
});

// Forgot password
forgotPasswordLink.addEventListener('click', async (e) => {
    e.preventDefault();

    const email = authEmail.value.trim();
    if (!email) {
        alert('Пожалуйста, введите email для восстановления пароля.');
        return;
    }

    try {
        await resetPassword(email);
        alert('Письмо для восстановления пароля отправлено на ' + email);
    } catch (error) {
        console.error('Password reset error:', error);
        alert(error.message || 'Ошибка отправки письма. Попробуйте снова.');
    }
});

// Dropdown toggle
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

// Sign out handler
signOutBtn.addEventListener('click', async () => {
    try {
        await logOut();
        showToast('Signed out', 'See you next time!', 4000, 'info');
        console.log('Signed out');
    } catch (error) {
        console.error('Sign out error:', error);
    }
});

// Check cached auth state immediately to prevent flashing
const cachedAuth = getCachedAuthState();

if (cachedAuth) {
    // Show cached user immediately
    showAuthModalBtn.style.display = 'none';
    userProfile.style.display = 'flex';
    setAvatar(userAvatar as HTMLImageElement, cachedAuth.photoURL, cachedAuth.displayName || cachedAuth.email, 36);
    userName.textContent = cachedAuth.displayName || cachedAuth.email;
} else {
    // Hide sign-in button by default, show only after confirming no user
    showAuthModalBtn.style.display = 'none';
    userProfile.style.display = 'none';
}

// Auth state observer
onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (user) {
        // User is signed in - cache and update UI
        cacheAuthState(user);
        if (showAuthModalBtn) showAuthModalBtn.style.display = 'none';
        if (userProfile) userProfile.style.display = 'flex';
        setAvatar(userAvatar as HTMLImageElement, user.photoURL, user.displayName || user.email || '', 36);
        if (userName) userName.textContent = user.displayName || user.email;

        // Check if teacher and show dashboard link
        try {
            const { getUserProfile } = await import('./db');
            const userData = await getUserProfile(user.uid);
            if (userData && userData.role === 'teacher') {
                // Show dashboard link for teachers
                const dashboardLink = document.getElementById('dashboardLink');
                if (dashboardLink) {
                    dashboardLink.style.display = 'flex';
                }
            }
        } catch (error) {
            console.error('Error checking user role:', error);
        }
    } else {
        // User is signed out - clear cache and show sign-in
        cacheAuthState(null);
        if (showAuthModalBtn) showAuthModalBtn.style.display = 'block';
        if (userProfile) userProfile.style.display = 'none';
    }
});

// Check auth before starting learning
const startBtns = document.querySelectorAll('#startLearningBtn, #startLearningBtn2');
startBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!currentUser) {
            e.preventDefault();
            alert('Пожалуйста, войдите в систему для начала обучения');
            if (authModal) authModal.style.display = 'flex';
        }
    });
});

import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  signUpWithEmail,
  updateProfile
} from '../services/firebase';
import { initUserProfile, saveUserRoleAndLanguage, getUserProfile } from '../db';

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
const roleStep = document.getElementById('roleStep');

let selectedRole = null;
let pendingUser = null;

// Show role modal
function showRoleModal() {
    roleModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Reset to first step
    const teacherNameStep = document.getElementById('teacherNameStep');
    roleStep.classList.add('active');
    roleStep.classList.remove('slide-out');
    if (teacherNameStep) {
        teacherNameStep.classList.remove('active');
        teacherNameStep.classList.remove('slide-out');
    }
}

// Hide role modal
function hideRoleModal() {
    roleModal.classList.add('fade-out');

    setTimeout(() => {
        roleModal.style.display = 'none';
        roleModal.classList.remove('fade-out');
        document.body.style.overflow = '';
        selectedRole = null;
        pendingUser = null;
        selectTeacher.classList.remove('selected');
        selectStudent.classList.remove('selected');

        // Redirect to tiers page after role selection
        window.location.href = '/tiers.html';
    }, 300);
}

// Teacher selection
selectTeacher.addEventListener('click', () => {
    selectedRole = 'teacher';
    selectTeacher.classList.add('selected');
    selectStudent.classList.remove('selected');

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
            await updateProfile(pendingUser, {
                displayName: teacherName
            });

            // Try to initialize profile first if it doesn't exist
            try {
                await initUserProfile(pendingUser);
            } catch (initError) {
                console.log('Profile already exists or error:', initError);
            }

            await saveUserRoleAndLanguage(pendingUser.uid, 'teacher', 'en');
            localStorage.setItem('preferred-language', 'en');

            hideRoleModal();
        } catch (error) {
            console.error('Error saving teacher info:', error);
            alert('Error saving information. Please try again.');
        }
    }
});

// Student selection
selectStudent.addEventListener('click', async () => {
    selectedRole = 'student';
    selectStudent.classList.add('selected');
    selectTeacher.classList.remove('selected');

    if (pendingUser) {
        try {
            // Try to initialize profile first if it doesn't exist
            try {
                await initUserProfile(pendingUser);
            } catch (initError) {
                console.log('Profile already exists or error:', initError);
            }

            await saveUserRoleAndLanguage(pendingUser.uid, 'student', 'en');
            localStorage.setItem('preferred-language', 'en');

            hideRoleModal();
        } catch (error) {
            console.error('Error saving student role:', error);
            alert('Error saving role. Please try again.');
        }
    }
});

// Auth Form Elements
const emailAuthForm = document.getElementById('emailAuthForm') as HTMLFormElement;
const authEmail = document.getElementById('authEmail') as HTMLInputElement;
const authPassword = document.getElementById('authPassword') as HTMLInputElement;
const authDisplayName = document.getElementById('authDisplayName') as HTMLInputElement;
const emailAuthSubmit = document.getElementById('emailAuthSubmit');
const googleSignInBtn = document.getElementById('googleSignInBtn');

// Google sign in
googleSignInBtn.addEventListener('click', async () => {
    try {
        const user = await signInWithGoogle();

        // Try to initialize user profile
        let result = { isNewUser: false };
        try {
            result = await initUserProfile(user);
        } catch (initError) {
            console.error('Failed to initialize profile:', initError);
            // Continue anyway - we'll check getUserProfile below
        }

        if (result.isNewUser) {
            showToast('Account created!', `Welcome, ${user.displayName || user.email}! 🎉`);

            // Show role modal for new users
            pendingUser = user;
            setTimeout(() => {
                showRoleModal();
            }, 500);
        } else {
            // Existing user - check if they have a role
            showToast('Signed in!', `Welcome back, ${user.displayName || user.email}!`);

            try {
                const userData = await getUserProfile(user.uid);
                if (!userData || !userData.role) {
                    // User exists but no role set - show role modal
                    pendingUser = user;
                    setTimeout(() => {
                        showRoleModal();
                    }, 500);
                } else {
                    // User has role - redirect to tiers
                    setTimeout(() => {
                        window.location.href = '/tiers.html';
                    }, 1000);
                }
            } catch (getUserError) {
                console.error('Failed to get user profile:', getUserError);
                // User not in database - show role modal
                pendingUser = user;
                setTimeout(() => {
                    showRoleModal();
                }, 500);
            }
        }
    } catch (error) {
        console.error('Google sign in error:', error);
        alert('Sign-up error. Please try again.');
    }
});

// Email/Password auth form submit
emailAuthForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = authEmail.value.trim();
    const password = authPassword.value;
    const displayName = authDisplayName.value.trim();

    try {
        const user = await signUpWithEmail(email, password, displayName || undefined);

        // Try to initialize user profile
        try {
            const result = await initUserProfile(user);
            console.log('User profile initialized:', result);
        } catch (initError) {
            console.error('Failed to initialize profile, but user is created in Firebase:', initError);
            // Continue anyway - profile will be created on first login
        }

        showToast('Account created!', `Welcome, ${displayName || user.email}! 🎉`);

        // Show role modal for new users
        pendingUser = user;
        setTimeout(() => {
            showRoleModal();
        }, 500);
    } catch (error) {
        console.error('Auth error:', error);

        // Check if email already exists
        if (error.message && error.message.includes('уже зарегистрирован')) {
            const goToLogin = confirm('This email is already registered. Would you like to sign in instead?');
            if (goToLogin) {
                window.location.href = '/login.html';
            }
        } else {
            alert(error.message || 'Authentication error. Please try again.');
        }
    }
});

// Check if already authenticated
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is already signed in, check their profile
        try {
            const userData = await getUserProfile(user.uid);
            if (userData && userData.role) {
                window.location.href = '/tiers.html';
            }
        } catch (error) {
            // User exists in Firebase but not in database - this is handled by auth flow
            console.log('User not found in database, will be created during authentication flow');
        }
    }
});

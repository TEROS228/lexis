import { auth, onAuthStateChanged } from '../services/firebase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

let currentUser = null;
let assignmentType = 'words';
let assignTo = 'class';
let classes: any[] = [];
let currentStep = 1;
const totalSteps = 5;

// Toast
const toast = document.getElementById('toast');
const toastIcon = document.getElementById('toastIcon');
const toastTitle = document.getElementById('toastTitle');
const toastMessage = document.getElementById('toastMessage');

function showToast(title: string, message: string, type: 'success' | 'error' = 'success') {
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    toastIcon.textContent = type === 'success' ? '✓' : '✕';
    toast.classList.remove('toast-success', 'toast-error');
    toast.classList.add(type === 'success' ? 'toast-success' : 'toast-error', 'show');
    setTimeout(() => toast.classList.remove('show'), 4000);
}

// Progress bar
function setProgress(step: number) {
    const pct = Math.round((step / totalSteps) * 100);
    (document.getElementById('progressFill') as HTMLElement).style.width = `${pct}%`;
}

// Navigate to step
function goToStep(next: number) {
    const current = document.querySelector(`.ca-step[data-step="${currentStep}"]`) as HTMLElement;
    const target = document.querySelector(`.ca-step[data-step="${next}"]`) as HTMLElement;
    if (!target) return;

    current.classList.add('exit');
    current.classList.remove('active');

    setTimeout(() => {
        current.classList.remove('exit');
        target.classList.add('active');
        currentStep = next;
        setProgress(currentStep);

        // Focus first input on the step
        const input = target.querySelector('input, select, textarea') as HTMLElement;
        if (input) setTimeout(() => input.focus(), 100);
    }, 350);
}

// Back button
document.getElementById('backBtn')?.addEventListener('click', () => {
    if (currentStep === 1) {
        window.location.href = '/teacher-dashboard.html';
    } else {
        goToStep(currentStep - 1);
    }
});

// Step 1: type selection
document.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        assignmentType = (btn as HTMLElement).dataset.type;
        // Update step 3 labels
        const isWords = assignmentType === 'words';
        document.getElementById('targetStepTitle').textContent = isWords ? 'How many words?' : 'How many minutes?';
        document.getElementById('targetStepSub').textContent = isWords
            ? 'Enter the number of words students must learn'
            : 'Enter the number of minutes students must study';
        document.getElementById('targetUnit').textContent = isWords ? 'words' : 'min';
        (document.getElementById('assignmentTarget') as HTMLInputElement).placeholder = isWords ? '20' : '30';
        // Update quick picks
        const picks = document.getElementById('quickPicks');
        picks.innerHTML = isWords
            ? `<button class="ca-quick-pick" data-val="10">10</button>
               <button class="ca-quick-pick" data-val="20">20</button>
               <button class="ca-quick-pick" data-val="30">30</button>
               <button class="ca-quick-pick" data-val="50">50</button>`
            : `<button class="ca-quick-pick" data-val="15">15</button>
               <button class="ca-quick-pick" data-val="30">30</button>
               <button class="ca-quick-pick" data-val="60">60</button>
               <button class="ca-quick-pick" data-val="90">90</button>`;
        attachQuickPicks();
    });
});

document.getElementById('nextStep1')?.addEventListener('click', () => goToStep(2));

// Step 2: assign to
document.querySelectorAll('[data-assign]').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.querySelectorAll('[data-assign]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        assignTo = (btn as HTMLElement).dataset.assign;

        if (assignTo === 'student') {
            document.getElementById('classSelectGroup').style.display = 'none';
            document.getElementById('studentSelectGroup').style.display = 'flex';

            const studentSelect = document.getElementById('assignmentStudent') as HTMLSelectElement;
            studentSelect.innerHTML = '<option value="">Loading...</option>';

            const allStudents: any[] = [];
            for (const cls of classes) {
                try {
                    const data = await fetch(`${API_URL}/classes/${cls.id}`).then(r => r.json());
                    data.students?.forEach((s: any) => {
                        if (!allStudents.find(x => x.uid === s.uid)) allStudents.push(s);
                    });
                } catch {}
            }
            studentSelect.innerHTML = '<option value="">Select student...</option>' +
                allStudents.map(s => `<option value="${s.uid}">${s.display_name || s.email}</option>`).join('');
        } else {
            document.getElementById('classSelectGroup').style.display = 'flex';
            document.getElementById('studentSelectGroup').style.display = 'none';
        }
    });
});

document.getElementById('nextStep2')?.addEventListener('click', () => {
    if (assignTo === 'class') {
        const v = (document.getElementById('assignmentClass') as HTMLSelectElement).value;
        if (!v) { showToast('Error', 'Please select a class', 'error'); return; }
    } else {
        const v = (document.getElementById('assignmentStudent') as HTMLSelectElement).value;
        if (!v) { showToast('Error', 'Please select a student', 'error'); return; }
    }
    goToStep(3);
});

// Step 3: target + quick picks
function attachQuickPicks() {
    document.querySelectorAll('.ca-quick-pick').forEach(btn => {
        btn.addEventListener('click', () => {
            (document.getElementById('assignmentTarget') as HTMLInputElement).value = (btn as HTMLElement).dataset.val;
        });
    });
}
attachQuickPicks();

document.getElementById('nextStep3')?.addEventListener('click', () => {
    const val = parseInt((document.getElementById('assignmentTarget') as HTMLInputElement).value);
    if (!val || val < 1) { showToast('Error', 'Please enter a valid number', 'error'); return; }
    goToStep(4);
});

// Step 4: due date presets
const due = new Date();
due.setDate(due.getDate() + 7);
(document.getElementById('assignmentDueDate') as HTMLInputElement).value = due.toISOString().split('T')[0];

document.querySelectorAll('.ca-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const days = parseInt((btn as HTMLElement).dataset.days);
        const d = new Date();
        d.setDate(d.getDate() + days);
        (document.getElementById('assignmentDueDate') as HTMLInputElement).value = d.toISOString().split('T')[0];
    });
});

document.getElementById('nextStep4')?.addEventListener('click', () => {
    const v = (document.getElementById('assignmentDueDate') as HTMLInputElement).value;
    if (!v) { showToast('Error', 'Please pick a due date', 'error'); return; }
    goToStep(5);
});

// Step 5: submit
document.getElementById('submitBtn')?.addEventListener('click', async () => {
    const title = (document.getElementById('assignmentTitle') as HTMLInputElement).value.trim();
    if (!title) { showToast('Error', 'Please enter a title', 'error'); return; }

    const target = parseInt((document.getElementById('assignmentTarget') as HTMLInputElement).value);
    const dueDate = (document.getElementById('assignmentDueDate') as HTMLInputElement).value;
    const description = (document.getElementById('assignmentDescription') as HTMLTextAreaElement).value.trim();

    let classId = null, studentUid = null;
    if (assignTo === 'class') {
        classId = parseInt((document.getElementById('assignmentClass') as HTMLSelectElement).value);
    } else {
        studentUid = (document.getElementById('assignmentStudent') as HTMLSelectElement).value;
    }

    const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

    try {
        const res = await fetch(`${API_URL}/assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                classId, studentUid, teacherUid: currentUser.uid,
                type: assignmentType, target, dueDate, title, description
            })
        });
        if (!res.ok) throw new Error('Failed');

        showToast('Done!', `Assignment "${title}" created`);
        setTimeout(() => { window.location.href = '/teacher-dashboard.html'; }, 1200);
    } catch {
        showToast('Error', 'Failed to create assignment', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Create Assignment';
    }
});

// Auth + load classes
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = '/'; return; }
    currentUser = user;

    try {
        classes = await fetch(`${API_URL}/classes/teacher/${user.uid}`).then(r => r.json());
        const classSelect = document.getElementById('assignmentClass') as HTMLSelectElement;
        classSelect.innerHTML = classes.length === 0
            ? '<option value="">No classes yet</option>'
            : '<option value="">Select class...</option>' + classes.map(c => `<option value="${c.id}">${c.class_name}</option>`).join('');
    } catch {
        showToast('Error', 'Failed to load classes', 'error');
    }

    setProgress(1);
});

// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE & CONFIG ---
    let currentReview = {};
    const form = document.getElementById('assessmentForm');
    const p = (val) => parseFloat(val); // Global helper function

    const CATEGORIES = {
        RED: { text: 'CAT 1: RED', class: 'category-red' },
        AMBER: { text: 'CAT 2: AMBER', class: 'category-amber' },
        GREEN: { text: 'CAT 3: GREEN', class: 'category-green' }
    };

    // --- INITIALIZATION ---
    function initializeApp() {
        populateStaticContent();
        setupEventListeners();
        const savedState = localStorage.getItem('alertToolState_v26');
        if (savedState) {
            currentReview = JSON.parse(savedState);
            loadReviewData();
            document.getElementById('launchScreenModal').style.display = 'none';
            document.getElementById('main-content').style.visibility = 'visible';
        } else {
            document.getElementById('launchScreenModal').style.display = 'flex';
        }
    }

    // --- DATA HANDLING ---
    function gatherFormData() {
        const data = {};
        form.querySelectorAll('input, select, textarea').forEach(el => {
            if (el.id) {
                 if (el.type === 'checkbox') {
                    data[el.id] = el.checked;
                } else {
                    data[el.id] = el.value;
                }
            }
        });
        // Special handling for radio button groups
        document.querySelectorAll('.trend-radio-group').forEach(group => {
            const checkedRadio = group.querySelector('input[type="radio"]:checked');
            if (checkedRadio) {
                const id = group.dataset.trendId;
                data[id] = checkedRadio.value;
            }
        });
        return data;
    }

    function saveState() {
        currentReview = gatherFormData();
        localStorage.setItem('alertToolState_v26', JSON.stringify(currentReview));
    }
    
    function loadReviewData(isHandoff = false) {
        Object.keys(currentReview).forEach(key => {
            const el = form.querySelector(`#${key}`);
            if (el) {
                if (el.type === 'checkbox') {
                    el.checked = currentReview[key];
                } else {
                    el.value = currentReview[key];
                }
            } else if (key.endsWith('_trend')) {
                // Handle radio buttons
                const trendRadios = form.querySelectorAll(`input[name="${key}_radio"]`);
                trendRadios.forEach(radio => {
                    if (radio.value === currentReview[key]) {
                        radio.checked = true;
                    }
                });
            }
        });

        if (isHandoff) {
            document.getElementById('desktop-entry-container').style.display = 'none';
        }
        updateRiskAssessment();

        // Manually trigger events for dynamic fields
        form.querySelectorAll('input[type="date"], input[id*="present"], select[id*="present"]').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        document.getElementById('pain_score')?.dispatchEvent(new Event('input'));
        document.getElementById('bowels')?.dispatchEvent(new Event('change'));
    }

    function clearForm() {
        form.reset();
        localStorage.removeItem('alertToolState_v26');
        currentReview = {};
        updateRiskAssessment();
        document.getElementById('output-panel').style.display = 'block';
        document.getElementById('desktop-entry-container').style.display = 'block';
    }

    // --- CORE LOGIC: RISK ASSESSMENT ENGINE ---
    function updateRiskAssessment() {
        const data = gatherFormData();
        if (Object.keys(data).length === 0) return;
        
        let score = 0;
        const flags = { red: [], green: [] };

        // Desktop Data Scoring
        if (p(data.icu_los) > 3) { score += 1; flags.red.push('ICU Stay > 3 days'); }
        if (data.after_hours) { score += 1; flags.red.push('After-hours discharge'); }
        if(p(data.age) > 65) { score += 1; flags.red.push('Age > 65 years'); }
        const admissionScore = p(data.admission_type) || 0;
        if (admissionScore > 0) {
            score += admissionScore;
            const admissionText = form.querySelector('#admission_type option:checked').textContent;
            flags.red.push(`Admission: ${admissionText}`);
        }
        if (p(data.severe_comorbidities) >= 2) { score += 2; flags.red.push(`Severe comorbidities (≥2)`); }

        // Bloods Scoring
        const bloods = [
            { id: 'creatinine', val: p(data.creatinine), threshold: 171, score: 1, name: 'Creatinine' },
            { id: 'lactate', val: p(data.lactate), threshold: 1.5, score: 2, name: 'Lactate' },
            { id: 'bilirubin', val: p(data.bilirubin), threshold: 20, score: 1, name: 'Bilirubin' },
            { id: 'platelets', val: p(data.platelets), threshold: 100, isLow: true, score: 1, name: 'Platelets' },
            { id: 'hb', val: p(data.hb), threshold: 8, isLow: true, score: 2, name: 'Hb' },
            { id: 'glucose', val: p(data.glucose), threshold: 180, score: 2, name: 'Glucose' },
            { id: 'k', val: p(data.k), thresholdLow: 3.5, thresholdHigh: 5.5, score: 1, name: 'K+' },
            { id: 'mg', val: p(data.mg), thresholdLow: 0.7, thresholdHigh: 1.2, score: 1,

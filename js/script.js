// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE & CONFIG ---
    let currentReview = {};
    const form = document.getElementById('assessmentForm');

    const CATEGORIES = {
        RED: { text: 'CAT 1 RED - HIGH RISK', class: 'category-red' },
        AMBER: { text: 'CAT 2 AMBER - MEDIUM RISK', class: 'category-amber' },
        GREEN: { text: 'CAT 3 GREEN - LOW RISK', class: 'category-green' }
    };

    // --- INITIALIZATION ---
    function initializeApp() {
        setupEventListeners();
        const savedState = sessionStorage.getItem('icuRiskToolState_v5');
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
            if (el.id) data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
        });
        return data;
    }

    function saveState() {
        currentReview = gatherFormData();
        sessionStorage.setItem('icuRiskToolState_v5', JSON.stringify(currentReview));
    }

    function loadReviewData(isHandoff = false) {
        Object.keys(currentReview).forEach(key => {
            const el = form.querySelector(`#${key}`);
            if (el) {
                if (el.type === 'checkbox') el.checked = currentReview[key];
                else el.value = currentReview[key];
            }
        });
        if (isHandoff) {
            document.getElementById('desktop-entry-section').style.display = 'none';
        }
        updateRiskAssessment();
    }

    function clearForm() {
        form.reset();
        sessionStorage.removeItem('icuRiskToolState_v5');
        currentReview = {};
        updateRiskAssessment();
        document.getElementById('output-panel').style.display = 'none';
        document.getElementById('desktop-entry-section').style.display = 'block';
    }

    // --- CORE LOGIC: RISK ASSESSMENT ENGINE ---
    function updateRiskAssessment() {
        const data = gatherFormData();
        if (Object.keys(data).length === 0 || !data.patient_initials) return;
        
        const flags = { red: [], amber: [] };
        let score = 0;
        const p = (val) => parseFloat(val);

        const addsResult = calculateADDS();
        if(addsResult.metCall) flags.red.push(`MET Call Criteria: ${addsResult.metReason}`);
        score += addsResult.score;
        
        if (data.resp_trend === 'worsening') { flags.red.push('Worsening respiratory trend'); score += 3; }
        
        if (p(data.lactate) > 4) { flags.red.push(`Very High Lactate (${data.lactate})`); score += 3; }
        else if (p(data.lactate) > 2) { flags.red.push(`High Lactate (${data.lactate})`); score += 3; }
        if (data.lactate_trend === 'worsening') { flags.amber.push('Worsening Lactate Trend'); score += 2; }
        
        const cr = p(data.creatinine), cr_base = p(data.creatinine_baseline);
        if (!isNaN(cr) && !isNaN(cr_base) && (cr >= cr_base * 1.5 || cr >= cr_base + 26)) { flags.red.push(`AKI (Cr rising to ${cr})`); score += 3; }
        if (data.creatinine_trend === 'worsening') { flags.amber.push('Worsening Creatinine Trend'); score += 2; }
        
        if (p(data.platelets) < 100) { flags.red.push(`Thrombocytopenia (Platelets < 100)`); score += 3; }
        if (data.platelets_trend === 'worsening') { flags.amber.push('Worsening Platelets Trend'); score += 2; }
        
        if (p(data.albumin) < 30) { flags.amber.push(`Low Albumin (${data.albumin})`); score += 1; }
        
        if (data.neuro_delirium === 'yes' && data.frailty_impression) { flags.red.push('Delirium + Frailty'); score += 3; }
        if (p(data.frailty_score) > 5) { flags.red.push(`High Frailty Score (CFS ${data.frailty_score})`); score += 3; }
        
        if (data.complex_device) { flags.red.push('Complex device present'); score += 3; }
        
        const isAmberContext = data.context_discharge || data.context_ward;
        if (isAmberContext) { flags.amber.push('High-risk discharge context'); score += 1; }

        if (data.override_checkbox) {
            flags.red.push(`Manual Override: ${data.override_reason || 'Clinical Concern'}`);
            score += 6; 
        }

        let categoryKey = 'GREEN';
        if (score > 5 || flags.red.length > 0) categoryKey = 'RED';
        else if (score >= 3 || flags.amber.length > 0) categoryKey = 'AMBER';

        displayResults(categoryKey, flags, score);
        saveState();
    }

    function calculateADDS() {
        const p = (val) => parseFloat(val);
        const getScore = (val, ranges) => {
            for (const r of ranges) {
                if ((r.min === -Infinity || val >= r.min) && (r.max === Infinity || val <= r.max)) {
                    if (r.score === 'E') return { metCall: true, metReason: r.note.replace('=>', `(${val}) =>`) };
                    return { score: r.score };
                }
            }
            return { score: 0 };
        };
        let totalScore = 0;
        let metCall = false;
        let metReason = '';
        const data = gatherFormData();

        const checkParam = (value, ranges) => {
            if (isNaN(value)) return;
            const result = getScore(value, ranges);
            if(result.metCall) {
                metCall = true;
                metReason = result.metReason;
            } else {
                totalScore += result.score;
            }
        };
        
        checkParam(p(data.rr), [{min: -Infinity, max: 4, score: 'E', note: '<=4 => MET'}, {min: 5, max: 8, score: 3}, {min: 9, max: 10, score: 2}, {min: 11, max: 20, score: 0}, {min: 21, max: 24, score: 1}, {min: 25, max: 30, score: 2}, {min: 31, max: 35, score: 3}, {min: 36, max: Infinity, score: 'E', note: '>=36 => MET'}]);
        checkParam(p(data.spo2), [{min: -Infinity, max: 84, score: 'E', note: '<=84 => MET'}, {min: 85, max: 88, score: 3}, {min: 89, max: 90, score: 2}, {min: 91, max: 93, score: 1}, {min: 94, max: Infinity, score: 0}]);
        checkParam(p(data.hr), [{min: -Infinity, max: 30, score: 'E', note: '<=30 => MET'}, {min: 31, max: 40, score: 3}, {min: 41, max: 50, score: 2}, {min: 51, max: 99, score: 0}, {min: 100, max: 109, score: 1}, {min: 110, max: 120, score: 2}, {min: 121, max: 129, score: 1}, {min: 130, max: 139, score: 3}, {min: 140, max: Infinity, score: 'E', note: '>=140 => MET'}]);
        checkParam(p(data.sbp), [{min: -Infinity, max: 40, score: 'E', note: 'extreme low -> MET'}, {min: 41, max: 50, score: 3}, {min: 51, max: 60, score: 2}, {min: 61, max: 70, score: 1}, {min: 71, max: 80, score: 0}, {min: 81, max: 90, score: 3}, {min: 91, max: 100, score: 2}, {min: 101, max: 110, score: 1}, {min: 111, max: 139, score: 0}, {min: 140, max: 180, score: 1}, {min: 181, max: 200, score: 2}, {min: 201, max: 220, score: 3}, {min: 221, max: Infinity, score: 'E', note: '>=221 => MET'}]);
        checkParam(p(data.temp), [{min: -Infinity, max: 35, score: 3}, {min: 35.1, max: 36.0, score: 1}, {min: 36.1, max: 37.5, score: 0}, {min: 37.6, max: 38.0, score: 1}, {min: 38.1, max: 39.0, score: 2}, {min: 39.1, max: Infinity, score: 'E', note: '>=39.1 => MET'}]);

        if (data.neuro_consciousness === 'Unresponsive') { metCall = true; metReason = 'Unresponsive'; }
        else if (data.neuro_consciousness === 'Pain') totalScore += 2;
        else if (data.neuro_consciousness === 'Voice') totalScore += 1;

        if (data.resp_device === 'HFNP') totalScore += 1;
        if (data.resp_device === 'NIV') totalScore += 2;
        checkParam(p(data.o2_flow), [{min: 0, max: 5, score: 0}, {min: 6, max: 7, score: 1}, {min: 8, max: 9, score: 2}, {min: 10, max: Infinity, score: 3}]);
        checkParam(p(data.fio2), [{min: 28, max: 28, score: 2}, {min: 40, max: Infinity, score: 3}]);
        
        if(document.getElementById('finalADDSScore')) document.getElementById('finalADDSScore').textContent = totalScore;
        return { score: totalScore, metCall, metReason };
    }

    // --- UI & OUTPUT ---
    function displayResults(categoryKey, flags, score) {
        const category = CATEGORIES[categoryKey];
        const outputPanel = document.getElementById('output-panel');
        const summaryContainer = document.getElementById('summary-container');
        const footerCategory = document.getElementById('footer-category');

        footerCategory.textContent = `${category.text} (Score: ${score})`;
        document.getElementById('sticky-footer').className = `fixed bottom-0 left-0 right-0 p-1 shadow-lg transition-colors duration-300 flex items-center justify-center z-40 ${category.class}`;

        const allFlags = flags.red.concat(flags.amber);
        const plan = generateActionPlan(categoryKey, allFlags);

        summaryContainer.innerHTML = `
            <div class="summary-category ${category.class}">${category.text} (Score: ${score})</div>
            <div>
                <h4 class="font-semibold">Triggering Factors (${allFlags.length}):</h4>
                <ul class="list-disc list-inside text-sm text-gray-700">
                    ${allFlags.length ? allFlags.map(f => `<li>${f}</li>`).join('') : '<li>No specific risk factors identified.</li>'}
                </ul>
            </div>
            <div class="summary-plan">
                <h4>Recommended Action Plan:</h4>
                <p class="text-sm">${plan}</p>
            </div>
        `;
        outputPanel.style.display = 'block';
    }

    function generateActionPlan(categoryKey, flags) {
        let plan = '';
        switch (categoryKey) {
            case 'RED':
                plan = 'Category 1: Reviews twice daily (q12h) for up to 72 hours. Escalate to ICU Liaison/Medical Team immediately. ';
                if (flags.some(f => f.includes('Kidney') || f.includes('Creatinine'))) plan += 'Repeat Creatinine in 24h. ';
                if (flags.some(f => f.includes('Lactate'))) plan += 'Repeat Lactate in 6h. ';
                return plan;
            case 'AMBER':
                return 'Category 2: Reviews twice daily (q12h) for up to 24 hours, then daily if stable. Extend to 48h if needed.';
            case 'GREEN':
                return 'Category 3: Single review within 12 hours. No structured follow-up required if stable.';
        }
    }

    function generateDMRSummary() {
        const data = gatherFormData();
        const categoryText = document.getElementById('footer-category').textContent;
        const plan = generateActionPlan(categoryText.split(' ')[1], []);
        
        const summary = `
ICU Step-Down Risk Assessment:
-----------------------------
Patient: ${data.patient_initials || 'N/A'}-${data.patient_urn_last4 || 'N/A'} on Ward ${data.ward || 'N/A'}
RISK CATEGORY: ${categoryText}
-----------------------------
KEY FINDINGS:
- A-E: RR ${data.rr}, SpO2 ${data.spo2} on ${data.resp_device}, SBP ${data.sbp}, Conscious: ${data.neuro_consciousness}, Delirium: ${data.neuro_delirium}, Temp: ${data.temp}
- ADDS Score: ${calculateADDS().score}
- Bloods: Lactate ${data.lactate} (${data.lactate_trend}), Cr ${data.creatinine} (Baseline ${data.creatinine_baseline}, ${data.creatinine_trend}), Plt ${data.platelets} (${data.platelets_trend}), Alb ${data.albumin} (${data.albumin_trend}), Bili ${data.bilirubin} (${data.bilirubin_trend}), CRP ${data.crp} (${data.crp_trend}), WBC ${data.wbc} (${data.wbc_trend}), Hb ${data.hb} (${data.hb_trend})
- Context: Frail (${data.frailty_impression ? 'Yes' : 'No'}, CFS ${data.frailty_score || 'N/A'}), Complex Device (${data.complex_device ? 'Yes' : 'No'}), Out-of-hours (${data.context_discharge ? 'Yes' : 'No'})
- Devices List: ${data.device_list || 'N/A'}
- Override: ${data.override_reason || 'None'}
-----------------------------
RECOMMENDED PLAN:
${plan}
        `.trim();

        const emrSummary = document.getElementById('emrSummary');
        emrSummary.value = summary;
        emrSummary.style.display = 'block';
        emrSummary.select();
        document.execCommand('copy');
        alert('DMR Summary Generated & Copied to Clipboard!');
    }

    // --- EVENT LISTENERS ---
    function setupEventListeners() {
        document.getElementById('startNewReviewBtn').addEventListener('click', () => {
            clearForm();
            document.getElementById('launchScreenModal').style.display = 'none';
            document.getElementById('main-content').style.visibility = 'visible';
        });

        document.getElementById('resumeReviewBtn').addEventListener('click', () => { document.getElementById('pasteContainer').style.display = 'block'; });
        document.getElementById('loadPastedDataBtn').addEventListener('click', () => {
             const pastedText = document.getElementById('pasteDataInput').value;
             if (!pastedText) return;
             try {
                currentReview = JSON.parse(atob(pastedText));
                loadReviewData(true);
                document.getElementById('launchScreenModal').style.display = 'none';
                document.getElementById('main-content').style.visibility = 'visible';
             } catch(e) { alert('Invalid handoff key.'); }
        });

        document.getElementById('startOverBtn').addEventListener('click', () => {
            if (confirm('Are you sure? This will clear all data.')) {
                clearForm();
                document.getElementById('main-content').style.visibility = 'hidden';
                document.getElementById('launchScreenModal').style.display = 'flex';
            }
        });
        
        form.addEventListener('input', () => {
            validateForm();
            updateRiskAssessment();
        });
        form.addEventListener('change', updateRiskAssessment);

        document.getElementById('generateSummaryButton').addEventListener('click', generateDMRSummary);
        
        document.getElementById('generateHandoffBtn').addEventListener('click', () => {
            const handoffData = {};
            const desktopFields = ['patient_initials', 'patient_urn_last4', 'ward', 'room_number', 'goc', 'reason_icu', 'pmh', 'lactate', 'lactate_trend', 'creatinine', 'creatinine_trend', 'creatinine_baseline', 'platelets', 'platelets_trend', 'albumin', 'albumin_trend', 'bilirubin', 'bilirubin_trend', 'crp', 'crp_trend', 'wbc', 'wbc_trend', 'hb', 'hb_trend'];
            desktopFields.forEach(id => { const el = document.getElementById(id); if(el) handoffData[id] = el.value; });
            const key = btoa(JSON.stringify(handoffData));
            navigator.clipboard.writeText(key).then(() => alert('Handoff key copied to clipboard!'));
        });

        document.getElementById('resp_device').addEventListener('change', e => {
            document.getElementById('o2_settings_container').classList.toggle('hidden', e.target.value === 'RA');
        });
    }

    function validateForm() {
        form.querySelectorAll('input[required]').forEach(input => {
            if (!input.value) {
                input.classList.add('border-red-500');
            } else {
                input.classList.remove('border-red-500');
            }
        });
    }

    // --- DYNAMIC CONTENT ---
    function populateStaticContent() {
        // All content is now in the HTML file for simplicity and clarity.
    }
        
    initializeApp();
});


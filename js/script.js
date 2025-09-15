// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE & CONFIG ---
    let currentReview = {};
    const form = document.getElementById('assessmentForm');

    const CATEGORIES = {
        RED: { text: 'RED FLAG - HIGH RISK', class: 'category-red' },
        AMBER: { text: 'AMBER FLAG - MEDIUM RISK', class: 'category-amber' },
        GREEN: { text: 'GREEN - LOW RISK', class: 'category-green' }
    };

    // --- INITIALIZATION ---
    function initializeApp() {
        populateStaticContent();
        setupEventListeners();
        const savedState = localStorage.getItem('icuRiskToolState_v3');
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
        localStorage.setItem('icuRiskToolState_v3', JSON.stringify(currentReview));
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
        localStorage.removeItem('icuRiskToolState_v3');
        currentReview = {};
        updateRiskAssessment();
        document.getElementById('output-panel').style.display = 'none';
        document.getElementById('desktop-entry-section').style.display = 'block';
    }

    // --- CORE LOGIC: RISK ASSESSMENT ENGINE ---
    function updateRiskAssessment() {
        const data = gatherFormData();
        if (Object.keys(data).length === 0) return;
        const flags = { red: [], amber: [] };
        const p = (val) => parseFloat(val);

        // A-E Assessment Flags
        const addsResult = calculateADDS();
        if (addsResult.score >= 5) flags.red.push(`High ADDS Score (${addsResult.score})`);
        if (data.resp_trend === 'worsening') flags.red.push('Worsening respiratory trend (O₂ requirement increasing)');
        if (p(data.sbp) < 90) flags.red.push(`Hypotension (SBP < 90 mmHg)`);
        if (addsResult.score >= 3 && addsResult.score <= 4) flags.amber.push(`Moderate ADDS Score (${addsResult.score})`);
        
        // Bloods Flags
        if (p(data.lactate) > 2) flags.red.push(`High Lactate (${data.lactate} mmol/L)`);
        const cr = p(data.creatinine), cr_base = p(data.creatinine_baseline);
        if (!isNaN(cr) && !isNaN(cr_base) && (cr >= cr_base * 1.5 || cr >= cr_base + 26)) flags.red.push(`Acute Kidney Injury (Creatinine rising to ${cr} µmol/L)`);
        if (p(data.platelets) < 100) flags.red.push(`Thrombocytopenia (Platelets < 100)`);
        
        // Context & Frailty Flags
        if (data.neuro_delirium === 'yes' && data.frailty_impression) flags.red.push('High-risk combination (Delirium + Frailty)');
        if (data.complex_device) flags.red.push('Complex device present');
        if (p(data.albumin) < 30) flags.amber.push(`Low Albumin (${data.albumin} g/L) indicating frailty/inflammation`);
        
        const isAmberContext = data.context_discharge || data.context_ward;
        if (isAmberContext) flags.amber.push('High-risk discharge context');

        let categoryKey = 'GREEN';
        if (flags.red.length > 0 || (isAmberContext && flags.amber.length > 0)) categoryKey = 'RED';
        else if (flags.amber.length > 0) categoryKey = 'AMBER';

        displayResults(categoryKey, flags);
        saveState();
    }

    function calculateADDS() {
        const p = (val) => parseFloat(val);
        const getScore = (val, ranges) => { for (const r of ranges) { if (val >= r.min && val <= r.max) return r.score; } return 0; };
        let total = 0;
        const data = gatherFormData();
        
        if (!isNaN(p(data.rr))) total += getScore(p(data.rr), [{min:0, max:8, score:2}, {min:9, max:11, score:1}, {min:21, max:29, score:2}, {min:30, max:999, score:3}]);
        if (!isNaN(p(data.spo2))) total += getScore(p(data.spo2), [{min:0, max:89, score:3}, {min:90, max:93, score:2}, {min:94, max:95, score:1}]);
        if (data.resp_device !== 'RA') total += 2;
        if (!isNaN(p(data.hr))) total += getScore(p(data.hr), [{min:0, max:39, score:2}, {min:40, max:49, score:1}, {min:100, max:119, score:1}, {min:120, max:999, score:2}]);
        if (!isNaN(p(data.sbp))) total += getScore(p(data.sbp), [{min:0, max:79, score:3}, {min:80, max:99, score:2}, {min:200, max:999, score:2}]);
        if (data.neuro_consciousness !== 'Alert') total += 3;
        if (!isNaN(p(data.temp))) total += getScore(p(data.temp), [{min:0, max:35.0, score:2}, {min:38.1, max:38.9, score:1}, {min:39.0, max:99, score:2}]);
        
        const manualScore = p(data.manualADDSScore);
        const finalScore = data.addsModificationCheckbox && !isNaN(manualScore) ? manualScore : total;
        
        if(document.getElementById('calculatedADDSScore')) document.getElementById('calculatedADDSScore').textContent = total;
        if(document.getElementById('finalADDSScore')) document.getElementById('finalADDSScore').textContent = finalScore;
        
        return { score: finalScore };
    }

    // --- UI & OUTPUT ---
    function displayResults(categoryKey, flags) {
        const category = CATEGORIES[categoryKey];
        const outputPanel = document.getElementById('output-panel');
        const summaryContainer = document.getElementById('summary-container');
        const footerCategory = document.getElementById('footer-category');

        footerCategory.textContent = category.text;
        document.getElementById('sticky-footer').className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex items-center justify-center z-40 ${category.class}`;

        const allFlags = flags.red.concat(flags.amber);
        const plan = generateActionPlan(categoryKey, allFlags);

        summaryContainer.innerHTML = `
            <div class="summary-category ${category.class}">${category.text}</div>
            <div>
                <h4 class="font-semibold">Triggering Factors:</h4>
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
        switch (categoryKey) {
            case 'RED':
                let redPlan = 'Initiate daily review for 72h. Escalate to ICU Liaison/Medical Team. ';
                if (flags.some(f => f.includes('Kidney'))) redPlan += 'Repeat Creatinine in 24h. ';
                if (flags.some(f => f.includes('Lactate'))) redPlan += 'Repeat Lactate in 6h. ';
                return redPlan;
            case 'AMBER':
                return 'Schedule follow-up review within 48-72 hours. Continue standard ward monitoring.';
            case 'GREEN':
                return 'No structured follow-up required. Continue standard care.';
        }
    }

    function generateDMRSummary() {
        const data = gatherFormData();
        const categoryText = document.getElementById('footer-category').textContent;
        const plan = generateActionPlan(categoryText.split(' ')[0], []);
        
        const summary = `
ICU Step-Down Risk Assessment:
-----------------------------
Patient: ${data.patient_initials || 'N/A'}-${data.patient_urn_last4 || 'N/A'} on Ward ${data.ward || 'N/A'}
RISK CATEGORY: ${categoryText}
-----------------------------
KEY FINDINGS:
- A-E: RR ${data.rr}, SpO2 ${data.spo2} on ${data.resp_device}, SBP ${data.sbp}, Conscious: ${data.neuro_consciousness}, Delirium: ${data.neuro_delirium}, Temp: ${data.temp}
- ADDS Score: ${calculateADDS().score}
- Bloods: Lactate ${data.lactate}, Cr ${data.creatinine} (Baseline ${data.creatinine_baseline}), Plt ${data.platelets}, Alb ${data.albumin}
- Context: Frail (${data.frailty_impression ? 'Yes' : 'No'}), Complex Device (${data.complex_device ? 'Yes' : 'No'}), Out-of-hours (${data.context_discharge ? 'Yes' : 'No'})
- Devices List: ${data.device_list || 'N/A'}
-----------------------------
RECOMMENDED PLAN:
${plan}
        `.trim();

        const emrSummary = document.getElementById('emrSummary');
        emrSummary.value = summary;
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
        
        form.addEventListener('input', updateRiskAssessment);
        form.addEventListener('change', updateRiskAssessment);

        document.getElementById('generateSummaryButton').addEventListener('click', generateDMRSummary);
        
        document.getElementById('generateHandoffBtn').addEventListener('click', () => {
            const handoffData = {};
            const desktopFields = ['patient_initials', 'patient_urn_last4', 'ward', 'room_number', 'goc', 'reason_icu', 'pmh', 'lactate', 'creatinine', 'creatinine_baseline', 'platelets', 'albumin'];
            desktopFields.forEach(id => { const el = document.getElementById(id); if(el) handoffData[id] = el.value; });
            const key = btoa(JSON.stringify(handoffData));
            navigator.clipboard.writeText(key).then(() => alert('Handoff key copied to clipboard!'));
        });
    }

    // --- DYNAMIC CONTENT ---
    function populateStaticContent() {
        const createBloodInput = (label, id, unit, trend=false, tooltip='') => `<label>${label} ${tooltip}:<input type="number" step="${id.includes('lactate') ? '0.1' : '1'}" id="${id}" class="input-field" placeholder="e.g., ${unit}"></label>`;
        document.getElementById('bloods-container').innerHTML = `<h2 class="form-section-title">Bloods</h2><div class="domain-container"><div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">${createBloodInput('Lactate', 'lactate', '1.8')}${createBloodInput('Creatinine (Current)', 'creatinine', '110')}${createBloodInput('Creatinine (Baseline)', 'creatinine_baseline', '80', false, '<span class="tooltip" title="Use lowest value from this admission if pre-admission baseline is unknown.">(?)</span>')}${createBloodInput('Platelets', 'platelets', '150')}${createBloodInput('Albumin', 'albumin', '32')}</div></div>`;
        
        document.getElementById('assessment-container').innerHTML = `<h2 class="form-section-title">A-E Assessment</h2><div class="space-y-6">
            <div><h3 class="assessment-section-title">A: </h3><select id="airway_input" class="input-field"><option value="Clear">Clear and maintained</option><option value="At Risk">Airway at risk / requires adjunct</option></select></div>
            <div><h3 class="assessment-section-title">B: </h3><div class="assessment-grid"><label>O₂ Device:<select id="resp_device" class="input-field"><option value="RA">Room Air</option><option value="NP">Nasal Prongs</option><option value="HF">High-Flow</option><option value="NIV">NIV/CPAP</option></select></label><label>O₂ Trend:<select id="resp_trend" class="input-field"><option value="stable">Stable</option><option value="worsening">Worsening</option></select></label><label>Resp Rate:<input type="number" id="rr" class="input-field"></label><label>SpO2 (%):<input type="number" id="spo2" class="input-field"></label></div></div>
            <div><h3 class="assessment-section-title">C: </h3><div class="assessment-grid"><label>Heart Rate:<input type="number" id="hr" class="input-field"></label><label>Systolic BP:<input type="number" id="sbp" class="input-field"></label></div></div>
            <div><h3 class="assessment-section-title">D: </h3><div class="assessment-grid"><label>Consciousness:<select id="neuro_consciousness" class="input-field"><option>Alert</option><option>Voice</option><option>Pain</option><option>Unresponsive</option></select></label><label>Delirium Present:<select id="neuro_delirium" class="input-field"><option value="no">No</option><option value="yes">Yes</option></select></label></div></div>
            <div><h3 class="assessment-section-title">E: </h3><label>Temperature (°C):<input type="number" step="0.1" id="temp" class="input-field"></label></div>
        </div>
        <div class="mt-6 bg-teal-50 p-4 rounded-lg border border-teal-200 text-center"><span class="text-sm font-medium text-gray-500">CALCULATED ADDS SCORE</span><div id="finalADDSScore" class="font-bold text-5xl my-2">0</div></div>`;
    }
        
    initializeApp();
});


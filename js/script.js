// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let currentReview = {};
    let deviceCounters = {};

    const RISK_CATEGORIES = {
        extremely_high: { score: 10, text: 'Extremely High Risk: Urgent medical review & consider re-transfer to higher care.', class: 'category-extremely-high' },
        high: { score: 6, text: 'High Risk: Formal medical review required.', class: 'category-high' },
        medium: { score: 3, text: 'Medium Risk: Enhanced nurse-led care.', class: 'category-medium' },
        low: { score: 0, text: 'Low Risk: Single check next shift.', class: 'category-low' }
    };
    
    const form = document.getElementById('assessmentForm');

    // --- INITIALIZATION ---
    function initializeApp() {
        populateStaticContent();
        setupEventListeners();
        
        // Check for saved state after setup
        const savedState = localStorage.getItem('alertToolState_v22');
        if (savedState) {
            currentReview = JSON.parse(savedState);
            loadReviewData();
            document.getElementById('launchScreenModal').style.display = 'none';
            setAppViewMode('full');
        } else {
            document.getElementById('launchScreenModal').style.display = 'flex';
        }
    }
    
    function setAppViewMode(mode) {
        document.getElementById('main-content').style.visibility = 'visible';
        currentReview.mode = mode;
        const isQuickMode = mode === 'quick';
        document.getElementById('fullReviewContainer').style.display = isQuickMode ? 'none' : 'block';
        document.getElementById('fullReviewContainerBottom').style.display = isQuickMode ? 'none' : 'block';
    }

    // --- DATA & STATE HANDLING ---
    function gatherFormData() {
        const data = {};
        form.querySelectorAll('input, select, textarea').forEach(el => {
            if (!el.id) return;
            if (el.type === 'checkbox') data[el.id] = el.checked;
            else data[el.id] = el.value;
        });
        
        data.devices = {};
        ['central_lines', 'pivcs'].forEach(type => {
            data.devices[type] = Array.from(document.getElementById(`${type}_container`).querySelectorAll('.device-entry')).map(entry => {
                const deviceData = {};
                entry.querySelectorAll('input[data-key], select[data-key]').forEach(input => deviceData[input.dataset.key] = input.value);
                return deviceData;
            });
        });
        return data;
    }

    function saveState() {
        currentReview = gatherFormData();
        currentReview.finalScore = parseInt(document.getElementById('footer-score').textContent) || 0;
        localStorage.setItem('alertToolState_v22', JSON.stringify(currentReview));
    }
    
    function loadReviewData() {
        const data = currentReview;
        Object.keys(data).forEach(key => {
            const el = form.querySelector(`#${key}`);
            if (el) {
                if (el.type === 'checkbox') el.checked = data[key];
                else el.value = data[key];
            }
        });

        if (data.devices) {
            if (data.devices.central_lines) data.devices.central_lines.forEach(d => window.addCentral_line(d));
            if (data.devices.pivcs) data.devices.pivcs.forEach(d => window.addPivc(d));
        }

        form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        calculateTotalScore();
    }

    function clearForm(clearStorage = true) {
        form.reset();
        deviceCounters = {};
        document.querySelectorAll('.device-entry').forEach(el => el.remove());
        if (clearStorage) localStorage.removeItem('alertToolState_v22');
        currentReview = {};
        calculateTotalScore(); // This will also trigger insight generation
    }
    
    // --- SCORING & INSIGHTS ---
    function calculateTotalScore() {
        let score = 0;
        const data = gatherFormData();

        // 1. Static & Semi-Static Factors
        if (data.age > 65) score += 1;
        score += parseInt(data.admission_type, 10) || 0;
        if (data.los_days > 5) score += 1;
        if (data.severe_comorbidities >= 2) score += 2;
        if (data.after_hours) score += 1;

        // 2. Clinical Assessment Scores from Radios/Checkboxes
        form.querySelectorAll('.score-input:checked').forEach(input => {
            if(input.type === 'radio' || input.type === 'checkbox') {
                 score += parseInt(input.dataset.score, 10) || 0;
            }
        });
        
        // 3. Blood Panel Score
        const bloodScore = calculateBloodScore();
        score += bloodScore;

        // 4. ADDS Score (MAP is handled here)
        const addsScore = calculateADDS();
        if (addsScore.map_low) score += 2; // Add MAP score here

        // Update Footer
        const footerScoreEl = document.getElementById('footer-score');
        const footerCategoryEl = document.getElementById('footer-category');
        const stickyFooter = document.getElementById('sticky-footer');
        footerScoreEl.textContent = score;
        const category = getRiskCategory(score);
        footerCategoryEl.textContent = category.text.split(':')[0].toUpperCase();
        stickyFooter.className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex items-center justify-between z-40 ${category.class}`;
        
        generateClinicalInsights(data, bloodScore, addsScore);
        saveState();
    }
    
    function getRiskCategory(score) {
        if (score >= RISK_CATEGORIES.extremely_high.score) return RISK_CATEGORIES.extremely_high;
        if (score >= RISK_CATEGORIES.high.score) return RISK_CATEGORIES.high;
        if (score >= RISK_CATEGORIES.medium.score) return RISK_CATEGORIES.medium;
        return RISK_CATEGORIES.low;
    }

    function calculateBloodScore() {
        let totalBloodScore = 0;
        const p = (id) => parseFloat(document.getElementById(id).value);
        const updateBadge = (id, score) => {
            const badge = document.getElementById(id);
            if (badge) {
                badge.textContent = `+${score}`;
                badge.className = `blood-score-badge score-${score}`;
            }
        };

        let cr_score = 0; if (p('creatinine') > 171) cr_score = 1; updateBadge('creatinine_blood_score', cr_score); totalBloodScore += cr_score;
        let nlr_score = 0; const nlr = p('neutrophils') / p('lymphocytes'); if (nlr > 5) nlr_score = 1; updateBadge('nlr_blood_score', nlr_score); totalBloodScore += nlr_score;
        let alb_score = 0; if (p('albumin') < 30) alb_score = 1; updateBadge('albumin_blood_score', alb_score); totalBloodScore += alb_score;
        let rdw_score = 0; if (p('rdw') > 15) rdw_score = 1; updateBadge('rdw_blood_score', rdw_score); totalBloodScore += rdw_score;
        let lact_score = 0; if (p('lactate') > 2) lact_score = 2; updateBadge('lactate_blood_score', lact_score); totalBloodScore += lact_score;
        let bili_score = 0; if (p('bilirubin') > 20) bili_score = 1; updateBadge('bilirubin_blood_score', bili_score); totalBloodScore += bili_score;
        let plat_score = 0; if (p('platelets') < 50) plat_score = 1; updateBadge('platelet_blood_score', plat_score); totalBloodScore += plat_score;
        let hb_score = 0; if (p('hemoglobin') < 7) hb_score = 2; updateBadge('hemoglobin_blood_score', hb_score); totalBloodScore += hb_score;
        let gluc_score = 0; if (p('glucose') > 180) gluc_score = 2; updateBadge('glucose_blood_score', gluc_score); totalBloodScore += gluc_score;
        
        document.getElementById('total_blood_score').textContent = totalBloodScore;
        return totalBloodScore;
    }
    
    function calculateADDS() {
        const p = (id) => parseFloat(document.getElementById(id).value);
        let total = 0, map_low = document.getElementById('map_low').checked;
        // ADDS calculation logic here if needed, otherwise just handle MAP
        document.getElementById('calculatedADDSScore').textContent = '...'; // Placeholder
        return { score: total, map_low: map_low };
    }

    function generateClinicalInsights(data, bloodScore, addsScore) {
        const container = document.getElementById('clinicalInsightsContainer');
        const insights = [];
        const createInsight = (text, level) => `<div class="insight-item level-${level}"><svg class="insight-item-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><span class="insight-item-text">${text}</span></div>`;

        // High-Risk Profile
        if (data.age > 65 && data.severe_comorbidities >= 2 && data.admission_type > 0) {
            insights.push(createInsight('<b>High-Risk Profile:</b> Patient has multiple baseline risk factors (age, comorbidities, admission type).', 'medium'));
        }
        // Systemic Inflammation
        if ((data.neutrophils / data.lymphocytes) > 10 && data.lactate > 2) {
            insights.push(createInsight('<b>Systemic Inflammatory Response:</b> High NLR and elevated lactate suggest significant metabolic stress.', 'high'));
        }
        // Multi-Organ Dysfunction
        if (data.creatinine > 171 || data.bilirubin > 20 || data.platelets < 50) {
             insights.push(createInsight('<b>Multi-Organ Dysfunction:</b> Markers for kidney, liver, or hematologic systems are abnormal.', 'high'));
        }
        // Anemia & Oxygen Delivery
        if (data.hemoglobin < 7) {
             insights.push(createInsight('<b>Significant Anemia:</b> Critically low Hemoglobin may impair tissue oxygenation.', 'high'));
        }
        // Shock / Hypoperfusion
        if (data.map_low && data.lactate > 2) {
             insights.push(createInsight('<b>Inadequate Perfusion (Shock):</b> Low MAP with elevated lactate is a critical finding.', 'high'));
        }
        // Fluid Overload
        if (data.fluid_overload) {
            insights.push(createInsight('<b>Fluid Overload:</b> May be straining cardiac and respiratory function.', 'medium'));
        }
        
        container.innerHTML = insights.length ? insights.join('') : '<p class="text-gray-500">No specific risk patterns detected yet.</p>';
    }

    // --- DMR SUMMARY ---
    function generateDMRSummary() {
        const data = gatherFormData();
        const score = document.getElementById('footer-score').textContent;
        const category = getRiskCategory(score).text;
        
        const keyFactors = [];
        if (data.age > 65 && data.severe_comorbidities >= 2) keyFactors.push("High-Risk Profile (Age, Comorbidities)");
        if ((data.neutrophils / data.lymphocytes) > 10) keyFactors.push("Inflammatory Response (High NLR)");
        if (data.creatinine > 171) keyFactors.push("Acute Kidney Injury Marker");
        if (data.platelets < 50) keyFactors.push("Hematologic Stress (Low Platelets)");
        if (data.lactate > 2) keyFactors.push("Metabolic Stress (High Lactate)");
        if (data.map_low) keyFactors.push("Hypotension (MAP < 70)");
        if (data.hemoglobin < 7) keyFactors.push("Significant Anemia");
        if (data.fluid_overload) keyFactors.push("Significant Fluid Overload");

        let summary = `ALERT NURSE REVIEW:
--- PATIENT & REVIEW DETAILS ---
Patient: ${data.patient_initials}-${data.patient_urn_last4}
Location: ${data.ward === 'Other' ? data.wardOther : data.ward} - Room ${data.room_number}
Age: ${data.age}, Admission: ${document.getElementById('admission_type').options[document.getElementById('admission_type').selectedIndex].text}
ICU LOS: ${data.los_days} days, Severe Comorbidities: ${data.severe_comorbidities}

--- RISK ASSESSMENT ---
FINAL SCORE: ${score} (${category})
KEY RISK FACTORS IDENTIFIED:
${keyFactors.length ? keyFactors.map(f => `- ${f}`).join('\n') : 'None'}

--- KEY DATA ---
Vitals: RR ${data.rr_input}, SpO2 ${data.spo2_input}% on ${data.o2_flow_input}L/min, HR ${data.hr_input}, MAP < 70: ${data.map_low ? 'Yes' : 'No'}
Bloods: Cr ${data.creatinine} µmol/L, NLR ${(data.neutrophils/data.lymphocytes).toFixed(1)}, Alb ${data.albumin} g/L, Lactate ${data.lactate}, Plts ${data.platelets}, Hb ${data.hemoglobin} g/dL
Fluid Bal (24h): ${data.fbc_24hr_input} mL. Fluid Overload (>5L): ${data.fluid_overload ? 'Yes' : 'No'}
K+: ${data.k_input} (Replaced: ${data.k_replaced ? 'Y' : 'N'}, Planned: ${data.k_planned ? 'Y' : 'N'})
Mg++: ${data.mg_input} (Replaced: ${data.mg_replaced ? 'Y' : 'N'}, Planned: ${data.mg_planned ? 'Y' : 'N'})

--- CLINICIAN NOTES ---
Reason for ICU Admission: ${data.reason_icu}
ICU Summary: ${data.icu_summary}
Additional Notes: ${data.additionalNotes}
`;
        document.getElementById('emrSummary').value = summary;
    }

    // --- EVENT LISTENERS ---
    function setupEventListeners() {
        document.getElementById('startFullReviewBtn').addEventListener('click', () => { setAppViewMode('full'); clearForm(); document.getElementById('launchScreenModal').style.display = 'none'; });
        document.getElementById('startQuickScoreBtn').addEventListener('click', () => { setAppViewMode('quick'); clearForm(); document.getElementById('launchScreenModal').style.display = 'none'; });
        document.getElementById('startOverBtn').addEventListener('click', () => { if (confirm('Are you sure?')) { clearForm(true); document.getElementById('launchScreenModal').style.display = 'flex'; } });
        
        form.addEventListener('input', calculateTotalScore);
        form.addEventListener('change', calculateTotalScore);

        document.getElementById('generateSummaryButton').addEventListener('click', generateDMRSummary);
        document.getElementById('copySummaryButton').addEventListener('click', () => { document.getElementById('emrSummary').select(); document.execCommand('copy'); alert('Summary copied!'); });
        document.getElementById('addCentralLineButton').addEventListener('click', () => window.addCentral_line());
        document.getElementById('addPivcButton').addEventListener('click', () => window.addPivc());
        document.addEventListener('click', (e) => { if (e.target.matches('.remove-device-btn')) e.target.closest('.device-entry').remove(); });
    }
    
    // --- DYNAMIC CONTENT ---
    function populateStaticContent() {
        const createBloodInput = (label, id, unit) => `<div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-32">${label}</label><div class="flex-grow"><input type="number" step="0.1" id="${id}" class="w-full rounded-md border-2 p-2 text-sm" placeholder="Current"></div><span class="text-xs text-gray-500 w-16">${unit}</span><span id="${id}_blood_score" class="blood-score-badge score-0">+0</span></div>`;
        document.getElementById('scorable-bloods-container').innerHTML = `
            <h3 class="font-semibold text-gray-700 mb-4">Scorable Blood Panel</h3>
            <div class="space-y-3">
                ${createBloodInput('Creatinine', 'creatinine', 'µmol/L')}
                <div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-32">NLR</label><div class="flex-grow grid grid-cols-2 gap-x-2"><input type="number" step="0.1" id="neutrophils" class="w-full rounded-md border-2 p-2 text-sm" placeholder="Neut"><input type="number" step="0.1" id="lymphocytes" class="w-full rounded-md border-2 p-2 text-sm" placeholder="Lymph"></div><span class="text-xs text-gray-500 w-16"></span><span id="nlr_blood_score" class="blood-score-badge score-0">+0</span></div>
                ${createBloodInput('Albumin', 'albumin', 'g/L')}
                ${createBloodInput('RDW', 'rdw', '%')}
                ${createBloodInput('Lactate', 'lactate', 'mmol/L')}
                ${createBloodInput('Bilirubin', 'bilirubin', 'µmol/L')}
                ${createBloodInput('Platelets', 'platelets', 'x10⁹/L')}
                ${createBloodInput('Hemoglobin', 'hemoglobin', 'g/dL')}
                ${createBloodInput('Glucose', 'glucose', 'mg/dL')}
            </div>
            <div class="mt-4 pt-4 border-t text-right font-bold text-lg">Total Blood Score: <span id="total_blood_score" class="text-teal-600">0</span></div>`;

        document.getElementById('nonscorable-bloods-container').innerHTML = `
            <h3 class="font-semibold text-gray-700 mb-2">Key (Non-Scored) Bloods</h3>
            <div class="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                <div><label>K+</label><input type="number" step="0.1" id="k_input" class="mt-1 w-full rounded-md border-2 p-2"><div class="flex gap-x-2 mt-1"><label class="text-xs flex items-center"><input type="checkbox" id="k_replaced" class="mr-1">Replaced</label><label class="text-xs flex items-center"><input type="checkbox" id="k_planned" class="mr-1">Planned</label></div></div>
                <div><label>Mg++</label><input type="number" step="0.1" id="mg_input" class="mt-1 w-full rounded-md border-2 p-2"><div class="flex gap-x-2 mt-1"><label class="text-xs flex items-center"><input type="checkbox" id="mg_replaced" class="mr-1">Replaced</label><label class="text-xs flex items-center"><input type="checkbox" id="mg_planned" class="mr-1">Planned</label></div></div>
            </div>`;
        
        document.getElementById('adds-container').innerHTML = `<h3 class="font-semibold mb-2">ADDS / Vitals</h3><div class="space-y-4"><div><label>Resp Rate</label><input type="number" id="rr_input" class="mt-1 w-full rounded-md border-2 p-2"></div><div><label>SpO2 (%)</label><input type="number" id="spo2_input" class="mt-1 w-full rounded-md border-2 p-2"></div><div><label>Oxygen Flow (L/min)</label><input type="number" id="o2_flow_input" class="mt-1 w-full rounded-md border-2 p-2"></div><div><label>Heart Rate</label><input type="number" id="hr_input" class="mt-1 w-full rounded-md border-2 p-2"></div><div class="p-2 bg-amber-100 rounded-md"><label class="flex items-center font-medium"><input type="checkbox" id="map_low" class="score-input mr-2 h-4 w-4" data-score="2">MAP < 70 mmHg</label></div></div>`;
        
        document.getElementById('scoringContainer').innerHTML = `
            <h2 class="text-xl font-bold border-b pb-3 mb-4">Clinical Risk Factors</h2>
            <div class="space-y-2">
                <label class="list-score-option"><input type="checkbox" class="score-input" data-score="3" id="met_criteria"><span class="score-label">Patient is in MET Criteria</span><span class="score-value">+3</span></label>
                <label class="list-score-option"><input type="checkbox" class="score-input" data-score="2" id="increasing_o2"><span class="score-label">Increasing O₂ Trend</span><span class="score-value">+2</span></label>
                <div><label class="block font-medium mb-1">Gastrointestinal Assessment:</label><select id="gi_assessment" class="score-input w-full rounded-md border-2 p-2"><option value="0">Normal Diet & Bowels</option><option value="1">Modified Diet / Constipated</option><option value="2">NBM/NG/TPN / Ileus</option></select></div>
                <div><label class="block font-medium mb-1">Delirium:</label><select id="delirium" class="score-input w-full rounded-md border-2 p-2"><option value="0">None</option><option value="1">Mild</option><option value="2">Moderate-Severe</option></select></div>
                <div><label class="block font-medium mb-1">Mobility:</label><select id="mobility" class="score-input w-full rounded-md border-2 p-2"><option value="0">Baseline</option><option value="1">Assisted</option><option value="2">Bed-bound</option></select></div>
                <div><label class="block font-medium mb-1">Frailty (Pre-hospital):</label><select id="frailty" class="score-input w-full rounded-md border-2 p-2"><option value="0">Not Frail / Mild</option><option value="1">Moderate-Severe</option></select></div>
                <div><label class="block font-medium mb-1">Staffing (Reducer):</label><select id="staffing" class="score-input w-full rounded-md border-2 p-2"><option value="0">Standard Ratio</option><option value="-1">Enhanced Care (1:1, 1:2)</option></select></div>
            </div>`;
            
        document.getElementById('fluid-assessment-container').innerHTML = `
             <h3 class="font-semibold mb-2">Fluid Status</h3>
             <div class="grid grid-cols-2 gap-4">
                <div><label>24hr Fluid Balance (mL)</label><input type="number" id="fbc_24hr_input" class="mt-1 w-full rounded-md border-2 p-2"></div>
                <div class="p-2 bg-amber-100 rounded-md flex items-center"><label class="flex items-center font-medium"><input type="checkbox" id="fluid_overload" class="score-input mr-2 h-4 w-4" data-score="2">Significant Fluid Overload (>5L)</label></div>
             </div>`;
             
        const wardSelect = document.getElementById('ward');
        const wards = ['CCU', '3A', '3C', '3D', '4A', '4B', '4C', '4D', '5A', '5B', '5C', '5D', '6A', '6B', '6C', '6D', '7A', '7B', '7C', '7D', 'Other'];
        wardSelect.innerHTML = wards.map(w => `<option value="${w}">${w}</option>`).join('');
    }

    // --- DEVICE MANAGEMENT ---
    window.addCentral_line = function(data = {}) { deviceCounters.central = (deviceCounters.central || 0) + 1; document.getElementById('central_lines_container').insertAdjacentHTML('beforeend', `<div class="device-entry bg-white p-3 rounded-md border space-y-2">...</div>`); }
    window.addPivc = function(data = {}) { deviceCounters.pivc = (deviceCounters.pivc || 0) + 1; document.getElementById('pivcs_container').insertAdjacentHTML('beforeend', `<div class="device-entry bg-white p-3 rounded-md border space-y-2">...</div>`); }
        
    initializeApp();
});


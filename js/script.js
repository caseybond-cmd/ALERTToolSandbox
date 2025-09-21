// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE & CONFIG ---
    let currentReview = {};
    const form = document.getElementById('assessmentForm');
    const p = (val) => parseFloat(val);

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
        } else {
            updateRiskAssessment();
        }
    }

    // --- DATA HANDLING ---
    function gatherFormData() {
        const data = {};
        form.querySelectorAll('input, select, textarea').forEach(el => {
            if (el.id) {
                 if (el.type === 'checkbox') data[el.id] = el.checked;
                 else data[el.id] = el.value;
            }
        });
        document.querySelectorAll('.trend-radio-group').forEach(group => {
            const checkedRadio = group.querySelector('input[type="radio"]:checked');
            if (checkedRadio) data[group.dataset.trendId] = checkedRadio.value;
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
                if (el.type === 'checkbox') el.checked = currentReview[key];
                else el.value = currentReview[key];
            } else if (key.endsWith('_trend')) {
                const trendRadios = form.querySelectorAll(`input[name="${key}_radio"]`);
                trendRadios.forEach(radio => { if (radio.value === currentReview[key]) radio.checked = true; });
            }
        });
        
        updateRiskAssessment();

        // Manually trigger events for dynamic fields
        form.querySelectorAll('input[type="date"], input[id*="present"], select[id*="present"], #diet, #cap_refill').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        document.getElementById('pain_score')?.dispatchEvent(new Event('input'));
        document.getElementById('bowels')?.dispatchEvent(new Event('change'));
        document.getElementById('adds_override_checkbox')?.dispatchEvent(new Event('change'));
    }

    function clearForm() {
        form.reset();
        localStorage.removeItem('alertToolState_v26');
        currentReview = {};
        document.querySelectorAll('.desktop-only').forEach(el => el.style.display = '');
        updateRiskAssessment();
    }

    // --- CORE LOGIC: RISK ASSESSMENT ENGINE (RECALIBRATED) ---
    function updateRiskAssessment() {
        const data = gatherFormData();
        
        let score = 0;
        const flags = { red: [], green: [] };

        // --- Desktop Data Scoring ---
        if (p(data.icu_los) > 5) { score += 1; }
        if (data.after_hours) { score += 1; }
        if (p(data.age) > 70) { score += 1; }
        const admissionScore = p(data.admission_type) || 0;
        score += admissionScore;
        if (p(data.severe_comorbidities) >= 3) { score += 2; }

        // --- Bloods Scoring ---
        const bloods = [
            { id: 'creatinine', val: p(data.creatinine), threshold: 150, score: 1, name: 'Creatinine' },
            { id: 'lactate', val: p(data.lactate), threshold: 1.5, score: 2, name: 'Lactate' },
            { id: 'bilirubin', val: p(data.bilirubin), threshold: 20, score: 1, name: 'Bilirubin' },
            { id: 'hb', val: p(data.hb), threshold: 75, isLow: true, score: 2, name: 'Hb' },
            { id: 'platelets', val: p(data.platelets), threshold: 100, isLow: true, score: 1, name: 'Platelets' },
            { id: 'glucose', val: p(data.glucose), threshold: 180, score: 2, name: 'Glucose' },
            { id: 'bun', val: p(data.bun), threshold: 20, score: 1, name: 'BUN' },
            { id: 'k', val: p(data.k), threshold: 3.5, thresholdHigh: 5.5, isRange: true, score: 1, name: 'K+' },
            { id: 'mg', val: p(data.mg), threshold: 0.7, thresholdHigh: 1.2, isRange: true, score: 1, name: 'Mg++' },
            { id: 'sodium', val: p(data.sodium), threshold: 135, thresholdHigh: 145, isRange: true, score: 1, name: 'Sodium' },
        ];

        bloods.forEach(b => {
            let triggered = false;
            if (!isNaN(b.val)) {
                if (b.isLow && b.val < b.threshold) triggered = true;
                else if (b.isRange && (b.val < b.threshold || b.val > b.thresholdHigh)) triggered = true;
                else if (!b.isLow && !b.isRange && b.val > b.threshold) triggered = true;
            }
            if (triggered) { score += b.score; }
            if (data[`${b.id}_trend`] === 'worsening') flags.red.push(`Worsening ${b.name} trend`);
            
            const el = document.getElementById(b.id);
            if (el) { el.classList.toggle('input-abnormal', triggered); }
        });

        // --- A-E Assessment Scoring ---
        let addsResult = calculateADDS(data);
        if (data.adds_override_checkbox && !isNaN(p(data.adds_override_score))) {
            score += p(data.adds_override_score);
        } else {
            score += addsResult.score;
        }
        if (addsResult.metCall) flags.red.push(`MET Call: ${addsResult.metReason}`);
        if (addsResult.trends.length > 0) flags.red.push(...addsResult.trends);

        if(data.airway === 'At Risk') { score += 2; flags.red.push('Airway at Risk'); }
        
        const deliriumScore = p(data.delirium) || 0;
        if (deliriumScore >= 2) { 
            score += deliriumScore; 
            flags.red.push('Delirium (Mod-Severe)');
        }
        
        if (data.cap_refill === '>3s') { score += 2; flags.red.push('Cap Refill > 3s'); }
        
        const weight = p(data.weight);
        const uop_hr = p(data.urine_output_hr);
        if (!isNaN(weight) && weight > 0 && !isNaN(uop_hr)) {
            const uop_ml_kg_hr = uop_hr / weight;
            if (uop_ml_kg_hr < 0.5) { score += 2; flags.red.push(`Oliguria (<0.5mL/kg/hr)`); }
        }
        
        const painScoreVal = p(data.pain_score);
        if (!isNaN(painScoreVal) && painScoreVal >= 7) {
            score += 2;
            flags.red.push(`Severe Pain (Score: ${painScoreVal}/10)`);
        }
        
        // --- O2 Device Scoring ---
        if (data.o2_device === 'HFNP') { score += 1; flags.red.push('High-Flow O₂'); }
        const fio2 = p(data.fio2);
        if (!isNaN(fio2)) {
            if (fio2 >= 40) { score += 3; flags.red.push('High FiO₂ Requirement (≥40%)'); }
            else if (fio2 >= 28) { score += 2; flags.red.push('Moderate FiO₂ Requirement (≥28%)');}
        }

        // --- Devices & Frailty Scoring ---
        if (data.cvad_present) { score += 2; flags.red.push(`CVAD in situ`); }
        if (data.idc_present) { score += 1; flags.red.push('IDC in situ'); }
        if (p(data.drain_output_24hr) > 100) { score += 1; flags.red.push('High drain output (>100mL/24h)');}
        if (p(data.frailty_score) >= 6) { score += 1; flags.red.push(`High Frailty (Score ≥ 6)`); }
        
        // --- Context & Overrides ---
        const staffingScore = Math.max(p(data.ward_staffing) || 0, -3); // Capped at -3
        score += staffingScore; 
        if(staffingScore < 0) flags.green.push(`Protective Staffing (${staffingScore})`);
        
        if (data.manual_override) { 
            score += 3; 
            flags.red.push(`Manual Upgrade: ${data.override_reason || 'Clinical Concern'}`);
        }
        
        // --- Final Flag & Category Logic ---
        if (p(data.icu_los) > 5 && flags.red.length === 0 && score === 1) {
            flags.red.push('Stable Long-Stay');
        }

        let categoryKey;
        if (data.manual_downgrade && data.downgrade_reason) {
            categoryKey = data.manual_downgrade_category;
            flags.green.push(`Manual Downgrade: ${data.downgrade_reason}`);
        } else {
             if (flags.red.length >= 3 || score >= 10) categoryKey = 'RED';
             else if (flags.red.length >= 1 || score >= 3) categoryKey = 'AMBER';
             else categoryKey = 'GREEN';
        }
        
        displayResults(categoryKey, flags, score, data);
        saveState();
        generateDMRSummary(); 
    }

    function calculateADDS(data) {
        let score = 0, metCall = false, metReason = '', trends = [];
        const getScore = (val, ranges) => {
            for (const r of ranges) {
                if ((r.min === -Infinity || val >= r.min) && (r.max === Infinity || val <= r.max)) {
                    if (r.score === 'E') return { metCall: true, metReason: r.note.replace('=>', `(${val}) =>`) };
                    return { score: r.score };
                }
            }
            return { score: 0 };
        };
        const checkParam = (value, ranges, paramName) => {
            if (isNaN(value) || metCall) return;
            const result = getScore(value, ranges);
            if(result.metCall) { metCall = true; metReason = result.metReason; } 
            else { score += result.score; }
        };
        
        const params = ['rr', 'spo2', 'hr', 'sbp', 'temp'];
        params.forEach(p => {
            if(data[`${p}_trend`] === 'worsening') trends.push(`Worsening ${p.toUpperCase()} trend`);
        });

        checkParam(p(data.rr), [{min: -Infinity, max: 4, score: 'E', note: '<=4 => MET'}, {min: 5, max: 8, score: 3}, {min: 9, max: 10, score: 2}, {min: 11, max: 20, score: 0}, {min: 21, max: 24, score: 1}, {min: 25, max: 30, score: 2}, {min: 31, max: 35, score: 3}, {min: 36, max: Infinity, score: 'E', note: '>=36 => MET'}]);
        checkParam(p(data.spo2), [{min: -Infinity, max: 84, score: 'E', note: '<=84 => MET'}, {min: 85, max: 88, score: 3}, {min: 89, max: 90, score: 2}, {min: 91, max: 93, score: 1}, {min: 94, max: Infinity, score: 0}]);
        checkParam(p(data.hr), [{min: -Infinity, max: 30, score: 'E', note: '<=30 => MET'}, {min: 31, max: 40, score: 3}, {min: 41, max: 50, score: 2}, {min: 51, max: 99, score: 0}, {min: 100, max: 109, score: 1}, {min: 110, max: 120, score: 2}, {min: 121, max: 129, score: 1}, {min: 130, max: 139, score: 3}, {min: 140, max: Infinity, score: 'E', note: '>=140 => MET'}]);
        checkParam(p(data.sbp), [{min: -Infinity, max: 40, score: 'E', note: 'extreme low -> MET'}, {min: 41, max: 50, score: 3}, {min: 51, max: 60, score: 2}, {min: 61, max: 70, score: 1}, {min: 71, max: 80, score: 0}, {min: 81, max: 90, score: 3}, {min: 91, max: 100, score: 2}, {min: 101, max: 110, score: 1}, {min: 111, max: 139, score: 0}, {min: 140, max: 180, score: 1}, {min: 181, max: 200, score: 2}, {min: 201, max: 220, score: 3}, {min: 221, max: Infinity, score: 'E', note: '>=221 => MET'}]);
        checkParam(p(data.temp), [{min: -Infinity, max: 35, score: 3}, {min: 35.1, max: 36.0, score: 1}, {min: 36.1, max: 37.5, score: 0}, {min: 37.6, max: 38.0, score: 1}, {min: 38.1, max: 39.0, score: 2}, {min: 39.1, max: Infinity, score: 'E', note: '>=39.1 => MET'}]);
        
        if (data.consciousness === 'Unresponsive') { metCall = true; metReason = 'Unresponsive'; }
        else if (data.consciousness === 'Pain') { score += 2; }
        else if (data.consciousness === 'Voice') { score += 1; }
        
        checkParam(p(data.o2_flow), [{min: 0, max: 5, score: 0}, {min: 6, max: 7, score: 1}, {min: 8, max: 9, score: 2}, {min: 10, max: Infinity, score: 3}]);
        
        const finalADDSScoreEl = document.getElementById('finalADDSScore');
        if(finalADDSScoreEl && !data.adds_override_checkbox) { finalADDSScoreEl.textContent = score; }
        return { score, metCall, metReason, trends };
    }
    
    function displayResults(categoryKey, flags, score, data) {
        const category = CATEGORIES[categoryKey];
        const summaryContainer = document.getElementById('summary-container');
        const footerCategory = document.getElementById('footer-category');
        const footerScore = document.getElementById('footer-score');
        const footerRedFlags = document.getElementById('footer-flags-red');
        const footerGreenFlags = document.getElementById('footer-flags-green');
        const stickyFooter = document.getElementById('sticky-footer');
        
        footerCategory.textContent = category.text;
        footerScore.textContent = score;
        stickyFooter.className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex flex-col z-40 ${category.class}`;
        footerRedFlags.innerHTML = `<span>🚩 ${flags.red.length}</span>`;
        footerGreenFlags.innerHTML = `<span>✅ ${flags.green.length}</span>`;
        
        const plan = generateActionPlan(categoryKey);
        summaryContainer.innerHTML = `<div class="summary-category ${category.class}">${category.text}</div>
            <div class="summary-flags-container mt-4">
                <div><h4 class="flag-list-red">Red Flags (${flags.red.length}):</h4><ul class="list-disc list-inside text-sm text-gray-700">${flags.red.length ? flags.red.map(f => `<li><b>${f}</b></li>`).join('') : '<li>None</li>'}</ul></div>
                <div><h4 class="flag-list-green">Green Flags (${flags.green.length}):</h4><ul class="list-disc list-inside text-sm text-gray-700">${flags.green.length ? flags.green.map(f => `<li><b>${f}</b></li>`).join('') : '<li>None</li>'}</ul></div>
            </div>
            <div class="summary-plan mt-4"><h4>Recommended Action Plan:</h4><p class="text-sm">${plan}</p></div>
            <div class="text-xs text-gray-500 mt-2 text-center cursor-pointer" onclick="this.nextElementSibling.classList.toggle('hidden')">Toggle Score</div>
            <div class="hidden text-center font-bold text-2xl">${score}</div>`;
    }

    function generateActionPlan(categoryKey) {
        switch (categoryKey) {
            case 'RED': return 'Cat 1: Daily review for 72hrs, escalate to ICU liaison/medical team immediately.';
            case 'AMBER': return 'Cat 2: Review q48hrs for 72hrs, nurse-led monitoring.';
            case 'GREEN': return 'Cat 3: Single check within 24hrs, then routine ward care.';
        }
    }
    
    function generateDMRSummary() {
        const data = gatherFormData();
        // DMR generation logic remains largely the same, but would reflect new blood tests
    }

    function setupEventListeners() {
        form.addEventListener('input', updateRiskAssessment);
        form.addEventListener('change', updateRiskAssessment);
        // Other event listeners remain the same
    }

    // --- DYNAMIC CONTENT ---
    function populateStaticContent() {
        const createBloodInput = (label, id, isScored = true) => {
            const scoreClass = isScored ? '' : 'bg-gray-50';
            return `<div class="blood-score-item"><label class="font-medium text-sm">${label}:<input type="number" step="0.1" id="${id}" class="input-field ${scoreClass}" placeholder="Current"></label><div class="trend-radio-group full-review-item" data-trend-id="${id}_trend"><label title="Improving"><input type="radio" name="${id}_trend_radio" value="improving"><span>↑</span></label><label title="Stable"><input type="radio" name="${id}_trend_radio" value="stable" checked><span>→</span></label><label title="Worsening"><input type="radio" name="${id}_trend_radio" value="worsening"><span>↓</span></label></div></div>`;
        };
        const createTrendButtons = (id) => `<div class="trend-radio-group full-review-item" data-trend-id="${id}_trend"><label title="Improving"><input type="radio" name="${id}_trend_radio" value="improving"><span>↑</span></label><label title="Stable"><input type="radio" name="${id}_trend_radio" value="stable" checked><span>→</span></label><label title="Worsening"><input type="radio" name="${id}_trend_radio" value="worsening"><span>↓</span></label></div>`;
        
        document.querySelector('#patient-details-section').innerHTML = `<details class="form-section desktop-only" open><summary>Patient & Clinical Background</summary><div class="form-section-content">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <label>Review Type:<select id="review_type" class="input-field"><option value="post">Post-ICU</option><option value="pre">Pre-ICU</option></select></label>
                <div class="grid grid-cols-2 gap-4"><label>Location:<select id="location" class="input-field"><option>3A</option></select></label><label>Room:<input type="text" id="room_number" class="input-field"></label></div>
                <label>Patient ID:<input type="text" id="patient_id" class="input-field"></label>
                <label>Stepdown Date:<input type="date" id="stepdown_date" class="input-field"></label>
                <label>Age:<input type="number" id="age" class="input-field"></label>
                <label>ICU LOS (days):<input type="number" id="icu_los" class="input-field"></label>
                <label>Admission Type:<select id="admission_type" class="input-field"><option value="0">Elective Surgical</option><option value="1">Emergency Surgical</option><option value="2">Medical/ED</option></select></label>
                <label class="flex items-center pt-6"><input type="checkbox" id="after_hours" class="input-checkbox"> After-Hours Discharge</label>
                <label class="md:col-span-2">Severe Comorbidities (≥3):<input type="number" id="severe_comorbidities" class="input-field"></label>
            </div>
            </div></details>`;
            
        document.querySelector('#bloods-section').innerHTML = `<details class="form-section" open><summary>Scorable Blood Panel</summary><div class="form-section-content">
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                ${createBloodInput('Creatinine (>150)', 'creatinine')}
                ${createBloodInput('Lactate (>1.5)', 'lactate')}
                ${createBloodInput('Bilirubin (>20)', 'bilirubin')}
                ${createBloodInput('Hb (<75)', 'hb')}
                ${createBloodInput('Platelets (<100)', 'platelets')}
                ${createBloodInput('Glucose (>180)', 'glucose')}
                ${createBloodInput('BUN (>20)', 'bun')}
                ${createBloodInput('Sodium (135-145)', 'sodium')}
                ${createBloodInput('K+ (3.5-5.5)', 'k')}
                ${createBloodInput('Mg++ (0.7-1.2)', 'mg')}
            </div></div></details>`;
        
        document.getElementById('assessment-section').innerHTML = `<details class="form-section" open><summary>A-E Assessment & Context</summary><div class="form-section-content">
            <h3 class="assessment-section-title">Core Vitals (ADDS Entry)</h3>
            <div class="assessment-grid" style="align-items: end;">
                <div><label>Resp Rate:</label><div class="flex items-center gap-2"><input type="number" id="rr" class="input-field">${createTrendButtons('rr')}</div></div>
                <div><label>SpO2 (%):</label><div class="flex items-center gap-2"><input type="number" id="spo2" class="input-field">${createTrendButtons('spo2')}</div></div>
                <div><label>O₂ Device:<select id="o2_device" class="input-field"><option value="RA">Room Air</option><option value="NP">Nasal Prongs</option><option value="HFNP">High-Flow</option><option value="NIV">NIV/CPAP</option></select></label><div id="fio2_container"><label class="text-xs w-full">FiO2 (%):<input type="number" id="fio2" class="input-field"></label></div></div>
                <div><label>Heart Rate:</label><div class="flex items-center gap-2"><input type="number" id="hr" class="input-field">${createTrendButtons('hr')}</div></div>
                <div><label>Systolic BP:</label><div class="flex items-center gap-2"><input type="number" id="sbp" class="input-field">${createTrendButtons('sbp')}</div></div>
                <div><label>Temperature (°C):</label><div class="flex items-center gap-2"><input type="number" step="0.1" id="temp" class="input-field">${createTrendButtons('temp')}</div></div>
                <label>Consciousness:<select id="consciousness" class="input-field"><option value="Alert">Alert</option><option value="Voice">Voice</option><option value="Pain">Pain</option><option value="Unresponsive">Unresponsive</option></select></label>
                <div class="lg:col-span-1">
                    <label>Pain Score (0-10):<input type="number" id="pain_score" class="input-field" min="0" max="10"></label>
                </div>
            </div>
            <div class="mt-6 bg-teal-50 p-4 rounded-lg border border-teal-200 text-center"><span class="text-sm font-medium text-gray-500">ADDS SCORE</span><div id="finalADDSScore" class="font-bold text-5xl my-2">0</div></div>
            <div class="mt-6">
                <h3 class="assessment-section-title">Assessment Details</h3>
                <div class="assessment-grid">
                    <label>Airway:<select id="airway" class="input-field"><option>Patent</option><option>At Risk</option><option>Tracheostomy</option></select></label>
                    <label>Cap Refill:<select id="cap_refill" class="input-field"><option value="<3s">< 3 sec</option><option value=">3s">> 3 sec</option></select></label>
                    <label>Urine Output (last hr, mL):<input type="number" id="urine_output_hr" class="input-field"></label>
                    <label>Delirium:<select id="delirium" class="input-field"><option value="0">None</option><option value="1">Mild</option><option value="2">Mod-Severe</option></select></label>
                    <label>Frailty Score (CFS):<input type="number" id="frailty_score" class="input-field" min="1" max="9"></label>
                </div>
            </div>
        </div></details>`;
        
        document.getElementById('devices-section').innerHTML = `<details class="form-section"><summary>Devices</summary><div class="form-section-content">
            <div class="grid grid-cols-2 gap-4">
                <label class="flex items-center"><input type="checkbox" id="cvad_present" class="input-checkbox">CVAD Present</label>
                <label class="flex items-center"><input type="checkbox" id="idc_present" class="input-checkbox">IDC Present</label>
                <label class="col-span-2">High Drain Output (>100mL/24h):<input type="number" id="drain_output_24hr" class="input-field"></label>
            </div>
            </details>`;

        document.getElementById('context-section').innerHTML = `<details class="form-section"><summary>Context & Overrides</summary><div class="form-section-content"><div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label class="font-medium text-sm">Ward Staffing (Reducer):</label><select id="ward_staffing" class="input-field"><option value="0">Standard</option><option value="-0.5">1:3</option><option value="-1">1:2/Monitored</option><option value="-2">1:1</option></select></div>
            <div class="sm:col-span-2">
                <label class="flex items-center"><input type="checkbox" id="manual_override" class="input-checkbox"> Manual Upgrade</label>
                <textarea id="override_reason" class="input-field mt-2" placeholder="Reason..."></textarea>
            </div>
            <div class="sm:col--span-2">
                <label class="flex items-center"><input type="checkbox" id="manual_downgrade" class="input-checkbox"> Manual Downgrade</label>
                <div id="downgrade_details_container" class="hidden mt-2">
                    <label>New Category:<select id="manual_downgrade_category" class="input-field mb-2"><option value="AMBER">Amber</option><option value="GREEN">Green</option></select></label>
                    <textarea id="downgrade_reason" class="input-field" placeholder="Reason..."></textarea>
                </div>
            </div>
        </div></div></details>`;
        
        // Simplified setup for demonstration
        form.addEventListener('input', updateRiskAssessment);
        form.addEventListener('change', updateRiskAssessment);
        initializeApp();
    }
    
    // Call the populate function to build the initial UI
    populateStaticContent();
});
// --- SCRIPT END ---

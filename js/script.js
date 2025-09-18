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
            if (el.id) data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
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
            }
        });
        if (isHandoff) {
            document.getElementById('desktop-entry-container').style.display = 'none';
        }
        updateRiskAssessment();
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
    // --- START of CHANGES ---
    function updateRiskAssessment() {
        const data = gatherFormData();
        if (Object.keys(data).length === 0) return;
        
        let score = 0;
        const flags = { red: [], green: [] };

        // Desktop Data Scoring
        if (p(data.icu_los) > 3) {
            score += 1;
            flags.red.push('ICU Stay > 3 days');
        }
        if (data.after_hours) {
            score += 1;
            flags.red.push('After-hours discharge');
        }
        if(p(data.age) > 65) {
            score += 1;
            flags.red.push('Age > 65 years');
        }
        const admissionScore = p(data.admission_type) || 0;
        if (admissionScore > 0) {
            score += admissionScore;
            const admissionText = form.querySelector('#admission_type option:checked').textContent;
            flags.red.push(`Admission: ${admissionText}`);
        }
        if (p(data.severe_comorbidities) >= 2) {
            score += 2;
            flags.red.push(`Severe comorbidities (≥2)`);
        }

        // Bloods Scoring
        const bloods = [
            { id: 'creatinine', val: p(data.creatinine), threshold: 171, score: 1, trend: data.creatinine_trend, name: 'Creatinine' },
            { id: 'lactate', val: p(data.lactate), threshold: 1.5, score: 2, trend: data.lactate_trend, name: 'Lactate' },
            { id: 'bilirubin', val: p(data.bilirubin), threshold: 20, score: 1, trend: data.bilirubin_trend, name: 'Bilirubin' },
            { id: 'platelets', val: p(data.platelets), threshold: 100, isLow: true, score: 1, trend: data.platelet_trend, name: 'Platelets' },
            { id: 'hb', val: p(data.hb), threshold: 8, isLow: true, score: 2, trend: data.hb_trend, name: 'Hb' },
            { id: 'glucose', val: p(data.glucose), threshold: 180, score: 2, trend: data.glucose_trend, name: 'Glucose' },
            { id: 'k', val: p(data.k), thresholdLow: 3.5, thresholdHigh: 5.5, score: 1, trend: data.k_trend, name: 'K+' },
            { id: 'mg', val: p(data.mg), thresholdLow: 0.7, thresholdHigh: 1.2, score: 1, trend: data.mg_trend, name: 'Mg++' },
            { id: 'albumin', val: p(data.albumin), threshold: 30, isLow: true, score: 1, trend: data.albumin_trend, name: 'Albumin' },
            { id: 'crp', val: p(data.crp), threshold: 100, score: 1, trend: data.crp_trend, name: 'CRP' }
        ];

        bloods.forEach(b => {
            let triggered = false;
            if (!isNaN(b.val)) {
                if (b.isLow && b.val < b.threshold) triggered = true;
                else if (b.thresholdHigh && (b.val < b.thresholdLow || b.val > b.thresholdHigh)) triggered = true;
                else if (!b.isLow && !b.thresholdHigh && b.val > b.threshold) triggered = true;
            }
            
            b.isTriggered = triggered; // Store trigger state for highlighting

            if (triggered) {
                score += b.score;
                flags.red.push(`Abnormal ${b.name} (${b.val})`);
            }
            if (b.trend === 'worsening') flags.red.push(`Worsening ${b.name} trend`);
        });
        
        // Real-time highlighting of abnormal blood fields
        bloods.forEach(b => {
            const el = document.getElementById(b.id);
            if (el) {
                el.classList.toggle('input-abnormal', b.isTriggered);
            }
        });
        
        // Glucose Control Check
        if (data.glucose_control) {
            score += 1;
            flags.red.push('Poorly controlled glucose');
        }

        // A-E Assessment Scoring
        const addsResult = calculateADDS(data);
        score += addsResult.score;
        if (addsResult.metCall) flags.red.push(`MET Call: ${addsResult.metReason}`);
        if (addsResult.reasons.length > 0) {
            flags.red.push(...addsResult.reasons);
        }
        
        if(data.airway === 'At Risk') {
            score += 2;
            flags.red.push('Airway at Risk');
        }
        
        const deliriumScore = p(data.delirium) || 0;
        if (deliriumScore > 0) {
            score += deliriumScore;
            flags.red.push('Delirium Present');
        }

        // Context & Frailty Scoring
        if(data.complex_device) {
            score += 2;
            flags.red.push('Complex device present');
        }
        if(p(data.frailty_score) >= 5) {
            score += 1;
            flags.red.push(`Frailty score ≥ 5`);
        }
        const staffingScore = p(data.ward_staffing) || 0;
        score += staffingScore; 
        if(staffingScore < 0) flags.green.push(`Protective Staffing (${staffingScore})`);

        // Override
        if (data.manual_override) {
            score += 3;
            flags.red.push(`Manual Override: ${data.override_reason || 'Clinical Concern'}`);
        }
        
        // FINAL CATEGORY CALCULATION
        let categoryKey;
        if (flags.red.length >= 3 || score >= 10) categoryKey = 'RED';
        else if (flags.red.length >= 1 || score >= 3) categoryKey = 'AMBER';
        else categoryKey = 'GREEN';
        
        if (p(data.icu_los) > 3 && flags.red.length === 0) {
             flags.green.push('Stable Long-Stay');
        }

        displayResults(categoryKey, flags, score, data);
        
        saveState();
        generateDMRSummary(); 
    }
    // --- END of CHANGES ---

    function calculateADDS(data) {
        let score = 0, metCall = false, metReason = '';
        let reasons = [];

        const getScore = (val, ranges, paramName) => {
            for (const r of ranges) {
                if ((r.min === -Infinity || val >= r.min) && (r.max === Infinity || val <= r.max)) {
                    if (r.score === 'E') return { metCall: true, metReason: r.note.replace('=>', `(${val}) =>`) };
                    if (r.score > 0) {
                        reasons.push(`${paramName} abnormal (${val})`);
                    }
                    return { score: r.score };
                }
            }
            return { score: 0 };
        };

        const checkParam = (value, ranges, paramName) => {
            if (isNaN(value) || metCall) return;
            const result = getScore(value, ranges, paramName);
            if(result.metCall) { metCall = true; metReason = result.metReason; } 
            else { score += result.score; }
        };
        
        checkParam(p(data.rr), [{min: -Infinity, max: 4, score: 'E', note: '<=4 => MET'}, {min: 5, max: 8, score: 3}, {min: 9, max: 10, score: 2}, {min: 11, max: 20, score: 0}, {min: 21, max: 24, score: 1}, {min: 25, max: 30, score: 2}, {min: 31, max: 35, score: 3}, {min: 36, max: Infinity, score: 'E', note: '>=36 => MET'}], 'Resp Rate');
        checkParam(p(data.spo2), [{min: -Infinity, max: 84, score: 'E', note: '<=84 => MET'}, {min: 85, max: 88, score: 3}, {min: 89, max: 90, score: 2}, {min: 91, max: 93, score: 1}, {min: 94, max: Infinity, score: 0}], 'SpO2');
        checkParam(p(data.hr), [{min: -Infinity, max: 30, score: 'E', note: '<=30 => MET'}, {min: 31, max: 40, score: 3}, {min: 41, max: 50, score: 2}, {min: 51, max: 99, score: 0}, {min: 100, max: 109, score: 1}, {min: 110, max: 120, score: 2}, {min: 121, max: 129, score: 1}, {min: 130, max: 139, score: 3}, {min: 140, max: Infinity, score: 'E', note: '>=140 => MET'}], 'Heart Rate');
        checkParam(p(data.sbp), [{min: -Infinity, max: 40, score: 'E', note: 'extreme low -> MET'}, {min: 41, max: 50, score: 3}, {min: 51, max: 60, score: 2}, {min: 61, max: 70, score: 1}, {min: 71, max: 80, score: 0}, {min: 81, max: 90, score: 3}, {min: 91, max: 100, score: 2}, {min: 101, max: 110, score: 1}, {min: 111, max: 139, score: 0}, {min: 140, max: 180, score: 1}, {min: 181, max: 200, score: 2}, {min: 201, max: 220, score: 3}, {min: 221, max: Infinity, score: 'E', note: '>=221 => MET'}], 'Systolic BP');
        checkParam(p(data.temp), [{min: -Infinity, max: 35, score: 3}, {min: 35.1, max: 36.0, score: 1}, {min: 36.1, max: 37.5, score: 0}, {min: 37.6, max: 38.0, score: 1}, {min: 38.1, max: 39.0, score: 2}, {min: 39.1, max: Infinity, score: 'E', note: '>=39.1 => MET'}], 'Temperature');

        if (data.consciousness === 'Unresponsive') { 
            metCall = true; 
            metReason = 'Unresponsive'; 
        } else if (data.consciousness === 'Pain') {
            score += 2;
            reasons.push('Responds to Pain');
        } else if (data.consciousness === 'Voice') {
            score += 1;
            reasons.push('Responds to Voice');
        }
        
        if (data.o2_device === 'HFNP') {
            score += 1;
            reasons.push('Using High-Flow O₂');
        }
        
        checkParam(p(data.o2_flow), [{min: 0, max: 5, score: 0}, {min: 6, max: 7, score: 1}, {min: 8, max: 9, score: 2}, {min: 10, max: Infinity, score: 3}], 'O₂ Flow');
        checkParam(p(data.fio2), [{min: 28, max: 39, score: 2}, {min: 40, max: Infinity, score: 3}], 'FiO2');
        
        if(document.getElementById('finalADDSScore')) document.getElementById('finalADDSScore').textContent = score;
        return { score, metCall, metReason, reasons };
    }
    
    function displayResults(categoryKey, flags, score, data) {
        const category = CATEGORIES[categoryKey];
        const summaryContainer = document.getElementById('summary-container');
        const footerCategory = document.getElementById('footer-category');
        const footerScore = document.getElementById('footer-score');
        const footerRedFlags = document.getElementById('footer-flags-red');
        const footerGreenFlags = document.getElementById('footer-flags-green');
        const stickyFooter = document.getElementById('sticky-footer');

        const combinationAlerts = [];
        const isSurgical = ['0', '1'].includes(data.admission_type);
        const isNotAlert = ['Voice', 'Pain', 'Unresponsive'].includes(data.consciousness);

        if (p(data.lactate) > 1.5 && p(data.sbp) < 90) {
            combinationAlerts.push('<b>Shock Profile:</b> High Lactate with low Blood Pressure is a critical sign of shock.');
        }
        if (p(data.creatinine) > 171 && p(data.rr) > 25) {
            combinationAlerts.push('<b>Cardio-Renal Profile:</b> High Creatinine with a high Respiratory Rate may indicate fluid overload.');
        }
        if (p(data.crp) > 100 && p(data.creatinine) > 171) {
            combinationAlerts.push('<b>Inflammation & Kidney Injury:</b> High CRP with high Creatinine suggests systemic inflammation is impacting kidney function.');
        }
        if (p(data.albumin) < 30 && p(data.temp) > 38.0) {
            combinationAlerts.push('<b>Malnutrition & Infection:</b> Low Albumin with a fever may indicate a poor response to infection.');
        }
        if (p(data.hb) < 8 && p(data.hr) > 110) {
            combinationAlerts.push('<b>Anemia & Tachycardia:</b> Low Haemoglobin with a high Heart Rate suggests cardiovascular strain.');
        }
        if (p(data.icu_los) > 3 && p(data.delirium) > 0) {
            combinationAlerts.push('<b>Deconditioning & Delirium:</b> A long ICU stay combined with new confusion is a strong predictor of poor outcomes.');
        }
        if (p(data.spo2) < 91 && isNotAlert) {
            combinationAlerts.push('<b>Hypoxia & Neurological Impairment:</b> Low oxygen saturation with an altered level of consciousness is a medical emergency.');
        }
        if (p(data.bilirubin) > 20 && p(data.creatinine) > 171) {
            combinationAlerts.push('<b>Multi-Organ Dysfunction:</b> Concurrent high Bilirubin (liver) and Creatinine (kidney) indicates a severe systemic illness.');
        }
        if (p(data.platelets) < 100 && isSurgical) {
            combinationAlerts.push('<b>Post-Operative Bleeding Risk:</b> Low Platelets in a surgical patient is a major risk factor for bleeding.');
        }
        if (p(data.glucose) > 180 && p(data.crp) > 100) {
             combinationAlerts.push('<b>Inflammatory Hyperglycemia:</b> High blood sugar during a major inflammatory response is associated with poor outcomes.');
        }
        if (p(data.fio2) > 40 && p(data.rr) > 25) {
            combinationAlerts.push('<b>Escalating Respiratory Failure:</b> High oxygen requirement with a high respiratory rate suggests therapy is not effective.');
        }
        if (p(data.age) > 65 && p(data.frailty_score) >= 5 && isSurgical) {
            combinationAlerts.push('<b>Vulnerable Surgical Patient:</b> The combination of older age, frailty, and recent surgery presents an extremely high risk for complications.');
        }

        const alertsHtml = combinationAlerts.length > 0 ? `
            <div class="summary-plan mt-4 border-l-4 border-red-500">
                <h4>🚨 Critical Combination Alerts:</h4>
                <ul class="list-disc list-inside text-sm text-gray-700">${combinationAlerts.map(alert => `<li>${alert}</li>`).join('')}</ul>
            </div>
        ` : '';

        footerCategory.textContent = category.text;
        footerScore.textContent = score;
        stickyFooter.className = `fixed bottom-0 left-0 right-0 p-1 shadow-lg transition-colors duration-300 flex items-center justify-between z-40 ${category.class}`;

        footerRedFlags.innerHTML = `<span>🚩 ${flags.red.length}</span>`;
        footerGreenFlags.innerHTML = `<span>✅ ${flags.green.length}</span>`;

        const plan = generateActionPlan(categoryKey, flags.red);
        
        summaryContainer.innerHTML = `
            <div class="summary-category ${category.class}">${category.text} (Score: ${score})</div>
            ${alertsHtml}
            <div class="summary-flags-container mt-4">
                <div>
                    <h4 class="flag-list-red">Red Flags (${flags.red.length}):</h4>
                    <ul class="list-disc list-inside text-sm text-gray-700">${flags.red.length ? flags.red.map(f => `<li>${f}</li>`).join('') : '<li>None</li>'}</ul>
                </div>
                <div>
                    <h4 class="flag-list-green">Protective Flags (${flags.green.length}):</h4>
                    <ul class="list-disc list-inside text-sm text-gray-700">${flags.green.length ? flags.green.map(f => `<li>${f}</li>`).join('') : '<li>None</li>'}</ul>
                </div>
            </div>
            <div class="summary-plan mt-4">
                <h4>Recommended Action Plan:</h4>
                <p class="text-sm">${plan}</p>
            </div>`;
    }

    function generateActionPlan(categoryKey, flags) {
        switch (categoryKey) {
            case 'RED':
                let redPlan = 'Cat 1: Daily review for 72hrs, escalate to ICU liaison/medical team immediately. ';
                if (flags.some(f => f.includes('Creatinine'))) redPlan += 'Repeat Creatinine in 24h. ';
                if (flags.some(f => f.includes('Lactate'))) redPlan += 'Repeat Lactate in 6h. ';
                return redPlan;
            case 'AMBER': return 'Cat 2: Review q48hrs for 72hrs, nurse-led monitoring.';
            case 'GREEN': return 'Cat 3: Single check within 24hrs, then routine ward care.';
        }
    }

    function generateDMRSummary() {
        const data = gatherFormData();
        const score = document.getElementById('footer-score').textContent;
        const categoryText = document.getElementById('footer-category').textContent;
        const flags = {
            red: Array.from(document.querySelectorAll('#summary-container .flag-list-red li')).map(li => li.textContent),
            green: Array.from(document.querySelectorAll('#summary-container .flag-list-green li')).map(li => li.textContent)
        };
        const plan = generateActionPlan(categoryText.split(':')[0].replace('CAT ', ''), flags.red);
        
        let stableLongStay = (p(data.icu_los) > 3 && flags.red.length === 0) ? " (Stable Long-Stay)" : "";

        const summary = `
ALERT RISK ASSESSMENT
---------------------
PATIENT: ${data.patient_id || 'N/A'} | Ward: ${data.location || 'N/A'}-${data.room_number || 'N/A'} | LOS: ${data.icu_los || 'N/A'} days${stableLongStay}
CATEGORY: ${categoryText} (Score: ${score})
ACTION PLAN: ${plan}
---------------------
RED FLAGS IDENTIFIED:
${flags.red.length ? flags.red.map(f => `- ${f}`).join('\n') : '- None'}
---------------------
PROTECTIVE FLAGS:
${flags.green.length ? flags.green.map(f => `- ${f}`).join('\n') : '- None'}
---------------------
A-E ASSESSMENT (ADDS: ${calculateADDS(data).score}):
A: ${data.airway}
B: RR ${data.rr}, SpO2 ${data.spo2} on ${data.o2_device} (Flow: ${data.o2_flow}, FiO2: ${data.fio2}, PEEP: ${data.peep}, PS: ${data.ps})
C: HR ${data.hr}, BP ${data.sbp}/${data.dbp}
D: Conscious: ${data.consciousness}, Delirium: ${data.delirium === '0' ? 'None' : 'Present'}
E: Temp ${data.temp}
---------------------
KEY DATA:
- Age: ${data.age}, Admission: ${document.getElementById('admission_type').options[document.getElementById('admission_type').selectedIndex].text}
- Comorbidities: ${data.severe_comorbidities || 'N/A'}
- Bloods: Cr ${data.creatinine}(${data.creatinine_trend}), Lac ${data.lactate}(${data.lactate_trend}), Bili ${data.bilirubin}(${data.bilirubin_trend}), Plt ${data.platelets}(${data.platelet_trend}), Hb ${data.hb}(${data.hb_trend}), Gluc ${data.glucose}(${data.glucose_trend}), K ${data.k}(${data.k_trend}), Mg ${data.mg}(${data.mg_trend}), Alb ${data.albumin}(${data.albumin_trend}), CRP ${data.crp}(${data.crp_trend})
- Devices: ${data.devices_list || "None"}
- Frailty: ${data.frailty_score || "N/A"}
- Override: ${data.manual_override ? data.override_reason : 'No'}
---------------------
CLINICAL CONTEXT:
- Reason for ICU: ${data.reason_icu || 'N/A'}
- ICU Summary: ${data.icu_summary || 'N/A'}
- PMH: ${data.pmh || 'N/A'}
- GOC: ${data.goc} ${data.goc_details ? `(${data.goc_details})` : ''}
`.trim();

        document.getElementById('emrSummary').value = summary;
    }

    // --- EVENT LISTENERS ---
    // --- START of CHANGES ---
    function setupEventListeners() {
        ['startFullReviewBtn', 'startQuickScoreBtn', 'resumeReviewBtn', 'loadDataBtn'].forEach(id => {
            document.getElementById(id).addEventListener('click', (e) => {
                const isQuick = id === 'startQuickScoreBtn';
                const isResume = id === 'resumeReviewBtn' || id === 'loadDataBtn';

                if (isResume) {
                    document.getElementById('pasteContainer').style.display = 'block';
                    return;
                }
                
                clearForm();
                document.getElementById('launchScreenModal').style.display = 'none';
                document.getElementById('main-content').style.visibility = 'visible';
                if(isQuick) {
                    document.getElementById('desktop-entry-container').style.display = 'none';
                }
            });
        });
        
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
                clearForm(true);
                document.getElementById('main-content').style.visibility = 'hidden';
                document.getElementById('launchScreenModal').style.display = 'flex';
            }
        });
        
        form.addEventListener('input', updateRiskAssessment);
        form.addEventListener('change', updateRiskAssessment);

        document.getElementById('copySummaryButton').addEventListener('click', () => {
            const summaryEl = document.getElementById('emrSummary');
            summaryEl.select();
            summaryEl.setSelectionRange(0, 99999); // For mobile
            document.execCommand('copy');
            alert('DMR Summary Copied to Clipboard!');
        });
        
        document.getElementById('generateHandoffBtn').addEventListener('click', () => {
            const handoffData = {};
            const desktopFields = ['review_type', 'location', 'room_number', 'patient_id', 'stepdown_date', 'after_hours', 'icu_los', 'age', 'admission_type', 'goc', 'goc_details', 'reason_icu', 'icu_summary', 'pmh', 'severe_comorbidities', 'creatinine', 'creatinine_trend', 'lactate', 'lactate_trend', 'bilirubin', 'bilirubin_trend', 'platelets', 'platelet_trend', 'hb', 'hb_trend', 'glucose', 'glucose_trend', 'k', 'k_trend', 'mg', 'mg_trend', 'albumin', 'albumin_trend', 'crp', 'crp_trend'];
            desktopFields.forEach(id => { const el = document.getElementById(id); if(el) handoffData[id] = el.type === 'checkbox' ? el.checked : el.value; });
            const key = btoa(JSON.stringify(handoffData));
            navigator.clipboard.writeText(key).then(() => alert('Handoff key copied to clipboard!'));
        });

        const o2DeviceEl = document.getElementById('o2_device');
        if (o2DeviceEl) {
            o2DeviceEl.addEventListener('change', e => {
                const device = e.target.value;
                const showFlow = ['NP', 'HFNP', 'NIV'].includes(device);
                const showFiO2 = ['HFNP', 'NIV'].includes(device);
                const showNivSettings = device === 'NIV';

                document.getElementById('o2_flow_container').classList.toggle('hidden', !showFlow);
                document.getElementById('fio2_container').classList.toggle('hidden', !showFiO2);
                document.getElementById('peep_ps_container').classList.toggle('hidden', !showNivSettings);
            });
        }

        const gocEl = document.getElementById('goc');
        if (gocEl) {
            gocEl.addEventListener('change', e => {
                const showDetails = ['B', 'C'].includes(e.target.value);
                document.getElementById('goc_details_container').classList.toggle('hidden', !showDetails);
            });
        }
    }
    // --- END of CHANGES ---

    // --- DYNAMIC CONTENT ---
    // --- START of CHANGES ---
    function populateStaticContent() {
        const createBloodInput = (label, id, trend=true) => {
            let glucoseControlHtml = '';
            if (id === 'glucose') {
                glucoseControlHtml = `
                    <label class="text-xs flex items-center mt-1">
                        <input type="checkbox" id="glucose_control" class="input-checkbox !h-4 !w-4">
                        Poorly Controlled
                    </label>`;
            }

            return `
            <div class="blood-score-item">
                <label class="font-medium text-sm">${label}:
                    <input type="number" step="0.1" id="${id}" class="input-field" placeholder="Current">
                </label>
                <label class="text-xs">Trend: <select id="${id}_trend" class="input-field"><option value="stable">Stable</option><option value="worsening">Worsening</option><option value="improving">Improving</option></select></label>
                ${glucoseControlHtml}
            </div>`;
        };

        document.getElementById('bloods-container').innerHTML = `<h2 class="form-section-title">Scorable Blood Panel</h2><div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">${createBloodInput('Creatinine (µmol/L)', 'creatinine')}${createBloodInput('Lactate (mmol/L)', 'lactate')}${createBloodInput('Bilirubin (µmol/L)', 'bilirubin')}${createBloodInput('Platelets (x10⁹/L)', 'platelets')}${createBloodInput('Hb (g/L)', 'hb')}${createBloodInput('Glucose (mmol/L)', 'glucose')}${createBloodInput('K+ (mmol/L)', 'k')}${createBloodInput('Mg++ (mmol/L)', 'mg')}${createBloodInput('Albumin (g/L)', 'albumin')}${createBloodInput('CRP (mg/L)', 'crp')}</div>`;
       
        document.getElementById('assessment-container').innerHTML = `<h2 class="form-section-title">A-E Assessment (ADDS)</h2>
            <div class="space-y-6">
                <div><h3 class="assessment-section-title">A: Airway</h3><select id="airway" class="input-field"><option value="Clear">Clear and maintained</option><option value="At Risk">Airway at risk / requires adjunct</option></select></div>
                <div>
                    <h3 class="assessment-section-title">B: Breathing</h3>
                    <div class="assessment-grid">
                        <label>Resp Rate:<input type="number" id="rr" class="input-field"></label>
                        <label>SpO2 (%):<input type="number" id="spo2" class="input-field"></label>
                        <label>O₂ Device:<select id="o2_device" class="input-field"><option value="RA">Room Air</option><option value="NP">Nasal Prongs</option><option value="HFNP">High-Flow</option><option value="NIV">NIV/CPAP</option></select></label>
                        <div id="o2_flow_container" class="hidden"><label>Flow (L/min):<input type="number" id="o2_flow" class="input-field"></label></div>
                        <div id="fio2_container" class="hidden"><label>FiO2 (%):<input type="number" id="fio2" class="input-field"></label></div>
                        <div id="peep_ps_container" class="hidden grid grid-cols-2 gap-2"><label>PEEP:<input type="number" id="peep" class="input-field"></label><label>PS:<input type="number" id="ps" class="input-field"></label></div>
                    </div>
                </div>
                <div><h3 class="assessment-section-title">C: Circulation</h3><div class="assessment-grid"><label>Heart Rate:<input type="number" id="hr" class="input-field"></label><label>Systolic BP:<input type="number" id="sbp" class="input-field"></label><label>Diastolic BP:<input type="number" id="dbp" class="input-field"></label></div></div>
                <div><h3 class="assessment-section-title">D: Disability</h3><div class="assessment-grid"><label>Consciousness:<select id="consciousness" class="input-field"><option value="Alert">Alert</option><option value="Voice">Voice</option><option value="Pain">Pain</option><option value="Unresponsive">Unresponsive</option></select></label><label>Delirium:<select id="delirium" class="input-field"><option value="0">None</option><option value="1">Mild</option><option value="2">Mod-Severe</option></select></label></div></div>
                <div><h3 class="assessment-section-title">E: Exposure</h3><label>Temperature (°C):<input type="number" step="0.1" id="temp" class="input-field"></label></div>
            </div>
            <div class="mt-6 bg-teal-50 p-4 rounded-lg border border-teal-200 text-center relative">
                 <div id="met-alert-container" class="met-alert absolute top-2 right-2"></div>
                <span class="text-sm font-medium text-gray-500">ADDS SCORE</span>
                <div id="finalADDSScore" class="font-bold text-5xl my-2">0</div>
            </div>`;
            
        document.getElementById('scoringContainer').innerHTML = `<h2 class="form-section-title">Context, Devices & Frailty</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label class="font-medium text-sm">Ward Placement/Staffing (Reducer):</label><select id="ward_staffing" class="input-field"><option value="0">1:4+ Standard</option><option value="-0.5">1:3</option><option value="-1">1:2</option><option value="-2">1:1</option><option value="-1">Monitored Bed</option></select></div>
                <div><label class="font-medium text-sm">Frailty Score (Rockwood CFS):</label><input type="number" id="frailty_score" class="input-field" min="1" max="9"></div>
                <div class="sm:col-span-2"><label class="flex items-center"><input type="checkbox" id="complex_device" class="input-checkbox"> Complex Device Present</label></div>
                <div class="sm:col-span-2"><label class="font-medium text-sm">Devices List (for DMR):</label><textarea id="devices_list" class="input-field" rows="2"></textarea></div>
                <div class="sm:col-span-2"><label class="flex items-center"><input type="checkbox" id="manual_override" class="input-checkbox"> Manual Override / Clinical Concern</label><textarea id="override_reason" class="input-field mt-2" placeholder="Reason for override..."></textarea></div>
            </div>`;
    }
    // --- END of CHANGES ---
        
    initializeApp();
});
// --- SCRIPT END ---

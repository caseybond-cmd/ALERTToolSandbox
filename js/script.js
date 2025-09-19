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
    // --- MINOR REFACTOR of gatherFormData ---
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
    
    // --- MINOR REFACTOR of loadReviewData ---
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
            { id: 'mg', val: p(data.mg), thresholdLow: 0.7, thresholdHigh: 1.2, score: 1, name: 'Mg++' },
            { id: 'albumin', val: p(data.albumin), threshold: 30, isLow: true, score: 1, name: 'Albumin' },
            { id: 'crp', val: p(data.crp), threshold: 100, score: 1, name: 'CRP' }
        ];

        bloods.forEach(b => {
            let triggered = false;
            if (!isNaN(b.val)) {
                if (b.isLow && b.val < b.threshold) triggered = true;
                else if (b.thresholdHigh && (b.val < b.thresholdLow || b.val > b.thresholdHigh)) triggered = true;
                else if (!b.isLow && !b.thresholdHigh && b.val > b.threshold) triggered = true;
            }
            b.isTriggered = triggered; 
            if (triggered) { score += b.score; flags.red.push(`Abnormal ${b.name} (${b.val})`); }
            if (data[`${b.id}_trend`] === 'worsening') flags.red.push(`Worsening ${b.name} trend`);
        });
        
        bloods.forEach(b => {
            const el = document.getElementById(b.id);
            if (el) { el.classList.toggle('input-abnormal', b.isTriggered); }
        });
        
        if (data.glucose_control) { score += 1; flags.red.push('Poorly controlled glucose'); }

        // A-E Assessment & Circulation Scoring
        const addsResult = calculateADDS(data);
        score += addsResult.score;
        if (addsResult.metCall) flags.red.push(`MET Call: ${addsResult.metReason}`);
        if (addsResult.reasons.length > 0) flags.red.push(...addsResult.reasons);
        if(data.airway === 'At Risk') { score += 2; flags.red.push('Airway at Risk'); }
        const deliriumScore = p(data.delirium) || 0;
        if (deliriumScore > 0) { score += deliriumScore; flags.red.push('Delirium Present'); }
        
        if (data.cap_refill === '>2s') { score += 2; flags.red.push('Cap Refill > 2s'); }
        if (data.peripheries === 'Cool') { score += 1; flags.red.push('Cool peripheries'); }
        
        const weight = p(data.weight);
        const uop_hr = p(data.urine_output_hr);
        const uopDisplay = document.getElementById('uop_ml_kg_hr_display');
        if (!isNaN(weight) && weight > 0 && !isNaN(uop_hr)) {
            const uop_ml_kg_hr = uop_hr / weight;
            if(uopDisplay) uopDisplay.value = uop_ml_kg_hr.toFixed(2);
            if (uop_ml_kg_hr < 0.5) { score += 2; flags.red.push(`Oliguria (<0.5mL/kg/hr)`); }
        } else {
            if(uopDisplay) uopDisplay.value = '';
        }

        if(data.fluid_balance_inaccurate) {
            flags.red.push('Fluid balance inaccurate');
        } else {
            if (p(data.fluid_balance) > 1000) { score += 1; flags.red.push(`Fluid Overload: Balance > +1000mL`); }
        }
        if (data.fluid_balance_trend && data.fluid_balance_trend !== 'Even') { score += 1; flags.red.push(`Fluid balance ${data.fluid_balance_trend}`);}

        if (data.bowels === 'Diarrhoea/Loose' || data.bowels === 'Constipated/Absent') { score += 1; flags.red.push(`Bowel Issue: ${data.bowels}`); }
        if (['Nausea/Vomiting', 'NBM'].includes(data.diet)) { score += 2; flags.red.push(`Poor Diet Tolerance: ${data.diet}`); }
        if (data.mobility === 'Requires Physical Assistance') { score += 1; flags.red.push('Mobility: Requires Assistance'); }
        else if (data.mobility === 'Bedbound/Immobile') { score += 2; flags.red.push('Mobility: Bedbound/Immobile'); }
        
        const painScore = p(data.pain_score);
        if (!isNaN(painScore)) {
            if (painScore >= 7) { score += 2; flags.red.push(`Severe Pain (Score: ${painScore}/10)`); }
            else if (painScore >= 4) { score += 1; flags.red.push(`Moderate Pain (Score: ${painScore}/10)`); }
        }

        // Device Scoring
        if (data.pivc_1_site_health && data.pivc_1_site_health !== 'Clean & Healthy') { score += 2; flags.red.push(`PIVC 1 Site Concern: ${data.pivc_1_site_health}`); }
        if (p(document.getElementById('pivc_1_dwell_time')?.textContent) > 3) flags.red.push('PIVC 1 dwell > 3 days (Review need)');
        if (data.pivc_2_site_health && data.pivc_2_site_health !== 'Clean & Healthy') { score += 2; flags.red.push(`PIVC 2 Site Concern: ${data.pivc_2_site_health}`); }
        if (p(document.getElementById('pivc_2_dwell_time')?.textContent) > 3) flags.red.push('PIVC 2 dwell > 3 days (Review need)');
        if (data.cvad_present) { score += 2; flags.red.push(`CVAD in situ (${data.cvad_type})`); }
        if (data.idc_present) { score += 1; flags.red.push('IDC in situ'); }
        if (data.cvad_site_health && data.cvad_site_health !== 'Clean & Healthy') { score += 2; flags.red.push(`CVAD Site Concern: ${data.cvad_site_health}`); }
        if (data.ng_tube_present) flags.red.push('NG Tube in situ (Aspiration Risk)');
        if (data.nj_tube_present) flags.red.push('NJ Tube in situ (Aspiration Risk)');
        if (p(document.getElementById('cvad_dwell_time')?.textContent) > 7) flags.red.push('CVAD dwell > 7 days (Review need)');
        if (p(data.drain_output_24hr) > 100) { score += 1; flags.red.push('High drain output (>100mL/24h)');}
        if (data.wounds_present) flags.red.push('Complex wound present');

        // Context & Frailty
        if(p(data.frailty_score) >= 5) { score += 1; flags.red.push(`Frailty score ≥ 5`); }
        const staffingScore = p(data.ward_staffing) || 0;
        score += staffingScore; 
        if(staffingScore < 0) flags.green.push(`Protective Staffing (${staffingScore})`);
        if (data.manual_override) { score += 3; flags.red.push(`Manual Override: ${data.override_reason || 'Clinical Concern'}`); }
        
        // Final Category Calculation
        let categoryKey;
        if (flags.red.length >= 3 || score >= 10) categoryKey = 'RED';
        else if (flags.red.length >= 1 || score >= 3) categoryKey = 'AMBER';
        else categoryKey = 'GREEN';
        if (p(data.icu_los) > 3 && flags.red.length === 0) flags.green.push('Stable Long-Stay');

        displayResults(categoryKey, flags, score, data);
        saveState();
        generateDMRSummary(); 
    }

    function calculateADDS(data) {
        let score = 0, metCall = false, metReason = '', reasons = [];
        const getScore = (val, ranges, paramName) => {
            for (const r of ranges) {
                if ((r.min === -Infinity || val >= r.min) && (r.max === Infinity || val <= r.max)) {
                    if (r.score === 'E') return { metCall: true, metReason: r.note.replace('=>', `(${val}) =>`) };
                    if (r.score > 0) reasons.push(`${paramName} abnormal (${val})`);
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
        if (data.consciousness === 'Unresponsive') { metCall = true; metReason = 'Unresponsive'; }
        else if (data.consciousness === 'Pain') { score += 2; reasons.push('Responds to Pain');}
        else if (data.consciousness === 'Voice') { score += 1; reasons.push('Responds to Voice');}
        if (data.o2_device === 'HFNP') { score += 1; reasons.push('Using High-Flow O₂');}
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
        if (p(data.lactate) > 1.5 && p(data.sbp) < 90) combinationAlerts.push('<b>Shock Profile:</b> High Lactate with low Blood Pressure is a critical sign of shock.');
        if (p(data.creatinine) > 171 && p(data.rr) > 25) combinationAlerts.push('<b>Cardio-Renal Profile:</b> High Creatinine with a high Respiratory Rate may indicate fluid overload.');
        if (p(data.crp) > 100 && p(data.creatinine) > 171) combinationAlerts.push('<b>Inflammation & Kidney Injury:</b> High CRP with high Creatinine suggests systemic inflammation is impacting kidney function.');
        if (p(data.albumin) < 30 && p(data.temp) > 38.0) combinationAlerts.push('<b>Malnutrition & Infection:</b> Low Albumin with a fever may indicate a poor response to infection.');
        if (p(data.hb) < 8 && p(data.hr) > 110) combinationAlerts.push('<b>Anemia & Tachycardia:</b> Low Haemoglobin with a high Heart Rate suggests cardiovascular strain.');
        if (p(data.icu_los) > 3 && p(data.delirium) > 0) combinationAlerts.push('<b>Deconditioning & Delirium:</b> A long ICU stay combined with new confusion is a strong predictor of poor outcomes.');
        if (p(data.spo2) < 91 && isNotAlert) combinationAlerts.push('<b>Hypoxia & Neurological Impairment:</b> Low oxygen saturation with an altered level of consciousness is a medical emergency.');
        if (p(data.bilirubin) > 20 && p(data.creatinine) > 171) combinationAlerts.push('<b>Multi-Organ Dysfunction:</b> Concurrent high Bilirubin (liver) and Creatinine (kidney) indicates a severe systemic illness.');
        if (p(data.platelets) < 100 && isSurgical) combinationAlerts.push('<b>Post-Operative Bleeding Risk:</b> Low Platelets in a surgical patient is a major risk factor for bleeding.');
        if (p(data.glucose) > 180 && p(data.crp) > 100) combinationAlerts.push('<b>Inflammatory Hyperglycemia:</b> High blood sugar during a major inflammatory response is associated with poor outcomes.');
        if (p(data.fio2) > 40 && p(data.rr) > 25) combinationAlerts.push('<b>Escalating Respiratory Failure:</b> High oxygen requirement with a high respiratory rate suggests therapy is not effective.');
        if (p(data.age) > 65 && p(data.frailty_score) >= 5 && isSurgical) combinationAlerts.push('<b>Vulnerable Surgical Patient:</b> The combination of older age, frailty, and recent surgery presents an extremely high risk for complications.');
        const alertsHtml = combinationAlerts.length > 0 ? `<div class="summary-plan mt-4 border-l-4 border-red-500"><h4>🚨 Critical Combination Alerts:</h4><ul class="list-disc list-inside text-sm text-gray-700">${combinationAlerts.map(alert => `<li>${alert}</li>`).join('')}</ul></div>` : '';
        footerCategory.textContent = category.text;
        footerScore.textContent = score;
        stickyFooter.className = `fixed bottom-0 left-0 right-0 p-1 shadow-lg transition-colors duration-300 flex items-center justify-between z-40 ${category.class}`;
        footerRedFlags.innerHTML = `<span>🚩 ${flags.red.length}</span>`;
        footerGreenFlags.innerHTML = `<span>✅ ${flags.green.length}</span>`;
        const plan = generateActionPlan(categoryKey, flags.red);
        summaryContainer.innerHTML = `<div class="summary-category ${category.class}">${category.text} (Score: ${score})</div>${alertsHtml}<div class="summary-flags-container mt-4"><div><h4 class="flag-list-red">Red Flags (${flags.red.length}):</h4><ul class="list-disc list-inside text-sm text-gray-700">${flags.red.length ? flags.red.map(f => `<li>${f}</li>`).join('') : '<li>None</li>'}</ul></div><div><h4 class="flag-list-green">Protective Flags (${flags.green.length}):</h4><ul class="list-disc list-inside text-sm text-gray-700">${flags.green.length ? flags.green.map(f => `<li>${f}</li>`).join('') : '<li>None</li>'}</ul></div></div><div class="summary-plan mt-4"><h4>Recommended Action Plan:</h4><p class="text-sm">${plan}</p></div>`;
    }

    function generateActionPlan(categoryKey, flags) {
        switch (categoryKey) {
            case 'RED': let redPlan = 'Cat 1: Daily review for 72hrs, escalate to ICU liaison/medical team immediately. '; if (flags.some(f => f.includes('Creatinine'))) redPlan += 'Repeat Creatinine in 24h. '; if (flags.some(f => f.includes('Lactate'))) redPlan += 'Repeat Lactate in 6h. '; return redPlan;
            case 'AMBER': return 'Cat 2: Review q48hrs for 72hrs, nurse-led monitoring.';
            case 'GREEN': return 'Cat 3: Single check within 24hrs, then routine ward care.';
        }
    }
    
    // --- MAJOR REFACTOR of DMR Summary ---
    function generateDMRSummary() {
        const data = gatherFormData();
        const score = document.getElementById('footer-score').textContent;
        const categoryText = document.getElementById('footer-category').textContent.replace('CAT ', 'Cat ');
        
        let uopSummary = 'N/A';
        const weight = p(data.weight);
        const uop_hr = p(data.urine_output_hr);
        if (!isNaN(weight) && weight > 0 && !isNaN(uop_hr)) {
            const uop_ml_kg_hr = uop_hr / weight;
            uopSummary = `${uop_hr} mL/hr (${uop_ml_kg_hr.toFixed(2)} mL/kg/hr)`;
        } else if (!isNaN(uop_hr)) {
            uopSummary = `${uop_hr} mL/hr`;
        }
        
        const importantTrends = ['crp', 'hb', 'lactate'];
        const bloodsSummary = [
            {id: 'creatinine', name: 'Cr'}, {id: 'lactate', name: 'Lac'}, {id: 'bilirubin', name: 'Bili'}, 
            {id: 'platelets', name: 'Plt'}, {id: 'hb', name: 'Hb'}, {id: 'glucose', name: 'Gluc'},
            {id: 'k', name: 'K'}, {id: 'mg', name: 'Mg'}, {id: 'albumin', name: 'Alb'}, {id: 'crp', name: 'CRP'}
        ].map(b => {
            let val = data[b.id] || '--';
            let trend = data[`${b.id}_trend`];
            if (importantTrends.includes(b.id) && trend) {
                return `${b.name} ${val}(${trend.charAt(0)})`;
            }
            return `${b.name} ${val}`;
        }).join(', ');

        let devicesSummary = [];
        if (data.pivc_1_present) devicesSummary.push(`PIVC 1 (${data.pivc_1_gauge}): Inserted ${data.pivc_1_commencement_date || 'N/A'}. Dwell: ${document.getElementById('pivc_1_dwell_time')?.textContent || 'N/A'} days. Site: ${data.pivc_1_site_health}`);
        if (data.pivc_2_present) devicesSummary.push(`PIVC 2 (${data.pivc_2_gauge}): Inserted ${data.pivc_2_commencement_date || 'N/A'}. Dwell: ${document.getElementById('pivc_2_dwell_time')?.textContent || 'N/A'} days. Site: ${data.pivc_2_site_health}`);
        if (data.cvad_present) devicesSummary.push(`CVAD (${data.cvad_type}): Inserted ${data.cvad_commencement_date || 'N/A'}. Dwell: ${document.getElementById('cvad_dwell_time')?.textContent || 'N/A'} days. Site: ${data.cvad_site_health}`);
        if (data.idc_present) devicesSummary.push(`IDC: Inserted ${data.idc_commencement_date || 'N/A'}. Dwell: ${document.getElementById('idc_dwell_time')?.textContent || 'N/A'} days.`);
        if (data.ng_tube_present) devicesSummary.push('NG Tube');
        if (data.nj_tube_present) devicesSummary.push('NJ Tube');
        if (data.drains_present) devicesSummary.push(`Drains: 24h Output: ${data.drain_output_24hr || 'N/A'} mL, Cumulative: ${data.drain_output_cumulative || 'N/A'} mL`);
        if (data.wounds_present) devicesSummary.push(`Wounds: ${data.wound_description || 'N/A'}`);
        if(devicesSummary.length === 0) devicesSummary.push('None');

        const reviewTypeText = data.review_type === 'post' ? 'post ICU review' : 'pre-ICU review';
        const summary = `
ALERT CNS ${reviewTypeText} on ward ${data.location || ''}
LOS: ${data.icu_los || 'N/A'} days
${categoryText} discharge

${data.age || 'N/A'}M/F. Patient ID: ${data.patient_id || 'N/A'}

REASON FOR ICU ADMISSION
${data.reason_icu || 'N/A'}

ICU SUMMARY
${data.icu_summary || 'N/A'}

PMH
${data.pmh || 'N/A'}

Modded ADDS = ${calculateADDS(data).score}
A: ${data.airway}
B: RR ${data.rr}, SpO2 ${data.spo2} on ${data.o2_device} (Flow: ${data.o2_flow || 'N/A'}L, FiO2: ${data.fio2 || 'N/A'}%)
C: HR ${data.hr}, BP ${data.sbp}/${data.dbp}, CRT ${data.cap_refill}, ${data.peripheries} peripheries
D: ${data.consciousness}, Delirium: ${data.delirium === '0' ? 'None' : 'Present'}, Pain: ${data.pain_score || 'N/A'}/10
E: Temp ${data.temp}°C, Diet: ${data.diet}, Bowels: ${data.bowels}, Mobility: ${data.mobility}, UO: ${uopSummary}, Fluid Bal: ${data.fluid_balance || 'N/A'}mL ${data.fluid_balance_inaccurate ? '[INACCURATE]' : ''}

DEVICES:
${devicesSummary.map(d => `- ${d}`).join('\n')}

BLOODS:
${bloodsSummary}

IMP:
${data.clinical_impression || ''}

Plan:
${data.clinical_plan || generateActionPlan(categoryText.split(':')[0], [])}
`.trim().replace(/^\s*\n/gm, '');

        document.getElementById('emrSummary').value = summary;
    }

    function setupEventListeners() {
        const toggleReviewBtn = document.getElementById('toggle-full-review-btn');
        let isQuickView = false;
        
        document.getElementById('startFullReviewBtn').addEventListener('click', () => {
            isQuickView = false;
            toggleReviewBtn.style.display = 'none';
            document.querySelectorAll('.full-review-item').forEach(el => el.style.display = '');
            clearForm();
            document.getElementById('launchScreenModal').style.display = 'none';
            document.getElementById('main-content').style.visibility = 'visible';
        });

        document.getElementById('startQuickScoreBtn').addEventListener('click', () => {
            isQuickView = true;
            toggleReviewBtn.style.display = 'block';
            toggleReviewBtn.textContent = 'Expand to Full Review';
            document.querySelectorAll('.full-review-item').forEach(el => el.style.display = 'none');
            clearForm();
            document.getElementById('launchScreenModal').style.display = 'none';
            document.getElementById('main-content').style.visibility = 'visible';
        });
        
        toggleReviewBtn.addEventListener('click', () => {
            isQuickView = !isQuickView;
            toggleReviewBtn.textContent = isQuickView ? 'Collapse to Quick Score' : 'Expand to Full Review';
            document.querySelectorAll('.full-review-item').forEach(el => el.style.display = isQuickView ? 'none' : '');
        });

        document.getElementById('loadReviewBtn').addEventListener('click', () => {
            document.getElementById('pasteContainer').style.display = 'block';
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
            summaryEl.setSelectionRange(0, 99999);
            document.execCommand('copy');
            alert('DMR Summary Copied to Clipboard!');
        });
        
        document.getElementById('generateHandoffBtn').addEventListener('click', () => {
            const handoffData = gatherFormData();
            const key = btoa(JSON.stringify(handoffData));
            navigator.clipboard.writeText(key).then(() => alert('Handoff key copied to clipboard!'));
        });

        const o2DeviceEl = document.getElementById('o2_device');
        if (o2DeviceEl) {
            o2DeviceEl.addEventListener('change', e => {
                const device = e.target.value;
                document.getElementById('o2_flow_container').classList.toggle('hidden', !['NP', 'HFNP', 'NIV'].includes(device));
                document.getElementById('fio2_container').classList.toggle('hidden', !['HFNP', 'NIV'].includes(device));
                document.getElementById('peep_ps_container').classList.toggle('hidden', device !== 'NIV');
            });
        }

        const gocEl = document.getElementById('goc');
        if (gocEl) {
            gocEl.addEventListener('change', e => {
                document.getElementById('goc_details_container').classList.toggle('hidden', !['B', 'C'].includes(e.target.value));
            });
        }

        document.getElementById('assessment-container').addEventListener('input', (e) => {
            if (e.target.id === 'pain_score') {
                const painScore = p(e.target.value);
                document.getElementById('pain_interventions_container').classList.toggle('hidden', isNaN(painScore) || painScore <= 0);
                document.getElementById('aps_referral_container').classList.toggle('hidden', isNaN(painScore) || painScore < 7);
            }
        });
        document.getElementById('assessment-container').addEventListener('change', (e) => {
            if (e.target.id === 'bowels') {
                document.getElementById('aperients_container').classList.toggle('hidden', e.target.value !== 'Constipated/Absent');
            }
        });
        
        const devicesContainer = document.getElementById('devices-container');
        const calculateDwellTime = (startDate, displayElId) => {
            const displayEl = document.getElementById(displayElId);
            if (!startDate || !displayEl) {
                if(displayEl) displayEl.textContent = 'N/A';
                return;
            };
            const start = new Date(startDate);
            const today = new Date();
            const diffTime = Math.abs(today - start);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            displayEl.textContent =

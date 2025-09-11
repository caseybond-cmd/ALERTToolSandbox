// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let currentReview = {};
    let deviceCounters = {};

    const RISK_CATEGORIES = {
        critical: { score: 25, text: 'CRITICAL: Escalate to ICU Liaison / MET / Critical Care', class: 'category-critical' },
        intensive_escalate: { score: 20, text: 'INTENSIVE+: Escalate to ICU Liaison / ANM', class: 'category-intensive-escalate' },
        intensive: { score: 11, text: 'INTENSIVE: Requires multiple reviews per day', class: 'category-intensive' },
        standard: { score: 5, text: 'STANDARD: At least one follow-up review required', class: 'category-standard' },
        single: { score: 0, text: 'SINGLE: Follow-up as required', class: 'category-single' }
    };
    
    const form = document.getElementById('assessmentForm');

    // --- INITIALIZATION ---
    function initializeApp() {
        populateStaticContent();
        loadState();
        const launchModal = document.getElementById('launchScreenModal');
        const mainContent = document.getElementById('main-content');
        if (Object.keys(currentReview).length > 0) {
            launchModal.style.display = 'none';
            setAppViewMode(currentReview.mode || 'full');
            loadReviewData();
        } else {
            launchModal.style.display = 'flex';
        }
        setupEventListeners();
    }
    
    function setAppViewMode(mode) {
        document.getElementById('main-content').style.visibility = 'visible';
        const fullReviewContainer = document.getElementById('fullReviewContainer');
        const fullReviewContainerBottom = document.getElementById('fullReviewContainerBottom');
        currentReview.mode = mode;
        if (mode === 'quick') {
            fullReviewContainer.style.display = 'none';
            fullReviewContainerBottom.style.display = 'none';
        } else {
            fullReviewContainer.style.display = 'block';
            fullReviewContainerBottom.style.display = 'block';
        }
    }

    // --- DATA & STATE HANDLING ---
    function gatherFormData() {
        const data = {};
        form.querySelectorAll('input, select, textarea').forEach(el => {
            const key = el.id || el.name;
            if (!key || el.closest('.device-entry, .allergy-item')) return;
            if (el.type === 'checkbox') data[key] = el.checked;
            else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
            else data[key] = el.value;
        });
        data.allergies = Array.from(document.querySelectorAll('.allergy-item')).map(item => ({ name: item.querySelector('input[data-type="name"]').value, reaction: item.querySelector('input[data-type="reaction"]').value }));
        data.devices = {};
        ['central_lines', 'pivcs', 'idcs', 'pacing_wires', 'others'].forEach(type => {
            data.devices[type] = Array.from(document.getElementById(`${type}_container`).querySelectorAll('.device-entry')).map(entry => {
                const deviceData = {};
                entry.querySelectorAll('input[data-key], select[data-key]').forEach(input => {
                    if (input.dataset.key) deviceData[input.dataset.key] = input.value;
                });
                return deviceData;
            });
        });
        return data;
    }

    function saveState() {
        currentReview = gatherFormData();
        currentReview.finalScore = parseInt(document.getElementById('updatedTotalScore').textContent) || 0;
        localStorage.setItem('alertToolState_v13', JSON.stringify(currentReview));
    }
    
    function loadState() {
        const savedState = localStorage.getItem('alertToolState_v13');
        if (savedState) {
            currentReview = JSON.parse(savedState);
        }
    }

    function loadReviewData() {
        clearForm(false); // don't clear storage when loading
        const data = JSON.parse(JSON.stringify(currentReview));
        Object.keys(data).forEach(key => {
            const el = form.querySelector(`#${key}`) || form.querySelector(`[name="${key}"]`);
            if (el) {
                if (el.type === 'checkbox') el.checked = data[key];
                else if (el.type === 'radio') {
                    const radio = form.querySelector(`[name="${el.name}"][value="${data[el.name]}"]`);
                    if (radio) radio.checked = true;
                } else el.value = data[key];
            }
        });
        if (data.allergies) data.allergies.forEach(a => addAllergy(a.name, a.reaction));
        if (data.devices) {
             ['central_lines', 'pivcs', 'idcs', 'pacing_wires', 'others'].forEach(type => {
                if (data.devices[type]) {
                    const addFunc = window[`add${type.charAt(0).toUpperCase() + type.slice(1).replace(/s$/, '')}`];
                    if (addFunc) data.devices[type].forEach(device => addFunc(device));
                }
            });
        }
        form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        calculateTotalScore();
    }

    function clearForm(clearStorage = true) {
        form.reset();
        deviceCounters = {};
        document.querySelectorAll('.device-entry, .allergy-item').forEach(el => el.remove());
        form.querySelectorAll('input, select, textarea').forEach(el => {
             el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        currentReview = {};
        if (clearStorage) localStorage.removeItem('alertToolState_v13');
        calculateTotalScore();
        calculateADDS();
    }
    
    // --- SCORING & CALCULATIONS ---
    function calculateTotalScore() {
        let score = 0;
        const hasCriticalItem = Array.from(form.querySelectorAll('.score-input:checked')).some(input => {
            score += parseInt(input.dataset.score, 10) || 0;
            return input.dataset.isCritical === 'true';
        });
        const totalScoreEl = document.getElementById('updatedTotalScore');
        totalScoreEl.title = '';
        if (hasCriticalItem && score < RISK_CATEGORIES.critical.score) {
            score = RISK_CATEGORIES.critical.score;
            totalScoreEl.textContent = `${score}*`;
            totalScoreEl.title = '*Score elevated due to critical risk item.';
        } else {
             totalScoreEl.textContent = score;
        }
        const category = getRiskCategory(score);
        const categoryEl = document.getElementById('updatedRiskCategory');
        categoryEl.textContent = category.text;
        categoryEl.className = `text-xl font-bold p-3 rounded-md mt-1 transition-all duration-300 ${category.class}`;
        saveState();
    }
    
    function getRiskCategory(score) {
        for (const key in RISK_CATEGORIES) { if (score >= RISK_CATEGORIES[key].score) return RISK_CATEGORIES[key]; }
        return RISK_CATEGORIES.single;
    }

    function calculateADDS() {
        const getScore = (val, ranges) => { for (const r of ranges) { if (val >= r.min && val <= r.max) return { score: r.score, text: r.text }; } return { score: 0, text: null }; };
        const p = (id) => parseFloat(document.getElementById(id).value);
        let total = 0; let breakdown = [];
        const rr = p('rr_input'); if (!isNaN(rr)) { const res = getScore(rr, [{min:0, max:8, score:2, text:"RR Low"}, {min:9, max:11, score:1, text:"RR Low"}, {min:21, max:29, score:2, text:"RR High"}, {min:30, max:999, score:3, text:"RR High"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        const spo2 = p('spo2_input'); if (!isNaN(spo2)) { const res = getScore(spo2, [{min:0, max:89, score:3, text:"SpO2 Low"}, {min:90, max:93, score:2, text:"SpO2 Low"}, {min:94, max:95, score:1, text:"SpO2 Low"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        const o2 = p('o2_flow_input'); if (!isNaN(o2) && o2 > 0) { total += 2; breakdown.push("On O2"); }
        const hr = p('hr_input'); if (!isNaN(hr)) { const res = getScore(hr, [{min:0, max:39, score:2, text:"HR Low"}, {min:40, max:49, score:1, text:"HR Low"}, {min:100, max:119, score:1, text:"HR High"}, {min:120, max:999, score:2, text:"HR High"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        const sbp = p('sbp_input'); if (!isNaN(sbp)) { const res = getScore(sbp, [{min:0, max:79, score:3, text:"SBP Low"}, {min:80, max:99, score:2, text:"SBP Low"}, {min:200, max:999, score:2, text:"SBP High"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        const cons = p('consciousness_input'); if (!isNaN(cons) && cons > 0) { total += 3; breakdown.push("Consciousness Not Alert"); }
        const temp = p('temp_input'); if (!isNaN(temp)) { const res = getScore(temp, [{min:0, max:35.0, score:2, text:"Temp Low"}, {min:38.1, max:38.9, score:1, text:"Temp High"}, {min:39.0, max:99, score:2, text:"Temp High"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        document.getElementById('calculatedADDSScore').textContent = total;
        document.getElementById('addsBreakdown').textContent = breakdown.length > 0 ? breakdown.join(', ') : 'Normal Parameters';
    }

    // --- DEVICE MANAGEMENT ---
    function createDeviceEntryHTML(id, content) { return `<div id="${id}" class="device-entry bg-white p-3 rounded-md border space-y-2">${content}<button type="button" class="remove-device-btn text-xs text-red-600 hover:underline no-print">Remove</button></div>`;}
    window.addCentral_line = function(data = {}) { deviceCounters.central = (deviceCounters.central || 0) + 1; document.getElementById('central_lines_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`central_${deviceCounters.central}`, `<div class="grid grid-cols-2 gap-2 text-sm"><input type="text" data-key="type" value="${data.type || ''}" placeholder="Type (e.g., PICC)" class="p-1 border rounded-md"><input type="text" data-key="location" value="${data.location || ''}" placeholder="Location" class="p-1 border rounded-md"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md col-span-2 device-date-input"><span data-key="dwell_time" class="text-xs text-gray-500 col-span-2"></span></div>`)); }
    window.addPivc = function(data = {}) { deviceCounters.pivc = (deviceCounters.pivc || 0) + 1; document.getElementById('pivcs_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`pivc_${deviceCounters.pivc}`, `<div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm"><input type="text" data-key="location" value="${data.location || ''}" placeholder="Location" class="p-1 border rounded-md"><select data-key="size" class="p-1 border rounded-md bg-white"><option value="">Size</option><option value="Pink (20G)" ${data.size === 'Pink (20G)' ? 'selected' : ''}>Pink (20G)</option><option value="Blue (22G)" ${data.size === 'Blue (22G)' ? 'selected' : ''}>Blue (22G)</option><option value="Green (18G)" ${data.size === 'Green (18G)' ? 'selected' : ''}>Green (18G)</option><option value="Grey (16G)" ${data.size === 'Grey (16G)' ? 'selected' : ''}>Grey (16G)</option><option value="Yellow (24G)" ${data.size === 'Yellow (24G)' ? 'selected' : ''}>Yellow (24G)</option></select><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md"></div>`)); }
    window.addIdc = function(data = {}) { deviceCounters.idc = (deviceCounters.idc || 0) + 1; document.getElementById('idcs_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`idc_${deviceCounters.idc}`, `<div class="grid grid-cols-2 gap-2 text-sm items-center"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md device-date-input"><select data-key="size" class="p-1 border rounded-md bg-white"><option value="">Size</option><option value="12" ${data.size === '12' ? 'selected' : ''}>12 Ch</option><option value="14" ${data.size === '14' ? 'selected' : ''}>14 Ch</option><option value="16" ${data.size === '16' ? 'selected' : ''}>16 Ch</option></select><span data-key="dwell_time" class="text-xs text-gray-500 col-span-2"></span></div>`)); }
    window.addPacing_wire = function(data = {}) { deviceCounters.pacing = (deviceCounters.pacing || 0) + 1; document.getElementById('pacing_wires_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`pacing_${deviceCounters.pacing}`, `<div><input type="text" data-key="details" value="${data.details || ''}" placeholder="Pacing wire details (e.g., Atrial x2)" class="p-1 border rounded-md w-full text-sm"></div>`)); }
    window.addOther = function(data = {}) { deviceCounters.other = (deviceCounters.other || 0) + 1; document.getElementById('others_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`other_${deviceCounters.other}`, `<div><input type="text" data-key="description" value="${data.description || ''}" placeholder="Device/Wound Description" class="p-1 border rounded-md w-full text-sm"></div>`)); }
    function addAllergy(name = '', reaction = '') { document.getElementById('allergies_container').insertAdjacentHTML('beforeend', `<div class="allergy-item flex items-center gap-2"><input type="text" data-type="name" value="${name}" placeholder="Allergen" class="flex-grow p-1 border rounded-md text-sm"><input type="text" data-type="reaction" value="${reaction}" placeholder="Reaction" class="flex-grow p-1 border rounded-md text-sm"><button type="button" class="remove-allergy-btn text-red-500 font-bold no-print">&times;</button></div>`);}
    
    // --- DMR & HANDOFF NOTE ---
    function generateEMRSummary() {
        const val = (id) => document.getElementById(id)?.value?.trim() || 'N/A';
        const isChecked = (id) => document.getElementById(id)?.checked;
        let summary = `ALERT NURSE REVIEW:\n\n--- PATIENT & REVIEW DETAILS ---\n`;
        summary += `Patient: ${val('patientInitials')}\nLocation: ${val('wardAndRoom')}\n`;
        summary += `ICU Stepdown: ${val('icuStepdownDate')} @ ${val('icuStepdownTime')}\nICU LOS: ${val('losDays')} days\n`;
        
        summary += `\n--- CLINICAL BACKGROUND ---\n`;
        summary += `GOC: ${val('goc') || 'N/A'}${val('gocSpecifics') ? ` (${val('gocSpecifics')})` : ''}\n`;
        const precautions = Array.from(document.querySelectorAll('.precaution-cb:checked')).map(cb => cb.value).join(', ');
        summary += `Infection Control: ${precautions || 'None'}${precautions ? ` (Reason: ${val('infectionControlReason')})` : ''}\n`;
        if (isChecked('nkdaCheckbox')) { summary += `Allergies: NKDA\n`; }
        else { const allergies = Array.from(document.querySelectorAll('.allergy-item')).map(item => `${item.querySelector('input[data-type="name"]').value} (${item.querySelector('input[data-type="reaction"]').value})`).join('; '); summary += `Allergies: ${allergies || 'None'}\n`; }
        
        summary += `\n--- OBSERVATIONS (ADDS) ---\n`;
        summary += `Calculated ADDS: ${document.getElementById('calculatedADDSScore').textContent} (${document.getElementById('addsBreakdown').textContent})\n`;
        if(isChecked('addsModificationCheckbox')) { summary += `MODIFIED ADDS: ${val('manualADDSScore')} (Rationale: ${val('addsModificationText')})\n`; }
        summary += `Vitals: RR ${val('rr_input')}, SpO2 ${val('spo2_input')}% on ${val('o2_flow_input')}${val('o2_unit_input')}, HR ${val('hr_input')}, BP ${val('sbp_input')}/${val('dbp_input')}, Temp ${val('temp_input')}C\n`;
        
        summary += `\n--- RISK ASSESSMENT ---\n`;
        summary += `Final Score: ${document.getElementById('updatedTotalScore').textContent}\nCategory & Action: ${document.getElementById('updatedRiskCategory').textContent}\n`;
        if (isChecked('systemic_after_hours_checkbox')) {
            const stepdownTimeEl = document.getElementById('icuStepdownTime');
            const isOOH = stepdownTimeEl.options[stepdownTimeEl.selectedIndex].dataset.ooh === 'true';
            if ((new Date() - new Date(val('icuStepdownDate'))) / (1000*60*60*24) <= 1) {
                summary += `**! AFTER-HOURS DISCHARGE RISK (${isOOH ? 'OOH' : 'Afternoon'}) !**\n`;
            }
        }
        summary += `\nContributing Factors:\n`;
        document.querySelectorAll('#scoringContainer .score-group, #scoringContainer > div > .score-option').forEach(element => {
            const titleEl = element.querySelector('.score-group-title');
            const title = titleEl ? titleEl.textContent : (element.querySelector('.option-label span:first-child')?.textContent || "Item");
            
            element.querySelectorAll('.score-option').forEach(option => {
                const input = option.querySelector('.score-input');
                const label = option.querySelector('.option-label span:first-child')?.textContent || option.querySelector('.option-label')?.textContent;
                const note = option.querySelector('.score-note')?.value || '';
                
                if(input.type === 'radio'){
                    if(input.checked) summary += `- ${title}: ${label.replace(/\(\S+\)/, '').trim()}${note ? `\n  > Notes: ${note}` : ''}\n`;
                } else if (input.type === 'checkbox') {
                    summary += `- ${label.replace(/:/g, '')}: [${input.checked ? 'Yes' : 'No'}]${input.checked && note ? `\n  > Notes: ${note}` : ''}\n`;
                }
            });
        });
        
        const getDeviceText = (containerId, typeName) => Array.from(document.getElementById(containerId).querySelectorAll('.device-entry')).map(entry => {
            let details = [];
            entry.querySelectorAll('input[data-key], select[data-key]').forEach(input => {
                if (input.value) {
                     details.push(`${input.dataset.key.replace(/_/g, ' ')}: ${input.value}`);
                }
            });
            const dwellSpan = entry.querySelector('span[data-key="dwell_time"]');
            if(dwellSpan && dwellSpan.textContent) {
                details.push(dwellSpan.textContent);
            }
            return `- ${typeName}: ` + details.join(', ');
        }).join('\n');

        const devicesSummary = [getDeviceText('central_lines_container', 'CVAD'), getDeviceText('pivcs_container', 'PIVC'), getDeviceText('idcs_container', 'IDC'), getDeviceText('pacing_wires_container', 'Pacing Wires'), getDeviceText('others_container', 'Other')].filter(Boolean).join('\n');
        summary += `\n--- DEVICES ---\n${devicesSummary || 'No devices documented.'}\n`;

        summary += `\n--- ASSESSMENT & PLAN ---\n`;
        summary += `Fluid Balance: 24hr: ${val('fbc_24hr_input')}mL, Total ICU: ${val('fbc_total_input')}mL\n`;
        summary += `PICS: ${document.querySelector('input[name="pics_status"]:checked').value}. ${val('pics_notes') || ''}\n`;
        summary += `Home Team Plan: ${isChecked('homeTeamPlanCheckbox') ? `Yes - ${val('homeTeamPlanText')}` : 'No'}\n`;
        
        const combinedNotes = [val('admissionReason'), val('icuSummary'), val('pmh'), val('generalNotes')].filter(s => s && s !== 'N/A').join('\n\n');
        summary += `\n--- CLINICIAN NOTES ---\n${combinedNotes || 'N/A'}\n`;

        document.getElementById('emrSummary').value = summary;
    }

    function generateHandoffNote() {
        saveState(); // Ensure current data is saved before generating
        const readableNotes = [
            `--- ICU SUMMARY ---\n${currentReview.icuSummary || 'N/A'}`,
            `\n--- PAST MEDICAL HISTORY ---\n${currentReview.pmh || 'N/A'}`,
            `\n--- GENERAL NOTES ---\n${currentReview.generalNotes || 'N/A'}`
        ].join('\n\n');
        
        const keyData = {
            details: (({ reviewType, patientInitials, wardAndRoom, icuStepdownDate, icuStepdownTime, losDays }) => ({ reviewType, patientInitials, wardAndRoom, icuStepdownDate, icuStepdownTime, losDays }))(currentReview),
            clinical: (({ goc, gocSpecifics, nkdaCheckbox, allergies, precautions, infectionControlReason }) => ({ goc, gocSpecifics, nkdaCheckbox, allergies, precautions, infectionControlReason }))(currentReview),
            bloods: (({ lactate_input, hb_input, k_input, mg_input, creatinine_input, crp_input, albumin_input }) => ({ lactate_input, hb_input, k_input, mg_input, creatinine_input, crp_input, albumin_input }))(currentReview)
        };
        const encodedKey = btoa(JSON.stringify(keyData));
        return `${readableNotes}\n\n---\n[DATA_START]${encodedKey}[DATA_END]\n---`;
    }

    function loadFromHandoff(pastedText) {
        try {
            const keyMatch = pastedText.match(/\[DATA_START\](.*)\[DATA_END\]/);
            if (!keyMatch || !keyMatch[1]) {
                alert('Could not find data key in pasted text.');
                return;
            }
            const decodedData = JSON.parse(atob(keyMatch[1]));
            
            clearForm(false);
            
            const summaryMatch = pastedText.match(/--- ICU SUMMARY ---\n([\s\S]*?)\n\n--- PAST MEDICAL HISTORY ---/);
            const pmhMatch = pastedText.match(/--- PAST MEDICAL HISTORY ---\n([\s\S]*?)\n\n--- GENERAL NOTES ---/);
            const generalNotesMatch = pastedText.match(/--- GENERAL NOTES ---\n([\s\S]*?)\n\n---/);
            
            if(summaryMatch) document.getElementById('icuSummary').value = summaryMatch[1].trim();
            if(pmhMatch) document.getElementById('pmh').value = pmhMatch[1].trim();
            if(generalNotesMatch) document.getElementById('generalNotes').value = generalNotesMatch[1].trim();

            const combinedData = {...decodedData.details, ...decodedData.clinical, ...decodedData.bloods};
            Object.keys(combinedData).forEach(key => {
                const el = document.getElementById(key);
                if (el) {
                    if (el.type === 'checkbox') el.checked = combinedData[key];
                    else el.value = combinedData[key];
                }
            });
            if (decodedData.clinical.allergies) decodedData.clinical.allergies.forEach(a => addAllergy(a.name, a.reaction));
            
            form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));

        } catch (e) {
            alert('Error loading data. The pasted text may be corrupted.');
            console.error("Error decoding handoff data:", e);
        }
    }
    
    // --- EVENT LISTENER SETUP ---
    function setupEventListeners() {
        document.getElementById('startFullReviewBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('full'); clearForm(true); });
        document.getElementById('startQuickScoreBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('quick'); clearForm(true); });
        document.getElementById('resumeReviewBtn').addEventListener('click', () => { document.getElementById('pasteContainer').style.display = 'block'; });
        document.getElementById('loadPastedDataBtn').addEventListener('click', () => { const pastedText = document.getElementById('pasteDataInput').value; if(!pastedText) return; document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('full'); loadFromHandoff(pastedText); });

        form.addEventListener('input', saveState);
        form.addEventListener('change', saveState);
        document.getElementById('startOverBtn').addEventListener('click', () => {
            if (confirm('Are you sure you want to start over? All unsaved data will be lost.')) {
                clearForm(true);
                document.getElementById('main-content').style.visibility = 'hidden';
                document.getElementById('launchScreenModal').style.display = 'flex';
            }
        });
        
        let activeRadio = null;
        form.addEventListener('mousedown', e => { if (e.target.type === 'radio' && e.target.classList.contains('score-input')) activeRadio = e.target.checked ? e.target : null; });
        form.addEventListener('click', e => { if (e.target.type === 'radio' && e.target.classList.contains('score-input') && e.target === activeRadio) { e.target.checked = false; e.target.dispatchEvent(new Event('change', { bubbles: true })); activeRadio = null; calculateTotalScore(); } });
        
        document.getElementById('addCentralLineButton').addEventListener('click', () => window.addCentral_line());
        document.getElementById('addPivcButton').addEventListener('click', () => window.addPivc());
        document.getElementById('addIdcButton').addEventListener('click', () => window.addIdc());
        document.getElementById('addPacingWireButton').addEventListener('click', () => window.addPacing_wire());
        document.getElementById('addOtherButton').addEventListener('click', () => window.addOther());
        document.getElementById('addAllergyButton').addEventListener('click', () => addAllergy());
        document.addEventListener('click', (e) => { if (e.target.matches('.remove-device-btn, .remove-allergy-btn')) e.target.closest('div').remove(); });
        document.addEventListener('input', e => {
            if (e.target.classList.contains('device-date-input')) {
                const dwellEl = e.target.parentElement.querySelector('[data-key="dwell_time"]');
                if(e.target.value) {
                    const days = Math.round((new Date() - new Date(e.target.value)) / (1000 * 60 * 60 * 24));
                    dwellEl.textContent = `Dwell time: ${days} day(s)`;
                } else {
                    dwellEl.textContent = '';
                }
            }
        });
        
        document.getElementById('scoringContainer').addEventListener('change', (e) => {
            if(e.target.classList.contains('score-input')) {
                const option = e.target.closest('.score-option');
                const noteBox = option.querySelector('.score-note');
                if (noteBox) {
                    const shouldShow = e.target.checked && (parseInt(e.target.dataset.score, 10) !== 0 || e.target.name === 'concern_score');
                    noteBox.style.display = shouldShow ? 'block' : 'none';
                }
                calculateTotalScore();
            }
        });
        
        document.getElementById('homeTeamPlanCheckbox').addEventListener('change', e => { document.getElementById('homeTeamPlanDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.querySelectorAll('.precaution-cb').forEach(cb => cb.addEventListener('change', () => { document.getElementById('infectionControlDetails').style.display = document.querySelector('.precaution-cb:checked') ? 'block' : 'none'; }));
        document.getElementById('addsModificationCheckbox').addEventListener('change', e => { document.getElementById('addsModificationDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.getElementById('goc').addEventListener('change', e => { document.getElementById('gocSpecificsContainer').style.display = e.target.value ? 'block' : 'none'; });
        document.querySelectorAll('input[name="pics_status"]').forEach(r => r.addEventListener('change', e => { document.getElementById('pics_details_container').style.display = e.target.value !== 'Negative' ? 'block' : 'none'; }));
        
        form.querySelectorAll('.vital-input').forEach(el => el.addEventListener('input', calculateADDS));
        document.getElementById('printBlankBtn').addEventListener('click', () => { document.body.classList.add('print-blank-mode'); window.print(); document.body.classList.remove('print-blank-mode'); });
        document.getElementById('generateSummaryButton').addEventListener('click', generateEMRSummary);
        document.getElementById('copySummaryButton').addEventListener('click', () => { const el = document.getElementById('emrSummary'); el.select(); document.execCommand('copy'); alert('Summary copied!'); });
        document.getElementById('resetButton').addEventListener('click', () => { if (confirm('Reset form?')) clearForm(true); });
        document.getElementById('generateHandoffBtn').addEventListener('click', () => { const note = generateHandoffNote(); navigator.clipboard.writeText(note).then(() => alert('Bedside notes copied to clipboard!')); });
    }
    
    // --- DYNAMIC CONTENT INJECTION ---
    function populateStaticContent() {
        const bloodsContainer = document.getElementById('bloods-container');
        bloodsContainer.innerHTML = `<h3 class="font-semibold text-gray-700 mb-2">Key Bloods</h3><div class="grid sm:grid-cols-2 gap-x-6 gap-y-4"><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Lactate</label><div class="flex-grow"><input type="number" step="0.1" id="lactate_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" step="0.1" id="lactate_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Hb</label><div class="flex-grow"><input type="number" id="hb_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" id="hb_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">K+</label><div class="flex-grow"><input type="number" step="0.1" id="k_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" step="0.1" id="k_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex gap-x-4 mt-2 pl-24"><label class="flex items-center text-xs"><input type="checkbox" id="k_replaced_checkbox" class="h-3 w-3 mr-1"> Replaced</label> <label class="flex items-center text-xs"><input type="checkbox" id="k_planned_checkbox" class="h-3 w-3 mr-1"> Planned</label></div></div><div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Mg++</label><div class="flex-grow"><input type="number" step="0.1" id="mg_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" step="0.1" id="mg_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex gap-x-4 mt-2 pl-24"><label class="flex items-center text-xs"><input type="checkbox" id="mg_replaced_checkbox" class="h-3 w-3 mr-1"> Replaced</label> <label class="flex items-center text-xs"><input type="checkbox" id="mg_planned_checkbox" class="h-3 w-3 mr-1"> Planned</label></div></div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Creatinine</label><div class="flex-grow"><input type="number" id="creatinine_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" id="creatinine_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">CRP</label><div class="flex-grow"><input type="number" id="crp_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" id="crp_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Albumin</label><div class="flex-grow"><input type="number" id="albumin_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" id="albumin_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="sm:col-span-2 mt-2 pt-2 border-t"><label class="flex items-center"><input type="checkbox" id="cts_cardiac_checkbox" class="blood-input"><span class="ml-2 text-sm font-medium">CTS/Cardiac Patient</span></label></div></div>`;
        const addsContainer = document.getElementById('adds-container');
        addsContainer.innerHTML = `<h3 class="font-semibold mb-2">ADDS Calculator</h3><div class="space-y-4"><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Resp Rate</label><div class="sm:col-span-2"><input type="number" id="rr_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">SpO2 (%)</label><div class="sm:col-span-2"><input type="number" id="spo2_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Oxygen Delivery</label><div class="sm:col-span-2 flex items-center space-x-2"><input type="number" id="o2_flow_input" class="vital-input mt-1 w-full rounded-md border-2 p-2" placeholder="Value"><select id="o2_unit_input" class="vital-input mt-1 w-auto rounded-md border-2 p-2"><option value="L/min">L/min</option><option value="%">% FiO2</option></select></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Heart Rate</label><div class="sm:col-span-2"><input type="number" id="hr_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">SBP (mmHg)</label><div class="sm:col-span-2"><input type="number" id="sbp_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">DBP (mmHg)</label><div class="sm:col-span-2"><input type="number" id="dbp_input" class="mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Consciousness</label><div class="sm:col-span-2"><select id="consciousness_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"><option value="0">Alert</option><option value="1">Voice</option><option value="2">Pain</option><option value="3">Unresponsive</option></select></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Temp (°C)</label><div class="sm:col-span-2"><input type="number" step="0.1" id="temp_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div></div><div class="mt-6 bg-gray-100 p-4 rounded-lg border"><label class="flex items-center"><input type="checkbox" id="addsModificationCheckbox"> <span class="ml-2 text-sm font-medium">Apply MODS to ADDS</span></label><div id="addsModificationDetails" class="hidden ml-6 mt-4 space-y-4"><div><label for="manualADDSScore" class="block text-sm font-medium">Manual Override ADDS Score:</label><input type="number" id="manualADDSScore" class="mt-1 w-full rounded-md border-2 p-2"></div><div><label for="addsModificationText" class="block text-sm font-medium">Rationale:</label><textarea id="addsModificationText" rows="2" class="mt-1 w-full rounded-md border-2 p-2"></textarea></div></div></div><div class="mt-6 bg-teal-50 p-4 rounded-lg text-center border"><span class="text-sm font-medium text-gray-500">CALCULATED ADDS</span><div id="calculatedADDSScore" class="font-bold text-5xl my-2">0</div><div id="addsBreakdown" class="text-xs min-h-[1.5em]">Enter vitals to calculate</div></div>`;
        const scoringContainer = document.getElementById('scoringContainer');
        scoringContainer.innerHTML = `<h2 class="text-xl font-bold border-b pb-3 mb-4">RISK SCORING ASSESSMENT</h2><div class="space-y-8">${generateScoringHTML()}</div>`;
    }
    
    function generateScoringHTML() {
        const sections = [ { title: 'Physiological & Respiratory Stability', color: 'blue', items: [ { type: 'checkbox', label: 'Patient is in MET Criteria', score: 15, isCritical: true, name: 'crit_met' }, { type: 'group', title: 'ADDS Score', items: [ { type: 'radio', label: 'ADDS Score 0-2', score: 1, name: 'adds_score', checked: true }, { type: 'radio', label: 'ADDS Score 3', score: 5, name: 'adds_score' }, { type: 'radio', label: 'ADDS Score ≥ 4', score: 10, name: 'adds_score', isCritical: true } ]}, { type: 'group', title: 'Respiratory Trend', items: [ { type: 'checkbox', label: 'Worsening ADDS Trend (last 12-24h)', score: 5, name: 'adds_worsening' }, { type: 'checkbox', label: 'Increasing O₂ requirements in last 12h', score: 10, name: 'resp_increasing_o2' }, { type: 'checkbox', label: 'Rapid wean of resp support in last 4h', score: 6, name: 'resp_rapid_wean' } ]} ]}, { title: 'Clinical', color: 'yellow', items: [ { type: 'group', title: 'Pain Score', control: 'segmented', items: [ { type: 'radio', label: 'Controlled', score: 0, name: 'pain_score', checked: true }, { type: 'radio', label: 'Needs IV', score: 3, name: 'pain_score' }, { type: 'radio', label: 'PCA/Poorly Controlled', score: 5, name: 'pain_score' } ]}, { type: 'group', title: 'Fluid Status', control: 'segmented', items: [ { type: 'radio', label: 'Euvolaemic', score: 0, name: 'fluid_status_score', checked: true }, { type: 'radio', label: 'Mild Dehydration/Overload', score: 2, name: 'fluid_status_score' }, { type: 'radio', label: 'Significant Dehydration/Overload', score: 4, name: 'fluid_status_score', isCritical: true } ]}, { type: 'group', title: 'Diet', control: 'segmented', items: [ { type: 'radio', label: 'Normal', score: 0, name: 'diet_score', checked: true }, { type: 'radio', label: 'Modified', score: 2, name: 'diet_score' }, { type: 'radio', label: 'NBM/NG/TPN', score: 4, name: 'diet_score' }] }, { type: 'group', title: 'Delirium', control: 'segmented', items: [ { type: 'radio', label: 'None', score: 0, name: 'delirium_score', checked: true }, { type: 'radio', label: 'Mild', score: 4, name: 'delirium_score' }, { type: 'radio', label: 'Mod-Severe', score: 8, name: 'delirium_score', isCritical: true }] }, { type: 'group', title: 'Mobility', control: 'segmented', items: [ { type: 'radio', label: 'Baseline', score: 0, name: 'mobility_score', checked: true }, { type: 'radio', label: 'Limited', score: 1, name: 'mobility_score' }, { type: 'radio', label: 'Assisted', score: 2, name: 'mobility_score' }, { type: 'radio', label: 'Bed-bound', score: 5, name: 'mobility_score' }] }, { type: 'group', title: 'Lines & Drains', items: [ { type: 'checkbox', label: 'Central Line present', score: 5, name: 'lines_cvc_present' }, { type: 'checkbox', label: 'Unstable Atrial Fibrillation', score: 10, name: 'crit_af', isCritical: true }, { type: 'checkbox', label: 'Altered Airway (Trach/Lary)', score: 5, name: 'airway_altered', isCritical: true }, { type: 'checkbox', label: 'High-Risk Drain present', score: 3, name: 'drains_high_risk' }, { type: 'checkbox', label: 'Bowels not opened >3 days or Ileus', score: 3, name: 'bowels_issue' }]} ]},
            { title: 'Systemic', color: 'red', items: [ { type: 'group', title: 'Patient Factors', items: [ { type: 'checkbox', label: 'ICU LOS > 3 days', score: 4, name: 'systemic_los', id: 'losCheckbox' }, { type: 'checkbox', label: '≥3 chronic comorbidities', score: 4, name: 'systemic_comorbid' }] }, { type: 'group', title: 'Frailty (pre-hospital)', control: 'segmented', items: [ { type: 'radio', label: 'Not Frail', score: 0, name: 'frailty_score', checked: true }, { type: 'radio', label: 'Mild', score: 2, name: 'frailty_score' }, { type: 'radio', label: 'Mod-Severe', score: 4, name: 'frailty_score' }] }, { type: 'group', title: 'Discharge Timing', items: [ { type: 'checkbox', label: 'After-Hours Discharge (first 24h)', score: 0, name: 'systemic_after_hours', id: 'systemic_after_hours_checkbox' }] } ]},
            { title: 'Receiving Ward and Staffing', color: 'indigo', items: [ { type: 'group', title: 'Bed Type', control: 'segmented', items: [ { type: 'radio', label: 'Unmonitored', score: 0, name: 'bed_type', checked: true }, { type: 'radio', label: 'Monitored', score: -3, name: 'bed_type' }] }, { type: 'group', title: 'Staffing', control: 'segmented', items: [ { type: 'radio', label: 'Standard Ratio', score: 0, name: 'env_ratio', checked: true }, { type: 'radio', label: 'Enhanced Ratio', score: -5, name: 'env_ratio' }] } ]},
            { title: 'Nursing Concern', color: 'yellow', items: [ { type: 'group', title: '', control: 'segmented', items: [ { type: 'radio', label: 'No Concerns', score: 0, name: 'concern_score', value: '0', checked: true }, { type: 'radio', label: 'Concern Present', score: 5, name: 'concern_score', value: '5', isCritical: true }] } ]} ];
        let html = '';
        sections.forEach(section => {
            html += `<div class="p-4 rounded-lg bg-${section.color}-50 mb-4"><h3 class="font-bold text-xl mb-3 text-gray-800">${section.title}</h3>`;
            section.items.forEach(item => {
                if (item.type === 'group') {
                    html += `<div class="score-group"><div class="score-group-title">${item.title}</div>`;
                    if (item.control === 'segmented') html += `<div class="segmented-control">`;
                    item.items.forEach(subItem => { html += buildScoreOption(subItem); });
                    if (item.control === 'segmented') html += `</div>`;
                    if (item.title === 'Lines & Drains') { html += `<div class="grid grid-cols-2 gap-x-4 p-2 text-sm mt-2 border-t"><div><label for="bowel_last_open" class="block font-medium">Last Bowel Movement:</label><input type="date" id="bowel_last_open" class="mt-1 block w-full"></div><div><label for="bowel_type" class="block font-medium">Type:</label><select id="bowel_type" class="mt-1 block w-full"><option value="">Select...</option><option>Normal</option><option>Diarrhoea</option><option>Constipated</option><option>Ileus / Not passed flatus</option><option>Stoma Active</option></select></div></div>`;}
                    if (item.title === '') { html += `<textarea id="nursingConcernText" name="nursingConcernText_note" class="score-note mt-4 w-full rounded-md border-gray-300" rows="2" placeholder="Specify concern..." style="display: none;"></textarea>`}
                    html += `</div>`;
                } else { html += buildScoreOption(item); }
            });
            html += `</div>`;
        });
        return html;
    }
    
    function buildScoreOption(item) {
        const scoreText = item.score !== undefined ? `<span>(${item.score > 0 ? '+' : ''}${item.score})</span>` : '';
        const noteHtml = `<textarea name="${item.name}_note" id="${item.name}_note" class="score-note mt-2 w-full rounded-md border-gray-300 shadow-sm text-sm p-2 hidden" rows="2" placeholder="Add details..."></textarea>`;
        const idAttr = item.id ? `id="${item.id}"` : '';
        return `<label class="score-option"> <input type="${item.type}" name="${item.name}" ${idAttr} class="score-input" data-score="${item.score || 0}" ${item.isCritical ? 'data-is-critical="true"' : ''} ${item.checked ? 'checked' : ''} ${item.value ? `value="${item.value}"` : ''}> <span class="option-label"><span>${item.label}</span>${scoreText}</span> ${noteHtml} </label>`;
    }
        
    initializeApp();
});


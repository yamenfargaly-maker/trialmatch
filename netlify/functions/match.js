export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await req.json(); } catch(e) { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  // PDF extraction mode
  if (body.extractOnly && body.documentText) {
    const content = `Extract the following patient information from this clinical document and return ONLY a JSON object with keys: patientId, age, sex, diagnosis, biomarkers, treatments, performance, location. If a field is not found leave it as empty string. Document:\n\n${body.documentText}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, messages: [{ role: 'user', content }] })
    });
    const d = await r.json();
    return new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const patientId = body.patientId || 'PT-ANON';
  const age = body.age || 'Not specified';
  const sex = body.sex || 'Not specified';
  const diagnosis = body.diagnosis || '';
  const biomarkers = body.biomarkers || 'None';
  const treatments = body.treatments || 'None';
  const performance = body.performance || 'Not specified';
  const location = body.location || 'Not specified';
  if (!diagnosis) return new Response(JSON.stringify({ error: 'diagnosis required' }), { status: 400 });

  let trialsContext = 'Generate realistic US recruiting trials for this indication.';
  try {
    const cond = encodeURIComponent(diagnosis.split(',')[0].trim());
    const r = await fetch(`https://clinicaltrials.gov/api/v2/studies?query.cond=${cond}&filter.overallStatus=RECRUITING&pageSize=10&fields=NCTId,BriefTitle,Phase,OverallStatus,EligibilityCriteria,LeadSponsorName,LocationCity,LocationState,LocationCountry`, { headers: { Accept: 'application/json' } });
    const d = await r.json();
    const studies = d.studies || [];
    if (studies.length > 0) {
      trialsContext = studies.map(s => {
        const id = s.protocolSection?.identificationModule;
        const st = s.protocolSection?.statusModule;
        const de = s.protocolSection?.designModule;
        const el = s.protocolSection?.eligibilityModule;
        const sp = s.protocolSection?.sponsorCollaboratorsModule?.leadSponsor;
        const lo = s.protocolSection?.contactsLocationsModule?.locations || [];
        const us = lo.filter(l => !l.country || l.country === 'United States');
        const ls = (us.length > 0 ? us : lo).slice(0,3).map(l => [l.city, l.state||l.country].filter(Boolean).join(', ')).join('; ');
        return `NCT: ${id?.nctId}\nTitle: ${id?.briefTitle}\nPhase: ${(de?.phases||['N/A']).join('/')}\nSponsor: ${sp?.name}\nUS sites: ${us.length > 0}\nLocations: ${ls}\nEligibility:\n${(el?.eligibilityCriteria||'N/A').substring(0,800)}\n---`;
      }).join('\n\n');
    }
  } catch(e) { console.error('CT.gov:', e.message); }

  const content = `You are a biomedical AI engine for clinical trial eligibility analysis using FHIR R4, SNOMED CT, and MeSH.\n\nPATIENT: ID=${patientId}, Age=${age}, Sex=${sex}, Diagnosis=${diagnosis}, Biomarkers=${biomarkers}, Treatments=${treatments}, Performance=${performance}, Location=${location}\n\nPrioritize US trials near ${location}. Only show non-US trials if no US alternatives exist.\n\nTRIALS:\n${trialsContext}\n\nReturn the 4 best matches as a JSON array. Each object must have: nct, title, phase, status, score (0-100), sponsor, locations (array of strings), intervention (one sentence), criteria (array of 4 objects with text and status fields where status is met/unmet/partial), fhir, snomed (array of 2 strings), mesh (array of 2 strings), screened (integer). Return ONLY the JSON array, no markdown.`;

  try {
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: [{ role: 'user', content }] })
    });
    const data = await ar.json();
    if (data.error) return new Response(JSON.stringify({ error: data.error.message }), { status: 500 });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
export const config = { path: '/api/match' };

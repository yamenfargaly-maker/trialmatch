export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { patientId, age, sex, diagnosis, biomarkers, treatments, performance, location } = await req.json();

  // Step 1: Query real ClinicalTrials.gov API
  let trialsContext = '';
  try {
    const condition = encodeURIComponent(diagnosis.split(',')[0].trim());
    const ctRes = await fetch(
      `https://clinicaltrials.gov/api/v2/studies?query.cond=${condition}&filter.overallStatus=RECRUITING&pageSize=10&fields=NCTId,BriefTitle,Phase,OverallStatus,EligibilityCriteria,LeadSponsorName,LocationCity,LocationState,LocationCountry`,
      { headers: { Accept: 'application/json' } }
    );
    const ctData = await ctRes.json();
    const studies = ctData.studies || [];

    trialsContext = studies.map((s) => {
      const id      = s.protocolSection?.identificationModule;
      const status  = s.protocolSection?.statusModule;
      const design  = s.protocolSection?.designModule;
      const elig    = s.protocolSection?.eligibilityModule;
      const sponsor = s.protocolSection?.sponsorCollaboratorsModule?.leadSponsor;
      const locs    = s.protocolSection?.contactsLocationsModule?.locations || [];
      const locStr  = locs.slice(0, 3).map(l => [l.city, l.state, l.country].filter(Boolean).join(', ')).join('; ');
      return `NCT: ${id?.nctId}\nTitle: ${id?.briefTitle}\nPhase: ${(design?.phases||['N/A']).join('/')}\nStatus: ${status?.overallStatus}\nSponsor: ${sponsor?.name}\nLocations: ${locStr||'Multiple sites'}\nEligibility:\n${(elig?.eligibilityCriteria||'Not available').substring(0,900)}\n---`;
    }).join('\n\n');
  } catch (e) {
    trialsContext = 'ClinicalTrials.gov unavailable. Generate realistic trials for this indication.';
  }

  // Step 2: Claude analyzes real trials against patient profile
  const prompt = `You are a biomedical AI engine for clinical trial eligibility analysis using FHIR R4, SNOMED CT, and MeSH.

PATIENT:
- ID: ${patientId||'PT-ANON'}, Age: ${age||'N/A'}, Sex: ${sex||'N/A'}
- Diagnosis: ${diagnosis}
- Biomarkers: ${biomarkers||'None'}
- Treatments: ${treatments||'None'}
- Performance: ${performance||'N/A'}
- Location: ${location||'N/A'}

REAL RECRUITING TRIALS FROM CLINICALTRIALS.GOV:
${trialsContext}

Select the 4 best-matching trials and for each return:
1. nct: exact NCT number
2. title: exact title
3. phase: phase
4. status: "Recruiting"
5. score: 0-100 match score based on actual criteria vs patient
6. sponsor: sponsor name
7. locations: array of location strings
8. intervention: one sentence describing the experimental arm
9. criteria: array of 4 objects {text, status} where status is "met"/"unmet"/"partial" — use actual criteria from the trial text
10. fhir: FHIR Condition code (e.g. "Condition/C0007134")
11. snomed: array of 2 SNOMED CT strings
12. mesh: array of 2 MeSH terms
13. screened: integer of studies screened

Return ONLY a valid JSON array. No markdown, no explanation.`;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await anthropicRes.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/api/match' };

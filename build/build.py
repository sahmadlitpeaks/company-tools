#!/usr/bin/env python3
"""Generate the multi-page Kingston site from shared partials + page content."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from partials import shell, page_header, related_services_card, aside_consult

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def write(name, html):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', name)

# --------------------------------------------------------------- About
about_body = '''
''' + page_header(
    "About Kingston",
    "A boutique UAE firm built for clients who want senior judgement on every page of their report.",
    "We exist to be the audit, tax and advisory partner that ambitious UAE businesses can actually trust — accessible to founders and rigorous enough for boards.",
    "About"
) + '''
<section>
  <div class="container two-col">
    <div class="visual reveal">
      <div class="seal">EST.<small>Kingston Dubai</small></div>
      <div class="badge">
        <div class="big">A+</div>
        <div class="lbl">Audit Quality Rating</div>
      </div>
    </div>
    <div class="reveal">
      <span class="eyebrow">Our story</span>
      <h2>Born in Dubai. Built for the UAE's most demanding finance leaders.</h2>
      <p>Kingston Chartered Auditing &amp; Advisory was founded by a team of senior chartered accountants who had spent careers inside the Big Four — and who believed UAE businesses deserved the same technical rigour without the slow, transactional service.</p>
      <p>From a single office on Sheikh Zayed Road, we have grown into a trusted partner to hundreds of UAE companies — from family-owned trading houses to fast-scaling tech firms and family offices. The work is the same, regardless of size: clean numbers, clear advice, no surprises.</p>
      <a href="contact.html" class="btn btn-primary mt-3">Talk to a partner <span class="arrow">→</span></a>
    </div>
  </div>
</section>

<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Mission &amp; Vision</span>
      <h2>Quietly raising the bar for audit and advisory in the UAE.</h2>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:980px;margin:0 auto">
      <div class="value reveal" style="padding:40px">
        <div class="v-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
        <h3 style="margin-bottom:10px">Our Mission</h3>
        <p>To deliver audit, tax and advisory work of uncompromising quality — making compliance a strategic advantage, not a cost.</p>
      </div>
      <div class="value reveal" style="padding:40px">
        <div class="v-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
        <h3 style="margin-bottom:10px">Our Vision</h3>
        <p>To be one of the UAE's most trusted audit, tax and advisory firms — recognised for integrity, technical excellence and financial transparency.</p>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Our values</span>
      <h2>The principles behind every signature on our reports.</h2>
    </div>
    <div class="values">
      <div class="value reveal">
        <div class="v-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <h4>Integrity</h4>
        <p>We do the right thing — even when it is the difficult thing. Our independence is non-negotiable.</p>
      </div>
      <div class="value reveal">
        <div class="v-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
        <h4>Excellence</h4>
        <p>Technically sharp, current with regulation, and obsessed with the quality of every workpaper we sign.</p>
      </div>
      <div class="value reveal">
        <div class="v-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <h4>Client focus</h4>
        <p>You get a senior partner on speed-dial — not a ticket number in a queue.</p>
      </div>
      <div class="value reveal">
        <div class="v-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
        <h4>Accountability</h4>
        <p>Fixed fees, fixed timelines, signed off in writing. We meet our commitments — or tell you why early.</p>
      </div>
      <div class="value reveal">
        <div class="v-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <h4>Confidentiality</h4>
        <p>Your data lives in encrypted, access-controlled environments. NDAs, watertight processes, zero leakage.</p>
      </div>
      <div class="value reveal">
        <div class="v-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg></div>
        <h4>Innovation</h4>
        <p>Audit analytics, automation and AI-assisted review — modern tools applied to centuries-old standards.</p>
      </div>
    </div>
  </div>
</section>

<section class="stats">
  <div class="container">
    <div class="section-head reveal" style="margin-bottom:48px">
      <span class="eyebrow center" style="color:var(--gold-400)">By the numbers</span>
      <h2 style="color:#fff">A track record measured in client trust.</h2>
    </div>
    <div class="stats-grid">
      <div class="stat reveal"><div class="num"><span data-count="500">0</span><small>+</small></div><div class="label">Engagements delivered</div></div>
      <div class="stat reveal"><div class="num"><span data-count="350">0</span><small>+</small></div><div class="label">UAE companies served</div></div>
      <div class="stat reveal"><div class="num"><span data-count="98">0</span><small>%</small></div><div class="label">Client retention rate</div></div>
      <div class="stat reveal"><div class="num"><span data-count="12">0</span></div><div class="label">Industry sectors covered</div></div>
    </div>
  </div>
</section>

<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Leadership</span>
      <h2>Senior, hands-on, and accessible.</h2>
      <p>Every Kingston engagement is led by a partner — not a junior. The people who pitch you are the people who do the work.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px" class="values">
      <div class="value reveal" style="text-align:center;padding:36px 28px">
        <div style="width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,var(--navy-900),var(--navy-700));color:var(--gold-400);font-family:var(--font-serif);font-size:2rem;font-weight:600;display:grid;place-items:center;margin:0 auto 18px">AK</div>
        <h4>Adel Kassem, FCA</h4>
        <p style="font-size:.85rem;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-700);margin:6px 0 14px">Managing Partner</p>
        <p>20 years in audit and assurance, including a decade at a Big Four firm in Dubai and London.</p>
      </div>
      <div class="value reveal" style="text-align:center;padding:36px 28px">
        <div style="width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,var(--navy-900),var(--navy-700));color:var(--gold-400);font-family:var(--font-serif);font-size:2rem;font-weight:600;display:grid;place-items:center;margin:0 auto 18px">SR</div>
        <h4>Sara Rahman, CPA</h4>
        <p style="font-size:.85rem;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-700);margin:6px 0 14px">Partner — Tax</p>
        <p>UAE corporate tax, VAT and FTA representation specialist. Frequent FTA workshop speaker.</p>
      </div>
      <div class="value reveal" style="text-align:center;padding:36px 28px">
        <div style="width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,var(--navy-900),var(--navy-700));color:var(--gold-400);font-family:var(--font-serif);font-size:2rem;font-weight:600;display:grid;place-items:center;margin:0 auto 18px">YN</div>
        <h4>Yusuf Nasser, CFE</h4>
        <p style="font-size:.85rem;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-700);margin:6px 0 14px">Partner — Forensics &amp; DD</p>
        <p>Certified Fraud Examiner. Led 80+ forensic and transaction-support engagements across the GCC.</p>
      </div>
    </div>
  </div>
</section>
'''
write('about.html', shell(
    "About — Kingston Chartered Auditing &amp; Advisory, Dubai",
    "Learn about Kingston Chartered Auditing &amp; Advisory — a Dubai-based, partner-led audit, tax and advisory firm built for ambitious UAE businesses.",
    "about", about_body
))

# --------------------------------------------------------------- Services overview
services_body = page_header(
    "Our services",
    "Audit, tax, advisory &amp; compliance — under one trusted Dubai roof.",
    "From statutory audit to forensic investigations, corporate tax to ESR, every Kingston service is designed around one promise: rigorous work, clear counsel, on time.",
    "Services"
) + '''
<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Audit &amp; Assurance</span>
      <h2>Independent assurance the market trusts.</h2>
    </div>
    <div class="service-grid">
      <a href="statutory-audit.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/statutory-audit.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/statutory-audit.svg" alt="Statutory Audit" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">01</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <h3>Statutory Audit</h3>
        <p>IFRS-aligned external audits that satisfy UAE corporate law and Free Zone authority requirements.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="internal-audit.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/internal-audit.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/internal-audit.svg" alt="Internal Audit" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">02</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
        <h3>Internal Audit</h3>
        <p>Risk-based internal audit, controls assurance and operational efficiency reviews — co-source or full outsource.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="forensic-audit.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/forensic-audit.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/forensic-audit.svg" alt="Forensic Audit" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">03</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
        <h3>Forensic Audit</h3>
        <p>Fraud investigations, asset tracing and litigation support — with court-ready evidence and discreet handling.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="free-zone.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/free-zone.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/free-zone.svg" alt="Free Zone" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">04</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg></div>
        <h3>Free Zone Audit</h3>
        <p>Approved auditors across DMCC, JAFZA, DAFZA, ADGM, DIFC, RAKEZ &amp; more — licence-renewal aligned.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="due-diligence.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/due-diligence.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/due-diligence.svg" alt="Due Diligence" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">05</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21l-4.35-4.35"/><circle cx="11" cy="11" r="8"/></svg></div>
        <h3>Due Diligence</h3>
        <p>Financial, tax and operational due diligence for buyers, sellers and lenders. Surface the truth before signing.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="accounting.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/accounting.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/accounting.svg" alt="Accounting" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">06</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20v18H2z"/><path d="M2 9h20"/><path d="M9 21V9"/></svg></div>
        <h3>Accounting &amp; Bookkeeping</h3>
        <p>Cloud-first outsourced accounting — IFRS-compliant, audit-ready monthly management accounts by WD5.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Tax</span>
      <h2>End-to-end UAE tax — from registration to FTA representation.</h2>
    </div>
    <div class="service-grid">
      <a href="corporate-tax.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/corporate-tax.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/corporate-tax.svg" alt="Corporate Tax" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">07</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <h3>Corporate Tax</h3>
        <p>Registration, structuring, returns and advisory for UAE&rsquo;s 9% corporate tax — with optimisation planning.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="vat.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/vat.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/vat.svg" alt="Vat" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">08</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3l-3 18"/><path d="M18 3l-3 18"/></svg></div>
        <h3>VAT Services</h3>
        <p>VAT registration, return preparation, refund recovery, audits and FTA representation.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="excise-tax.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/excise-tax.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/excise-tax.svg" alt="Excise Tax" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">09</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v4H3z"/><path d="M5 7v14h14V7"/><path d="M9 11h6"/></svg></div>
        <h3>Excise Tax</h3>
        <p>Registration, calculation, filing and advisory for businesses dealing in excisable goods.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
    </div>
  </div>
</section>

<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Compliance</span>
      <h2>Stay ahead of UAE regulators — quietly, and in writing.</h2>
    </div>
    <div class="service-grid">
      <a href="aml-compliance.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/aml-compliance.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/aml-compliance.svg" alt="Aml Compliance" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">10</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg></div>
        <h3>AML/CFT Compliance</h3>
        <p>Risk assessment, policies, goAML registration, training and independent AML audits for DNFBPs and financial businesses.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="esr.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/esr.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/esr.svg" alt="Esr" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">11</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
        <h3>ESR Compliance</h3>
        <p>Economic Substance Regulations — scoping, notification, annual report and regulator response support.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
        </div>
      </a>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">How we work</span>
      <h2>A predictable, transparent engagement flow.</h2>
    </div>
    <div class="process">
      <div class="step reveal"><span class="step-num">01</span><h4>Discovery</h4><p>A free, confidential scoping call to understand your business, structure, deadlines and risk areas.</p></div>
      <div class="step reveal"><span class="step-num">02</span><h4>Tailored Plan</h4><p>A fixed scope, timeline and fee — agreed in writing before a single workpaper is opened.</p></div>
      <div class="step reveal"><span class="step-num">03</span><h4>Execution</h4><p>Senior-led fieldwork with a single point of contact and weekly status updates.</p></div>
      <div class="step reveal"><span class="step-num">04</span><h4>Reporting</h4><p>A clear final report, a debrief with your team, and ongoing advice for the next financial year.</p></div>
    </div>
  </div>
</section>
'''
write('services.html', shell(
    "Services — Kingston Chartered Auditing &amp; Advisory",
    "Explore Kingston's full range of services: statutory audit, internal audit, forensic audit, due diligence, corporate tax, VAT and excise tax — delivered from Dubai.",
    "services", services_body
))

# --------------------------------------------------------------- Service detail page builder
# Map service slug to its placeholder image (in assets/img/services/SLUG.svg)
SERVICE_IMG = {
    'statutory-audit':    'services/statutory-audit.svg',
    'internal-audit':     'services/internal-audit.svg',
    'forensic-audit':     'services/forensic-audit.svg',
    'free-zone':          'services/free-zone.svg',
    'due-diligence':      'services/due-diligence.svg',
    'corporate-tax':      'services/corporate-tax.svg',
    'vat':                'services/vat.svg',
    'excise-tax':         'services/excise-tax.svg',
    'accounting':         'services/accounting.svg',
    'aml-compliance':     'services/aml-compliance.svg',
    'esr':                'services/esr.svg',
    'feasibility-studies':'services/feasibility.svg',
    'business-setup':     'services/business-setup.svg',
    'mainland-setup':     'services/mainland-setup.svg',
    'offshore-setup':     'services/offshore-setup.svg',
    'pro-services':       'services/pro-services.svg',
}

def service_page(slug, name, eyebrow, hero_title, hero_sub, intro, features, process_steps, faqs, why_us):
    feat_html = '\n'.join(
        f'''        <li>
          <span class="check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
          <div><strong>{t}</strong><span>{d}</span></div>
        </li>''' for t, d in features
    )
    proc_html = '\n'.join(
        f'''      <div class="step reveal"><span class="step-num">{i+1:02d}</span><h4>{t}</h4><p>{d}</p></div>'''
        for i, (t, d) in enumerate(process_steps)
    )
    faq_html = '\n'.join(
        f'''      <details class="faq reveal"><summary>{q}</summary><p>{a}</p></details>'''
        for q, a in faqs
    )
    why_html = '\n'.join(
        f'''        <li>
          <span class="check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
          <div><strong>{t}</strong><span>{d}</span></div>
        </li>''' for t, d in why_us
    )

    banner = SERVICE_IMG.get(slug)
    body = page_header(eyebrow, hero_title, hero_sub, name,
                       banner_image=banner, banner_alt=f"{name} — Kingston") + f'''
<section>
  <div class="container service-layout">
    <div class="service-content reveal">
      <span class="eyebrow">Overview</span>
      <h2 style="margin-top:14px">{name} in the UAE — done right.</h2>
      {intro}
      <h3>What is included</h3>
      <ul class="feat">
{feat_html}
      </ul>
      <h3>Why clients choose Kingston</h3>
      <ul class="feat">
{why_html}
      </ul>
    </div>
    <aside style="display:flex;flex-direction:column;gap:18px">
      {aside_consult()}
      {related_services_card(slug + '.html')}
    </aside>
  </div>
</section>

<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Our process</span>
      <h2>How a {name.lower()} engagement runs.</h2>
    </div>
    <div class="process">
{proc_html}
    </div>
  </div>
</section>

<section>
  <div class="container" style="max-width:880px">
    <div class="section-head reveal">
      <span class="eyebrow center">FAQ</span>
      <h2>Common questions about {name.lower()}.</h2>
    </div>
{faq_html}
  </div>
</section>
'''
    return body

# --- Statutory Audit
write('statutory-audit.html', shell(
    "Statutory Audit Services in Dubai, UAE — Kingston Chartered Auditing &amp; Advisory",
    "IFRS-aligned statutory audit services in Dubai. Kingston delivers independent, partner-led external audits that satisfy UAE corporate law and Free Zone authority requirements.",
    "service-detail",
    service_page(
        slug="statutory-audit",
        name="Statutory Audit",
        eyebrow="Audit &amp; Assurance",
        hero_title="Statutory audit, signed off with confidence.",
        hero_sub="Independent, IFRS-aligned external audits that satisfy UAE corporate law, Free Zone authority requirements and the expectations of banks, investors and your board.",
        intro='''<p>A statutory audit is more than a compliance tick. It is the moment when your stakeholders — banks, shareholders, regulators, investors — get to see whether your numbers can be trusted.</p>
        <p>As a leading chartered audit firm in the UAE, Kingston provides comprehensive statutory audit services that ensure your business complies with local laws and international standards — and gives every external reader of your accounts complete confidence in what they see.</p>''',
        features=[
            ("Independent IFRS audit opinion", "Issued by senior chartered accountants licensed to sign UAE statutory audit reports."),
            ("UAE corporate law compliance", "Full alignment with UAE Commercial Companies Law, Free Zone authority requirements and ESR."),
            ("Risk-based audit methodology", "We focus effort where it matters — material balances, judgement areas, and high-risk transactions."),
            ("Internal control review", "Findings on control weaknesses, with practical recommendations to strengthen your finance function."),
            ("Management letter &amp; debrief", "A clear written report and a partner-led debrief for your CFO, board or audit committee."),
            ("Audit-ready advisory", "Year-round access to your engagement partner for technical questions on accounting and reporting."),
        ],
        why_us=[
            ("Partner-led, no juniors flying solo", "A senior chartered accountant signs every workpaper and runs every closing meeting."),
            ("On-time delivery, every time", "98% of our statutory audits are issued on or ahead of the agreed deadline."),
            ("Plain-English reporting", "Findings boards understand and management can act on — no jargon, no padding."),
            ("Free Zone &amp; Mainland fluency", "DMCC, JAFZA, DAFZA, ADGM, DIFC, Mainland — we know each authority's quirks."),
        ],
        process_steps=[
            ("Planning &amp; risk assessment", "We map your operations, financial structure and compliance requirements, identify risks and design a tailored audit strategy."),
            ("Fieldwork &amp; testing", "Senior-led examination of financial documents, accounting records, internal controls and supporting evidence."),
            ("Reporting", "A detailed audit report covering financial health, compliance status and recommendations for improvement."),
            ("Post-audit support", "Expert guidance on corrective measures and strategies to strengthen financial controls for next year."),
        ],
        faqs=[
            ("Is a statutory audit mandatory in the UAE?", "Yes — most UAE companies (Mainland and most Free Zones) are legally required to file annual audited financial statements. Kingston confirms your specific obligation in the discovery call."),
            ("Which standards do you audit against?", "We audit in line with International Standards on Auditing (ISA) and report under International Financial Reporting Standards (IFRS), as required by UAE corporate law."),
            ("How long does a statutory audit take?", "For a typical SME, fieldwork runs 2–4 weeks, with the final signed report issued 1–2 weeks after closing meetings. Larger or group audits scale from there."),
            ("Are your audit reports accepted by Free Zones and banks?", "Yes — Kingston is a UAE-licensed chartered audit firm whose reports are accepted by all major Free Zones, banks and the Federal Tax Authority."),
        ]
    )
))

# --- Internal Audit
write('internal-audit.html', shell(
    "Internal Audit Services in Dubai, UAE — Kingston Chartered Auditing &amp; Advisory",
    "Risk-based internal audit, controls assurance and operational efficiency reviews. Co-source or full outsource — Kingston's senior team helps UAE boards sleep at night.",
    "service-detail",
    service_page(
        slug="internal-audit",
        name="Internal Audit",
        eyebrow="Audit &amp; Assurance",
        hero_title="Strengthen controls. Manage risk. Find the savings.",
        hero_sub="Internal audit reviews and improves your controls, risk management and compliance — supporting effective operations and giving boards an independent line of sight.",
        intro='''<p>Internal audit is your second line of defence — the team that quietly checks whether the controls you designed on paper are actually working in practice. Done well, it is one of the highest-return investments a CFO or audit committee can make.</p>
        <p>Kingston delivers internal audit as a co-source partner to your in-house team, or as a fully outsourced function for businesses that do not yet have one. Either way, you get senior, independent eyes on the things that keep boards up at night.</p>''',
        features=[
            ("Risk &amp; controls assessment", "A practical map of your top operational, financial, regulatory and IT risks — and the controls expected to address them."),
            ("Annual internal audit plan", "A risk-prioritised programme of reviews aligned with your strategy and audit committee priorities."),
            ("Process &amp; controls reviews", "Procure-to-pay, order-to-cash, payroll, treasury, IT general controls — wherever cash, data or risk lives."),
            ("SOX-style testing", "Where required, walkthroughs and operating-effectiveness testing aligned with global control frameworks."),
            ("Operational efficiency findings", "Not just risk — we surface duplicated effort, leaky controls and manual work begging for automation."),
            ("Audit committee reporting", "Clear, concise board-ready reporting — issues, root causes, recommendations and management responses."),
        ],
        why_us=[
            ("Co-source flexibility", "Scale from a single review up to a full outsourced function — and back down — without rebuilding the team."),
            ("Industry-aware", "Trading, real estate, retail, professional services, technology and family offices — we know the typical pressure points."),
            ("Outcome-focused, not box-ticking", "Findings written for action: who, what, by when — not abstract compliance language."),
            ("Independent and discreet", "Free of the politics that constrain in-house teams. Findings reach the audit committee unfiltered."),
        ],
        process_steps=[
            ("Risk assessment", "Workshop with leadership and finance to map and prioritise risk across the business."),
            ("Audit plan", "A written, board-approved plan: scope, timeline, fees and reporting cadence."),
            ("Reviews &amp; testing", "Fieldwork on each scoped area — process walkthroughs, sample testing, root-cause analysis."),
            ("Reporting &amp; follow-up", "Issued reports per review, plus a quarterly tracker of management actions to closure."),
        ],
        faqs=[
            ("Do we need internal audit if we already have an external audit?", "Yes — they answer different questions. External audit gives an independent opinion on the past year's accounts. Internal audit improves the controls and processes that produce those numbers in the first place."),
            ("Can Kingston co-source with our in-house team?", "Absolutely. Many of our engagements are co-source — your team handles core reviews, ours handles specialist or peak-load work like IT GC, treasury or international entity reviews."),
            ("How often should reviews happen?", "Most clients run a rolling annual plan, with quarterly audit committee reporting. Higher-risk areas (cash, payroll, regulated activities) typically see more frequent visits."),
            ("Do you report directly to the audit committee?", "Yes — when scope includes audit committee reporting, we present findings directly to the committee, with management briefed in advance."),
        ]
    )
))

# --- Forensic Audit
write('forensic-audit.html', shell(
    "Forensic Audit &amp; Investigation Services in Dubai, UAE — Kingston",
    "Discreet forensic audit, fraud investigation and litigation support in Dubai. Court-ready evidence, certified fraud examiners, GCC-wide.",
    "service-detail",
    service_page(
        slug="forensic-audit",
        name="Forensic Audit",
        eyebrow="Audit &amp; Assurance",
        hero_title="When the numbers do not add up — quietly, we find out why.",
        hero_sub="A forensic audit is a detailed examination of financial records to detect fraud, investigate financial crime or gather evidence for legal proceedings — handled with the discretion such matters demand.",
        intro='''<p>The first sign is rarely dramatic. A reconciliation that never balances. A vendor nobody can locate. A senior employee who is unusually defensive about their books. By the time something is obviously wrong, real money has typically already left the building.</p>
        <p>Kingston's forensic team — led by Certified Fraud Examiners — investigates suspected fraud, asset misappropriation and financial crime. We work in tight coordination with your legal counsel, produce evidence that holds up in court, and protect your reputation throughout.</p>''',
        features=[
            ("Fraud investigation", "Vendor fraud, payroll fraud, expense abuse, procurement schemes, ghost employees, diversion — we have seen it all."),
            ("Asset tracing", "Following the money across entities, jurisdictions and instruments to identify what was taken and where it went."),
            ("Forensic accounting", "Detailed reconstruction of transactions, journal entries and supporting documents — admissible as evidence."),
            ("Litigation support &amp; expert witness", "Reports drafted to evidentiary standards, expert testimony in UAE and DIFC proceedings where required."),
            ("Whistleblower investigations", "Independent, confidential intake and investigation of internal reports — with appropriate firewalls."),
            ("Anti-fraud controls remediation", "Once the bleeding stops, we help you redesign controls so it cannot happen again."),
        ],
        why_us=[
            ("Certified Fraud Examiners on every job", "Trained specifically in interview technique, evidence handling and fraud schemes."),
            ("Strict confidentiality", "Encrypted comms, NDAs, &quot;need to know&quot; teaming. Internal investigations stay internal."),
            ("Court-ready evidence", "Workpapers, chain-of-custody and reports built to standards of UAE courts and DIFC arbitration."),
            ("Speed when it matters", "Fraud investigations are time-sensitive. Engagements typically launch within 48 hours of authorisation."),
        ],
        process_steps=[
            ("Confidential briefing", "Privileged scoping with you and your legal counsel — what is suspected, what is at stake, who can know."),
            ("Evidence preservation", "Securing accounting systems, emails, devices and physical records before they can be tampered with."),
            ("Investigation &amp; analysis", "Document review, data analytics, interviews, asset tracing — coordinated with legal strategy."),
            ("Reporting &amp; support", "A formal forensic report, optional expert testimony, and recommendations for control remediation."),
        ],
        faqs=[
            ("How is a forensic audit different from a normal audit?", "A normal audit gives reasonable assurance that the accounts are not materially misstated. A forensic audit assumes something specific is wrong and sets out to prove or disprove it — to the standard required by courts."),
            ("Can findings be used in court?", "Yes — that is the point. Our methodology, workpapers and reports are designed to meet the evidentiary standards of UAE courts, DIFC and arbitral tribunals."),
            ("Is the engagement confidential?", "Strictly. Forensic engagements operate under NDA, with restricted teaming and secure data handling. We routinely work directly with your legal counsel under privilege."),
            ("How quickly can you mobilise?", "For credible fraud concerns, Kingston typically begins evidence preservation within 48 hours of engagement letter signature."),
        ]
    )
))

# --- Due Diligence
write('due-diligence.html', shell(
    "Due Diligence Services in Dubai, UAE — Kingston Chartered Auditing &amp; Advisory",
    "Financial, tax and operational due diligence for buyers, sellers and lenders across the UAE. Surface the truth before the deal closes.",
    "service-detail",
    service_page(
        slug="due-diligence",
        name="Due Diligence",
        eyebrow="Transaction Advisory",
        hero_title="Buy facts, not surprises.",
        hero_sub="A thorough investigation of a business or counterparty before a transaction — to assess financial health, risks and compliance — so you walk into the deal with eyes open.",
        intro='''<p>Most deals that go wrong, go wrong on something that was knowable before signing. The job of due diligence is to find that something — fast, discreetly, and in time for it to actually change the deal.</p>
        <p>Kingston conducts financial, tax and operational due diligence for UAE buyers, sellers and lenders — from family-business succession deals to mid-market private equity acquisitions. We work to your timeline and your deal logic, not a generic checklist.</p>''',
        features=[
            ("Financial due diligence", "Quality-of-earnings, normalised EBITDA, working capital analysis, debt-like items, cash quality and trend analytics."),
            ("Tax due diligence", "UAE corporate tax, VAT, excise, withholding and historic tax exposure review — including Free Zone status integrity."),
            ("Operational due diligence", "Customer concentration, supplier dependence, key-person risk, contract review and management calibre."),
            ("Vendor due diligence", "Sell-side reports for owners taking the business to market — designed to accelerate the deal and protect value."),
            ("Red-flag reviews", "Lean, pre-LOI scoping reviews to spot deal-breakers before significant deal costs are incurred."),
            ("Synergy &amp; integration support", "Post-signing — a clear plan for integrating finance, controls and reporting into the acquirer."),
        ],
        why_us=[
            ("Deal-experienced senior team", "Diligence led by partners who have run buy-side and sell-side processes across the GCC."),
            ("Built around your deal logic", "We start from your investment thesis and work backwards — not a generic 200-page checklist."),
            ("Issues, surfaced early", "We push concerns into your inbox in real time — not as a surprise on page 47 of a final report."),
            ("Tight, decision-grade reports", "Reports designed for IC and bank credit memos — not as billable padding."),
        ],
        process_steps=[
            ("Deal scoping", "Kick-off with your deal team to align on thesis, timeline, key risks and reporting format."),
            ("Information request &amp; data room review", "Targeted IR list, virtual data room review and management interviews."),
            ("Analysis", "Quality of earnings, working capital, debt-like items, tax exposure, operational red flags."),
            ("Final report &amp; SPA support", "Decision-grade report, plus support translating findings into SPA negotiation points."),
        ],
        faqs=[
            ("How long does a due diligence engagement take?", "Red-flag reviews run 1–2 weeks. Full financial &amp; tax DD typically runs 3–6 weeks, depending on data room quality and target complexity."),
            ("Can you work alongside our legal counsel?", "Yes — and we recommend it. Joint kick-offs and weekly checkpoints with legal counsel produce sharper diligence and a tighter SPA."),
            ("Do you do sell-side (vendor) due diligence?", "Yes. A well-run vendor DD process accelerates buyer diligence, reduces price chips and protects value for sellers."),
            ("Is the report admissible if the deal goes to dispute later?", "Our reports are produced under standard professional liability terms and are routinely relied on in post-closing arbitration and adjustment disputes."),
        ]
    )
))

# --- Corporate Tax
write('corporate-tax.html', shell(
    "Corporate Tax Services in Dubai, UAE — Kingston Chartered Auditing &amp; Advisory",
    "End-to-end UAE corporate tax services: registration, structuring, return preparation, advisory and FTA representation. Compliant and optimised.",
    "service-detail",
    service_page(
        slug="corporate-tax",
        name="Corporate Tax",
        eyebrow="Tax &amp; Compliance",
        hero_title="UAE corporate tax — handled, end to end.",
        hero_sub="Plan, file and defend. Corporate tax services that help businesses manage their tax obligations through planning, compliance, filing and advisory — ensuring adherence to UAE corporate tax laws and optimising tax efficiency.",
        intro='''<p>The introduction of UAE corporate tax has been the largest change in the country's regulatory landscape in a generation. The headline 9% rate is the easy part — the hard part is the structuring, the Qualifying Free Zone Person rules, transfer pricing, group relief and the exemption tests that determine what you actually pay.</p>
        <p>Kingston's tax partners advise UAE businesses across the full corporate tax lifecycle — from initial registration to defending positions before the FTA — with a single goal: a fully compliant tax position, optimised within the four corners of the law.</p>''',
        features=[
            ("Corporate tax registration", "Federal Tax Authority registration, group registration and structuring of free zone, mainland and offshore entities."),
            ("Tax impact assessment", "A full diagnostic of how UAE corporate tax applies to your group — by entity, activity and revenue stream."),
            ("Structuring &amp; QFZP analysis", "Qualifying Free Zone Person eligibility, qualifying income testing, and group restructuring where appropriate."),
            ("Return preparation &amp; filing", "End-to-end preparation, review and filing of your annual corporate tax return with full supporting workpapers."),
            ("Transfer pricing", "Documentation, benchmarking and policy design — including local file, master file and disclosure form."),
            ("FTA representation", "Responses to FTA enquiries, audits and clarifications — handled by partners who speak the FTA's language."),
        ],
        why_us=[
            ("Tax-technical depth", "A team of UAE corporate tax and transfer pricing specialists, with regular FTA workshop participation."),
            ("Optimisation, ethically", "Every legal lever — exemptions, group relief, qualifying income — pulled. No grey-area positions."),
            ("Audit defensibility built in", "Every position we advise is documented to a standard that survives FTA scrutiny."),
            ("Joined-up with your audit", "Tax and audit live under one roof — accounting policy and tax position aligned by design."),
        ],
        process_steps=[
            ("Diagnostic", "Map your group, revenue streams and tax exposure. Identify quick wins and structural decisions."),
            ("Plan &amp; structure", "Implement registrations, restructure where beneficial, and document the planned tax position."),
            ("Compliance &amp; filing", "Annual return preparation, transfer pricing documentation and disclosure-form filing."),
            ("Defence &amp; advisory", "Year-round access for technical questions; full FTA representation if your return is selected for audit."),
        ],
        faqs=[
            ("Who is subject to UAE corporate tax?", "All UAE businesses with taxable profits exceeding AED 375,000 are within scope, with specific regimes for Free Zone Persons, Qualifying Free Zone Persons and natural persons. Kingston confirms your exact obligation in the diagnostic."),
            ("Do Free Zone companies still pay 0%?", "Only if they meet the Qualifying Free Zone Person conditions on every test — substance, qualifying income, transfer pricing and audited financials. We assess and document this annually."),
            ("Do you handle transfer pricing?", "Yes — we prepare master file, local file and disclosure forms, and advise on intra-group pricing policies before they become an audit issue."),
            ("Can you handle FTA audits?", "Yes — Kingston represents clients through the full FTA enquiry and audit process, including formal objections and reconsideration requests."),
        ]
    )
))

# --- VAT
write('vat.html', shell(
    "VAT Services in Dubai, UAE — Kingston Chartered Auditing &amp; Advisory",
    "Comprehensive VAT services in the UAE: registration, return preparation, refund recovery, audits and FTA representation.",
    "service-detail",
    service_page(
        slug="vat",
        name="VAT Services",
        eyebrow="Tax &amp; Compliance",
        hero_title="VAT, handled. So you can focus on the business.",
        hero_sub="Comprehensive VAT services that help UAE businesses navigate VAT regulations, ensure compliance and optimise tax efficiency.",
        intro='''<p>VAT seems simple — until your first refund is rejected, an input claim is denied on a technicality, or the FTA opens an audit and asks for two years of supporting documents in fourteen days.</p>
        <p>Kingston handles the full VAT lifecycle for UAE businesses: registration, return preparation, refunds, audits and disputes. We bring senior FTA-experienced specialists to engagements small enough that most firms would assign a junior.</p>''',
        features=[
            ("VAT registration &amp; deregistration", "Mandatory and voluntary registration, group registration, and clean deregistration when activities cease."),
            ("Quarterly &amp; monthly return preparation", "Accurate, on-time return filing with full supporting workpapers and reconciliation to your accounting system."),
            ("VAT refund recovery", "Specialised support for tourist scheme, UAE national home-builder and business refund applications."),
            ("VAT health checks", "A pre-audit diagnostic — where the FTA would find issues, before they do."),
            ("VAT audits &amp; FTA representation", "Full handling of FTA audits, clarifications, objections and reconsideration requests."),
            ("Industry-specific advisory", "Real estate, e-commerce, free zones, designated zones, financial services — VAT treatment is rarely vanilla."),
        ],
        why_us=[
            ("FTA-experienced team", "Specialists who have stood in front of FTA auditors many times — and know exactly what they ask for."),
            ("Documentation done properly", "Workpapers and supporting files that survive an audit five years later."),
            ("Refund recovery focus", "We push every refund claim that is genuinely available — and document them to win."),
            ("Clear, fixed fees", "Monthly subscriptions or fixed-fee project work. No bill shocks at year-end."),
        ],
        process_steps=[
            ("VAT diagnostic", "Review of registrations, treatments and historic returns to spot risk and refund opportunities."),
            ("Compliance setup", "Chart of accounts, tax codes, supplier &amp; customer master, invoice templates — VAT-correct from day one."),
            ("Return cycle", "Monthly or quarterly preparation, review and filing — with documentation kept ready for any FTA request."),
            ("Audit &amp; defence", "Where the FTA enquires, we lead the response, prepare the file, and represent you through to closure."),
        ],
        faqs=[
            ("When is VAT registration mandatory?", "Mandatory registration applies once your taxable supplies and imports exceed AED 375,000 in a 12-month period. Voluntary registration is available from AED 187,500."),
            ("Are Free Zone companies subject to VAT?", "Most are — Free Zone status does not exempt VAT. Designated Zones have specific rules for goods, but services are generally taxable."),
            ("How long does a VAT refund take?", "FTA refund timelines vary. A well-prepared application with complete supporting documentation typically resolves in 20–40 business days."),
            ("Can you represent us in an FTA audit?", "Yes — Kingston handles the full audit lifecycle, including responding to information requests, attending FTA meetings and filing reconsideration requests."),
        ]
    )
))

# --- Excise Tax
write('excise-tax.html', shell(
    "Excise Tax Services in Dubai, UAE — Kingston Chartered Auditing &amp; Advisory",
    "Excise tax registration, calculation, filing and advisory for businesses dealing in excisable goods in the UAE.",
    "service-detail",
    service_page(
        slug="excise-tax",
        name="Excise Tax",
        eyebrow="Tax &amp; Compliance",
        hero_title="Excise tax — registered, calculated, filed.",
        hero_sub="End-to-end excise tax services for UAE businesses dealing in tobacco, energy drinks, sweetened beverages and electronic smoking devices — including registration, calculation, filing and advisory.",
        intro='''<p>Excise tax is narrow in scope but unforgiving in application. Mis-classify a product, miss a registration deadline or get the price-base wrong, and penalties accumulate fast. The rules are also product-specific — what applies to a soft drink does not apply to an energy drink does not apply to an e-liquid.</p>
        <p>Kingston advises importers, manufacturers, stockpilers and warehouse-keepers on the full excise lifecycle — registration through to FTA audit defence — with a focus on getting the product classifications and price bases right the first time.</p>''',
        features=[
            ("Excise tax registration", "FTA registration as importer, producer, stockpiler or designated-zone warehouse-keeper."),
            ("Product classification", "Accurate classification of products against the excisable goods list and the FTA's published price database."),
            ("Designated zone advisory", "Bonded warehouse and designated zone movements, including transfer rules and obligations on release."),
            ("Filing &amp; payment", "Monthly excise return preparation, supporting workpapers and timely settlement of liabilities."),
            ("Stockpile declarations", "Identification, valuation and declaration of stockpiled excisable goods at rate-change events."),
            ("FTA audit support", "Response, document preparation and representation through FTA excise audits and clarifications."),
        ],
        why_us=[
            ("Specialist team", "Excise is small but technical — and we keep dedicated specialists across importers and stockpilers."),
            ("End-to-end coverage", "Registration, monthly compliance, designated-zone movements and FTA defence — under one roof."),
            ("Penalty prevention", "Most excise penalties are avoidable with cleaner upstream classification — that is where we focus."),
            ("Sector experience", "Beverages, tobacco and electronic smoking devices — we have served all three categories."),
        ],
        process_steps=[
            ("Diagnostic", "Confirm registration category, classify products and identify any historical exposure."),
            ("Registration &amp; setup", "Complete FTA registration, configure systems and document the price-base methodology."),
            ("Monthly compliance", "Return preparation, supporting calculations and timely filing &amp; payment."),
            ("Audit &amp; advisory", "Year-round access for technical questions and full representation through FTA audits."),
        ],
        faqs=[
            ("Which goods are excisable in the UAE?", "Tobacco and tobacco products, electronic smoking devices and liquids, energy drinks (100%), and sweetened/carbonated drinks (50%). Kingston confirms current rates and product scope at engagement."),
            ("Do I need to register if I only stockpile?", "Yes — stockpilers above defined thresholds must register and may have liability on stocks held at rate change events."),
            ("How often are excise returns filed?", "Excise returns are filed monthly, typically within 15 days of the end of the tax period, with payment due alongside."),
            ("Can you handle imports through designated zones?", "Yes — including bonded warehouse setup, intra-zone movements and the excise consequences of release for consumption."),
        ]
    )
))

# --- Free Zone
write('free-zone.html', shell(
    "Free Zone Audit Services in Dubai, UAE — Kingston Chartered Auditing &amp; Advisory",
    "Approved free zone auditors in Dubai. Kingston is registered with all major UAE Free Zones — DMCC, JAFZA, DAFZA, ADGM, DIFC, DWC, RAKEZ, SHAMS — for statutory free zone audits.",
    "service-detail",
    service_page(
        slug="free-zone",
        name="Free Zone Audit",
        eyebrow="Audit &amp; Assurance",
        hero_title="Approved free zone auditors. Across every major UAE zone.",
        hero_sub="Kingston is registered with all major UAE Free Zones and government authorities — so your annual audit is signed by a firm your zone authority will actually accept, first time.",
        intro='''<p>Operating in a UAE Free Zone gives you tax efficiency, foreign ownership and a streamlined regulatory regime — but it also means an annual audit, on the zone authority's timetable, by an auditor on the zone authority's approved list. Submit a report from an unapproved firm and the file gets rejected. Miss the licence-renewal cut-off and your trade licence is at risk.</p>
        <p>Kingston is a UAE-licensed chartered audit firm registered across all major UAE Free Zones. We audit Free Zone companies under IFRS, in the format each zone authority expects, with the licence-renewal deadline tracked from day one.</p>''',
        features=[
            ("Zone-approved auditors", "Registered across DMCC, JAFZA, DAFZA, ADGM, DIFC, DWC, RAKEZ, SHAMS, IFZA, Meydan, JLT, KIZAD &amp; more."),
            ("Licence-renewal aligned", "We work backwards from your licence-renewal date — no last-minute panic, no licence at risk."),
            ("Zone-specific reporting", "Each Free Zone has its own format, cover-page and submission portal. We handle every one of them."),
            ("IFRS-compliant audit", "Every Free Zone audit is delivered under International Financial Reporting Standards — and our reports are accepted by banks, investors and the FTA."),
            ("Qualifying Free Zone Person testing", "For UAE corporate tax, we assess and document QFZP status alongside the audit — joined-up, not bolted on."),
            ("Direct portal submission", "Where the zone authority allows it, we file the signed report directly on your behalf."),
        ],
        why_us=[
            ("All major zones, one firm", "Group with entities in three different Free Zones? One Kingston engagement letter, one team, one timeline."),
            ("Real zone fluency", "We know each zone's quirks — DMCC's eAudit portal, DIFC's regulator expectations, ADGM's filing windows."),
            ("On-time, every time", "98% of Free Zone audits issued on or ahead of the agreed deadline — protecting your licence renewal."),
            ("Free Zone &amp; corporate-tax under one roof", "Audit, QFZP analysis and corporate-tax filings handled together — no gaps, no duplication."),
        ],
        process_steps=[
            ("Zone &amp; deadline mapping", "We confirm your Free Zone authority, licence-renewal date and required reporting format up-front."),
            ("Planning &amp; risk assessment", "Risk-based audit plan tailored to your zone's expectations and your business activities."),
            ("Fieldwork &amp; testing", "Senior-led examination of financial records, internal controls and supporting evidence under IFRS."),
            ("Report &amp; submission", "Signed report in the zone-approved format — submitted to the zone portal where authorised."),
        ],
        faqs=[
            ("Which Free Zones is Kingston registered with?", "All major UAE Free Zones — DMCC, JAFZA, DAFZA, ADGM, DIFC, DWC, RAKEZ, SHAMS, IFZA, Meydan, JLT, KIZAD and others. We confirm your specific zone's approval at engagement."),
            ("Is a Free Zone audit mandatory?", "Most Free Zones require annual audited financial statements as a condition of licence renewal. Even where it is not technically mandatory, banks, investors and Qualifying Free Zone Person testing typically require one."),
            ("How long does a Free Zone audit take?", "For a typical SME, fieldwork runs 2–3 weeks. We always work backwards from your licence-renewal date so the signed report is ready in time."),
            ("Do you handle the QFZP analysis at the same time?", "Yes — for UAE corporate tax, we assess and document Qualifying Free Zone Person status alongside the audit. Same data, same team, same engagement."),
        ]
    )
))

# --- Accounting & Bookkeeping
write('accounting.html', shell(
    "Accounting &amp; Bookkeeping Services in Dubai, UAE — Kingston",
    "Outsourced accounting and bookkeeping services in Dubai. Cloud-first, audit-ready, IFRS-compliant — monthly management accounts your CFO can actually use.",
    "service-detail",
    service_page(
        slug="accounting",
        name="Accounting &amp; Bookkeeping",
        eyebrow="Outsourced Finance",
        hero_title="Books that close on time. Numbers your board can trust.",
        hero_sub="Cloud-first outsourced accounting and bookkeeping for UAE businesses — IFRS-compliant, VAT-ready, audit-ready, and delivered as monthly management accounts your CFO can actually use to run the business.",
        intro='''<p>Most UAE finance teams do not have a bookkeeping problem. They have a closing-cycle problem. Invoices booked late, reconciliations done quarterly, and management accounts that arrive a month after they could have changed a decision.</p>
        <p>Kingston runs the books for ambitious UAE SMEs and family offices — cloud-first, IFRS-compliant, with a hard-locked closing calendar and monthly management accounts in your inbox by working day five.</p>''',
        features=[
            ("Day-to-day bookkeeping", "Sales, purchases, banking, expenses, payroll journals — recorded daily or weekly in your cloud accounting system."),
            ("Monthly closing", "Hard-locked monthly close with reconciliations, accruals and prepayments — by working day five, every month."),
            ("Management accounts", "Board-ready monthly P&amp;L, balance sheet and cash-flow with variance commentary your CFO can present."),
            ("VAT-ready chart of accounts", "Tax codes, supplier and customer master data set up so VAT returns prepare themselves."),
            ("Audit-ready files", "Workpapers, supporting documents and reconciliations kept in audit-ready order — your statutory audit gets faster and cheaper."),
            ("Cloud accounting setup", "Implementation and migration onto Zoho Books, QuickBooks, Xero or Tally — including data clean-up and training."),
        ],
        why_us=[
            ("Senior eyes monthly", "Every month-end pack is reviewed by a chartered accountant before it lands with you."),
            ("Audit-ready by design", "Books kept the way an auditor wants to find them — saving you days of audit fieldwork."),
            ("Fixed monthly fee", "Predictable monthly subscription, no surprise bills, transparent scope."),
            ("Joined-up with audit &amp; tax", "Same firm signs your statutory audit and files your VAT — no hand-offs, no re-explaining."),
        ],
        process_steps=[
            ("Onboarding &amp; cleanup", "We review your current accounting state, agree the chart of accounts, and clean up the opening balances."),
            ("Cloud setup", "Migrate or stand up your cloud accounting system, configure VAT codes, banks, customers and suppliers."),
            ("Monthly close", "Daily/weekly bookkeeping, hard-locked month-end close by WD5, reconciliations and management accounts pack."),
            ("Quarterly review", "Quarterly review with a senior accountant — controls, KPIs, cash forecast and finance-function maturity plan."),
        ],
        faqs=[
            ("Which accounting software do you support?", "We work in Zoho Books, QuickBooks Online, Xero, Tally and Sage. If you already use one, we work in it. If not, we recommend the right fit and migrate you on."),
            ("Can you handle payroll and WPS?", "Yes — monthly payroll preparation, WPS file generation and gratuity accruals are included in most engagements."),
            ("Is this just for small businesses?", "No. Many of our outsourced accounting engagements are with mid-market groups (multi-entity, multi-currency) where outsourcing is faster and cheaper than building an in-house team."),
            ("How quickly do you close the month?", "Working day five is our standard. For larger or multi-entity groups, we agree a tailored closing calendar — and stick to it."),
        ]
    )
))

# --- AML / CFT Compliance
write('aml-compliance.html', shell(
    "AML/CFT Compliance Services in Dubai, UAE — Kingston Chartered Auditing &amp; Advisory",
    "Anti-Money Laundering and Counter-Terrorism Financing compliance in the UAE. Risk assessment, policies, goAML registration, training and independent AML audits.",
    "service-detail",
    service_page(
        slug="aml-compliance",
        name="AML/CFT Compliance",
        eyebrow="Compliance",
        hero_title="AML/CFT — registered, documented, defensible.",
        hero_sub="UAE Anti-Money Laundering and Counter-Terrorism Financing compliance for DNFBPs and regulated financial businesses — from goAML registration to independent AML audits.",
        intro='''<p>UAE AML/CFT enforcement has tightened dramatically. DNFBPs (real estate brokers, dealers in precious metals, auditors, lawyers, corporate service providers) and financial businesses are now expected to maintain a fully documented AML programme — risk assessment, policies, customer due diligence, suspicious-transaction reporting via goAML, training, and an annual independent review.</p>
        <p>Kingston designs, implements and audits AML/CFT programmes for UAE businesses. We turn a regulatory headache into a documented, defensible compliance position — and an annual report for your senior management.</p>''',
        features=[
            ("Enterprise-wide risk assessment", "A documented risk assessment of your business, customers, products, channels and geographies — the foundation of every AML programme."),
            ("Policies, procedures &amp; controls", "Tailored AML/CFT manual, customer onboarding, screening, EDD and ongoing monitoring procedures."),
            ("goAML registration &amp; reporting", "Registration on the UAE FIU's goAML portal and ongoing support for STR/SAR filing."),
            ("Training programmes", "Annual board, senior-management and front-line training — recorded, signed-off and audit-ready."),
            ("Sanctions &amp; PEP screening", "Vendor selection and configuration of screening tools — UN, OFAC, UK, EU, UAE local terrorist lists, PEPs."),
            ("Independent AML audit", "Annual independent audit of your AML programme — design and operating effectiveness, with management report."),
        ],
        why_us=[
            ("UAE-specific, not generic", "We work to the UAE Federal AML/CFT framework — Cabinet Decision 10/2019, Federal Decree-Law 20/2018, and the latest EOCN guidance."),
            ("Audit-grade documentation", "Every step documented to a standard that survives a Ministry of Economy or Central Bank inspection."),
            ("Practical, not academic", "Programmes calibrated to the real risk in your business — not 200-page templates that no one will follow."),
            ("Independence", "We audit programmes we have not designed — and design programmes we will not later audit. No conflicts."),
        ],
        process_steps=[
            ("Diagnostic", "Where are you today? Risk assessment, gaps, immediate exposures, regulatory deadlines."),
            ("Programme build", "Risk assessment, policies, procedures, screening setup, goAML registration."),
            ("Operate &amp; train", "Compliance officer support, board and staff training, STR support."),
            ("Independent review", "Annual independent AML audit with senior-management report — keeping you ahead of inspections."),
        ],
        faqs=[
            ("Does my business need an AML/CFT programme?", "If you are a DNFBP (real estate broker, dealer in precious metals/stones, auditor, lawyer, corporate service provider) or a financial business in the UAE, yes. Kingston confirms your obligation in the diagnostic call."),
            ("What is goAML?", "goAML is the UAE Financial Intelligence Unit's secure portal for filing Suspicious Transaction Reports (STRs) and Suspicious Activity Reports (SARs). DNFBPs and financial businesses are required to register."),
            ("Is the annual independent AML audit mandatory?", "Most UAE supervisory authorities expect or require an annual independent review of the AML/CFT programme. Even where not strictly required, it is a strong defence in any inspection."),
            ("Can you act as our outsourced compliance officer?", "We provide compliance officer support and review services. The named MLRO must be an employee of your business — but we make sure they have the templates, training and senior cover to do the role properly."),
        ]
    )
))

# --- ESR
write('esr.html', shell(
    "Economic Substance Regulations (ESR) Services in Dubai, UAE — Kingston",
    "ESR notification and reporting in the UAE. Kingston advises UAE entities on Economic Substance Regulations — assessment, notification, reporting and audit defence.",
    "service-detail",
    service_page(
        slug="esr",
        name="ESR Compliance",
        eyebrow="Compliance",
        hero_title="Economic Substance — assessed, notified, reported.",
        hero_sub="End-to-end Economic Substance Regulations (ESR) services for UAE entities — from initial scoping and notification, to annual ESR reports, to defending your position before the regulator.",
        intro='''<p>The UAE's Economic Substance Regulations (ESR) require entities carrying out one or more &quot;Relevant Activities&quot; to demonstrate adequate economic substance in the UAE — the right people, premises and decisions, in the country. The penalties for non-compliance — financial penalties, exchange-of-information with foreign authorities and licence-related consequences — are material.</p>
        <p>Kingston advises UAE entities across the full ESR lifecycle: scoping which activities are caught, filing the annual notification, preparing the ESR report where required, and defending the position if the Regulatory Authority asks questions.</p>''',
        features=[
            ("ESR scoping", "Activity-by-activity assessment of which entities in your group fall within ESR — and which Relevant Activities apply."),
            ("Annual ESR notification", "Preparation and filing of the annual ESR notification on the Ministry of Finance portal — for every in-scope entity."),
            ("ESR report preparation", "Where required, preparation of the annual ESR report — including the directed-and-managed test, CIGA, adequate people and adequate premises evidence."),
            ("Substance design", "Where existing substance falls short, practical recommendations on board composition, meetings, premises and operating-expense alignment."),
            ("Group structuring advisory", "ESR-aware advice on holding-company structures and intra-group activity allocation — before structuring decisions are made."),
            ("Regulator response support", "Full support responding to Regulatory Authority enquiries, including documentary evidence, board minutes and substance walkthroughs."),
        ],
        why_us=[
            ("Joined-up with corporate tax", "ESR analysis sits alongside our UAE corporate tax and Free Zone work — same data, same team, no contradictions."),
            ("Year-round access", "ESR is annual — but the structuring decisions that drive it happen all year. You have access to your engagement partner whenever those decisions arise."),
            ("Audit-grade evidence files", "Every ESR position documented to a standard that survives Regulatory Authority enquiry."),
            ("No surprises", "We file in good time, with you fully briefed — no late-night-before-deadline scrambles."),
        ],
        process_steps=[
            ("Scoping", "Group-wide review of activities to identify entities in-scope of ESR and the applicable Relevant Activities."),
            ("Notification", "Annual ESR notification filed on the Ministry of Finance portal for each in-scope entity."),
            ("Reporting", "Where required, full ESR report preparation — substance test, CIGA, people, premises, expenditure."),
            ("Defence &amp; advisory", "Year-round access for regulator responses, structuring questions and next-year planning."),
        ],
        faqs=[
            ("Who is in-scope of ESR?", "Any UAE licensee — Mainland or Free Zone — that carries on one or more Relevant Activities (e.g. holding company, distribution, service centre, IP, headquarters, financing, leasing, insurance, banking, fund management, shipping). Kingston scopes this entity-by-entity."),
            ("What is the difference between the notification and the report?", "The notification is filed annually by every in-scope entity to declare which Relevant Activities it carries on. The report — required only by entities that earned income from a Relevant Activity in the period — demonstrates the substance test was met."),
            ("What if we missed a previous year's filing?", "Late filings are possible but typically attract penalties. Kingston works with you to file outstanding submissions and remediate the position — and where appropriate, requests review of penalties."),
            ("How does ESR interact with UAE corporate tax?", "ESR substance and Qualifying Free Zone Person tests overlap meaningfully — but they are not identical. We assess and document both consistently and in one engagement."),
        ]
    )
))

# --------------------------------------------------------------- Contact
contact_body = page_header(
    "Contact us",
    "Talk to a partner. Today.",
    "Tell us about your business and the help you need. We will be in touch within one business day to scope the engagement, the timeline and the fee — clearly, in writing.",
    "Contact"
) + '''
<section>
  <div class="container">
    <div class="contact-grid">
      <div class="contact-info reveal">
        <div class="contact-tile">
          <div class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
          <div>
            <h4>Office</h4>
            <p>Office 203, Aspin Commercial Tower<br />Street 104, Trade Centre First<br />Sheikh Zayed Road, Dubai, UAE</p>
          </div>
        </div>
        <div class="contact-tile">
          <div class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.07 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>
          <div>
            <h4>Phone</h4>
            <a href="tel:+971508747098">+971 50 874 7098</a>
            <p style="font-size:.85rem;color:var(--ink-300)">Sun–Thu, 9:00 – 18:00 GST</p>
          </div>
        </div>
        <div class="contact-tile">
          <div class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>
          <div>
            <h4>Email</h4>
            <a href="mailto:info@kingstonca.com">info@kingstonca.com</a>
            <p style="font-size:.85rem;color:var(--ink-300)">We reply within one business day</p>
          </div>
        </div>
        <div class="contact-tile">
          <div class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div>
            <h4>Hours</h4>
            <p>Sunday – Thursday<br />9:00 AM – 6:00 PM (GST)</p>
          </div>
        </div>
      </div>

      <form class="form-card contact-form reveal" novalidate>
        <h3>Tell us about your project</h3>
        <p>Free, confidential, 30-minute consultation with a Kingston partner.</p>
        <div class="form-row">
          <div class="field">
            <label for="fname">First name</label>
            <input id="fname" name="fname" type="text" required placeholder="Your first name" />
          </div>
          <div class="field">
            <label for="lname">Last name</label>
            <input id="lname" name="lname" type="text" required placeholder="Your last name" />
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" required placeholder="you@company.ae" />
          </div>
          <div class="field">
            <label for="phone">Phone</label>
            <input id="phone" name="phone" type="tel" placeholder="+971 …" />
          </div>
        </div>
        <div class="field" style="margin-bottom:14px">
          <label for="company">Company</label>
          <input id="company" name="company" type="text" placeholder="Company name" />
        </div>
        <div class="field" style="margin-bottom:14px">
          <label for="service">Service of interest</label>
          <select id="service" name="service">
            <option value="">Select a service…</option>
            <option>Statutory Audit</option>
            <option>Internal Audit</option>
            <option>Forensic Audit</option>
            <option>Due Diligence</option>
            <option>Corporate Tax</option>
            <option>VAT Services</option>
            <option>Excise Tax</option>
            <option>Other / not sure yet</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:6px">
          <label for="msg">How can we help?</label>
          <textarea id="msg" name="msg" required placeholder="A few lines about your business, deadlines and what you need from us…"></textarea>
        </div>
        <button type="submit" class="btn btn-primary">Request consultation <span class="arrow">→</span></button>
        <p class="consent">By submitting, you agree that Kingston may contact you about your enquiry. We do not share your details with third parties.</p>
      </form>
    </div>
  </div>
</section>

<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Find us</span>
      <h2>Sheikh Zayed Road, Dubai.</h2>
      <p>A short walk from World Trade Centre Metro Station — visitor parking available in the building.</p>
    </div>
    <div class="map-card reveal">
      <iframe loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"
        src="https://www.google.com/maps?q=Aspin+Commercial+Tower,+Sheikh+Zayed+Road,+Dubai&output=embed"></iframe>
    </div>
  </div>
</section>

<section>
  <div class="container" style="max-width:880px">
    <div class="section-head reveal">
      <span class="eyebrow center">FAQ</span>
      <h2>Common questions, answered.</h2>
    </div>
    <details class="faq reveal"><summary>Do you offer free consultations?</summary><p>Yes — every new engagement begins with a free 30-minute consultation with a partner, by phone, video or in person at our Sheikh Zayed Road office.</p></details>
    <details class="faq reveal"><summary>How quickly will I hear back?</summary><p>We reply to every enquiry within one business day. For urgent matters, please call +971 50 874 7098 directly.</p></details>
    <details class="faq reveal"><summary>How do you bill engagements?</summary><p>Most Kingston work is fixed-fee, agreed in writing before any work starts. For ongoing compliance work (VAT, corporate tax, internal audit) we offer transparent monthly subscriptions.</p></details>
    <details class="faq reveal"><summary>Do you serve clients outside Dubai?</summary><p>Yes — we serve clients across the UAE (Dubai, Abu Dhabi, Sharjah, RAK, Ajman, UAQ, Fujairah) and across the GCC for forensic and transaction-advisory engagements.</p></details>
  </div>
</section>
'''
write('contact.html', shell(
    "Contact Kingston Chartered Auditing &amp; Advisory — Dubai, UAE",
    "Get in touch with Kingston Chartered Auditing &amp; Advisory in Dubai. Free 30-minute consultation, partner-led service, response within one business day.",
    "contact", contact_body
))

# =====================================================================
# FREE ZONES — hub + per-zone pages
# =====================================================================

FREE_ZONES = [
    {
        "slug": "dmcc", "name": "DMCC", "full": "Dubai Multi Commodities Centre",
        "emirate": "Dubai", "established": "2002",
        "tagline": "The world's #1 free zone — Dubai's powerhouse for trading, commodities, crypto, fintech and family business.",
        "tags": ["Trading", "Commodities", "Crypto", "Family Office"],
        "fact_focus": "Trading &amp; Commodities", "fact_setup": "From 1–2 weeks",
        "fact_visas": "Up to 6 (Flexi)", "fact_office": "Flexi-desk to HQ",
        "intro": '''<p>DMCC consistently tops the Financial Times' Global Free Zones of the Year ranking — and for good reason. Twenty-something years on, it has scaled from a commodities cluster into a 25,000-business community housing trading houses, crypto exchanges, family offices, fintech firms, professional services and beyond. If you are scaling a UAE business with international ambition, DMCC is on the shortlist.</p>
        <p>Kingston is registered with DMCC as an approved auditor. We handle the full setup — entity structuring, licence, visa quotas, office, opening bank account — and stay on as your auditor and tax advisor for the years that follow.</p>''',
        "benefits": [
            ("100% foreign ownership", "Full ownership of your DMCC entity — no UAE national shareholder required."),
            ("0% personal &amp; 9% corporate tax", "Qualifying Free Zone Persons can access the 0% corporate tax rate on qualifying income."),
            ("World-class infrastructure", "JLT business district with metro, hotels, restaurants and a thriving tenant community."),
            ("Easy visa quotas", "Visas tied to your office size — Flexi-desk supports up to 6 visas, full offices scale further."),
            ("Wide activity list", "Over 600 permitted business activities — pick multiple under one licence."),
            ("Strong banking relationships", "Most UAE banks have streamlined onboarding for DMCC-licensed companies."),
        ],
        "faqs": [
            ("How long does DMCC company setup take?", "For a clean profile, typical timeline is 1–2 weeks from name approval to trade licence. Bank account opening adds another 2–4 weeks."),
            ("What is the minimum share capital for DMCC?", "DMCC has no mandatory paid-up share capital for most activities. We will confirm any activity-specific capital at engagement."),
            ("Can I get residency through a DMCC company?", "Yes — investor and employee residence visas are issued via DMCC and tied to your office size."),
            ("Does DMCC require an annual audit?", "Yes — every DMCC company must submit annual audited financial statements via the DMCC eAudit portal. Kingston is an approved DMCC auditor."),
        ]
    },
    {
        "slug": "jafza", "name": "JAFZA", "full": "Jebel Ali Free Zone Authority",
        "emirate": "Dubai", "established": "1985",
        "tagline": "The Middle East's largest free zone — purpose-built for logistics, manufacturing and re-export at scale.",
        "tags": ["Logistics", "Manufacturing", "Warehousing", "Trade"],
        "fact_focus": "Logistics &amp; Industrial", "fact_setup": "2–4 weeks",
        "fact_visas": "Office-based", "fact_office": "Warehouses, plots, offices",
        "intro": '''<p>JAFZA sits next to Jebel Ali Port — the world's ninth-busiest container port — and Al Maktoum International, giving it unrivalled multi-modal connectivity. For businesses that move physical goods, JAFZA is rarely just a free zone choice. It is the free zone choice.</p>
        <p>Kingston handles JAFZA setup for trading, logistics, light manufacturing and warehousing businesses, and stays on as your audit and tax partner.</p>''',
        "benefits": [
            ("Adjacent to Jebel Ali Port", "Direct connectivity to the world's ninth-busiest container port — minutes to ship from your warehouse."),
            ("Flexible facilities", "From offices and plug-and-play warehouses to land-lease industrial plots up to 1m sq ft."),
            ("100% repatriation", "100% repatriation of capital and profits, with no foreign exchange controls."),
            ("Public listing route", "JAFZA Offshore companies have a route to listing on UAE exchanges — useful for groups eyeing IPO."),
            ("Logistics-grade utilities", "Industrial-grade power, water, gas and waste handling built for production-scale operations."),
            ("Long-term lease security", "25-year leases on industrial land, renewable — supports decade-plus capex commitments."),
        ],
        "faqs": [
            ("Is JAFZA a good fit for an e-commerce business?", "Yes — JAFZA hosts many e-commerce and 3PL operations because of its warehousing, last-mile and re-export advantages. We will advise on the right structure."),
            ("What licences does JAFZA issue?", "Trading, service, industrial, e-commerce, logistics and national industrial licences. Each maps to permitted activities and facility types."),
            ("Can I lease industrial land?", "Yes — JAFZA offers industrial plot leases, typically 25 years, with build-to-suit and pre-built warehouse options."),
            ("Does JAFZA require an annual audit?", "Yes — JAFZA companies must submit annual audited financial statements. Kingston is a JAFZA-approved auditor."),
        ]
    },
    {
        "slug": "difc", "name": "DIFC", "full": "Dubai International Financial Centre",
        "emirate": "Dubai", "established": "2004",
        "tagline": "The Middle East's leading financial hub — common law, English-language regulator, and the place to be for funds, banks, fintech and law firms.",
        "tags": ["Financial Services", "Fintech", "Funds", "Wealth"],
        "fact_focus": "Financial &amp; Professional Services", "fact_setup": "6–12 weeks",
        "fact_visas": "Tied to substance", "fact_office": "Fitted &amp; serviced",
        "intro": '''<p>DIFC is a different animal. An independent common-law jurisdiction inside Dubai, regulated by the Dubai Financial Services Authority (DFSA), with its own court system and English-language commercial law. If you are running a regulated financial business — a fund manager, family office, bank, insurer, fintech, law firm — this is typically the right address.</p>
        <p>Kingston advises on DIFC entity structuring, regulatory licensing strategy, ongoing audit (under IFRS) and corporate tax for DIFC entities — including Qualifying Free Zone Person testing.</p>''',
        "benefits": [
            ("Common-law jurisdiction", "Independent civil and commercial laws based on international standards — predictable for global investors."),
            ("DFSA regulation", "An internationally respected regulator — your DIFC licence carries weight with global counterparties."),
            ("100% foreign ownership", "No UAE national shareholder required — full control of your entity."),
            ("Family Wealth Centre", "Bespoke regime for single-family offices, holding structures and prescribed companies."),
            ("World-class talent pool", "DIFC's tenant community gives you access to a deep network of bankers, advisors, lawyers and operators."),
            ("Innovation Hub", "Dedicated fintech accelerator and licence regime for fintech startups and innovation-stage businesses."),
        ],
        "faqs": [
            ("Is DIFC the right zone for a fund manager?", "If you are running a regulated investment business, yes. DIFC offers fund manager, fund management, advisory and wealth-management licences under the DFSA."),
            ("How long does a DIFC licence take?", "For non-regulated entities, 4–8 weeks. For regulated financial entities, 12–24 weeks depending on the licence category and your readiness."),
            ("Are DIFC entities subject to UAE corporate tax?", "Yes — DIFC entities are within the scope of UAE corporate tax, but most can qualify for the 0% rate as a Qualifying Free Zone Person if substance and qualifying-income tests are met. Kingston handles this analysis."),
            ("Does DIFC require an audit?", "Yes — DIFC requires annual audited financial statements under IFRS. DFSA-regulated entities also have additional regulatory reporting requirements."),
        ]
    },
    {
        "slug": "adgm", "name": "ADGM", "full": "Abu Dhabi Global Market",
        "emirate": "Abu Dhabi", "established": "2015",
        "tagline": "Abu Dhabi's international financial centre — an English common-law jurisdiction on Al Maryah Island.",
        "tags": ["Financial Services", "Family Offices", "Fintech", "Holding"],
        "fact_focus": "Finance &amp; Family Wealth", "fact_setup": "4–10 weeks",
        "fact_visas": "Tied to substance", "fact_office": "Fitted",
        "intro": '''<p>ADGM is to Abu Dhabi what DIFC is to Dubai — a self-contained common-law financial centre with its own regulator (the FSRA), its own court system, and English-language commercial law. For groups that want a Big Four city's regulatory depth with Abu Dhabi's stability, ADGM is increasingly the choice.</p>
        <p>Kingston supports ADGM entity formation, FSRA licensing strategy, audit under IFRS and corporate-tax compliance for ADGM-licensed entities.</p>''',
        "benefits": [
            ("Common-law jurisdiction", "English common law applies directly — a precedent-rich, internationally familiar legal regime."),
            ("FSRA regulation", "Internationally respected financial regulator with category-based licensing across the financial services spectrum."),
            ("Strong holding-company regime", "ADGM's holding-company and SPV regimes are popular with UAE-anchored regional groups."),
            ("Family Office regime", "Tailored single and multi-family office regimes recognised by the FSRA."),
            ("Foundations regime", "Common-law foundations — useful for succession, asset protection and philanthropy."),
            ("Tech &amp; innovation focus", "Dedicated regimes for fintech (RegLab), DLT, virtual assets and AI/data businesses."),
        ],
        "faqs": [
            ("ADGM or DIFC — which one is right for me?", "Both are common-law financial centres. DIFC is more central to Dubai's financial market; ADGM is the natural choice for Abu Dhabi-anchored groups, family offices and certain holding structures. We will advise based on activity, regulator preference and substance."),
            ("Does ADGM offer a holding-company licence?", "Yes — ADGM is a popular jurisdiction for holding companies and SPVs, with a regime that accommodates regional and global structures."),
            ("Is an ADGM licence subject to UAE corporate tax?", "Yes — ADGM entities fall within UAE corporate tax scope, with most able to qualify as Qualifying Free Zone Persons if the conditions are met."),
            ("Does ADGM require an annual audit?", "Yes — annual audited financial statements under IFRS. FSRA-regulated entities have additional regulatory return requirements."),
        ]
    },
    {
        "slug": "dafza", "name": "DAFZA", "full": "Dubai Airport Free Zone",
        "emirate": "Dubai", "established": "1996",
        "tagline": "The hub for fast-moving, high-value goods — co-located with Dubai International Airport.",
        "tags": ["Aviation", "Pharma", "Tech", "FMCG"],
        "fact_focus": "Aviation &amp; High-value goods", "fact_setup": "2–4 weeks",
        "fact_visas": "Office-based", "fact_office": "Warehouse &amp; office",
        "intro": '''<p>DAFZA sits inside the Dubai International Airport perimeter — which means goods can be off-loaded from a freighter and into your warehouse without crossing customs into the country. For high-value, time-sensitive products — pharma, electronics, luxury goods — that matters.</p>
        <p>Kingston handles DAFZA entity formation, audit under IFRS, and ongoing tax compliance.</p>''',
        "benefits": [
            ("Adjacent to Dubai International Airport", "Direct cargo access — ideal for time-sensitive, high-value or regulated goods."),
            ("100% foreign ownership", "Full ownership without a UAE national partner."),
            ("Customs-bonded zone", "Goods can move into and out of the zone without UAE customs duties — only on release into the local market."),
            ("Fast incorporation", "Streamlined process — typical setup completes in 2–4 weeks."),
            ("Strong pharma &amp; healthcare cluster", "Regulated pharma and life-science companies are common DAFZA tenants."),
            ("Onsite government services", "Immigration, customs and other government services available within the zone."),
        ],
        "faqs": [
            ("Why pick DAFZA over JAFZA for trading?", "DAFZA is built around airport cargo — better for high-value, low-volume, time-sensitive flow. JAFZA is built around sea-port and industrial scale. The right answer depends on your product."),
            ("What licences does DAFZA issue?", "Trade, service, industrial and e-commerce licences — with activity lists tailored to airport-cluster businesses."),
            ("Can I store goods in DAFZA without UAE customs duties?", "Yes — DAFZA is customs-bonded. Customs apply only when goods are released into the UAE local market."),
            ("Is annual audit mandatory in DAFZA?", "Yes — DAFZA requires annual audited financial statements. Kingston is an approved auditor."),
        ]
    },
    {
        "slug": "rakez", "name": "RAKEZ", "full": "Ras Al Khaimah Economic Zone",
        "emirate": "Ras Al Khaimah", "established": "2017",
        "tagline": "The cost-effective free zone with industrial scale and emerging-business agility.",
        "tags": ["Industrial", "Cost-effective", "SME", "E-commerce"],
        "fact_focus": "Industry &amp; SMEs", "fact_setup": "1–3 weeks",
        "fact_visas": "Office-based", "fact_office": "Co-working to plots",
        "intro": '''<p>RAKEZ pulls together Ras Al Khaimah's economic zones into one platform that competes hard on cost and flexibility. For SMEs, e-commerce operations and industrial businesses that do not need a Dubai-postcode prestige play, RAKEZ frequently wins on total cost of ownership.</p>
        <p>Kingston handles RAKEZ company formation, audits and tax compliance for businesses across the SME and industrial spectrum.</p>''',
        "benefits": [
            ("Cost-competitive packages", "Setup and renewal costs typically come in well below Dubai-based zones — material for early-stage businesses."),
            ("Flexible facility options", "From co-working desks to industrial plots — the same zone scales with your business."),
            ("Activity breadth", "Over 1,000 permitted activities — commercial, professional, industrial, educational, media."),
            ("Quick incorporation", "Streamlined process — typical setup under 2 weeks."),
            ("Strong industrial cluster", "Established manufacturing tenant base — building materials, chemicals, food, packaging."),
            ("Easy renewal", "Renewals are typically straightforward and cheaper than Dubai zones."),
        ],
        "faqs": [
            ("Can a RAKEZ company operate in Dubai?", "A RAKEZ company can do business with Dubai, but to physically operate in Dubai (lease an office, hire staff there) typically requires a branch or distributor arrangement."),
            ("What types of licences does RAKEZ issue?", "Commercial, professional, service, industrial, educational, media and e-commerce licences."),
            ("Is RAKEZ a good fit for industrial setup?", "Yes — RAKEZ has a strong industrial estate offering, with land, warehousing and pre-built facilities."),
            ("Is annual audit mandatory in RAKEZ?", "Yes — annual audited financial statements are required. Kingston supports RAKEZ audit submissions."),
        ]
    },
    {
        "slug": "ifza", "name": "IFZA", "full": "International Free Zone Authority",
        "emirate": "Dubai", "established": "2018",
        "tagline": "Dubai's modern, fast and entrepreneur-friendly free zone — strong for service, consultancy and trading SMEs.",
        "tags": ["SME", "Service", "Consultancy", "Trading"],
        "fact_focus": "Service &amp; Consultancy", "fact_setup": "3–7 days",
        "fact_visas": "1–6 typical", "fact_office": "Flexi-desk to office",
        "intro": '''<p>IFZA has become a go-to for founders and consultants who want a Dubai-issued licence without the cost or complexity of larger zones. Setup is fast (often under a week), the activity list is broad, and the package economics work for solo founders and small teams.</p>
        <p>Kingston runs IFZA company formation alongside the audit, tax and accounting work most IFZA clients also need.</p>''',
        "benefits": [
            ("Fast setup", "Trade licence often issued within 3–7 days of name approval."),
            ("Cost-effective", "Packages start lower than DMCC, JAFZA and DIFC — designed for SME budgets."),
            ("Up to 7 activities", "Most IFZA licences allow multiple business activities under one licence."),
            ("Up to 6 visas", "Visa quotas scale with package — supports founders bringing family on dependent visas."),
            ("Modern administrative system", "Fully digital portal — registrations, renewals and amendments handled online."),
            ("Strong consultant ecosystem", "IFZA's tenant base is heavily service-oriented — useful network for B2B founders."),
        ],
        "faqs": [
            ("How fast can I get an IFZA licence?", "From name approval to issued trade licence, often 3–7 working days for clean profiles."),
            ("Does IFZA require physical office space?", "Most IFZA packages include a flexi-desk in their administrative office — sufficient for licence and visa purposes."),
            ("Can I add visas later?", "Yes — visa quotas can typically be upgraded by changing package and (where required) physical space."),
            ("Is annual audit mandatory in IFZA?", "Yes — IFZA requires annual audited financial statements for licensed entities. Kingston supports IFZA audit submissions."),
        ]
    },
    {
        "slug": "meydan", "name": "Meydan", "full": "Meydan Free Zone",
        "emirate": "Dubai", "established": "2019",
        "tagline": "A premium Dubai address — strong for founders, consultancies and crypto-adjacent businesses.",
        "tags": ["Premium", "Founders", "Consultancy", "Crypto-friendly"],
        "fact_focus": "Founders &amp; Consultancy", "fact_setup": "1–2 weeks",
        "fact_visas": "Up to 6+", "fact_office": "Virtual to physical",
        "intro": '''<p>Meydan Free Zone offers a Dubai-prestige licence with a relatively light operational footprint — virtual office options, broad activity lists, and a lean digital onboarding process. It has become popular with founders, consultancies and digital-asset adjacent businesses who want the Meydan / Dubai brand on their letterhead.</p>
        <p>Kingston handles Meydan setup alongside the ongoing audit, tax and bookkeeping work that follows.</p>''',
        "benefits": [
            ("Premium Dubai address", "A &quot;Meydan, Dubai, UAE&quot; postcode that lifts perceived brand."),
            ("Virtual office options", "Cost-effective virtual-office package with full registered address — fits remote-first businesses."),
            ("Broad activity list", "Multiple activities permitted under a single licence — including consultancy, trading, e-commerce."),
            ("Strong digital onboarding", "Quick, mostly-digital incorporation — limited document chase."),
            ("Crypto-friendly mindset", "Open to virtual-asset adjacent activities (subject to licence type and approvals)."),
            ("Founder-friendly visa packages", "Investor visa with dependent options — common founder set-up."),
        ],
        "faqs": [
            ("Is Meydan suitable for crypto activities?", "Meydan can support some crypto-adjacent activities, but regulated virtual-asset business in the UAE is licensed by VARA (Virtual Assets Regulatory Authority) or other relevant bodies. Kingston helps map activity to the right authority."),
            ("Can I get a residency visa with Meydan?", "Yes — Meydan supports investor visas and dependent visas, with quotas tied to package."),
            ("How long does Meydan setup take?", "Typically 1–2 weeks for clean applications — straightforward, mostly digital."),
            ("Is annual audit mandatory in Meydan?", "Yes — Meydan requires annual audited financial statements."),
        ]
    },
    {
        "slug": "shams", "name": "SHAMS", "full": "Sharjah Media City",
        "emirate": "Sharjah", "established": "2017",
        "tagline": "Sharjah's media-and-creative free zone — affordable, fast and friendly to digital creators.",
        "tags": ["Media", "Creative", "Digital", "Affordable"],
        "fact_focus": "Media &amp; Creative", "fact_setup": "1–2 weeks",
        "fact_visas": "Office-based", "fact_office": "Co-working to office",
        "intro": '''<p>SHAMS — Sharjah Media City — is a media-and-creative-focused free zone with one of the most accessible price points in the UAE. It is the natural home for digital creators, content studios, marketing agencies, e-commerce founders and creative consultants who want a UAE-licensed entity without DMCC-level cost.</p>
        <p>Kingston handles SHAMS company formation alongside ongoing audit and tax compliance.</p>''',
        "benefits": [
            ("Affordable packages", "Among the most cost-effective free zone setup options in the UAE."),
            ("Media-friendly activity list", "Specifically built for media production, content, marketing, digital, e-sports and creative services."),
            ("100% foreign ownership", "Full ownership of your SHAMS entity."),
            ("Quick incorporation", "Typical setup completes in 1–2 weeks."),
            ("Sharjah location advantages", "20 minutes from Dubai, with lower operating costs."),
            ("Up to 6 visas in starter packages", "Visa allocations scale with package — sufficient for typical creator and agency teams."),
        ],
        "faqs": [
            ("Can a SHAMS company invoice Dubai clients?", "Yes — SHAMS-licensed companies can invoice and serve clients across the UAE and globally. Operating physical premises in Dubai requires a branch or distributor arrangement."),
            ("What activities are permitted under SHAMS?", "A wide media and creative list — production, post-production, content, advertising, digital marketing, e-sports, broadcasting and more, plus general trading where permitted."),
            ("How long does SHAMS setup take?", "1–2 weeks for clean profiles."),
            ("Is annual audit mandatory in SHAMS?", "Yes — SHAMS requires annual audited financial statements. Kingston is set up to support SHAMS clients."),
        ]
    },
]

def fz_card(z):
    tags_html = ''.join(f'<span class="fz-tag">{t}</span>' for t in z['tags'])
    return f'''<a class="fz-card has-image reveal" href="free-zone-{z['slug']}.html">
        <!-- IMAGE PLACEHOLDER · replace assets/img/freezones/{z['slug']}.svg with photo -->
        <div class="img-frame ar-16x9"><img src="assets/img/freezones/{z['slug']}.svg" alt="{z['name']} Free Zone" loading="lazy"/></div>
        <div class="card-body">
          <div class="fz-emirate">{z['emirate']} · est. {z['established']}</div>
          <h3>{z['name']}</h3>
          <div class="fz-fullname">{z['full']}</div>
          <p class="fz-tagline">{z['tagline']}</p>
          <div class="fz-tags">{tags_html}</div>
          <span class="read">Setup details <span class="arrow">→</span></span>
        </div>
      </a>'''

# --- Free Zone hub page (renamed: was free-zone.html for audit, now we keep that as audit page,
#     and create freezones.html as the SETUP hub linking to per-zone pages)
freezones_body = page_header(
    "Free Zone Setup",
    "Pick your UAE Free Zone. We will handle the rest.",
    "Kingston is registered with all major UAE Free Zones — and we set up, audit and run tax for businesses inside them. Compare zones below, then pick the page that fits your business.",
    "Free Zones"
) + '''
<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Choose your zone</span>
      <h2>Nine UAE Free Zones. One trusted partner.</h2>
      <p>Each zone has its own regulator, activity list, cost profile and renewal regime. We help you pick the one that actually fits your business — not just the one we earn the most on.</p>
    </div>
    <div class="fz-grid">
''' + '\n'.join(fz_card(z) for z in FREE_ZONES) + '''
    </div>
  </div>
</section>

<section>
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">How to choose</span>
      <h2>The 60-second decision tree.</h2>
    </div>
    <div class="values" style="grid-template-columns:repeat(2,1fr);max-width:980px;margin:0 auto">
      <div class="value reveal" style="padding:32px">
        <h4 style="color:var(--navy-900);margin-bottom:8px">Trading or commodities?</h4>
        <p>If you are trading commodities or running a multi-activity trading house — start with <a href="free-zone-dmcc.html" style="color:var(--gold-700);font-weight:600">DMCC</a>. If you move physical goods at scale or need warehousing, look at <a href="free-zone-jafza.html" style="color:var(--gold-700);font-weight:600">JAFZA</a>.</p>
      </div>
      <div class="value reveal" style="padding:32px">
        <h4 style="color:var(--navy-900);margin-bottom:8px">Financial services?</h4>
        <p>Regulated finance, fund management, fintech or law — common-law jurisdictions are typically right. Pick <a href="free-zone-difc.html" style="color:var(--gold-700);font-weight:600">DIFC</a> in Dubai or <a href="free-zone-adgm.html" style="color:var(--gold-700);font-weight:600">ADGM</a> in Abu Dhabi.</p>
      </div>
      <div class="value reveal" style="padding:32px">
        <h4 style="color:var(--navy-900);margin-bottom:8px">High-value cargo or pharma?</h4>
        <p>Time-sensitive, regulated or high-value goods that move by air — <a href="free-zone-dafza.html" style="color:var(--gold-700);font-weight:600">DAFZA</a>. The customs-bonded zone is built for this profile.</p>
      </div>
      <div class="value reveal" style="padding:32px">
        <h4 style="color:var(--navy-900);margin-bottom:8px">Cost-conscious SME or solo founder?</h4>
        <p><a href="free-zone-ifza.html" style="color:var(--gold-700);font-weight:600">IFZA</a>, <a href="free-zone-meydan.html" style="color:var(--gold-700);font-weight:600">Meydan</a> and <a href="free-zone-shams.html" style="color:var(--gold-700);font-weight:600">SHAMS</a> compete hard on price and speed. <a href="free-zone-rakez.html" style="color:var(--gold-700);font-weight:600">RAKEZ</a> is the natural pick for industrial setups.</p>
      </div>
    </div>
    <p class="text-center mt-4" style="color:var(--ink-500)">Still not sure? <a href="contact.html" style="color:var(--gold-700);font-weight:600">Book a free 30-minute call</a> — we will recommend in writing.</p>
  </div>
</section>

<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">What you get</span>
      <h2>End-to-end Free Zone setup, with audit and tax built in.</h2>
    </div>
    <div class="process">
      <div class="step reveal"><span class="step-num">01</span><h4>Zone selection</h4><p>We map your activity, customer base and budget to the right Free Zone — and document the trade-offs in writing.</p></div>
      <div class="step reveal"><span class="step-num">02</span><h4>Incorporation</h4><p>Name reservation, MoA/AoA, licence, immigration card, establishment card — everything filed and tracked.</p></div>
      <div class="step reveal"><span class="step-num">03</span><h4>Visas &amp; banking</h4><p>Investor and employee visas, plus introductions and onboarding support with UAE banks.</p></div>
      <div class="step reveal"><span class="step-num">04</span><h4>Audit &amp; tax</h4><p>Year-one accounting setup, audit-ready bookkeeping, and corporate-tax / QFZP planning from day one.</p></div>
    </div>
  </div>
</section>
'''
write('freezones.html', shell(
    "Free Zone Company Setup in UAE — Kingston Chartered Auditing &amp; Advisory",
    "Compare and choose the right UAE Free Zone — DMCC, JAFZA, DIFC, ADGM, DAFZA, RAKEZ, IFZA, Meydan, SHAMS. Kingston handles end-to-end setup plus ongoing audit and tax.",
    "freezones", freezones_body
))

# --- per-Free-Zone setup pages
def free_zone_page(z):
    benefits_html = '\n'.join(
        f'''        <li>
          <span class="check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
          <div><strong>{t}</strong><span>{d}</span></div>
        </li>''' for t, d in z['benefits']
    )
    faq_html = '\n'.join(
        f'''      <details class="faq reveal"><summary>{q}</summary><p>{a}</p></details>'''
        for q, a in z['faqs']
    )
    other_zones = '\n'.join(
        f'        <a href="free-zone-{o["slug"]}.html">{o["name"]} <span class="arrow">→</span></a>'
        for o in FREE_ZONES if o['slug'] != z['slug']
    )

    body = page_header(
        f"{z['name']} · {z['emirate']}",
        f"Set up your business in {z['name']} — {z['full']}.",
        z['tagline'],
        f"Free Zones · {z['name']}",
        banner_image=f"freezones/{z['slug']}.svg",
        banner_alt=f"{z['name']} Free Zone"
    ) + f'''
<section>
  <div class="container service-layout">
    <div class="service-content reveal">
      <span class="eyebrow">{z['name']} · {z['emirate']}</span>
      <h2 style="margin-top:14px">{z['full']}</h2>
      {z['intro']}

      <div class="fz-facts">
        <div class="fz-fact"><div class="lbl">Sector focus</div><div class="val">{z['fact_focus']}</div></div>
        <div class="fz-fact"><div class="lbl">Setup time</div><div class="val">{z['fact_setup']}</div></div>
        <div class="fz-fact"><div class="lbl">Visas</div><div class="val">{z['fact_visas']}</div></div>
        <div class="fz-fact"><div class="lbl">Office options</div><div class="val">{z['fact_office']}</div></div>
      </div>

      <h3 style="margin-top:36px">Why founders choose {z['name']}</h3>
      <ul class="feat">
{benefits_html}
      </ul>

      <h3>Why Kingston for {z['name']} setup</h3>
      <p>Kingston is registered with {z['name']} as an approved auditor and corporate-services partner. We handle setup end-to-end — entity, licence, visa, office, banking — and stay on as your auditor and tax partner. No hand-offs, no &quot;we will introduce you to a third party&quot;.</p>
    </div>
    <aside style="display:flex;flex-direction:column;gap:18px">
      {aside_consult()}
      <div class="related-services">
        <h4>Other UAE Free Zones</h4>
{other_zones}
        <a href="freezones.html" style="margin-top:6px;color:var(--gold-700);font-weight:600">All Free Zones <span class="arrow">→</span></a>
      </div>
    </aside>
  </div>
</section>

<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Process</span>
      <h2>Your {z['name']} setup, step by step.</h2>
    </div>
    <div class="process">
      <div class="step reveal"><span class="step-num">01</span><h4>Activity &amp; licence</h4><p>Confirm activities, licence type, share capital and shareholder structure — documented in writing before filing.</p></div>
      <div class="step reveal"><span class="step-num">02</span><h4>Incorporation</h4><p>Name approval, MoA/AoA, trade licence, establishment and immigration cards.</p></div>
      <div class="step reveal"><span class="step-num">03</span><h4>Visas &amp; office</h4><p>Investor visa, employee visas, dependent visas and physical or flexi-office allocation.</p></div>
      <div class="step reveal"><span class="step-num">04</span><h4>Banking &amp; tax</h4><p>UAE corporate bank account, FTA registration, accounting setup and audit pre-readiness.</p></div>
    </div>
  </div>
</section>

<section>
  <div class="container" style="max-width:880px">
    <div class="section-head reveal">
      <span class="eyebrow center">FAQ</span>
      <h2>{z['name']} — common questions answered.</h2>
    </div>
{faq_html}
  </div>
</section>
'''
    return body

for z in FREE_ZONES:
    write(f"free-zone-{z['slug']}.html", shell(
        f"{z['name']} Company Setup — Kingston Chartered Auditing &amp; Advisory, Dubai",
        f"Set up your business in {z['name']} ({z['full']}). Kingston handles licence, visa, office, banking, audit and tax — end to end.",
        "free-zone-detail", free_zone_page(z)
    ))

# =====================================================================
# BUSINESS SETUP — hub + sub-pages
# =====================================================================

# --- Business Setup hub page
business_setup_body = page_header(
    "Business Setup",
    "Start your UAE business with a partner who stays after the licence is issued.",
    "Mainland, Free Zone or Offshore — Kingston handles end-to-end UAE company formation, then continues as your auditor and tax advisor for the years that follow. One firm. One team. No hand-offs.",
    "Business Setup"
) + '''
<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Three paths</span>
      <h2>Mainland, Free Zone, or Offshore — pick the right structure first.</h2>
      <p>The right answer depends on what you sell, who you sell it to, and where your customers are. We will recommend in writing — not just sell you the highest-margin licence.</p>
    </div>
    <div class="service-grid" style="grid-template-columns:repeat(3,1fr)">
      <a href="mainland-setup.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/mainland-setup.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/mainland-setup.svg" alt="Mainland Setup" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">01</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V11l7-7 7 7v10"/><path d="M9 21V12h6v9"/></svg></div>
        <h3>Mainland Setup</h3>
        <p>The choice when you need to operate freely across the UAE, sell to government, or open multiple physical locations.</p>
        <span class="read">Mainland details <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="freezones.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/free-zone.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/free-zone.svg" alt="Freezones" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">02</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>
        <h3>Free Zone Setup</h3>
        <p>100% foreign ownership, full repatriation, sector-focused regulators — across DMCC, JAFZA, DIFC, ADGM and more.</p>
        <span class="read">Browse Free Zones <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="offshore-setup.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/offshore-setup.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/offshore-setup.svg" alt="Offshore Setup" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">03</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9-9-4-9-9z"/><path d="M12 3v18"/></svg></div>
        <h3>Offshore Setup</h3>
        <p>JAFZA Offshore, RAK ICC and Ajman Offshore — for holding structures, asset protection and international trading.</p>
        <span class="read">Offshore details <span class="arrow">→</span></span>
        </div>
      </a>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Plus the things you actually need</span>
      <h2>Setup is the start, not the finish.</h2>
    </div>
    <div class="service-grid">
      <a href="pro-services.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/pro-services.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/pro-services.svg" alt="Pro Services" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">04</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/><path d="M19 8v6"/></svg></div>
        <h3>PRO &amp; Visa Services</h3>
        <p>Investor, employee and family visas; Emirates ID; medicals; attestations and ongoing PRO support.</p>
        <span class="read">PRO details <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="feasibility-studies.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/feasibility.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/feasibility.svg" alt="Feasibility Studies" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">05</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
        <h3>Feasibility Studies</h3>
        <p>Market sizing, financial modelling and viability analysis — done before you commit capital, not after.</p>
        <span class="read">Feasibility details <span class="arrow">→</span></span>
        </div>
      </a>
      <a href="accounting.html" class="service-card has-image reveal">
        <!-- IMAGE PLACEHOLDER · replace assets/img/services/accounting.svg with photo -->
        <div class="img-frame ar-3x2"><img src="assets/img/services/accounting.svg" alt="Accounting" loading="lazy"/></div>
        <div class="card-body">
        <span class="num">06</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20v18H2z"/><path d="M2 9h20"/><path d="M9 21V9"/></svg></div>
        <h3>Accounting &amp; Bookkeeping</h3>
        <p>Day-one cloud accounting, monthly close by working day five, and audit-ready books from your first invoice.</p>
        <span class="read">Accounting details <span class="arrow">→</span></span>
        </div>
      </a>
    </div>
  </div>
</section>

<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Mainland vs Free Zone vs Offshore</span>
      <h2>The 60-second comparison.</h2>
    </div>
    <div style="overflow-x:auto;background:#fff;border:1px solid var(--line);border-radius:var(--radius-lg)">
      <table style="width:100%;border-collapse:collapse;min-width:680px">
        <thead>
          <tr style="background:var(--navy-50)">
            <th style="padding:16px;text-align:left;font-weight:600;color:var(--navy-900)">&nbsp;</th>
            <th style="padding:16px;text-align:left;font-weight:600;color:var(--navy-900)">Mainland</th>
            <th style="padding:16px;text-align:left;font-weight:600;color:var(--navy-900)">Free Zone</th>
            <th style="padding:16px;text-align:left;font-weight:600;color:var(--navy-900)">Offshore</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="padding:14px 16px;border-top:1px solid var(--line);font-weight:600">Foreign ownership</td><td style="padding:14px 16px;border-top:1px solid var(--line)">100% (most activities)</td><td style="padding:14px 16px;border-top:1px solid var(--line)">100%</td><td style="padding:14px 16px;border-top:1px solid var(--line)">100%</td></tr>
          <tr><td style="padding:14px 16px;border-top:1px solid var(--line);font-weight:600">Trade in UAE local market</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Yes, directly</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Via local distributor / branch</td><td style="padding:14px 16px;border-top:1px solid var(--line)">No (offshore-only)</td></tr>
          <tr><td style="padding:14px 16px;border-top:1px solid var(--line);font-weight:600">Government tenders</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Eligible</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Limited</td><td style="padding:14px 16px;border-top:1px solid var(--line)">No</td></tr>
          <tr><td style="padding:14px 16px;border-top:1px solid var(--line);font-weight:600">Office requirement</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Physical office (Ejari)</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Flexi-desk to physical</td><td style="padding:14px 16px;border-top:1px solid var(--line)">No physical office</td></tr>
          <tr><td style="padding:14px 16px;border-top:1px solid var(--line);font-weight:600">Visa eligibility</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Yes</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Yes</td><td style="padding:14px 16px;border-top:1px solid var(--line)">No</td></tr>
          <tr><td style="padding:14px 16px;border-top:1px solid var(--line);font-weight:600">Annual audit</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Activity-dependent</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Yes (most zones)</td><td style="padding:14px 16px;border-top:1px solid var(--line)">No (typically)</td></tr>
          <tr><td style="padding:14px 16px;border-top:1px solid var(--line);font-weight:600">Best for</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Local market &amp; gov clients</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Regional &amp; international focus</td><td style="padding:14px 16px;border-top:1px solid var(--line)">Holding &amp; international trade</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>
'''
write('business-setup.html', shell(
    "Business Setup in UAE — Mainland, Free Zone &amp; Offshore | Kingston",
    "End-to-end UAE business setup with Kingston — Mainland, Free Zone (DMCC, JAFZA, DIFC, ADGM &amp; more) and Offshore (JAFZA, RAK ICC, Ajman) — plus PRO services, visas, and ongoing audit and tax.",
    "service-detail", business_setup_body
))

# --- Mainland setup
write('mainland-setup.html', shell(
    "Mainland Company Setup in Dubai &amp; UAE — Kingston Chartered Auditing &amp; Advisory",
    "End-to-end Mainland company setup in the UAE. Kingston handles DED licence, MoA/AoA, Ejari, immigration card, visas and ongoing audit/tax — all under one engagement.",
    "service-detail",
    service_page(
        slug="mainland-setup",
        name="Mainland Setup",
        eyebrow="Business Setup",
        hero_title="Mainland setup, end to end. Without the runaround.",
        hero_sub="Mainland licences let you trade directly with the UAE local market, take on government contracts, and open multiple physical locations — Kingston handles the full setup, then stays on as your auditor and tax advisor.",
        intro='''<p>UAE Mainland is the right choice when your customers are inside the UAE — local consumers, local businesses, and the government tender market. Mainland licences are issued by the Department of Economic Development (DED) of each emirate, and unlike Free Zones, allow you to trade across the country without a distributor.</p>
        <p>Recent reforms now allow 100% foreign ownership for most commercial and professional activities — meaning Mainland is no longer a &quot;sponsor required&quot; jurisdiction in most cases. Kingston handles the full setup process and stays on for the ongoing audit, tax and compliance work that follows.</p>''',
        features=[
            ("DED trade licence", "Activity selection, name approval, initial approval, MoA drafting, and final licence issuance."),
            ("100% foreign ownership", "Where eligible, structured as a sole-shareholder LLC with full foreign ownership — no UAE national required."),
            ("Office &amp; Ejari", "Tenancy contract, Ejari registration and licence-linked physical address."),
            ("Immigration &amp; establishment cards", "Issued post-licence to enable visa quotas and employee onboarding."),
            ("Visa quotas", "Investor, partner, employee and family visas — quota tied to office space."),
            ("Banking introductions", "Curated introductions to UAE banks with experience in your activity and structure."),
        ],
        why_us=[
            ("One firm, end to end", "Setup, audit, tax, accounting — all under one engagement letter. No third-party hand-offs."),
            ("Plain-English advice", "We will tell you when Mainland is wrong for your business — and recommend Free Zone or Offshore instead."),
            ("Fixed scope, fixed fees", "Setup costs and timelines agreed in writing before any government fee is paid."),
            ("Audit-ready from day one", "Books, controls and tax position set up correctly at the start — saving years of cleanup later."),
        ],
        process_steps=[
            ("Discovery &amp; structuring", "Activity, ownership, office and visa needs mapped to the right Mainland structure (LLC, sole establishment, branch, professional licence)."),
            ("Initial approval &amp; name", "Trade name reservation and DED initial approval — typically 2–5 working days."),
            ("Office &amp; MoA", "Lease + Ejari finalised, MoA drafted and notarised, and licence fees paid."),
            ("Licence, visas &amp; bank", "DED licence issued, immigration card processed, investor/employee visas applied for, and bank account opened."),
        ],
        faqs=[
            ("Can I have 100% foreign ownership in a Mainland LLC?", "For the vast majority of commercial and professional activities, yes — recent reforms removed the historic 51% UAE national requirement. A small list of strategic activities still require local participation. We confirm at engagement."),
            ("Mainland or Free Zone — which is right for me?", "If your customers are largely inside the UAE, or if you need access to government contracts, Mainland is typically right. If your customers are international or you need a sector-specific regulator, Free Zone is usually better."),
            ("How long does Mainland setup take?", "From start to issued licence, typical Mainland setup runs 2–4 weeks. Bank account opening and visa processing add another 3–6 weeks on top."),
            ("Do I need an Ejari?", "Yes — Mainland licences require a registered tenancy contract (Ejari). Kingston coordinates this as part of the setup process."),
        ]
    )
))

# --- Offshore setup
write('offshore-setup.html', shell(
    "Offshore Company Setup in UAE — JAFZA, RAK ICC, Ajman | Kingston",
    "Set up an offshore company in the UAE — JAFZA Offshore, RAK ICC and Ajman Offshore. For holding structures, asset protection and international trade. Kingston handles formation end-to-end.",
    "service-detail",
    service_page(
        slug="offshore-setup",
        name="Offshore Setup",
        eyebrow="Business Setup",
        hero_title="UAE offshore — for holding, structuring and international trade.",
        hero_sub="A UAE offshore company is a non-resident legal entity ideal for holding shares in operating companies, owning assets, and trading internationally — with no UAE physical-presence requirement.",
        intro='''<p>UAE offshore is not a tax dodge. It is a structuring tool. The major UAE offshore regimes — JAFZA Offshore, RAK ICC and Ajman Offshore — offer fast, low-cost incorporation for vehicles whose role is to hold shares, own real estate, hold IP, or trade outside the UAE local market.</p>
        <p>Kingston handles offshore incorporation across all three regimes, and advises on the right choice for your group structure — including ESR scoping for the years ahead.</p>''',
        features=[
            ("JAFZA Offshore", "Dubai-issued offshore vehicle — popular for holding UAE real estate and as the parent of UAE operating entities. Listing-eligible."),
            ("RAK ICC", "RAK International Corporate Centre — modern common-law-flavoured regime; widely used for holding companies, SPVs and IP holding."),
            ("Ajman Offshore", "Cost-effective alternative — popular for international trading vehicles and personal holding structures."),
            ("Foundations &amp; trusts", "Where succession or asset-protection is the goal, we structure ADGM and DIFC foundations alongside offshore vehicles."),
            ("Bank account opening", "Curated introductions to UAE banks experienced with offshore structures — including non-resident director scenarios."),
            ("ESR &amp; corporate tax scoping", "Every offshore engagement includes scoping of Economic Substance Regulations and UAE corporate tax exposure."),
        ],
        why_us=[
            ("Structuring partner, not just incorporator", "We will tell you when offshore is wrong for your goal — for example, where Free Zone is needed for visas or local trade."),
            ("ESR-aware", "Offshore + ESR is where most groups get tripped up. We design positions that are clean from day one."),
            ("Connected to UAE banking", "Offshore-friendly bank introductions matter — we have them."),
            ("Joined-up with audit and tax", "If your group includes audited entities, structuring stays aligned with audit and tax positions across the board."),
        ],
        process_steps=[
            ("Structuring", "Map the purpose of the vehicle (holding, real-estate, IP, trade), agree the right regime, and document the position."),
            ("Incorporation", "Name approval, MoA/AoA, registered agent, certificate of incorporation."),
            ("Banking", "Curated bank introductions and KYC support — typically the longest leg of an offshore project."),
            ("ESR &amp; tax", "Annual ESR notification (where applicable), UAE corporate tax registration assessment, and ongoing compliance."),
        ],
        faqs=[
            ("Can a UAE offshore company own real estate in Dubai?", "Only JAFZA Offshore is currently approved to own real estate in designated Dubai areas. RAK ICC and Ajman Offshore are not. We advise per asset class."),
            ("Can an offshore company sponsor a UAE residence visa?", "No — offshore companies do not provide visa eligibility. If you need residency, pair the offshore vehicle with a Free Zone or Mainland operating entity."),
            ("Is offshore subject to UAE corporate tax?", "UAE offshore entities are within scope of UAE corporate tax in many cases. Whether they have any taxable income depends on the activity. Kingston scopes this carefully — and structures to avoid surprises."),
            ("Do offshore companies need ESR notifications?", "Where they carry on a Relevant Activity in any year, yes. Kingston includes ESR scoping with every offshore engagement."),
        ]
    )
))

# --- PRO & Visa services
write('pro-services.html', shell(
    "PRO &amp; Visa Services in UAE — Kingston Chartered Auditing &amp; Advisory",
    "End-to-end PRO and visa services in Dubai and the UAE — investor visas, employee visas, family visas, Emirates ID, medical, attestations, GDRFA and immigration support.",
    "service-detail",
    service_page(
        slug="pro-services",
        name="PRO &amp; Visa Services",
        eyebrow="Business Setup",
        hero_title="PRO &amp; visas — handled end to end, on time, every time.",
        hero_sub="Investor visas, employee visas, family residence visas, Emirates ID, medical fitness, attestations, immigration cards and ongoing PRO support — managed by people who know the queues, the portals and the right way to ask.",
        intro='''<p>PRO and visa work is unglamorous, paperwork-heavy, and the place where most UAE businesses lose time and patience. Forms reject for missing stamps. Medicals fall on holidays. Family visas wait on a missed attestation from a third country. None of this is hard. All of it is annoying.</p>
        <p>Kingston runs PRO and visa services as a structured service — clear checklists, single point of contact, status updates, and SLAs on the things that need them. Founders get visas. Boards get visibility. Nothing falls through the cracks.</p>''',
        features=[
            ("Investor &amp; partner visas", "Issued post-licence — full processing including entry permit, change of status, medical, Emirates ID and residence stamping."),
            ("Employee visas", "End-to-end employee visa processing — including offer letter, MoHRE work permit, entry permit, medical, Emirates ID and residence visa."),
            ("Family residence visas", "Spouse, children and parent residence visas — including required income/insurance evidence and attestations."),
            ("Emirates ID &amp; medical", "Booking, accompaniment where needed, and same-day pickups where the system allows."),
            ("Attestations &amp; legal translations", "Document attestation (origin country + UAE consulate + MOFA) and legal translations under UAE-recognised translators."),
            ("Ongoing PRO support", "Renewals, amendments, immigration card renewals, establishment card renewals — diarised and managed."),
        ],
        why_us=[
            ("People, not portals", "Most issues need a real person at the right desk. Our PRO team knows the desks."),
            ("SLA-driven", "Each step has a target turnaround — and you see status weekly, not when something breaks."),
            ("Single point of contact", "One person owns your file. One person you call. Decisions do not get lost in a generic inbox."),
            ("Joined-up with setup", "PRO sits inside our setup engagements — no &quot;we will introduce you to a PRO&quot; hand-off after licence issuance."),
        ],
        process_steps=[
            ("File opening", "Collect documents, set up the file, confirm visa quota and timeline expectations."),
            ("Entry permits &amp; medical", "Process entry permits, accompany on medicals, secure Emirates ID appointments."),
            ("Stamping &amp; ID", "Residence visa stamping in passport (or e-residence), Emirates ID issuance and dependant updates."),
            ("Renewal &amp; tracking", "Diarised renewal calendar — investor visas, residence visas, immigration card, establishment card."),
        ],
        faqs=[
            ("How long does an investor visa take?", "Typical end-to-end timing from licence issuance is 3–6 weeks, including entry permit, medical, Emirates ID and residence stamping. We agree the calendar at file opening."),
            ("Can my spouse and kids come on my UAE visa?", "Yes — with sufficient income (typically AED 4,000–10,000/month depending on emirate and dependent type) and standard documents (attested marriage and birth certificates)."),
            ("Do you handle visa renewals?", "Yes — we run the renewal calendar for every active client and handle the renewal end-to-end before expiry."),
            ("Can I get a 10-year Golden Visa through Kingston?", "We assess Golden Visa eligibility against published criteria (investor, specialist, etc.) and handle the application end-to-end where eligible."),
        ]
    )
))

# --- Feasibility studies
write('feasibility-studies.html', shell(
    "Feasibility Studies &amp; Financial Modelling in UAE — Kingston",
    "Bankable feasibility studies, financial modelling and viability analysis for UAE businesses — for new ventures, capex decisions, expansion plans and bank financing.",
    "service-detail",
    service_page(
        slug="feasibility-studies",
        name="Feasibility Studies",
        eyebrow="Advisory",
        hero_title="Decide with numbers, not hope.",
        hero_sub="Independent feasibility studies, financial models and viability analysis — for new ventures, capex decisions, expansion plans and bank financing applications. Built before you commit capital, not after.",
        intro='''<p>Most failed businesses had a feasibility study. Many of them just had the wrong one — built backwards from a target answer, with optimism baked into every assumption. A real feasibility study is the opposite: it stress-tests the idea, prices in the unknowns, and tells the founder or board what they need to hear, not what they want to hear.</p>
        <p>Kingston builds feasibility studies and financial models for UAE founders, family offices and corporates — for new ventures, capex decisions, market entry, and bank financing applications. Independent. Numbers-led. Bankable.</p>''',
        features=[
            ("Market sizing &amp; demand analysis", "Top-down and bottom-up market sizing, competitor mapping and demand-driver analysis — for the UAE and the relevant catchment."),
            ("Financial modelling", "5-year three-statement financial models — P&amp;L, balance sheet, cash flow — with scenario and sensitivity analysis."),
            ("Capex &amp; opex breakdown", "Bottom-up capex and opex build, with quoted vendor data where possible — not generic per-unit assumptions."),
            ("Funding &amp; capital structure", "Equity / debt mix analysis, debt-service coverage, and bank-friendly funding plans for financing applications."),
            ("Sensitivity &amp; scenario analysis", "Base, downside and upside scenarios — with the assumptions that move the answer surfaced explicitly."),
            ("Investor- and bank-ready report", "A written feasibility report designed to stand up to investor due diligence and bank credit committees."),
        ],
        why_us=[
            ("Independent — no agenda", "We are not selling the deal. Our reports are written for decision-makers, not promoters."),
            ("Bank-credible", "UAE banks recognise Kingston feasibility studies as credible evidence in financing applications."),
            ("UAE market-aware", "Free Zones, customs, VAT, corporate tax, employment — we model UAE specifics correctly, not as a US/Europe template."),
            ("Joined-up with audit and tax", "Models are tax-aware and accounting-aware — your day-one books pick up exactly where the model left off."),
        ],
        process_steps=[
            ("Brief &amp; scope", "Workshop with you to define the question — &quot;is this idea viable?&quot;, &quot;at what scale?&quot;, &quot;with what funding?&quot;."),
            ("Data &amp; research", "Market data, competitor benchmarks, vendor quotes — built into a transparent assumption book."),
            ("Modelling &amp; analysis", "Three-statement model, scenarios, sensitivities, and break-even analysis."),
            ("Report &amp; decision support", "Written feasibility report, model handover, and decision-support meeting with you and your investors / bankers."),
        ],
        faqs=[
            ("Will banks accept your feasibility study for financing?", "Yes — UAE banks recognise Kingston-prepared feasibility studies in their credit-committee process. We design every report to be bankable."),
            ("How long does a feasibility study take?", "Typical timeline is 4–8 weeks depending on the depth of market research and access to vendor data. Lean &quot;red-flag&quot; feasibility reviews can be turned in 2 weeks."),
            ("Will you tell me if the idea does not work?", "Yes. Our reports are written to be honest with the founder. A polite no costs less than a bad yes."),
            ("Do you also advise on raising the capital?", "Kingston is not a capital-raising firm — we are an audit and advisory firm. But our reports are designed to be used in fundraising, and we collaborate with your chosen advisors."),
        ]
    )
))

print('\nAll pages generated.')

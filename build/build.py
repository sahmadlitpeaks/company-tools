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
    "Audit, tax and advisory — under one trusted Dubai roof.",
    "From statutory audit to forensic investigations, corporate tax to VAT, every Kingston service is designed around one promise: rigorous work, clear counsel, on time.",
    "Services"
) + '''
<section class="bg-bone">
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Audit &amp; Assurance</span>
      <h2>Independent assurance the market trusts.</h2>
    </div>
    <div class="service-grid">
      <a href="statutory-audit.html" class="service-card reveal">
        <span class="num">01</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <h3>Statutory Audit</h3>
        <p>IFRS-aligned external audits that satisfy UAE corporate law and Free Zone authority requirements.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
      </a>
      <a href="internal-audit.html" class="service-card reveal">
        <span class="num">02</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
        <h3>Internal Audit</h3>
        <p>Risk-based internal audit, controls assurance and operational efficiency reviews — co-source or full outsource.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
      </a>
      <a href="forensic-audit.html" class="service-card reveal">
        <span class="num">03</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
        <h3>Forensic Audit</h3>
        <p>Fraud investigations, asset tracing and litigation support — with court-ready evidence and discreet handling.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
      </a>
      <a href="due-diligence.html" class="service-card reveal">
        <span class="num">04</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21l-4.35-4.35"/><circle cx="11" cy="11" r="8"/></svg></div>
        <h3>Due Diligence</h3>
        <p>Financial, tax and operational due diligence for buyers, sellers and lenders. Surface the truth before signing.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
      </a>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <div class="section-head reveal">
      <span class="eyebrow center">Tax &amp; Compliance</span>
      <h2>End-to-end UAE tax — from registration to FTA representation.</h2>
    </div>
    <div class="service-grid">
      <a href="corporate-tax.html" class="service-card reveal">
        <span class="num">05</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <h3>Corporate Tax</h3>
        <p>Registration, structuring, returns and advisory for UAE&rsquo;s 9% corporate tax — with optimisation planning.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
      </a>
      <a href="vat.html" class="service-card reveal">
        <span class="num">06</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3l-3 18"/><path d="M18 3l-3 18"/></svg></div>
        <h3>VAT Services</h3>
        <p>VAT registration, return preparation, refund recovery, audits and FTA representation.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
      </a>
      <a href="excise-tax.html" class="service-card reveal">
        <span class="num">07</span>
        <div class="service-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v4H3z"/><path d="M5 7v14h14V7"/><path d="M9 11h6"/></svg></div>
        <h3>Excise Tax</h3>
        <p>Registration, calculation, filing and advisory for businesses dealing in excisable goods.</p>
        <span class="read">Learn more <span class="arrow">→</span></span>
      </a>
    </div>
  </div>
</section>

<section class="bg-bone">
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

    body = page_header(eyebrow, hero_title, hero_sub, name) + f'''
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

print('\nAll pages generated.')

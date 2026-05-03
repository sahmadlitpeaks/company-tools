#!/usr/bin/env python3
"""Generate branded SVG placeholder images for the Kingston site.

Each image is a navy-and-gold branded SVG with a relevant icon and a clear
'PLACEHOLDER · Replace with photo' label so developers know to swap them.
"""
import os, html

OUT_BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'img')

# Reusable SVG icon paths (24x24 viewBox)
ICONS = {
    'audit':    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    'shield':   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'search':   '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'clock':    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'building': '<path d="M3 21h18"/><path d="M5 21V11l7-7 7 7v10"/><path d="M9 21V12h6v9"/>',
    'globe':    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    'tower':    '<path d="M3 21h18"/><path d="M9 21V8l3-5 3 5v13"/><path d="M9 13h6"/>',
    'plane':    '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    'percent':  '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    'briefcase':'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    'team':     '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'check':    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    'doc':      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    'chart':    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    'lock':     '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'sail':     '<path d="M3 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9-9-4-9-9z"/><path d="M12 3v18"/>',
    'compass':  '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    'spark':    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
}


def svg_placeholder(width, height, eyebrow, title, subtitle, icon='audit',
                    big_letter=None, accent='#d4af37', accent_soft='#e5c25a'):
    """Return a polished navy/gold SVG placeholder with a clear 'replace me' marker."""
    icon_svg = ICONS.get(icon, ICONS['audit'])
    big = (big_letter or '').upper()
    title_e = html.escape(title)
    subtitle_e = html.escape(subtitle)
    eyebrow_e = html.escape(eyebrow)
    serif_family = '&quot;Cormorant Garamond&quot;, Georgia, serif'
    sans_family  = 'Inter, system-ui, sans-serif'

    big_letter_svg = ''
    if big:
        big_letter_svg = (
            f'<text x="{int(width*0.78)}" y="{int(height*0.92)}" text-anchor="end" '
            f'font-family="{serif_family}" font-size="{int(min(width,height)*1.05)}" '
            f'font-weight="500" fill="{accent}" fill-opacity="0.10" letter-spacing="-0.04em">'
            f'{html.escape(big)}</text>'
        )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="{title_e} · placeholder image">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"  stop-color="#0a1f3d"/>
      <stop offset="55%" stop-color="#143569"/>
      <stop offset="100%" stop-color="#1d4480"/>
    </linearGradient>
    <radialGradient id="warm" cx="80%" cy="0%" r="80%">
      <stop offset="0%"  stop-color="{accent}" stop-opacity="0.32"/>
      <stop offset="60%" stop-color="{accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cool" cx="0%" cy="100%" r="80%">
      <stop offset="0%"  stop-color="#1d4480" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="#1d4480" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M60 0 L0 0 0 60" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
    </pattern>
    <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="rgba(212,175,55,0.18)"/>
    </pattern>
  </defs>

  <!-- background -->
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#warm)"/>
  <rect width="100%" height="100%" fill="url(#cool)"/>
  <rect width="100%" height="100%" fill="url(#grid)" opacity="0.6"/>
  <rect width="100%" height="100%" fill="url(#dots)" opacity="0.5"/>

  <!-- decorative circles -->
  <circle cx="{int(width*0.12)}" cy="{int(height*0.18)}" r="{int(min(width,height)*0.10)}" fill="{accent}" fill-opacity="0.08"/>
  <circle cx="{int(width*0.88)}" cy="{int(height*0.86)}" r="{int(min(width,height)*0.16)}" fill="{accent_soft}" fill-opacity="0.06"/>

  {big_letter_svg}

  <!-- icon plate -->
  <g transform="translate({int(width*0.5)-32}, {int(height*0.5)-44})">
    <rect x="0" y="0" width="64" height="64" rx="16" fill="rgba(255,255,255,0.08)" stroke="rgba(212,175,55,0.35)" stroke-width="1"/>
    <g transform="translate(20,20)" fill="none" stroke="{accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      {icon_svg}
    </g>
  </g>

  <!-- eyebrow -->
  <text x="50%" y="{int(height*0.5)+50}" text-anchor="middle"
        font-family="{sans_family}" font-size="11" font-weight="600"
        fill="{accent}" letter-spacing="3.2">{eyebrow_e.upper()}</text>

  <!-- title (serif) -->
  <text x="50%" y="{int(height*0.5)+82}" text-anchor="middle"
        font-family="{serif_family}" font-size="24" font-weight="600"
        fill="rgba(255,255,255,0.92)">{title_e}</text>

  <!-- subtitle / replace hint -->
  <text x="50%" y="{int(height*0.5)+106}" text-anchor="middle"
        font-family="{sans_family}" font-size="11"
        fill="rgba(255,255,255,0.55)" letter-spacing="0.5">{subtitle_e}</text>

  <!-- corner: PLACEHOLDER badge -->
  <g transform="translate(18, 18)">
    <rect x="0" y="0" width="118" height="22" rx="11" fill="rgba(255,255,255,0.08)" stroke="rgba(212,175,55,0.4)" stroke-width="1"/>
    <circle cx="12" cy="11" r="3.5" fill="{accent}"/>
    <text x="22" y="15" font-family="{sans_family}" font-size="10" font-weight="600" fill="rgba(255,255,255,0.85)" letter-spacing="2">PLACEHOLDER</text>
  </g>

  <!-- subtle border -->
  <rect x="0.5" y="0.5" width="{width-1}" height="{height-1}" fill="none" stroke="rgba(212,175,55,0.18)" stroke-width="1"/>
</svg>
'''


def write(path, content):
    full = os.path.join(OUT_BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(content)
    print('wrote', path)


# ----------------------------- HERO (3 slides)
HERO = [
    ('hero/audit.svg',    'Audit · Assurance', 'Hero — Audit visual',     'Replace with audit / boardroom photo',   'audit',    'A'),
    ('hero/freezone.svg', 'UAE Free Zones',     'Hero — Free Zone visual', 'Replace with Dubai skyline / port photo','globe',    'FZ'),
    ('hero/tax.svg',      'UAE Tax',            'Hero — Tax visual',       'Replace with city / desk photo',         'percent',  '%'),
]
for path, eb, t, s, ic, big in HERO:
    write(path, svg_placeholder(960, 960, eb, t, s, icon=ic, big_letter=big))

# ----------------------------- SERVICES (11)
SERVICES = [
    ('services/statutory-audit.svg', 'Statutory Audit',       'audit',    'SA'),
    ('services/internal-audit.svg',  'Internal Audit',        'clock',    'IA'),
    ('services/forensic-audit.svg',  'Forensic Audit',        'search',   'FA'),
    ('services/free-zone.svg',       'Free Zone Audit',       'shield',   'FZ'),
    ('services/due-diligence.svg',   'Due Diligence',         'spark',    'DD'),
    ('services/corporate-tax.svg',   'Corporate Tax',         'percent',  'CT'),
    ('services/vat.svg',             'VAT Services',          'doc',      'VAT'),
    ('services/excise-tax.svg',      'Excise Tax',            'doc',      'EX'),
    ('services/accounting.svg',      'Accounting',            'chart',    'A'),
    ('services/aml-compliance.svg',  'AML / CFT',             'shield',   'AML'),
    ('services/esr.svg',             'ESR Compliance',        'check',    'ESR'),
    ('services/feasibility.svg',     'Feasibility Studies',   'chart',    'F'),
    ('services/business-setup.svg',  'Business Setup',        'briefcase','BS'),
    ('services/mainland-setup.svg',  'Mainland Setup',        'building', 'M'),
    ('services/offshore-setup.svg',  'Offshore Setup',        'sail',     'O'),
    ('services/pro-services.svg',    'PRO &amp; Visa',        'team',     'V'),
]
for path, label, ic, big in SERVICES:
    write(path, svg_placeholder(800, 500, 'Service · placeholder', label,
                                'Replace with relevant service photo', icon=ic, big_letter=big))

# ----------------------------- FREE ZONES (9)
ZONES = [
    ('freezones/dmcc.svg',   'DMCC',   'Dubai Multi Commodities Centre', 'tower',    'DMCC'),
    ('freezones/jafza.svg',  'JAFZA',  'Jebel Ali Free Zone',            'building', 'JAFZA'),
    ('freezones/difc.svg',   'DIFC',   'Dubai International Financial',  'briefcase','DIFC'),
    ('freezones/adgm.svg',   'ADGM',   'Abu Dhabi Global Market',        'compass',  'ADGM'),
    ('freezones/dafza.svg',  'DAFZA',  'Dubai Airport Free Zone',        'plane',    'DAFZA'),
    ('freezones/rakez.svg',  'RAKEZ',  'Ras Al Khaimah Economic Zone',   'tower',    'RAK'),
    ('freezones/ifza.svg',   'IFZA',   'International Free Zone',        'globe',    'IFZA'),
    ('freezones/meydan.svg', 'Meydan', 'Meydan Free Zone',               'building', 'MEYDAN'),
    ('freezones/shams.svg',  'SHAMS',  'Sharjah Media City',             'spark',    'SHAMS'),
]
for path, name, full, ic, big in ZONES:
    write(path, svg_placeholder(800, 500, name, full,
                                'Replace with skyline / building photo', icon=ic, big_letter=big))

# ----------------------------- ABOUT
write('about/team.svg', svg_placeholder(800, 1000, 'About Kingston', 'Team / office',
                                        'Replace with team or office photo', icon='team', big_letter='K'))

# ----------------------------- PAGE HEADERS (used optionally on inner page heroes)
write('page/audit-banner.svg',     svg_placeholder(1600, 600, 'Audit &amp; Assurance', 'Audit page banner', 'Replace with banner photo', icon='audit',     big_letter='A'))
write('page/tax-banner.svg',       svg_placeholder(1600, 600, 'UAE Tax',               'Tax page banner',   'Replace with banner photo', icon='percent',   big_letter='%'))
write('page/setup-banner.svg',     svg_placeholder(1600, 600, 'Business Setup',        'Setup page banner', 'Replace with banner photo', icon='briefcase', big_letter='BS'))
write('page/compliance-banner.svg',svg_placeholder(1600, 600, 'Compliance',            'Compliance banner', 'Replace with banner photo', icon='shield',    big_letter='C'))

print('\nAll placeholder images generated.')

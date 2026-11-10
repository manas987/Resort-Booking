from pathlib import Path
import re, html, zipfile
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from pypdf import PdfReader
root=Path.cwd()
p=root/'Docs/TDD.md'
s=p.read_text().split('\n\n## 13. UI and experience decisions')[0]
s=s.replace('**Dates in drafts come from the rate table, never from the model.**','**Prices in drafts come from backend pricing, never from the model.**').replace('- Dates in drafts come from the rate table, never from the model.','- Prices in drafts come from backend pricing, never from the model.')
s=s.replace('`audit_log`','`audit_events`').replace('`dedupe_key` makes a job at-most-once;', '`dedupe_key` prevents duplicate enqueueing; handlers must tolerate retries;')
s=s.replace('**Both email and phone must be verified** before a booking is accepted. Verification is\n  folded into checkout rather than being its own step.', '**Both email and phone must be verified**, and registration completed, before a booking is accepted.\n  Email OTP or Google signs in an existing guest. New guests also verify their phone and confirm\n  their editable name. Sign-in uses a dedicated page and preserves the booking selection.\n  Signed-in guests review their details, continue to checkout and then use a separate test-payment step.')
s=s.replace('**329 passing backend tests across 34 files**, plus 10 opt-in live-provider tests, and 41\nfrontend checks (`bun test` files plus three plain-assert scripts). Every test runs\nagainst a real PostgreSQL database', '**Latest run: 332 passing backend tests, 10 skipped; 44 passing frontend tests**, alongside\nthree plain-assert scripts. Backend integration tests run against a real PostgreSQL database')
s=s.replace('Test cases were written before the code they cover, named and recorded in `tests-phase1.md` and\n`tests-phase2.md`.', 'Test plans and results are recorded in the repository. Final regression coverage includes nullable\naudit targets, existing/new guest registration, phone verification and registration completion.\nA final local HTTP walkthrough confirmed a booking with a succeeded mock payment.')
s=s.replace('**Google Gemini, not Anthropic Claude** | A deliberate deviation from the spec, recorded with its reason in `03-decisions.md`. The provider is isolated behind one file, so swapping back is a change in `adapters/ai/gemini.ts` and nowhere else', '**Google Gemini** | Real structured-output classification and drafting. This differs from the internal expanded plan naming Claude; the client brief does not mandate a provider. The provider adapter is isolated')
s=s.replace('no CSS framework, no date library, no chart library', 'no chart service or separate search infrastructure')
s=s.replace('**No rendered-UI verification.** The development environment had no browser, so every layout\n  claim rests on type-checking, lint, static render output and the check scripts.', '**Final browser verification unavailable.** The final fixes were checked with types, lint, build,\n  automated tests and an HTTP walkthrough; a final visual browser pass is still required.\n- **No app-wide error boundary.** Unexpected rendering exceptions can still blank a route.')
s=s.replace('The only figure taken from the brief is\n  the 76-key total. No street address, map pin, award, review or facility beyond what the brief\n  establishes appears anywhere.', 'The 64-room/12-villa split comes from the brief. Room categories, rates, copy,\n  review content and regional map placement are illustrative, not claims about a real property.')
s=s.replace('**No guest cancellation, date change, extension or room change** — explicitly out of scope.', '**Cut from this build:** guest cancellation, date changes, extensions and room changes. The brief\n  excludes replacing the reservation system; it does not explicitly require these workflows.')
s += '''

## 13. UI and experience decisions

| Screen | Design and reason |
|---|---|
| Home | Estate photography, restrained serif headings, off-white #F2F0EF surfaces and a black booking action. A central date pill makes the next action clear. The guest badge scrolls to reviews. |
| Room selection | An image accordion exposes room choices and availability. Expanded cards link to detail pages; quantity controls build a multi-room selection. |
| Room details | A controlled gallery, concise amenities and a prominent availability calendar. Selected dates carry through from the booking journey. |
| Review and checkout | Room thumbnails, readable dates, minus/plus quantities, occupancy controls and one price summary. A single sign-in action avoids competing calls to action. |
| Sign-in and registration | One email-first flow with Google or OTP. New guests verify phone, then confirm a name. The return destination and selection survive sign-in. |
| Payment and confirmation | Explicit test-payment screen, pending feedback and confirmation reference. Server errors preserve context and explain the next action. |
| Guest help and account | Bottom-right chat entry, sign-in after the first message, booking/payment history and previous website enquiry threads. Email/WhatsApp conversations stay on their originating channel. |
| Employee console | Stable sidebar, compact sans-serif controls, understated cards and tables. Navigation reflects permissions; the API enforces them. |
| Enquiries | Search and compact filters, List/Board toggle, three statuses: New, In progress, Resolved. Staff replies move work into progress automatically; resolution is explicit. No drag-to-change status. |
| Rates and allotment | Room selector, standard settings and date-specific overrides. Preview before applying changes; history explains who changed what. Existing purchased prices remain unchanged. |

Responsive layouts stack content on phones, keep tap targets usable and constrain galleries with
object-fit. Loading skeletons reserve space during data fetches. Empty, failure and retry states
are shown where data cannot be loaded. Motion is restrained and respects reduced-motion settings.
The hero is compressed; galleries defer secondary images, console code and the interactive map are
lazy-loaded. Actual slow-network performance remains to be measured.

## 14. Explicit assumptions and next steps

**Assumptions:** The Quiet Estate is a fictional brand; all guest identities, staff identities,
room descriptions, prices, reviews and operational records are synthetic. The four room types
are a design choice within the client's 76 keys. Room-only rates have no separately charged extra
beds. Check-in is 14:00, checkout 11:00, in Asia/Kolkata. A booking permits up to four rooms and
14 nights; quotes last five minutes and inventory holds ten minutes. These are implementation
policies, not facts supplied by the client. AI confidence below 0.60 routes to review. Website
allotment is an independent admin-maintained pool; there is no live agency-stock synchronisation.

GST uses configured, versioned tax rules and stored booking snapshots; seeded rules are demo
configuration, not a claim that legal/tax configuration has been independently validated. Hosting
in India is required by the brief; actual service regions and residency have not been verified.
The owner/GM/staff permission split and synthetic operating hours are product assumptions.

**Next:** validate hosted sign-in/cookies and Google OAuth; confirm India hosting and tax
configuration; connect real OTP delivery; add an app-wide error boundary; measure cold loads on
slow mobile networks and trim Mapbox delivery. Beyond the trial, add monitored queue alerts,
shared rate limiting for multiple API instances, backups/restore drills and a reservation-system
export reconciliation process. Real payment and messaging integrations require a separate scope.

The submission demonstrates the core booking and enquiry slice. It does not claim production
readiness, live deployment, actual guest reviews or measured business-outcome improvements.
'''
p.write_text(s)
# Place repository URL on the first content line of both deliverables.
for f in [p,root/'deployment.md']:
 t=f.read_text(); t=t.replace('**GitHub:** https://github.com/manas987/Resort-Booking\n','').lstrip()
 f.write_text('**GitHub:** https://github.com/manas987/Resort-Booking\n\n'+t)
s=p.read_text()
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyCustom',fontName='Helvetica',fontSize=9.0,leading=13.0,spaceAfter=7,textColor=colors.HexColor('#28332e')))
styles.add(ParagraphStyle(name='TitleCustom',fontName='Helvetica-Bold',fontSize=25,leading=29,spaceBefore=12,spaceAfter=14,textColor=colors.HexColor('#203c2e')))
styles.add(ParagraphStyle(name='HeadCustom',fontName='Helvetica-Bold',fontSize=14,leading=18,spaceBefore=15,spaceAfter=8,keepWithNext=True,textColor=colors.HexColor('#203c2e')))
styles.add(ParagraphStyle(name='CellCustom',parent=styles['BodyCustom'],fontSize=8,leading=11,spaceAfter=0))
def clean(t):
 for a,b in [('₹','INR '),('→',' -> '),('−','-'),('–','-'),('—','-'),('…','...'),('§','section '),('≤','<='),('≥','>='),('×','x')]: t=t.replace(a,b)
 return t

def fmt(t):
 t=html.escape(clean(t)); t=re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',t); t=re.sub(r'`([^`]+)`',r'<font name="Courier">\1</font>',t)
 t=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<link href="\2" color="#245a45">\1</link>',t)
 t=t.replace('https://github.com/manas987/Resort-Booking','<link href="https://github.com/manas987/Resort-Booking" color="#245a45">https://github.com/manas987/Resort-Booking</link>')
 return t
story=[]; lines=s.splitlines(); i=0
while i<len(lines):
 l=lines[i]
 if not l.strip() or l=='---': i+=1; continue
 if l.startswith('```'):
  code=[]; i+=1
  while i<len(lines) and not lines[i].startswith('```'): code.append(clean(lines[i])); i+=1
  # wrap diagram/code lines to keep within text area
  import textwrap
  wrapped='\n'.join('\n'.join(textwrap.wrap(x,94,replace_whitespace=False,drop_whitespace=False)) if len(x)>94 else x for x in code)
  story.extend([Preformatted(wrapped,ParagraphStyle('code',fontName='Courier',fontSize=7.5,leading=10,backColor=colors.HexColor('#f1f4f0'),borderPadding=9)),Spacer(1,9)]); i+=1; continue
 if l.startswith('|'):
  rows=[]
  while i<len(lines) and lines[i].startswith('|'):
   cells=[c.strip() for c in lines[i].strip('|').split('|')]
   if not all(re.fullmatch(r'[:\- ]*',c) for c in cells): rows.append(cells)
   i+=1
  # Markdown code spans occasionally contain pipe separators; merge surplus cells.
  n=len(rows[0]); rows=[r[:n-1]+[' | '.join(r[n-1:])] for r in rows]
  widths=([145,354] if n==2 else [499/n]*n)
  table=Table([[Paragraph(fmt(c),styles['CellCustom']) for c in r] for r in rows],colWidths=widths,repeatRows=1,hAlign='LEFT')
  table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e7ede7')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.35,colors.HexColor('#dce3dc'))]))
  story.extend([table,Spacer(1,9)]); continue
 if l.startswith('# '): story.append(Paragraph(fmt(l[2:]),styles['TitleCustom'])); i+=1; continue
 if l.startswith('## '): story.append(Paragraph(fmt(l[3:]),styles['HeadCustom'])); i+=1; continue
 para=[l]; i+=1
 while i<len(lines) and lines[i].strip() and not re.match(r'^(#|\||```|- |\d+\. )',lines[i]): para.append(lines[i]); i+=1
 text=' '.join(para)
 if text.startswith('- '): text='&#8226; '+fmt(text[2:])
 else: text=fmt(text)
 story.append(Paragraph(text,styles['BodyCustom']))

def footer(c,d):
 c.setStrokeColor(colors.HexColor('#dce3dc')); c.line(48,42,547,42)
 c.setFont('Helvetica',8); c.setFillColor(colors.HexColor('#67756b')); c.drawString(48,28,'THE QUIET ESTATE  /  TECHNICAL DESIGN  /  09 NOV 2026'); c.drawRightString(547,28,str(d.page))
out=root/'output/pdf/Technical-Design-Document.pdf'
SimpleDocTemplate(str(out),pagesize=(595,842),leftMargin=48,rightMargin=48,topMargin=42,bottomMargin=58,title='The Quiet Estate - Technical Design Document',author='Manas Kushwaha').build(story,onFirstPage=footer,onLaterPages=footer)
r=PdfReader(out); assert all(page.extract_text().strip() for page in r.pages)
assert 'https://github.com/manas987/Resort-Booking' in r.pages[0].extract_text()
z=root/'output/Resort-Booking-Submission.zip'
with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as f:
 f.write(out,'Technical-Design-Document.pdf'); f.write(root/'deployment.md','deployment.md')
assert z.stat().st_size<25*1024*1024
with zipfile.ZipFile(z) as f: assert f.namelist()==['Technical-Design-Document.pdf','deployment.md']; assert f.testzip() is None
print(f'PDF: {len(r.pages)} pages; ZIP: {z.stat().st_size:,} bytes; {z}')

"""
Generates realistic bank-statement PDFs (several layouts) for the importer's tests.

Run:  python tests/fixtures/make_fixtures.py
Needs: PyMuPDF (pip install pymupdf). The generated files are committed, so tests don't need Python.
"""
import json
import os
import fitz  # PyMuPDF

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = "helv"


def indian(minor: int) -> str:
    """12345678 -> '1,23,456.78'"""
    rupees, paise = divmod(abs(minor), 100)
    s = str(rupees)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"{s}.{paise:02d}"


def p(rupees: float) -> int:
    return round(rupees * 100)


# ---------------- The account's life ----------------
OPENING_SEPT = p(50000)

# (date iso, narration, debit paise, credit paise)
SEPT = [
    ("2026-09-01", "NEFT CR-HDFC0000001-ACME TECHNOLOGIES PVT LTD-SALARY SEP 2026-N252260123456789", 0, p(85000)),
    ("2026-09-02", "UPI-AMIT KUMAR-AMIT.KUMAR@OKHDFCBANK-526012345678-RENT SEP", p(18000), 0),
    ("2026-09-03", "UPI-SWIGGY-SWIGGYUPI@ICICI-640812345678-UPI", p(850), 0),
    ("2026-09-03", "UPI-SWIGGY-SWIGGYUPI@ICICI-640812999999-UPI", p(850), 0),
    ("2026-09-05", "UPI-AMAZON PAY-AMAZONPAY@APL-640898765432-PAYMENT FROM PHONE", p(2400), 0),
    ("2026-09-06", "UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526099991111-UPI", p(2000), 0),
    ("2026-09-07", "UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI", p(2000), 0),
    ("2026-09-08", "ATM WDL 5416 MG ROAD BANGALORE", p(5000), 0),
    ("2026-09-10", "UPI-NETFLIX-NETFLIX@HDFCBANK-640811112222-MONTHLY", p(649), 0),
    ("2026-09-12", "INT.PD:01-07-2026 TO 30-09-2026", 0, p(312)),
    ("2026-09-15", "UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526077778888-RETURN", 0, p(2000)),
    ("2026-09-18", "ACH D- ZERODHA COIN SIP-1234567", p(10000), 0),
    ("2026-09-20", "CREDIT CARD PAYMENT 4012XXXXXXXX1234 BILLDESK", p(7500), 0),
    ("2026-09-25", "SMS ALERT CHARGES Q3", p(17.70), 0),
    ("2026-09-28", "REFUND-AMAZON-AMAZONPAY@APL-640855556666", 0, p(799)),
]

OCT = [
    ("2026-10-01", "NEFT CR-HDFC0000001-ACME TECHNOLOGIES PVT LTD-SALARY OCT 2026-N252270123456789", 0, p(85000)),
    ("2026-10-02", "UPI-SWIGGY-SWIGGYUPI@ICICI-640822345678-UPI", p(520), 0),
    ("2026-10-05", "UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526066665555-UPI", p(1000), 0),
]


def with_balances(opening: int, txns):
    rows, bal = [], opening
    for date, narr, dr, cr in txns:
        bal += cr - dr
        rows.append({"date": date, "narration": narr, "debit": dr, "credit": cr, "balance": bal})
    return rows


SEPT_ROWS = with_balances(OPENING_SEPT, SEPT)
CLOSING_SEPT = SEPT_ROWS[-1]["balance"]
OCT_ROWS = with_balances(CLOSING_SEPT, OCT)

# A later statement that starts mid-September (overlaps the first).
START_IDX = next(i for i, r in enumerate(SEPT_ROWS) if r["date"] >= "2026-09-20")
OVERLAP_OPENING = SEPT_ROWS[START_IDX - 1]["balance"]
OVERLAP_ROWS = with_balances(OVERLAP_OPENING, SEPT[START_IDX:] + OCT)


# A statement full of merchants the built-in rules do not know (exercises the AI path).
UNKNOWN = [
    ("2026-11-02", "NEFT CR-ICIC0000002-ZENITH FREELANCE-INV 22", 0, p(30000)),
    ("2026-11-03", "UPI-DUNZO-DUNZO@AXIS-640833334444-UPI", p(380), 0),
    ("2026-11-04", "UPI-URBANCLAP HOME SERVICES-URBANCLAP@ICICI-640844445555-UPI", p(1200), 0),
    ("2026-11-06", "UPI-DUNZO-DUNZO@AXIS-640855556666-UPI", p(260), 0),
    ("2026-11-09", "UPI-PRIYA NAIR-PRIYA.NAIR@OKAXIS-526011112222-UPI", p(1500), 0),
]
UNKNOWN_ROWS = with_balances(p(20000), UNKNOWN)


def dmy(iso: str, style: str) -> str:
    y, m, d = iso.split("-")
    if style == "dd/mm/yy":
        return f"{d}/{m}/{y[2:]}"
    if style == "dd/mm/yyyy":
        return f"{d}/{m}/{y}"
    mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][int(m) - 1]
    if style == "d Mon yyyy":
        return f"{int(d)} {mon} {y}"
    return iso


class Doc:
    def __init__(self):
        self.doc = fitz.open()
        self.page = None
        self.y = 0

    def new_page(self):
        self.page = self.doc.new_page(width=595, height=842)
        self.y = 40
        return self.page

    def text(self, x, y, s, size=8, bold=False):
        self.page.insert_text((x, y), s, fontsize=size, fontname="hebo" if bold else FONT)

    def right(self, xr, y, s, size=8, bold=False):
        w = fitz.get_text_length(s, fontname="hebo" if bold else FONT, fontsize=size)
        self.text(xr - w, y, s, size, bold)

    def wrap(self, s, width, size=7.5):
        words, lines, cur = s.replace("-", "- ").split(" "), [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if fitz.get_text_length(trial, fontname=FONT, fontsize=size) <= width:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return [l.replace("- ", "-") for l in lines]


# ---------------- Layout A: HDFC-style, separate Withdrawal/Deposit columns ----------------
def layout_a(path, rows, opening, period, password=None):
    d = Doc()
    per_page = 8
    chunks = [rows[i:i + per_page] for i in range(0, len(rows), per_page)]
    for pi, chunk in enumerate(chunks):
        d.new_page()
        if pi == 0:
            d.text(30, 40, "HDFC BANK LIMITED", 12, True)
            d.text(30, 56, "Statement of account", 9)
            d.text(30, 70, "Account No : 50100123456789      Customer : TEST USER", 8)
            d.text(30, 82, f"Statement From : {period[0]}  To : {period[1]}", 8)
            d.y = 105
        else:
            d.y = 50
        y = d.y
        for x, label in [(30, "Date"), (78, "Narration"), (235, "Chq./Ref.No."), (300, "Value Dt")]:
            d.text(x, y, label, 8, True)
        d.right(418, y, "Withdrawal Amt.", 8, True)
        d.right(478, y, "Deposit Amt.", 8, True)
        d.right(560, y, "Closing Balance", 8, True)
        y += 16
        for r in chunk:
            lines = d.wrap(r["narration"], 150)
            d.text(30, y, dmy(r["date"], "dd/mm/yy"), 7.5)
            for li, ln in enumerate(lines):
                d.text(78, y + li * 9, ln, 7.5)
            d.text(235, y, r["narration"].split("-")[-1][:12] if r["narration"].count("-") >= 3 else "", 7)
            d.text(300, y, dmy(r["date"], "dd/mm/yy"), 7.5)
            if r["debit"]:
                d.right(418, y, indian(r["debit"]), 7.5)
            if r["credit"]:
                d.right(478, y, indian(r["credit"]), 7.5)
            d.right(560, y, indian(r["balance"]), 7.5)
            y += max(len(lines), 1) * 9 + 5
        d.text(30, 820, f"Page {pi + 1} of {len(chunks)}", 7)
        if pi == len(chunks) - 1:
            td = sum(r["debit"] for r in rows)
            tc = sum(r["credit"] for r in rows)
            y += 14
            d.text(30, y, "STATEMENT SUMMARY :-", 8, True)
            y += 12
            for x, label in [(30, "Opening Balance"), (150, "Dr Count"), (210, "Cr Count"), (290, "Debits"), (370, "Credits"), (450, "Closing Bal")]:
                d.text(x, y, label, 7.5, True)
            y += 11
            for x, v in [(30, indian(opening)), (150, str(sum(1 for r in rows if r['debit']))), (210, str(sum(1 for r in rows if r['credit']))),
                         (290, indian(td)), (370, indian(tc)), (450, indian(rows[-1]['balance']))]:
                d.text(x, y, v, 7.5)
    if password:
        d.doc.save(path, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=password + "-owner")
    else:
        d.doc.save(path)
    return d


# ---------------- Layout B: SBI-style, "5 Sep 2026" dates, Debit/Credit/Balance ----------------
def layout_b(path, rows, opening, period):
    d = Doc()
    per_page = 9
    chunks = [rows[i:i + per_page] for i in range(0, len(rows), per_page)]
    for pi, chunk in enumerate(chunks):
        d.new_page()
        y = 50
        if pi == 0:
            d.text(30, 40, "STATE BANK OF INDIA", 12, True)
            d.text(30, 56, f"Account Statement from {period[0]} to {period[1]}", 8)
            d.text(30, 68, "Account Number : XXXXXXXX7788", 8)
            d.text(30, 80, f"Opening Balance  {indian(opening)}", 8)
            y = 105
        for x, label in [(30, "Txn Date"), (95, "Value Date"), (160, "Description"), (330, "Ref No./Cheque No.")]:
            d.text(x, y, label, 8, True)
        d.right(465, y, "Debit", 8, True)
        d.right(520, y, "Credit", 8, True)
        d.right(572, y, "Balance", 8, True)
        y += 16
        for r in chunk:
            lines = d.wrap(r["narration"], 160)
            d.text(30, y, dmy(r["date"], "d Mon yyyy"), 7.5)
            d.text(95, y, dmy(r["date"], "d Mon yyyy"), 7.5)
            for li, ln in enumerate(lines):
                d.text(160, y + li * 9, ln, 7.5)
            if r["debit"]:
                d.right(465, y, indian(r["debit"]), 7.5)
            if r["credit"]:
                d.right(520, y, indian(r["credit"]), 7.5)
            d.right(572, y, indian(r["balance"]), 7.5)
            y += max(len(lines), 1) * 9 + 5
        if pi == len(chunks) - 1:
            d.text(30, y + 14, f"Closing Balance  {indian(rows[-1]['balance'])}", 8, True)
        d.text(30, 820, f"Page {pi + 1} of {len(chunks)}", 7)
    d.doc.save(path)


# ---------------- Layout C: one Amount column with Dr/Cr, newest first ----------------
def layout_c(path, rows, opening):
    d = Doc()
    desc_rows = list(reversed(rows))
    per_page = 10
    chunks = [desc_rows[i:i + per_page] for i in range(0, len(desc_rows), per_page)]
    for pi, chunk in enumerate(chunks):
        d.new_page()
        y = 60
        if pi == 0:
            d.text(30, 40, "KOTAK MAHINDRA BANK - ACCOUNT STATEMENT", 11, True)
            y = 80
        for x, label in [(30, "Date"), (100, "Particulars")]:
            d.text(x, y, label, 8, True)
        d.right(470, y, "Amount", 8, True)
        d.right(560, y, "Balance", 8, True)
        y += 16
        for r in chunk:
            lines = d.wrap(r["narration"], 230)
            d.text(30, y, dmy(r["date"], "dd/mm/yyyy"), 7.5)
            for li, ln in enumerate(lines):
                d.text(100, y + li * 9, ln, 7.5)
            amt = r["debit"] or r["credit"]
            d.right(470, y, f"{indian(amt)} {'Dr' if r['debit'] else 'Cr'}", 7.5)
            d.right(560, y, f"{indian(r['balance'])} Cr", 7.5)
            y += max(len(lines), 1) * 9 + 5
        if pi == len(chunks) - 1:
            d.text(30, y + 14, f"Opening Balance : {indian(opening)} Cr", 8)
            d.text(30, y + 26, f"Closing Balance : {indian(rows[-1]['balance'])} Cr", 8)
    d.doc.save(path)


# ---------------- Layout D: no header, one line per transaction ----------------
def layout_d(path, rows):
    d = Doc()
    per_page = 14
    chunks = [rows[i:i + per_page] for i in range(0, len(rows), per_page)]
    for pi, chunk in enumerate(chunks):
        d.new_page()
        y = 50
        for r in chunk:
            lines = d.wrap(r["narration"], 260)
            d.text(30, y, dmy(r["date"], "dd/mm/yyyy"), 7.5)
            for li, ln in enumerate(lines):
                d.text(100, y + li * 9, ln, 7.5)
            d.right(480, y, indian(r["debit"] or r["credit"]), 7.5)
            d.right(560, y, indian(r["balance"]), 7.5)
            y += max(len(lines), 1) * 9 + 6
    d.doc.save(path)


def scanned_copy(src, dst):
    """Image-only PDF: no text layer at all, so only OCR can read it."""
    s = fitz.open(src)
    out = fitz.open()
    for i, page in enumerate(s):
        pix = page.get_pixmap(matrix=fitz.Matrix(2.2, 2.2), colorspace=fitz.csGRAY)
        jpeg = pix.tobytes("jpeg", jpg_quality=72)
        np = out.new_page(width=page.rect.width, height=page.rect.height)
        np.insert_image(np.rect, stream=jpeg)
        # The same page as a standalone image, so OCR can be tested without rendering the PDF.
        with open(os.path.join(OUT, f"scanned_p{i + 1}.jpg"), "wb") as f:
            f.write(jpeg)
    out.save(dst)


def main():
    a = os.path.join(OUT, "hdfc_style.pdf")
    layout_a(a, SEPT_ROWS, OPENING_SEPT, ("01/09/2026", "30/09/2026"))
    layout_a(os.path.join(OUT, "protected.pdf"), SEPT_ROWS, OPENING_SEPT, ("01/09/2026", "30/09/2026"), password="secret123")
    layout_a(os.path.join(OUT, "unknown_merchants.pdf"), UNKNOWN_ROWS, p(20000), ("01/11/2026", "30/11/2026"))
    layout_a(os.path.join(OUT, "overlap.pdf"), OVERLAP_ROWS, OVERLAP_OPENING, ("20/09/2026", "10/10/2026"))
    layout_b(os.path.join(OUT, "sbi_style.pdf"), SEPT_ROWS, OPENING_SEPT, ("01 Sep 2026", "30 Sep 2026"))
    layout_c(os.path.join(OUT, "single_amount_newest_first.pdf"), SEPT_ROWS, OPENING_SEPT)
    layout_d(os.path.join(OUT, "headerless.pdf"), SEPT_ROWS)
    scanned_copy(a, os.path.join(OUT, "scanned.pdf"))

    # Things that are not statements
    d = Doc()
    d.new_page()
    d.text(40, 60, "Dear customer, thank you for banking with us. This letter is to inform you about changes to our terms.", 9)
    d.doc.save(os.path.join(OUT, "not_a_statement.pdf"))
    d = Doc()
    d.new_page()
    d.doc.save(os.path.join(OUT, "blank.pdf"))
    with open(os.path.join(OUT, "garbage.pdf"), "wb") as f:
        f.write(b"%PDF-1.4 this is not really a pdf")

    expected = {
        "sept": {"opening": OPENING_SEPT, "closing": CLOSING_SEPT, "rows": SEPT_ROWS},
        "overlap": {"opening": OVERLAP_OPENING, "closing": OVERLAP_ROWS[-1]["balance"], "rows": OVERLAP_ROWS},
        "password": "secret123",
    }
    with open(os.path.join(OUT, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(expected, f, indent=1)
    print("fixtures written to", OUT)


if __name__ == "__main__":
    main()

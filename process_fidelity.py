import csv
import copy
from collections import defaultdict
from datetime import datetime

# ============================================================
# CONFIGURATION
# ============================================================
INPUT_FILE = r"c:\Users\morde\Downloads\TransactionHistory-Fidelity.csv"
OUTPUT_FILE = r"c:\Users\morde\Downloads\Fidelity-For-Portfolio-Performance.csv"

# ISIN mapping from the provided list
ISIN_MAP = {
    "Ninety One Global Gold I Acc Net GBP": "GB00B1XFGM25",
    "BlackRock Natural Resources D Inc": "GB00B46KYQ57",
    "Vanguard FTSE U.K. Equity Income Index Fund GBP Inc": "GB00B5B74684",
    "iShares 100 UK Equity Index Fund D Acc": "GB00B7W4GQ69",
    "HSBC European Index Fund Acc C": "GB00B80QGH28",
    "iShares Pacific Ex Japan Equity Index Fund Class H Acc": "GB00BJL5C004",
    "Fidelity Index US Fund P-Accumulation": "GB00BJS8SH10",
    "Legal & General S&P 500 US Equal Weight Index I Units Accumulation": "GB00BSWT8L75",
    "Artemis SmartGARP Global Emerging Markets Equity Fund I Inc GBP": "GB00BW9HL249",
    "UBS FTSE RAFI Developed 1000 Index Fund C Acc": "GB00BX9C1L56",
    "Schroder US Equity Income Maximiser Z Inc": "GB00BYP24Z16",
    "BGF World Mining D4 GBP": "LU0827889725",
}

# Security name normalisation map (CSV name -> clean name)
NAME_MAP = {
    "Ninety One Global Gold I Acc Net GBP": "Ninety One Global Gold I Acc Net GBP",
    "BlackRock Natural Resources D Inc": "BlackRock Natural Resources Fund Inc D Inc",
    "Vanguard FTSE U.K. Equity Income Index Fund GBP Inc": "Vanguard FTSE U.K. Equity Income Index Fund GBP Inc",
    "iShares 100 UK Equity Index Fund D Acc": "iShares FTSE 100 Index Fund D Acc",
    "HSBC European Index Fund Acc C": "HSBC European Index Fund Acc C",
    "iShares Pacific Ex Japan Equity Index Fund Class H Acc": "iShares Pacific ex-Japan Equity Index Fund Class H Acc",
    "Fidelity Index US Fund P-Accumulation": "Fidelity Index US Fund P Acc",
    "Legal & General S&P 500 US Equal Weight Index I Units Accumulation": "L&G S&P 500 US Equal Weight Index I Units Acc",
    "Artemis SmartGARP Global Emerging Markets Equity Fund I Inc GBP": "Artemis SmartGARP Global Emerging Markets Equity Fund I Inc GBP",
    "UBS FTSE RAFI Developed 1000 Index Fund C Acc": "UBS FTSE RAFI Developed 1000 Index Fund C Acc",
    "Schroder US Equity Income Maximiser Z Inc": "Schroder US Equity Income Maximiser Z Inc",
    "BGF World Mining D4 GBP": "BlackRock World Mining Fund D4 GBP",
    "HSBC American Index Fund Acc C": "HSBC American Index Fund Acc C",
    "iShares North American Equity Index Fund Class H Acc": "iShares North American Equity Index Fund Class H Acc",
    "iShares US Equity Index Fund Class D Acc": "iShares US Equity Index Fund Class D Acc",
    "Fidelity Global Dividend Fund W-Accumulation (UK)": "Fidelity Global Dividend Fund W Acc",
    "Baillie Gifford Japanese Fund B Acc": "Baillie Gifford Japanese Fund B Acc",
    "Jupiter Merian North American Equity Fund U1 GBP Acc": "Jupiter Merian North American Equity Fund U1 GBP Acc",
    "FP Foresight UK Infrastructure Income Fund A Accumulation": "FP Foresight UK Infrastructure Income Fund A Acc",
    "BNY Mellon Asian Income Institutional W Acc": "BNY Mellon Asian Income Institutional W Acc",
    "Barings ASEAN Frontiers Fund I GBP Acc": "Barings ASEAN Frontiers Fund I GBP Acc",
    "Invesco  Global Emerging Markets Bond Fund (UK) Y Inc": "Invesco Global Emerging Markets Bond Fund (UK) Y Inc",
    "Janus Henderson Asian Divdnd In UT I Inc": "Janus Henderson Asian Dividend Income Fund I Inc",
    "JPM UK Equity Core Fund E Inc": "JPM UK Equity Core Fund E Inc",
    "Fidelity UK Select Fund W-Accumulation": "Fidelity UK Select Fund W Acc",
    "Artemis UK Select Fund Class I Acc": "Artemis UK Select Fund Class I Acc",
    "Fidelity Global Dividend Fund W-Accumulation (UK)": "Fidelity Global Dividend Fund W Acc",
}

# ============================================================
# PARSE CSV
# ============================================================
def parse_date(date_str):
    """Parse date string like '20 Jul 2026' into YYYY-MM-DD."""
    try:
        dt = datetime.strptime(date_str.strip(), "%d %b %Y")
        return dt.strftime("%Y-%m-%d")
    except:
        return date_str.strip()

def parse_amount(amount_str):
    """Parse amount string to float."""
    try:
        return float(amount_str.strip())
    except:
        return 0.0

def parse_quantity(qty_str):
    """Parse quantity string to float."""
    try:
        return float(qty_str.strip())
    except:
        return 0.0

def parse_price(price_str):
    """Parse price string to float."""
    try:
        return float(price_str.strip())
    except:
        return 0.0

# Read and parse the CSV
rows = []
with open(INPUT_FILE, "r", encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    all_rows = list(reader)

# Find the header row (it has the column names)
header_row_idx = None
for i, row in enumerate(all_rows):
    if row and row[0] == "Order date":
        header_row_idx = i
        break

if header_row_idx is None:
    print("ERROR: Could not find header row")
    exit(1)

headers = all_rows[header_row_idx]
data_rows = all_rows[header_row_idx + 1:]

# Parse data rows
transactions = []
for row in data_rows:
    if not row or not row[0].strip():
        continue
    if len(row) < 10:
        continue
    
    txn = {
        "order_date": parse_date(row[0]),
        "completion_date": parse_date(row[1]),
        "type": row[2].strip() if len(row) > 2 else "",
        "investment": row[3].strip() if len(row) > 3 else "",
        "product_wrapper": row[4].strip() if len(row) > 4 else "",
        "account": row[5].strip() if len(row) > 5 else "",
        "source_investment": row[6].strip() if len(row) > 6 else "",
        "amount": parse_amount(row[7]) if len(row) > 7 else 0.0,
        "quantity": parse_quantity(row[8]) if len(row) > 8 else 0.0,
        "price": parse_price(row[9]) if len(row) > 9 else 0.0,
        "reference": row[10].strip() if len(row) > 10 else "",
        "status": row[11].strip() if len(row) > 11 else "",
    }
    transactions.append(txn)

print(f"Parsed {len(transactions)} transactions")

# ============================================================
# FILTER OUT DUPLICATE / INTERNAL TRANSACTIONS
# ============================================================

# Types to ALWAYS remove
remove_types = {
    "Cash Out For Buy",
    "Cash In From Sell",
    "Service Fee",
    "Cash In Ring-fenced For Fees",
    "Transfer To Cash Management Account For Fees",
}

# First pass: remove obvious garbage
filtered = []
for txn in transactions:
    if txn["type"] in remove_types:
        continue
    # Remove "Sell" on Cash (these are internal accounting alongside Withdrawal)
    if txn["type"] == "Sell" and txn["investment"] == "Cash":
        continue
    # Remove "Cash Out" on Cash (these are internal accounting for switches)
    if txn["type"] == "Cash Out" and txn["investment"] == "Cash":
        continue
    filtered.append(txn)

print(f"After removing internal types: {len(filtered)} transactions")

# Second pass: identify "Cash In" that are part of switch transactions
# These are Cash In amounts that match a Sell For Switch on the same date
# Group by completion date
by_date = defaultdict(list)
for txn in filtered:
    by_date[txn["completion_date"]].append(txn)

# For each date, identify Cash In that matches Sell For Switch amounts
# and remove them
result = []
for date, txns in by_date.items():
    # Find Sell For Switch amounts
    sell_switch_amounts = set()
    for txn in txns:
        if txn["type"] == "Sell For Switch":
            sell_switch_amounts.add(abs(txn["amount"]))
    
    # Also track deposit amounts on this date to deduplicate Cash In vs Cash In Lump Sum
    deposit_amounts = {}
    for txn in txns:
        if txn["type"] in ("Cash In", "Cash In Lump Sum") and txn["investment"] == "Cash":
            key = abs(txn["amount"])
            if key not in deposit_amounts:
                deposit_amounts[key] = []
            deposit_amounts[key].append(txn["type"])
    
    # Determine which deposit types to keep (prefer Cash In Lump Sum over Cash In)
    keep_deposit_types = {}
    for amt, types in deposit_amounts.items():
        if "Cash In Lump Sum" in types:
            keep_deposit_types[amt] = "Cash In Lump Sum"
        else:
            keep_deposit_types[amt] = "Cash In"
    
    for txn in txns:
        # Remove "Buy For Switch" on Cash (these are just proceeds being parked)
        if txn["type"] == "Buy For Switch" and txn["investment"] == "Cash":
            continue
        
        # Remove Cash In that matches a Sell For Switch amount
        if txn["type"] == "Cash In" and txn["investment"] == "Cash":
            if abs(txn["amount"]) in sell_switch_amounts:
                continue
        
        # Remove Cash In Lump Sum that matches a Sell For Switch amount
        if txn["type"] == "Cash In Lump Sum" and txn["investment"] == "Cash":
            if abs(txn["amount"]) in sell_switch_amounts:
                continue
        
        # Deduplicate deposits: if both Cash In and Cash In Lump Sum exist for same amount, keep only one
        if txn["type"] in ("Cash In", "Cash In Lump Sum") and txn["investment"] == "Cash":
            amt = abs(txn["amount"])
            preferred_type = keep_deposit_types.get(amt)
            if preferred_type and txn["type"] != preferred_type:
                # This is a duplicate, skip it
                continue
        
        result.append(txn)

print(f"After removing switch-related Cash In: {len(result)} transactions")

# ============================================================
# MAP TRANSACTION TYPES FOR PORTFOLIO PERFORMANCE
# ============================================================

def map_type(txn):
    """Map Fidelity transaction types to Portfolio Performance types."""
    t = txn["type"]
    inv = txn["investment"]
    
    if t == "Buy":
        return "Buy"
    elif t == "Sell":
        return "Sell"
    elif t == "Buy For Switch":
        return "Buy"
    elif t == "Sell For Switch":
        return "Sell"
    elif t == "Income Received":
        return "Dividend"
    elif t == "Cash Interest":
        return "Interest"
    elif t == "Cash In" or t == "Cash In Lump Sum":
        return "Deposit"
    elif t == "Cash In From Capital Return":
        return "Dividend"
    elif t == "Withdrawal":
        return "Withdrawal"
    else:
        return t

# ============================================================
# SORT DEPOSITS TO THE BOTTOM
# ============================================================

deposits = []
non_deposits = []

for txn in result:
    mapped_type = map_type(txn)
    if mapped_type == "Deposit":
        deposits.append(txn)
    else:
        non_deposits.append(txn)

# Sort non-deposits by date (ascending)
non_deposits.sort(key=lambda x: x["completion_date"])
# Sort deposits by date (ascending)
deposits.sort(key=lambda x: x["completion_date"])

# Final order: non-deposits first (by date), then deposits (by date)
final = non_deposits + deposits

print(f"Non-deposits: {len(non_deposits)}, Deposits: {len(deposits)}")

# ============================================================
# WRITE OUTPUT CSV
# ============================================================

# Portfolio Performance expects these columns (can be custom mapped):
# Date, Type, ISIN, Name, Shares, Price, Amount, Currency, Note

output_headers = [
    "Date", "Type", "ISIN", "Security Name", "Shares", "Price", 
    "Amount", "Currency", "Note"
]

with open(OUTPUT_FILE, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(output_headers)
    
    for txn in final:
        mapped_type = map_type(txn)
        inv_name = txn["investment"]
        isin = ISIN_MAP.get(inv_name, "")
        clean_name = NAME_MAP.get(inv_name, inv_name)
        
        # For security transactions, shares = quantity, price = price per unit
        # For cash transactions, shares = 0, price = 0
        if inv_name != "Cash":
            shares = txn["quantity"]
            price = txn["price"]
        else:
            shares = 0.0
            price = 0.0
        
        amount = txn["amount"]
        
        # For Buy/Sell, make shares negative for sells
        if mapped_type == "Sell":
            shares = -abs(shares)
            amount = -abs(amount)
        elif mapped_type == "Buy":
            shares = abs(shares)
            amount = abs(amount)
        elif mapped_type == "Withdrawal":
            amount = -abs(amount)
        elif mapped_type == "Dividend" or mapped_type == "Interest":
            amount = abs(amount)
        
        # For interest and dividends on cash, set investment to the source
        note = txn["type"]
        if txn["source_investment"] and txn["source_investment"] != "Cash":
            note = f"{txn['type']} - {txn['source_investment']}"
            # If it's a dividend from a specific fund, use that fund's ISIN
            if mapped_type == "Dividend":
                source_isin = ISIN_MAP.get(txn["source_investment"], "")
                if source_isin:
                    isin = source_isin
                    clean_name = NAME_MAP.get(txn["source_investment"], txn["source_investment"])
        
        # Round values
        shares = round(shares, 4) if shares != 0 else 0.0
        price = round(price, 4) if price != 0 else 0.0
        amount = round(amount, 2)
        
        writer.writerow([
            txn["completion_date"],
            mapped_type,
            isin,
            clean_name,
            shares,
            price,
            amount,
            "GBP",
            note,
        ])

print(f"\nOutput written to: {OUTPUT_FILE}")
print(f"Total transactions: {len(final)}")
print(f"  - Non-deposits: {len(non_deposits)}")
print(f"  - Deposits: {len(deposits)}")

# ============================================================
# SUMMARY
# ============================================================
print("\n=== SUMMARY ===")
print(f"Original transactions: {len(transactions)}")
print(f"Removed (internal/duplicate): {len(transactions) - len(result)}")
print(f"Output transactions: {len(final)}")
print(f"  - Buys: {sum(1 for t in final if map_type(t) == 'Buy')}")
print(f"  - Sells: {sum(1 for t in final if map_type(t) == 'Sell')}")
print(f"  - Dividends: {sum(1 for t in final if map_type(t) == 'Dividend')}")
print(f"  - Interest: {sum(1 for t in final if map_type(t) == 'Interest')}")
print(f"  - Deposits: {sum(1 for t in final if map_type(t) == 'Deposit')}")
print(f"  - Withdrawals: {sum(1 for t in final if map_type(t) == 'Withdrawal')}")
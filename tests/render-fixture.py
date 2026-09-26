"""Generate a synthetic, non-financial receipt for the local OCR smoke test."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 32)
image = Image.new('RGB', (1100, 500), 'white')
draw = ImageDraw.Draw(image)
lines = [
    'DINNER HOUSE',
    'TEST RECEIPT - NOT A REAL PURCHASE',
    '',
    'Burger       2 x 850      1700',
    'Cold Drink   6 x 200      1200',
    'Subtotal                 2900',
    'Discount                  580',
    'Total                    2320',
]
for index, line in enumerate(lines):
    draw.text((40, 30 + index * 52), line, fill='black', font=font)
directory = Path(__file__).parent / 'fixtures'
directory.mkdir(exist_ok=True)
image.save(directory / 'receipt.png')

BarDeals simple placeholder + mobile fit patch

Copy the contents of this ZIP into the root of your bardeals repo and replace existing files.

Changes:
- Replaces generated placeholder images with simple responsive HTML/CSS placeholders.
- Placeholder categories: COCKTAIL BAR, PUB, SPORTS BAR, CLUB, BAR.
- Keeps real official venue photos when available.
- If a real image fails, the card automatically reveals the CSS placeholder.
- Mobile placeholders no longer crop category text because they are not image assets/object-fit crops.
- Applies to both EN and DE homepages.
- Keeps the existing DE live deal feed and crawler image validation.

You can leave the old .webp placeholder files in the repo; the homepage no longer uses them.

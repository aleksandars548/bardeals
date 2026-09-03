BarDeals real placeholder fix

This patch fixes the actual cause of empty grey media blocks:
- legacy homepage/page URLs are no longer treated as official images in EN or DE
- current invalid image values are scrubbed from data/deals-auto.json
- future crawler runs no longer preserve invalid legacy image URLs
- validated extensionless images from future crawler runs are marked imageValidated

Copy the entire patch into the root of your bardeals repository and replace existing files.

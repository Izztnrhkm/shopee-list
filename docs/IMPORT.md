# Importing research from Claude

Shopee List can add researched items in one go. Ask Claude to research what you want to buy, and it gives you an import block (or link). In the app, tap **Import from Claude** (on the lists page) or **Import** (inside a list), paste it, and tap **Import**. Every item is added with its listings and a verdict.

- Items whose name already exists in the target list are updated, not duplicated: new listings are added (links already saved are skipped) and the research is replaced.
- The listing tagged `PICK` becomes the item's **Chosen** listing, so list totals use it.
- Items with verdict `skip` are kept for reference but left out of the totals.
- An import link (`https://izztnrhkm.github.io/shopee-list/#import=...`) opens the same import screen. If you are signed out, it waits until you sign in.

## Where the research happens

Shopee blocks automated access, so Claude needs to read Shopee through **your own Chrome browser** (Claude in Chrome) to see real prices, ratings and sold counts. Use a Claude chat that has Chrome access, such as the Claude desktop app with the Chrome extension connected. A cloud session without a browser can only use web search, so its prices are not checked against Shopee.

## Prompt to give Claude

Copy this, and replace the first line:

```
Research these for Shopee Malaysia: <what you want, e.g. "air fryer under RM400, silicone liners for it">.
Tell me if each is worth buying, then find the best listings using this rule: genuine brand from an official or established shop, rating 4.8+ with about 300+ reviews, ships from Malaysia, not pre-order, no replica signs; among those, the best value. Include one alternative and any cheaper listings that fail, with the reason.
Finish with a Shopee List import block: a single ```json code block in the format from docs/IMPORT.md in github.com/Izztnrhkm/shopee-list. Put it in the list "<list name>".
```

## Format

```json
{
  "shopeeList": 1,
  "list": "Kitchen",
  "researchedAt": "2026-10-26",
  "items": [
    {
      "name": "Air fryer",
      "qty": 1,
      "notes": "Optional note for the item",
      "verdict": "buy",
      "summary": "Why it is or is not worth buying, in 1 to 3 sentences.",
      "pros": ["Short point"],
      "cons": ["Short point"],
      "sources": [{ "title": "Review site", "url": "https://..." }],
      "listings": [
        {
          "url": "https://shopee.com.my/product/<shopid>/<itemid>",
          "shop": "Philips Official Store",
          "price": 399.00,
          "shipping": 0,
          "rating": 4.9,
          "ratingCount": "2.3k",
          "sold": "10k+",
          "badge": "mall",
          "shipsFrom": "Selangor",
          "overseas": false,
          "voucher": "RM20 off min spend RM300",
          "notes": "Variant checked: 4.1 L, UK plug",
          "tag": "PICK",
          "checked": "2026-10-26"
        }
      ]
    }
  ]
}
```

| Field | Values |
| --- | --- |
| `list` | Name of the list. The app picks a list with the same name, or offers to create it. You can change the target before importing. |
| `researchedAt` | Date as `YYYY-MM-DD`. Defaults to today. |
| `verdict` | `buy` (shown as "Worth it"), `consider`, or `skip`. |
| `price`, `shipping` | Ringgit, as numbers or text like `"RM12.90"`. A listing without a price is dropped. `shipping: 0` shows as Free. |
| `rating` | 0 to 5. |
| `ratingCount`, `sold` | Numbers or Shopee-style text: `856`, `"1.2k"`, `"10k+"`. |
| `badge` | `mall`, `preferredPlus`, `preferred`, or `none`. |
| `tag` | `PICK`, `ALT`, `CHEAPER_BUT`, or `RELAXED`. |
| `checked` | Date the price was read on the product page, or `"card"` if it came from the search results only (shown as not verified). |

Limits: 50 items per import, 20 listings per item. Text fields are trimmed to sensible lengths, and only `http(s)` links are kept.

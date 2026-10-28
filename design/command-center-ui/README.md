# Command Center UI reference

- **`command-center.html`**: the redesigned Command Center as one self-contained file. Open it in a browser. It is the source of truth for layout, spacing, type, colour and behaviour. All the data in it is demo data.
- **`DESIGN-RULES.md`**: the rules the redesign follows, plus the security behaviour the server must enforce.
- **`pages/`**: each page's code as it was written before being stitched into the HTML, so it's easier to read. Each page has a data file (`*-data.js`), a render and events file (`*.js`) and a stylesheet (`*.css`). Small integration patches were applied when stitching, so where `pages/` and the HTML differ, the HTML wins.

## Pages, tabs and files

| Route | Tabs | Files in `pages/` |
|---|---|---|
| `#home` | Brief, queue, per-section pulse, timeline | `home/h-js.js`, `home/h-css.css` |
| `#growth` | Overview, traffic, campaigns, cohorts, apps; page-wide City/Source/Shop/Design filters | `growth/growth2-*.js`, `growth/growth2.css` |
| `#members` | People, waitlist and invite batches, masked details with logged reveals | `members/members2.js`, `members/members2.css` |
| `#field` | Today, Plan, Visits, Posters, Placement; phone-first live route | `field/field*.js`, `field/field.css` |
| `#merchants` | Overview (map plus city list), Pipeline, Partners, Payouts, Devices | `merchants/merchants*.js`, `merchants/merchants.css` |
| `#shop` | Overview, Products (costed from materials or one cost), Materials (library, suppliers, reorder), Inventory (stock, batches), Orders | `shop/shop*.js`, `shop/shop.css` |
| `#money` | Tabs by question; moves proposed and approved inside Money | `money/money*.js`, `money/money.css` |
| `#build` | Overview, Changes, Contracts (on-chain map), Deploys, Security | `build/build*.js`, `build/build*.css` |
| `#community` | Overview, Forum, Live (List/Month), Channel | `community/com*.js`, `community/com.css` |
| `#governance` | Overview, Proposals, Boards, Entities, Agreements (versions), Calendar (List/Month) | `governance/gov*.js`, `governance/gov.css` |
| `#records` | Overview, Documents, Audit log, Reveals and exports | `admin/adm*.js`, `admin/adm.css` |
| `#team` | Overview, People, Groups, Two-person rule | same as Records |
| `#settings` | Rules and limits, Security, Connections, Organization | same as Records |

The app shell (top bar, left rail, phone tabs, inbox, profile menu, sign-in, view previews and the read-only blocker) lives only in `command-center.html`.

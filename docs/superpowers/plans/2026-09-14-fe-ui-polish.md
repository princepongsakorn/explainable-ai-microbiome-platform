# FE UI polish: audit and plan

**Goal:** make `explainable-platform` easier to use and look finished. It should feel like one product, not a mix of four UI kits and one-off Tailwind strings.

**Basis:** the [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (fetched 2026-09-14), applied by hand to every UI file on `feature/shadcn-ui` at `47ec2f8`. Fixes use the shadcn/ui components set up in that commit.

## Constraints found before planning

- The stack is Next 12 (pages router), React 18 and Tailwind 3.4. Add components with `npx shadcn@2.3.0 add …`, never `@latest`.
- The v3 registry still serves some Tailwind v4 classes:
  - `field` relies on `@container`.
  - `input-group` relies on `shadow-xs` and `bg-input/30`.
  - Use neither without patching. The other components planned here are v3-safe.
- `components/ui/Pagination/` would collide with shadcn's `pagination.tsx` on macOS's case-insensitive filesystem. Remove the old component before adding it, or don't add it.
- The SHAP charts' full-screen view (`components/shap/ExplanationCharts.tsx`) is portalled to `body` with its own focus trap. Inside a modal Radix `Sheet`, anything outside the sheet is inert. When the drawers become Sheets, that view must become a nested Radix `Dialog` and be checked in the browser.
- No payload or plotting decision from `docs/shap-interactive-frontend-feasibility.md` is touched. Only the chrome around the charts changes.

## Cross-cutting findings

- No page sets a `<title>`. `pages/_document.tsx` exports an App Router `metadata` object that the pages router ignores.
- No page has an `<h1>`, and section headings are styled `div`s.
- Four overlapping UI kits: flowbite-react (`Modal`, `Dropdown`, `Popover`, `Textarea`), @headlessui (`Listbox`), sweetalert2, react-modern-drawer.
- Hard-coded colours stand in for tokens: `#EAEAEA`, `#E4E7EC`, `#F8F8F8`, `#898989`, `#081226`, `#747474`, `#5448DE`.
- Several classes are used but defined nowhere, so they do nothing: `ml-sidebar`, `bg-token-purple`, `rounded-navbar`, `rounded-topbar`, `shadow-magical`, `text-grey-2`, `container-custom`, `transition-width`, `flex-rows`, `bg-gray-10`, `truncat`, and `py-2.5focus:outline-none` (a missing space).
- Dates use three formats (`DD-MM-YYYY HH:mm`, `DD/MM/YYYY`, relative) and a hard-coded `Asia/Bangkok` zone instead of `Intl.DateTimeFormat`.
- `value || "-"` renders a real `0` as "-". This hides zero metrics and zero abundances.
- Clickable rows, tabs and icons are `div`/`a`/`th`/`tr` elements with `onClick`, so none of them work from the keyboard.
- Layouts use fixed widths (`w-[800px]`, `w-3/5` splits) and don't adapt to narrower windows.

## Findings by file

### explainable-platform/pages/_document.tsx

pages/_document.tsx:3 - `metadata` export is App Router only; no title/description reaches the page
pages/_document.tsx:11 - missing `<meta name="theme-color">`, font preconnect and stylesheet link

### explainable-platform/styles/globals.css

styles/globals.css:4 - `@import` after `@tailwind` rules is invalid CSS, so the Prompt font may never load → `<link>` in `_document`
styles/globals.css:7 - fallback `serif` for a sans typeface → `sans-serif`

### explainable-platform/pages/_app.tsx

pages/_app.tsx:22 - `LayoutWrapper` is declared inside `App`, a new component type every render → layout and page remount on every App render
pages/_app.tsx:14 - every failed query opens a blocking modal → toast

### explainable-platform/hoc/AuthenticationCheck.tsx

hoc/AuthenticationCheck.tsx:25 - `router.push` during render → effect
hoc/AuthenticationCheck.tsx:19 - renders nothing while checking; blank flash

### explainable-platform/pages/index.tsx

pages/index.tsx:3 - `/` is an empty page, and sign-in lands here (`auth-context.tsx` pushes `/`); `pageProps.mainPage` is never set, so Layout never redirects

### explainable-platform/pages/403/index.tsx

pages/403/index.tsx:10 - decorative SVG missing `aria-hidden`
pages/403/index.tsx:95 - heading is a `div` → `h1`
pages/403/index.tsx:106 - `focus:ring` → `focus-visible`
pages/403/index.tsx:109 - "Re-login" → "Sign In Again"

### explainable-platform/pages/auth/login.tsx

pages/auth/login.tsx:67 - `img` missing `alt`, `width`/`height`; above the fold → priority
pages/auth/login.tsx:72 - `flex-rows` is not a class
pages/auth/login.tsx:80 - heading is a `div` → `h1`; conflicting `mb-8`/`mb-4`
pages/auth/login.tsx:84 - input has no label (placeholder only); `type="email"` for a username; no `autocomplete="username"`; no `spellCheck={false}`
pages/auth/login.tsx:94 - password has no label; no `autocomplete="current-password"`
pages/auth/login.tsx:42 - validation `errors` never rendered → inline errors
pages/auth/login.tsx:103 - loading replaces the label with an unlabelled spinner
pages/auth/login.tsx:109 - `div onClick` navigation → `Link`
pages/auth/login.tsx:108 - "Don't" → "Don’t"
pages/auth/login.tsx:51 - error says "email" but the field is a username
pages/auth/login.tsx:64 - fixed 60/40 split; form is 40% wide on narrow screens

### explainable-platform/pages/auth/sign-up.tsx

pages/auth/sign-up.tsx:58 - `img` missing `alt`, `width`/`height`
pages/auth/sign-up.tsx:57 - `bg-black` and white wordmark here, `bg-white` and black on login; same image
pages/auth/sign-up.tsx:71 - heading is a `div` → `h1`
pages/auth/sign-up.tsx:75 - inputs have no labels; no `autocomplete="username"` / `"new-password"`
pages/auth/sign-up.tsx:32 - validation `errors` never rendered
pages/auth/sign-up.tsx:100 - `div onClick` navigation → `Link`
pages/auth/sign-up.tsx:39 - success is a blocking modal before redirect → toast

### explainable-platform/components/common/Layout/Layout.tsx

Layout.tsx:133 - no `<main>` landmark, no skip link
Layout.tsx:34 - nav icons not `aria-hidden`
Layout.tsx:140 - `ml-sidebar` undefined

### explainable-platform/components/common/Sidebar/Sidebar.tsx

Sidebar.tsx:23 - container `div` → `nav` with `aria-label`
Sidebar.tsx:31 - icon-only links have no accessible name or tooltip; `key` sits on the inner div; no `aria-current`
Sidebar.tsx:39 - `bg-token-purple rounded-navbar` undefined → active indicator never shows
Sidebar.tsx:33 - no `focus-visible` style
Sidebar.tsx:54 - sign-out is an icon-only `div onClick` → `button` + `aria-label` + tooltip

### explainable-platform/components/common/Topbar/Topbar.tsx

Topbar.tsx:3 - `classnames` is not a dependency (comes through flowbite-react) → `cn`
Topbar.tsx:27 - `a` with `href=""` and a `console.log` `onClick` wrapped by a legacy `Link` → plain `Link`, `aria-current`
Topbar.tsx:29 - `hover:font-bold` shifts layout
Topbar.tsx:82 - `transition-all`; `shadow-magical` undefined, so the scroll listener changes nothing
Topbar.tsx:120 - avatar is a styled `div` → `Avatar` with fallback

### explainable-platform/components/ui/Button/Button.tsx

Button.tsx:38 - `WhiteButton` hard-codes `type="submit"` and drops `...props` (aria-label, disabled lost)
Button.tsx:24 - spinner replaces children with no accessible text; no `aria-busy`
Button.tsx:20 - `focus:ring` → `focus-visible`

### explainable-platform/components/ui/Pagination/Pagination.tsx

Pagination.tsx:100 - `Listbox.Button` nested inside `Listbox.Button` (button in button)
Pagination.tsx:145 - prev/next icon-only buttons missing `aria-label`
Pagination.tsx:95 - "The page you’re on" → "Page"
Pagination.tsx:49 - range uses "-" → "–"
Pagination.tsx:88 - `text-grey-2` undefined; `truncat` typo at :102

### explainable-platform/components/ui/CodeBlock/CodeBlock.tsx

CodeBlock.tsx:59 - icon-only copy button missing `aria-label`; "copied" state not announced
CodeBlock.tsx:25 - long lines have no horizontal scroll container

### explainable-platform/components/ui/{Dropdown,ImageEmpty,ShapLabel}

Dropdown.tsx:1 - unused (only an unused import in `models.tsx`) → delete
ImageEmpty.tsx:1 - unused since the PNG plots were removed → delete, with `ShapLabel` (used only here)

### explainable-platform/pages/upload/predict.tsx

predict.tsx:325 - page has no heading; `justify-items-center` on a non-grid
predict.tsx:334 - file input has no label; help text not linked by `aria-describedby`
predict.tsx:343 - model picker is a `div onClick` → `button`
predict.tsx:351 - icon-only submit missing `aria-label`; enabled with no file or model, then does nothing
predict.tsx:300 - upload errors swallowed; the user sees nothing
predict.tsx:366 - progress bar has no `role="progressbar"`/`aria-valuenow`; `transition-width` undefined; off-brand `#5448DE`
predict.tsx:361 - "formatted correctly" gives no format or next step
predict.tsx:151 - model-type tabs are `a onClick` with no `href`, no `key`, hard-coded `aria-current` → `ToggleGroup`
predict.tsx:202 - selectable rows are `tr onClick`, not keyboard reachable, selection not conveyed, no `key`
predict.tsx:233 - footer puts Confirm before Close (other dialogs put the primary last); "Confirm" → "Use This Model"
predict.tsx:111 - "Auc" → "AUC"
predict.tsx:74 - `py-2.5focus:outline-none`

### explainable-platform/pages/prediction/prediction.tsx

prediction.tsx:120 - heading is a `div` → `h1`
prediction.tsx:148 - rows are `tr onClick` with no `key`, not keyboard reachable
prediction.tsx:142 - "Create At" → "Created"
prediction.tsx:167 - hard-coded date format and zone → `Intl.DateTimeFormat`
prediction.tsx:147 - no loading or empty state
prediction.tsx:187 - react-modern-drawer: no dialog role, title, focus trap or Escape → `Sheet`
prediction.tsx:200 - "View All" is navigation in a `button` → `Link`, "View All Records"
prediction.tsx:210 - section headings are bold `div`s → `h2`

### explainable-platform/pages/prediction/local.tsx

local.tsx:520 - back is an icon-only `div onClick` → `button` with `aria-label`
local.tsx:527 - title reads "Prediction: " while loading
local.tsx:541 - filter tabs are `a onClick` with no `href`, not keyboard reachable; `aria-current` hard-coded on the wrong items (:547, :647, :660) → `ToggleGroup`
local.tsx:665 - flowbite `Popover` used as a menu with `div onClick` items → `DropdownMenu`
local.tsx:686 - menu trigger is an icon-only `div` with no `aria-label`
local.tsx:693 - Refresh is a `div onClick` → `button`
local.tsx:728 - rows are `tr onClick` with no `key`, no pointer cursor, not keyboard reachable
local.tsx:740 - percent built by hand → `Intl.NumberFormat`; `tabular-nums`
local.tsx:746 - "Probable positive" here, "Probability of positive class" in the drawer (:848)
local.tsx:757 - empty state spans 5 columns of a 4-column table, sits in a `th`, and shows while loading; SVG lacks `aria-hidden` → `Empty`
local.tsx:78 - status pills hand-built; CANCELED styled like ERROR → `Badge`
local.tsx:139 - column search has no label; not `type="search"`; `bg-gray-10` undefined; "..." → "…" (:143)
local.tsx:173 - `|| "-"` hides zero abundances
local.tsx:201 - confirm dialogs are flowbite `Modal`s with an empty header and a `div` title → `AlertDialog`
local.tsx:242 - destructive button has a blue focus ring; `py-2.5focus:outline-none`
local.tsx:419 - confirm handlers have no pending state, error handling or result feedback
local.tsx:793 - react-modern-drawer → `Sheet`; title is a `p`
local.tsx:827 - canceled records fall back to "Unknown error occurred"
local.tsx:874 - comment `Textarea` has no label; unsaved text is lost when the drawer closes; placeholder lacks "…"
local.tsx:882 - "Save" → "Save Comment"; no success or error feedback (`try`/`finally` with no `catch`)

### explainable-platform/pages/experiments/experiments.tsx

experiments.tsx:396 - `div` directly inside `table` (invalid DOM); skeleton rows lack `key` (:402, :586) → `Skeleton`
experiments.tsx:409 - experiment list is a `table` of `th onClick` → list of `button`s with `aria-current`
experiments.tsx:443 - description input has no label; save/edit are icon-only `div onClick` (:452, :464); no Enter/Escape
experiments.tsx:478 - Refresh is a `div onClick`
experiments.tsx:486 - `hide-scrollbar` on a wide scrolling table hides the only cue it scrolls
experiments.tsx:546 - sortable headers are `th onClick` → `button` + `aria-sort`
experiments.tsx:552 - sort icons point opposite ways for metrics and parameters (:570)
experiments.tsx:606 - rows are `tr onClick` with no `key`, not keyboard reachable
experiments.tsx:618 - body cells are `th scope="col"`
experiments.tsx:648 - `|| "-"` hides zero metrics (and :660)
experiments.tsx:655 - parameter highlight checks `metrics.` → a sorted parameter column is never highlighted
experiments.tsx:628 - numeric columns lack `tabular-nums` and right alignment
experiments.tsx:684 - react-modern-drawer → `Sheet`
experiments.tsx:702 - Unpublish fires immediately with no confirmation, pending state or error handling
experiments.tsx:727 - date format differs from every other page
experiments.tsx:755 - "Public"/"Not Public" here vs "Production" elsewhere
experiments.tsx:59 - Publish silently does nothing when a field is empty; no inline error
experiments.tsx:104 - "Model Type" and "Description" labels not tied to their controls; `Dropdown.Item` lacks `key` (:122) → `Select`
experiments.tsx:158 - `py-2.5focus:outline-none`

### explainable-platform/pages/experiments/models.tsx

models.tsx:4 - unused imports and commented-out blocks (:61, :104, :142, :181, :190)
models.tsx:53 - `console.log`
models.tsx:86 - Refresh is a `div onClick`
models.tsx:157 - rows lack `key`; hover and pointer cursor with no action
models.tsx:160 - `scope` on `td`
models.tsx:177 - hard-coded date format and zone
models.tsx:157 - no loading or empty state
models.tsx:84 - heading is a `div` → `h1`

### explainable-platform/pages/developer/token.tsx

token.tsx:71 - "Generate new token" revokes the current one with no confirmation, pending state or feedback
token.tsx:35 - Python snippet uses `os` without `import os`
token.tsx:60 - fixed `w-[400px]`/`w-[500px]`/`w-[800px]` boxes overflow; long values don't wrap; no copy buttons
token.tsx:59 - labels are `div`s; values are not tied to them
token.tsx:13 - no loading or error state; empty boxes while fetching
token.tsx:47 - heading is a `div` → `h1`
token.tsx:6 - unused `CodeBlock` import

### explainable-platform/pages/developer/mlflow.tsx

mlflow.tsx:116 - page heading is a `div` → `h1`; section headings → `h2`
mlflow.tsx:6 - component named `Tokens` (copied from `token.tsx`)

### explainable-platform/components/shap/ExplanationCharts.tsx

ExplanationCharts.tsx:197 - loading and progress text not `role="status"`
ExplanationCharts.tsx:319 - hand-rolled modal overlay would be inert inside a Radix `Sheet` → nested `Dialog`
ExplanationCharts.tsx:346 - scroll area missing `overscroll-behavior: contain`
ExplanationCharts.tsx:265 - precision buttons have no `focus-visible` style → `ToggleGroup`

### explainable-platform/lib/dialog.ts

lib/dialog.ts:3 - sweetalert2 modals for routine success and error → toast; `dialog` and `dialogError` are identical; `container-custom` undefined

## Plan

Each step is one commit. Every step must pass `tsc --noEmit` and `next build`. Steps that change what users see are also checked in the browser.

1. **Foundations.**
   - Fix `_document` (title, theme-color, font link) and `globals.css` (font, `color-scheme`, `touch-action`).
   - Fix the `_app` remount.
   - Add the shadcn components and a `sonner` toaster, and replace `lib/dialog.ts`.
   - Add a shared `formatDate`/`formatNumber` on `Intl`.
2. **App shell.**
   - Layout gets a `main` landmark and skip link.
   - Sidebar becomes a `nav` with labelled, tooltipped links and a working active indicator.
   - Topbar gets real `Link`s, `aria-current` and an `Avatar`.
   - `/` redirects to the first section.
3. **Auth pages.**
   - Labelled fields with `autocomplete`, inline validation errors, `Link` navigation, responsive layout.
   - Toast feedback, and one consistent brand panel across login, sign-up and 403.
4. **Upload.**
   - Labelled file field, a model picker that is a button, a radio-style model table, and a disabled submit with reasons.
   - Visible upload errors and an accessible progress bar; dialogs become `Dialog`.
5. **Prediction list and records.**
   - Tables with keyboard-reachable rows.
   - `ToggleGroup` filters, a `DropdownMenu` for bulk actions, and `AlertDialog` confirmations with feedback.
   - `Badge` statuses, an `Empty` state, `Sheet` drawers, a nested `Dialog` for chart expand, and zeros shown as zeros.
6. **Experiments and models.**
   - Experiment list as buttons; sortable headers with `aria-sort`.
   - `Skeleton`s, a `Sheet` drawer, and a `Dialog` with `Select` for publishing.
   - Confirmation before unpublish; fix the metrics/parameters highlight and icon bugs.
7. **Developer pages and shared widgets.**
   - Token page: confirmation, copy buttons, responsive fields, and the snippet's `import os`.
   - Headings; an accessible copy button in `CodeBlock`.
   - A rebuilt `Pagination`; delete the unused components.
8. **Remove the old kits.** Drop flowbite-react, @headlessui/react, sweetalert2 and react-modern-drawer once nothing imports them.

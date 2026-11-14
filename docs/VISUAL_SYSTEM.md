# Functional colors and mobile refinements

The application keeps its sage identity and existing page structure. `src/app/visual-system.css` defines reusable light/dark tokens; components use semantic attributes rather than independent color literals.

| Meaning | Presentation |
| --- | --- |
| Costs and expenses | Muted coral |
| Revenue and sale/asking values | Blue |
| Profit | Green; losses retain their minus sign and use red |
| Pending/incomplete actions | Amber |
| Errors/destructive actions | Red |
| Fulfillment/completion | Teal |
| Secondary information | Higher-contrast neutral text |

`data-metric` controls financial text, chart strokes/fills and selected states. The reusable `FinancialMetricToggle` combines labels, icons, `aria-pressed`, border and underline cues; color is not the only selection indicator. Pipeline lifecycle titles/icons use separate `data-stage`/`--stage-*` tokens, so choosing Cost does not recolor For Sale as a different status. Existing calculations, values, missing/zero distinctions and stage labels are unchanged.

The dashboard's revenue/profit figures are primary; time and hourly information are quieter. Pipeline cards have consistent spacing, stage indicators and valuation colors. Shared badges, buttons, inputs, P&L values and chart accents use the same palette. Focus rings, 44px mobile controls, reduced-motion support and theme persistence remain available.

## Timer placement

The floating timer dock, including its idle promotional widget, is removed entirely. Timers continue running across navigation/reload. **Activity → Time** shows the active timer with Pause/Resume/End controls. Start one from Activity's category cards or **Quick add → Start timer**; the latter opens a normal dialog with the existing category/show/trip associations. Session creation, state transitions, persistence and labor calculations reuse the existing handlers. No stored time records are deleted or rewritten.

The AI assistant launcher stays above the mobile navigation; the layout no longer reserves space for a floating timer. Tables keep their own scrolling, and the existing compact AI review remains supported.

## Subtle motion

Shared `--motion-fast` (120 ms), `--motion-surface` (160 ms) and easing tokens keep interaction feedback consistent. Page navigation and local Inventory/Sales/Activity/Insights views use a small 90%-to-100% opacity transition. Content is available immediately: transitions do not wait for an exit, delay navigation or saving, remount inputs, move the page layout, or change scrolling. Existing immediate tab presentation and live server authorization remain intact. Typing, selections, timers and background data refreshes do not replay the transition. Completed effects are released rather than retaining compositing layers.

Profile/Quick add menus gently fade in over 3px, dialogs over 4px, and navigation/tabs/menu actions use restrained press and color feedback. Dialog movement uses the independent CSS `translate` property so existing centering and the mobile assistant panel are preserved. Native system pickers keep their platform behavior. No animation library is added.

Reduced-motion preferences disable CSS animation/transitions and the content effect. Changing the preference during a running fade cancels it immediately. Narrow layouts, keyboard focus, immediate slow-network navigation, stable inputs and unchanged business storage are covered by browser checks. Actual iPhone Safari/PWA acceptance remains manual.

## Verification

Browser regressions check light/dark contrast of at least 4.5:1 for semantic text on its soft surface, secondary text on cards and primary buttons; visible focus and reduced motion; unchanged business storage when switching financial presentation; independent stage colors; losses; 320/390/430px layouts; clear mobile navigation; and timer persistence/pause/resume/end after removing the dock. Desktop/mobile screenshots are inspected.

This change does not modify database schemas, API routes, authentication, financial calculations or existing business records. Earlier unpublished inventory-management work remains separate.

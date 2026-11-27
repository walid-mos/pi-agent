---
name: frontend
description: Our rules for front-end work - how a page is structured, what a landing page shows and says, where UI components come from, how their code enters a project, what draws a diagram or a chart and how a dashboard is built. Use when building, changing or reviewing a user interface - a web page, a component, a layout, styles, a React, Vue, Svelte, HTML or CSS file, a standalone HTML file or an HTML artifact, a landing page, a sign-up or login screen, a pricing page, a call to action, a dashboard, a prototype, a chart, a graph, a KPI tile, a diagram, a schema, a flowchart, an architecture or data-model view - and before adding a UI component, a UI library or any front-end dependency, even for a one-line change. Emil Kowalski's vendored skills (`emil-design-eng`, `animate`, `pick-ui-library` and the others) cover motion and polish; where one of them disagrees with this skill, this one wins.
---

# Frontend: page structure, landing pages, components, diagrams and charts

## Page structure

Never deliver an interface as one long page that stacks every section and is read by scrolling: it is the default
shape an agent produces, and the user rejects it. Give each purpose its own view (a route, a tab, a step, a panel)
reached through navigation, and size a view so that its first screen holds its point and its main action.

Below that first screen a view may go on, since the user accepts length that is cut cleanly: content that serves the
same purpose (proof, detail, questions), in sections that each make one point. Never another view's content and never
filler: that is the length the user rejects. Scrolling also carries content that is one continuous thing: an article,
a list, a feed, a table, a row of cards that scrolls sideways.

This holds for a standalone HTML file and an HTML artifact too: several views inside the one file, switched by
navigation, not one tall document.

## Landing pages

Before building, changing or reviewing a page that asks a visitor to act (a landing page, a sign-up or login
screen, a pricing page, an onboarding step), read [references/landing-pages.md](references/landing-pages.md).

## Stack

Build static first: plain HTML, or Astro when the site has several pages or shared layouts. React comes in only where
the interface cannot work without it (state that lives in the browser, interaction that markup and CSS cannot
express), and only for that part, as an island in the static page rather than a whole React application. Say in
your report which part needed React and why.

The sources below are mostly React. A component being available there in React is not a reason to use React: for an
element with no client state, take its markup and styles into the static page.

## Diagrams

Two tools, chosen by what the reader does with the diagram. Both are capability dependencies.

| The reader... | Tool |
|---|---|
| reads it: it fits in one view, and a node is a label | Pele (https://pele.run), Mermaid text rendered to SVG |
| explores it: the user called it complex, a node carries more than a label (a status, fields, metrics, actions), it does not fit in one view at a readable size, or the reader has to act on it (expand, filter, select, step through) | React Flow (`@xyflow/react`, https://reactflow.dev) |

Never Mermaid.js: Pele reads the same syntax. When Pele refuses a diagram (its `supports()` says no, or it throws),
say so to the user rather than switching renderer.

Both libraries change faster than an agent's memory of them: write from their documentation, read each time, and
for React Flow from the documentation of the major version the project has installed.

### Pele

- It needs no React: it runs in a static page, and in a standalone HTML file from its browser script. A Pele
  diagram is never a reason for an island.
- Colours and fonts come from the project's design tokens, mapped onto Pele's `--pele-*` CSS variables: Mermaid
  themes and `themeVariables` do nothing there.
- No `style` or `classDef` colours in the diagram source: they are fixed values that do not follow the theme, so
  they break in dark mode. Target a node from CSS instead.
- Mermaid `click` callbacks are ignored. A diagram that needs more than a link on a node is a React Flow diagram.

### React Flow

A React Flow diagram is a small application, not a picture with pan and zoom: delivering the default nodes with a
label, laid out by hand, is the result the user rejects.

- It is React, so it is an island that holds the diagram and nothing else.
- Every node and edge type is a custom component built with the project's own components and tokens. React Flow UI
  (https://reactflow.dev/ui) is one more source for them, under the vendoring rules below.
- Positions are computed by a layout library, never typed in: dagre for a tree or a layered graph; elkjs once nodes
  are grouped in sub-flows or edges must route around nodes, which dagre does not do. Lay out after the nodes are
  measured, and again each time the set of visible nodes changes, animating nodes to their new positions.
- The diagram answers the reader:
  - hovering or selecting a node highlights what it is connected to and dims the rest;
  - groups collapse and expand, starting collapsed when the whole graph would not be readable in one view;
  - a node shows a summary, and its detail opens in a panel beside the diagram when selected;
  - beyond one view, there is a search or a filter that moves the viewport to the result;
  - the viewport refits when the content changes;
  - an edge is animated only to say something moves along it (a direction, a live state), never as decoration.
- Before a diagram of more than a hundred nodes, read https://reactflow.dev/learn/advanced-use/performance.
- Never hide the React Flow attribution (`proOptions.hideAttribution`): its authors allow that to Pro subscribers
  only. If it has to go, ask the user.

## Charts and dashboards

Every chart is drawn with Recharts (https://recharts.org), a capability dependency, and with nothing else: no
second chart library for one chart type or one page, no chart drawn by hand in SVG, sparklines included. One
library is what makes every chart of a product look and behave alike. Never ECharts: the user rejected its look.
When Recharts cannot draw what is asked, say so to the user.

Write from the Recharts documentation, read each time.

- A chart is React, so charts are a reason for an island: one island holds the charts of a view and their filters.
  A standalone HTML file loads React and Recharts as ES modules from a CDN.
- A chart fills a container that has a size (`ResponsiveContainer`); inside a flex or grid cell the container needs
  `min-height: 0`, or the chart grows without end.

### Form and content

How a chart, a KPI tile and a dashboard look is modelled on the references at
https://vibrant.design/search?q=dashboard: the user holds them up as the standard, and Recharts' defaults or an
agent's own taste are what the user rejects. Before building or restyling one, open that page, pick the references
closest to the data shown, and look at their images, not only their titles: reading the page as text gives titles and
image URLs, so view the images themselves; an item's own page adds a description. Take from them the treatment (how a
tile is composed, how lines, areas and bars are drawn and highlighted, the grid, the tooltip, the density), and name
the references used in your report.

The values stay the design system's: colours, fonts, radii and spacing come from the project's tokens and none is
hard-coded, so a chart follows the theme and dark mode. When the project already has its own chart components, they
are kept, so that every chart of the product looks alike, and the references fill only what they do not cover.

What a chart says is set here:

- A series means one thing across the product, so it keeps the same token in every chart. Beyond six series, the
  rest is grouped as one "Other".
- A legend appears only with more than one series and lists only the series that have data.
- One tooltip component serves every chart, and one module formats every number, date and unit (`Intl`) for axes,
  tooltips, tiles and tables alike.
- Several series on one area chart are each drawn from the baseline, not stacked: a stacked area draws the outline
  of the stack once per series.
- No pie or donut beyond three slices, no second value axis, no 3D: each one is a default an agent reaches for and
  each makes the data harder to read.

### Dashboard

- A dashboard view is stricter than the page structure rule: it shows its KPI tiles and its charts without
  scrolling, and what does not fit is another view.
- A KPI tile shows the value with its unit, the change against a period it names, and a sparkline.
- A chart or a tile is in one of four declared states: loading (a skeleton at the final size, so nothing shifts),
  empty (saying for which filter), failed (showing the cause, never an empty or zeroed chart in its place), ready.
- A filter (period, segment) applies to the whole view and lives in the URL, so a view can be reloaded and shared.
- Charts that share an axis share a `syncId`, so the pointer moves them together.

### Speed

Recharts draws SVG, one element per point, and slows down with thousands of them: the speed of a chart is decided
by what it is given.

- Aggregate where the data lives, to the resolution displayed: the browser does not receive raw rows a query could
  have grouped, and a chart never receives more points than its width in pixels.
- A value that cannot be summed from buckets (a median, a percentile) is computed at the source for each filter.
- Under `prefers-reduced-motion`, charts are drawn with `isAnimationActive={false}`.

## Components are vendored, never installed

A component's source code is copied into the project and committed there, so that it can be read, restyled and fixed
like the rest of the code. A dependency is added only for a capability a component is built on (an animation
engine, headless primitives, icons, charts, drag and drop, and the like), never for a component itself: no package
that ships ready-made buttons, dialogs, tables or toasts. A capability dependency needs no approval from the user,
except that two choices are fixed: Base UI for headless primitives, Lucide for icons. The animation engine is
chosen per case (`motion`, GSAP), whichever fits the animation best.

- Before writing a component by hand, look for it in the sources below, and take it from the one whose stack
  matches the project.
- Each source says on its own site how its code is obtained (copied from the page, or written into the project by a
  command such as shadcn's `add`). Read that page each time; do not rely on memory of it.
- A command that writes component source into the project is vendoring: run it with the project's package manager,
  then read every file it wrote and every dependency it added before committing. A dependency it added that is itself
  a component package is not kept: take that component's source instead.
- Headless primitives come from Base UI, never from Radix: one primitives library per project keeps behaviour and
  bundle consistent. When a source offers a component on both, take its Base UI version. When it has only a Radix
  version, take the component from another source, or rewrite its primitives on Base UI before committing.
- Icons come from Lucide. An icon Lucide does not have is vendored: its SVG is copied into the project as a
  component. Never a second icon package.
- When another skill tells you to install a component package (`pick-ui-library` does, for toasts, drawers and
  command menus), this rule wins.
- In a standalone HTML file or an HTML artifact, the component's code is written into the file. A script loaded from
  a CDN is a dependency: only for a capability.

Sources:

- https://ui.shadcn.com
- https://uiarc.dev
- https://beautifului.dev
- https://beui.dev
- https://rareui.com
- https://transitions.dev

---
name: frontend
description: Our rules for front-end work - how a page is structured, where UI components come from, how their code enters a project, what draws a diagram or a chart and how a dashboard is built. Use when building, changing or reviewing a user interface - a web page, a component, a layout, styles, a React, Vue, Svelte, HTML or CSS file, a standalone HTML file or an HTML artifact, a landing page, a dashboard, a prototype, a chart, a graph, a KPI tile, a diagram, a schema, a flowchart, an architecture or data-model view - and before adding a UI component, a UI library or any front-end dependency, even for a one-line change. Emil Kowalski's vendored skills (`emil-design-eng`, `animate`, `pick-ui-library` and the others) cover motion and polish; where one of them disagrees with this skill, this one wins.
---

# Frontend

## Page structure

Never deliver an interface as one long page that stacks every section and is read by scrolling: it is the default
shape an agent produces, and the user rejects it. Give each purpose its own view (a route, a tab, a step, a panel)
reached through navigation, and size a view so that its main content and its main action are visible without
scrolling. Scrolling is for content that is one continuous thing: an article, a list, a feed, a table.

This holds for a standalone HTML file and an HTML artifact too: several views inside the one file, switched by
navigation, not one tall document.

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

Every chart is drawn with Apache ECharts (https://echarts.apache.org), a capability dependency, and with nothing
else: no second chart library for one chart type or one page, no chart drawn by hand in SVG, sparklines included.
One library is what makes every chart of a product look and behave alike, and ECharts is the one that runs without
React and stays fast on large series. shadcn's chart component is Recharts: do not take it. When ECharts cannot
draw what is asked, say so to the user.

Write from the ECharts handbook and option reference, read each time.

- A chart needs no React: `echarts.init` on an element of a static page. Charts alone are never a reason for an
  island. Inside an island that exists for another reason, a chart goes through one wrapper component written in
  the project, never a wrapper package.
- Import from `echarts/core` and register, in one module, only the chart types and components the project uses.
  The full build is for a standalone HTML file only.

### Look

ECharts' default look is never delivered.

- One theme module per project builds the ECharts theme from the design tokens, read at run time from the page's
  CSS custom properties (the canvas does not resolve `var()`), registers it, and switches it with `setTheme` when the
  page's theme changes. A chart's option holds data and structure, never a colour, a font or a spacing.
- The theme removes what carries no data: no border or background on a chart, no axis line or ticks on a value
  axis, horizontal split lines only, in the muted token. Text is the interface's font, with tabular numerals.
- A colour means one thing across the product: a series keeps its colour in every chart. The categorical palette
  comes from the tokens and stops at six series; the rest is grouped as one "Other". When a chart makes one point,
  that series takes the accent and the others the muted token.
- A legend appears only with more than one series, and a series is labelled at its line when there is room.
- One tooltip formatter serves every chart, and one module formats every number, date and unit (`Intl`) for axes,
  tooltips, tiles and tables alike.
- No pie or donut beyond three slices, no second value axis, no 3D, no gradient fill that encodes nothing: each
  one is a default an agent reaches for and each makes the data harder to read.

### Dashboard

- The page structure rule holds: a dashboard view shows its KPI tiles and its charts without scrolling, and what
  does not fit is another view.
- A KPI tile shows the value with its unit, the change against a period it names, and a sparkline.
- A chart or a tile is in one of four declared states: loading (a skeleton at the final size, so nothing shifts),
  empty (saying for which filter), failed (showing the cause, never an empty or zeroed chart in its place), ready.
- A filter (period, segment) applies to the whole view and lives in the URL, so a view can be reloaded and shared.
- Charts that share an axis are linked with `echarts.connect`, so the pointer and the zoom move them together.

### Speed

- Aggregate where the data lives, to the resolution displayed: the browser does not receive raw rows a query could
  have grouped. A line with more points than its width in pixels sets `sampling: 'lttb'`.
- Charts reading the same rows share one `dataset`.
- New data, a new filter or a live tick is a `setOption` on the existing instance, with the data only. Never
  dispose and re-create a chart to update it, and turn the update animation off when ticks come faster than it
  lasts.
- Create a chart when its view is shown, since its container must have a size at `init`. Resize it from a
  `ResizeObserver` on its container, and `dispose` it when the container is removed.
- Under `prefers-reduced-motion`, charts are created with `animation: false`.

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

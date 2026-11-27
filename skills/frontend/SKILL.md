---
name: frontend
description: Our rules for front-end work - how a page is structured, where UI components come from and how their code enters a project. Use when building, changing or reviewing a user interface - a web page, a component, a layout, styles, a React, Vue, Svelte, HTML or CSS file, a standalone HTML file or an HTML artifact, a landing page, a dashboard, a prototype - and before adding a UI component, a UI library or any front-end dependency, even for a one-line change. Emil Kowalski's vendored skills (`emil-design-eng`, `animate`, `pick-ui-library` and the others) cover motion and polish; where one of them disagrees with this skill, this one wins.
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

## Components are vendored, never installed

A component's source code is copied into the project and committed there, so that it can be read, restyled and fixed
like the rest of the code. A dependency is added only for a capability a component is built on (an animation engine
such as `motion`, the headless primitives of Base UI, the Lucide icons), never for a component itself: no package
that ships ready-made buttons, dialogs, tables or toasts.

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

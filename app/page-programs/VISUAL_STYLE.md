# App visual styles

Dynamic pages store a `visualTheme` in their existing configuration. The intent agent selects from the validated theme catalog, prioritizing an explicit user preference, then a dominant connector, then the task type. Themes control accents, tinted surfaces, title typography, corners, header treatment and density. They are visual inspirations, not provider-hosted pages or authorization UI.

Existing dynamic pages without a selected theme get a conservative fallback from their original question and template. Multiple connector mentions do not pick an arbitrary brand. Static reference pages and the main navigation keep their current presentation. Palette values are fixed in code; model output cannot inject CSS or external resources.

Appearance-only in-page changes create the usual saved-change proposal. They retain the page body, template, components and executor. Other app revisions preserve the existing selected theme. Every palette meets 4.5:1 contrast for white primary button labels and accent links on its tinted background.

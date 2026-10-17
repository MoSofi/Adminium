<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § Scripts become React; do not edit -->

# A website template as a working app: Scripts become React

No script of the template is copied in, and no library is installed for what a script did. Bootstrap's
script, a slider, a lightbox: each changes the page's elements behind React's back, and React then
draws over the change, or the change over React. What the script did is written as the screen's own
state, in the template's markup, so the template's own CSS still styles it:

| The template's script | In the screen |
|---|---|
| Bootstrap's collapse (a phone menu, an accordion) | a state that adds `show` to the element's classes; the toggler's `aria-expanded` follows it. Close the phone menu when the address changes |
| Bootstrap's dropdown, modal, tab | a state the same way (`show`, `active`), with Escape to close |
| A slider (tiny-slider, Owl, Slick, Swiper) | the index of the slide shown, a timer for autoplay that stops under the pointer and under `prefers-reduced-motion`, arrows and dots. Draw the classes the library added (`tns-nav`, `tns-nav-active`), which the template's CSS styles, and like the library show no arrows and no dots for one slide |
| A quantity stepper | the line's quantity, in the cart's state |
| A scroll animation (`data-aos`) | nothing: leave the attributes, which then do nothing, and the content shows at once |
| The year in the footer | `{new Date().getFullYear()}` |

An element styled as a button but written as a `<span>` (`#testimonial-nav > span`) stays a
`<span>`, so its rules still match: give it `role="button"`, `tabIndex={0}` and a key handler for
Enter and Space.

A widget too large to write this way is a line in the feature report, not a library added quietly.
Found only while building, it goes to the person then, on its own.

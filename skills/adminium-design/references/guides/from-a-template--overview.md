<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md; do not edit -->

# A website template as a working app

A person downloads a website template: a folder of HTML pages, stylesheets, pictures and a few
scripts. It looks finished, but nothing in it works. The shop's products are written into the page,
the cart shows two made-up lines, and the forms send nowhere.

An app can take that folder and give back the same site, working. The pages become the
[customer side](https://docs.adminium.dev/guides/apps/building-a-side/) of the app, in React, with the template's own CSS.
What the template repeats (products, blog posts, testimonials, the team) becomes tables the owner
edits in the dashboard. The forms become writes that Adminium limits, and the cart becomes an
[order with its lines](https://docs.adminium.dev/guides/apps/orders-with-lines/). What the template shows that Adminium
does not do (taking a card payment, say) is reported before anything is built, and the person
decides what to do about it.

The template decides the look. Adminium's styles and its design advice for new screens are for
screens that have no design yet: they do not restyle one the person brought. The access basics
still hold: labels, keyboard use, visible focus, `alt` text, reduced motion.

This page follows a furniture shop template with nine pages (home, shop, about, services, blog,
contact, cart, checkout, thank you), built on Bootstrap 5 with a testimonial slider.

<!-- produced from apps/docs/src/content/docs/guides/add-ons/offers.md § Cards from an older system; do not edit -->

# The Offers & gift cards add-on: Cards from an older system

An app that kept gift cards of its own before can bring them in with their history, each under
the code its holder already has. The app posts its old card rows, oldest first, into Offers'
`move` action, mapping the old card's key (`old_card`), its code (`old_code`), the table it came
from (`old_table`), and each row's kind, amount and moment. A card is made this way only while the app's move is running — it switches Offers'
`cards_paused` setting on first, which only a Super Admin can do, and off again at the end; a row
written on any other day makes no card. A card's first row makes the card —
nobody types its code, and no email goes out for a card somebody has held for months — and every
later row is added to it at the figure the old system had. An old code keeps its length: eight
characters stay eight. Such a card works at a staffed counter; the public balance door answers
only for cards with twelve characters.

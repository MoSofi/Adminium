---
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/i18n': patch
---

The map draws what a territory screen and a route screen need. An area's name is written on it, where the area is large enough on screen to hold it. A pin or an area can take one of eight colours by number (`colour`), each with an outline of its own so they are told apart without colour, and a pin can say what its colour stands for (`group`). The app can say which pin or area is picked (`selected`, `selectedArea`) and the map goes to it, without flying for somebody who asked for less motion. An app that draws the list itself names it (`hostList`) and the map leaves its own out, only while that list is in the page. A row with no place yet is put on the map by a click, or by Enter under the cross at the map's middle (`placing`, `onPlacePin`); a refused save takes the pin away and says why. "The map could not be reached" has "Try again", in the dashboard too, and so has a route whose legs did not come. A route's legs say their drive time where the routing server gave one, and the whole way is under the list when every leg has a length. On a desk the picked place has "Open on OpenStreetMap (new tab)", a plain link that carries the position and nothing else; a phone keeps "Open in my maps app".

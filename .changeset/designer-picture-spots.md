---
'@adminium/server': patch
'@adminium/widgets': patch
---

Adminium Designer's pictures are spots you fill. Each picture on an app's pages is a named spot (Hero, Team) drawn by `<Picture spot="…" />` from `@adminiumjs/adminium/side`: an empty one is a grey frame with its name, and in the preview it carries "Choose a picture". The picture dialog (the Pictures chip under the reply, the "Choose the pictures" card, or a click on a spot while pointing) lists the page's spots and each table's sample rows, and fills them from a search of Openverse (and Pexels or Unsplash where the server has their keys), from an upload, or from a picture already in the app. Each search result shows its licence as a badge with what it asks; "Credit + same licence" is hidden until you ask for it. Apply writes the pictures with their credits, saves a version, and can be undone; no turn and no model is used. Credits are drawn at the foot of the page that shows them.

The Designer no longer searches for pictures itself (`find_pictures` is gone): it names spots (`add_spots`), puts a picture you attached in one (`fill_spot`), and the first card of a new app asks whether pictures stay placeholders or you choose them after each design. A turn that would take a picture you placed off its screen asks first. An app made before spots keeps its pictures, and "Make them swappable" turns them into spots in one turn.

Fixed: adding an app's sample rows again no longer stops on a row you changed whose key the sample file names; that row is left as yours.

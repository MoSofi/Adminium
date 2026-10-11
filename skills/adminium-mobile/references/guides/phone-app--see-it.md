<!-- produced from apps/docs/src/content/docs/guides/apps/phone-app.md § See it; do not edit -->

# A phone app for an app: See it

**In the Designer**, the preview has a **Phone app** side: the app in a phone's frame, reloaded
when it is built again. The Designer does not look at this side (it takes no picture of it), and
its style menu is for the web screens.

**On a real phone**, press **Open on a phone** under the frame. It shows a code. A phone with
[Expo Go](https://expo.dev/go), on the same network as your computer, scans it and runs the real
app against your computer's data.

- Nothing is sent to anyone else: no tunnel, no account.
- The Designer itself stays on your computer. What is opened to the network is a door for the
  phone preview only, on the one address you pick: it passes the app's bundle, its pictures and
  the app's public API, and nothing else.
- Only the first phone to scan the code is let in. For another phone, stop and show a new code.
- It closes when you stop it, when the Designer stops, and after half an hour with no phone using
  it.
- The first time, your computer's firewall may ask whether to let it accept connections.
- Expo Go runs one version of Expo's SDK. The dialog names the one the phone app is written for;
  a phone with another one is told so by Expo Go.
- A network that keeps its devices apart (many guest networks) cannot work.

`adminium dev` builds the same preview at `/apps/<key>/mobile/`, on your computer's own names
only (`localhost`). The code for a phone is in the Designer.

# Publishing BLACKROOT

Repository: https://github.com/fizyk42/BLACKROOT

The ready-to-play browser build is `docs/index.html`.

## Enable the public game link

In repository **Settings → Pages**, select **Deploy from a branch**,
then branch **main**, folder **/docs**, and **Save**.

After GitHub finishes deploying, the game URL is:
https://fizyk42.github.io/BLACKROOT/

## Update the game

Run `npm ci` and `npm run build`, then commit the source changes and
updated `docs/index.html` to `main`. GitHub Pages will redeploy.

## Multiplayer

GitHub Pages hosts the browser game. Online co-op also needs the included
Node.js server hosted separately with a secure WebSocket connection.

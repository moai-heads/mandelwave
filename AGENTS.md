# Mandelwave agent note

After every requested change to this project: run `node --check app.js` and a browser smoke check when a browser is available, commit the change on `main`, push to `origin`, and verify the GitHub Pages build/live site. Pages publishes the repository root from `main`.

Keep it dependency-free and static-hostable. Never commit tokens, local audio, or user data. Audio stays in the browser; don't add upload/recording behavior.

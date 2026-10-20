# Atmos — Weather Dashboard

A static GitHub Pages weather dashboard with a Cloudflare Worker proxy. The OpenWeatherMap key stays in a Worker secret instead of the public website code.

## Included files

- `index.html` — dashboard structure
- `style.css` — responsive dark theme
- `script.js` — clocks, city search, GPS, current weather and forecast
- `cloudflare-worker.js` — serverless proxy; deploy this as a Cloudflare Worker

## 1. Get an OpenWeatherMap API key

1. Create an account at https://home.openweathermap.org/users/sign_up
2. Create/copy an API key from the API keys page.
3. New keys can take a while to activate. Check your plan includes Current Weather, 5 Day / 3 Hour Forecast, and Geocoding API access.

**Do not paste this key into `script.js`, HTML, a public GitHub repository, or a screenshot.**

## 2. Deploy the serverless proxy on Cloudflare Workers

1. Sign in at https://dash.cloudflare.com/ and open **Workers & Pages**.
2. Create a Worker (for example, `atmos-weather-proxy`).
3. Replace the starter Worker code with the contents of `cloudflare-worker.js`, then deploy.
4. Open the Worker settings and add a **Secret**:
   - Name: `OPENWEATHER_API_KEY`
   - Value: your OpenWeatherMap API key
5. Add a **Variable** (not a secret) named `ALLOWED_ORIGIN`.
   - If your GitHub username is `exampleuser`, set it to `https://exampleuser.github.io`.
   - For a custom domain, set it to the exact website origin, e.g. `https://weather.example.com`.
   - Do not include a repository path or a trailing slash.
6. Deploy again after changing settings.
7. Your Worker URL will look similar to `https://atmos-weather-proxy.example-subdomain.workers.dev`.

### Test the Worker

Open this in a browser, replacing the example URL:

`https://YOUR-WORKER.workers.dev/health`

The health route is intended for a browser page, so the origin restriction may block opening it directly in the address bar. The easiest functional test is to use the dashboard after configuring it. A `403 Origin not allowed` response usually means `ALLOWED_ORIGIN` does not exactly match the website's origin.

## 3. Connect the dashboard to your Worker

Open `script.js` and replace:

`const PROXY_BASE = "PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE";`

with your actual Worker URL, for example:

`const PROXY_BASE = "https://atmos-weather-proxy.example-subdomain.workers.dev";`

This URL is not secret. The API key remains stored as a Cloudflare Worker secret.

## 4. Publish on GitHub Pages

1. Create a new GitHub repository, for example `weather-dashboard`.
2. Upload `index.html`, `style.css`, and `script.js` to the repository root.
   - `cloudflare-worker.js` can also be stored in the repository; it contains no API key.
3. Open repository **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main` and folder `/(root)`, then save.
6. Wait for the Pages URL to appear, usually `https://YOUR-USERNAME.github.io/weather-dashboard/`.
7. Make sure the Worker `ALLOWED_ORIGIN` is `https://YOUR-USERNAME.github.io` (the origin excludes `/weather-dashboard/`).
8. Reload the site over HTTPS.

GPS location requires permission and a secure context. GitHub Pages uses HTTPS. If permission is denied, city search remains available.

## API routes

- `/weather?lat=26.18&lon=91.74`
- `/forecast?lat=26.18&lon=91.74`
- `/geocode?q=Guwahati&limit=1`

The dashboard uses metric values from the API and converts temperatures and wind speeds in the browser. The forecast is based on OpenWeatherMap's 5-day / 3-hour forecast, summarized into daily cards; it is not a once-per-day forecast endpoint.

## Security and abuse prevention

A serverless proxy keeps the API key out of the browser, but it does not automatically prevent other people from calling the Worker endpoint. CORS is not authentication; non-browser clients can ignore it. Before sharing widely, add Cloudflare rate limiting or other abuse protection, monitor provider usage, and keep `ALLOWED_ORIGIN` restricted. Never expose your Cloudflare account credentials or API key.

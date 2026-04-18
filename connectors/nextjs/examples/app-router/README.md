# App Router Example

Minimal Next.js App Router example for the AuraKeeper connector.

## Run

```bash
npm install
AURAKEEPER_ENDPOINT=https://api.example.com/v1/logs/errors \
AURAKEEPER_API_TOKEN=ak_your_token \
npm run dev
```

Open `http://localhost:3000` and use the button to request the demo route. The
route handler throws when `?fail=1` is present and sends the captured error to
the backend configured by `AURAKEEPER_ENDPOINT` and `AURAKEEPER_API_TOKEN`.

## Build

```bash
npm run build
npm run start
```

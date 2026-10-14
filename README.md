# Fund My Trip

1. `npm install`
2. `cp .env.example .env` and set `MONGO_URI`, `ADMIN_PASSWORD`, `TOKEN_SECRET`
3. `npm start` → http://localhost:3000 (admin: /admin.html)

## Make it yours
- **UPI QR:** save your QR image as `public/upi-qr.png`
- **UPI ID / name:** edit `UPI_ID` and `PAYEE_NAME` in the `<script>` of `public/index.html`
- **Avatar:** save as `public/avatar.png`; edit the story text in the hero of `index.html`
- **Items / targets / raised amounts:** use the Admin panel (seeded on first run from `server.js`)

Donors click "I Have Paid" → a *pending* donation appears in Admin → check your UPI app → **Verify** adds it to the item's raised total (the public page refreshes every 10s).
